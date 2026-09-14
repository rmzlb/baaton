//! Per-user notification routing, and the bots that carry it.
//!
//! Replaces `NOTIFYD_TELEGRAM_CHAT_ID`, an environment variable that was one
//! address for the whole instance. Adding a second user changed nothing, because
//! no field anywhere said where to reach them.
//!
//! Four questions, previously collapsed into deploy configuration:
//!
//! | question | owner |
//! |---|---|
//! | which bot sends | `telegram_bots` (a bot is created in @BotFather by a person) |
//! | where to reach someone | `user_notification_channels` (a chat id belongs to a person) |
//! | what they want to hear | `project_notification_subscriptions` (user × project) |
//! | which statuses exist | `projects.notify_statuses` (migration 073) |
//!
//! Nothing here reads the environment. An earlier version of this module asked
//! for `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and
//! `TELEGRAM_WEBHOOK_SECRET`, which was a reflex rather than a need:
//!
//! ```text
//! git show f6f6eab:backend/src/notifyd.rs | grep -c TELEGRAM_BOT_TOKEN  ->  0
//! ```
//!
//! Baaton had never held a bot token. Configuration also fixed the product to a
//! single bot owned by whoever deploys, which is the wrong shape for an
//! integration: a team that wants notifications under its own name cannot get
//! there through a deploy variable.
//!
//! Every `/me` route acts on the caller. There is no user id in any path: a
//! settings screen that could address another user's channels would be a way to
//! redirect someone else's notifications.

use axum::{
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::Engine as _;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
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
/// Start, short enough that a link left open in a tab stops being a way to
/// capture someone's notifications.
const LINK_TOKEN_TTL_MINUTES: i64 = 15;

/// 32 random bytes, URL-safe. Used for link tokens, which must fit Telegram's
/// deep-link alphabet (`[A-Za-z0-9_-]`) and its 64-character limit — 32 bytes
/// encode to 43 — and for webhook secrets, where only unguessability matters.
fn random_token() -> Result<String, ApiErr> {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| internal(format!("OsRng failed: {e}")))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

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
        // username, an invite link, a copied URL — Telegram will never accept.
        "telegram" => address
            .parse::<i64>()
            .map(|id| id.to_string())
            .map_err(|_| {
                "A Telegram chat id is a number (negative for a group). Press Start on the bot, \
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


/// The person these settings belong to.
///
/// An API key is not a person, but it *belongs* to one: `resolve_owner_identity`
/// maps `apikey:<uuid>` to the human who created it. So an agent holding a key
/// configures its owner's notifications, which is the only reading that makes
/// sense — the key was issued by that person, and the very same collapse already
/// decides who must not be notified of that key's actions.
///
/// A key whose creator is unknown is refused. There would be no person to
/// configure, and picking one anyway would hand somebody else's notifications to
/// a credential.
async fn effective_user_id(pool: &PgPool, auth: &AuthUser) -> Result<String, ApiErr> {
    let resolved = crate::routes::comments::resolve_owner_identity(pool, &auth.user_id).await;
    if resolved.starts_with("apikey:") {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "This API key has no owner",
                "detail": "Notification settings belong to a person. Recreate the key from a \
                           user account so it inherits an owner.",
            })),
        ));
    }
    Ok(resolved)
}

// ─────────────────────────── channels ───────────────────────────

