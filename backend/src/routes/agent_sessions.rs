use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use std::{convert::Infallible, time::Duration};
use ulid::Ulid;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{
    ActionHint, AgentSession, AgentSessionDetail, AgentStep, ApiResponse,
    CreateAgentSession, CreateAgentStep, Tldr, UpdateAgentSession,
};
use crate::routes::activity::log_activity;
use crate::routes::sse::{EventSender, broadcast_event};

const VALID_STATUSES: &[&str] = &["pending", "active", "awaiting_input", "completed", "error"];
const VALID_STEP_TYPES: &[&str] = &["info", "action", "thought", "error", "tool_call", "tool_result"];

fn new_public_token() -> String {
    Ulid::new().to_string()
}

#[derive(Debug, Serialize)]
pub struct PublicRunResponse {
    pub session: PublicRunSession,
    pub issue: PublicRunIssue,
    pub project: PublicRunProject,
    pub steps: Vec<PublicRunStep>,
    pub latest_tldr: Option<PublicRunTldr>,
}

#[derive(Debug, Serialize)]
pub struct PublicRunSession {
    pub public_token: String,
    pub agent_name: String,
    pub agent_id: Option<String>,
    pub status: String,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub summary: Option<String>,
    pub files_changed: Vec<String>,
    pub tests_status: String,
    pub pr_url: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PublicRunIssue {
    pub display_id: String,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PublicRunProject {
    pub name: String,
    pub slug: String,
    pub prefix: String,
}

#[derive(Debug, Serialize)]
pub struct PublicRunStep {
    pub step_type: String,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PublicRunTldr {
    pub agent_name: String,
    pub summary: String,
    pub files_changed: Vec<String>,
    pub tests_status: String,
    pub pr_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct PublicRunContext {
    display_id: String,
    title: String,
    status: String,
    priority: Option<String>,
    source: String,
    issue_created_at: DateTime<Utc>,
    issue_updated_at: DateTime<Utc>,
    project_name: String,
    project_slug: String,
    project_prefix: String,
}

// ── POST /agent-sessions — Start a new agent session on an issue ──

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateAgentSession>,
) -> Result<Json<ApiResponse<AgentSession>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify issue belongs to org and get project_id
    let issue = sqlx::query_as::<_, (Uuid, Uuid, String, bool)>(
        "SELECT i.id, i.project_id, i.status, p.agent_runs_public_default FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2"
    )
    .bind(body.issue_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;

    // Check no active session already exists for this issue
    let active_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE issue_id = $1 AND status IN ('pending', 'active', 'awaiting_input'))"
    )
    .bind(body.issue_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if active_exists {
        return Err((StatusCode::CONFLICT, Json(json!({
            "error": "An active agent session already exists for this issue. Complete or cancel it first.",
            "_hints": [ActionHint::recommended(
                "complete_existing_session",
                "PATCH the existing session to 'completed' or 'error' before starting a new one.",
                Some(&format!("GET /issues/{}/agent-sessions?status=active", body.issue_id)),
            )]
        }))));
    }

    let meta = body.metadata.unwrap_or(json!({}));
    let public_token = if issue.3 { Some(new_public_token()) } else { None };
    
    let session = sqlx::query_as::<_, AgentSession>(
        r#"
        INSERT INTO agent_sessions (org_id, project_id, issue_id, agent_name, agent_id, status, started_at, metadata, is_public, public_token, published_at)
        VALUES ($1, $2, $3, $4, $5, 'active', NOW(), $6, $7, $8, CASE WHEN $7 THEN NOW() ELSE NULL END)
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(issue.1) // project_id
    .bind(body.issue_id)
    .bind(&body.agent_name)
    .bind(&body.agent_id)
    .bind(&meta)
    .bind(issue.3)
    .bind(&public_token)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Update issue agent_status + agent_session_id
    let _ = sqlx::query(
        "UPDATE issues SET agent_status = 'active', agent_session_id = $1, updated_at = NOW() WHERE id = $2"
    )
    .bind(session.id)
    .bind(body.issue_id)
    .execute(&pool)
    .await;

    // Log activity
    {
        let pool2 = pool.clone();
        let oid = org_id.to_string();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let iid = body.issue_id;
        let pid = issue.1;
        let aname = body.agent_name.clone();
        tokio::spawn(async move {
            log_activity(&pool2, &oid, Some(pid), Some(iid), &uid, uname.as_deref(),
                "agent_session_started", Some("agent_name"), None, Some(&aname), None).await;
        });
    }

    // Webhook
    crate::routes::webhooks::dispatch_event(
        pool.clone(), org_id.to_string(), "agent_session.started",
        serde_json::to_value(&session).unwrap_or_default(),
    ).await;

    // SSE broadcast
    broadcast_event(&sse_tx, org_id, "agent_session.started", &serde_json::to_string(&session).unwrap_or_default());

    let hints = vec![
        ActionHint::recommended(
            "post_step",
            "Session started. Post progress steps as you work.",
            Some(&format!("POST /agent-sessions/{}/steps", session.id)),
        ),
        ActionHint::optional(
            "update_issue_status",
            &format!("Issue is currently '{}'. Consider moving to 'in_progress'.", issue.2),
            Some(&format!("PATCH /issues/{}", body.issue_id)),
        ),
    ];

    Ok(Json(ApiResponse::with_hints(session, hints)))
}

// ── GET /agent-sessions/:id — Get session detail with steps ──

pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<ApiResponse<AgentSessionDetail>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let session = sqlx::query_as::<_, AgentSession>(
        "SELECT * FROM agent_sessions WHERE id = $1 AND org_id = $2"
    )
    .bind(session_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))))?;

    let steps = sqlx::query_as::<_, AgentStep>(
        "SELECT * FROM agent_steps WHERE session_id = $1 ORDER BY created_at ASC"
    )
    .bind(session_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut hints = vec![];
    if session.status == "active" {
        hints.push(ActionHint::recommended(
            "post_step",
            "Session is active. Post your next progress step.",
            Some(&format!("POST /agent-sessions/{}/steps", session_id)),
        ));
        hints.push(ActionHint::optional(
            "complete_session",
            "When done, complete the session with a summary.",
            Some(&format!("PATCH /agent-sessions/{}", session_id)),
        ));
    }

    Ok(Json(ApiResponse::with_hints(AgentSessionDetail { session, steps }, hints)))
}

