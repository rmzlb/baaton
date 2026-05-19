//! Agent receipts protocol — Ed25519 signed JSON receipts of agent runs.
//! Compatible with <https://agentreceipts.ai/specification/overview/>.
//!
//! Receipt format:
//! ```json
//! {
//!   "receipt": {
//!     "version": "1",
//!     "issuer": "https://baaton.dev",
//!     "issued_at": "2026-05-19T10:23:00Z",
//!     "subject": {
//!       "type": "agent_run",
//!       "id": "<public_token>",
//!       "url": "https://r.baaton.dev/r/<public_token>"
//!     },
//!     "agent": { "name": "openclaw:haroz", "id": "..." },
//!     "claims": {
//!       "display_id": "BAA-42",
//!       "status": "completed",
//!       "started_at": "...",
//!       "completed_at": "...",
//!       "files_changed": ["..."],
//!       "tests_status": "passed",
//!       "summary_sha256": "<hex>"
//!     }
//!   },
//!   "signature": {
//!     "alg": "EdDSA",
//!     "kid": "<key id>",
//!     "value": "<base64url>"
//!   }
//! }
//! ```
//!
//! `summary_sha256` rather than the full summary keeps the receipt payload
//! small (Twitter-friendly) and lets us truncate display without
//! invalidating the signature.
//
// TODO(security): encrypt private_key at rest with APP_SIGNING_MASTER_KEY env (AES-GCM).
// v1 stores raw bytes; the DB itself is access-controlled, but a leaked dump leaks the keys.
// Rotation is a follow-up: add `kid` history + `is_active` flag, expose all valid keys in JWKS.