pub async fn list_channels(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<UserNotificationChannelView>>>, ApiErr> {
    let user_id = effective_user_id(&pool, &auth).await?;
    let rows = sqlx::query_as::<_, UserNotificationChannelRow>(
        "SELECT channel, address, verified_at, created_at \
         FROM user_notification_channels WHERE user_id = $1 ORDER BY channel",
    )
    .bind(&user_id)
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
    let user_id = effective_user_id(&pool, &auth).await?;
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
    .bind(&user_id)
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
    let user_id = effective_user_id(&pool, &auth).await?;
    sqlx::query("DELETE FROM user_notification_channels WHERE user_id = $1 AND channel = $2")
        .bind(&user_id)
        .bind(&channel)
        .execute(&pool)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ───────────────────────── the bot itself ─────────────────────────

/// A bot row, as the send and link paths need it.
#[derive(Debug, sqlx::FromRow)]
pub struct TelegramBot {
    pub id: Uuid,
    pub bot_username: String,
    pub bot_token: String,
    pub webhook_secret: String,
}

/// What a settings screen may see. Never the token: a bot token lets its holder
/// impersonate the bot entirely, and an integrations page has no use for it once
/// it is stored.
#[derive(Debug, Serialize)]
pub struct TelegramBotView {
    pub bot_username: String,
    pub owned: bool,
    pub webhook_registered: bool,
}

#[derive(Debug, Deserialize)]
pub struct RegisterTelegramBot {
    pub bot_token: String,
}

/// The bot serving this user: their own when they registered one, otherwise the
/// instance bot. `NULLS LAST` makes that precedence explicit rather than leaving
/// it to row order.
async fn bot_for_user(pool: &PgPool, user_id: &str) -> Option<TelegramBot> {
    sqlx::query_as::<_, TelegramBot>(
        "SELECT id, bot_username, bot_token, webhook_secret FROM telegram_bots \
         WHERE owner_user_id = $1 OR owner_user_id IS NULL \
         ORDER BY owner_user_id NULLS LAST LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

pub async fn get_bot(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Option<TelegramBotView>>>, ApiErr> {
    let user_id = effective_user_id(&pool, &auth).await?;
    let row: Option<(String, Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
        sqlx::query_as(
            "SELECT bot_username, owner_user_id, webhook_registered_at FROM telegram_bots \
             WHERE owner_user_id = $1 OR owner_user_id IS NULL \
             ORDER BY owner_user_id NULLS LAST LIMIT 1",
        )
        .bind(&user_id)
        .fetch_optional(&pool)
        .await
        .map_err(internal)?;

    Ok(Json(ApiResponse::new(row.map(
        |(bot_username, owner, registered)| TelegramBotView {
            bot_username,
            owned: owner.is_some(),
            webhook_registered: registered.is_some(),
        },
    ))))
}

/// Register the caller's own bot from a @BotFather token.
///
/// Three steps that must all succeed, because any one of them left undone is a
/// bot that looks configured and never delivers:
///
/// 1. `getMe` proves the token works and yields the username the deep link needs,
///    so the stored name can never drift from the credential.
/// 2. A per-bot webhook secret is generated here. Per bot, never shared: one
///    leaked secret must not let anyone forge updates for every other bot.
/// 3. `setWebhook` points Telegram at this instance. Until it returns, no update
///    will ever arrive, which is the difference between configured and working.
pub async fn register_bot(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(body): Json<RegisterTelegramBot>,
) -> Result<Json<ApiResponse<TelegramBotView>>, ApiErr> {
    let user_id = effective_user_id(&pool, &auth).await?;
    let token = body.bot_token.trim().to_string();
    if token.is_empty() {
        return Err(bad_request(
            "Missing bot token",
            "Create a bot with @BotFather and paste the token it gives you.",
        ));
    }

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(internal)?;

    // Ask Telegram, rather than trusting the shape of the string: a token that
    // parses but is revoked would otherwise be stored as working.
    let me = http
        .get(format!("https://api.telegram.org/bot{token}/getMe"))
        .send()
        .await
        .map_err(|e| bad_request("Telegram unreachable", &e.to_string()))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| bad_request("Telegram sent an unreadable answer", &e.to_string()))?;

    let username = me
        .pointer("/result/username")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            bad_request(
                "Telegram rejected this bot token",
                me.get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("getMe returned no username"),
            )
        })?
        .to_string();

    let secret = random_token()?;

    let bot_id: Uuid = sqlx::query_scalar(
        "INSERT INTO telegram_bots (owner_user_id, bot_username, bot_token, webhook_secret) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL DO UPDATE \
           SET bot_username = EXCLUDED.bot_username, \
               bot_token = EXCLUDED.bot_token, \
               webhook_secret = EXCLUDED.webhook_secret, \
               webhook_registered_at = NULL, \
               updated_at = now() \
         RETURNING id",
    )
    .bind(&user_id)
    .bind(&username)
    .bind(&token)
    .bind(&secret)
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    // The instance's own address, taken from the request that reached it. Asking
    // for it as configuration would be a fourth variable describing something
    // the request already proves.
    let base = public_base(&headers).ok_or_else(|| {
        internal("cannot determine this instance's public URL from the request headers")
    })?;
    let webhook_url = format!("{base}/api/v1/public/telegram/webhook/{bot_id}");

    let set = http
        .post(format!("https://api.telegram.org/bot{token}/setWebhook"))
        .json(&json!({
            "url": webhook_url,
            "secret_token": secret,
            // Only what this feature reads. Asking for everything would make the
            // bot receive every group message it can see.
            "allowed_updates": ["message"],
            // Discard whatever queued while no webhook was set. Those updates are
            // stale `/start` commands whose link tokens have expired, and
            // replaying them on registration would answer "this link expired" to
            // someone who just pressed Start.
            "drop_pending_updates": true,
            // Telegram's default is 40 simultaneous connections per bot. This
            // endpoint only handles someone pressing Start, so 40 is headroom for
            // load nobody will send; the docs call for lower values to limit the
            // load on the receiving server.
            "max_connections": 5,
        }))
        .send()
        .await
        .map_err(|e| bad_request("Telegram unreachable", &e.to_string()))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| bad_request("Telegram sent an unreadable answer", &e.to_string()))?;

    let registered = set.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if registered {
        let _ = sqlx::query(
            "UPDATE telegram_bots SET webhook_registered_at = now(), updated_at = now() \
             WHERE id = $1",
        )
        .bind(bot_id)
        .execute(&pool)
        .await;
    } else {
        // Keep the row: the token is valid and re-registering is one retry, while
        // discarding it would send the user back to @BotFather for nothing.
        tracing::warn!(
            bot_id = %bot_id,
            detail = ?set.get("description"),
            "telegram.setwebhook.refused"
        );
    }

    Ok(Json(ApiResponse::new(TelegramBotView {
        bot_username: username,
        owned: true,
        webhook_registered: registered,
    })))
}

pub async fn delete_bot(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<StatusCode, ApiErr> {
    let user_id = effective_user_id(&pool, &auth).await?;
    // Tell Telegram to stop sending, before the credential disappears. Skipping
    // this leaves a webhook pointing at an instance that can no longer identify
    // the bot, and Telegram retries a failing webhook for a long time.
    let row: Option<(String,)> =
        sqlx::query_as("SELECT bot_token FROM telegram_bots WHERE owner_user_id = $1")
            .bind(&user_id)
            .fetch_optional(&pool)
            .await
            .map_err(internal)?;

    if let Some((token,)) = row {
        let _ = reqwest::Client::new()
            .post(format!("https://api.telegram.org/bot{token}/deleteWebhook"))
            .timeout(std::time::Duration::from_secs(10))
            // Drop the queue with the registration. Leaving it would deliver a
            // backlog to whichever bot is registered next.
            .json(&json!({ "drop_pending_updates": true }))
            .send()
            .await;
    }

    sqlx::query("DELETE FROM telegram_bots WHERE owner_user_id = $1")
        .bind(&user_id)
        .execute(&pool)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// This instance's public origin, from the proxy headers of the live request.
fn public_base(headers: &HeaderMap) -> Option<String> {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|v| v.to_str().ok())?
        .trim()
        .to_string();
    if host.is_empty() {
        return None;
    }
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("https")
        .trim();
    Some(format!("{proto}://{host}"))
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
    let user_id = effective_user_id(&pool, &auth).await?;
    let bot = bot_for_user(&pool, &user_id).await.ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "No Telegram bot available",
                "detail": "Create a bot with @BotFather and register its token, \
                          or ask an administrator to register the instance bot.",
            })),
        )
    })?;

    let token = random_token()?;

    // The bot travels with the token: the update comes back through that bot's
    // webhook, and a chat id is only usable by the bot that obtained it.
    let expires_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "INSERT INTO telegram_link_tokens (token, user_id, expires_at, telegram_bot_id) \
         VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4) RETURNING expires_at",
    )
    .bind(&token)
    .bind(&user_id)
    .bind(LINK_TOKEN_TTL_MINUTES.to_string())
    .bind(bot.id)
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    Ok(Json(ApiResponse::new(TelegramLink {
        deep_link: format!("https://t.me/{}?start={token}", bot.bot_username),
        expires_at,
    })))
}

