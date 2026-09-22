use axum::{extract::{Extension, Path, State, Query}, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::middleware::AuthUser;

// ─── Superadmin guard ──────────────────────────────────────────────────────

/// Check if user is a super admin (platform-level, not org-level).
/// Checks super_admins table by user_id OR by email.
async fn is_super_admin(pool: &PgPool, auth: &AuthUser) -> bool {
    // Check by user_id
    let by_id: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM super_admins WHERE user_id = $1)"
    )
    .bind(&auth.user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if by_id { return true; }

    // Check by email (for initial setup before user_id is known)
    // Handles both NULL and empty string '' for user_id (migration seed uses '')
    if let Some(ref email) = auth.email {
        let by_email: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM super_admins WHERE email = $1 AND (user_id IS NULL OR user_id = ''))"
        )
        .bind(email)
        .fetch_one(pool)
        .await
        .unwrap_or(false);

        if by_email {
            // Auto-fill user_id for future lookups
            // user_id is PK so we need DELETE + INSERT (can't UPDATE PK)
            let _ = sqlx::query(
                "DELETE FROM super_admins WHERE email = $1 AND (user_id IS NULL OR user_id = '')"
            )
            .bind(email)
            .execute(pool)
            .await;
            let _ = sqlx::query(
                "INSERT INTO super_admins (user_id, email, granted_by) VALUES ($1, $2, 'auto') ON CONFLICT (user_id) DO NOTHING"
            )
            .bind(&auth.user_id)
            .bind(email)
            .execute(pool)
            .await;
            tracing::info!(user_id = %auth.user_id, email = %email, "Auto-linked super admin by email");
            return true;
        }
    }

    false
}

/// Quick super admin check by user_id only (no email resolution).
/// Used by plan_guard to bypass quotas for platform admins.
pub async fn is_super_admin_quick(pool: &PgPool, user_id: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM super_admins WHERE user_id = $1)"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false)
}

fn forbidden() -> (StatusCode, Json<Value>) {
    (StatusCode::FORBIDDEN, Json(json!({"error": "Super admin access required"})))
}

/// Record an admin action in the audit log
async fn audit_log(pool: &PgPool, auth: &AuthUser, action: &str, target_type: &str, target_id: &str, details: Value) {
    let _ = sqlx::query(
        "INSERT INTO admin_audit_log (admin_user_id, admin_email, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(&auth.user_id)
    .bind(&auth.email)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(&details)
    .execute(pool)
    .await;
}

// ─── Plan management ──────────────────────────────────────────────────────

const VALID_PLANS: &[&str] = &["free", "pro", "enterprise", "partner", "tester", "unlimited"];

#[derive(Debug, Deserialize)]
pub struct SetPlanBody {
    pub plan: String,
}

/// PATCH /admin/orgs/{id}/plan — set the organization's plan.
/// Superadmin: can set any plan. Org admin: can only set free/pro/enterprise on own org.
/// The plan is the org's entitlement (entitlement.rs): every member and every
/// API key of the org consume it. Nothing is copied onto members' own plans —
/// that copy (migration 040 era) made a paid plan leak into members' other orgs
/// and left later joiners on free.
pub async fn set_plan(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
    Json(body): Json<SetPlanBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let sa = is_super_admin(&pool, &auth).await;
    let is_org_admin = auth.org_role.as_deref()
        .map(|r| r.contains("admin"))
        .unwrap_or(false);
    let is_own_org = auth.org_id.as_deref() == Some(org_id.as_str());

    // Special plans require superadmin
    let special_plans = ["partner", "tester", "unlimited"];
    if special_plans.contains(&body.plan.as_str()) && !sa {
        return Err(forbidden());
    }

    // Regular plans: need org admin or superadmin
    if !sa && !(is_org_admin && is_own_org) {
        return Err(forbidden());
    }

    if !VALID_PLANS.contains(&body.plan.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Invalid plan. Must be one of: {}", VALID_PLANS.join(", ")),
                "accepted_values": VALID_PLANS,
            })),
        ));
    }

    sqlx::query(
        "INSERT INTO organizations (id, name, slug, plan) VALUES ($1, $1, $1, $2) ON CONFLICT (id) DO UPDATE SET plan = $2"
    )
    .bind(&org_id)
    .bind(&body.plan)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    ensure_org_name(&pool, &org_id).await;

    audit_log(&pool, &auth, "set_plan", "organization", &org_id, json!({ "plan": body.plan })).await;

    tracing::info!(
        admin_user = %auth.user_id,
        org_id = %org_id,
        plan = %body.plan,
        is_super_admin = sa,
        "admin.set_plan"
    );

    Ok(Json(json!({
        "data": {
            "org_id": org_id,
            "plan": body.plan
        }
    })))
}

