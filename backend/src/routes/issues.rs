use axum::{extract::{Path, Query, State}, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Comment, CreateIssue, Issue, IssueDetail, Tldr, UpdateIssue};
use crate::routes::activity::log_activity;
use crate::routes::automations::evaluate_automations;
use crate::routes::notifications::create_notification;
use crate::routes::sla::apply_sla_deadline;
use crate::routes::webhooks::dispatch_event;

// ─── Sub-Issues ───────────────────────────────────────

/// GET /issues/{id}/children — list sub-issues
pub async fn list_children(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(parent_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Issue>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(parent_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Parent issue not found"}))));
    }

    let children = sqlx::query_as::<_, Issue>(
        "SELECT * FROM issues WHERE parent_id = $1 ORDER BY created_at ASC"
    )
    .bind(parent_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(children)))
}

// ─── Validation constants ─────────────────────────────

const VALID_PRIORITIES: &[&str] = &["urgent", "high", "medium", "low"];
const VALID_ISSUE_TYPES: &[&str] = &["bug", "feature", "improvement", "question"];

/// Fetch valid status keys for a project from its `statuses` JSONB column.
async fn get_project_statuses(pool: &PgPool, project_id: Uuid, org_id: &str) -> Result<Vec<String>, (StatusCode, Json<serde_json::Value>)> {
    let statuses_json: Option<(serde_json::Value,)> = sqlx::query_as(
        "SELECT statuses FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let statuses_json = statuses_json
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    let keys: Vec<String> = statuses_json.0
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|s| s.get("key").and_then(|k| k.as_str()).map(|k| k.to_string()))
        .collect();

    Ok(keys)
}

fn validate_status(status: &str, valid_statuses: &[String]) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !valid_statuses.iter().any(|s| s == status) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Invalid status '{}'. Accepted values: {}", status, valid_statuses.join(", ")),
                "accepted_values": valid_statuses,
                "field": "status"
            })),
        ));
    }
    Ok(())
}

fn validate_priority(priority: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !VALID_PRIORITIES.contains(&priority) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Invalid priority '{}'. Accepted values: {}", priority, VALID_PRIORITIES.join(", ")),
                "accepted_values": VALID_PRIORITIES,
                "field": "priority"
            })),
        ));
    }
    Ok(())
}

