//! Email recap at fixed times (BAA-38).
//!
//! Every notification email except an @mention is queued here, one row per
//! (recipient, event), and leaves as **one** recap per person at 08:00, 12:00,
//! 16:00 and 20:00 Europe/Paris — only when something new happened. A person
//! who follows three projects in two orgs gets one mail, grouped by project
//! then ticket. Ten tickets reaching review used to mean ten mails.
//!
//! Who receives what is decided upstream, at the event, by the same routing as
//! every channel (`notification_prefs::resolve_recipients` and the participant
//! default). This module adds the two email-only rules: nobody gets a mail
//! about their own action (an API key counts as its owner), and a comment that
//! already reached someone as an immediate @mention is not repeated.
//!
//! Delivery is at-least-once with a stable idempotency key per (person, slot):
//!
//! - claiming is serialised in Postgres, so two API instances never build or
//!   send the same recap twice;
//! - the events of a recap are frozen before its first attempt, so a retry
//!   resends identical content under the identical key, and a later event goes
//!   to the next recap instead of being swallowed by notifyd's deduplication;
//! - a failed send stays pending and is retried with backoff;
//! - org membership is checked again at send time: an event from an org the
//!   person left is removed, not mailed.
//!
//! A person can turn the recap off (`unsubscribe`, BAA-40): from the settings
//! or with the one-click link every recap carries. Nothing is queued for them
//! while it is off, and what was already queued is dropped.
//!
//! Telegram does not go through here and is unchanged.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::Europe::Paris;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::routes::notification_prefs::Recipient;

/// Local Paris hours at which recaps leave. Anything after the last one waits
/// for the first one of the next day.
pub const SLOT_HOURS: [u32; 4] = [8, 12, 16, 20];

/// How often the worker looks for due recaps. A recap leaves at most this long
/// after its slot.
pub const TICK: std::time::Duration = std::time::Duration::from_secs(60);

/// A send attempt that neither succeeded nor failed is reclaimed after this.
const LEASE: chrono::Duration = chrono::Duration::minutes(5);

/// Attempts before a recap is given up and marked `failed`. With the backoff
/// below this spans about four hours.
const MAX_ATTEMPTS: i32 = 8;

/// Sent and abandoned recaps are kept this long for diagnosis, then deleted
/// with their events.
const RETENTION_DAYS: i32 = 30;

/// Longest comment excerpt carried into a recap line.
const EXCERPT_CHARS: usize = 280;

/// The latest slot at or before `now`: the recap that is due at `now`.
///
/// An event created at `t` belongs to the first slot at or after `t`, so at
/// `now` every event created at or before this instant is due. Computed on the
/// Paris wall clock, so the slots stay at 08:00/12:00/16:00/20:00 local across
/// both DST changes. `None` only outside chrono's date range.
pub fn slot_at_or_before(now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let today = now.with_timezone(&Paris).date_naive();
    for date in [Some(today), today.pred_opt()].into_iter().flatten() {
        for &hour in SLOT_HOURS.iter().rev() {
            if let Some(slot) = paris_at(date, hour) {
                if slot <= now {
                    return Some(slot);
                }
            }
        }
    }
    None
}

/// `hour:00` on `date` in Paris. The slot hours never fall in a DST gap
/// (02:00–03:00), so `earliest` only matters if the rules ever change.
fn paris_at(date: NaiveDate, hour: u32) -> Option<DateTime<Utc>> {
    let local = date.and_hms_opt(hour, 0, 0)?;
    Paris
        .from_local_datetime(&local)
        .earliest()
        .map(|d| d.with_timezone(&Utc))
}

// ───────────────────────────── enqueue ─────────────────────────────

/// The ticket an event is about, as the recap will show it.
pub struct IssueRef<'a> {
    pub org_id: &'a str,
    pub project_id: Uuid,
    pub project_name: &'a str,
    pub issue_id: Uuid,
    pub display_id: &'a str,
    pub title: &'a str,
}

