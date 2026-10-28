//! Immediate email to the creator of a ticket that reaches In Review.
//!
//! The person who asked for the work hears it is ready to check as soon as it
//! is, not at the next recap (`email_digest`, 08:00/12:00/16:00/20:00). Like an
//! @mention, it is mailed whatever their role, subscriptions or recap switch,
//! and the same transition is not repeated in their recap. Telegram is
//! unchanged.
//!
//! "Creator" means the humans behind the ticket: whoever filed it, an API key
//! counting as its owner (a key with no owner is nobody), and the member it was
//! filed for when a key filed it (`reporter_email`). Never the actor: moving
//! your own ticket, or having your agent move it, sends you nothing.
//!
//! Delivery: one mail per person and transition, under an idempotency key of
//! (ticket, transition time, person), so a retry never doubles it. notifyd owns
//! delivery once it accepted the job; a refusal, or notifyd unreachable for a
//! few minutes, hands the transition back to the person's recap instead of
//! losing it.

use std::time::Duration;

use serde_json::json;
use sqlx::PgPool;

use crate::email_digest::SendError;
use crate::email_templates::{in_review_email, ReviewMail};
use crate::notifyd::NotifydClient;
use crate::routes::notification_prefs::Recipient;

/// Status key that triggers the mail. A key, not a label: projects rename
/// their columns.
pub const STATUS: &str = "in_review";

/// Waits before attempts 2, 3 and 4 when notifyd cannot be reached.
const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(5),
    Duration::from_secs(30),
    Duration::from_secs(120),
];

/// Why a person gets the mail, as its footer says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Why {
    /// Filed the ticket, directly or through one of their API keys.
    Creator,
    /// A key filed it for them (`reporter_email`).
    Reporter,
}

/// One person to mail, before membership and address are checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub user_id: String,
    pub why: Why,
}

/// A target that passed the membership check and has an address.
#[derive(Debug, Clone)]
pub struct Addressed {
    pub user_id: String,
    pub address: String,
    pub why: Why,
}

/// Who the mail goes to. Every identity is already resolved to its human:
/// `creator_owner` is the owner of the filing key when a key filed the ticket
/// (still `apikey:…` when the key has no owner), `reporter` the member a key
/// filed it for, `actor_owner` whoever moved it, keys collapsed to their owner.
pub fn targets(
    creator_owner: Option<&str>,
    reporter: Option<&str>,
    actor_owner: &str,
) -> Vec<Target> {
    let mut out: Vec<Target> = Vec::new();
    for (id, why) in [(creator_owner, Why::Creator), (reporter, Why::Reporter)] {
        let Some(id) = id.map(str::trim).filter(|id| !id.is_empty()) else {
            continue;
        };
        // A key nobody owns stays `apikey:…`: there is no person to tell.
        if id.starts_with("apikey:") || id == actor_owner {
            continue;
        }
        if out.iter().any(|t| t.user_id == id) {
            continue;
        }
        out.push(Target {
            user_id: id.to_string(),
            why,
        });
    }
    out
}

/// Split the email rows routed to the recap for this transition: the people
/// who just got the immediate mail, and everybody else.
pub fn split_recap(
    email_rows: Vec<Recipient>,
    mailed: &[String],
) -> (Vec<Recipient>, Vec<Recipient>) {
    email_rows
        .into_iter()
        .partition(|r| mailed.contains(&r.user_id))
}

/// The people to mail for a ticket of `org_id` that just reached In Review:
/// current members of the org, each with an address. `reporter` is the member
/// a key filed the ticket for (`notification_prefs::reporter_member`).
pub async fn resolve(
    pool: &PgPool,
    org_id: &str,
    created_by_id: Option<&str>,
    reporter: Option<&str>,
    actor_owner: &str,
) -> Vec<Addressed> {
    let creator_owner = match created_by_id {
        Some(id) => Some(crate::routes::comments::resolve_owner_identity(pool, id).await),
        None => None,
    };
    let mut out = Vec::new();
    for t in targets(creator_owner.as_deref(), reporter, actor_owner) {
        // Someone who left the org must not receive its content. A failed
        // lookup skips the mail; routing may still carry the move in the recap.
        match crate::routes::issues::fetch_user_org_ids(&t.user_id).await {
            Ok(ids) if ids.iter().any(|o| o == org_id) => {}
            Ok(_) => {
                tracing::info!(user_id = %t.user_id, "review_mail.skip_not_member");
                continue;
            }
            Err(e) => {
                tracing::warn!(user_id = %t.user_id, error = %e, "review_mail.membership_lookup_failed");
                continue;
            }
        }
        match address(pool, &t.user_id).await {
            Some(address) => out.push(Addressed {
                user_id: t.user_id,
                address,
                why: t.why,
            }),
            None => tracing::warn!(user_id = %t.user_id, "review_mail.no_address"),
        }
    }
    out
}

/// The notification address the person confirmed, else their account email
/// (verified by Clerk). Unlike the recap, an unconfirmed notification address
/// does not leave them without the mail.
async fn address(pool: &PgPool, user_id: &str) -> Option<String> {
    let chosen: Option<String> = sqlx::query_scalar(
        "SELECT address FROM user_notification_channels \
          WHERE user_id = $1 AND channel = 'email' AND verified_at IS NOT NULL \
          ORDER BY verified_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if let Some(address) = chosen.filter(|a| !a.trim().is_empty()) {
        return Some(address);
    }
    match crate::middleware::resolve_profile_cached(user_id).await {
        Some((_, Some(email))) if !email.trim().is_empty() => Some(email),
        _ => None,
    }
}

