use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;
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

// ── PATCH /orgs/{org_id}/settings — toggle org-level feature flags ──

#[derive(Debug, Deserialize)]
pub struct UpdateOrgSettings {
    pub agent_runs_public_enabled: Option<bool>,
}

pub async fn update_settings(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
    Json(body): Json<UpdateOrgSettings>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<Value>)> {
    // Caller must be a member of the requested org.
    if auth.org_id.as_deref() != Some(&org_id) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "not_in_org"}))));
    }

    if let Some(enabled) = body.agent_runs_public_enabled {
        let res = sqlx::query(
            "UPDATE organizations SET agent_runs_public_enabled = $2 WHERE id = $1",
        )
        .bind(&org_id)
        .bind(enabled)
        .execute(&pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, org_id = %org_id, "update_org_settings failed");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "db"})))
        })?;

        if res.rows_affected() == 0 {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "org_not_found"})),
            ));
        }
    }

    Ok(Json(ApiResponse::new(json!({"ok": true}))))
}
