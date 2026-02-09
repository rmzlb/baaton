use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;

type HmacSha256 = Hmac<Sha256>;

/// POST /webhooks/github
///
/// Receives webhook events from GitHub.
/// This endpoint does NOT use Clerk auth middleware — it uses
/// GitHub's HMAC-SHA256 webhook signature for verification.
///
/// Flow:
/// 1. Verify X-Hub-Signature-256 header
/// 2. Check X-GitHub-Delivery for idempotency
/// 3. Store raw event in github_webhook_events
/// 4. Respond 200 immediately
/// 5. Spawn background task for async processing
pub async fn handle(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    // 1. Extract required headers
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let event_type = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::BAD_REQUEST)?
        .to_string();

    let delivery_id = headers
        .get("x-github-delivery")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::BAD_REQUEST)?
        .to_string();

    // 2. Verify HMAC-SHA256 signature
    let webhook_secret = std::env::var("GITHUB_WEBHOOK_SECRET")
        .map_err(|_| {
            tracing::error!("GITHUB_WEBHOOK_SECRET not set");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    verify_signature(&body, &webhook_secret, signature)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 3. Idempotency check
    let exists: Option<(bool,)> = sqlx::query_as(
        "SELECT true FROM github_webhook_events WHERE delivery_id = $1",
    )
    .bind(&delivery_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Idempotency check failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if exists.is_some() {
        // Already received — return 200 (idempotent)
        return Ok(StatusCode::OK);
    }

    // 4. Parse payload
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| {
            tracing::warn!("Webhook payload parse error: {}", e);
            StatusCode::BAD_REQUEST
        })?;

    let action = payload
        .get("action")
        .and_then(|v| v.as_str())
        .map(String::from);

    let installation_id = payload
        .get("installation")
        .and_then(|i| i.get("id"))
        .and_then(|v| v.as_i64());

    let repo_full_name = payload
        .get("repository")
        .and_then(|r| r.get("full_name"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let sender = payload
        .get("sender")
        .and_then(|s| s.get("login"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // 5. Store raw event
    sqlx::query(
        r#"INSERT INTO github_webhook_events
           (delivery_id, event_type, action, installation_id,
            repository_full_name, sender_login, payload, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')"#,
    )
    .bind(&delivery_id)
    .bind(&event_type)
    .bind(&action)
    .bind(installation_id)
    .bind(&repo_full_name)
    .bind(&sender)
    .bind(&payload)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to store webhook event: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tracing::info!(
        delivery_id = %delivery_id,
        event_type = %event_type,
        action = ?action,
        "Received GitHub webhook"
    );

    // 6. Spawn background processing (non-blocking)
    let pool_bg = pool.clone();
    let delivery_id_bg = delivery_id.clone();
    tokio::spawn(async move {
        if let Err(e) =
            crate::github::webhook_processor::process_webhook_event(&pool_bg, &delivery_id_bg)
                .await
        {
            tracing::error!(
                "Webhook processing failed for {}: {}",
                delivery_id_bg,
                e
            );
        }
    });

    // 7. Respond immediately
    Ok(StatusCode::OK)
}

/// Verify the HMAC-SHA256 signature from GitHub.
/// Uses constant-time comparison to prevent timing attacks.
fn verify_signature(body: &[u8], secret: &str, signature: &str) -> Result<(), ()> {
    let hex_sig = signature.strip_prefix("sha256=").ok_or(())?;
    let sig_bytes = hex::decode(hex_sig).map_err(|_| ())?;

    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| ())?;
    mac.update(body);

    mac.verify_slice(&sig_bytes).map_err(|_| ())
}