/// Receive Telegram updates: the missing half of the loop.
///
/// notifyd sends but never listens, so nothing in the stack could learn a chat
/// id. This endpoint is that ear. It lives under `/public/` because Telegram
/// cannot present a Clerk token; the bot id in the path says which bot is
/// speaking, and that bot's own secret authenticates the call.
///
/// Always answers 200. Telegram retries anything else, and a token already
/// consumed would be retried forever.
pub async fn telegram_webhook(
    State(pool): State<PgPool>,
    Path(bot_id): Path<Uuid>,
    headers: HeaderMap,
    Json(update): Json<serde_json::Value>,
) -> StatusCode {
    let bot: Option<TelegramBot> = sqlx::query_as(
        "SELECT id, bot_username, bot_token, webhook_secret FROM telegram_bots WHERE id = $1",
    )
    .bind(bot_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let Some(bot) = bot else {
        tracing::warn!(bot_id = %bot_id, "telegram.webhook.unknown_bot");
        return StatusCode::OK;
    };

    let presented = headers
        .get("x-telegram-bot-api-secret-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !secret_matches(presented, &bot.webhook_secret) {
        tracing::warn!(bot_id = %bot_id, "telegram.webhook.bad_secret");
        return StatusCode::OK;
    }

    // A group promoted to a supergroup gets a new chat id, and the old one stops
    // working for good. Telegram announces it once, in this field of a single
    // update; missing it turns a working destination into permanent silence that
    // looks like a bug in the notifications rather than a moved chat.
    if let Some(new_id) = update
        .pointer("/message/migrate_to_chat_id")
        .and_then(|v| v.as_i64())
    {
        if let Some(old_id) = update.pointer("/message/chat/id").and_then(|v| v.as_i64()) {
            match sqlx::query(
                "UPDATE user_notification_channels SET address = $1, updated_at = now() \
                 WHERE channel = 'telegram' AND address = $2 AND telegram_bot_id = $3",
            )
            .bind(new_id.to_string())
            .bind(old_id.to_string())
            .bind(bot.id)
            .execute(&pool)
            .await
            {
                Ok(r) => tracing::info!(
                    rows = r.rows_affected(),
                    "telegram.webhook.chat_migrated"
                ),
                Err(e) => tracing::error!(error = %e, "telegram.webhook.chat_migration_failed"),
            }
        }
        return StatusCode::OK;
    }

    let text = update
        .pointer("/message/text")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim();
    let Some(chat_id) = update.pointer("/message/chat/id").and_then(|v| v.as_i64()) else {
        return StatusCode::OK;
    };

    // `/start` with no payload is someone opening the bot directly: tell them
    // how to link rather than ignoring them.
    let Some(payload) = text.strip_prefix("/start").map(str::trim) else {
        return StatusCode::OK;
    };
    if payload.is_empty() {
        send_telegram_reply(
            &bot.bot_token,
            chat_id,
            "Pour recevoir les notifications Baaton, ouvre Réglages → Notifications dans Baaton \
             et clique sur « Connecter Telegram ».",
        );
        return StatusCode::OK;
    }

    // Consume the token and read its owner in one statement: two queries would
    // let the same link be redeemed twice concurrently. Scoped to this bot, so a
    // link cannot be replayed through a bot it was never minted for.
    let claimed: Option<(String,)> = sqlx::query_as(
        "UPDATE telegram_link_tokens SET used_at = now() \
         WHERE token = $1 AND telegram_bot_id = $2 AND used_at IS NULL AND expires_at > now() \
         RETURNING user_id",
    )
    .bind(payload)
    .bind(bot.id)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    let Some((user_id,)) = claimed else {
        // Distinguish the failures: "already used" and "never existed" are
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
        send_telegram_reply(&bot.bot_token, chat_id, msg);
        return StatusCode::OK;
    };

    let stored = sqlx::query(
        "INSERT INTO user_notification_channels \
           (user_id, channel, address, verified_at, telegram_bot_id) \
         VALUES ($1, 'telegram', $2, now(), $3) \
         ON CONFLICT (user_id, channel) DO UPDATE \
           SET address = EXCLUDED.address, \
               verified_at = now(), \
               telegram_bot_id = EXCLUDED.telegram_bot_id, \
               updated_at = now()",
    )
    .bind(&user_id)
    .bind(chat_id.to_string())
    .bind(bot.id)
    .execute(&pool)
    .await;

    match stored {
        Ok(_) => {
            tracing::info!(user_id = %user_id, bot_id = %bot.id, "telegram.webhook.linked");
            send_telegram_reply(
                &bot.bot_token,
                chat_id,
                "✅ Telegram connecté. Choisis les projets à suivre dans Baaton → Réglages → \
                 Notifications.",
            );
        }
        Err(e) => tracing::error!(error = %e, "telegram.webhook.link_failed"),
    }
    StatusCode::OK
}

/// Compare two secrets without leaking their contents through timing.
///
/// `==` on a string returns as soon as two bytes differ, so the time it takes
/// says how much of a guess was right. The webhook secret is a credential
/// presented by a caller we do not otherwise trust, which is exactly the input
/// this applies to.
fn secret_matches(presented: &str, expected: &str) -> bool {
    let (a, b) = (presented.as_bytes(), expected.as_bytes());
    // Length is not secret — Telegram's own limit publishes the range — but the
    // fold must still run over a fixed operand to stay constant-time.
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Confirm in the chat itself, without making Telegram wait.
///
/// Telegram repeats any webhook call that does not answer 2XY and gives up after
/// a number of attempts, so the handler must return before a slow `sendMessage`:
/// the reply is courtesy, the 200 is the contract.
fn send_telegram_reply(bot_token: &str, chat_id: i64, text: &str) {
    let token = bot_token.to_string();
    let text = text.to_string();
    tokio::spawn(async move {
        let _ = reqwest::Client::new()
            .post(format!("https://api.telegram.org/bot{token}/sendMessage"))
            .timeout(std::time::Duration::from_secs(5))
            .json(&json!({ "chat_id": chat_id, "text": text }))
            .send()
            .await;
    });
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
            // No row means not subscribed, which reads as disabled rather than as
            // a missing project.
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

const SUBSCRIPTION_PROJECTION: &str = "\
    SELECT p.id AS project_id, p.name AS project_name, p.slug AS project_slug, \
           p.org_id, p.statuses, \
           p.notify_statuses AS default_statuses, \
           p.notify_comments AS default_comments, \
           p.notify_issue_created AS default_issue_created, \
           s.enabled, s.notify_statuses, s.notify_comments, \
           s.notify_issue_created, s.channels \
    FROM projects p \
    LEFT JOIN project_notification_subscriptions s \
      ON s.project_id = p.id AND s.user_id = $1 ";

/// Every project the caller can see, subscribed or not.
///
/// A LEFT JOIN, not an inner one: a settings screen listing only existing
/// subscriptions could never be used to create the first one.
pub async fn list_subscriptions(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<ProjectSubscriptionView>>>, ApiErr> {
    let user_id = effective_user_id(&pool, &auth).await?;
    let org_ids = user_org_ids(&auth, &user_id).await;

    let rows = sqlx::query_as::<_, SubscriptionRow>(&format!(
        "{SUBSCRIPTION_PROJECTION} WHERE p.org_id = ANY($2) ORDER BY p.org_id, p.name"
    ))
    .bind(&user_id)
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
    let user_id = effective_user_id(&pool, &auth).await?;
    let org_ids = user_org_ids(&auth, &user_id).await;

    // The project must be one the caller can see. Without this, any uuid would
    // create a subscription row — and reveal by its success that it exists.
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

    // Validate against this project's own workflow. A silently-ignored key is the
    // worst outcome: the UI would show a notification enabled while nothing fires.
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

    // `Option<Option<T>>` collapses here: the field absent leaves the stored value
    // alone, an explicit null resets to "inherit the project". The boolean flags
    // say which case applies, because a NULL bind alone cannot express it.
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
    .bind(&user_id)
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
    let row = sqlx::query_as::<_, SubscriptionRow>(&format!(
        "{SUBSCRIPTION_PROJECTION} WHERE p.id = $2"
    ))
    .bind(&user_id)
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
    let user_id = effective_user_id(&pool, &auth).await?;
    sqlx::query(
        "DELETE FROM project_notification_subscriptions WHERE user_id = $1 AND project_id = $2",
    )
    .bind(&user_id)
    .bind(project_id)
    .execute(&pool)
    .await
    .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}


/// Orgs whose projects the caller may subscribe to. A channel is the person's,
/// so their subscriptions span every org they belong to — the request's current
/// org is not the boundary here.
///
/// For an API key, the owner's memberships are the right set, but a key may also
/// carry its own org scoping; both are honoured, since a key must never reach
/// further than the org it was scoped to.
async fn user_org_ids(auth: &AuthUser, user_id: &str) -> Vec<String> {
    let mut ids = fetch_user_org_ids(user_id).await.unwrap_or_default();
    if !auth.scoped_org_ids.is_empty() {
        ids.retain(|id| auth.scoped_org_ids.contains(id));
        for id in &auth.scoped_org_ids {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
    }
    // Clerk can be slow or down. Falling back to the request's org keeps the
    // screen usable instead of showing an empty project list, which would read as
    // "you have no projects".
    if ids.is_empty() {
        if let Some(org) = auth.org_id.clone() {
            ids.push(org);
        }
    }
    ids
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
///
/// `actor_identity` is never notified. Nobody needs to be told what they just
/// did, and this is what keeps a feed readable in practice: an agent working
/// through somebody's API key *is* that person, so `resolve_owner_identity`
/// collapses `apikey:<uuid>` to its creator before the exclusion. Without it,
/// running an agent on your own project turns your own notifications into spam.
pub async fn resolve_recipients(
    pool: &PgPool,
    project_id: Uuid,
    event: &str,
    status_key: Option<&str>,
    actor_identity: Option<&str>,
) -> Vec<Recipient> {
    // Empty string rather than NULL: `<>` against NULL is NULL, which would
    // silently drop every row and look exactly like "nobody subscribed".
    let actor = match actor_identity {
        Some(id) => crate::routes::comments::resolve_owner_identity(pool, id).await,
        None => String::new(),
    };

    let sql = "\
        SELECT c.user_id, c.channel, c.address \
        FROM project_notification_subscriptions s \
        JOIN projects p ON p.id = s.project_id \
        JOIN user_notification_channels c ON c.user_id = s.user_id \
        WHERE s.project_id = $1 \
          AND s.enabled \
          AND c.user_id <> $4 \
          AND (cardinality(s.channels) = 0 OR c.channel = ANY(s.channels)) \
          AND (c.channel != 'telegram' OR c.verified_at IS NOT NULL) \
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
        .bind(&actor)
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
        // The three things people paste instead of a chat id.
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

    #[test]
    fn random_tokens_fit_telegram_deep_links() {
        let a = random_token().unwrap();
        let b = random_token().unwrap();
        assert_ne!(a, b, "two tokens must never collide");
        // Telegram caps a start payload at 64 characters and accepts only
        // [A-Za-z0-9_-]; a token outside that is a link that cannot be opened.
        assert!(a.len() <= 64, "token too long for a deep link: {}", a.len());
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "token outside Telegram's deep-link alphabet: {a}"
        );
    }

    #[test]
    fn secret_comparison_accepts_only_the_exact_secret() {
        assert!(secret_matches("abc", "abc"));
        assert!(!secret_matches("abc", "abd"));
        // A prefix must not pass: that is what a naive `starts_with` would let
        // through, and it would accept a truncated guess.
        assert!(!secret_matches("ab", "abc"));
        assert!(!secret_matches("abcd", "abc"));
        // An absent header arrives as an empty string, which must never match a
        // configured secret.
        assert!(!secret_matches("", "abc"));
    }

    #[test]
    fn generated_secret_fits_telegram_rules() {
        let secret = random_token().unwrap();
        // setWebhook accepts 1-256 characters, and only A-Z, a-z, 0-9, _ and -.
        // Outside that range Telegram refuses the registration, leaving a bot
        // that never receives anything.
        assert!((1..=256).contains(&secret.len()));
        assert!(
            secret
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "secret outside Telegram's allowed alphabet: {secret}"
        );
    }

    #[test]
    fn webhook_url_follows_the_proxy_headers() {
        let mut h = HeaderMap::new();
        h.insert("host", "api.baaton.dev".parse().unwrap());
        assert_eq!(public_base(&h).unwrap(), "https://api.baaton.dev");

        // A proxy's own view wins: the internal host would build a webhook URL
        // Telegram cannot reach.
        h.insert("x-forwarded-host", "api.baaton.dev".parse().unwrap());
        h.insert("x-forwarded-proto", "http".parse().unwrap());
        assert_eq!(public_base(&h).unwrap(), "http://api.baaton.dev");

        assert!(public_base(&HeaderMap::new()).is_none());
    }
}