// ── GET /issues/:id/agent-sessions — List sessions for an issue ──

#[derive(Debug, Deserialize)]
pub struct SessionListParams {
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list_by_issue(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Query(params): Query<SessionListParams>,
) -> Result<Json<ApiResponse<Vec<AgentSession>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let limit = params.limit.unwrap_or(20);

    let sessions = if let Some(ref status) = params.status {
        if !VALID_STATUSES.contains(&status.as_str()) {
            return Err((StatusCode::BAD_REQUEST, Json(json!({
                "error": format!("Invalid status: '{}'. Valid values: {}", status, VALID_STATUSES.join(", ")),
                "accepted_values": VALID_STATUSES,
                "field": "status"
            }))));
        }
        sqlx::query_as::<_, AgentSession>(
            "SELECT * FROM agent_sessions WHERE issue_id = $1 AND org_id = $2 AND status = $3 ORDER BY created_at DESC LIMIT $4"
        )
        .bind(issue_id)
        .bind(org_id)
        .bind(status)
        .bind(limit)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as::<_, AgentSession>(
            "SELECT * FROM agent_sessions WHERE issue_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT $3"
        )
        .bind(issue_id)
        .bind(org_id)
        .bind(limit)
        .fetch_all(&pool)
        .await
    }
    .unwrap_or_default();

    let hints = if sessions.is_empty() {
        vec![ActionHint::recommended(
            "start_session",
            "No agent sessions yet. Start one to begin working on this issue.",
            Some("POST /agent-sessions"),
        )]
    } else {
        vec![]
    };

    Ok(Json(ApiResponse::with_hints(sessions, hints)))
}

