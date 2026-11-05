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
use crate::routes::issue_scope;

// ─── Event types ────────────────────────────────────

pub const VALID_EVENT_TYPES: &[&str] = &[
    // Issues
    "issue.created",
    "issue.updated",
    "issue.deleted",
    "issue.archived",
    "issue.unarchived",
    // Comments
    "comment.created",
    "comment.deleted",
    // Status
    "status.changed",
    // Projects
    "project.created",
    "project.updated",
    "project.deleted",
    // Milestones
    "milestone.created",
    "milestone.updated",
    "milestone.completed",
    // Sprints
    "sprint.created",
    "sprint.completed",
    // TLDRs
    "tldr.created",
    // Approval
    "approval.requested",
    "approval.responded",
];

// ─── Models ─────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Webhook {
    pub id: Uuid,
    pub org_id: String,
    pub url: String,
    pub event_types: Vec<String>,
    /// Projects whose events are delivered; empty = the whole organization.
    pub project_ids: Vec<Uuid>,
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
    pub project_ids: Vec<Uuid>,
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
    /// Only deliver events of these projects; empty = the whole organization.
    #[serde(default)]
    pub project_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWebhookRequest {
    pub url: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub enabled: Option<bool>,
    pub project_ids: Option<Vec<Uuid>>,
}

// ─── Helpers ────────────────────────────────────────

fn generate_webhook_secret() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    format!("whsec_{}", hex::encode(bytes))
}

fn is_disallowed_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || octets[0] == 0
                // CGNAT / Tailscale (100.64.0.0/10)
                || (octets[0] == 100 && (octets[1] & 0b1100_0000) == 64)
                // IETF protocol / documentation / benchmarking / reserved ranges
                || (octets[0] == 192 && octets[1] == 0 && (octets[2] == 0 || octets[2] == 2))
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                || (octets[0] & 0xf0) == 240
        }
        std::net::IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_disallowed_ip(std::net::IpAddr::V4(v4));
            }
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Unique local (fc00::/7)
                || (seg0 & 0xfe00) == 0xfc00
                // Link-local (fe80::/10)
                || (seg0 & 0xffc0) == 0xfe80
        }
    }
}

pub(crate) fn validate_webhook_url(raw: &str) -> Result<reqwest::Url, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL is required");
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "Invalid webhook URL")?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("URL must start with http:// or https://");
    }

    let host_str = parsed
        .host_str()
        .ok_or("Webhook URL must have a valid host")?;
    let host_lower = host_str.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();

    if host_lower == "localhost"
        || host_lower.ends_with(".localhost")
        || host_lower.ends_with(".local")
        || host_lower.ends_with(".internal")
        || host_lower.ends_with(".ts.net")
    {
        return Err("Webhook URL host is not allowed");
    }

    if let Ok(ip) = host_lower.parse::<std::net::IpAddr>() {
        if is_disallowed_ip(ip) {
            return Err("Webhook URL IP address is not allowed");
        }
    }

    Ok(parsed)
}

pub(crate) async fn resolve_and_check_public_ip(url: &reqwest::Url) -> Result<(), &'static str> {
    let host = url
        .host_str()
        .ok_or("Webhook URL must have a valid host")?
        .trim_matches(|c| c == '[' || c == ']');
    let port = url.port_or_known_default().unwrap_or(443);

    let addrs = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| "Failed to resolve webhook URL host")?;

    let mut found = false;
    for addr in addrs {
        found = true;
        if is_disallowed_ip(addr.ip()) {
            return Err("Webhook URL resolves to a private or disallowed IP address");
        }
    }

    if !found {
        return Err("Webhook URL host did not resolve to any IP address");
    }

    Ok(())
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

/// Validate a webhook's project filter against the caller (BAA-36).
///
/// Every listed project must belong to the webhook's org and be within the
/// caller's scope (404 otherwise, like any out-of-scope project). A caller
/// limited to some projects must list a non-empty subset of them: a key limited
/// to project A cannot subscribe an endpoint to the whole organization (403).
async fn validate_project_filter(
    pool: &PgPool,
    auth: &AuthUser,
    org_id: &str,
    project_ids: &[Uuid],
) -> Result<Vec<Uuid>, (StatusCode, Json<serde_json::Value>)> {
    let mut unique: Vec<Uuid> = Vec::with_capacity(project_ids.len());
    for id in project_ids {
        if !unique.contains(id) {
            unique.push(*id);
        }
    }
    for id in &unique {
        let owner = issue_scope::require_project(pool, auth, *id).await?;
        if owner != org_id {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Project not found"})),
            ));
        }
    }
    if !issue_scope::delegates_within_scope(auth, &unique) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "An API key limited to projects can only manage webhooks limited to those projects: set project_ids to some of them"
            })),
        ));
    }
    Ok(unique)
}