fn validate_issue_type(issue_type: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !VALID_ISSUE_TYPES.contains(&issue_type) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Invalid issue type '{}'. Accepted values: {}", issue_type, VALID_ISSUE_TYPES.join(", ")),
                "accepted_values": VALID_ISSUE_TYPES,
                "field": "issue_type"
            })),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub r#type: Option<String>,
    pub category: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub include_snoozed: Option<bool>,
    pub include_archived: Option<bool>,
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
            .unwrap_or_else(|e| {
                tracing::error!(error = %e, "round_robin members query failed");
                vec![]
            });

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
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "issues.list_all query failed");
        vec![]
    });

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

    let include_archived = params.include_archived.unwrap_or(false);
    let include_snoozed = params.include_snoozed.unwrap_or(false);

    let issues = sqlx::query_as::<_, Issue>(
        r#"
        SELECT * FROM issues
        WHERE project_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR priority = $3)
          AND ($4::text IS NULL OR type = $4)
          AND ($5::text IS NULL OR title ILIKE '%' || $5 || '%')
          AND ($6::text IS NULL OR $6 = ANY(category))
          AND (archived = false OR $9::boolean)
          AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE OR $10::boolean)
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
    .bind(include_archived)
    .bind(include_snoozed)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "issues.list_by_project query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(issues)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    Extension(novu): Extension<Option<crate::novu::NovuClient>>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateIssue>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // ── Plan enforcement: check issue limit ─────────────
    {
        let plan = crate::routes::admin::get_user_plan(&pool, &auth.user_id, Some(org_id)).await;
        let limits = crate::routes::admin::plan_limits(&plan);
        let issue_limit: Option<i64> = if limits.issue_limit < 0 { None } else { Some(limits.issue_limit) };

        if let Some(limit) = issue_limit {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1"
            )
            .bind(org_id)
            .fetch_one(&pool)
            .await
            .unwrap_or(0);

            if count >= limit {
                return Err((StatusCode::PAYMENT_REQUIRED, Json(json!({
                    "error": "Issue limit reached for your plan",
                    "limit": limit,
                    "current": count,
                    "plan": plan,
                    "upgrade_url": "https://baaton.dev/billing"
                }))));
            }
        }
    }

    // ── Project access check (API key scoping) ─────────
    if !auth.has_project_access(body.project_id) {
        return Err((StatusCode::FORBIDDEN, Json(json!({
            "error": "API key does not have access to this project. Check project_ids scope on the key."
        }))));
    }

    // ── Input validation ─────────────────────────────────
    let issue_type = body.issue_type.as_deref().unwrap_or("feature");
    validate_issue_type(issue_type)?;

    if let Some(ref priority) = body.priority {
        validate_priority(priority)?;
    }

    let status = body.status.as_deref().unwrap_or("backlog");
    let valid_statuses = get_project_statuses(&pool, body.project_id, org_id).await?;
    validate_status(status, &valid_statuses)?;

    // ── Depth validation for parent_id (max depth 2) ─────
    if let Some(pid) = body.parent_id {
        // Fetch the parent issue's own parent_id
        let parent_parent: Option<Option<Uuid>> = sqlx::query_scalar(
            "SELECT parent_id FROM issues WHERE id = $1"
        )
        .bind(pid)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

        match parent_parent {
            None => {
                return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Parent issue not found"}))));
            }
            Some(Some(_grandparent)) => {
                return Err((StatusCode::BAD_REQUEST, Json(json!({
                    "error": "Cannot nest issues more than 2 levels deep (parent already has a parent)"
                }))));
            }
            Some(None) => {} // parent is top-level, ok
        }
    }

    // ── Transaction start ────────────────────────────────
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
    .bind(status)
    .fetch_optional(tx.as_mut())
    .await
    .unwrap_or(None);

    let position = max_pos.and_then(|p| p.0).map(|p| p + 1000.0).unwrap_or(1000.0);

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

    let attachments_json = body.attachments.unwrap_or_else(|| serde_json::Value::Array(vec![]));

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, status, priority,
            milestone_id, parent_id, tags, category, assignee_ids, position, source,
            created_by_id, created_by_name, due_date, estimate, sprint_id, attachments
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'web', $14, $15, $16, $17, $18, $19)
        RETURNING *
        "#,
    )
    .bind(body.project_id)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(issue_type)
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
    .bind(&attachments_json)
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

    // ── Activity logging (fire-and-forget) ───────────────
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let pid = issue.project_id;
        let iid = issue.id;
        let oid = org_id.to_string();
        tokio::spawn(async move {
            log_activity(&pool2, &oid, Some(pid), Some(iid), &uid, uname.as_deref(), "issue_created", None, None, None, None).await;
        });
    }

    // ── Novu notifications (fire-and-forget) ─────────────
    if let Some(ref novu) = novu {
        let actor_name = auth.display_name.clone().unwrap_or_else(|| auth.user_id.clone());
        let display_id = issue.display_id.clone();
        let title = issue.title.clone();
        let priority = issue.priority.clone();

        // Notify assignees (exclude self)
        let assignees: Vec<String> = issue
            .assignee_ids
            .iter()
            .filter(|id| **id != auth.user_id)
            .cloned()
            .collect();

        if !assignees.is_empty() {
            let novu = novu.clone();
            let actor_name = actor_name.clone();
            let display_id = display_id.clone();
            let title = title.clone();
            tokio::spawn(async move {
                let subs: Vec<crate::novu::Subscriber> = assignees
                    .into_iter()
                    .map(|id| crate::novu::Subscriber { id, email: None, name: None })
                    .collect();
                novu.trigger_many(
                    "issue-assigned",
                    subs,
                    json!({
                        "actorName": actor_name,
                        "issueId": display_id,
                        "issueTitle": title,
                    }),
                );
            });
        }

        // Urgent issue notification
        if priority.as_deref() == Some("urgent") {
            let novu = novu.clone();
            let assignees: Vec<String> = issue
                .assignee_ids
                .iter()
                .filter(|id| **id != auth.user_id)
                .cloned()
                .collect();
            if !assignees.is_empty() {
                tokio::spawn(async move {
                    let subs: Vec<crate::novu::Subscriber> = assignees
                        .into_iter()
                        .map(|id| crate::novu::Subscriber { id, email: None, name: None })
                        .collect();
                    novu.trigger_many(
                        "urgent-issue-created",
                        subs,
                        json!({
                            "actorName": actor_name,
                            "issueId": display_id,
                            "issueTitle": title,
                        }),
                    );
                });
            }
        }
    }

    // ── SLA deadline (fire-and-forget) ────────────────
    {
        let pool2 = pool.clone();
        let iid = issue.id;
        let pid = issue.project_id;
        let priority = issue.priority.clone();
        tokio::spawn(async move {
            apply_sla_deadline(&pool2, iid, pid, priority.as_deref()).await;
        });
    }

    // ── Automations: issue_created (fire-and-forget) ──
    {
        let pool2 = pool.clone();
        let oid = org_id.to_string();
        let pid = issue.project_id;
        let issue2 = issue.clone();
        tokio::spawn(async move {
            evaluate_automations(&pool2, &oid, pid, "issue_created", &issue2, 3).await;
        });
    }

    // ── Webhook dispatch (fire-and-forget) ───────────
    dispatch_event(pool.clone(), org_id.to_string(), "issue.created", serde_json::to_value(&issue).unwrap_or_default()).await;

    // AI-first: action hints for agents
    let hints = vec![
        crate::models::ActionHint::recommended(
            "add_description",
            "New issue created. Add a detailed description to help with triage and estimation.",
            Some(&format!("PATCH /issues/{}", issue.id)),
        ),
        crate::models::ActionHint::recommended(
            "add_tldr",
            "Add a TLDR summary of the work to be done. This helps reviewers and other agents understand the scope.",
            Some(&format!("POST /issues/{}/tldr", issue.id)),
        ),
    ];

    Ok(Json(ApiResponse::with_hints(issue, hints)))
}

pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<IssueDetail>>, (StatusCode, Json<serde_json::Value>)> {
    let start = std::time::Instant::now();
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        SELECT i.*
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

    // Fetch TLDRs and comments in parallel
    let (tldrs, comments) = tokio::join!(
        sqlx::query_as::<_, Tldr>(
            "SELECT * FROM tldrs WHERE issue_id = $1 ORDER BY created_at DESC",
        )
        .bind(id)
        .fetch_all(&pool),
        sqlx::query_as::<_, Comment>(
            "SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC",
        )
        .bind(id)
        .fetch_all(&pool),
    );

    let tldrs = tldrs.unwrap_or_default();
    let comments = comments.unwrap_or_default();

    tracing::info!(
        issue_id = %id,
        display_id = %issue.display_id,
        elapsed_ms = start.elapsed().as_millis() as u64,
        "issues.get_one"
    );

    Ok(Json(ApiResponse::new(IssueDetail {
        issue,
        tldrs,
        comments,
    })))
}

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    Extension(novu): Extension<Option<crate::novu::NovuClient>>,
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

    // ── Project access check (API key scoping) ─────────
    if !auth.has_project_access(existing.project_id) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "API key does not have access to this project"}))));
    }

    // ── Input validation ─────────────────────────────────
    if let Some(ref status) = body.status {
        let valid_statuses = get_project_statuses(&pool, existing.project_id, org_id).await?;
        validate_status(status, &valid_statuses)?;
    }

    if let Some(ref priority_opt) = body.priority {
        if let Some(ref priority) = priority_opt {
            validate_priority(priority)?;
        }
    }

    if let Some(ref issue_type) = body.issue_type {
        validate_issue_type(issue_type)?;
    }

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

    // Compute closed_at: set when moving to done/cancelled, clear when reopening
    let is_closing = status_changed && (new_status == "done" || new_status == "cancelled");
    let is_reopening = status_changed && existing.closed_at.is_some() && new_status != "done" && new_status != "cancelled";

    let snoozed_until_provided = body.snoozed_until.is_some();
    let snoozed_until_value = body.snoozed_until.flatten();

    let parent_id_provided = body.parent_id.is_some();
    let parent_id_value = body.parent_id.flatten();

    // Depth check for parent_id update
    if let Some(new_parent_id) = parent_id_value {
        let parent_parent: Option<Option<Uuid>> = sqlx::query_scalar(
            "SELECT parent_id FROM issues WHERE id = $1"
        )
        .bind(new_parent_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

        match parent_parent {
            None => {
                return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Parent issue not found"}))));
            }
            Some(Some(_)) => {
                return Err((StatusCode::BAD_REQUEST, Json(json!({
                    "error": "Cannot nest issues more than 2 levels deep"
                }))));
            }
            Some(None) => {}
        }
    }

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
            status_changed_at = CASE WHEN $21::boolean THEN now() ELSE status_changed_at END,
            closed_at = CASE
                WHEN $22::boolean THEN now()
                WHEN $23::boolean THEN NULL
                ELSE closed_at
            END,
            snoozed_until = CASE WHEN $24::boolean THEN $25 ELSE snoozed_until END,
            parent_id = CASE WHEN $26::boolean THEN $27 ELSE parent_id END,
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
    .bind(status_changed)         // $21: status_changed_at trigger
    .bind(is_closing)             // $22: set closed_at
    .bind(is_reopening)           // $23: clear closed_at
    .bind(snoozed_until_provided) // $24
    .bind(snoozed_until_value)    // $25
    .bind(parent_id_provided)     // $26
    .bind(parent_id_value)        // $27
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // ── Activity logging (fire-and-forget) ───────────────
    {
        let pool_ref = pool.clone();
        let user_id = auth.user_id.clone();
        let user_name = auth.display_name.clone();
        let project_id = existing.project_id;
        let org_id_str = org_id.to_string();

        if status_changed {
            let old_val = existing.status.clone();
            let new_val = issue.status.clone();
            let pool2 = pool_ref.clone();
            let uid = user_id.clone();
            let uname = user_name.clone();
            let oid = org_id_str.clone();
            tokio::spawn(async move {
                log_activity(&pool2, &oid, Some(project_id), Some(id), &uid, uname.as_deref(), "status_changed", Some("status"), Some(&old_val), Some(&new_val), None).await;
            });
        }

        if body.priority.is_some() && existing.priority != issue.priority {
            let old_val = existing.priority.clone().unwrap_or_default();
            let new_val = issue.priority.clone().unwrap_or_default();
            let pool2 = pool_ref.clone();
            let uid = user_id.clone();
            let uname = user_name.clone();
            let oid = org_id_str.clone();
            tokio::spawn(async move {
                log_activity(&pool2, &oid, Some(project_id), Some(id), &uid, uname.as_deref(), "priority_changed", Some("priority"), Some(&old_val), Some(&new_val), None).await;
            });
        }

        if let Some(ref new_assignees) = body.assignee_ids {
            if *new_assignees != existing.assignee_ids {
                let old_val = existing.assignee_ids.join(",");
                let new_val = new_assignees.join(",");
                let pool2 = pool_ref.clone();
                let uid = user_id.clone();
                let uname = user_name.clone();
                let oid = org_id_str.clone();
                tokio::spawn(async move {
                    log_activity(&pool2, &oid, Some(project_id), Some(id), &uid, uname.as_deref(), "assignee_changed", Some("assignee_ids"), Some(&old_val), Some(&new_val), None).await;
                });
            }
        }
    }

    // ── Novu notifications (fire-and-forget) ─────────────
    if let Some(ref novu) = novu {
        let actor_name = auth.display_name.clone().unwrap_or_else(|| auth.user_id.clone());

        // New assignees (added in this update, not previously assigned)
        if let Some(ref new_ids) = body.assignee_ids {
            let added: Vec<String> = new_ids
                .iter()
                .filter(|id| !existing.assignee_ids.contains(id) && **id != auth.user_id)
                .cloned()
                .collect();
            if !added.is_empty() {
                let novu = novu.clone();
                let actor_name = actor_name.clone();
                let display_id = issue.display_id.clone();
                let title = issue.title.clone();
                tokio::spawn(async move {
                    let subs: Vec<crate::novu::Subscriber> = added
                        .into_iter()
                        .map(|id| crate::novu::Subscriber { id, email: None, name: None })
                        .collect();
                    novu.trigger_many(
                        "issue-assigned",
                        subs,
                        json!({
                            "actorName": actor_name,
                            "issueId": display_id,
                            "issueTitle": title,
                        }),
                    );
                });
            }
        }

        // Status changed → notify all assignees (exclude actor)
        if status_changed {
            let assignees: Vec<String> = issue
                .assignee_ids
                .iter()
                .filter(|id| **id != auth.user_id)
                .cloned()
                .collect();
            if !assignees.is_empty() {
                let novu = novu.clone();
                let actor_name = actor_name.clone();
                let display_id = issue.display_id.clone();
                let old_status = existing.status.clone();
                let new_status = new_status.clone();
                tokio::spawn(async move {
                    let subs: Vec<crate::novu::Subscriber> = assignees
                        .into_iter()
                        .map(|id| crate::novu::Subscriber { id, email: None, name: None })
                        .collect();
                    novu.trigger_many(
                        "status-changed",
                        subs,
                        json!({
                            "actorName": actor_name,
                            "issueId": display_id,
                            "oldStatus": old_status,
                            "newStatus": new_status,
                        }),
                    );
                });
            }
        }
    }

    // ── Internal notifications (fire-and-forget) ─────────
    {
        let issue_id_copy = id;
        let project_id_copy = existing.project_id;
        let org_id_str2 = org_id.to_string();

        // On assignee change → notify newly added assignees (type='assigned')
        if let Some(ref new_ids) = body.assignee_ids {
            let added: Vec<String> = new_ids
                .iter()
                .filter(|uid| !existing.assignee_ids.contains(uid))
                .cloned()
                .collect();
            if !added.is_empty() {
                let pool2 = pool.clone();
                let oid = org_id_str2.clone();
                let title = format!("You were assigned to: {}", issue.title);
                tokio::spawn(async move {
                    for uid in added {
                        create_notification(
                            &pool2, &uid, &oid, "assigned",
                            Some(issue_id_copy), Some(project_id_copy),
                            &title, None,
                        ).await;
                    }
                });
            }
        }

        // On status change → notify all assignees (type='status_changed')
        if status_changed {
            let assignees: Vec<String> = issue.assignee_ids.clone();
            if !assignees.is_empty() {
                let pool2 = pool.clone();
                let oid = org_id_str2.clone();
                let title = format!(
                    "Issue '{}' status changed to {}",
                    issue.title, issue.status
                );
                tokio::spawn(async move {
                    for uid in assignees {
                        create_notification(
                            &pool2, &uid, &oid, "status_changed",
                            Some(issue_id_copy), Some(project_id_copy),
                            &title, None,
                        ).await;
                    }
                });
            }
        }
    }

    // ── SLA deadline on priority change (fire-and-forget) ─
    let priority_changed_flag = body.priority.is_some() && existing.priority != issue.priority;
    if priority_changed_flag {
        let pool2 = pool.clone();
        let iid = issue.id;
        let pid = issue.project_id;
        let priority = issue.priority.clone();
        tokio::spawn(async move {
            apply_sla_deadline(&pool2, iid, pid, priority.as_deref()).await;
        });
    }

    // ── Automations: status/priority change (fire-and-forget) ─
    {
        let pool2 = pool.clone();
        let oid = org_id.to_string();
        let pid = issue.project_id;
        let issue2 = issue.clone();
        let trigger = if status_changed {
            "status_changed"
        } else if priority_changed_flag {
            "priority_changed"
        } else {
            "issue_updated"
        };
        let trigger = trigger.to_string();
        tokio::spawn(async move {
            if trigger != "issue_updated" {
                evaluate_automations(&pool2, &oid, pid, &trigger, &issue2, 3).await;
            }
        });
    }

    // ── Webhook dispatch (fire-and-forget) ───────────
    let event = if status_changed { "status.changed" } else { "issue.updated" };
    dispatch_event(pool.clone(), org_id.to_string(), event, serde_json::to_value(&issue).unwrap_or_default()).await;

    // AI-first: contextual action hints
    let mut hints = vec![];
    if status_changed {
        hints.push(crate::models::ActionHint::recommended(
            "add_comment",
            "Status changed. Add a comment explaining why (e.g. 'Moved to done: all tests passing, deployed to staging').",
            Some(&format!("POST /issues/{}/comments", issue.id)),
        ));
        if issue.status == "done" || issue.status == "cancelled" {
            hints.push(crate::models::ActionHint::recommended(
                "add_tldr",
                "Issue closed. Add a TLDR summarizing what was done, decisions made, and any follow-ups needed.",
                Some(&format!("POST /issues/{}/tldr", issue.id)),
            ));
        }
    }
    if priority_changed_flag {
        hints.push(crate::models::ActionHint::recommended(
            "add_comment",
            "Priority changed. Consider adding a comment explaining the reprioritization rationale.",
            Some(&format!("POST /issues/{}/comments", issue.id)),
        ));
    }

    Ok(Json(ApiResponse::with_hints(issue, hints)))
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

    // Validate status against project config
    let project_id: Uuid = sqlx::query_scalar("SELECT project_id FROM issues WHERE id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;
    let valid_statuses = get_project_statuses(&pool, project_id, org_id).await?;
    validate_status(status, &valid_statuses)?;

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
        SELECT i.*
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
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "issues.list_mine query failed");
        vec![]
    });

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
        // ── Webhook dispatch (fire-and-forget) ───────────
        dispatch_event(pool.clone(), org_id.to_string(), "issue.deleted", serde_json::json!({"id": id.to_string()})).await;
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))
    }
}

