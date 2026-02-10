pub mod security;

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;

/// JWKS key set fetched from Clerk
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

/// Shared JWKS state
pub type JwksState = Arc<RwLock<JwkSet>>;

/// Fetch JWKS from Clerk
pub async fn fetch_jwks(issuer: &str) -> Result<JwkSet, String> {
    let url = format!("{}/.well-known/jwks.json", issuer);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("JWKS fetch error: {}", e))?;
    let jwks: JwkSet = resp
        .json()
        .await
        .map_err(|e| format!("JWKS parse error: {}", e))?;
    Ok(jwks)
}

/// Background task to refresh JWKS every hour
pub async fn jwks_refresh_task(jwks: JwksState, issuer: String) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        match fetch_jwks(&issuer).await {
            Ok(new_jwks) => {
                *jwks.write().await = new_jwks;
                tracing::info!("JWKS refreshed");
            }
            Err(e) => {
                tracing::warn!("JWKS refresh failed: {}", e);
            }
        }
    }
}

/// Clerk JWT v2 Organization claim
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
    pub azp: Option<String>,
}

/// Extension added to the request by the auth middleware
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
    pub org_id: Option<String>,
    pub org_slug: Option<String>,
    pub org_role: Option<String>,
}

/// Verify JWT with JWKS
fn verify_jwt(token: &str, jwks: &JwkSet, issuer: &str) -> Result<ClerkClaims, String> {
    let header = decode_header(token).map_err(|e| format!("JWT header error: {}", e))?;
    let kid = header.kid.ok_or("JWT missing kid")?;

    let key = jwks
        .keys
        .iter()
        .find(|k| k.kid == kid)
        .ok_or_else(|| format!("No matching JWK for kid: {}", kid))?;

    let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)
        .map_err(|e| format!("RSA key error: {}", e))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[issuer]);
    // Clerk tokens don't always have aud
    validation.validate_aud = false;

    let token_data = decode::<ClerkClaims>(token, &decoding_key, &validation)
        .map_err(|e| format!("JWT verification failed: {}", e))?;

    // Validate azp (authorized parties) if present
    if let Some(ref azp) = token_data.claims.azp {
        let authorized_parties: Vec<String> = std::env::var("CLERK_AUTHORIZED_PARTIES")
            .unwrap_or_else(|_| "https://app.baaton.dev,https://baaton.dev".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        if !authorized_parties.contains(azp) {
            return Err(format!("Invalid azp claim: {}", azp));
        }
    }

    Ok(token_data.claims)
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

    // Get JWKS from extensions
    let jwks = match req.extensions().get::<JwksState>() {
        Some(j) => j.clone(),
        None => {
            tracing::error!("JWKS state not found in request extensions");
            return (StatusCode::INTERNAL_SERVER_ERROR, r#"{"error":"Auth not configured"}"#).into_response();
        }
    };

    let issuer = std::env::var("CLERK_ISSUER").unwrap_or_else(|_| "https://clerk.baaton.dev".to_string());

    // Try verification with current JWKS
    let jwks_read = jwks.read().await;
    let claims = match verify_jwt(token, &jwks_read, &issuer) {
        Ok(c) => c,
        Err(_first_err) => {
            drop(jwks_read);
            // Key rotation fallback: refresh JWKS once and retry
            match fetch_jwks(&issuer).await {
                Ok(new_jwks) => {
                    let result = verify_jwt(token, &new_jwks, &issuer);
                    *jwks.write().await = new_jwks;
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
                    tracing::warn!("JWKS refresh failed: {}; original error: {}", e, _first_err);
                    return (
                        StatusCode::UNAUTHORIZED,
                        format!(r#"{{"error":"Invalid token: {}"}}"#, _first_err),
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

    let auth_user = AuthUser {
        user_id: claims.sub,
        org_id,
        org_slug,
        org_role,
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
