//! Per-user notification routing: who hears about what, and where.
//!
//! Replaces `NOTIFYD_TELEGRAM_CHAT_ID`, an environment variable that was one
//! address for the whole instance. Adding a second user changed nothing, because
//! no field anywhere said where to reach them.
//!
//! Three questions, previously collapsed into that one variable:
//!
//! | question | owner |
//! |---|---|
//! | where to reach someone | `user_notification_channels` (a chat id belongs to a person) |
//! | what they want to hear | `project_notification_subscriptions` (user × project) |
//! | which statuses exist | `projects.notify_statuses` (migration 073) |
//!
//! Every route here acts on the *caller*. There is no user id in any path: a
//! settings screen that could address another user's channels would be a way to
//! redirect someone else's notifications.

use axum::{
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::Engine as _;
use rand::TryRngCore;
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{
    ApiResponse, ProjectSubscriptionDefaults, ProjectSubscriptionView, UpdateProjectSubscription,
    UpsertUserNotificationChannel, UserNotificationChannelRow, UserNotificationChannelView,
};
use crate::routes::issues::fetch_user_org_ids;

type ApiErr = (StatusCode, Json<serde_json::Value>);

fn internal(e: impl std::fmt::Display) -> ApiErr {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": e.to_string()})),
    )
}

fn bad_request(msg: &str, detail: &str) -> ApiErr {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error": msg, "detail": detail})),
    )
}

/// Channels notifyd can actually deliver to. Anything else is rejected at the
/// edge rather than stored and silently never sent.
const SUPPORTED_CHANNELS: [&str; 4] = ["telegram", "slack", "discord", "email"];

/// How long a Telegram link stays usable. Long enough to switch apps and press
/// Start, short enough that a link left in a browser tab stops being a way to
/// capture someone's notifications.
const LINK_TOKEN_TTL_MINUTES: i64 = 15;

/// An address the channel can actually reach.
///
/// This is the check that decides whether a notification will ever arrive.
/// Telegram answers "chat not found" to a server nobody is watching, so a
/// malformed chat id stored today is a silence discovered weeks later.
fn validate_address(channel: &str, address: &str) -> Result<String, String> {
    let address = address.trim();
    if address.is_empty() {
        return Err("Address is empty".to_string());
    }
    match channel {
        // A chat id is an integer, negative for groups. Anything else — a
        // username, an invite link, a copied URL — is a value Telegram will
        // never accept.
        "telegram" => address
            .parse::<i64>()
            .map(|id| id.to_string())
            .map_err(|_| {
                "A Telegram chat id is a number (negative for a group). Send /start to the bot, \
                 or ask @userinfobot for your id."
                    .to_string()
            }),
        "email" => {
            let ok = address.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty() && domain.contains('.') && !domain.starts_with('.')
            });
            if ok {
                Ok(address.to_string())
            } else {
                Err("Not an email address".to_string())
            }
        }
        // Slack accepts a member id, a channel id or an incoming webhook URL;
        // Discord takes a webhook URL. Their shapes are the connector's business,
        // so only emptiness is rejected here.
        "slack" | "discord" => Ok(address.to_string()),
        _ => Err(format!("Unsupported channel: {channel}")),
    }
}

fn require_supported_channel(channel: &str) -> Result<(), ApiErr> {
    if SUPPORTED_CHANNELS.contains(&channel) {
        Ok(())
    } else {
        Err(bad_request(
            "Unsupported channel",
            &format!("Known channels: {}", SUPPORTED_CHANNELS.join(", ")),
        ))
    }
}

// ─────────────────────────── channels ───────────────────────────

