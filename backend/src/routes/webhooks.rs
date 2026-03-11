use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

// ─── Event types ────────────────────────────────────

pub const VALID_EVENT_TYPES: &[&str] = &[
    "issue.created",
    "issue.updated",
    "issue.deleted",
    "comment.created",
    "comment.deleted",
    "status.changed",
];

// ─── Models ─────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Webhook {
    pub id: Uuid,
    pub org_id: String,
    pub url: String,
    pub event_types: Vec<String>,
    /// Secret is always masked after creation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    pub enabled: bool,
    pub failure_count: i32,
    pub last_error: Option<String>,
    pub last_delivered_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WebhookPublic {
    pub id: Uuid,
    pub org_id: String,
    pub url: String,
    pub event_types: Vec<String>,
    pub enabled: bool,
    pub failure_count: i32,
    pub last_error: Option<String>,
    pub last_delivered_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub url: String,
    #[serde(default)]
    pub event_types: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWebhookRequest {
    pub url: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

// ─── Helpers ────────────────────────────────────────

fn generate_webhook_secret() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    format!("whsec_{}", hex::encode(bytes))
}

fn validate_event_types(types: &[String]) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    for et in types {
        if !VALID_EVENT_TYPES.contains(&et.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": format!("Invalid event type '{}'. Valid types: {}", et, VALID_EVENT_TYPES.join(", ")),
                    "valid_event_types": VALID_EVENT_TYPES,
                })),
            ));
        }
    }
    Ok(())
}

// ─── Dispatcher ─────────────────────────────────────

/// Dispatch an event to all enabled webhooks for the org.
/// Fire-and-forget: errors are logged but not propagated.
pub async fn dispatch_event(pool: PgPool, org_id: String, event_type: &str, payload: serde_json::Value) {
    let event_type = event_type.to_string();
    tokio::spawn(async move {
        let hooks = sqlx::query_as::<_, (Uuid, String, String)>(
            "SELECT id, url, secret FROM webhooks WHERE org_id = $1 AND enabled = true AND $2 = ANY(event_types)"
        )
        .bind(&org_id)
        .bind(&event_type)
        .fetch_all(&pool)
        .await;

        let hooks = match hooks {
            Ok(h) => h,
            Err(e) => {
                tracing::error!(error = %e, "webhooks.dispatch: failed to fetch hooks");
                return;
            }
        };

        if hooks.is_empty() {
            return;
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        let body = json!({
            "event": event_type,
            "data": payload,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        let body_str = serde_json::to_string(&body).unwrap_or_default();

        for (hook_id, url, secret) in hooks {
            // Compute HMAC-SHA256 signature
            let signature = compute_signature(&secret, &body_str);

            let result = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("X-Baaton-Signature", &signature)
                .header("X-Baaton-Event", &event_type)
                .body(body_str.clone())
                .send()
                .await;

            match result {
                Ok(resp) if resp.status().is_success() => {
                    let _ = sqlx::query(
                        "UPDATE webhooks SET last_delivered_at = now(), failure_count = 0, last_error = NULL, updated_at = now() WHERE id = $1"
                    )
                    .bind(hook_id)
                    .execute(&pool)
                    .await;
                    tracing::debug!(hook_id = %hook_id, url = %url, "webhooks.dispatch: delivered");
                }
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let err_msg = format!("HTTP {}", status);
                    let _ = sqlx::query(
                        "UPDATE webhooks SET failure_count = failure_count + 1, last_error = $2, updated_at = now() WHERE id = $1"
                    )
                    .bind(hook_id)
                    .bind(&err_msg)
                    .execute(&pool)
                    .await;
                    tracing::warn!(hook_id = %hook_id, url = %url, status = status, "webhooks.dispatch: non-2xx");
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    let _ = sqlx::query(
                        "UPDATE webhooks SET failure_count = failure_count + 1, last_error = $2, updated_at = now() WHERE id = $1"
                    )
                    .bind(hook_id)
                    .bind(&err_msg)
                    .execute(&pool)
                    .await;
                    tracing::warn!(hook_id = %hook_id, url = %url, error = %e, "webhooks.dispatch: network error");
                }
            }
        }
    });
}

fn compute_signature(secret: &str, body: &str) -> String {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(body.as_bytes());
    let result = mac.finalize();
    format!("sha256={}", hex::encode(result.into_bytes()))
}

// ─── Route handlers ─────────────────────────────────

/// POST /api/v1/webhooks
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.url.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "URL is required"}))));
    }
    if !body.url.starts_with("http://") && !body.url.starts_with("https://") {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "URL must start with http:// or https://"}))));
    }

    validate_event_types(&body.event_types)?;

    let event_types = if body.event_types.is_empty() {
        VALID_EVENT_TYPES.iter().map(|s| s.to_string()).collect::<Vec<_>>()
    } else {
        body.event_types
    };

    let secret = generate_webhook_secret();

    let hook = sqlx::query_as::<_, Webhook>(
        r#"
        INSERT INTO webhooks (org_id, url, event_types, secret)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(body.url.trim())
    .bind(&event_types)
    .bind(&secret)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tracing::info!(user_id = %auth.user_id, org_id = org_id, hook_id = %hook.id, "webhooks.create");

    // Return with the secret on creation only
    Ok(Json(json!({
        "data": {
            "id": hook.id,
            "org_id": hook.org_id,
            "url": hook.url,
            "event_types": hook.event_types,
            "secret": secret,
            "enabled": hook.enabled,
            "failure_count": hook.failure_count,
            "last_error": hook.last_error,
            "last_delivered_at": hook.last_delivered_at,
            "created_at": hook.created_at,
            "updated_at": hook.updated_at,
        }
    })))
}

/// GET /api/v1/webhooks
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<WebhookPublic>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let hooks = sqlx::query_as::<_, WebhookPublic>(
        "SELECT id, org_id, url, event_types, enabled, failure_count, last_error, last_delivered_at, created_at, updated_at FROM webhooks WHERE org_id = $1 ORDER BY created_at DESC"
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(hooks)))
}

/// GET /api/v1/webhooks/:id
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<WebhookPublic>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let hook = sqlx::query_as::<_, WebhookPublic>(
        "SELECT id, org_id, url, event_types, enabled, failure_count, last_error, last_delivered_at, created_at, updated_at FROM webhooks WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Webhook not found"}))))?;

    Ok(Json(ApiResponse::new(hook)))
}

/// PATCH /api/v1/webhooks/:id
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateWebhookRequest>,
) -> Result<Json<ApiResponse<WebhookPublic>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify ownership
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM webhooks WHERE id = $1 AND org_id = $2)")
        .bind(id)
        .bind(org_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Webhook not found"}))));
    }

    if let Some(ref url) = body.url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "URL must start with http:// or https://"}))));
        }
    }

    if let Some(ref types) = body.event_types {
        validate_event_types(types)?;
    }

    let hook = sqlx::query_as::<_, WebhookPublic>(
        r#"
        UPDATE webhooks SET
            url = COALESCE($2, url),
            event_types = COALESCE($3, event_types),
            enabled = COALESCE($4, enabled),
            updated_at = now()
        WHERE id = $1 AND org_id = $5
        RETURNING id, org_id, url, event_types, enabled, failure_count, last_error, last_delivered_at, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(&body.url)
    .bind(&body.event_types)
    .bind(body.enabled)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(hook)))
}

/// DELETE /api/v1/webhooks/:id
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query("DELETE FROM webhooks WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Webhook not found"}))));
    }

    tracing::info!(user_id = %auth.user_id, hook_id = %id, "webhooks.remove");

    Ok(Json(ApiResponse::new(())))
}
