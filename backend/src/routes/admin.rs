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

/// GET /billing — get current org plan, usage, and limits
pub async fn get_billing(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Get plan + project count
    let plan_row = sqlx::query_as::<_, (Option<String>, i64)>(
        r#"
        SELECT o.plan, COUNT(p.id) AS project_count
        FROM organizations o
        LEFT JOIN projects p ON p.org_id = o.id
        WHERE o.id = $1
        GROUP BY o.plan
        "#,
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (plan, project_count) = plan_row
        .map(|(p, c)| (p.unwrap_or_else(|| "free".to_string()), c))
        .unwrap_or(("free".to_string(), 0));

    // Get API request count this month
    let month = chrono::Utc::now().format("%Y-%m").to_string();
    let api_count: i64 = sqlx::query_scalar(
        "SELECT COALESCE(count, 0) FROM api_request_log WHERE org_id = $1 AND month = $2"
    )
    .bind(org_id)
    .bind(&month)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(0);

    // Member count
    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM (SELECT DISTINCT creator_user_id AS user_id FROM issues WHERE org_id = $1 UNION SELECT DISTINCT unnest(assignee_ids) FROM issues WHERE org_id = $1) AS users"
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(0);

    let (project_limit, api_limit, member_limit) = match plan.as_str() {
        "free" => (3, 1000, 5),
        "pro" => (10, 10000, 25),
        "enterprise" => (-1, -1, -1), // unlimited
        _ => (3, 1000, 5),
    };

    Ok(Json(json!({
        "data": {
            "plan": plan,
            "usage": {
                "projects": { "current": project_count, "limit": project_limit },
                "api_requests": { "current": api_count, "limit": api_limit, "month": month },
                "members": { "current": member_count, "limit": member_limit }
            }
        }
    })))
}
