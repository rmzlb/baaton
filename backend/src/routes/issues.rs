use axum::{extract::{Path, Query, State}, http::StatusCode, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Comment, CreateIssue, Issue, IssueDetail, Tldr, UpdateIssue};

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub r#type: Option<String>,
    pub category: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct ProjectAutoAssignRow {
    prefix: String,
    auto_assign_mode: String,
    default_assignee_id: Option<String>,
    auto_assign_rr_index: i32,
}

async fn resolve_auto_assign_assignees(
    tx: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    org_id: &str,
    explicit_assignees: Option<Vec<String>>,
) -> Result<(String, Vec<String>), (StatusCode, Json<serde_json::Value>)> {
    let project = sqlx::query_as::<_, ProjectAutoAssignRow>(
        r#"
        SELECT prefix, auto_assign_mode, default_assignee_id, auto_assign_rr_index
        FROM projects
        WHERE id = $1 AND org_id = $2
        FOR UPDATE
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_optional(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    if let Some(assignees) = explicit_assignees {
        if !assignees.is_empty() {
            return Ok((project.prefix, assignees));
        }
    }

    match project.auto_assign_mode.as_str() {
        "default_assignee" => {
            let assignees = project.default_assignee_id.into_iter().collect::<Vec<_>>();
            Ok((project.prefix, assignees))
        }
        "round_robin" => {
            let members = sqlx::query_scalar::<_, String>(
                r#"
                SELECT DISTINCT member_id
                FROM (
                    SELECT i.created_by_id AS member_id
                    FROM issues i
                    WHERE i.project_id = $1
                      AND i.created_by_id IS NOT NULL
                    UNION
                    SELECT UNNEST(i.assignee_ids) AS member_id
                    FROM issues i
                    WHERE i.project_id = $1
                ) m
                WHERE member_id IS NOT NULL AND BTRIM(member_id) <> ''
                ORDER BY member_id ASC
                "#,
            )
            .bind(project_id)
            .fetch_all(tx.as_mut())
            .await
            .unwrap_or_default();

            if members.is_empty() {
                return Ok((project.prefix, vec![]));
            }

            let idx = (project.auto_assign_rr_index.max(0) as usize) % members.len();
            let selected = members[idx].clone();

            let next_idx = ((idx + 1) % members.len()) as i32;
            let _ = sqlx::query("UPDATE projects SET auto_assign_rr_index = $2 WHERE id = $1")
                .bind(project_id)
                .bind(next_idx)
                .execute(tx.as_mut())
                .await;

            Ok((project.prefix, vec![selected]))
        }
        _ => Ok((project.prefix, vec![])),
    }
}

pub async fn list_all(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<ListParams>,
) -> Result<Json<ApiResponse<Vec<Issue>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let limit = params.limit.unwrap_or(1000).min(2000);

    let issues = sqlx::query_as::<_, Issue>(
        r#"
        SELECT i.*
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1
        ORDER BY i.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(org_id)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(issues)))
}

