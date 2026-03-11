use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;

use crate::middleware::AuthUser;

#[derive(Debug, Deserialize)]
pub struct SetPlanBody {
    pub plan: String,
}

/// PATCH /admin/orgs/{id}/plan — set org plan (free/pro/enterprise)
/// Requires authenticated user. In production, restrict to org:admin role.
pub async fn set_plan(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
    Json(body): Json<SetPlanBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Role check: must be admin or be operating on own org
    let is_admin = auth.org_role.as_deref()
        .map(|r| r.contains("admin"))
        .unwrap_or(false);
    let is_own_org = auth.org_id.as_deref() == Some(org_id.as_str());

    if !is_admin && !is_own_org {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin role required"}))));
    }

    if !matches!(body.plan.as_str(), "free" | "pro" | "enterprise") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid plan. Must be one of: free, pro, enterprise"
            })),
        ));
    }

    // Upsert org first (in case it doesn't exist yet)
    sqlx::query(
        "INSERT INTO organizations (id, name, slug, plan) VALUES ($1, $1, $1, $2) ON CONFLICT (id) DO UPDATE SET plan = $2"
    )
    .bind(&org_id)
    .bind(&body.plan)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tracing::info!(
        admin_user = %auth.user_id,
        org_id = %org_id,
        plan = %body.plan,
        "admin.set_plan"
    );

    Ok(Json(json!({
        "data": {
            "org_id": org_id,
            "plan": body.plan
        }
    })))
}