// ─── Batch Actions ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BatchChanges {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assignee_ids: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct BatchUpdateBody {
    pub issue_ids: Vec<Uuid>,
    pub changes: BatchChanges,
}

#[derive(Debug, Deserialize)]
pub struct BatchDeleteBody {
    pub issue_ids: Vec<Uuid>,
}

pub async fn batch_update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<BatchUpdateBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.issue_ids.is_empty() {
        return Ok(Json(json!({"updated": 0})));
    }

    // Validate priority if provided
    if let Some(ref priority) = body.changes.priority {
        validate_priority(priority)?;
    }

    // Validate status if provided — fetch project statuses from the first issue's project
    if let Some(ref status) = body.changes.status {
        let project_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT i.project_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2"
        )
        .bind(body.issue_ids[0])
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

        if let Some(pid) = project_id {
            let valid_statuses = get_project_statuses(&pool, pid, org_id).await?;
            validate_status(status, &valid_statuses)?;
        }
    }

    let mut updated_count: i64 = 0;

    for issue_id in &body.issue_ids {
        // Build dynamic update — only touch provided fields
        let issue = sqlx::query_as::<_, Issue>(
            r#"
            UPDATE issues SET
                status     = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE status END,
                priority   = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE priority END,
                assignee_ids = CASE WHEN $4::text[] IS NOT NULL THEN $4 ELSE assignee_ids END,
                tags       = CASE WHEN $5::text[] IS NOT NULL THEN $5 ELSE tags END,
                updated_at = now()
            WHERE id = $1
              AND project_id IN (SELECT id FROM projects WHERE org_id = $6)
            RETURNING *
            "#,
        )
        .bind(issue_id)
        .bind(&body.changes.status)
        .bind(&body.changes.priority)
        .bind(&body.changes.assignee_ids)
        .bind(&body.changes.tags)
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

        if let Some(issue) = issue {
            updated_count += 1;
            let event = if body.changes.status.is_some() { "status.changed" } else { "issue.updated" };
            dispatch_event(pool.clone(), org_id.to_string(), event, serde_json::to_value(&issue).unwrap_or_default()).await;
        }
    }

    Ok(Json(json!({"updated": updated_count})))
}