pub enum EventKind<'a> {
    IssueCreated,
    /// Human labels. `from` is empty for the initial status of a new ticket.
    StatusChanged {
        from: &'a str,
        to: &'a str,
    },
    CommentAdded {
        body: &'a str,
    },
}

impl EventKind<'_> {
    fn key(&self) -> &'static str {
        match self {
            EventKind::IssueCreated => "issue_created",
            EventKind::StatusChanged { .. } => "status_changed",
            EventKind::CommentAdded { .. } => "comment_added",
        }
    }
}

/// Split routed recipients into the email rows the recap takes and the rest.
///
/// The email rows lose the actor: whoever acted, directly or through one of
/// their API keys (`actor_owner` is already resolved to the human), already
/// knows. Telegram keeps the actor on status changes (decision 6c86f14), so the
/// other rows are returned untouched. One row per person: the recap is per
/// person, not per address.
pub fn split_email(
    recipients: Vec<Recipient>,
    actor_owner: &str,
) -> (Vec<Recipient>, Vec<Recipient>) {
    let (email, other): (Vec<_>, Vec<_>) =
        recipients.into_iter().partition(|r| r.channel == "email");
    let mut out: Vec<Recipient> = Vec::new();
    for r in email {
        if r.user_id == actor_owner || r.address.trim().is_empty() {
            continue;
        }
        if out.iter().any(|o| o.user_id == r.user_id) {
            continue;
        }
        out.push(r);
    }
    (out, other)
}

/// Queue one event for every email recipient. Idempotent per
/// (recipient, `dedupe_key`), so a path that runs twice queues once.
pub async fn enqueue(
    pool: &PgPool,
    recipients: &[Recipient],
    issue: &IssueRef<'_>,
    actor_name: &str,
    kind: &EventKind<'_>,
    dedupe_key: &str,
    occurred_at: DateTime<Utc>,
) {
    if recipients.is_empty() {
        return;
    }
    let users: Vec<&str> = recipients.iter().map(|r| r.user_id.as_str()).collect();
    let addresses: Vec<&str> = recipients.iter().map(|r| r.address.as_str()).collect();
    let reasons: Vec<&str> = recipients
        .iter()
        .map(|r| {
            if r.reason.is_empty() {
                "subscription"
            } else {
                r.reason.as_str()
            }
        })
        .collect();
    let (from, to, body) = match kind {
        EventKind::IssueCreated => (None, None, None),
        EventKind::StatusChanged { from, to } => (Some(*from), Some(*to), None),
        EventKind::CommentAdded { body } => (
            None,
            None,
            Some(crate::notifyd::excerpt_chars(body, EXCERPT_CHARS)),
        ),
    };
    let result = sqlx::query(
        "INSERT INTO email_digest_events \
           (user_id, address, reason, org_id, project_id, project_name, issue_id, \
            issue_display_id, issue_title, kind, actor_name, from_status, to_status, \
            body, dedupe_key, occurred_at) \
         SELECT u.user_id, u.address, u.reason, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16 \
           FROM unnest($1::text[], $2::text[], $3::text[]) AS u(user_id, address, reason) \
          WHERE NOT EXISTS (SELECT 1 FROM user_email_settings s \
                             WHERE s.user_id = u.user_id AND NOT s.recap_enabled) \
         ON CONFLICT (user_id, dedupe_key) DO NOTHING",
    )
    .bind(&users)
    .bind(&addresses)
    .bind(&reasons)
    .bind(issue.org_id)
    .bind(issue.project_id)
    .bind(issue.project_name)
    .bind(issue.issue_id)
    .bind(issue.display_id)
    .bind(issue.title)
    .bind(kind.key())
    .bind(actor_name)
    .bind(from)
    .bind(to)
    .bind(body)
    .bind(dedupe_key)
    .bind(occurred_at)
    .execute(pool)
    .await;
    if let Err(e) = result {
        // The write that caused the event already succeeded; losing its mail
        // must at least be visible.
        tracing::error!(error = %e, issue_id = %issue.issue_id, kind = kind.key(), "email_digest.enqueue_failed");
    }
}