/// SQL predicate (on `webhooks`) for the hooks a caller may see and manage:
/// all of the org for an unscoped caller, otherwise only hooks limited to a
/// subset of the caller's projects. `$param` binds `auth.scoped_project_ids`.
fn visible_to_caller(param: u8) -> String {
    issue_scope::sql_delegated_within_scope("project_ids", param)
}

// ─── Retry backoff ──────────────────────────────────

/// Retry intervals: 1 min, 15 min, 1 hour, 6 hours
fn retry_delay_seconds(attempt: i32) -> i64 {
    match attempt {
        1 => 60,           // 1 minute
        2 => 900,          // 15 minutes
        3 => 3600,         // 1 hour
        _ => 21600,        // 6 hours
    }
}

// ─── Dispatcher (with delivery log + retry) ─────────

/// Dispatch an event to all enabled webhooks for the org.
/// Creates delivery records for each webhook for retry tracking.
///
/// `project_id` is the project the event belongs to. A webhook limited to some
/// projects only receives their events; an event with no project (`None`) only
/// reaches webhooks that cover the whole organization.
pub async fn dispatch_event(
    pool: PgPool,
    org_id: String,
    project_id: Option<Uuid>,
    event_type: &str,
    payload: serde_json::Value,
) {
    let event_type = event_type.to_string();
    tokio::spawn(async move {
        let hooks = sqlx::query_as::<_, (Uuid, String, String)>(
            "SELECT id, url, secret FROM webhooks \
             WHERE org_id = $1 AND enabled = true AND $2 = ANY(event_types) \
               AND (cardinality(project_ids) = 0 OR $3 = ANY(project_ids))",
        )
        .bind(&org_id)
        .bind(&event_type)
        .bind(project_id)
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

        let delivery_id = Uuid::new_v4();
        let body = json!({
            "event": event_type,
            "data": payload,
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "delivery_id": delivery_id.to_string(),
        });

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();

        let body_str = serde_json::to_string(&body).unwrap_or_default();

        for (hook_id, url, secret) in hooks {
            let per_hook_delivery_id = Uuid::new_v4();

            // Create delivery record
            let _ = sqlx::query(
                r#"INSERT INTO webhook_deliveries (webhook_id, event_type, payload, delivery_id, status, attempts)
                   VALUES ($1, $2, $3, $4, 'pending', 0)"#,
            )
            .bind(hook_id)
            .bind(&event_type)
            .bind(&body)
            .bind(per_hook_delivery_id)
            .execute(&pool)
            .await;

            // Validate URL and resolved IP against SSRF before dispatching
            let ssrf_check = match validate_webhook_url(&url) {
                Ok(parsed) => resolve_and_check_public_ip(&parsed).await,
                Err(e) => Err(e),
            };
            if let Err(err_reason) = ssrf_check {
                let err_msg = format!("Blocked by SSRF filter: {}", err_reason);
                let _ = sqlx::query(
                    r#"UPDATE webhook_deliveries SET status = 'failed', attempts = 1,
                       last_attempt_at = now(), last_error = $2
                       WHERE delivery_id = $1"#,
                )
                .bind(per_hook_delivery_id)
                .bind(&err_msg)
                .execute(&pool)
                .await;

                let _ = sqlx::query(
                    "UPDATE webhooks SET failure_count = failure_count + 1, last_error = $2, updated_at = now() WHERE id = $1",
                )
                .bind(hook_id)
                .bind(&err_msg)
                .execute(&pool)
                .await;
                tracing::warn!(hook_id = %hook_id, url = %url, reason = %err_reason, "webhooks.dispatch: blocked by SSRF filter");
                continue;
            }

            // Compute HMAC-SHA256 signature
            let signature = compute_signature(&secret, &body_str);

            let result = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("X-Baaton-Signature", &signature)
                .header("X-Baaton-Event", &event_type)
                .header("X-Baaton-Delivery", per_hook_delivery_id.to_string())
                .body(body_str.clone())
                .send()
                .await;

            match result {
                Ok(resp) if resp.status().is_success() => {
                    // Mark delivered
                    let _ = sqlx::query(
                        r#"UPDATE webhook_deliveries SET status = 'delivered', attempts = 1, last_attempt_at = now()
                           WHERE delivery_id = $1"#,
                    )
                    .bind(per_hook_delivery_id)
                    .execute(&pool)
                    .await;

                    let _ = sqlx::query(
                        "UPDATE webhooks SET last_delivered_at = now(), failure_count = 0, last_error = NULL, updated_at = now() WHERE id = $1"
                    )
                    .bind(hook_id)
                    .execute(&pool)
                    .await;
                    tracing::debug!(hook_id = %hook_id, url = %url, delivery_id = %per_hook_delivery_id, "webhooks.dispatch: delivered");
                }
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let err_msg = format!("HTTP {}", status);
                    let next_retry = chrono::Utc::now() + chrono::Duration::seconds(retry_delay_seconds(1));

                    let _ = sqlx::query(
                        r#"UPDATE webhook_deliveries SET status = 'retrying', attempts = 1,
                           last_attempt_at = now(), next_retry_at = $2, last_error = $3
                           WHERE delivery_id = $1"#,
                    )
                    .bind(per_hook_delivery_id)
                    .bind(next_retry)
                    .bind(&err_msg)
                    .execute(&pool)
                    .await;

                    let _ = sqlx::query(
                        "UPDATE webhooks SET failure_count = failure_count + 1, last_error = $2, updated_at = now() WHERE id = $1"
                    )
                    .bind(hook_id)
                    .bind(&err_msg)
                    .execute(&pool)
                    .await;
                    tracing::warn!(hook_id = %hook_id, url = %url, status = status, "webhooks.dispatch: non-2xx, scheduled retry");
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    let next_retry = chrono::Utc::now() + chrono::Duration::seconds(retry_delay_seconds(1));

                    let _ = sqlx::query(
                        r#"UPDATE webhook_deliveries SET status = 'retrying', attempts = 1,
                           last_attempt_at = now(), next_retry_at = $2, last_error = $3
                           WHERE delivery_id = $1"#,
                    )
                    .bind(per_hook_delivery_id)
                    .bind(next_retry)
                    .bind(&err_msg)
                    .execute(&pool)
                    .await;

                    let _ = sqlx::query(
                        "UPDATE webhooks SET failure_count = failure_count + 1, last_error = $2, updated_at = now() WHERE id = $1"
                    )
                    .bind(hook_id)
                    .bind(&err_msg)
                    .execute(&pool)
                    .await;
                    tracing::warn!(hook_id = %hook_id, url = %url, error = %e, "webhooks.dispatch: network error, scheduled retry");
                }
            }
        }
    });
}