pub async fn batch_delete(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<BatchDeleteBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.issue_ids.is_empty() {
        return Ok(Json(json!({"deleted": 0})));
    }

    let result = sqlx::query(
        "DELETE FROM issues WHERE id = ANY($1) AND project_id IN (SELECT id FROM projects WHERE org_id = $2)"
    )
    .bind(&body.issue_ids)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({"deleted": result.rows_affected()})))
}

// ─── Global Search ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub q: String,
    pub project_id: Option<Uuid>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub is_overdue: Option<bool>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SearchResult {
    pub id: Uuid,
    pub display_id: String,
    pub title: String,
    pub snippet: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub project_id: Uuid,
}

pub async fn search(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<SearchParams>,
) -> Result<Json<ApiResponse<Vec<SearchResult>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if params.q.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Query parameter 'q' is required"}))));
    }

    let limit = params.limit.unwrap_or(20).min(100);

    let is_overdue = params.is_overdue.unwrap_or(false);

    let results = sqlx::query_as::<_, SearchResult>(
        r#"
        SELECT
            i.id,
            i.display_id,
            i.title,
            ts_headline('english', COALESCE(i.description, ''), plainto_tsquery('english', $1),
                'MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false') AS snippet,
            i.status,
            i.priority,
            i.project_id
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE i.search_vector @@ plainto_tsquery('english', $1)
          AND p.org_id = $2
          AND ($3::uuid IS NULL OR i.project_id = $3)
          AND ($4::text IS NULL OR i.status = $4)
          AND (NOT $6::boolean OR (i.due_date < CURRENT_DATE AND i.status NOT IN ('done', 'cancelled')))
        ORDER BY ts_rank(i.search_vector, plainto_tsquery('english', $1)) DESC
        LIMIT $5
        "#,
    )
    .bind(&params.q)
    .bind(org_id)
    .bind(params.project_id)
    .bind(&params.status)
    .bind(limit)
    .bind(is_overdue)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(results)))
}