pub async fn list_channels(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<UserNotificationChannelView>>>, ApiErr> {
    let rows = sqlx::query_as::<_, UserNotificationChannelRow>(
        "SELECT channel, address, verified_at, created_at \
         FROM user_notification_channels WHERE user_id = $1 ORDER BY channel",
    )
    .bind(&auth.user_id)
    .fetch_all(&pool)
    .await
    .map_err(internal)?;

    Ok(Json(ApiResponse::new(
        rows.into_iter().map(|r| r.view()).collect(),
    )))
}

/// Set an address by hand — the fallback when the deep link is not an option.
///
/// Stored unverified on purpose: nothing here proves the id belongs to the
/// caller, and pretending otherwise would make a typo indistinguishable from a
/// working setup.
pub async fn upsert_channel(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(channel): Path<String>,
    Json(body): Json<UpsertUserNotificationChannel>,
) -> Result<Json<ApiResponse<UserNotificationChannelView>>, ApiErr> {
    require_supported_channel(&channel)?;
    let address =
        validate_address(&channel, &body.address).map_err(|e| bad_request("Invalid address", &e))?;

    let row = sqlx::query_as::<_, UserNotificationChannelRow>(
        "INSERT INTO user_notification_channels (user_id, channel, address) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, channel) DO UPDATE \
           SET address = EXCLUDED.address, \
               updated_at = now(), \
               verified_at = CASE \
                 WHEN user_notification_channels.address = EXCLUDED.address \
                 THEN user_notification_channels.verified_at ELSE NULL END \
         RETURNING channel, address, verified_at, created_at",
    )
    .bind(&auth.user_id)
    .bind(&channel)
    .bind(&address)
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    Ok(Json(ApiResponse::new(row.view())))
}

pub async fn delete_channel(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(channel): Path<String>,
) -> Result<StatusCode, ApiErr> {
    sqlx::query("DELETE FROM user_notification_channels WHERE user_id = $1 AND channel = $2")
        .bind(&auth.user_id)
        .bind(&channel)
        .execute(&pool)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ───────────────────── telegram deep link ─────────────────────

#[derive(Debug, Serialize)]
pub struct TelegramLink {
    pub deep_link: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

/// Mint a one-time link that proves a chat id belongs to the caller.
///
/// Telegram never tells a server who a user is; it reveals a chat id only when
/// that chat sends a message. So the flow is inverted: the user carries an
/// unguessable token into the bot, and the resulting update carries both the
/// token and the chat id back.
///
/// The token is a credential — whoever holds it becomes the notification target
/// for this account — hence 32 random bytes, single use, 15 minutes.
pub async fn create_telegram_link(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<TelegramLink>>, ApiErr> {
    let username = telegram_bot_username().await.ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Telegram bot not configured",
                "detail": "TELEGRAM_BOT_TOKEN (and optionally TELEGRAM_BOT_USERNAME) must be set.",
            })),
        )
    })?;

    let mut bytes = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| internal(format!("OsRng failed: {e}")))?;
    // URL_SAFE_NO_PAD keeps the token inside Telegram's deep-link alphabet
    // ([A-Za-z0-9_-]) and its 64-character limit: 32 bytes encode to 43 chars.
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    let expires_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "INSERT INTO telegram_link_tokens (token, user_id, expires_at) \
         VALUES ($1, $2, now() + ($3 || ' minutes')::interval) RETURNING expires_at",
    )
    .bind(&token)
    .bind(&auth.user_id)
    .bind(LINK_TOKEN_TTL_MINUTES.to_string())
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    Ok(Json(ApiResponse::new(TelegramLink {
        deep_link: format!("https://t.me/{username}?start={token}"),
        expires_at,
    })))
}

