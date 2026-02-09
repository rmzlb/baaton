use base64::{Engine as _, engine::general_purpose};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use octocrab::Octocrab;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Cached installation token with expiry
struct CachedToken {
    token: String,
    expires_at: chrono::DateTime<chrono::Utc>,
}

/// GitHub App client with installation token caching.
///
/// Create once at startup (from env vars) and share via `Arc<GitHubClient>`
/// as Axum state / extension.
#[derive(Clone)]
pub struct GitHubClient {
    app_id: u64,
    private_key_pem: Arc<Vec<u8>>,
    token_cache: Arc<RwLock<HashMap<u64, CachedToken>>>,
}

#[derive(Debug, Serialize)]
struct JwtClaims {
    iat: i64,
    exp: i64,
    iss: String,
}

impl GitHubClient {
    /// Build a new client from the GitHub App's ID and PEM private key.
    pub fn new(app_id: u64, private_key_pem: Vec<u8>) -> Result<Self, anyhow::Error> {
        // Validate the key can be parsed (fail-fast at startup)
        let _ = EncodingKey::from_rsa_pem(&private_key_pem)?;

        Ok(Self {
            app_id,
            private_key_pem: Arc::new(private_key_pem),
            token_cache: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Create a new `GitHubClient` from environment variables.
    ///
    /// Expects `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (base64-encoded PEM).
    pub fn from_env() -> Result<Self, anyhow::Error> {
        let app_id: u64 = std::env::var("GITHUB_APP_ID")
            .map_err(|_| anyhow::anyhow!("GITHUB_APP_ID not set"))?
            .parse()
            .map_err(|_| anyhow::anyhow!("GITHUB_APP_ID must be a number"))?;

        let private_key_b64 = std::env::var("GITHUB_APP_PRIVATE_KEY")
            .map_err(|_| anyhow::anyhow!("GITHUB_APP_PRIVATE_KEY not set"))?;

        let private_key_pem = general_purpose::STANDARD
            .decode(private_key_b64.trim())
            .map_err(|e| anyhow::anyhow!("Failed to base64-decode GITHUB_APP_PRIVATE_KEY: {}", e))?;

        Self::new(app_id, private_key_pem)
    }

    /// Return a short-lived JWT signed with the App private key.
    /// Used to authenticate as the GitHub App itself (not an installation).
    fn create_app_jwt(&self) -> Result<String, anyhow::Error> {
        let now = chrono::Utc::now().timestamp();
        let claims = JwtClaims {
            iat: now - 60, // 1 min in the past to account for clock drift
            exp: now + (9 * 60), // 9 min (max 10)
            iss: self.app_id.to_string(),
        };
        let header = Header::new(Algorithm::RS256);
        let key = EncodingKey::from_rsa_pem(&self.private_key_pem)?;
        let token = encode(&header, &claims, &key)?;
        Ok(token)
    }

    /// Get an authenticated `Octocrab` instance for a specific installation.
    /// Caches the token and refreshes when close to expiry.
    pub async fn for_installation(
        &self,
        installation_id: u64,
    ) -> Result<Octocrab, anyhow::Error> {
        // Check cache first
        {
            let cache = self.token_cache.read().await;
            if let Some(cached) = cache.get(&installation_id) {
                if cached.expires_at > chrono::Utc::now() + chrono::TimeDelta::minutes(5) {
                    return Octocrab::builder()
                        .personal_token(cached.token.clone())
                        .build()
                        .map_err(Into::into);
                }
            }
        }

        // Generate a fresh installation token via the App JWT
        let app_jwt = self.create_app_jwt()?;
        let app_crab = Octocrab::builder()
            .personal_token(app_jwt)
            .build()?;

        // POST /app/installations/{installation_id}/access_tokens
        let token_response: serde_json::Value = app_crab
            .post(
                format!("/app/installations/{}/access_tokens", installation_id),
                None::<&()>,
            )
            .await?;

        let token = token_response["token"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("No token in installation access_tokens response"))?
            .to_string();

        let expires_at = if let Some(exp_str) = token_response["expires_at"].as_str() {
            chrono::DateTime::parse_from_rfc3339(exp_str)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now() + chrono::TimeDelta::minutes(55))
        } else {
            chrono::Utc::now() + chrono::TimeDelta::minutes(55)
        };

        // Cache
        {
            let mut cache = self.token_cache.write().await;
            cache.insert(
                installation_id,
                CachedToken {
                    token: token.clone(),
                    expires_at,
                },
            );
        }

        Octocrab::builder()
            .personal_token(token)
            .build()
            .map_err(Into::into)
    }

    /// Get an `Octocrab` instance authenticated as the App (not installation-scoped).
    pub fn as_app(&self) -> Result<Octocrab, anyhow::Error> {
        let jwt = self.create_app_jwt()?;
        Octocrab::builder()
            .personal_token(jwt)
            .build()
            .map_err(Into::into)
    }

    /// The GitHub App ID.
    pub fn app_id(&self) -> u64 {
        self.app_id
    }
}