/// Background worker: retry failed webhook deliveries with exponential backoff.
/// Runs every 30 seconds.
pub async fn retry_worker(pool: PgPool) {
    tracing::info!("Webhook retry worker started");
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;

        // Find deliveries ready for retry
        let deliveries = sqlx::query_as::<_, (Uuid, Uuid, String, serde_json::Value, i32)>(
            r#"SELECT d.delivery_id, d.webhook_id, w.url, d.payload, d.attempts
               FROM webhook_deliveries d
               JOIN webhooks w ON w.id = d.webhook_id
               WHERE d.status = 'retrying'
                 AND d.next_retry_at <= now()
                 AND d.attempts < d.max_attempts
                 AND w.enabled = true
               ORDER BY d.next_retry_at ASC
               LIMIT 50"#,
        )
        .fetch_all(&pool)
        .await;

        let deliveries = match deliveries {
            Ok(d) => d,
            Err(e) => {
                tracing::error!(error = %e, "webhook_retry: query failed");
                continue;
            }
        };

        if deliveries.is_empty() {
            continue;
        }

        tracing::debug!(count = deliveries.len(), "webhook_retry: processing retries");

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();

        for (delivery_id, webhook_id, url, payload, attempts) in deliveries {
            let ssrf_check = match validate_webhook_url(&url) {
                Ok(parsed) => resolve_and_check_public_ip(&parsed).await,
                Err(e) => Err(e),
            };
            if let Err(err_reason) = ssrf_check {
                let err_msg = format!("Blocked by SSRF filter: {}", err_reason);
                let _ = sqlx::query(
                    "UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_attempt_at = now(), last_error = $3 WHERE delivery_id = $1",
                )
                .bind(delivery_id)
                .bind(attempts + 1)
                .bind(&err_msg)
                .execute(&pool)
                .await;
                tracing::warn!(delivery_id = %delivery_id, webhook_id = %webhook_id, reason = %err_reason, "webhook_retry: blocked by SSRF filter");
                continue;
            }

            let body_str = serde_json::to_string(&payload).unwrap_or_default();

            // Get secret for this webhook
            let secret: Option<String> = sqlx::query_scalar("SELECT secret FROM webhooks WHERE id = $1")
                .bind(webhook_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();
            let secret = secret.unwrap_or_default();

            let event_type = payload.get("event").and_then(|v| v.as_str()).unwrap_or("unknown");
            let signature = compute_signature(&secret, &body_str);

            let result = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("X-Baaton-Signature", &signature)
                .header("X-Baaton-Event", event_type)
                .header("X-Baaton-Delivery", delivery_id.to_string())
                .body(body_str)
                .send()
                .await;

            let new_attempts = attempts + 1;

            match result {
                Ok(resp) if resp.status().is_success() => {
                    let _ = sqlx::query(
                        "UPDATE webhook_deliveries SET status = 'delivered', attempts = $2, last_attempt_at = now(), next_retry_at = NULL WHERE delivery_id = $1"
                    )
                    .bind(delivery_id)
                    .bind(new_attempts)
                    .execute(&pool)
                    .await;

                    let _ = sqlx::query(
                        "UPDATE webhooks SET last_delivered_at = now(), failure_count = 0, last_error = NULL, updated_at = now() WHERE id = $1"
                    )
                    .bind(webhook_id)
                    .execute(&pool)
                    .await;

                    tracing::info!(delivery_id = %delivery_id, attempt = new_attempts, "webhook_retry: delivered on retry");
                }
                Ok(resp) => {
                    let err_msg = format!("HTTP {}", resp.status().as_u16());
                    if new_attempts >= 4 {
                        // Max retries exhausted
                        let _ = sqlx::query(
                            "UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_attempt_at = now(), last_error = $3 WHERE delivery_id = $1"
                        )
                        .bind(delivery_id)
                        .bind(new_attempts)
                        .bind(&err_msg)
                        .execute(&pool)
                        .await;
                    } else {
                        let next_retry = chrono::Utc::now() + chrono::Duration::seconds(retry_delay_seconds(new_attempts));
                        let _ = sqlx::query(
                            "UPDATE webhook_deliveries SET attempts = $2, last_attempt_at = now(), next_retry_at = $3, last_error = $4 WHERE delivery_id = $1"
                        )
                        .bind(delivery_id)
                        .bind(new_attempts)
                        .bind(next_retry)
                        .bind(&err_msg)
                        .execute(&pool)
                        .await;
                    }
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    if new_attempts >= 4 {
                        let _ = sqlx::query(
                            "UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_attempt_at = now(), last_error = $3 WHERE delivery_id = $1"
                        )
                        .bind(delivery_id)
                        .bind(new_attempts)
                        .bind(&err_msg)
                        .execute(&pool)
                        .await;
                    } else {
                        let next_retry = chrono::Utc::now() + chrono::Duration::seconds(retry_delay_seconds(new_attempts));
                        let _ = sqlx::query(
                            "UPDATE webhook_deliveries SET attempts = $2, last_attempt_at = now(), next_retry_at = $3, last_error = $4 WHERE delivery_id = $1"
                        )
                        .bind(delivery_id)
                        .bind(new_attempts)
                        .bind(next_retry)
                        .bind(&err_msg)
                        .execute(&pool)
                        .await;
                    }
                }
            }
        }
    }
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

    let parsed_url = validate_webhook_url(&body.url)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    resolve_and_check_public_ip(&parsed_url)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;

    validate_event_types(&body.event_types)?;

    let project_ids = validate_project_filter(&pool, &auth, org_id, &body.project_ids).await?;

    let event_types = if body.event_types.is_empty() {
        VALID_EVENT_TYPES.iter().map(|s| s.to_string()).collect::<Vec<_>>()
    } else {
        body.event_types
    };

    let secret = generate_webhook_secret();

    let hook = sqlx::query_as::<_, Webhook>(
        r#"
        INSERT INTO webhooks (org_id, url, event_types, secret, project_ids)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(body.url.trim())
    .bind(&event_types)
    .bind(&secret)
    .bind(&project_ids)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tracing::info!(user_id = %auth.user_id, org_id = org_id, hook_id = %hook.id, "webhooks.create");

    Ok(Json(json!({
        "data": {
            "id": hook.id,
            "org_id": hook.org_id,
            "url": hook.url,
            "event_types": hook.event_types,
            "project_ids": hook.project_ids,
            "secret": secret,
            "enabled": hook.enabled,
            "failure_count": hook.failure_count,
            "last_error": hook.last_error,
            "last_delivered_at": hook.last_delivered_at,
            "created_at": hook.created_at,
            "updated_at": hook.updated_at,
        },
        "_hints": [
            {
                "action": "store_secret",
                "reason": "The webhook secret is shown ONLY on creation. Store it securely for signature verification (X-Baaton-Signature header).",
                "priority": "required"
            },
            {
                "action": "verify_endpoint",
                "reason": "Send a test event to verify your endpoint receives and processes webhooks correctly.",
                "endpoint": format!("POST /webhooks/{}/test", hook.id),
                "priority": "recommended"
            }
        ]
    })))
}

/// GET /api/v1/webhooks
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<WebhookPublic>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let hooks = sqlx::query_as::<_, WebhookPublic>(&format!(
        "SELECT id, org_id, url, event_types, project_ids, enabled, failure_count, last_error, last_delivered_at, created_at, updated_at \
         FROM webhooks WHERE org_id = $1 AND {} ORDER BY created_at DESC",
        visible_to_caller(2),
    ))
    .bind(org_id)
    .bind(&auth.scoped_project_ids)
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

    let hook = sqlx::query_as::<_, WebhookPublic>(&format!(
        "SELECT id, org_id, url, event_types, project_ids, enabled, failure_count, last_error, last_delivered_at, created_at, updated_at \
         FROM webhooks WHERE id = $1 AND org_id = $2 AND {}",
        visible_to_caller(3),
    ))
    .bind(id)
    .bind(org_id)
    .bind(&auth.scoped_project_ids)
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

    let exists: bool = sqlx::query_scalar(&format!(
        "SELECT EXISTS(SELECT 1 FROM webhooks WHERE id = $1 AND org_id = $2 AND {})",
        visible_to_caller(3),
    ))
    .bind(id)
    .bind(org_id)
    .bind(&auth.scoped_project_ids)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Webhook not found"}))));
    }

    if let Some(ref url) = body.url {
        let parsed_url = validate_webhook_url(url)
            .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
        resolve_and_check_public_ip(&parsed_url)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    }

    if let Some(ref types) = body.event_types {
        validate_event_types(types)?;
    }

    let project_ids = match body.project_ids {
        Some(ref ids) => Some(validate_project_filter(&pool, &auth, org_id, ids).await?),
        None => None,
    };

    let hook = sqlx::query_as::<_, WebhookPublic>(
        r#"
        UPDATE webhooks SET
            url = COALESCE($2, url),
            event_types = COALESCE($3, event_types),
            enabled = COALESCE($4, enabled),
            project_ids = COALESCE($6, project_ids),
            updated_at = now()
        WHERE id = $1 AND org_id = $5
        RETURNING id, org_id, url, event_types, project_ids, enabled, failure_count, last_error, last_delivered_at, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(&body.url)
    .bind(&body.event_types)
    .bind(body.enabled)
    .bind(org_id)
    .bind(&project_ids)
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

    let result = sqlx::query(&format!(
        "DELETE FROM webhooks WHERE id = $1 AND org_id = $2 AND {}",
        visible_to_caller(3),
    ))
    .bind(id)
    .bind(org_id)
    .bind(&auth.scoped_project_ids)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Webhook not found"}))));
    }

    tracing::info!(user_id = %auth.user_id, hook_id = %id, "webhooks.remove");

    Ok(Json(ApiResponse::new(())))
}