// ─── Global Search (cross-org) ────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GlobalSearchResult {
    pub id: Uuid,
    pub display_id: String,
    pub title: String,
    pub snippet: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub project_id: Uuid,
    pub org_id: String,
    pub org_name: String,
    pub project_name: String,
}

pub async fn search_global(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<SearchParams>,
) -> Result<Json<ApiResponse<Vec<GlobalSearchResult>>>, (StatusCode, Json<serde_json::Value>)> {
    if params.q.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Query parameter 'q' is required"}))));
    }

    // Get all org IDs this user belongs to via Clerk API
    let org_ids = fetch_user_org_ids(&auth.user_id).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch user org memberships");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to resolve organizations"})))
    })?;

    if org_ids.is_empty() {
        return Ok(Json(ApiResponse::new(vec![])));
    }

    let limit = params.limit.unwrap_or(30).min(100);
    let is_overdue = params.is_overdue.unwrap_or(false);

    // Build prefix-safe tsquery: "hlm" → "hlm:*", "audio record" → "audio:* & record:*"
    let tsquery_str = params.q.split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| format!("{}:*", w.replace('\'', "").replace('\\', "")))
        .collect::<Vec<_>>()
        .join(" & ");

    // Combined search: full-text (prefix) + ILIKE fallback on title/display_id
    let results = sqlx::query_as::<_, GlobalSearchResult>(
        r##"
        SELECT DISTINCT ON (i.id)
            i.id,
            i.display_id,
            i.title,
            COALESCE(
                NULLIF(ts_headline('english', COALESCE(i.description, ''), to_tsquery('english', $7),
                    'MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false'), ''),
                LEFT(COALESCE(i.description, ''), 120)
            ) AS snippet,
            i.status,
            i.priority,
            i.project_id,
            p.org_id,
            COALESCE(o.name, p.org_id) AS org_name,
            p.name AS project_name
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN organizations o ON o.id = p.org_id
        WHERE p.org_id = ANY($2)
          AND (
            -- Full-text prefix search
            ($7 != '' AND i.search_vector @@ to_tsquery('english', $7))
            -- ILIKE fallback on title
            OR i.title ILIKE '%' || $1 || '%'
            -- Match display_id prefix (e.g. "HLM" matches "HLM-42")
            OR i.display_id ILIKE $1 || '%'
            -- Match project prefix (e.g. "hlm" matches project with prefix "HLM")
            OR p.prefix ILIKE $1 || '%'
          )
          AND ($3::uuid IS NULL OR i.project_id = $3)
          AND ($4::text IS NULL OR i.status = $4)
          AND (NOT $6::boolean OR (i.due_date < CURRENT_DATE AND i.status NOT IN ('done', 'cancelled')))
        ORDER BY i.id, i.created_at DESC
        LIMIT $5
        "##,
    )
    .bind(&params.q)
    .bind(&org_ids)
    .bind(params.project_id)
    .bind(&params.status)
    .bind(limit)
    .bind(is_overdue)
    .bind(&tsquery_str)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(results)))
}