// ── PATCH /agent-sessions/:id — Update session (status, summary, etc.) ──

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<UpdateAgentSession>,
) -> Result<Json<ApiResponse<AgentSession>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Fetch existing
    let existing = sqlx::query_as::<_, AgentSession>(
        "SELECT * FROM agent_sessions WHERE id = $1 AND org_id = $2"
    )
    .bind(session_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))))?;

    // Validate status transition
    if let Some(ref new_status) = body.status {
        if !VALID_STATUSES.contains(&new_status.as_str()) {
            return Err((StatusCode::BAD_REQUEST, Json(json!({
                "error": format!("Invalid status: '{}'. Valid values: {}", new_status, VALID_STATUSES.join(", ")),
                "accepted_values": VALID_STATUSES,
                "field": "status"
            }))));
        }
        // Can't go back from completed/error
        if (existing.status == "completed" || existing.status == "error") && new_status != "active" {
            return Err((StatusCode::BAD_REQUEST, Json(json!({
                "error": format!("Cannot transition from '{}' to '{}'. Start a new session instead.", existing.status, new_status),
                "_hints": [ActionHint::recommended("start_new_session", "Create a new session.", Some("POST /agent-sessions"))]
            }))));
        }
    }

    let new_status = body.status.as_deref().unwrap_or(&existing.status);
    let is_completing = (new_status == "completed" || new_status == "error") && existing.status != new_status;

    let session = sqlx::query_as::<_, AgentSession>(
        r#"
        UPDATE agent_sessions SET
            status = COALESCE($3, status),
            summary = COALESCE($4, summary),
            files_changed = COALESCE($5, files_changed),
            tests_status = COALESCE($6, tests_status),
            pr_url = COALESCE($7, pr_url),
            error_message = COALESCE($8, error_message),
            metadata = COALESCE($9, metadata),
            completed_at = CASE WHEN $3 IN ('completed', 'error') THEN NOW() ELSE completed_at END,
            updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        RETURNING *
        "#,
    )
    .bind(session_id)
    .bind(org_id)
    .bind(&body.status)
    .bind(&body.summary)
    .bind(&body.files_changed)
    .bind(&body.tests_status)
    .bind(&body.pr_url)
    .bind(&body.error_message)
    .bind(&body.metadata)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Update issue agent_status
    let issue_agent_status = match new_status {
        "completed" | "error" => None, // Clear agent_status when done
        other => Some(other.to_string()),
    };
    
    if is_completing {
        // Clear agent fields
        let _ = sqlx::query(
            "UPDATE issues SET agent_status = NULL, agent_session_id = NULL, updated_at = NOW() WHERE id = $1"
        )
        .bind(existing.issue_id)
        .execute(&pool)
        .await;
    } else if let Some(ref s) = issue_agent_status {
        let _ = sqlx::query(
            "UPDATE issues SET agent_status = $1, updated_at = NOW() WHERE id = $2"
        )
        .bind(s)
        .bind(existing.issue_id)
        .execute(&pool)
        .await;
    }

    // Log activity
    {
        let pool2 = pool.clone();
        let oid = org_id.to_string();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let iid = existing.issue_id;
        let pid = existing.project_id;
        let action = if is_completing {
            if new_status == "completed" { "agent_session_completed" } else { "agent_session_error" }
        } else {
            "agent_session_updated"
        };
        let old_s = existing.status.clone();
        let new_s = new_status.to_string();
        tokio::spawn(async move {
            log_activity(&pool2, &oid, Some(pid), Some(iid), &uid, uname.as_deref(),
                action, Some("status"), Some(&old_s), Some(&new_s), None).await;
        });
    }

    // Webhook for completion
    if is_completing {
        let event = if new_status == "completed" { "agent_session.completed" } else { "agent_session.error" };
        crate::routes::webhooks::dispatch_event(
            pool.clone(), org_id.to_string(), event,
            serde_json::to_value(&session).unwrap_or_default(),
        ).await;
    }

    // SSE broadcast
    let sse_event = if is_completing {
        if new_status == "completed" { "agent_session.completed" } else { "agent_session.error" }
    } else {
        "agent_session.updated"
    };
    broadcast_event(&sse_tx, org_id, sse_event, &serde_json::to_string(&session).unwrap_or_default());

    // ── Enqueue PR comment job if session just completed/errored and is publishable ──
    // The job re-validates is_public + pr_url + reads through pr_comment_id for idempotency.
    if is_completing && session.is_public && session.pr_url.is_some() {
        let payload = json!({"session_id": session.id.to_string()});
        if let Err(e) = sqlx::query(
            "INSERT INTO github_sync_jobs (job_type, payload, priority) VALUES ($1, $2, $3)"
        )
        .bind("post_run_comment")
        .bind(&payload)
        .bind(5_i32)
        .execute(&pool)
        .await
        {
            tracing::warn!(error = %e, session_id = %session.id, "failed to enqueue post_run_comment");
        }
    }

    let mut hints = vec![];
    if new_status == "completed" {
        hints.push(ActionHint::recommended(
            "move_to_review",
            "Agent session completed. Move the issue to 'in_review'.",
            Some(&format!("PATCH /issues/{}", existing.issue_id)),
        ));
        hints.push(ActionHint::optional(
            "add_tldr",
            "Post a TLDR summarizing the work done.",
            Some(&format!("POST /issues/{}/tldr", existing.issue_id)),
        ));
    } else if new_status == "awaiting_input" {
        hints.push(ActionHint::recommended(
            "add_comment",
            "Agent needs human input. Add a comment explaining what's needed.",
            Some(&format!("POST /issues/{}/comments", existing.issue_id)),
        ));
    }

    Ok(Json(ApiResponse::with_hints(session, hints)))
}

