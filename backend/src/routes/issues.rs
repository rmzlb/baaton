use axum::{extract::{Path, Query, State}, http::StatusCode, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
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

    // Verify project belongs to user's org
    let project = sqlx::query_as::<_, (String,)>(
        "SELECT prefix FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(body.project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    let count: (i64,) = sqlx::query_as(
        "SELECT COALESCE(COUNT(*), 0) FROM issues WHERE project_id = $1"
    )
    .bind(body.project_id)
    .fetch_one(&pool)
    .await
    .unwrap_or((0i64,));

    let display_id = format!("{}-{}", project.0, count.0 + 1);

    let max_pos: Option<(Option<f64>,)> = sqlx::query_as(
        "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = $2"
    )
    .bind(body.project_id)
    .bind(body.status.as_deref().unwrap_or("backlog"))
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    let position = max_pos.and_then(|p| p.0).map(|p| p + 1000.0).unwrap_or(1000.0);

    let status = body.status.as_deref().unwrap_or("backlog");
    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, status, priority,
            milestone_id, parent_id, tags, category, assignee_ids, position, source,
            created_by_id, created_by_name, due_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'web', $14, $15, $16)
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
    .bind(&body.assignee_ids.unwrap_or_default())
    .bind(position)
    .bind(&auth.user_id)
    .bind(None::<String>)
    .bind(body.due_date)
    .fetch_one(&pool)
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
               i.qualified_at, i.qualified_by, i.created_at, i.updated_at
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

    let priority_provided = body.priority.is_some();
    let priority_value = body.priority.flatten();
    let milestone_provided = body.milestone_id.is_some();
    let milestone_value = body.milestone_id.flatten();
    let due_date_provided = body.due_date.is_some();
    let due_date_value = body.due_date.flatten();

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            type = COALESCE($4, type),
            status = COALESCE($5, status),
            priority = CASE WHEN $6::boolean THEN $7 ELSE priority END,
            tags = COALESCE($8, tags),
            assignee_ids = COALESCE($9, assignee_ids),
            milestone_id = CASE WHEN $10::boolean THEN $11 ELSE milestone_id END,
            category = COALESCE($12, category),
            due_date = CASE WHEN $13::boolean THEN $14 ELSE due_date END,
            attachments = COALESCE($15, attachments),
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
    .bind(&body.tags)
    .bind(&body.assignee_ids)
    .bind(milestone_provided)
    .bind(milestone_value)
    .bind(&body.category)
    .bind(due_date_provided)
    .bind(due_date_value)
    .bind(&body.attachments)
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
               i.qualified_at, i.qualified_by, i.created_at, i.updated_at
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

    let project = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, prefix FROM projects WHERE slug = $1"
    )
    .bind(&slug)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::NOT_FOUND, Json(json!({"error": format!("Project not found: {}", e)}))))?;

    let count: (i64,) = sqlx::query_as(
        "SELECT COALESCE(COUNT(*), 0) FROM issues WHERE project_id = $1"
    )
    .bind(project.0)
    .fetch_one(&pool)
    .await
    .unwrap_or((0i64,));

    let display_id = format!("{}-{}", project.1, count.0 + 1);

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type,
            reporter_name, reporter_email, source, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'form', 99999)
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
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issue)))
}
