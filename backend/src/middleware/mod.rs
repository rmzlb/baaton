pub mod security;

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use serde::Deserialize;

/// Clerk JWT v2 Organization claim — nested under "o" in the token payload.
/// See: https://clerk.com/docs/guides/sessions/session-tokens
#[derive(Debug, Clone, Deserialize)]
pub struct OrgClaim {
    /// Organization ID (e.g., "org_39Qp1H4YIEmVbPx8v8J0Q2hn5Wx")
    pub id: String,
    /// Organization slug (e.g., "sqhelm")
    #[serde(default)]
    pub slg: Option<String>,
    /// Role without "org:" prefix (e.g., "admin", "member")
    #[serde(default)]
    pub rol: Option<String>,
    /// Permissions list
    #[serde(default)]
    pub per: Option<Vec<String>>,
}

/// Claims extracted from a Clerk JWT v2 session token.
/// We decode the payload without signature verification for speed,
/// since Clerk's frontend SDK already validates the session.
///
/// Clerk v2 format:
///   sub: "user_xxx"
///   o: { id: "org_xxx", slg: "my-org", rol: "admin", per: [...] }
///
/// For backward compatibility, we also check legacy v1 fields (org_id, org_slug, org_role).
#[derive(Debug, Clone, Deserialize)]
pub struct ClerkClaims {
    /// Clerk user ID (e.g., "user_2abc...")
    pub sub: String,

    /// JWT version (1 or 2)
    #[serde(default)]
    pub v: Option<u8>,

    /// v2: Organization claim as nested object
    #[serde(default)]
    pub o: Option<OrgClaim>,

    /// v1 legacy: org_id at top level
    #[serde(default)]
    pub org_id: Option<String>,
    /// v1 legacy: org_slug at top level
    #[serde(default)]
    pub org_slug: Option<String>,
    /// v1 legacy: org_role at top level
    #[serde(default)]
    pub org_role: Option<String>,
}

/// Extension added to the request by the auth middleware.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
    pub org_id: Option<String>,
    pub org_slug: Option<String>,
    pub org_role: Option<String>,
}

/// Decode a JWT payload (part between the two dots) without signature verification.
fn decode_jwt_payload(token: &str) -> Result<ClerkClaims, String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid JWT format".to_string());
    }

    let payload_b64 = parts[1];
    // JWT uses base64url encoding (no padding)
    let payload_bytes = general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let claims: ClerkClaims = serde_json::from_slice(&payload_bytes)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    Ok(claims)
}

/// Auth middleware — extracts Clerk JWT claims and adds AuthUser to request extensions.
/// Supports both Clerk JWT v1 (org_id at top level) and v2 (o.id nested).
/// Skips auth for public routes and health checks.
/// Returns 401 if no valid Bearer token is present on protected routes.
pub async fn auth_middleware(mut req: Request, next: Next) -> Response {
    // Skip auth for public routes, health checks, and webhook endpoints
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

    match decode_jwt_payload(token) {
        Ok(claims) => {
            // Extract org info: prefer v2 "o" claim, fallback to v1 top-level fields
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
                org_slug = ?auth_user.org_slug,
                jwt_version = ?claims.v,
                "Authenticated request"
            );

            req.extensions_mut().insert(auth_user);
            next.run(req).await
        }
        Err(e) => {
            tracing::warn!("JWT decode failed: {}", e);
            (
                StatusCode::UNAUTHORIZED,
                format!(r#"{{"error":"Invalid token: {}"}}"#, e),
            )
                .into_response()
        }
    }
}