// ── POST /agent-sessions/:id/publish — Make a session publicly shareable ──

pub async fn publish(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<ApiResponse<AgentSession>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Org-level guardrail (BAA / SA-A): public agent runs must be explicitly enabled per org.
    let org_enabled: bool = sqlx::query_scalar(
        "SELECT agent_runs_public_enabled FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .unwrap_or(false);

    if !org_enabled {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "agent_runs_public_disabled",
                "message": "Public agent runs are disabled for this organization. An admin must enable them in org settings."
            })),
        ));
    }

    let existing = sqlx::query_as::<_, AgentSession>(
        "SELECT * FROM agent_sessions WHERE id = $1 AND org_id = $2"
    )
    .bind(session_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))))?;

    let token = existing.public_token.unwrap_or_else(new_public_token);

    let session = sqlx::query_as::<_, AgentSession>(
        r#"
        UPDATE agent_sessions SET
            is_public = TRUE,
            public_token = $3,
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        RETURNING *
        "#,
    )
    .bind(session_id)
    .bind(org_id)
    .bind(&token)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    broadcast_event(&sse_tx, org_id, "agent_session.updated", &serde_json::to_string(&session).unwrap_or_default());

    // If the session is already in a terminal state when publish is called,
    // enqueue the PR comment immediately. (The normal path is publish → run →
    // complete, which fires from `update`. This handles the inverse ordering.)
    if matches!(session.status.as_str(), "completed" | "error") && session.pr_url.is_some() {
        let payload = json!({"session_id": session.id.to_string()});
        if let Err(e) = sqlx::query(
            "INSERT INTO github_sync_jobs (job_type, payload, priority) VALUES ($1, $2, $3)"
        )
        .bind("post_run_comment")
        .bind(&payload)
        .bind(5_i32)
        .execute(&pool)
        .await
        {
            tracing::warn!(error = %e, session_id = %session.id, "failed to enqueue post_run_comment from publish");
        }
    }

    let hints = vec![ActionHint::recommended(
        "share_public_run",
        "Agent run is public. Share the Run Card URL with reviewers.",
        Some(&format!("/r/{}", token)),
    )];

    Ok(Json(ApiResponse::with_hints(session, hints)))
}

// ── DELETE /agent-sessions/:id/publish — Hide a public session ──

