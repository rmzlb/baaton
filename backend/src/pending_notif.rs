//! Digest window for email notifications.
//!
//! Instead of sending one email per event (comment, status change), events are
//! accumulated for 2 minutes from the first one. A background task flushes
//! rows whose `fire_at` has passed and sends a single digest email per
//! (issue × recipient) batch.
//!
//! Telegram (shared room and per-user) is unaffected: only email is deferred.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// A single activity event stored inside a pending batch.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DigestEvent {
    Comment {
        actor: String,
        body: String,
        at: DateTime<Utc>,
    },
    Transition {
        actor: String,
        from_status: String,
        to_status: String,
        at: DateTime<Utc>,
    },
}

/// Append a `DigestEvent` to the pending batch for `(issue_id, recipient_identity)`.
///
/// If no batch exists yet, one is created with `fire_at = NOW() + 2 min`.
/// Subsequent events for the same pair extend only the `events` array — the
/// window does **not** move (first-event semantics).
pub async fn queue_digest_event(
    pool: &PgPool,
    issue_id: Uuid,
    issue_display_id: &str,
    issue_title: &str,
    project_name: Option<&str>,
    recipient_identity: &str,
    event: &DigestEvent,
) -> Result<(), sqlx::Error> {
    let event_json = serde_json::to_value(event).unwrap_or_default();
    sqlx::query(
        r#"
        INSERT INTO pending_notifications
            (issue_id, issue_display_id, issue_title, project_name,
             recipient_identity, events, fire_at)
        VALUES ($1, $2, $3, $4, $5, jsonb_build_array($6::jsonb),
                NOW() + INTERVAL '2 minutes')
        ON CONFLICT (issue_id, recipient_identity) WHERE sent_at IS NULL
        DO UPDATE SET
            events = pending_notifications.events || jsonb_build_array($6::jsonb)
        "#,
    )
    .bind(issue_id)
    .bind(issue_display_id)
    .bind(issue_title)
    .bind(project_name)
    .bind(recipient_identity)
    .bind(event_json)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Internal row type ────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PendingRow {
    id: Uuid,
    issue_id: Uuid,
    issue_display_id: String,
    issue_title: String,
    project_name: Option<String>,
    recipient_identity: String,
    events: serde_json::Value,
}

// ── Flush worker ─────────────────────────────────────────────────────────────

/// Deliver all pending batches whose `fire_at` has passed.
///
/// Called from a background tokio task every 30 seconds.
/// Uses `FOR UPDATE SKIP LOCKED` so a future multi-instance deployment won't
/// double-deliver.
pub async fn flush_digests(
    pool: &PgPool,
    notifyd: &crate::notifyd::NotifydClient,
    public_url: &str,
) {
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::warn!(error = %e, "digest.flush.tx_begin_failed");
            return;
        }
    };

    let rows: Vec<PendingRow> = match sqlx::query_as(
        r#"SELECT id, issue_id, issue_display_id, issue_title, project_name,
                  recipient_identity, events
           FROM pending_notifications
           WHERE fire_at <= NOW() AND sent_at IS NULL
           FOR UPDATE SKIP LOCKED
           LIMIT 50"#,
    )
    .fetch_all(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "digest.flush.select_failed");
            return;
        }
    };

    if rows.is_empty() {
        return;
    }

    for row in &rows {
        let events: Vec<DigestEvent> = row
            .events
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();

        if !events.is_empty() {
            let (subject, html) = crate::email_templates::digest_email_html(
                &events,
                &row.issue_display_id,
                &row.issue_title,
                row.project_name.as_deref(),
                public_url,
            );
            let plain = digest_plain_text(&events, &row.issue_display_id, &row.issue_title);
            let key = format!("baaton-digest-{}-{}", row.issue_id, row.id);
            notifyd
                .post_send(serde_json::json!({
                    "channel": "email",
                    "to": row.recipient_identity,
                    "subject": subject,
                    "body_html": html,
                    "body": plain,
                    "idempotency_key": key,
                    "priority": "high"
                }))
                .await;
        }

        let _ = sqlx::query(
            "UPDATE pending_notifications SET sent_at = NOW() WHERE id = $1",
        )
        .bind(row.id)
        .execute(&mut *tx)
        .await;
    }

    if let Err(e) = tx.commit().await {
        tracing::warn!(error = %e, "digest.flush.commit_failed");
    }
}

// ── Plain-text fallback ───────────────────────────────────────────────────────

fn digest_plain_text(events: &[DigestEvent], display_id: &str, title: &str) -> String {
    let mut lines = vec![format!("{} — {}", display_id, title), String::new()];
    for ev in events {
        match ev {
            DigestEvent::Comment { actor, body, .. } => {
                lines.push(format!("{} commented:", actor));
                let excerpt: String = body.chars().take(200).collect();
                lines.push(format!("  \"{}\"", excerpt));
            }
            DigestEvent::Transition {
                actor,
                from_status,
                to_status,
                ..
            } => {
                if from_status.is_empty() {
                    lines.push(format!("{} set status: {}", actor, to_status));
                } else {
                    lines.push(format!(
                        "{} changed status: {} → {}",
                        actor, from_status, to_status
                    ));
                }
            }
        }
        lines.push(String::new());
    }
    lines.join("\n")
}
