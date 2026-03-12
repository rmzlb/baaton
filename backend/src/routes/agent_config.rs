use axum::{extract::{Extension, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AgentConfig {
    pub id: Uuid,
    pub org_id: String,
    pub user_id: String,
    pub agent_name: String,

    pub heartbeat_enabled: bool,
    pub heartbeat_cron: Option<String>,

    pub auto_triage_enabled: bool,
    pub auto_triage_cron: Option<String>,
    pub auto_triage_auto_apply: bool,

    pub email_recap_enabled: bool,
    pub email_recap_cron: Option<String>,
    pub email_recap_to: Option<String>,

    pub analytics_digest_enabled: bool,
    pub analytics_digest_cron: Option<String>,

    pub suggest_automations: bool,

    pub allowed_project_ids: Vec<Uuid>,
    pub max_actions_per_run: i32,
    pub require_approval: bool,

    pub last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_triage_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_recap_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentConfig {
    pub agent_name: Option<String>,

    pub heartbeat_enabled: Option<bool>,
    pub heartbeat_cron: Option<String>,

    pub auto_triage_enabled: Option<bool>,
    pub auto_triage_cron: Option<String>,
    pub auto_triage_auto_apply: Option<bool>,

    pub email_recap_enabled: Option<bool>,
    pub email_recap_cron: Option<String>,
    pub email_recap_to: Option<String>,

    pub analytics_digest_enabled: Option<bool>,
    pub analytics_digest_cron: Option<String>,

    pub suggest_automations: Option<bool>,

    pub allowed_project_ids: Option<Vec<Uuid>>,
    pub max_actions_per_run: Option<i32>,
    pub require_approval: Option<bool>,
}

/// GET /agent-config — get or create agent config for current user+org
pub async fn get_config(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<AgentConfig>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Upsert: create default config if not exists
    let config = sqlx::query_as::<_, AgentConfig>(
        r#"
        INSERT INTO agent_configs (org_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (org_id, user_id) DO UPDATE SET updated_at = now()
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(config)))
}

/// PATCH /agent-config — update agent config
pub async fn update_config(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<UpdateAgentConfig>,
) -> Result<Json<ApiResponse<AgentConfig>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Validate cron expressions
    for cron in [&body.heartbeat_cron, &body.auto_triage_cron, &body.email_recap_cron, &body.analytics_digest_cron] {
        if let Some(c) = cron {
            if c.split_whitespace().count() != 5 {
                return Err((StatusCode::BAD_REQUEST, Json(json!({
                    "error": format!("Invalid cron expression: '{c}'. Expected 5 fields (min hour dom month dow)"),
                    "remediation": "Use standard cron format: '0 9 * * 1-5' (weekdays 9am)"
                }))));
            }
        }
    }

    // Guard: max_actions_per_run between 1-100
    if let Some(max) = body.max_actions_per_run {
        if max < 1 || max > 100 {
            return Err((StatusCode::BAD_REQUEST, Json(json!({
                "error": "max_actions_per_run must be between 1 and 100",
                "accepted_values": [1, 5, 10, 25, 50, 100]
            }))));
        }
    }

    let config = sqlx::query_as::<_, AgentConfig>(
        r#"
        INSERT INTO agent_configs (org_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (org_id, user_id) DO NOTHING;

        UPDATE agent_configs SET
            agent_name = COALESCE($3, agent_name),
            heartbeat_enabled = COALESCE($4, heartbeat_enabled),
            heartbeat_cron = COALESCE($5, heartbeat_cron),
            auto_triage_enabled = COALESCE($6, auto_triage_enabled),
            auto_triage_cron = COALESCE($7, auto_triage_cron),
            auto_triage_auto_apply = COALESCE($8, auto_triage_auto_apply),
            email_recap_enabled = COALESCE($9, email_recap_enabled),
            email_recap_cron = COALESCE($10, email_recap_cron),
            email_recap_to = COALESCE($11, email_recap_to),
            analytics_digest_enabled = COALESCE($12, analytics_digest_enabled),
            analytics_digest_cron = COALESCE($13, analytics_digest_cron),
            suggest_automations = COALESCE($14, suggest_automations),
            allowed_project_ids = COALESCE($15, allowed_project_ids),
            max_actions_per_run = COALESCE($16, max_actions_per_run),
            require_approval = COALESCE($17, require_approval),
            updated_at = now()
        WHERE org_id = $1 AND user_id = $2
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(&auth.user_id)
    .bind(&body.agent_name)
    .bind(body.heartbeat_enabled)
    .bind(&body.heartbeat_cron)
    .bind(body.auto_triage_enabled)
    .bind(&body.auto_triage_cron)
    .bind(body.auto_triage_auto_apply)
    .bind(body.email_recap_enabled)
    .bind(&body.email_recap_cron)
    .bind(&body.email_recap_to)
    .bind(body.analytics_digest_enabled)
    .bind(&body.analytics_digest_cron)
    .bind(body.suggest_automations)
    .bind(&body.allowed_project_ids)
    .bind(body.max_actions_per_run)
    .bind(body.require_approval)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(config)))
}