pub async fn unpublish(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<ApiResponse<AgentSession>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let session = sqlx::query_as::<_, AgentSession>(
        r#"
        UPDATE agent_sessions SET
            is_public = FALSE,
            published_at = NULL,
            updated_at = NOW()
        WHERE id = $1 AND org_id = $2
        RETURNING *
        "#,
    )
    .bind(session_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))))?;

    broadcast_event(&sse_tx, org_id, "agent_session.updated", &serde_json::to_string(&session).unwrap_or_default());

    Ok(Json(ApiResponse::new(session)))
}

// ── POST /agent-sessions/:id/steps — Post a progress step ──

pub async fn create_step(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<CreateAgentStep>,
) -> Result<Json<ApiResponse<AgentStep>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify session belongs to org and is active
    let session = sqlx::query_as::<_, AgentSession>(
        "SELECT * FROM agent_sessions WHERE id = $1 AND org_id = $2"
    )
    .bind(session_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))))?;

    if session.status == "completed" || session.status == "error" {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Session is '{}'. Cannot add steps to a finished session.", session.status),
            "_hints": [ActionHint::recommended("start_new_session", "Create a new session.", Some("POST /agent-sessions"))]
        }))));
    }

    let step_type = body.step_type.as_deref().unwrap_or("info");
    if !VALID_STEP_TYPES.contains(&step_type) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Invalid step_type: '{}'. Valid values: {}", step_type, VALID_STEP_TYPES.join(", ")),
            "accepted_values": VALID_STEP_TYPES,
            "field": "step_type"
        }))));
    }

    let meta = body.metadata.unwrap_or(json!({}));

    let step = sqlx::query_as::<_, AgentStep>(
        r#"
        INSERT INTO agent_steps (session_id, issue_id, step_type, message, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(session_id)
    .bind(session.issue_id)
    .bind(step_type)
    .bind(&body.message)
    .bind(&meta)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Touch session updated_at
    let _ = sqlx::query("UPDATE agent_sessions SET updated_at = NOW() WHERE id = $1")
        .bind(session_id)
        .execute(&pool)
        .await;

    // Also touch issue updated_at so kanban shows activity
    let _ = sqlx::query("UPDATE issues SET updated_at = NOW() WHERE id = $1")
        .bind(session.issue_id)
        .execute(&pool)
        .await;

    // SSE broadcast — enables live stream without DB polling
    broadcast_event(&sse_tx, org_id, "agent_session.step", &serde_json::to_string(&step).unwrap_or_default());

    Ok(Json(ApiResponse::new(step)))
}

// ── GET /agent-sessions/:id/steps — List steps for a session ──

#[derive(Debug, Deserialize)]
pub struct StepsParams {
    pub after: Option<String>, // ISO timestamp — only return steps after this time
    pub limit: Option<i64>,
}

pub async fn list_steps(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
    Query(params): Query<StepsParams>,
) -> Result<Json<ApiResponse<Vec<AgentStep>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify access
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE id = $1 AND org_id = $2)"
    )
    .bind(session_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))));
    }

    let limit = params.limit.unwrap_or(100);

    let steps = if let Some(ref after) = params.after {
        let ts = after.parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid 'after' timestamp. Use ISO 8601 format."}))))?;
        sqlx::query_as::<_, AgentStep>(
            "SELECT * FROM agent_steps WHERE session_id = $1 AND created_at > $2 ORDER BY created_at ASC LIMIT $3"
        )
        .bind(session_id)
        .bind(ts)
        .bind(limit)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as::<_, AgentStep>(
            "SELECT * FROM agent_steps WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2"
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(&pool)
        .await
    }
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(steps)))
}

// ── GET /public/runs/:token — Public Run Card payload ──