/// The bot's public username, needed to build a `t.me` link.
///
/// Prefer the env var; fall back to `getMe` so a deployment that only sets the
/// token still works instead of failing on a detail Telegram can answer.
async fn telegram_bot_username() -> Option<String> {
    if let Ok(name) = std::env::var("TELEGRAM_BOT_USERNAME") {
        let name = name.trim().trim_start_matches('@').to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }
    let token = std::env::var("TELEGRAM_BOT_TOKEN").ok()?;
    let resp = reqwest::Client::new()
        .get(format!("https://api.telegram.org/bot{token}/getMe"))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?
        .json::<serde_json::Value>()
        .await
        .ok()?;
    resp.pointer("/result/username")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Receive Telegram updates: the missing half of the loop.
///
/// notifyd sends but never listens, so nothing in the stack could learn a chat
/// id. This endpoint is that ear. It lives under `/public/` because Telegram
/// cannot present a Clerk token; authentication is the secret header set with
/// `setWebhook`, compared in full so a wrong secret is rejected outright.
///
/// Always answers 200. Telegram retries anything else, and a token already
/// consumed would be retried forever.
pub async fn telegram_webhook(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(update): Json<serde_json::Value>,
) -> StatusCode {
    let expected = std::env::var("TELEGRAM_WEBHOOK_SECRET").unwrap_or_default();
    if expected.trim().is_empty() {
        tracing::warn!("telegram.webhook.no_secret_configured");
        return StatusCode::OK;
    }
    let presented = headers
        .get("x-telegram-bot-api-secret-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if presented != expected {
        tracing::warn!("telegram.webhook.bad_secret");
        return StatusCode::OK;
    }

    let text = update
        .pointer("/message/text")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim();
    let chat_id = update.pointer("/message/chat/id").and_then(|v| v.as_i64());
    let Some(chat_id) = chat_id else {
        return StatusCode::OK;
    };

    // `/start` with no payload is someone opening the bot directly: tell them
    // how to link rather than ignoring them.
    let Some(payload) = text.strip_prefix("/start").map(str::trim) else {
        return StatusCode::OK;
    };
    if payload.is_empty() {
        send_telegram_reply(
            chat_id,
            "Pour recevoir les notifications Baaton, ouvre Réglages → Notifications dans Baaton \
             et clique sur « Connecter Telegram ».",
        )
        .await;
        return StatusCode::OK;
    }

    // Consume the token and read the owner in one statement: two queries would
    // let the same link be redeemed twice concurrently.
    let claimed: Option<(String,)> = sqlx::query_as(
        "UPDATE telegram_link_tokens SET used_at = now() \
         WHERE token = $1 AND used_at IS NULL AND expires_at > now() \
         RETURNING user_id",
    )
    .bind(payload)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    let Some((user_id,)) = claimed else {
        // Distinguish the two failures: "already used" and "never existed" are
        // different problems, and telling them apart is what makes a broken link
        // diagnosable instead of mysterious.
        let known: Option<(Option<chrono::DateTime<chrono::Utc>>,)> =
            sqlx::query_as("SELECT used_at FROM telegram_link_tokens WHERE token = $1")
                .bind(payload)
                .fetch_optional(&pool)
                .await
                .unwrap_or(None);
        let msg = match known {
            Some((Some(_),)) => "Ce lien a déjà été utilisé. Génère-en un nouveau dans Baaton.",
            Some((None,)) => "Ce lien a expiré. Génère-en un nouveau dans Baaton.",
            None => "Lien invalide. Génère-en un nouveau dans Baaton.",
        };
        send_telegram_reply(chat_id, msg).await;
        return StatusCode::OK;
    };

    let stored = sqlx::query(
        "INSERT INTO user_notification_channels (user_id, channel, address, verified_at) \
         VALUES ($1, 'telegram', $2, now()) \
         ON CONFLICT (user_id, channel) DO UPDATE \
           SET address = EXCLUDED.address, verified_at = now(), updated_at = now()",
    )
    .bind(&user_id)
    .bind(chat_id.to_string())
    .execute(&pool)
    .await;

    match stored {
        Ok(_) => {
            tracing::info!(user_id = %user_id, "telegram.webhook.linked");
            send_telegram_reply(
                chat_id,
                "✅ Telegram connecté. Choisis les projets à suivre dans Baaton → Réglages → \
                 Notifications.",
            )
            .await;
        }
        Err(e) => tracing::error!(error = %e, "telegram.webhook.link_failed"),
    }
    StatusCode::OK
}

/// Confirm in the chat itself. Silence after pressing Start is indistinguishable
/// from a broken integration, and this is the only surface the user is looking at.
async fn send_telegram_reply(chat_id: i64, text: &str) {
    let Ok(token) = std::env::var("TELEGRAM_BOT_TOKEN") else {
        return;
    };
    let _ = reqwest::Client::new()
        .post(format!("https://api.telegram.org/bot{token}/sendMessage"))
        .timeout(std::time::Duration::from_secs(5))
        .json(&json!({ "chat_id": chat_id, "text": text }))
        .send()
        .await;
}

// ───────────────────── project subscriptions ─────────────────────

#[derive(sqlx::FromRow)]
struct SubscriptionRow {
    project_id: Uuid,
    project_name: String,
    project_slug: String,
    org_id: String,
    enabled: Option<bool>,
    notify_statuses: Option<serde_json::Value>,
    notify_comments: Option<bool>,
    notify_issue_created: Option<bool>,
    channels: Option<Vec<String>>,
    default_statuses: serde_json::Value,
    default_comments: bool,
    default_issue_created: bool,
    statuses: Option<serde_json::Value>,
}

impl SubscriptionRow {
    fn view(self) -> ProjectSubscriptionView {
        ProjectSubscriptionView {
            project_id: self.project_id,
            project_name: self.project_name,
            project_slug: self.project_slug,
            org_id: self.org_id,
            // No row means not subscribed, which reads as disabled rather than
            // as a missing project.
            enabled: self.enabled.unwrap_or(false),
            notify_statuses: self.notify_statuses,
            notify_comments: self.notify_comments,
            notify_issue_created: self.notify_issue_created,
            channels: self.channels.unwrap_or_default(),
            project_defaults: ProjectSubscriptionDefaults {
                notify_statuses: self.default_statuses,
                notify_comments: self.default_comments,
                notify_issue_created: self.default_issue_created,
            },
            statuses: self.statuses.unwrap_or_else(|| json!([])),
        }
    }
}

/// Every project the caller can see, subscribed or not.
///
/// A LEFT JOIN, not an inner one: a settings screen listing only existing
/// subscriptions could never be used to create the first one.
pub async fn list_subscriptions(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<ProjectSubscriptionView>>>, ApiErr> {
    let org_ids = user_org_ids(&auth).await?;

    let rows = sqlx::query_as::<_, SubscriptionRow>(
        "SELECT p.id AS project_id, p.name AS project_name, p.slug AS project_slug, \
                p.org_id, p.statuses, \
                p.notify_statuses AS default_statuses, \
                p.notify_comments AS default_comments, \
                p.notify_issue_created AS default_issue_created, \
                s.enabled, s.notify_statuses, s.notify_comments, \
                s.notify_issue_created, s.channels \
         FROM projects p \
         LEFT JOIN project_notification_subscriptions s \
           ON s.project_id = p.id AND s.user_id = $1 \
         WHERE p.org_id = ANY($2) \
         ORDER BY p.org_id, p.name",
    )
    .bind(&auth.user_id)
    .bind(&org_ids)
    .fetch_all(&pool)
    .await
    .map_err(internal)?;

    Ok(Json(ApiResponse::new(
        rows.into_iter().map(|r| r.view()).collect(),
    )))
}

pub async fn update_subscription(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<UpdateProjectSubscription>,
) -> Result<Json<ApiResponse<ProjectSubscriptionView>>, ApiErr> {
    let org_ids = user_org_ids(&auth).await?;

    // The project must be one the caller can see. Without this, any uuid would
    // create a subscription row — and reveal by its success that the project
    // exists.
    let project: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT statuses FROM projects WHERE id = $1 AND org_id = ANY($2)")
            .bind(project_id)
            .bind(&org_ids)
            .fetch_optional(&pool)
            .await
            .map_err(internal)?;
    let Some((statuses,)) = project else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Project not found"})),
        ));
    };

    // Validate against this project's own workflow. A silently-ignored key is
    // the worst outcome: the UI would show a notification enabled while nothing
    // ever fires.
    if let Some(Some(requested)) = body.notify_statuses.as_ref() {
        let known: Vec<String> = statuses
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.get("key").and_then(|k| k.as_str()))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let unknown: Vec<&String> = requested.iter().filter(|k| !known.contains(k)).collect();
        if !unknown.is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Unknown status keys",
                    "unknown": unknown,
                    "valid": known,
                    "hint": "notify_statuses holds status keys from this project's workflow, not labels.",
                })),
            ));
        }
    }

    if let Some(channels) = body.channels.as_ref() {
        for c in channels {
            require_supported_channel(c)?;
        }
    }

    // `Option<Option<T>>` collapses here: the field absent leaves the stored
    // value alone (`COALESCE`), an explicit null resets to "inherit the
    // project". `$n::type` flags say which case applies, because a NULL bind
    // alone cannot express the difference.
    let (statuses_set, statuses_val) = match body.notify_statuses {
        None => (false, None),
        Some(v) => (true, v.map(serde_json::Value::from)),
    };
    let (comments_set, comments_val) = match body.notify_comments {
        None => (false, None),
        Some(v) => (true, v),
    };
    let (created_set, created_val) = match body.notify_issue_created {
        None => (false, None),
        Some(v) => (true, v),
    };

    sqlx::query(
        "INSERT INTO project_notification_subscriptions \
           (user_id, project_id, enabled, notify_statuses, notify_comments, \
            notify_issue_created, channels) \
         VALUES ($1, $2, COALESCE($3, true), $5, $7, $9, COALESCE($10, '{}')) \
         ON CONFLICT (user_id, project_id) DO UPDATE SET \
           enabled = COALESCE($3, project_notification_subscriptions.enabled), \
           notify_statuses = CASE WHEN $4 THEN $5 \
             ELSE project_notification_subscriptions.notify_statuses END, \
           notify_comments = CASE WHEN $6 THEN $7 \
             ELSE project_notification_subscriptions.notify_comments END, \
           notify_issue_created = CASE WHEN $8 THEN $9 \
             ELSE project_notification_subscriptions.notify_issue_created END, \
           channels = COALESCE($10, project_notification_subscriptions.channels), \
           updated_at = now()",
    )
    .bind(&auth.user_id)
    .bind(project_id)
    .bind(body.enabled)
    .bind(statuses_set)
    .bind(statuses_val)
    .bind(comments_set)
    .bind(comments_val)
    .bind(created_set)
    .bind(created_val)
    .bind(body.channels)
    .execute(&pool)
    .await
    .map_err(internal)?;

    // Read back through the same projection the list uses, so the client never
    // has to reconcile two shapes of the same object.
    let row = sqlx::query_as::<_, SubscriptionRow>(
        "SELECT p.id AS project_id, p.name AS project_name, p.slug AS project_slug, \
                p.org_id, p.statuses, \
                p.notify_statuses AS default_statuses, \
                p.notify_comments AS default_comments, \
                p.notify_issue_created AS default_issue_created, \
                s.enabled, s.notify_statuses, s.notify_comments, \
                s.notify_issue_created, s.channels \
         FROM projects p \
         LEFT JOIN project_notification_subscriptions s \
           ON s.project_id = p.id AND s.user_id = $1 \
         WHERE p.id = $2",
    )
    .bind(&auth.user_id)
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    Ok(Json(ApiResponse::new(row.view())))
}

