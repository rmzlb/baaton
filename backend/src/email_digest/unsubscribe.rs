//! Unsubscribing from the email recap (BAA-40).
//!
//! The choice belongs to the person: a role holder without an email channel
//! gets the recap at their account address, so a per-channel switch would miss
//! them. Turning it off stops everything queued for them, and anything queued
//! later. @mentions go through `pending_notif` and keep arriving.
//!
//! Every recap carries its own unsubscribe link (RFC 8058 one-click). The
//! token is 32 random bytes, minted at the recap's first send attempt and kept
//! in clear on the recap only while it is pending, so a retry resends the same
//! mail under the same idempotency key. Only its SHA-256 is kept afterwards,
//! and the lookup goes through that hash: nothing compares secrets byte by
//! byte. A link only ever unsubscribes, and keeps working after the person
//! turns the recap back on: it can do nothing a newer link could not.

use base64::Engine as _;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

/// Path of the public link under the API origin.
pub const LINK_PATH: &str = "/api/v1/public/email/unsubscribe/";

/// The `List-Unsubscribe-Post` value and the body a one-click POST carries.
pub const ONE_CLICK: &str = "List-Unsubscribe=One-Click";

/// Unsubscribe links stop working after this many days, like notifyd's own.
const TOKEN_RETENTION_DAYS: i32 = 400;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// A fresh token: 32 random bytes, base64url without padding (43 characters).
pub fn new_token() -> String {
    B64.encode(rand::random::<[u8; 32]>())
}

/// The stored form of a token. `None` for anything `new_token` cannot produce,
/// so a malformed path never reaches the database.
fn token_hash(token: &str) -> Option<[u8; 32]> {
    let raw = B64.decode(token).ok()?;
    if raw.len() != 32 {
        return None;
    }
    Some(Sha256::digest(token.as_bytes()).into())
}

pub fn unsubscribe_url(api_url: &str, token: &str) -> String {
    format!("{}{LINK_PATH}{token}", api_url.trim_end_matches('/'))
}

/// The two RFC 8058 headers for one link.
pub fn email_headers(url: &str) -> serde_json::Value {
    serde_json::json!({
        "List-Unsubscribe": format!("<{url}>"),
        "List-Unsubscribe-Post": ONE_CLICK,
    })
}

/// True when a POST body is the one-click request: `List-Unsubscribe=One-Click`
/// as `application/x-www-form-urlencoded`, or the same field in
/// `multipart/form-data` (RFC 8058 allows both).
pub fn is_one_click(body: &[u8]) -> bool {
    let body = String::from_utf8_lossy(body);
    let urlencoded = body.split('&').any(|pair| pair.trim() == ONE_CLICK);
    let multipart =
        body.contains("name=\"List-Unsubscribe\"") && body.lines().any(|l| l.trim() == "One-Click");
    urlencoded || multipart
}