pub async fn get_public_run(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<ApiResponse<PublicRunResponse>>, (StatusCode, Json<serde_json::Value>)> {
    let session = sqlx::query_as::<_, AgentSession>(
        "SELECT * FROM agent_sessions WHERE public_token = $1 AND is_public = TRUE"
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Public run not found"}))))?;

    let ctx = sqlx::query_as::<_, PublicRunContext>(
        r#"
        SELECT
            i.display_id,
            i.title,
            i.status,
            i.priority,
            i.source,
            i.created_at AS issue_created_at,
            i.updated_at AS issue_updated_at,
            p.name AS project_name,
            p.slug AS project_slug,
            p.prefix AS project_prefix
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1 AND p.id = $2
        "#,
    )
    .bind(session.issue_id)
    .bind(session.project_id)
    .fetch_one(&pool)
    .await
    .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({"error": "Public run not found"}))))?;

    let steps = sqlx::query_as::<_, AgentStep>(
        "SELECT * FROM agent_steps WHERE session_id = $1 ORDER BY created_at ASC LIMIT 200"
    )
    .bind(session.id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|step| PublicRunStep {
        step_type: step.step_type,
        message: step.message,
        created_at: step.created_at,
    })
    .collect();

    let latest_tldr = sqlx::query_as::<_, Tldr>(
        "SELECT * FROM tldrs WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 1"
    )
    .bind(session.issue_id)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None)
    .map(|tldr| PublicRunTldr {
        agent_name: tldr.agent_name,
        summary: tldr.summary,
        files_changed: tldr.files_changed,
        tests_status: tldr.tests_status,
        pr_url: tldr.pr_url,
        created_at: tldr.created_at,
    });

    let public_token = session.public_token.clone().unwrap_or(token);
    let response = PublicRunResponse {
        session: PublicRunSession {
            public_token,
            agent_name: session.agent_name,
            agent_id: session.agent_id,
            status: session.status,
            started_at: session.started_at,
            completed_at: session.completed_at,
            summary: session.summary,
            files_changed: session.files_changed,
            tests_status: session.tests_status,
            pr_url: session.pr_url,
            published_at: session.published_at,
            created_at: session.created_at,
            updated_at: session.updated_at,
        },
        issue: PublicRunIssue {
            display_id: ctx.display_id,
            title: ctx.title,
            status: ctx.status,
            priority: ctx.priority,
            source: ctx.source,
            created_at: ctx.issue_created_at,
            updated_at: ctx.issue_updated_at,
        },
        project: PublicRunProject {
            name: ctx.project_name,
            slug: ctx.project_slug,
            prefix: ctx.project_prefix,
        },
        steps,
        latest_tldr,
    };

    Ok(Json(ApiResponse::new(response)))
}

// ── GET /agent-sessions/:id/stream — SSE live stream of steps ──

pub async fn stream_steps(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(session_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?
        .to_string();

    // Verify access
    let session = sqlx::query_as::<_, AgentSession>(
        "SELECT * FROM agent_sessions WHERE id = $1 AND org_id = $2"
    )
    .bind(session_id)
    .bind(&org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Agent session not found"}))))?;

    let pool = pool.clone();
    let sid = session_id;

    let stream = async_stream::stream! {
        let mut last_ts = session.created_at;
        let mut tick_count = 0u64;

        loop {
            // Poll for new steps
            let new_steps = sqlx::query_as::<_, AgentStep>(
                "SELECT * FROM agent_steps WHERE session_id = $1 AND created_at > $2 ORDER BY created_at ASC LIMIT 50"
            )
            .bind(sid)
            .bind(last_ts)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

            for step in &new_steps {
                let data = serde_json::to_string(&step).unwrap_or_default();
                yield Ok(Event::default().event("step").data(data));
                last_ts = step.created_at;
            }

            // Check if session is still active
            let current_status: Option<String> = sqlx::query_scalar(
                "SELECT status FROM agent_sessions WHERE id = $1"
            )
            .bind(sid)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);

            match current_status.as_deref() {
                Some("completed") => {
                    yield Ok(Event::default().event("done").data(r#"{"status":"completed"}"#));
                    break;
                }
                Some("error") => {
                    yield Ok(Event::default().event("done").data(r#"{"status":"error"}"#));
                    break;
                }
                None => break, // Session deleted
                _ => {}
            }

            // Heartbeat every 5 polls
            tick_count += 1;
            if tick_count % 5 == 0 {
                yield Ok(Event::default().event("heartbeat").data("{}"));
            }

            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    ))
}
