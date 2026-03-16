use axum::{extract::{Extension, Path}, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::middleware::AuthUser;
use super::admin::fetch_org_members;

/// GET /orgs/{org_id}/members — list members of a specific org via Clerk API.
/// The caller must belong to the requested org (verified via their JWT org memberships).
pub async fn list_members(
    Extension(auth): Extension<AuthUser>,
    Path(org_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Verify the user belongs to the requested org
    let user_orgs = crate::routes::issues::fetch_user_org_ids(&auth.user_id)
        .await
        .unwrap_or_default();

    if !user_orgs.contains(&org_id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "You are not a member of this organization"})),
        ));
    }

    let members = fetch_org_members(&org_id).await;
    Ok(Json(json!({ "data": members })))
}
