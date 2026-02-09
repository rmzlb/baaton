use axum::{extract::Extension, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Deserialize)]
pub struct InviteRequest {
    pub email_address: String,
    pub role: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct InviteResponse {
    pub id: String,
    pub email_address: String,
    pub status: String,
    pub role: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClerkInviteResponse {
    id: String,
    email_address: String,
    status: String,
    role: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClerkListResponse {
    data: Vec<ClerkInviteResponse>,
}

fn get_clerk_secret() -> Result<String, (StatusCode, String)> {
    std::env::var("CLERK_SECRET_KEY").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"CLERK_SECRET_KEY not configured"}"#.to_string(),
        )
    })
}

/// GET /api/v1/invites — List pending org invitations with their URLs.
pub async fn list(
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<ApiResponse<Vec<InviteResponse>>>, (StatusCode, String)> {
    let org_id = auth.org_id.as_deref().ok_or((
        StatusCode::BAD_REQUEST,
        r#"{"error":"No active organization"}"#.to_string(),
    ))?;

    let clerk_secret = get_clerk_secret()?;

    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "https://api.clerk.com/v1/organizations/{}/invitations?status=pending",
            org_id
        ))
        .header("Authorization", format!("Bearer {}", clerk_secret))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!(r#"{{"error":"{}"}}"#, e)))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_GATEWAY, body));
    }

    let clerk_resp: ClerkListResponse = resp
        .json()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!(r#"{{"error":"{}"}}"#, e)))?;

    let invites = clerk_resp
        .data
        .into_iter()
        .map(|inv| InviteResponse {
            id: inv.id,
            email_address: inv.email_address,
            status: inv.status,
            role: inv.role,
            url: inv.url,
        })
        .collect();

    Ok(Json(ApiResponse::new(invites)))
}

/// POST /api/v1/invites — Create an org invitation via Clerk Backend API.
/// Returns the invitation URL so the frontend can display a "Copy link" button.
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<InviteRequest>,
) -> Result<Json<ApiResponse<InviteResponse>>, (StatusCode, String)> {
    let org_id = auth.org_id.as_deref().ok_or((
        StatusCode::BAD_REQUEST,
        r#"{"error":"No active organization"}"#.to_string(),
    ))?;

    let clerk_secret = get_clerk_secret()?;

    let role = body.role.unwrap_or_else(|| "org:member".to_string());

    // Call Clerk Backend API
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://api.clerk.com/v1/organizations/{}/invitations",
            org_id
        ))
        .header("Authorization", format!("Bearer {}", clerk_secret))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "email_address": body.email_address,
            "role": role,
            "redirect_url": "https://app.baaton.dev/dashboard",
        }))
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!(r#"{{"error":"Clerk API error: {}"}}"#, e),
            )
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            body_text,
        ));
    }

    let clerk_resp: ClerkInviteResponse = resp.json().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(r#"{{"error":"Failed to parse Clerk response: {}"}}"#, e),
        )
    })?;

    Ok(Json(ApiResponse::new(InviteResponse {
        id: clerk_resp.id,
        email_address: clerk_resp.email_address,
        status: clerk_resp.status,
        role: clerk_resp.role,
        url: clerk_resp.url,
    })))
}