pub async fn list_by_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<ListParams>,
) -> Result<Json<ApiResponse<Vec<Issue>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);

    let issues = sqlx::query_as::<_, Issue>(
        r#"
        SELECT * FROM issues
        WHERE project_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR priority = $3)
          AND ($4::text IS NULL OR type = $4)
          AND ($5::text IS NULL OR title ILIKE '%' || $5 || '%')
          AND ($6::text IS NULL OR $6 = ANY(category))
        ORDER BY position ASC
        LIMIT $7 OFFSET $8
        "#,
    )
    .bind(project_id)
    .bind(&params.status)
    .bind(&params.priority)
    .bind(&params.r#type)
    .bind(&params.search)
    .bind(&params.category)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(issues)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateIssue>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (project_prefix, resolved_assignees) = resolve_auto_assign_assignees(
        &mut tx,
        body.project_id,
        org_id,
        body.assignee_ids.clone(),
    )
    .await?;

    let next_number: (i64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(MAX((SPLIT_PART(display_id, '-', 2))::bigint), 0) + 1
        FROM issues
        WHERE project_id = $1
          AND display_id ~ ('^' || $2 || '-[0-9]+$')
        "#,
    )
    .bind(body.project_id)
    .bind(&project_prefix)
    .fetch_one(tx.as_mut())
    .await
    .unwrap_or((1i64,));

    let display_id = format!("{}-{}", project_prefix, next_number.0);

    let max_pos: Option<(Option<f64>,)> = sqlx::query_as(
        "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = $2"
    )
    .bind(body.project_id)
    .bind(body.status.as_deref().unwrap_or("backlog"))
    .fetch_optional(tx.as_mut())
    .await
    .unwrap_or(None);

    let position = max_pos.and_then(|p| p.0).map(|p| p + 1000.0).unwrap_or(1000.0);

    let status = body.status.as_deref().unwrap_or("backlog");
    let created_by_name = auth.created_by_label();

    tracing::info!(
        user_id = %auth.user_id,
        org_id = %org_id,
        project_id = %body.project_id,
        status = %status,
        assignee_count = resolved_assignees.len(),
        has_due_date = body.due_date.is_some(),
        has_estimate = body.estimate.is_some(),
        "issues.create.attempt"
    );

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, status, priority,
            milestone_id, parent_id, tags, category, assignee_ids, position, source,
            created_by_id, created_by_name, due_date, estimate, sprint_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'web', $14, $15, $16, $17, $18)
        RETURNING *
        "#,
    )
    .bind(body.project_id)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.issue_type.as_deref().unwrap_or("feature"))
    .bind(status)
    .bind(&body.priority)
    .bind(body.milestone_id)
    .bind(body.parent_id)
    .bind(&body.tags.unwrap_or_default())
    .bind(&body.category.unwrap_or_default())
    .bind(&resolved_assignees)
    .bind(position)
    .bind(&auth.user_id)
    .bind(created_by_name)
    .bind(body.due_date)
    .bind(body.estimate)
    .bind(body.sprint_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| {
        tracing::error!(
            user_id = %auth.user_id,
            org_id = %org_id,
            project_id = %body.project_id,
            error = %e,
            "issues.create.failed"
        );
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()})))
    })?;

    tracing::info!(
        user_id = %auth.user_id,
        org_id = %org_id,
        issue_id = %issue.id,
        display_id = %issue.display_id,
        assignee_count = issue.assignee_ids.len(),
        "issues.create.success"
    );

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issue)))
}

pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<IssueDetail>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        SELECT i.id, i.project_id, i.milestone_id, i.parent_id, i.display_id, i.title,
               i.description, i.type, i.status, i.priority, i.source, i.reporter_name,
               i.reporter_email, i.assignee_ids, i.tags, i.attachments, i.category,
               i.position, i.created_by_id, i.created_by_name, i.due_date,
               i.qualified_at, i.qualified_by, i.estimate, i.sprint_id, i.created_at, i.updated_at
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1 AND p.org_id = $2
        "#,
    )
    .bind(id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;

    let tldrs = sqlx::query_as::<_, Tldr>(
        "SELECT * FROM tldrs WHERE issue_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let comments = sqlx::query_as::<_, Comment>(
        "SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(IssueDetail {
        issue,
        tldrs,
        comments,
    })))
}

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateIssue>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify issue belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    let existing = sqlx::query_as::<_, Issue>("SELECT * FROM issues WHERE id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;

    let new_status = body.status.clone().unwrap_or(existing.status.clone());
    let status_changed = new_status != existing.status;

    let mut effective_priority = if body.priority.is_some() {
        body.priority.clone().flatten()
    } else {
        existing.priority.clone()
    };

    let mut effective_due_date = if body.due_date.is_some() {
        body.due_date
    } else {
        existing.due_date.map(Some)
    };

    let mut effective_tags = body.tags.clone().unwrap_or_else(|| existing.tags.clone());

    if status_changed {
        let status_marker = format!("auto:status:{}", new_status);
        if !effective_tags.iter().any(|t| t == &status_marker) {
            effective_tags.push(status_marker);
        }

        if new_status == "in_review" && effective_priority.is_none() {
            effective_priority = Some("high".to_string());
        }

        if new_status == "in_progress" && effective_due_date.flatten().is_none() {
            let days = match effective_priority.as_deref() {
                Some("urgent") => 1,
                Some("high") => 2,
                Some("medium") => 4,
                Some("low") => 7,
                _ => 5,
            };
            let auto_due = chrono::Utc::now().date_naive() + chrono::Duration::days(days);
            effective_due_date = Some(Some(auto_due));
        }
    }

    let priority_provided = true;
    let priority_value = effective_priority;
    let milestone_provided = body.milestone_id.is_some();
    let milestone_value = body.milestone_id.flatten();
    let due_date_provided = true;
    let due_date_value = effective_due_date.flatten();
    let tags_provided = true;
    let tags_value = effective_tags;
    let estimate_provided = body.estimate.is_some();
    let estimate_value = body.estimate.flatten();
    let sprint_id_provided = body.sprint_id.is_some();
    let sprint_id_value = body.sprint_id.flatten();

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            type = COALESCE($4, type),
            status = COALESCE($5, status),
            priority = CASE WHEN $6::boolean THEN $7 ELSE priority END,
            tags = CASE WHEN $8::boolean THEN $9 ELSE tags END,
            assignee_ids = COALESCE($10, assignee_ids),
            milestone_id = CASE WHEN $11::boolean THEN $12 ELSE milestone_id END,
            category = COALESCE($13, category),
            due_date = CASE WHEN $14::boolean THEN $15 ELSE due_date END,
            attachments = COALESCE($16, attachments),
            estimate = CASE WHEN $17::boolean THEN $18 ELSE estimate END,
            sprint_id = CASE WHEN $19::boolean THEN $20 ELSE sprint_id END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(&body.issue_type)
    .bind(&body.status)
    .bind(priority_provided)
    .bind(&priority_value)
    .bind(tags_provided)
    .bind(&tags_value)
    .bind(&body.assignee_ids)
    .bind(milestone_provided)
    .bind(milestone_value)
    .bind(&body.category)
    .bind(due_date_provided)
    .bind(due_date_value)
    .bind(&body.attachments)
    .bind(estimate_provided)
    .bind(estimate_value)
    .bind(sprint_id_provided)
    .bind(sprint_id_value)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issue)))
}