// ─── PATCH /admin/users/{user_id}/plan — set user plan directly ──────────

#[derive(Debug, Deserialize)]
pub struct SetUserPlanBody {
    pub plan: String,
}

pub async fn set_user_plan(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(user_id): Path<String>,
    Json(body): Json<SetUserPlanBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    if !VALID_PLANS.contains(&body.plan.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Invalid plan. Must be one of: {}", VALID_PLANS.join(", ")),
            "accepted_values": VALID_PLANS,
        }))));
    }

    sqlx::query(
        "INSERT INTO user_plans (user_id, plan, updated_by) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id) DO UPDATE SET plan = $2, updated_at = now(), updated_by = $3"
    )
    .bind(&user_id)
    .bind(&body.plan)
    .bind(&auth.user_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    audit_log(&pool, &auth, "set_user_plan", "user", &user_id, json!({ "plan": body.plan })).await;

    Ok(Json(json!({ "data": { "user_id": user_id, "plan": body.plan } })))
}

// ─── GET /admin/superadmin/check — check if current user is superadmin ───

pub async fn check_superadmin(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Json<Value> {
    let sa = is_super_admin(&pool, &auth).await;
    Json(json!({ "data": { "is_super_admin": sa } }))
}

// ─── GET /admin/overview — platform-wide analytics (superadmin only) ─────

pub async fn platform_overview(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    // Total counts
    let total_orgs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organizations")
        .fetch_one(&pool).await.unwrap_or(0);
    let total_projects: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects")
        .fetch_one(&pool).await.unwrap_or(0);
    let total_issues: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM issues")
        .fetch_one(&pool).await.unwrap_or(0);
    let total_comments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments")
        .fetch_one(&pool).await.unwrap_or(0);
    let total_api_keys: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_keys")
        .fetch_one(&pool).await.unwrap_or(0);
    let total_automations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM automations")
        .fetch_one(&pool).await.unwrap_or(0);
    let total_webhooks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webhooks")
        .fetch_one(&pool).await.unwrap_or(0);

    // AI usage this month
    let ai_this_month: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ai_usage WHERE created_at >= date_trunc('month', now())"
    ).fetch_one(&pool).await.unwrap_or(0);

    let ai_tokens_in: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(tokens_in), 0) FROM ai_usage WHERE created_at >= date_trunc('month', now())"
    ).fetch_one(&pool).await.unwrap_or(0);

    let ai_tokens_out: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(tokens_out), 0) FROM ai_usage WHERE created_at >= date_trunc('month', now())"
    ).fetch_one(&pool).await.unwrap_or(0);

    // Plan distribution
    let plan_dist = sqlx::query_as::<_, (String, i64)>(
        "SELECT COALESCE(plan, 'free'), COUNT(*) FROM organizations GROUP BY plan ORDER BY COUNT(*) DESC"
    )
    .fetch_all(&pool).await.unwrap_or_default();

    let plans: Value = plan_dist.iter().map(|(plan, count)| {
        json!({ "plan": plan, "count": count })
    }).collect::<Vec<_>>().into();

    // Issues created per day (last 30 days)
    let daily_issues = sqlx::query_as::<_, (String, i64)>(
        "SELECT created_at::date::text, COUNT(*) FROM issues WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1"
    ).fetch_all(&pool).await.unwrap_or_default();

    let daily: Vec<Value> = daily_issues.iter().map(|(day, count)| {
        json!({ "date": day, "count": count })
    }).collect();

    // Top 10 orgs by usage
    let top_orgs = sqlx::query_as::<_, (String, String, i64, i64)>(
        r#"SELECT o.id, COALESCE(o.name, o.id), COUNT(DISTINCT p.id), COUNT(i.id)
           FROM organizations o
           LEFT JOIN projects p ON p.org_id = o.id
           LEFT JOIN issues i ON i.project_id = p.id
           GROUP BY o.id, o.name
           ORDER BY COUNT(i.id) DESC
           LIMIT 10"#
    ).fetch_all(&pool).await.unwrap_or_default();

    let orgs: Vec<Value> = top_orgs.iter().map(|(id, name, projects, issues)| {
        json!({ "org_id": id, "name": name, "projects": projects, "issues": issues })
    }).collect();

    // Estimated AI cost
    let est_cost = (ai_tokens_in as f64 * 0.000000075) + (ai_tokens_out as f64 * 0.0000003);

    Ok(Json(json!({
        "data": {
            "totals": {
                "organizations": total_orgs,
                "projects": total_projects,
                "issues": total_issues,
                "comments": total_comments,
                "api_keys": total_api_keys,
                "automations": total_automations,
                "webhooks": total_webhooks,
            },
            "ai_usage_this_month": {
                "messages": ai_this_month,
                "tokens_in": ai_tokens_in,
                "tokens_out": ai_tokens_out,
                "estimated_cost_usd": format!("{:.4}", est_cost),
            },
            "plan_distribution": plans,
            "daily_issues_30d": daily,
            "top_orgs": orgs,
        }
    })))
}