/// Fetch all organization IDs that a user belongs to via Clerk API
pub async fn fetch_user_org_ids(user_id: &str) -> Result<Vec<String>, String> {
    let secret = std::env::var("CLERK_SECRET_KEY")
        .map_err(|_| "CLERK_SECRET_KEY not configured".to_string())?;

    let url = format!(
        "https://api.clerk.com/v1/users/{}/organization_memberships?limit=100",
        user_id
    );

    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&secret)
        .send()
        .await
        .map_err(|e| format!("Clerk API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Clerk API returned {}: {}", status, body));
    }

    #[derive(Deserialize)]
    struct ClerkOrgMembership {
        organization: ClerkOrgRef,
    }
    #[derive(Deserialize)]
    struct ClerkOrgRef {
        id: String,
    }
    #[derive(Deserialize)]
    struct ClerkOrgMembershipsResponse {
        data: Vec<ClerkOrgMembership>,
    }

    let memberships: ClerkOrgMembershipsResponse = response.json().await
        .map_err(|e| format!("Failed to parse Clerk response: {}", e))?;

    Ok(memberships.data.into_iter().map(|m| m.organization.id).collect())
}

// ─── Public Submission ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PublicSubmission {
    pub title: String,
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub priority: Option<String>,
    pub category: Option<Vec<String>>,
    pub reporter_name: Option<String>,
    pub reporter_email: Option<String>,
    pub token: Option<String>,
    pub attachments: Option<serde_json::Value>,
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

    if let Some(ref priority) = body.priority {
        if !matches!(priority.as_str(), "urgent" | "high" | "medium" | "low") {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid priority"}))));
        }
    }

    if let Some(ref category) = body.category {
        let allowed = ["FRONT", "BACK", "API", "DB", "INFRA", "UX", "DEVOPS"];
        if category.iter().any(|c| !allowed.contains(&c.as_str())) {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid category"}))));
        }
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let project = sqlx::query_as::<_, (Uuid, String, String, bool, Option<String>)>(
        "SELECT id, prefix, org_id, public_submit_enabled, public_submit_token FROM projects WHERE slug = $1 FOR UPDATE"
    )
    .bind(&slug)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::NOT_FOUND, Json(json!({"error": format!("Project not found: {}", e)}))))?;

    if !project.3 {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Public submission disabled"}))));
    }
    match (&project.4, body.token.as_deref()) {
        (Some(expected), Some(provided)) if expected == provided => {}
        _ => {
            return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Invalid public token"}))));
        }
    }

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

    // Validate attachments: max 5, each must have url/name/size/mime_type
    let attachments_json = if let Some(ref atts) = body.attachments {
        if let Some(arr) = atts.as_array() {
            if arr.len() > 5 {
                return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Maximum 5 attachments allowed"}))));
            }
            for att in arr {
                if att.get("url").and_then(|v| v.as_str()).is_none()
                    || att.get("name").and_then(|v| v.as_str()).is_none()
                {
                    return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid attachment format"}))));
                }
            }
            atts.clone()
        } else {
            serde_json::Value::Array(vec![])
        }
    } else {
        serde_json::Value::Array(vec![])
    };

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, status,
            priority, category,
            reporter_name, reporter_email, source, position, assignee_ids,
            attachments
        )
        VALUES ($1, $2, $3, $4, $5, 'backlog', $6, $7, $8, $9, 'form', 99999, $10, $11)
        RETURNING *
        "#,
    )
    .bind(project.0)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.r#type.as_deref().unwrap_or("bug"))
    .bind(body.priority.as_deref().unwrap_or("medium"))
    .bind(&body.category.clone().unwrap_or_default())
    .bind(&body.reporter_name)
    .bind(&body.reporter_email)
    .bind(&resolved_assignees)
    .bind(&attachments_json)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issue)))
}

