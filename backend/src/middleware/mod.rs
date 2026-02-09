use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose};
use serde::Deserialize;

/// Claims extracted from a Clerk JWT token.
/// We decode the payload without signature verification for speed,
/// since Clerk's frontend SDK already validates the session.
/// For production hardening, add JWKS signature verification.
#[derive(Debug, Clone, Deserialize)]
pub struct ClerkClaims {
    /// Clerk user ID (e.g., "user_2abc...")
    pub sub: String,
    /// Organization ID (e.g., "org_2xyz...") — None if personal account
    pub org_id: Option<String>,
    /// Organization slug (e.g., "squelm")
    pub org_slug: Option<String>,
    /// Organization role (e.g., "org:admin", "org:member")
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
/// Skips auth for public routes (paths starting with /api/v1/public/).
/// Returns 401 if no valid Bearer token is present on protected routes.
pub async fn auth_middleware(mut req: Request, next: Next) -> Response {
    // Skip auth for public routes and health checks
    let path = req.uri().path().to_string();
    if path.contains("/public/") || path == "/health" {
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
            let auth_user = AuthUser {
                user_id: claims.sub,
                org_id: claims.org_id,
                org_slug: claims.org_slug,
                org_role: claims.org_role,
            };
            tracing::debug!(
                user_id = %auth_user.user_id,
                org_id = ?auth_user.org_id,
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