// ─── GET /admin/users — list all users with their orgs & plans (superadmin) ──

#[derive(Debug, Deserialize)]
pub struct UserListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub plan: Option<String>,
    pub search: Option<String>,
}

pub async fn list_users(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<UserListParams>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0);

    // Get all orgs with their plans
    let orgs = sqlx::query_as::<_, (String, String, String, String, chrono::DateTime<chrono::Utc>)>(
        r#"SELECT
            o.id,
            COALESCE(o.name, o.id),
            o.slug,
            COALESCE(o.plan, 'free'),
            o.created_at
           FROM organizations o
           ORDER BY o.created_at DESC
           LIMIT $1 OFFSET $2"#
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Resolve org names from Clerk for any org where name == id
    for (org_id, name, _, _, _) in &orgs {
        if name == org_id || name.starts_with("org_") {
            ensure_org_name(&pool, org_id).await;
        }
    }
    // Re-fetch after resolution to get updated names and owners
    let orgs = sqlx::query_as::<_, (String, String, String, String, chrono::DateTime<chrono::Utc>, Option<String>)>(
        r#"SELECT o.id, COALESCE(o.name, o.id), o.slug, COALESCE(o.plan, 'free'), o.created_at, o.owner_user_id
           FROM organizations o ORDER BY o.created_at DESC LIMIT $1 OFFSET $2"#
    ).bind(limit).bind(offset).fetch_all(&pool).await.unwrap_or_default();

    let mut org_list: Vec<Value> = Vec::new();

    for (org_id, name, slug, plan, created_at, owner_user_id) in &orgs {
        // The plan that actually governs the org: its own plan, raised to its
        // owner's (entitlement.rs). The admin filters and reads on that one.
        let ent = crate::entitlement::org_entitlement(&pool, org_id).await;
        let owner_plan = ent.owner_plan.clone();
        let effective_plan = ent.effective_plan.clone();
        let plan_source = ent.plan_source;
        // Apply plan filter (on the effective plan)
        if let Some(ref filter_plan) = params.plan {
            if &effective_plan != filter_plan { continue; }
        }

        // Apply search filter
        if let Some(ref q) = params.search {
            let q_lower = q.to_lowercase();
            if !name.to_lowercase().contains(&q_lower)
                && !slug.to_lowercase().contains(&q_lower)
                && !org_id.to_lowercase().contains(&q_lower) {
                continue;
            }
        }

        let project_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM projects WHERE org_id = $1"
        ).bind(org_id).fetch_one(&pool).await.unwrap_or(0);

        let issue_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM issues i JOIN projects p ON i.project_id = p.id WHERE p.org_id = $1"
        ).bind(org_id).fetch_one(&pool).await.unwrap_or(0);

        let key_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM api_keys WHERE org_id = $1"
        ).bind(org_id).fetch_one(&pool).await.unwrap_or(0);

        let automation_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM automations a JOIN projects p ON a.project_id = p.id WHERE p.org_id = $1"
        ).bind(org_id).fetch_one(&pool).await.unwrap_or(0);

        let last_issue: Option<String> = sqlx::query_scalar(
            "SELECT MAX(i.created_at)::text FROM issues i JOIN projects p ON i.project_id = p.id WHERE p.org_id = $1"
        ).bind(org_id).fetch_optional(&pool).await.ok().flatten();

        let ai_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ai_usage WHERE org_id = $1 AND created_at >= date_trunc('month', now())"
        ).bind(org_id).fetch_one(&pool).await.unwrap_or(0);

        // Fetch member count + emails from Clerk
        let member_info = fetch_org_members(org_id).await;
        let owner_email = owner_user_id.as_deref().and_then(|owner| {
            member_info.iter().find_map(|m| {
                (m.get("user_id").and_then(|u| u.as_str()) == Some(owner))
                    .then(|| m.get("email").and_then(|e| e.as_str()).map(|e| e.to_string()))
                    .flatten()
            })
        });

        org_list.push(json!({
            "org_id": org_id,
            "name": name,
            "slug": slug,
            "plan": plan,
            "effective_plan": effective_plan,
            "plan_source": plan_source,
            "owner_user_id": owner_user_id,
            "owner_email": owner_email,
            "owner_plan": owner_plan,
            "created_at": created_at.to_rfc3339(),
            "projects": project_count,
            "issues": issue_count,
            "api_keys": key_count,
            "automations": automation_count,
            "ai_messages_this_month": ai_count,
            "last_activity": last_issue,
            "members": member_info,
        }));
    }

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organizations")
        .fetch_one(&pool).await.unwrap_or(0);

    // Collect all unique user_ids and fetch their plans
    let mut all_user_ids: Vec<String> = Vec::new();
    for org in &org_list {
        if let Some(members) = org.get("members").and_then(|m| m.as_array()) {
            for m in members {
                if let Some(uid) = m.get("user_id").and_then(|u| u.as_str()) {
                    if !uid.is_empty() && !all_user_ids.contains(&uid.to_string()) {
                        all_user_ids.push(uid.to_string());
                    }
                }
            }
        }
    }

    // Batch-fetch user plans
    let user_plans_map: std::collections::HashMap<String, String> = if !all_user_ids.is_empty() {
        sqlx::query_as::<_, (String, String)>(
            "SELECT user_id, plan FROM user_plans WHERE user_id = ANY($1)"
        )
        .bind(&all_user_ids)
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect()
    } else {
        std::collections::HashMap::new()
    };

    // Convert to JSON map (missing = "free")
    let plans_json: serde_json::Map<String, Value> = all_user_ids.iter().map(|uid| {
        (uid.clone(), json!(user_plans_map.get(uid).cloned().unwrap_or_else(|| "free".to_string())))
    }).collect();

    Ok(Json(json!({
        "data": {
            "organizations": org_list,
            "user_plans": plans_json,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    })))
}

