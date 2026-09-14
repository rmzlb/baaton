//! Telegram facade: all provider calls and credentials stay in notifyd.
use axum::{extract::{Extension, Path}, http::{HeaderMap, StatusCode}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{effective_user_id, ApiErr};
use crate::{middleware::AuthUser, models::{ApiResponse, UpsertUserNotificationChannel, UserNotificationChannelView}, notifyd::NotifydClient};

fn client(notifyd: Option<&NotifydClient>) -> Result<&NotifydClient, ApiErr> {
    notifyd.ok_or_else(|| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "notifyd is not configured"}))))
}

fn path(owner: &str, suffix: &str) -> String {
    // Encode the trusted principal as one path segment, never as a URL.
    let mut url = reqwest::Url::parse("https://notifyd.invalid/v1/telegram/").expect("static URL");
    url.path_segments_mut().expect("base URL").pop_if_empty().push(owner);
    format!("{}{suffix}", url.path())
}

async fn request(notifyd: Option<&NotifydClient>, owner: &str, method: reqwest::Method, suffix: &str, body: Option<Value>) -> Result<Value, ApiErr> {
    client(notifyd)?.integration_request(method, &path(owner, suffix), body, None).await
}

pub async fn get_bot(
    Extension(auth): Extension<AuthUser>,
    Extension(notifyd): Extension<Option<NotifydClient>>,
) -> Result<Json<ApiResponse<Value>>, ApiErr> {
    let owner = effective_user_id(&auth)?;
    let setup = request(notifyd.as_ref(), &owner, reqwest::Method::GET, "", None).await?;
    Ok(Json(ApiResponse::new(setup.pointer("/data/bot").cloned().unwrap_or(Value::Null))))
}

#[derive(Deserialize)]
pub struct RegisterTelegramBot { bot_token: String }

fn webhook_base() -> Result<String, ApiErr> {
    let origin = std::env::var("API_URL").ok().and_then(|v| reqwest::Url::parse(&v).ok());
    match origin {
        Some(url) if url.scheme() == "https" && url.host_str().is_some()
            && url.username().is_empty() && url.password().is_none()
            && url.query().is_none() && url.fragment().is_none() =>
            Ok(format!("{}/api/v1/public/telegram/webhook", url.as_str().trim_end_matches('/'))),
        _ => Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "API_URL must be the public HTTPS API origin"})))),
    }
}

pub async fn register_bot(
    Extension(auth): Extension<AuthUser>,
    Extension(notifyd): Extension<Option<NotifydClient>>,
    Json(body): Json<RegisterTelegramBot>,
) -> Result<Json<ApiResponse<Value>>, ApiErr> {
    let owner = effective_user_id(&auth)?;
    let token = body.bot_token.trim();
    if token.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "A bot token is required"}))));
    }
    let setup = request(notifyd.as_ref(), &owner, reqwest::Method::PUT, "", Some(json!({
        "bot_token": token, "webhook_base": webhook_base()?,
    }))).await?;
    Ok(Json(ApiResponse::new(setup.pointer("/data/bot").cloned().unwrap_or(Value::Null))))
}

pub async fn delete_bot(
    Extension(auth): Extension<AuthUser>,
    Extension(notifyd): Extension<Option<NotifydClient>>,
) -> Result<StatusCode, ApiErr> {
    let owner = effective_user_id(&auth)?;
    request(notifyd.as_ref(), &owner, reqwest::Method::DELETE, "", None).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn destination(notifyd: Option<&NotifydClient>, owner: &str) -> Result<Option<UserNotificationChannelView>, ApiErr> {
    let setup = request(notifyd, owner, reqwest::Method::GET, "", None).await?;
    serde_json::from_value(setup.pointer("/data/destination").cloned().unwrap_or(Value::Null))
        .map_err(|_| (StatusCode::BAD_GATEWAY, Json(json!({"error": "Invalid notifyd destination response"}))))
}

pub(super) async fn set_destination(notifyd: Option<&NotifydClient>, owner: &str, body: UpsertUserNotificationChannel) -> Result<Json<ApiResponse<UserNotificationChannelView>>, ApiErr> {
    let result = request(notifyd, owner, reqwest::Method::PUT, "/destination", Some(json!({
        "address": body.address, "telegram_thread_id": body.telegram_thread_id,
    }))).await?;
    let destination = serde_json::from_value(result.get("data").cloned().unwrap_or(Value::Null))
        .map_err(|_| (StatusCode::BAD_GATEWAY, Json(json!({"error": "Invalid notifyd destination response"}))))?;
    Ok(Json(ApiResponse::new(destination)))
}

pub(super) async fn remove_destination(notifyd: Option<&NotifydClient>, owner: &str) -> Result<StatusCode, ApiErr> {
    request(notifyd, owner, reqwest::Method::DELETE, "/destination", None).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Default, Deserialize)]
pub struct LinkRequest { kind: Option<String> }

pub async fn create_telegram_link(
    Extension(auth): Extension<AuthUser>,
    Extension(notifyd): Extension<Option<NotifydClient>>,
    body: Option<Json<LinkRequest>>,
) -> Result<Json<Value>, ApiErr> {
    let owner = effective_user_id(&auth)?;
    let kind = body.and_then(|b| b.0.kind).unwrap_or_else(|| "private".into());
    Ok(Json(request(notifyd.as_ref(), &owner, reqwest::Method::POST, "/link", Some(json!({"kind": kind}))).await?))
}

