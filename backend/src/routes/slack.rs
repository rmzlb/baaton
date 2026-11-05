use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
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
    // Spans every project of the org: refused to a project-limited key (BAA-36).
    crate::routes::issue_scope::require_org_wide(&auth)?;
    let org_id = auth.org_id.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Organization required"})),
        )
    })?;

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
    // Spans every project of the org: refused to a project-limited key (BAA-36).
    crate::routes::issue_scope::require_org_wide(&auth)?;
    let org_id = auth.org_id.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Organization required"})),
        )
    })?;

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
    // Spans every project of the org: refused to a project-limited key (BAA-36).
    crate::routes::issue_scope::require_org_wide(&auth)?;
    let org_id = auth.org_id.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Organization required"})),
        )
    })?;

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
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Integration not found"})),
        )
    })?;

    Ok(Json(ApiResponse::new(integration)))
}

/// DELETE /integrations/slack/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Spans every project of the org: refused to a project-limited key (BAA-36).
    crate::routes::issue_scope::require_org_wide(&auth)?;
    let org_id = auth.org_id.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Organization required"})),
        )
    })?;

    sqlx::query("DELETE FROM slack_integrations WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;

    Ok(Json(json!({"deleted": true})))
}

fn verify_slack_signature(
    headers: &axum::http::HeaderMap,
    raw_body: &[u8],
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let signing_secret = std::env::var("SLACK_SIGNING_SECRET")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "Slack integration is not configured (missing SLACK_SIGNING_SECRET)"})),
            )
        })?;

    let timestamp_str = headers
        .get("x-slack-request-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Missing X-Slack-Request-Timestamp header"})),
            )
        })?;

    let timestamp: i64 = timestamp_str.parse().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid X-Slack-Request-Timestamp header"})),
        )
    })?;

    let now = chrono::Utc::now().timestamp();
    if (now - timestamp).abs() > 300 {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Slack request timestamp expired"})),
        ));
    }

    let sig_header = headers
        .get("x-slack-signature")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("v0="))
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Missing or invalid X-Slack-Signature header"})),
            )
        })?;

    let sig_bytes = hex::decode(sig_header).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid X-Slack-Signature hex"})),
        )
    })?;

    let mut mac = Hmac::<Sha256>::new_from_slice(signing_secret.as_bytes()).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to initialize HMAC"})),
        )
    })?;
    mac.update(b"v0:");
    mac.update(timestamp_str.as_bytes());
    mac.update(b":");
    mac.update(raw_body);

    mac.verify_slice(&sig_bytes).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid Slack signature"})),
        )
    })
}

/// POST /integrations/slack/command — handle Slack slash command
/// This is a public endpoint (Slack sends webhooks directly)
pub async fn handle_command(
    State(pool): State<PgPool>,
    headers: axum::http::HeaderMap,
    raw_body: axum::body::Bytes,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    verify_slack_signature(&headers, &raw_body)?;

    use axum::extract::FromRequest;
    let req = axum::http::Request::builder()
        .method(axum::http::Method::POST)
        .header(
            axum::http::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(axum::body::Body::from(raw_body))
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid request body"})),
            )
        })?;
    let axum::extract::Form(form) =
        axum::extract::Form::<std::collections::HashMap<String, String>>::from_request(req, &())
            .await
            .map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Invalid form payload"})),
                )
            })?;

    let team_id = form.get("team_id").cloned().unwrap_or_default();
    let text = form.get("text").cloned().unwrap_or_default();
    let user_name = form.get("user_name").cloned().unwrap_or_default();
    let channel_id = form.get("channel_id").cloned().unwrap_or_default();

    // Look up integration
    let integration = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT org_id, channel_mappings FROM slack_integrations WHERE team_id = $1 LIMIT 1",
    )
    .bind(&team_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let Some((org_id, mappings)) = integration else {
        return Ok(Json(json!({
            "response_type": "ephemeral",
            "text": "Baaton is not configured for this workspace. Visit baaton.dev to set up."
        })));
    };

    // Find project for this channel
    let project_id = mappings
        .get(&channel_id)
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
        "SELECT COALESCE(MAX(issue_number), 0) + 1 FROM issues WHERE project_id = $1",
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

    let _issue_id: uuid::Uuid = sqlx::query_scalar(
        r#"INSERT INTO issues (project_id, org_id, title, status, priority, issue_type, issue_number, display_id, source)
           VALUES ($1, $2, $3, 'backlog', 'medium', 'feature', $4, $5, 'slack')
           RETURNING id"#,
    )
    .bind(pid)
    .bind(&org_id)
    .bind(&text)
    .bind(issue_number.0)
    .bind(&display_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({
        "response_type": "in_channel",
        "text": format!("✅ Created {} — {}\nby @{}", display_id, text, user_name)
    })))
}