/// Fetch org members from Clerk API
pub async fn fetch_org_members(org_id: &str) -> Vec<Value> {
    let clerk_key = std::env::var("CLERK_SECRET_KEY").unwrap_or_default();
    if clerk_key.is_empty() { return vec![]; }

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("https://api.clerk.com/v1/organizations/{org_id}/memberships?limit=100"))
        .header("Authorization", format!("Bearer {clerk_key}"))
        .send()
        .await;

    match resp {
        Ok(r) => {
            if let Ok(body) = r.json::<Value>().await {
                if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
                    return data.iter().filter_map(|m| {
                        let user = m.get("public_user_data")?;
                        Some(json!({
                            "user_id": user.get("user_id")?.as_str()?,
                            "email": user.get("identifier").and_then(|i| i.as_str()).unwrap_or(""),
                            "first_name": user.get("first_name").and_then(|n| n.as_str()).unwrap_or(""),
                            "last_name": user.get("last_name").and_then(|n| n.as_str()).unwrap_or(""),
                            "image_url": user.get("image_url").and_then(|u| u.as_str()).unwrap_or(""),
                            "role": m.get("role").and_then(|r| r.as_str()).unwrap_or("member"),
                        }))
                    }).collect();
                }
            }
            vec![]
        }
        Err(_) => vec![],
    }
}

// ─── POST /admin/superadmins — add a super admin (superadmin only) ──────

#[derive(Debug, Deserialize)]
pub struct AddSuperAdminBody {
    pub email: String,
    pub user_id: Option<String>,
}