pub async fn update_position(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify issue belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("todo");
    let position = body.get("position").and_then(|v| v.as_f64()).unwrap_or(1000.0);

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues SET status = $2, position = $3, updated_at = now()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(status)
    .bind(position)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issue)))
}

#[derive(Debug, Deserialize)]
pub struct MineParams {
    pub assignee_id: String,
}

pub async fn list_mine(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<MineParams>,
) -> Result<Json<ApiResponse<Vec<Issue>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let issues = sqlx::query_as::<_, Issue>(
        r#"
        SELECT i.id, i.project_id, i.milestone_id, i.parent_id, i.display_id, i.title,
               i.description, i.type, i.status, i.priority, i.source, i.reporter_name,
               i.reporter_email, i.assignee_ids, i.tags, i.attachments, i.category,
               i.position, i.created_by_id, i.created_by_name, i.due_date,
               i.qualified_at, i.qualified_by, i.estimate, i.sprint_id, i.created_at, i.updated_at
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE $1 = ANY(i.assignee_ids) AND p.org_id = $2
        ORDER BY
            CASE i.priority
                WHEN 'urgent' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
            END,
            i.updated_at DESC
        "#,
    )
    .bind(&params.assignee_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(issues)))
}

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM issues WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE org_id = $2)"
    )
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))
    }
}

// ─── Public Submission ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PublicSubmission {
    pub title: String,
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub reporter_name: Option<String>,
    pub reporter_email: Option<String>,
}

pub async fn public_submit(
    State(pool): State<PgPool>,
    Path(slug): Path<String>,
    Json(body): Json<PublicSubmission>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    if body.title.trim().is_empty() || body.title.len() > 500 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Title is required and must be under 500 characters"}))));
    }
    if let Some(ref desc) = body.description {
        if desc.len() > 10_000 {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Description must be under 10000 characters"}))));
        }
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let project = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT id, prefix, org_id FROM projects WHERE slug = $1 FOR UPDATE"
    )
    .bind(&slug)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::NOT_FOUND, Json(json!({"error": format!("Project not found: {}", e)}))))?;

    let (_, resolved_assignees) = resolve_auto_assign_assignees(
        &mut tx,
        project.0,
        &project.2,
        None,
    )
    .await?;

    let next_number: (i64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(MAX((SPLIT_PART(display_id, '-', 2))::bigint), 0) + 1
        FROM issues
        WHERE project_id = $1
          AND display_id ~ ('^' || $2 || '-[0-9]+$')
        "#,
    )
    .bind(project.0)
    .bind(&project.1)
    .fetch_one(tx.as_mut())
    .await
    .unwrap_or((1i64,));

    let display_id = format!("{}-{}", project.1, next_number.0);

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type,
            reporter_name, reporter_email, source, position, assignee_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'form', 99999, $8)
        RETURNING *
        "#,
    )
    .bind(project.0)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.r#type.as_deref().unwrap_or("bug"))
    .bind(&body.reporter_name)
    .bind(&body.reporter_email)
    .bind(&resolved_assignees)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issue)))
}
