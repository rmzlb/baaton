pub mod security;

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Raw JWK from Clerk JWKS endpoint
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct JwkKey {
    pub kid: String,
    pub kty: String,
    pub n: String,
    pub e: String,
    #[serde(default)]
    pub alg: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwkSet {
    pub keys: Vec<JwkKey>,
}

/// Pre-computed decoding keys indexed by kid
pub type JwksKeys = Arc<RwLock<HashMap<String, DecodingKey>>>;

const PROFILE_TTL: Duration = Duration::from_secs(3600);

#[derive(Clone)]
struct CachedProfile {
    display_name: Option<String>,
    email: Option<String>,
    fetched_at: Instant,
}

static USER_PROFILE_CACHE: OnceLock<RwLock<HashMap<String, CachedProfile>>> = OnceLock::new();

fn profile_cache() -> &'static RwLock<HashMap<String, CachedProfile>> {
    USER_PROFILE_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Parse JWKS response into a map of kid → DecodingKey
fn parse_jwks(jwks: &JwkSet) -> HashMap<String, DecodingKey> {
    let mut map = HashMap::new();
    for key in &jwks.keys {
        match DecodingKey::from_rsa_components(&key.n, &key.e) {
            Ok(dk) => { map.insert(key.kid.clone(), dk); }
            Err(e) => { tracing::warn!("Failed to parse JWK kid={}: {}", key.kid, e); }
        }
    }
    map
}

/// Fetch JWKS from Clerk and return pre-computed keys
pub async fn fetch_jwks_keys(issuer: &str) -> Result<HashMap<String, DecodingKey>, String> {
    let url = format!("{}/.well-known/jwks.json", issuer);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("JWKS fetch error: {}", e))?;
    let jwks: JwkSet = resp
        .json()
        .await
        .map_err(|e| format!("JWKS parse error: {}", e))?;
    Ok(parse_jwks(&jwks))
}

/// Background task to refresh JWKS every hour
pub async fn jwks_refresh_task(keys: JwksKeys, issuer: String) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        match fetch_jwks_keys(&issuer).await {
            Ok(new_keys) => {
                let count = new_keys.len();
                *keys.write().await = new_keys;
                tracing::info!("JWKS refreshed ({} keys)", count);
            }
            Err(e) => {
                tracing::warn!("JWKS refresh failed: {}", e);
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct ClerkEmailAddress {
    pub id: String,
    pub email_address: String,
}

#[derive(Debug, Deserialize)]
struct ClerkUserResponse {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub primary_email_address_id: Option<String>,
    pub email_addresses: Option<Vec<ClerkEmailAddress>>,
}

async fn fetch_clerk_profile(user_id: &str) -> Option<(Option<String>, Option<String>)> {
    let secret = std::env::var("CLERK_SECRET_KEY").ok()?;
    let url = format!("https://api.clerk.com/v1/users/{}", user_id);

    let response = reqwest::Client::new()
        .get(url)
        .bearer_auth(secret)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let data: ClerkUserResponse = response.json().await.ok()?;

    let display_name = match (
        data.first_name.as_deref().unwrap_or("").trim(),
        data.last_name.as_deref().unwrap_or("").trim(),
    ) {
        ("", "") => data.username.clone(),
        (first, last) => {
            let name = format!("{} {}", first, last).trim().to_string();
            if name.is_empty() { data.username.clone() } else { Some(name) }
        }
    };

    let email = if let Some(primary_id) = data.primary_email_address_id.as_deref() {
        data.email_addresses
            .as_ref()
            .and_then(|emails| emails.iter().find(|e| e.id == primary_id).map(|e| e.email_address.clone()))
            .or_else(|| data.email_addresses.as_ref().and_then(|emails| emails.first().map(|e| e.email_address.clone())))
    } else {
        data.email_addresses
            .as_ref()
            .and_then(|emails| emails.first().map(|e| e.email_address.clone()))
    };

    Some((display_name, email))
}

async fn resolve_profile_cached(user_id: &str) -> Option<(Option<String>, Option<String>)> {
    let cache = profile_cache();
    {
        let read = cache.read().await;
        if let Some(entry) = read.get(user_id) {
            if entry.fetched_at.elapsed() < PROFILE_TTL {
                return Some((entry.display_name.clone(), entry.email.clone()));
            }
        }
    }

    let fetched = fetch_clerk_profile(user_id).await;
    if let Some((display_name, email)) = fetched.clone() {
        let mut write = cache.write().await;
        write.insert(
            user_id.to_string(),
            CachedProfile {
                display_name,
                email,
                fetched_at: Instant::now(),
            },
        );
    }

    fetched
}

/// Clerk JWT v2 Organization claim
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct OrgClaim {
    pub id: String,
    #[serde(default)]
    pub slg: Option<String>,
    #[serde(default)]
    pub rol: Option<String>,
    #[serde(default)]
    pub per: Option<Vec<String>>,
}

/// Claims extracted from a Clerk JWT
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct ClerkClaims {
    pub sub: String,
    #[serde(default)]
    pub v: Option<u8>,
    #[serde(default)]
    pub o: Option<OrgClaim>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub org_slug: Option<String>,
    #[serde(default)]
    pub org_role: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    /// Authorized party (frontend origin)
    #[serde(default)]
    pub azp: Option<String>,
    /// Session status — "pending" means user hasn't joined an org yet
    #[serde(default)]
    pub sts: Option<String>,
}

/// Extension added to the request by the auth middleware
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AuthUser {
    pub user_id: String,
    pub org_id: Option<String>,
    pub org_slug: Option<String>,
    pub org_role: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

impl AuthUser {
    pub fn created_by_label(&self) -> Option<String> {
        if let Some(name) = self.display_name.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            return Some(name.to_string());
        }
        if let Some(email) = self.email.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            return Some(email.to_string());
        }
        None
    }
}

/// Verify JWT signature + standard claims, return decoded claims
fn verify_jwt(
    token: &str,
    keys: &HashMap<String, DecodingKey>,
    issuer: &str,
    authorized_parties: &[String],
) -> Result<ClerkClaims, String> {
    let header = decode_header(token).map_err(|e| format!("JWT header error: {}", e))?;
    let kid = header.kid.ok_or("JWT missing kid")?;

    let decoding_key = keys
        .get(&kid)
        .ok_or_else(|| format!("No matching JWK for kid: {}", kid))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[issuer]);
    // Clerk tokens don't always have aud
    validation.validate_aud = false;

    let token_data = decode::<ClerkClaims>(token, decoding_key, &validation)
        .map_err(|e| format!("JWT verification failed: {}", e))?;

    let claims = token_data.claims;

    // Validate azp if present and authorized_parties is configured
    if !authorized_parties.is_empty() {
        if let Some(ref azp) = claims.azp {
            if !authorized_parties.iter().any(|p| p == azp) {
                return Err(format!("Unauthorized party: {}", azp));
            }
        }
    }

    // Reject pending sessions (user not in org)
    if claims.sts.as_deref() == Some("pending") {
        return Err("Session pending — user must join an organization".to_string());
    }

    Ok(claims)
}