pub async fn add_super_admin(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<AddSuperAdminBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    sqlx::query(
        "INSERT INTO super_admins (user_id, email, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
    )
    .bind(&body.user_id.unwrap_or_default())
    .bind(&body.email)
    .bind(&auth.user_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    audit_log(&pool, &auth, "add_superadmin", "superadmin", &body.email, json!({})).await;
    tracing::info!(admin = %auth.user_id, new_admin = %body.email, "superadmin.added");

    Ok(Json(json!({ "data": { "email": body.email, "status": "granted" } })))
}

// ─── DELETE /admin/superadmins/{email} — remove super admin ─────────────

pub async fn remove_super_admin(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(email): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    // Can't remove yourself
    if auth.email.as_deref() == Some(email.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Cannot remove yourself as super admin"}))));
    }

    sqlx::query("DELETE FROM super_admins WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    audit_log(&pool, &auth, "remove_superadmin", "superadmin", &email, json!({})).await;

    Ok(Json(json!({ "data": { "email": email, "status": "revoked" } })))
}

// ─── GET /admin/superadmins — list super admins ─────────────────────────

pub async fn list_super_admins(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    let admins = sqlx::query_as::<_, (String, Option<String>, chrono::DateTime<chrono::Utc>, Option<String>)>(
        "SELECT COALESCE(user_id, ''), email, granted_at, granted_by FROM super_admins ORDER BY granted_at"
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let list: Vec<Value> = admins.iter().map(|(uid, email, at, by)| json!({
        "user_id": uid,
        "email": email,
        "granted_at": at.to_rfc3339(),
        "granted_by": by,
    })).collect();

    Ok(Json(json!({ "data": list })))
}

// ─── GET /billing — plan and usage of the current organization ──────────
//
// Read like Vercel or Supabase: the plan belongs to the organization, the
// page shows the current org (plan, where it comes from, usage, per project)
// and lists every organization the caller belongs to with its own plan. The
// free allowance is one pool across the owner's free organizations, so the
// counted usage says which orgs it spans.

pub async fn get_billing(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    use crate::routes::issues::resolve_user_org_ids_from_auth;

    let mut org_ids = resolve_user_org_ids_from_auth(&auth).await.map_err(|e| {
        tracing::error!(error = %e, "billing: failed to fetch org memberships");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to resolve organizations"})))
    })?;
    if let Some(ref current) = auth.org_id {
        if !org_ids.contains(current) {
            org_ids.push(current.clone());
        }
    }

    let current_org = auth.org_id.as_deref()
        .or(org_ids.first().map(|s| s.as_str()))
        .unwrap_or("unknown");
    let human = crate::entitlement::human_actor(&auth).map(|s| s.to_string());

    let entitlement = crate::entitlement::org_entitlement(&pool, current_org).await;
    let plan = crate::entitlement::effective_plan(&pool, &auth, current_org).await;
    let plan_config = plan_limits(&plan);
    let scope = crate::entitlement::quota_scope(&pool, current_org, &plan).await;

    // Names come from the organizations table (resolved from Clerk when the
    // org was first seen); an unresolved org shows its id.
    #[derive(sqlx::FromRow)]
    struct OrgRow { id: String, name: String }
    let org_rows: Vec<OrgRow> = if org_ids.is_empty() { Vec::new() } else {
        sqlx::query_as::<_, OrgRow>(
            "SELECT id, COALESCE(name, id) AS name FROM organizations WHERE id = ANY($1)"
        ).bind(&org_ids).fetch_all(&pool).await.unwrap_or_default()
    };
    let org_name = |id: &str| -> String {
        org_rows.iter().find(|o| o.id == id).map(|o| o.name.clone()).unwrap_or_else(|| id.to_string())
    };

    #[derive(sqlx::FromRow)]
    struct CountRow { org_id: String, project_count: i64, issue_count: i64 }
    let counts: Vec<CountRow> = if org_ids.is_empty() { Vec::new() } else {
        sqlx::query_as::<_, CountRow>(
            r#"SELECT p.org_id, COUNT(DISTINCT p.id) AS project_count, COUNT(i.id) AS issue_count
               FROM projects p LEFT JOIN issues i ON i.project_id = p.id
               WHERE p.org_id = ANY($1) GROUP BY p.org_id"#
        ).bind(&org_ids).fetch_all(&pool).await.unwrap_or_default()
    };
    let count_of = |id: &str| -> (i64, i64) {
        counts.iter().find(|c| c.org_id == id).map(|c| (c.project_count, c.issue_count)).unwrap_or((0, 0))
    };

    // Every organization the caller belongs to, each with the plan that governs it.
    let mut organizations: Vec<Value> = Vec::with_capacity(org_ids.len());
    for oid in &org_ids {
        let ent = if oid == current_org { entitlement.clone() } else { crate::entitlement::org_entitlement(&pool, oid).await };
        let (project_count, issue_count) = count_of(oid);
        organizations.push(json!({
            "org_id": oid,
            "org_name": org_name(oid),
            "plan": ent.plan,
            "effective_plan": ent.effective_plan,
            "plan_source": ent.plan_source,
            "owner_is_me": human.as_deref().is_some() && ent.owner_user_id.as_deref() == human.as_deref(),
            "is_current": oid == current_org,
            "project_count": project_count,
            "issue_count": issue_count,
        }));
    }
    organizations.sort_by(|a, b| {
        let cur = |v: &Value| v.get("is_current").and_then(|x| x.as_bool()).unwrap_or(false);
        cur(b).cmp(&cur(a)).then_with(|| {
            let issues = |v: &Value| v.get("issue_count").and_then(|x| x.as_i64()).unwrap_or(0);
            issues(b).cmp(&issues(a))
        })
    });

    // Usage counted on the quota scope: the org alone on a paid plan, every
    // free org of the owner on the free plan.
    let (scoped_projects, scoped_issues): (i64, i64) = sqlx::query_as(
        r#"SELECT COUNT(DISTINCT p.id), COUNT(i.id)
           FROM projects p LEFT JOIN issues i ON i.project_id = p.id WHERE p.org_id = ANY($1)"#
    ).bind(&scope).fetch_one(&pool).await.unwrap_or((0, 0));
    let scoped_keys: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_keys WHERE org_id = ANY($1)")
        .bind(&scope).fetch_one(&pool).await.unwrap_or(0);
    let scoped_automations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM automation_rules ar JOIN projects p ON p.id = ar.project_id WHERE p.org_id = ANY($1)"
    ).bind(&scope).fetch_one(&pool).await.unwrap_or(0);
    let month = chrono::Utc::now().format("%Y-%m").to_string();
    let api_count: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(count), 0) FROM api_request_log WHERE org_id = ANY($1) AND month = $2")
            .bind(&scope).bind(&month).fetch_optional(&pool).await.ok().flatten().unwrap_or(0);
    let ai_count: i64 = match human.as_deref() {
        Some(user_id) => sqlx::query_scalar(
            "SELECT COUNT(*) FROM ai_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())"
        ).bind(user_id).fetch_one(&pool).await.unwrap_or(0),
        None => 0,
    };

    // The current organization, project by project.
    #[derive(sqlx::FromRow)]
    struct ProjectRow { id: uuid::Uuid, name: String, prefix: String, issue_count: i64, open_count: i64 }
    let projects: Vec<Value> = sqlx::query_as::<_, ProjectRow>(
        r#"SELECT p.id, p.name, p.prefix,
                  COUNT(i.id) AS issue_count,
                  COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled')) AS open_count
           FROM projects p LEFT JOIN issues i ON i.project_id = p.id
           WHERE p.org_id = $1 GROUP BY p.id, p.name, p.prefix ORDER BY issue_count DESC, p.name"#
    ).bind(current_org).fetch_all(&pool).await.unwrap_or_default()
    .into_iter().map(|r| json!({
        "project_id": r.id, "name": r.name, "prefix": r.prefix,
        "issue_count": r.issue_count, "open_count": r.open_count,
    })).collect();

    let owner_is_me = human.as_deref().is_some() && entitlement.owner_user_id.as_deref() == human.as_deref();
    let free_pool: Option<Value> = if scope.len() > 1 {
        Some(json!({
            "org_ids": scope,
            "org_names": scope.iter().map(|id| org_name(id)).collect::<Vec<_>>(),
        }))
    } else { None };

    Ok(Json(json!({
        "data": {
            "plan": plan,
            "plan_org_id": current_org,
            "current_org": {
                "org_id": current_org,
                "org_name": org_name(current_org),
                "plan": entitlement.plan,
                "effective_plan": entitlement.effective_plan,
                "plan_source": entitlement.plan_source,
                "owner_user_id": entitlement.owner_user_id,
                "owner_is_me": owner_is_me,
                "projects": projects,
            },
            "free_pool": free_pool,
            "organizations": organizations,
            "usage": {
                "orgs": { "current": org_ids.len() as i64, "limit": plan_config.org_limit },
                "projects": { "current": scoped_projects, "limit": plan_config.project_limit },
                "issues": { "current": scoped_issues, "limit": plan_config.issue_limit },
                "api_requests": { "current": api_count, "limit": plan_config.api_limit, "month": month },
                "ai_messages": { "current": ai_count, "limit": plan_config.ai_limit, "month": month },
                "api_keys": { "current": scoped_keys, "limit": plan_config.key_limit },
                "automations": { "current": scoped_automations, "limit": plan_config.auto_limit },
                "users": { "limit": plan_config.user_limit }
            },
            "pricing": {
                "free": { "price": 0, "label": "$0/mo", "users_included": 2 },
                "pro": { "price": 19, "label": "$19/mo", "users_included": 3, "extra_user_price": 19 },
                "enterprise": { "price": -1, "label": "On demand", "users_included": -1 }
            }
        }
    })))
}

// ─── User plan lookup ────────────────────────────────────────────────────

/// Raw lookup of a human's `user_plans` row (free when absent). This is NOT the
/// plan that governs an action: use `crate::entitlement::effective_plan`, which
/// combines the organization's plan, its owner's plan and superadmin grants.
/// This is the ONLY function that should determine a user's plan.
pub async fn get_user_plan(pool: &PgPool, user_id: &str, _org_id: Option<&str>) -> String {
    let user_plan: Option<String> = sqlx::query_scalar(
        "SELECT plan FROM user_plans WHERE user_id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    user_plan.unwrap_or_else(|| "free".to_string())
}

// ─── Plan limits helper ──────────────────────────────────────────────────

pub struct PlanLimits { pub org_limit: i64, pub project_limit: i64, pub api_limit: i64, pub issue_limit: i64, pub user_limit: i64, pub ai_limit: i64, pub key_limit: i64, pub auto_limit: i64 }

pub fn plan_limits(plan: &str) -> PlanLimits {
    match plan {
        "free" =>       PlanLimits { org_limit: 1, project_limit: 3, api_limit: 1_000, issue_limit: 500, user_limit: 2, ai_limit: 50, key_limit: 3, auto_limit: 3 },
        "pro" =>        PlanLimits { org_limit: 5, project_limit: 25, api_limit: 100_000, issue_limit: -1, user_limit: -1, ai_limit: 2_000, key_limit: -1, auto_limit: -1 },
        // partner, tester, unlimited = same as enterprise (unlimited)
        "enterprise" | "partner" | "tester" | "unlimited" =>
                        PlanLimits { org_limit: -1, project_limit: -1, api_limit: -1, issue_limit: -1, user_limit: -1, ai_limit: -1, key_limit: -1, auto_limit: -1 },
        _ =>            PlanLimits { org_limit: 1, project_limit: 3, api_limit: 1_000, issue_limit: 500, user_limit: 2, ai_limit: 50, key_limit: 3, auto_limit: 3 },
    }
}

// ─── GET /billing/ai-usage — detailed AI usage report ───────────────────

pub async fn get_ai_usage(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let from = params.get("from").cloned().unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-01").to_string()
    });
    let to = params.get("to").cloned().unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-%d").to_string()
    });

    let rows = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT event_type, COUNT(*), COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0) \
         FROM ai_usage WHERE user_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day') \
         GROUP BY event_type"
    ).bind(&auth.user_id).bind(&from).bind(&to).fetch_all(&pool).await.unwrap_or_default();

    let mut by_type = serde_json::Map::new();
    let (mut total_messages, mut total_tokens_in, mut total_tokens_out) = (0i64, 0i64, 0i64);

    for (event_type, count, t_in, t_out) in &rows {
        total_messages += count;
        total_tokens_in += t_in;
        total_tokens_out += t_out;
        by_type.insert(event_type.clone(), json!({ "count": count, "tokens_in": t_in, "tokens_out": t_out }));
    }

    let daily = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT created_at::date::text, COUNT(*), COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0) \
         FROM ai_usage WHERE user_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day') \
         GROUP BY 1 ORDER BY 1"
    ).bind(&auth.user_id).bind(&from).bind(&to).fetch_all(&pool).await.unwrap_or_default();

    let daily_data: Vec<Value> = daily.iter().map(|(day, count, t_in, t_out)| json!({
        "date": day, "messages": count, "tokens_in": t_in, "tokens_out": t_out,
    })).collect();

    let est_cost = (total_tokens_in as f64 * 0.000000075) + (total_tokens_out as f64 * 0.0000003);

    Ok(Json(json!({
        "data": {
            "period": { "from": from, "to": to },
            "total": { "messages": total_messages, "tokens_in": total_tokens_in, "tokens_out": total_tokens_out, "estimated_cost_usd": format!("{:.4}", est_cost) },
            "by_type": by_type,
            "daily": daily_data,
        }
    })))
}

