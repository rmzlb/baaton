use axum::{extract::{Extension, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SlackIntegration {
    pub id: uuid::Uuid,
    pub org_id: String,
    pub team_id: String,
    pub team_name: Option<String>,
    pub channel_mappings: serde_json::Value,
    pub webhook_url: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSlackIntegration {
    pub team_id: String,
    pub team_name: Option<String>,
    pub bot_token: String,
    pub webhook_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelMapping {
    pub channel_mappings: serde_json::Value,
}

/// GET /integrations/slack — list slack integrations
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<SlackIntegration>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let integrations = sqlx::query_as::<_, SlackIntegration>(
        "SELECT id, org_id, team_id, team_name, channel_mappings, webhook_url, created_at FROM slack_integrations WHERE org_id = $1"
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(integrations)))
}

/// POST /integrations/slack — add slack integration
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateSlackIntegration>,
) -> Result<Json<ApiResponse<SlackIntegration>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let integration = sqlx::query_as::<_, SlackIntegration>(
        r#"INSERT INTO slack_integrations (org_id, team_id, team_name, bot_token, webhook_url)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (org_id, team_id) DO UPDATE SET bot_token = $4, team_name = $3, webhook_url = $5
           RETURNING id, org_id, team_id, team_name, channel_mappings, webhook_url, created_at"#,
    )
    .bind(org_id)
    .bind(&body.team_id)
    .bind(&body.team_name)
    .bind(&body.bot_token)
    .bind(&body.webhook_url)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(integration)))
}

/// PATCH /integrations/slack/{id}/channels — update channel mappings
pub async fn update_channels(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
    Json(body): Json<UpdateChannelMapping>,
) -> Result<Json<ApiResponse<SlackIntegration>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let integration = sqlx::query_as::<_, SlackIntegration>(
        r#"UPDATE slack_integrations SET channel_mappings = $3
           WHERE id = $1 AND org_id = $2
           RETURNING id, org_id, team_id, team_name, channel_mappings, webhook_url, created_at"#,
    )
    .bind(id)
    .bind(org_id)
    .bind(&body.channel_mappings)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Integration not found"}))))?;

    Ok(Json(ApiResponse::new(integration)))
}

/// DELETE /integrations/slack/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    sqlx::query("DELETE FROM slack_integrations WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({"deleted": true})))
}

/// POST /integrations/slack/command — handle Slack slash command
/// This is a public endpoint (Slack sends webhooks directly)
pub async fn handle_command(
    State(pool): State<PgPool>,
    axum::extract::Form(form): axum::extract::Form<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let team_id = form.get("team_id").cloned().unwrap_or_default();
    let text = form.get("text").cloned().unwrap_or_default();
    let user_name = form.get("user_name").cloned().unwrap_or_default();
    let channel_id = form.get("channel_id").cloned().unwrap_or_default();

    // Look up integration
    let integration = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT org_id, channel_mappings FROM slack_integrations WHERE team_id = $1 LIMIT 1"
    )
    .bind(&team_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let Some((org_id, mappings)) = integration else {
        return Ok(Json(json!({
            "response_type": "ephemeral",
            "text": "Baaton is not configured for this workspace. Visit baaton.dev to set up."
        })));
    };

    // Find project for this channel
    let project_id = mappings.get(&channel_id)
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if project_id.is_empty() {
        return Ok(Json(json!({
            "response_type": "ephemeral",
            "text": "No Baaton project mapped to this channel. Configure in Baaton settings."
        })));
    }

    if text.is_empty() {
        return Ok(Json(json!({
            "response_type": "ephemeral",
            "text": "Usage: /baaton [issue title]"
        })));
    }

    // Create issue
    let pid: uuid::Uuid = project_id.parse().unwrap_or_default();
    let issue_number: (i32,) = sqlx::query_as(
        "SELECT COALESCE(MAX(issue_number), 0) + 1 FROM issues WHERE project_id = $1"
    )
    .bind(pid)
    .fetch_one(&pool)
    .await
    .unwrap_or((1,));

    let prefix: (String,) = sqlx::query_as("SELECT prefix FROM projects WHERE id = $1")
        .bind(pid)
        .fetch_one(&pool)
        .await
        .unwrap_or(("UNK".into(),));

    let display_id = format!("{}-{}", prefix.0, issue_number.0);

    sqlx::query(
        r#"INSERT INTO issues (project_id, org_id, title, status, priority, issue_type, issue_number, display_id, source)
           VALUES ($1, $2, $3, 'backlog', 'medium', 'feature', $4, $5, 'slack')"#,
    )
    .bind(pid)
    .bind(&org_id)
    .bind(&text)
    .bind(issue_number.0)
    .bind(&display_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({
        "response_type": "in_channel",
        "text": format!("✅ Created {} — {}\nby @{}", display_id, text, user_name)
    })))
}