// ─── Archive / Unarchive ──────────────────────────────

pub async fn archive(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

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

    let issue = sqlx::query_as::<_, Issue>(
        "UPDATE issues SET archived = true, archived_at = now(), updated_at = now() WHERE id = $1 RETURNING *"
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // ── Activity log ─────────────────────────────────────
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let pid = issue.project_id;
        let oid = org_id.to_string();
        tokio::spawn(async move {
            log_activity(&pool2, &oid, Some(pid), Some(id), &uid, uname.as_deref(), "issue_archived", None, None, None, None).await;
        });
    }

    dispatch_event(pool.clone(), org_id.to_string(), "issue.archived", serde_json::to_value(&issue).unwrap_or_default()).await;

    Ok(Json(ApiResponse::new(issue)))
}

pub async fn unarchive(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Issue>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

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

    let issue = sqlx::query_as::<_, Issue>(
        "UPDATE issues SET archived = false, archived_at = NULL, updated_at = now() WHERE id = $1 RETURNING *"
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // ── Activity log ─────────────────────────────────────
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let pid = issue.project_id;
        let oid = org_id.to_string();
        tokio::spawn(async move {
            log_activity(&pool2, &oid, Some(pid), Some(id), &uid, uname.as_deref(), "issue_unarchived", None, None, None, None).await;
        });
    }

    dispatch_event(pool.clone(), org_id.to_string(), "issue.unarchived", serde_json::to_value(&issue).unwrap_or_default()).await;

    Ok(Json(ApiResponse::new(issue)))
}