// ─── GET /admin/audit-log — admin audit log (superadmin only) ───────────

pub async fn get_audit_log(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !is_super_admin(&pool, &auth).await {
        return Err(forbidden());
    }

    let limit = params.get("limit").and_then(|l| l.parse::<i64>().ok()).unwrap_or(50).min(200);
    let offset = params.get("offset").and_then(|o| o.parse::<i64>().ok()).unwrap_or(0);

    let rows = sqlx::query_as::<_, (uuid::Uuid, String, Option<String>, String, String, String, Value, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, admin_user_id, admin_email, action, target_type, target_id, details, created_at \
         FROM admin_audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let entries: Vec<Value> = rows.iter().map(|(id, user_id, email, action, ttype, tid, details, at)| json!({
        "id": id,
        "admin_user_id": user_id,
        "admin_email": email,
        "action": action,
        "target_type": ttype,
        "target_id": tid,
        "details": details,
        "created_at": at.to_rfc3339(),
    })).collect();

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit_log")
        .fetch_one(&pool).await.unwrap_or(0);

    Ok(Json(json!({
        "data": {
            "entries": entries,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    })))
}

// ─── Org name resolution from Clerk ─────────────────────────────────────

/// Fetch org name from Clerk API and update DB if name is currently the org_id
pub async fn ensure_org_name(pool: &PgPool, org_id: &str) {
    // Skip if name and owner are already resolved
    let current: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT name, owner_user_id FROM organizations WHERE id = $1"
    ).bind(org_id).fetch_optional(pool).await.ok().flatten();

    match current {
        Some((ref name, Some(ref owner))) if name != org_id && !name.is_empty() && !owner.is_empty() => return,
        _ => {}
    }

    let clerk_key = std::env::var("CLERK_SECRET_KEY").unwrap_or_default();
    if clerk_key.is_empty() { return; }

    let resp = reqwest::Client::new()
        .get(format!("https://api.clerk.com/v1/organizations/{org_id}"))
        .header("Authorization", format!("Bearer {clerk_key}"))
        .send()
        .await;

    if let Ok(r) = resp {
        if let Ok(body) = r.json::<serde_json::Value>().await {
            let name = body.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let slug = body.get("slug").and_then(|s| s.as_str()).unwrap_or("");
            let logo = body.get("image_url").and_then(|u| u.as_str()).unwrap_or("");
            // Clerk's `created_by` is the org owner: their plan raises the org's
            // entitlement (entitlement.rs), so it is cached with the name.
            let owner = body.get("created_by").and_then(|u| u.as_str()).unwrap_or("");
            if !name.is_empty() {
                let _ = sqlx::query(
                    "UPDATE organizations SET name = $2, slug = CASE WHEN slug = id THEN $3 ELSE slug END, \
                     owner_user_id = COALESCE(NULLIF($4, ''), owner_user_id) WHERE id = $1"
                )
                .bind(org_id)
                .bind(name)
                .bind(if slug.is_empty() { name } else { slug })
                .bind(owner)
                .execute(pool)
                .await;
                tracing::info!(org_id = %org_id, name = %name, owner = %owner, "Resolved org name and owner from Clerk");
            }
            // Also store logo URL if we have a column (future)
            let _ = logo;
        }
    }
}

/// Orgs created before migration 079 have no owner cached: resolve them once
/// from Clerk at startup, one call per org, so an owner's plan applies to the
/// orgs they already own. Best effort — a failed call is retried at next boot.
pub async fn backfill_org_owners(pool: PgPool) {
    let orgs: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM organizations WHERE (owner_user_id IS NULL OR owner_user_id = '') AND id LIKE 'org_%' ORDER BY created_at"
    ).fetch_all(&pool).await.unwrap_or_default();
    if orgs.is_empty() { return; }
    tracing::info!(count = orgs.len(), "Backfilling organization owners from Clerk");
    for org_id in orgs {
        ensure_org_owner(&pool, &org_id).await;
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
}

/// Resolve and cache the Clerk owner (`created_by`) of an org whose name is
/// already known — `ensure_org_name` returns early in that case.
async fn ensure_org_owner(pool: &PgPool, org_id: &str) {
    let clerk_key = std::env::var("CLERK_SECRET_KEY").unwrap_or_default();
    if clerk_key.is_empty() { return; }
    let resp = reqwest::Client::new()
        .get(format!("https://api.clerk.com/v1/organizations/{org_id}"))
        .header("Authorization", format!("Bearer {clerk_key}"))
        .send()
        .await;
    if let Ok(r) = resp {
        if let Ok(body) = r.json::<serde_json::Value>().await {
            let owner = body.get("created_by").and_then(|u| u.as_str()).unwrap_or("");
            if !owner.is_empty() {
                let _ = sqlx::query("UPDATE organizations SET owner_user_id = $2 WHERE id = $1")
                    .bind(org_id).bind(owner).execute(pool).await;
                tracing::info!(org_id = %org_id, owner = %owner, "Resolved org owner from Clerk");
            }
        }
    }
}

/// Ensure org exists in DB with proper name and owner. Fire-and-forget resolution.
pub fn upsert_org_background(pool: PgPool, org_id: String) {
    tokio::spawn(async move {
        // Upsert first
        let _ = sqlx::query(
            "INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING"
        ).bind(&org_id).execute(&pool).await;
        // Then resolve name
        ensure_org_name(&pool, &org_id).await;
    });
}