// ───────────────────────────── delivery ─────────────────────────────

/// One queued event, as a recap renders it.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DigestLine {
    pub id: Uuid,
    pub address: String,
    pub org_id: String,
    pub project_id: Uuid,
    pub project_name: String,
    pub issue_display_id: String,
    pub issue_title: String,
    pub kind: String,
    pub actor_name: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub body: Option<String>,
    pub reason: String,
    pub occurred_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedDigest {
    pub id: Uuid,
    pub user_id: String,
    pub slot_at: DateTime<Utc>,
    pub attempts: i32,
}

#[derive(Debug)]
pub enum SendError {
    /// Network error, 5xx, 408, 409 or 429: the same request may succeed later.
    Retryable(String),
    /// Any other refusal: resending the same request cannot succeed.
    Permanent(String),
}

/// What delivery needs from the outside world, so the claim and retry rules
/// run against Postgres in tests without Clerk or notifyd.
pub trait Transport {
    /// Current org memberships of `user_id`.
    fn org_ids(
        &self,
        user_id: &str,
    ) -> impl std::future::Future<Output = Result<Vec<String>, String>> + Send;
    /// Hand one email to notifyd (`POST /v1/send`).
    fn send(
        &self,
        body: serde_json::Value,
    ) -> impl std::future::Future<Output = Result<(), SendError>> + Send;
}

/// Production transport: Clerk memberships (cached) and notifyd.
pub struct Live {
    pub notifyd: crate::notifyd::NotifydClient,
}

impl Transport for Live {
    async fn org_ids(&self, user_id: &str) -> Result<Vec<String>, String> {
        crate::routes::issues::fetch_user_org_ids(user_id).await
    }

    async fn send(&self, body: serde_json::Value) -> Result<(), SendError> {
        self.notifyd.try_send(body).await
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct TickReport {
    pub sent: usize,
    pub skipped: usize,
    pub retried: usize,
    pub failed: usize,
}

/// Idempotency key of one person's recap for one slot. Stable across retries
/// and across instances.
pub fn idempotency_key(user_id: &str, slot_at: DateTime<Utc>) -> String {
    format!("baaton-recap-{user_id}-{}", slot_at.timestamp())
}

/// Build, claim and send every recap due at `now`. `public_url` is the app
/// (ticket and settings links), `api_url` the API origin that serves the
/// unsubscribe link.
pub async fn tick<T: Transport>(
    pool: &PgPool,
    transport: &T,
    public_url: &str,
    api_url: &str,
    now: DateTime<Utc>,
) -> Result<TickReport, sqlx::Error> {
    let mut report = TickReport::default();
    let Some(slot) = slot_at_or_before(now) else {
        return Ok(report);
    };
    for digest in claim_due(pool, slot, now).await? {
        match deliver(pool, transport, public_url, api_url, &digest, now).await? {
            Outcome::Sent => report.sent += 1,
            Outcome::Skipped => report.skipped += 1,
            Outcome::Retry => report.retried += 1,
            Outcome::Failed => report.failed += 1,
        }
    }
    Ok(report)
}

/// Drop sent and abandoned recaps past retention, with their events.
pub async fn purge_old(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let done = sqlx::query(
        "DELETE FROM email_digests WHERE status <> 'pending' \
           AND created_at < now() - make_interval(days => $1)",
    )
    .bind(RETENTION_DAYS)
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}

/// Attach every due event to its person's recap for `slot`, then lease the
/// recaps ready to send.
///
/// One transaction behind an advisory lock: two instances never interleave
/// "attach events" with "start sending", which is what would let an event be
/// attached to a recap already rendered without it. An event joins a recap
/// only before that recap's first attempt; anything later waits for the next
/// slot.
pub async fn claim_due(
    pool: &PgPool,
    slot: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Vec<ClaimedDigest>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('baaton.email_digest'))")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO email_digests (user_id, slot_at, next_attempt_at) \
         SELECT DISTINCT user_id, $1, $1 FROM email_digest_events \
          WHERE digest_id IS NULL AND created_at <= $1 \
         ON CONFLICT (user_id, slot_at) DO NOTHING",
    )
    .bind(slot)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE email_digest_events e SET digest_id = d.id \
           FROM email_digests d \
          WHERE e.digest_id IS NULL AND e.created_at <= $1 \
            AND d.user_id = e.user_id AND d.slot_at = $1 \
            AND d.status = 'pending' AND d.attempts = 0",
    )
    .bind(slot)
    .execute(&mut *tx)
    .await?;
    let claimed = sqlx::query_as::<_, ClaimedDigest>(
        "UPDATE email_digests SET attempts = attempts + 1, locked_until = $2 \
          WHERE id IN ( \
            SELECT id FROM email_digests \
             WHERE status = 'pending' AND next_attempt_at <= $1 \
               AND (locked_until IS NULL OR locked_until <= $1) \
             ORDER BY slot_at, id LIMIT 50 \
             FOR UPDATE SKIP LOCKED) \
         RETURNING id, user_id, slot_at, attempts",
    )
    .bind(now)
    .bind(now + LEASE)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(claimed)
}

