//! User notification preferences. Baaton owns project subscriptions; notifyd
//! owns Telegram bots, destinations, verification and delivery.

mod telegram;
pub use telegram::{create_telegram_link, delete_bot, get_bot, register_bot, send_test_notification, telegram_webhook};

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
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
    tracing::error!(error = %e, "notification preferences storage failed");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Notification settings unavailable"})))
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
fn effective_user_id(auth: &AuthUser) -> Result<String, ApiErr> {
    if auth.actor_key_id.is_some() {
        // These settings control a human's global destinations, not a key's
        // local resources. Legacy/read-only keys must not redirect them.
        if !auth.permissions.iter().any(|p| p == crate::permissions::ADMIN_FULL) {
            return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Notification settings require an explicit admin:full API key"}))));
        }
        return auth.on_behalf_of.clone().filter(|id| !id.is_empty()).ok_or_else(||
            (StatusCode::FORBIDDEN, Json(json!({"error": "This API key has no owner"}))));
    }
    Ok(auth.user_id.clone())
}

// ─────────────────────────── channels ───────────────────────────

pub async fn list_channels(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Extension(notifyd): Extension<Option<crate::notifyd::NotifydClient>>,
) -> Result<Json<ApiResponse<Vec<UserNotificationChannelView>>>, ApiErr> {
    let user_id = effective_user_id(&auth)?;
    let rows = sqlx::query_as::<_, UserNotificationChannelRow>(
        "SELECT channel, address, verified_at, created_at \
         FROM user_notification_channels WHERE user_id = $1 AND channel <> 'telegram' ORDER BY channel",
    )
    .bind(&user_id)
    .fetch_all(&pool)
    .await
    .map_err(internal)?;

    let mut channels: Vec<_> = rows.into_iter().map(|r| r.view()).collect();
    if let Some(destination) = telegram::destination(notifyd.as_ref(), &user_id).await? {
        channels.push(destination);
    }
    Ok(Json(ApiResponse::new(channels)))
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
    Extension(notifyd): Extension<Option<crate::notifyd::NotifydClient>>,
    Json(body): Json<UpsertUserNotificationChannel>,
) -> Result<Json<ApiResponse<UserNotificationChannelView>>, ApiErr> {
    require_supported_channel(&channel)?;
    let user_id = effective_user_id(&auth)?;
    if channel == "telegram" {
        return telegram::set_destination(notifyd.as_ref(), &user_id, body).await;
    }
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
    Extension(notifyd): Extension<Option<crate::notifyd::NotifydClient>>,
) -> Result<StatusCode, ApiErr> {
    let user_id = effective_user_id(&auth)?;
    if channel == "telegram" {
        return telegram::remove_destination(notifyd.as_ref(), &user_id).await;
    }
    sqlx::query("DELETE FROM user_notification_channels WHERE user_id = $1 AND channel = $2")
        .bind(&user_id)
        .bind(&channel)
        .execute(&pool)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ───────────────────── project subscriptions ─────────────────────

#[derive(sqlx::FromRow)]
struct SubscriptionRow {
    project_id: Uuid,
    project_name: String,
    project_slug: String,
    org_id: String,
    org_name: String,
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
            org_name: self.org_name,
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
           p.org_id, o.name AS org_name, p.statuses, \
           p.notify_statuses AS default_statuses, \
           p.notify_comments AS default_comments, \
           p.notify_issue_created AS default_issue_created, \
           s.enabled, s.notify_statuses, s.notify_comments, \
           s.notify_issue_created, s.channels \
    FROM projects p JOIN organizations o ON o.id = p.org_id \
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
    let user_id = effective_user_id(&auth)?;
    let org_ids = user_org_ids(&auth, &user_id).await?;

    let rows = sqlx::query_as::<_, SubscriptionRow>(&format!(
        "{SUBSCRIPTION_PROJECTION} WHERE p.org_id = ANY($2) AND (cardinality($3::uuid[]) = 0 OR p.id = ANY($3)) ORDER BY o.name, p.name"
    ))
    .bind(&user_id)
    .bind(&org_ids)
    .bind(&auth.scoped_project_ids)
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
    let user_id = effective_user_id(&auth)?;
    let org_ids = user_org_ids(&auth, &user_id).await?;

    if !auth.has_project_access(project_id) {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

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
    let user_id = effective_user_id(&auth)?;
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
async fn user_org_ids(auth: &AuthUser, user_id: &str) -> Result<Vec<String>, ApiErr> {
    if auth.actor_key_id.is_some() {
        return Ok(auth.scoped_org_ids.clone());
    }
    // A human JWT's scoped_org_ids mirrors only the active org. It must not
    // narrow the membership list on this cross-organization settings screen.
    fetch_user_org_ids(user_id).await.map_err(|_| (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error": "Could not load all organizations. Please retry."})),
    ))
}

// ───────────────────── recipient resolution ─────────────────────

/// One delivery: a person, a channel, an address.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Recipient {
    pub user_id: String,
    pub channel: String,
    pub address: String,
    #[sqlx(default)]
    pub telegram_route_id: Option<Uuid>,
}

#[derive(serde::Deserialize)]
struct TelegramRoute {
    owner: String,
    route_id: Uuid,
    address: String,
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
    notifyd: &crate::notifyd::NotifydClient,
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
        SELECT s.user_id, c.channel, c.address \
        FROM project_notification_subscriptions s \
        JOIN projects p ON p.id = s.project_id \
        CROSS JOIN LATERAL ( \
          SELECT channel, address FROM user_notification_channels \
           WHERE user_id = s.user_id AND channel <> 'telegram' \
          UNION ALL SELECT 'telegram'::text, ''::text \
        ) c \
        WHERE s.project_id = $1 \
          AND s.enabled \
          AND ($2 <> 'comment_added' OR s.user_id <> $4) \
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

    let mut recipients = match sqlx::query_as::<_, Recipient>(sql)
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
    };

    // Subscriptions survive org removal. Revalidate membership before exporting
    // project content; a stored subscription alone is not an access grant.
    let org: Option<String> = sqlx::query_scalar("SELECT org_id FROM projects WHERE id = $1")
        .bind(project_id).fetch_optional(pool).await.ok().flatten();
    let Some(org) = org else { return Vec::new(); };
    let owners: std::collections::HashSet<_> = recipients.iter().map(|r| r.user_id.clone()).collect();
    let mut authorized = std::collections::HashSet::new();
    for owner in owners {
        if fetch_user_org_ids(&owner).await.is_ok_and(|ids| ids.contains(&org)) {
            authorized.insert(owner);
        }
    }
    recipients.retain(|r| authorized.contains(&r.user_id));

    let owners: Vec<_> = recipients.iter().filter(|r| r.channel == "telegram")
        .map(|r| r.user_id.clone()).collect();
    if owners.is_empty() { return recipients; }
    let mut routes = std::collections::HashMap::new();
    // Bounded batches: notifyd is the sole source of current bots/destinations.
    for owners in owners.chunks(100) {
        match notifyd.integration_request(reqwest::Method::POST, "/v1/telegram/lookup", Some(json!({"owners": owners})), None).await {
            Ok(data) => match serde_json::from_value::<Vec<TelegramRoute>>(data.get("data").cloned().unwrap_or_default()) {
                Ok(found) => for route in found { routes.insert(route.owner.clone(), route); },
                Err(_) => tracing::error!("notification.telegram.invalid_lookup_response"),
            },
            Err(_) => tracing::error!("notification.telegram.lookup_failed"),
        }
    }
    recipients.retain_mut(|r| {
        if r.channel != "telegram" { return true; }
        match routes.remove(&r.user_id) {
            Some(route) => { r.address = route.address; r.telegram_route_id = Some(route.route_id); true },
            None => false,
        }
    });
    recipients
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

}
