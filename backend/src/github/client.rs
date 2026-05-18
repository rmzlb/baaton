use base64::{Engine as _, engine::general_purpose};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use octocrab::models::CommentId;
use octocrab::Octocrab;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Parse a GitHub PR URL into (owner, repo, pr_number).
///
/// Accepts forms like:
/// - `https://github.com/owner/repo/pull/42`
/// - `https://github.com/owner/repo/pull/42/`
/// - `https://github.com/owner/repo/pull/42#issuecomment-123`
///
/// Returns `None` for issue URLs, malformed inputs, or non-github.com hosts.
pub fn parse_pr_url(url: &str) -> Option<(String, String, u64)> {
    // Strip any URL fragment (#...) and query (?...).
    let without_fragment = url.split('#').next().unwrap_or(url);
    let without_query = without_fragment.split('?').next().unwrap_or(without_fragment);

    // Require an https://github.com/ (or http://) prefix to avoid matching
    // arbitrary hosts that happen to include "/pull/N".
    let rest = without_query
        .strip_prefix("https://github.com/")
        .or_else(|| without_query.strip_prefix("http://github.com/"))?;

    // Expected shape: owner/repo/pull/N(/)?
    let trimmed = rest.trim_end_matches('/');
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() != 4 {
        return None;
    }
    if parts[2] != "pull" {
        return None;
    }
    let owner = parts[0];
    let repo = parts[1];
    let number_str = parts[3];
    if owner.is_empty() || repo.is_empty() || number_str.is_empty() {
        return None;
    }
    let number: u64 = number_str.parse().ok()?;
    Some((owner.to_string(), repo.to_string(), number))
}

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
    #[allow(dead_code)]
    pub fn app_id(&self) -> u64 {
        self.app_id
    }

    /// Create or update a PR comment for the given installation.
    ///
    /// PRs are issues in GitHub's data model for comment purposes, so this
    /// uses the issues API.
    ///
    /// - If `existing_comment_id` is `Some(id)`, attempt to update that comment.
    ///   On 404 (the user deleted it), fall back to creating a new comment.
    /// - If `existing_comment_id` is `None`, create a new comment on the PR.
    ///
    /// Returns the comment id as `i64` (octocrab uses `CommentId(u64)`; we
    /// cast saturating to `i64` for DB-friendly storage).
    pub async fn upsert_pr_comment(
        &self,
        installation_id: u64,
        owner: &str,
        repo: &str,
        pr_number: u64,
        existing_comment_id: Option<i64>,
        body: &str,
    ) -> anyhow::Result<i64> {
        let crab = self.for_installation(installation_id).await?;
        let issues = crab.issues(owner, repo);

        if let Some(id) = existing_comment_id {
            let comment_id = CommentId(id as u64);
            match issues.update_comment(comment_id, body).await {
                Ok(comment) => Ok(comment.id.0 as i64),
                Err(octocrab::Error::GitHub { source, .. })
                    if source.status_code.as_u16() == 404 =>
                {
                    // User deleted the comment manually — recreate it.
                    let comment = issues.create_comment(pr_number, body).await?;
                    Ok(comment.id.0 as i64)
                }
                Err(e) => Err(e.into()),
            }
        } else {
            let comment = issues.create_comment(pr_number, body).await?;
            Ok(comment.id.0 as i64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_pr_url() {
        let (o, r, n) = parse_pr_url("https://github.com/rmzlb/baaton/pull/42").unwrap();
        assert_eq!(o, "rmzlb");
        assert_eq!(r, "baaton");
        assert_eq!(n, 42);
    }

    #[test]
    fn parse_pr_url_with_trailing_slash_and_anchor() {
        let (o, r, n) =
            parse_pr_url("https://github.com/foo/bar/pull/7/#issuecomment-12345").unwrap();
        assert_eq!(o, "foo");
        assert_eq!(r, "bar");
        assert_eq!(n, 7);
    }

    #[test]
    fn parse_pr_url_with_trailing_slash() {
        let (o, r, n) = parse_pr_url("https://github.com/foo/bar/pull/7/").unwrap();
        assert_eq!(o, "foo");
        assert_eq!(r, "bar");
        assert_eq!(n, 7);
    }

    #[test]
    fn parse_pr_url_rejects_issue_url() {
        assert!(parse_pr_url("https://github.com/foo/bar/issues/7").is_none());
    }

    #[test]
    fn parse_pr_url_rejects_garbage() {
        assert!(parse_pr_url("not a url").is_none());
        assert!(parse_pr_url("https://example.com/pull/1").is_none());
        assert!(parse_pr_url("https://github.com/foo/bar/pull/abc").is_none());
        assert!(parse_pr_url("https://github.com/foo/bar/pull/").is_none());
        assert!(parse_pr_url("https://github.com/foo/bar/pull").is_none());
        assert!(parse_pr_url("https://github.com/foo/bar/pull/1/extra").is_none());
        assert!(parse_pr_url("https://github.com//baaton/pull/1").is_none());
    }
}