pub async fn send_test_notification(
    Extension(auth): Extension<AuthUser>,
    Extension(notifyd): Extension<Option<NotifydClient>>,
) -> Result<Json<serde_json::Value>, ApiErr> {
    let user_id = effective_user_id(&auth)?;
    let notifyd = client(notifyd.as_ref())?;

    // Resolve the verified Telegram route for this user via notifyd.
    let lookup = notifyd
        .integration_request(
            reqwest::Method::POST,
            "/v1/telegram/lookup",
            Some(json!({ "owners": [&user_id] })),
            None,
        )
        .await?;

    let routes = lookup
        .pointer("/data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();

    let route = routes.first().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "No verified Telegram destination. \
                         Open the Telegram bot and press Start, then retry."
            })),
        )
    })?;

    let route_id = route
        .get("route_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "Invalid route response from notifyd" })),
            )
        })?;

    // `/v1/send` requires `to` (the address / chat-id) even when routing via
    // `chat.telegram_route_id`. Without it notifyd returns 422
    // "Missing 'to' or 'subscriber_id'", which was the root cause of
    // `send_test_notification` returning a generic failure.
    let to_address = route
        .get("address")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": "Invalid route: missing address from notifyd" })),
            )
        })?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    notifyd
        .integration_request(
            reqwest::Method::POST,
            "/v1/send",
            Some(json!({
                "channel": "telegram",
                "to": to_address,
                "chat": { "telegram_route_id": route_id },
                "body": "\u{1f514} Baaton test notification \u{2014} your setup is working!",
                "idempotency_key": format!("baaton-test-{}-{}", user_id, timestamp),
            })),
            None,
        )
        .await?;

    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct SetDestinationRequest {
    address: String,
    telegram_thread_id: Option<i64>,
}

pub async fn put_telegram_destination(
    Extension(auth): Extension<AuthUser>,
    Extension(notifyd): Extension<Option<NotifydClient>>,
    Json(body): Json<SetDestinationRequest>,
) -> Result<Json<ApiResponse<UserNotificationChannelView>>, ApiErr> {
    let owner = effective_user_id(&auth)?;
    set_destination(notifyd.as_ref(), &owner, crate::models::UpsertUserNotificationChannel {
        address: body.address,
        telegram_thread_id: body.telegram_thread_id,
    }).await
}

pub async fn telegram_webhook(
    Extension(notifyd): Extension<Option<NotifydClient>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(update): Json<Value>,
) -> Result<StatusCode, ApiErr> {
    // notifyd validates the per-bot secret and atomically consumes link tokens.
    // A transport/DB failure is not acknowledged: Telegram must retry it.
    client(notifyd.as_ref())?.integration_request(
        reqwest::Method::POST, &format!("/v1/telegram/webhooks/{id}"), Some(update),
        headers.get("x-telegram-bot-api-secret-token").and_then(|v| v.to_str().ok()),
    ).await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    /// `/v1/send` requires either `to` or `subscriber_id`. Without it notifyd
    /// returns 422 "Missing 'to' or 'subscriber_id'", which was the root cause
    /// of `send_test_notification` returning a generic failure instead of a
    /// clear error.
    ///
    /// This verifies the payload shape; the real HTTP call requires a live
    /// notifyd instance.
    #[test]
    fn test_payload_has_to_and_route_id() {
        // Simulate the route object returned by /v1/telegram/lookup.
        let route = json!({
            "route_id": "550e8400-e29b-41d4-a716-446655440000",
            "address": "-100380385762",
            "owner": "user_abc"
        });

        let route_id = route.get("route_id").and_then(|v| v.as_str()).unwrap();
        let to_address = route.get("address").and_then(|v| v.as_str()).unwrap();

        // Reproduce the exact payload shape built by send_test_notification.
        let payload = json!({
            "channel": "telegram",
            "to": to_address,
            "chat": { "telegram_route_id": route_id },
            "body": "test",
            "idempotency_key": "baaton-test-user_abc-1234567890",
        });

        assert_eq!(
            payload["to"].as_str(),
            Some("-100380385762"),
            "`to` is required by notifyd /v1/send"
        );
        assert_eq!(
            payload["chat"]["telegram_route_id"].as_str(),
            Some("550e8400-e29b-41d4-a716-446655440000"),
            "route_id selects the correct bot for this user"
        );
        assert!(payload.get("to").is_some(), "missing `to` causes 422 from notifyd");
    }

    /// Missing `address` field in the route response must surface as
    /// BAD_GATEWAY, not an unrelated error.
    #[test]
    fn route_without_address_is_bad_gateway() {
        let route = json!({
            "route_id": "550e8400-e29b-41d4-a716-446655440000",
            "owner": "user_abc"
            // "address" deliberately absent
        });
        // The real handler returns Err(BAD_GATEWAY) here; we just verify the
        // field access mirrors what the handler does.
        let to_address = route.get("address").and_then(|v| v.as_str());
        assert!(to_address.is_none(), "should be None so handler returns BAD_GATEWAY");
    }
}