/// Mail every person in `to`. Returns the user ids it could not reach, for the
/// caller to put back in their recap.
pub async fn deliver(
    notifyd: &NotifydClient,
    to: &[Addressed],
    mail: &ReviewMail<'_>,
    issue_id: uuid::Uuid,
    changed_at: chrono::DateTime<chrono::Utc>,
) -> Vec<String> {
    let Some(public_url) = notifyd.public_url() else {
        // Without it the ticket link would be dead: the recap takes over.
        tracing::error!("review_mail.no_public_url: NOTIFYD_PUBLIC_URL is unset");
        return to.iter().map(|p| p.user_id.clone()).collect();
    };
    let mut failed = Vec::new();
    for person in to {
        let rendered = in_review_email(mail, person.why, public_url);
        let body = json!({
            "channel": "email",
            "to": person.address,
            "subject": rendered.subject,
            // notifyd's field is `body_html`; `html` is silently ignored.
            "body_html": rendered.html,
            "body": rendered.text,
            "idempotency_key": format!(
                "baaton-in-review-{issue_id}-{}-{}",
                changed_at.timestamp_millis(),
                person.user_id
            ),
            "priority": "high",
        });
        if send(notifyd, body).await {
            tracing::info!(issue = %mail.display_id, user_id = %person.user_id, "review_mail.sent");
        } else {
            failed.push(person.user_id.clone());
        }
    }
    failed
}

/// `POST /v1/send`, retried while notifyd cannot be reached. `true` once
/// accepted; the idempotency key makes a resend after an unknown outcome safe.
async fn send(notifyd: &NotifydClient, body: serde_json::Value) -> bool {
    let mut delays = RETRY_DELAYS.iter();
    loop {
        match notifyd.try_send(body.clone()).await {
            Ok(()) => return true,
            Err(SendError::Permanent(e)) => {
                tracing::error!(error = %e, "review_mail.send_refused");
                return false;
            }
            Err(SendError::Retryable(e)) => match delays.next() {
                Some(delay) => {
                    tracing::warn!(error = %e, "review_mail.retry");
                    tokio::time::sleep(*delay).await;
                }
                None => {
                    tracing::error!(error = %e, "review_mail.gave_up");
                    return false;
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    //! Ways the targeting can break, each pinned below:
    //!
    //! 1. The actor gets a mail about their own move, directly or because the
    //!    key that moved it is theirs (the spam BAA-38 removed).
    //! 2. A ticket filed by a key with no owner mails nobody, or mails the key.
    //! 3. A ticket a key filed for a member does not reach that member.
    //! 4. A person who is both creator and reporter gets two mails.
    //! 5. The creator also finds the same transition in the next recap, or
    //!    another recipient loses it from theirs.
    use super::*;

    fn row(user: &str) -> Recipient {
        Recipient {
            user_id: user.into(),
            channel: "email".into(),
            address: format!("{user}@example.test"),
            telegram_route_id: None,
            reason: "participant".into(),
        }
    }

    #[test]
    fn the_creator_is_mailed_when_someone_else_moves_their_ticket() {
        assert_eq!(
            targets(Some("user_yacine"), None, "apikey:0b6f"),
            vec![Target {
                user_id: "user_yacine".into(),
                why: Why::Creator
            }]
        );
    }

    #[test]
    fn nobody_is_mailed_about_their_own_move() {
        // Direct move, or through their own key (already collapsed to them).
        assert!(targets(Some("user_ramzi"), None, "user_ramzi").is_empty());
        // Filed for Yacine, moved by Yacine.
        assert!(targets(Some("apikey:code"), Some("user_yacine"), "user_yacine").is_empty());
    }

    #[test]
    fn a_key_with_no_owner_is_nobody() {
        assert!(targets(Some("apikey:code"), None, "user_ramzi").is_empty());
        assert!(targets(None, None, "user_ramzi").is_empty());
        assert!(targets(Some(""), None, "user_ramzi").is_empty());
    }

    #[test]
    fn a_ticket_filed_for_a_member_reaches_that_member() {
        assert_eq!(
            targets(Some("apikey:code"), Some("user_yacine"), "apikey:code"),
            vec![Target {
                user_id: "user_yacine".into(),
                why: Why::Reporter
            }]
        );
        // The key's owner filed it for someone else: both asked for it.
        assert_eq!(
            targets(Some("user_ramzi"), Some("user_yacine"), "apikey:code"),
            vec![
                Target {
                    user_id: "user_ramzi".into(),
                    why: Why::Creator
                },
                Target {
                    user_id: "user_yacine".into(),
                    why: Why::Reporter
                },
            ]
        );
    }

    #[test]
    fn creator_and_reporter_in_one_person_get_one_mail() {
        assert_eq!(
            targets(Some("user_yacine"), Some("user_yacine"), "apikey:code"),
            vec![Target {
                user_id: "user_yacine".into(),
                why: Why::Creator
            }]
        );
    }

    #[test]
    fn the_mailed_creator_leaves_the_recap_and_nobody_else_does() {
        let (mailed, recap) = split_recap(
            vec![row("user_yacine"), row("user_nessim")],
            &["user_yacine".to_string()],
        );
        assert_eq!(
            mailed
                .iter()
                .map(|r| r.user_id.as_str())
                .collect::<Vec<_>>(),
            ["user_yacine"]
        );
        assert_eq!(
            recap.iter().map(|r| r.user_id.as_str()).collect::<Vec<_>>(),
            ["user_nessim"]
        );
    }
}