enum Outcome {
    Sent,
    Skipped,
    Retry,
    Failed,
}

async fn deliver<T: Transport>(
    pool: &PgPool,
    transport: &T,
    public_url: &str,
    api_url: &str,
    digest: &ClaimedDigest,
    now: DateTime<Utc>,
) -> Result<Outcome, sqlx::Error> {
    // Unsubscribed after this recap was queued.
    if !unsubscribe::recap_enabled(pool, &digest.user_id).await? {
        finish(pool, digest.id, "skipped", Some("unsubscribed")).await?;
        return Ok(Outcome::Skipped);
    }
    let lines: Vec<DigestLine> = sqlx::query_as(
        "SELECT id, address, org_id, project_id, project_name, issue_display_id, issue_title, \
                kind, actor_name, from_status, to_status, body, reason, occurred_at, created_at \
           FROM email_digest_events WHERE digest_id = $1 \
          ORDER BY occurred_at, created_at, id",
    )
    .bind(digest.id)
    .fetch_all(pool)
    .await?;

    let orgs = match transport.org_ids(&digest.user_id).await {
        Ok(orgs) => orgs,
        Err(e) => return reschedule(pool, digest, now, &format!("membership: {e}")).await,
    };
    let (lines, removed): (Vec<_>, Vec<_>) =
        lines.into_iter().partition(|l| orgs.contains(&l.org_id));
    if !removed.is_empty() {
        let ids: Vec<Uuid> = removed.iter().map(|l| l.id).collect();
        sqlx::query("DELETE FROM email_digest_events WHERE id = ANY($1)")
            .bind(&ids)
            .execute(pool)
            .await?;
    }
    if lines.is_empty() {
        finish(pool, digest.id, "skipped", None).await?;
        return Ok(Outcome::Skipped);
    }

    // The address in force when the latest event was routed.
    let address = lines
        .iter()
        .max_by_key(|l| (l.created_at, l.id))
        .map(|l| l.address.clone())
        .unwrap_or_default();
    let token = unsubscribe::token_for_digest(pool, digest.id, &digest.user_id).await?;
    let unsubscribe_url = unsubscribe::unsubscribe_url(api_url, &token);
    let mail =
        crate::email_templates::recap_email(&lines, digest.slot_at, public_url, &unsubscribe_url);
    let body = json!({
        "channel": "email",
        "to": address,
        "subject": mail.subject,
        // notifyd's field is `body_html`; `html` is silently ignored.
        "body_html": mail.html,
        "body": mail.text,
        "idempotency_key": idempotency_key(&digest.user_id, digest.slot_at),
        "priority": "normal",
        // RFC 8058 one-click. notifyd forwards them as MIME headers and never
        // replaces a `List-Unsubscribe` set by the caller.
        "email_headers": unsubscribe::email_headers(&unsubscribe_url),
    });
    match transport.send(body).await {
        Ok(()) => {
            finish(pool, digest.id, "sent", None).await?;
            Ok(Outcome::Sent)
        }
        Err(SendError::Retryable(e)) => reschedule(pool, digest, now, &e).await,
        Err(SendError::Permanent(e)) => {
            tracing::error!(digest_id = %digest.id, error = %e, "email_digest.send_refused");
            finish(pool, digest.id, "failed", Some(&e)).await?;
            Ok(Outcome::Failed)
        }
    }
}