pub async fn delete_subscription(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<StatusCode, ApiErr> {
    sqlx::query(
        "DELETE FROM project_notification_subscriptions WHERE user_id = $1 AND project_id = $2",
    )
    .bind(&auth.user_id)
    .bind(project_id)
    .execute(&pool)
    .await
    .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Orgs the caller belongs to. A channel is the person's, so their subscriptions
/// span every org they are a member of — the request's current org is not the
/// boundary here.
async fn user_org_ids(auth: &AuthUser) -> Result<Vec<String>, ApiErr> {
    if auth.user_id.starts_with("apikey:") {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Not available to API keys",
                "detail": "Notification preferences belong to a person, not a key.",
            })),
        ));
    }
    let mut ids = fetch_user_org_ids(&auth.user_id).await.unwrap_or_default();
    // Clerk can be slow or down. Falling back to the request's org keeps the
    // screen usable instead of showing an empty project list, which would read
    // as "you have no projects".
    if ids.is_empty() {
        if let Some(org) = auth.org_id.clone() {
            ids.push(org);
        }
    }
    Ok(ids)
}

// ───────────────────── recipient resolution ─────────────────────

/// One delivery: a person, a channel, an address.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Recipient {
    pub user_id: String,
    pub channel: String,
    pub address: String,
}

