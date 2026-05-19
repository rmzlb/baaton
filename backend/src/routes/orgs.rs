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

// ── GET /orgs/{org_id} — read org metadata + feature flags ──
//
// S1: the frontend (Settings page, AgentRunCard) needs to read the real
// org gate state so its toggles aren't cosmetic. Caller must belong to
// the requested org (mirrors list_members auth pattern, but uses the JWT
// org claim directly — same check as update_settings).
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<Value>)> {
    if auth.org_id.as_deref() != Some(&org_id) {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "not_in_org"}))));
    }

    let row: Option<(String, Option<bool>)> = sqlx::query_as(
        "SELECT id, agent_runs_public_enabled FROM organizations WHERE id = $1",
    )
    .bind(&org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, org_id = %org_id, "orgs.get_one query failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "db"})))
    })?;

    match row {
        Some((id, flag)) => Ok(Json(ApiResponse::new(json!({
            "id": id,
            "agent_runs_public_enabled": flag.unwrap_or(false),
        })))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "not_found"})))),
    }
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

    // S5: only admins/owners can flip org-level feature flags.
    // Clerk JWTs surface the role with the `org:` prefix when the `o` claim is
    // present (see middleware/mod.rs). Accept the bare and prefixed forms so
    // the gate works regardless of which JWT shape Clerk emits.
    let role = auth.org_role.as_deref().unwrap_or("");
    if !matches!(role, "admin" | "org:admin" | "owner" | "org:owner") {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "admin_only"}))));
    }

    // S2: return the updated row so the frontend's Promise<Organization>
    // type matches reality. Prior shape was {ok: true} which lied to TS.
    let row: Option<(String, Option<bool>)> = if let Some(enabled) = body.agent_runs_public_enabled {
        sqlx::query_as(
            "UPDATE organizations SET agent_runs_public_enabled = $2 WHERE id = $1 \
             RETURNING id, agent_runs_public_enabled",
        )
        .bind(&org_id)
        .bind(enabled)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, org_id = %org_id, "update_org_settings failed");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "db"})))
        })?
    } else {
        // No-op patch: just echo the current state.
        sqlx::query_as(
            "SELECT id, agent_runs_public_enabled FROM organizations WHERE id = $1",
        )
        .bind(&org_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, org_id = %org_id, "update_org_settings noop read failed");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "db"})))
        })?
    };

    match row {
        Some((id, flag)) => Ok(Json(ApiResponse::new(json!({
            "id": id,
            "agent_runs_public_enabled": flag.unwrap_or(false),
        })))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "org_not_found"})))),
    }
}

// ── GET /public/orgs/:org_id/jwks.json — JWKS for an org (Ed25519 OKP) ──
//
// Public, no auth. Lets anyone verify a signed agent run receipt offline:
// pull this JWKS, find the matching `kid`, and verify the signature.
pub async fn public_jwks(
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let jwks = crate::receipts::build_jwks(&pool, &org_id).await.map_err(|e| {
        tracing::error!(error = %e, "build_jwks failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "db"})))
    })?;
    Ok(Json(jwks))
}
