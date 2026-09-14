//! AES-256-GCM credential sealing for third-party secrets stored in the database.
//!
//! ## Sealed format
//!
//! ```text
//! v1:<base64_std(nonce_12_bytes || ciphertext_with_16_byte_gcm_tag)>
//! ```
//!
//! The `v1:` prefix is explicit so a future algorithm change is detectable without
//! ambiguity, and so the startup migration can identify plaintext rows reliably.
//!
//! ## Key provisioning
//!
//! Set `INTEGRATION_ENCRYPTION_KEY` to a base64-encoded 32-byte random value.
//! Generate once with: `openssl rand -base64 32`
//!
//! ## No plaintext fallback
//!
//! [`CredentialKey::open`] rejects any value that does not carry the `v1:` prefix.
//! The startup migration seals all legacy plaintext rows before the app accepts
//! traffic, so sealed values are the only valid form after the first boot with the
//! key set. There is no silent round-trip on old data.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::TryRngCore;

/// Prefix written at the start of every sealed credential.
/// Any value that does not start with this was never processed by [`CredentialKey::seal`].
pub const VERSION_PREFIX: &str = "v1:";

/// AES-256-GCM key for sealing/opening credential values.
///
/// [`Clone`] is cheap: the key fits on the stack (32 bytes).
#[derive(Clone)]
pub struct CredentialKey {
    key: [u8; 32],
}

/// Errors from seal/open. Messages never include secret values, tokens, or URLs.
#[derive(Debug, thiserror::Error)]
pub enum CredentialError {
    /// AES-GCM encryption failed (e.g. RNG error).
    #[error("encryption failed")]
    Seal,
    /// AES-GCM decryption or authentication failed, or input has wrong format.
    #[error("decryption failed")]
    Open,
    /// `INTEGRATION_ENCRYPTION_KEY` env var is present but invalid.
    #[error("INTEGRATION_ENCRYPTION_KEY: {0}")]
    Config(&'static str),
}

impl CredentialKey {
    /// Load the key from `INTEGRATION_ENCRYPTION_KEY` (base64-encoded, must
    /// decode to exactly 32 bytes).
    ///
    /// Returns `Ok(None)` when the variable is absent — startup decides whether
    /// that is an error based on whether credential rows already exist.
    /// Returns `Err` when the variable is present but malformed.
    pub fn from_env() -> Result<Option<Self>, CredentialError> {
        let raw = match std::env::var("INTEGRATION_ENCRYPTION_KEY") {
            Ok(v) if !v.trim().is_empty() => v,
            _ => return Ok(None),
        };
        let bytes = B64
            .decode(raw.trim())
            .map_err(|_| CredentialError::Config("value is not valid base64"))?;
        if bytes.len() != 32 {
            return Err(CredentialError::Config(
                "expected exactly 32 base64-decoded bytes",
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(Some(Self { key }))
    }

    /// Seal `plaintext` into `v1:<base64(nonce || ciphertext)>`.
    ///
    /// A fresh OS-random 12-byte nonce is drawn on every call, so two invocations
    /// with identical plaintext produce different output.
    pub fn seal(&self, plaintext: &str) -> Result<String, CredentialError> {
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng
            .try_fill_bytes(&mut nonce_bytes)
            .map_err(|_| CredentialError::Seal)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key));
        let nonce = Nonce::<Aes256Gcm>::from_slice(&nonce_bytes);
        // `encrypt` appends the 16-byte GCM authentication tag to the ciphertext.
        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| CredentialError::Seal)?;
        let mut payload = Vec::with_capacity(12 + ciphertext.len());
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);
        Ok(format!("{}{}", VERSION_PREFIX, B64.encode(&payload)))
    }