/// Who must hear about this event on this project.
///
/// The whole per-user model reduces to this query, and it runs on the send path,
/// so the filtering happens in Postgres rather than by fetching every
/// subscription and sifting in Rust.
///
/// `COALESCE(s.x, p.x)` is the inheritance rule: a subscriber who expressed no
/// opinion follows the project's setting as it evolves, and only an explicit
/// value pins the behaviour.
pub async fn resolve_recipients(
    pool: &PgPool,
    project_id: Uuid,
    event: &str,
    status_key: Option<&str>,
) -> Vec<Recipient> {
    let sql = "\
        SELECT c.user_id, c.channel, c.address \
        FROM project_notification_subscriptions s \
        JOIN projects p ON p.id = s.project_id \
        JOIN user_notification_channels c ON c.user_id = s.user_id \
        WHERE s.project_id = $1 \
          AND s.enabled \
          AND (cardinality(s.channels) = 0 OR c.channel = ANY(s.channels)) \
          AND CASE $2 \
                WHEN 'status_changed' THEN \
                  COALESCE(s.notify_statuses, p.notify_statuses) @> to_jsonb($3::text) \
                WHEN 'comment_added' THEN \
                  COALESCE(s.notify_comments, p.notify_comments) \
                WHEN 'issue_created' THEN \
                  COALESCE(s.notify_issue_created, p.notify_issue_created) \
                ELSE false \
              END";

    match sqlx::query_as::<_, Recipient>(sql)
        .bind(project_id)
        .bind(event)
        .bind(status_key.unwrap_or_default())
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            // A notification is never worth failing a write, but a silent empty
            // result would look exactly like "nobody subscribed".
            tracing::error!(error = %e, project_id = %project_id, event = %event,
                "notification.resolve_recipients.failed");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telegram_address_must_be_a_chat_id() {
        assert_eq!(validate_address("telegram", " 123456 ").unwrap(), "123456");
        // Groups are negative, and that minus sign has been the bug before.
        assert_eq!(
            validate_address("telegram", "-1003803857627").unwrap(),
            "-1003803857627"
        );
        // The three things people actually paste instead of a chat id.
        assert!(validate_address("telegram", "@rmzlb").is_err());
        assert!(validate_address("telegram", "https://t.me/rmzlb").is_err());
        assert!(validate_address("telegram", "").is_err());
    }

    #[test]
    fn email_needs_a_real_domain() {
        assert!(validate_address("email", "a@b.co").is_ok());
        assert!(validate_address("email", "a@localhost").is_err());
        assert!(validate_address("email", "nope").is_err());
    }

    #[test]
    fn unknown_channel_is_refused() {
        assert!(validate_address("carrier-pigeon", "x").is_err());
        assert!(require_supported_channel("carrier-pigeon").is_err());
        assert!(require_supported_channel("telegram").is_ok());
    }

    #[test]
    fn masking_never_reveals_a_usable_address() {
        // A chat id must not be reconstructable from what the API returns.
        let masked = crate::models::mask_address("telegram", "-1003803857627");
        assert_eq!(masked, "•••7627");
        assert!(!masked.contains("100380385"));
        // Too short to mask is replaced outright rather than "masked" in name only.
        assert_eq!(crate::models::mask_address("telegram", "123"), "•••");
        // Email keeps the domain: that is how you tell your own addresses apart.
        assert_eq!(
            crate::models::mask_address("email", "ramzi@baaton.dev"),
            "ra•••@baaton.dev"
        );
    }
}