pub async fn recap_enabled(pool: &PgPool, user_id: &str) -> Result<bool, sqlx::Error> {
    let enabled: Option<bool> =
        sqlx::query_scalar("SELECT recap_enabled FROM user_email_settings WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(enabled.unwrap_or(true))
}

/// Turn the recap on or off for a person. Off also drops what is already
/// queued: events waiting for their slot are deleted and pending recaps are
/// marked `skipped`, so turning it back on later does not resend old news.
///
/// Serialised with `claim_due` by the same advisory lock, so a recap cannot be
/// built from events this call is removing.
pub async fn set_recap_enabled(
    pool: &PgPool,
    user_id: &str,
    enabled: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('baaton.email_digest'))")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO user_email_settings (user_id, recap_enabled) VALUES ($1, $2) \
         ON CONFLICT (user_id) DO UPDATE \
           SET recap_enabled = EXCLUDED.recap_enabled, updated_at = now()",
    )
    .bind(user_id)
    .bind(enabled)
    .execute(&mut *tx)
    .await?;
    if !enabled {
        sqlx::query("DELETE FROM email_digest_events WHERE user_id = $1 AND digest_id IS NULL")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE email_digests SET status = 'skipped', locked_until = NULL, \
               unsubscribe_token = NULL, last_error = 'unsubscribed' \
             WHERE user_id = $1 AND status = 'pending'",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// Unsubscribe the owner of `token`. `false` when the token is unknown,
/// malformed or expired: nobody is unsubscribed. Idempotent.
pub async fn unsubscribe_with_token(pool: &PgPool, token: &str) -> Result<bool, sqlx::Error> {
    let Some(hash) = token_hash(token) else {
        return Ok(false);
    };
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT user_id FROM email_unsubscribe_tokens \
          WHERE token_hash = $1 AND created_at > now() - make_interval(days => $2)",
    )
    .bind(&hash[..])
    .bind(TOKEN_RETENTION_DAYS)
    .fetch_optional(pool)
    .await?;
    match owner {
        Some(user_id) => {
            set_recap_enabled(pool, &user_id, false).await?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// True when `token` is a live link, without acting on it.
pub async fn token_exists(pool: &PgPool, token: &str) -> Result<bool, sqlx::Error> {
    let Some(hash) = token_hash(token) else {
        return Ok(false);
    };
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM email_unsubscribe_tokens \
          WHERE token_hash = $1 AND created_at > now() - make_interval(days => $2))",
    )
    .bind(&hash[..])
    .bind(TOKEN_RETENTION_DAYS)
    .fetch_one(pool)
    .await
}

/// The link of one recap: minted at its first attempt, the same on every retry.
///
/// A lease that expired while the first sender was still running can let two
/// senders reach this together; `COALESCE` keeps whichever token landed first
/// and the loser's hash row is removed in the same transaction.
pub async fn token_for_digest(
    pool: &PgPool,
    digest_id: Uuid,
    user_id: &str,
) -> Result<String, sqlx::Error> {
    let existing: Option<String> =
        sqlx::query_scalar("SELECT unsubscribe_token FROM email_digests WHERE id = $1")
            .bind(digest_id)
            .fetch_one(pool)
            .await?;
    if let Some(token) = existing {
        return Ok(token);
    }
    let candidate = new_token();
    let hash = token_hash(&candidate).expect("new_token is well formed");
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO email_unsubscribe_tokens (token_hash, user_id) VALUES ($1, $2)")
        .bind(&hash[..])
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let kept: Option<String> = sqlx::query_scalar(
        "UPDATE email_digests SET unsubscribe_token = COALESCE(unsubscribe_token, $2) \
          WHERE id = $1 RETURNING unsubscribe_token",
    )
    .bind(digest_id)
    .bind(&candidate)
    .fetch_one(&mut *tx)
    .await?;
    let kept = kept.unwrap_or_else(|| candidate.clone());
    if kept != candidate {
        sqlx::query("DELETE FROM email_unsubscribe_tokens WHERE token_hash = $1")
            .bind(&hash[..])
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(kept)
}

/// Drop links past their retention.
pub async fn purge_old_tokens(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let done = sqlx::query(
        "DELETE FROM email_unsubscribe_tokens \
          WHERE created_at < now() - make_interval(days => $1)",
    )
    .bind(TOKEN_RETENTION_DAYS)
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mail providers send the field in either encoding; anything else is not
    /// the one-click request.
    #[test]
    fn one_click_body_in_both_encodings() {
        assert!(is_one_click(b"List-Unsubscribe=One-Click"));
        let multipart = "--b\r\nContent-Disposition: form-data; name=\"List-Unsubscribe\"\r\n\r\nOne-Click\r\n--b--\r\n";
        assert!(is_one_click(multipart.as_bytes()));
        assert!(!is_one_click(b""));
        assert!(!is_one_click(b"List-Unsubscribe=No"));
    }
}