/// Wait before attempt `attempts + 1`: 1, 2, 4, … minutes, capped at an hour.
fn backoff(attempts: i32) -> chrono::Duration {
    let exp = attempts.clamp(1, 7) - 1;
    chrono::Duration::minutes((1_i64 << exp).min(60))
}

async fn reschedule(
    pool: &PgPool,
    digest: &ClaimedDigest,
    now: DateTime<Utc>,
    error: &str,
) -> Result<Outcome, sqlx::Error> {
    if digest.attempts >= MAX_ATTEMPTS {
        tracing::error!(digest_id = %digest.id, error = %error, "email_digest.gave_up");
        finish(pool, digest.id, "failed", Some(error)).await?;
        return Ok(Outcome::Failed);
    }
    tracing::warn!(digest_id = %digest.id, attempts = digest.attempts, error = %error, "email_digest.retry");
    sqlx::query(
        "UPDATE email_digests SET locked_until = NULL, next_attempt_at = $2, last_error = $3 \
          WHERE id = $1",
    )
    .bind(digest.id)
    .bind(now + backoff(digest.attempts))
    .bind(error)
    .execute(pool)
    .await?;
    Ok(Outcome::Retry)
}

async fn finish(
    pool: &PgPool,
    id: Uuid,
    status: &str,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE email_digests SET status = $2, locked_until = NULL, last_error = $3, \
           unsubscribe_token = NULL, \
           sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END \
          WHERE id = $1",
    )
    .bind(id)
    .bind(status)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

/// The background loop started by `main`.
pub async fn run(
    pool: PgPool,
    notifyd: crate::notifyd::NotifydClient,
    public_url: String,
    api_url: String,
) {
    let transport = Live { notifyd };
    let mut interval = tokio::time::interval(TICK);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_purge: Option<DateTime<Utc>> = None;
    loop {
        interval.tick().await;
        let now = Utc::now();
        match tick(&pool, &transport, &public_url, &api_url, now).await {
            Ok(r) if r != TickReport::default() => tracing::info!(
                sent = r.sent,
                skipped = r.skipped,
                retried = r.retried,
                failed = r.failed,
                "email_digest.tick"
            ),
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "email_digest.tick_failed"),
        }
        if last_purge.is_none_or(|t| now - t > chrono::Duration::hours(24)) {
            match purge_old(&pool).await {
                Ok(n) => {
                    last_purge = Some(now);
                    if n > 0 {
                        tracing::info!(deleted = n, "email_digest.purged");
                    }
                }
                Err(e) => tracing::warn!(error = %e, "email_digest.purge_failed"),
            }
            if let Err(e) = unsubscribe::purge_old_tokens(&pool).await {
                tracing::warn!(error = %e, "email_digest.token_purge_failed");
            }
        }
    }
}

#[path = "email_digest/unsubscribe.rs"]
pub mod unsubscribe;

#[cfg(test)]
#[path = "email_digest/tests.rs"]
mod tests;