/// Auth middleware — verifies Clerk JWT signature via JWKS and extracts AuthUser
pub async fn auth_middleware(mut req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    if path.contains("/public/")
        || path == "/health"
        || path.contains("/webhooks/")
        || path.starts_with("/api/v1/invite/")
        || path.starts_with("/invite/")
    {
        return next.run(req).await;
    }

    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let token = match auth_header {
        Some(ref h) if h.starts_with("Bearer ") => &h[7..],
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                r#"{"error":"Missing or invalid Authorization header"}"#,
            )
                .into_response();
        }
    };

    // Get JWKS keys from extensions
    let keys = match req.extensions().get::<JwksKeys>() {
        Some(k) => k.clone(),
        None => {
            tracing::error!("JWKS keys not found in request extensions");
            return (StatusCode::INTERNAL_SERVER_ERROR, r#"{"error":"Auth not configured"}"#).into_response();
        }
    };

    let issuer = std::env::var("CLERK_ISSUER")
        .unwrap_or_else(|_| "https://clerk.baaton.dev".to_string());
    let authorized_parties: Vec<String> = std::env::var("CLERK_AUTHORIZED_PARTIES")
        .unwrap_or_else(|_| "https://app.baaton.dev,https://baaton.dev".to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // Try verification with current keys
    let keys_read = keys.read().await;
    let claims = match verify_jwt(token, &keys_read, &issuer, &authorized_parties) {
        Ok(c) => c,
        Err(first_err) => {
            drop(keys_read);
            // Key rotation fallback: refresh JWKS once and retry
            match fetch_jwks_keys(&issuer).await {
                Ok(new_keys) => {
                    let result = verify_jwt(token, &new_keys, &issuer, &authorized_parties);
                    *keys.write().await = new_keys;
                    match result {
                        Ok(c) => c,
                        Err(e) => {
                            tracing::warn!("JWT verification failed after JWKS refresh: {}", e);
                            return (
                                StatusCode::UNAUTHORIZED,
                                format!(r#"{{"error":"Invalid token: {}"}}"#, e),
                            )
                                .into_response();
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("JWKS refresh failed: {}; original error: {}", e, first_err);
                    return (
                        StatusCode::UNAUTHORIZED,
                        format!(r#"{{"error":"Invalid token: {}"}}"#, first_err),
                    )
                        .into_response();
                }
            }
        }
    };

    let (org_id, org_slug, org_role) = if let Some(ref o) = claims.o {
        (
            Some(o.id.clone()),
            o.slg.clone(),
            o.rol.as_ref().map(|r| format!("org:{}", r)),
        )
    } else {
        (claims.org_id.clone(), claims.org_slug.clone(), claims.org_role.clone())
    };

    let mut display_name = {
        let first = claims.first_name.as_deref().unwrap_or("").trim();
        let last = claims.last_name.as_deref().unwrap_or("").trim();
        let full = format!("{} {}", first, last).trim().to_string();
        if !full.is_empty() {
            Some(full)
        } else {
            claims.username.clone()
        }
    };

    let mut email = claims.email;

    if display_name.is_none() && email.is_none() {
        if let Some((fetched_name, fetched_email)) = resolve_profile_cached(&claims.sub).await {
            if display_name.is_none() { display_name = fetched_name; }
            if email.is_none() { email = fetched_email; }
        }
    }

    let auth_user = AuthUser {
        user_id: claims.sub,
        org_id,
        org_slug,
        org_role,
        email,
        display_name,
    };

    tracing::debug!(
        user_id = %auth_user.user_id,
        org_id = ?auth_user.org_id,
        jwt_version = ?claims.v,
        "Authenticated request"
    );

    req.extensions_mut().insert(auth_user);
    next.run(req).await
}