use anyhow::{Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

const RECEIPT_VERSION: &str = "1";
const ISSUER_URL: &str = "https://baaton.dev";

#[derive(Serialize, Deserialize)]
pub struct Receipt {
    pub receipt: ReceiptBody,
    pub signature: ReceiptSignature,
}

#[derive(Serialize, Deserialize)]
pub struct ReceiptBody {
    pub version: String,
    pub issuer: String,
    pub issued_at: String,
    pub subject: ReceiptSubject,
    pub agent: ReceiptAgent,
    pub claims: serde_json::Map<String, Value>,
}

#[derive(Serialize, Deserialize)]
pub struct ReceiptSubject {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub url: String,
}

#[derive(Serialize, Deserialize)]
pub struct ReceiptAgent {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ReceiptSignature {
    pub alg: String,
    pub kid: String,
    pub value: String,
}

/// Generate 32 fresh bytes for an Ed25519 secret key.
///
/// We use `rand::random` rather than the `rand_core` feature of `ed25519-dalek`
/// because the crate pins `rand_core 0.6` while the rest of our backend uses
/// `rand 0.9` — `OsRng` from the two versions don't share trait impls, so
/// passing `&mut OsRng` straight into `SigningKey::generate` no longer compiles.
fn fresh_secret_bytes() -> [u8; 32] {
    rand::random::<[u8; 32]>()
}

/// Get-or-create the org's signing key. First call generates a fresh keypair.
/// Returns (kid, signing_key).
pub async fn get_or_create_org_key(pool: &PgPool, org_id: &str) -> Result<(String, SigningKey)> {
    if let Some((kid, priv_bytes)) = sqlx::query_as::<_, (String, Vec<u8>)>(
        "SELECT kid, private_key FROM org_signing_keys WHERE org_id = $1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    {
        let key_array: [u8; 32] = priv_bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("stored private key is not 32 bytes"))?;
        return Ok((kid, SigningKey::from_bytes(&key_array)));
    }

    let secret_bytes = fresh_secret_bytes();
    let signing_key = SigningKey::from_bytes(&secret_bytes);
    let verifying_key = signing_key.verifying_key();
    let kid = format!("baa_{}", uuid::Uuid::new_v4().simple());

    sqlx::query(
        "INSERT INTO org_signing_keys (org_id, kid, public_key, private_key) \
         VALUES ($1, $2, $3, $4) ON CONFLICT (org_id) DO NOTHING",
    )
    .bind(org_id)
    .bind(&kid)
    .bind(&verifying_key.to_bytes()[..])
    .bind(&signing_key.to_bytes()[..])
    .execute(pool)
    .await
    .context("insert org_signing_keys failed")?;

    // Race: another request may have inserted first; re-fetch to make the
    // (kid, signing_key) we hand back the canonical one.
    let row: (String, Vec<u8>) = sqlx::query_as(
        "SELECT kid, private_key FROM org_signing_keys WHERE org_id = $1",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await?;

    let key_array: [u8; 32] = row
        .1
        .try_into()
        .map_err(|_| anyhow::anyhow!("stored private key is not 32 bytes"))?;
    Ok((row.0, SigningKey::from_bytes(&key_array)))
}

/// Build a signed receipt for a public agent session.
#[allow(clippy::too_many_arguments)]
pub async fn build_receipt(
    pool: &PgPool,
    org_id: &str,
    public_token: &str,
    display_id: &str,
    agent_name: &str,
    agent_id: Option<&str>,
    status: &str,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    files_changed: &[String],
    tests_status: &str,
    summary: Option<&str>,
) -> Result<Receipt> {
    let (kid, signing_key) = get_or_create_org_key(pool, org_id).await?;

    let summary_sha = summary.map(|s| {
        let mut h = Sha256::new();
        h.update(s.as_bytes());
        format!("{:x}", h.finalize())
    });

    let mut claims = serde_json::Map::new();
    claims.insert("display_id".into(), Value::String(display_id.into()));
    claims.insert("status".into(), Value::String(status.into()));
    if let Some(t) = started_at {
        claims.insert("started_at".into(), Value::String(t.to_rfc3339()));
    }
    if let Some(t) = completed_at {
        claims.insert("completed_at".into(), Value::String(t.to_rfc3339()));
    }
    claims.insert(
        "files_changed".into(),
        serde_json::to_value(files_changed)?,
    );
    claims.insert("tests_status".into(), Value::String(tests_status.into()));
    if let Some(sha) = summary_sha {
        claims.insert("summary_sha256".into(), Value::String(sha));
    }

    let public_origin =
        std::env::var("PUBLIC_RUN_ORIGIN").unwrap_or_else(|_| "https://r.baaton.dev".into());

    let body = ReceiptBody {
        version: RECEIPT_VERSION.into(),
        issuer: ISSUER_URL.into(),
        issued_at: Utc::now().to_rfc3339(),
        subject: ReceiptSubject {
            kind: "agent_run".into(),
            id: public_token.into(),
            url: format!(
                "{}/r/{}",
                public_origin.trim_end_matches('/'),
                public_token
            ),
        },
        agent: ReceiptAgent {
            name: agent_name.into(),
            id: agent_id.map(String::from),
        },
        claims,
    };

    let canonical = serde_json::to_vec(&body).context("serialize receipt body")?;
    let signature = signing_key.sign(&canonical);
    let sig_b64 = URL_SAFE_NO_PAD.encode(signature.to_bytes());

    Ok(Receipt {
        receipt: body,
        signature: ReceiptSignature {
            alg: "EdDSA".into(),
            kid,
            value: sig_b64,
        },
    })
}

/// Build the JWKS response for an org (Ed25519 OKP curve).
pub async fn build_jwks(pool: &PgPool, org_id: &str) -> Result<Value> {
    let row: Option<(String, Vec<u8>)> = sqlx::query_as(
        "SELECT kid, public_key FROM org_signing_keys WHERE org_id = $1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?;

    let keys: Vec<Value> = match row {
        Some((kid, pub_bytes)) => vec![serde_json::json!({
            "kty": "OKP",
            "crv": "Ed25519",
            "kid": kid,
            "alg": "EdDSA",
            "use": "sig",
            "x": URL_SAFE_NO_PAD.encode(&pub_bytes),
        })],
        None => vec![],
    };

    Ok(serde_json::json!({ "keys": keys }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    fn signer() -> SigningKey {
        SigningKey::from_bytes(&[42u8; 32])
    }

    #[test]
    fn receipt_signature_verifies() {
        let key = signer();
        let body = ReceiptBody {
            version: "1".into(),
            issuer: "https://baaton.dev".into(),
            issued_at: "2026-05-19T10:00:00+00:00".into(),
            subject: ReceiptSubject {
                kind: "agent_run".into(),
                id: "abc123".into(),
                url: "https://r.baaton.dev/r/abc123".into(),
            },
            agent: ReceiptAgent {
                name: "test:agent".into(),
                id: None,
            },
            claims: Default::default(),
        };
        let canonical = serde_json::to_vec(&body).unwrap();
        let sig = key.sign(&canonical);
        let vk = key.verifying_key();
        assert!(vk.verify(&canonical, &sig).is_ok());
    }

    #[test]
    fn tampered_payload_fails_verification() {
        let key = signer();
        let body = ReceiptBody {
            version: "1".into(),
            issuer: "https://baaton.dev".into(),
            issued_at: "2026-05-19T10:00:00+00:00".into(),
            subject: ReceiptSubject {
                kind: "agent_run".into(),
                id: "abc123".into(),
                url: "https://r.baaton.dev/r/abc123".into(),
            },
            agent: ReceiptAgent {
                name: "test:agent".into(),
                id: None,
            },
            claims: Default::default(),
        };
        let canonical = serde_json::to_vec(&body).unwrap();
        let sig = key.sign(&canonical);
        let mut tampered = canonical.clone();
        tampered[0] ^= 0xFF;
        let vk = key.verifying_key();
        assert!(vk.verify(&tampered, &sig).is_err());
    }

    #[test]
    fn jwks_value_has_correct_shape() {
        // Without a DB, we just verify the JSON shape independently.
        let pub_bytes: Vec<u8> = vec![1u8; 32];
        let jwks = serde_json::json!({
            "keys": [{
                "kty": "OKP",
                "crv": "Ed25519",
                "kid": "test_kid",
                "alg": "EdDSA",
                "use": "sig",
                "x": URL_SAFE_NO_PAD.encode(&pub_bytes),
            }]
        });
        assert_eq!(jwks["keys"][0]["kty"], "OKP");
        assert_eq!(jwks["keys"][0]["crv"], "Ed25519");
        assert_eq!(jwks["keys"][0]["alg"], "EdDSA");
        assert_eq!(jwks["keys"][0]["use"], "sig");
    }

    #[test]
    fn fresh_secret_bytes_are_not_zero() {
        let a = fresh_secret_bytes();
        let b = fresh_secret_bytes();
        assert_ne!(a, [0u8; 32]);
        assert_ne!(a, b, "two secrets in a row should differ");
    }
}