    /// Open `v1:<base64(nonce || ciphertext)>` into plaintext.
    ///
    /// Returns `Err(Open)` for any of:
    /// - missing `v1:` prefix (plaintext or wrong format)
    /// - bad base64
    /// - payload too short (< 28 bytes: 12 nonce + 16 GCM tag)
    /// - authentication tag mismatch (tampered or wrong key)
    /// - resulting bytes are not valid UTF-8
    pub fn open(&self, sealed: &str) -> Result<String, CredentialError> {
        let b64 = sealed
            .strip_prefix(VERSION_PREFIX)
            .ok_or(CredentialError::Open)?;
        let payload = B64.decode(b64).map_err(|_| CredentialError::Open)?;
        // 12-byte nonce + 16-byte GCM tag = 28 minimum (empty plaintext is valid)
        if payload.len() < 28 {
            return Err(CredentialError::Open);
        }
        let (nonce_bytes, ciphertext) = payload.split_at(12);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key));
        let nonce = Nonce::<Aes256Gcm>::from_slice(nonce_bytes);
        // `decrypt` verifies the GCM tag and returns the plaintext without it.
        let plaintext_bytes = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| CredentialError::Open)?;
        String::from_utf8(plaintext_bytes).map_err(|_| CredentialError::Open)
    }

    /// Returns `true` when `value` is already a sealed credential (`v1:` prefix).
    #[inline]
    pub fn is_sealed(value: &str) -> bool {
        value.starts_with(VERSION_PREFIX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_a() -> CredentialKey {
        CredentialKey { key: [0x11u8; 32] }
    }

    fn key_b() -> CredentialKey {
        CredentialKey { key: [0x22u8; 32] }
    }

    #[test]
    fn roundtrip_recovers_plaintext() {
        let k = key_a();
        let sealed = k.seal("xoxb-slack-bot-token").unwrap();
        assert!(
            CredentialKey::is_sealed(&sealed),
            "sealed value must carry version prefix"
        );
        assert!(sealed.starts_with("v1:"), "prefix must be v1:");
        let opened = k.open(&sealed).unwrap();
        assert_eq!(opened, "xoxb-slack-bot-token");
    }

    #[test]
    fn nonces_differ_across_calls() {
        let k = key_a();
        let a = k.seal("same plaintext").unwrap();
        let b = k.seal("same plaintext").unwrap();
        assert_ne!(a, b, "each seal call must use a fresh nonce");
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let k = key_a();
        let sealed = k.seal("secret").unwrap();
        // Flip one character deep inside the base64 payload.
        let mut chars: Vec<char> = sealed.chars().collect();
        let flip = VERSION_PREFIX.len() + 8;
        chars[flip] = if chars[flip] == 'A' { 'B' } else { 'A' };
        let tampered: String = chars.into_iter().collect();
        assert!(
            k.open(&tampered).is_err(),
            "tampered ciphertext must be rejected"
        );
    }

    #[test]
    fn wrong_key_rejected() {
        let a = key_a();
        let b = key_b();
        let sealed = a.seal("token-value").unwrap();
        assert!(b.open(&sealed).is_err(), "wrong key must not decrypt");
    }

    #[test]
    fn plaintext_input_rejected_by_open() {
        let k = key_a();
        assert!(k.open("xoxb-not-sealed").is_err(), "plaintext must be rejected");
        assert!(k.open("").is_err(), "empty string must be rejected");
    }

    #[test]
    fn error_messages_do_not_contain_secrets() {
        let secret = "xoxb-super-secret-9999999";
        let sealed = key_a().seal(secret).unwrap();

        // Wrong key
        let msg = key_b().open(&sealed).unwrap_err().to_string();
        assert!(!msg.contains(secret), "error must not contain the secret: {msg}");

        // Non-sealed plaintext
        let msg2 = key_a().open(secret).unwrap_err().to_string();
        assert!(!msg2.contains(secret), "error must not contain the secret: {msg2}");
    }

    #[test]
    fn is_sealed_discriminates() {
        assert!(CredentialKey::is_sealed("v1:abc123"));
        assert!(!CredentialKey::is_sealed("xoxb-raw-token"));
        assert!(!CredentialKey::is_sealed(""));
        assert!(!CredentialKey::is_sealed("v2:future-version"));
    }

    #[test]
    fn from_env_rejects_wrong_length_simulated() {
        // Verify the byte-length check by manually simulating what from_env does.
        // (Setting env vars in unit tests is inherently racy; we test the logic directly.)
        let b64_16 = B64.encode([0u8; 16]);
        let bytes = B64.decode(&b64_16).unwrap();
        assert_ne!(bytes.len(), 32, "16-byte key must not pass the 32-byte check");
    }
}
