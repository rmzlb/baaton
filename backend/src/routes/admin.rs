use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
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

/// GET /billing — get user-level plan, usage across ALL orgs, and limits
/// Plan is tied to the user (via their "primary" org), but usage spans all orgs.
/// Returns: plan, org count, project count (per org + total), API requests, issues count.
pub async fn get_billing(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    use crate::routes::issues::fetch_user_org_ids;

    // Get all orgs for this user via Clerk
    let org_ids = fetch_user_org_ids(&auth.user_id).await.map_err(|e| {
        tracing::error!(error = %e, "billing: failed to fetch org memberships");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to resolve organizations"})))
    })?;

    // Determine plan from current org (or first org)
    let current_org = auth.org_id.as_deref()
        .or(org_ids.first().map(|s| s.as_str()))
        .unwrap_or("unknown");

    let plan: String = sqlx::query_scalar(
        "SELECT COALESCE(plan, 'free') FROM organizations WHERE id = $1"
    )
    .bind(current_org)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "free".to_string());

    // Fetch org names from Clerk API (org_ids → names)
    let org_names: std::collections::HashMap<String, String> = {
        let mut map = std::collections::HashMap::new();
        let clerk_key = std::env::var("CLERK_SECRET_KEY").unwrap_or_default();
        if !clerk_key.is_empty() {
            let client = reqwest::Client::new();
            for oid in &org_ids {
                if let Ok(resp) = client
                    .get(format!("https://api.clerk.com/v1/organizations/{oid}"))
                    .header("Authorization", format!("Bearer {clerk_key}"))
                    .send()
                    .await
                {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if let Some(name) = body.get("name").and_then(|n| n.as_str()) {
                            map.insert(oid.clone(), name.to_string());
                        }
                    }
                }
            }
        }
        map
    };

    // Per-org breakdown: project count + issue count
    #[derive(sqlx::FromRow)]
    struct OrgUsageRow {
        org_id: String,
        org_name: String,
        project_count: i64,
        issue_count: i64,
    }

    #[derive(serde::Serialize)]
    struct OrgUsage {
        org_id: String,
        org_name: String,
        project_count: i64,
        issue_count: i64,
    }

    let org_usage: Vec<OrgUsage> = if !org_ids.is_empty() {
        let rows = sqlx::query_as::<_, OrgUsageRow>(
            r#"
            SELECT
                p.org_id,
                COALESCE(o.name, p.org_id) AS org_name,
                COUNT(DISTINCT p.id) AS project_count,
                COUNT(i.id) AS issue_count
            FROM projects p
            LEFT JOIN organizations o ON o.id = p.org_id
            LEFT JOIN issues i ON i.project_id = p.id
            WHERE p.org_id = ANY($1)
            GROUP BY p.org_id, o.name
            ORDER BY issue_count DESC
            "#,
        )
        .bind(&org_ids)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        rows.into_iter().map(|r| {
            let name = org_names.get(&r.org_id).cloned().unwrap_or(r.org_name);
            OrgUsage {
                org_id: r.org_id,
                org_name: name,
                project_count: r.project_count,
                issue_count: r.issue_count,
            }
        }).collect()
    } else {
        // Include orgs that have no projects yet
        org_ids.iter().map(|oid| OrgUsage {
            org_id: oid.clone(),
            org_name: org_names.get(oid).cloned().unwrap_or_else(|| oid.clone()),
            project_count: 0,
            issue_count: 0,
        }).collect()
    };

    let total_orgs = org_ids.len() as i64;
    let total_projects: i64 = org_usage.iter().map(|o| o.project_count).sum();
    let total_issues: i64 = org_usage.iter().map(|o| o.issue_count).sum();

    // API request count this month (sum across all orgs)
    let month = chrono::Utc::now().format("%Y-%m").to_string();
    let api_count: i64 = if !org_ids.is_empty() {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(count), 0) FROM api_request_log WHERE org_id = ANY($1) AND month = $2"
        )
        .bind(&org_ids)
        .bind(&month)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0)
    } else { 0 };

    // Plan limits (users, orgs, projects, api_requests/mo, issues, ai_messages/mo, api_keys, automations)
    let (org_limit, project_limit, api_limit, issue_limit, user_limit, ai_limit, key_limit, auto_limit) = match plan.as_str() {
        "free" =>       (1,  3,   1_000,    500,  2, 50,    3,  3),
        "pro" =>        (5, 25, 100_000,     -1, -1, 2_000, -1, -1),
        "enterprise" => (-1, -1,     -1,     -1, -1, -1,    -1, -1), // unlimited
        _ =>            (1,  3,   1_000,    500,  2, 50,    3,  3),
    };

    // Count AI usage this month
    let ai_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ai_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())"
    )
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    Ok(Json(json!({
        "data": {
            "plan": plan,
            "organizations": org_usage,
            "usage": {
                "orgs": { "current": total_orgs, "limit": org_limit },
                "projects": { "current": total_projects, "limit": project_limit },
                "issues": { "current": total_issues, "limit": issue_limit },
                "api_requests": { "current": api_count, "limit": api_limit, "month": month },
                "ai_messages": { "current": ai_count, "limit": ai_limit, "month": month },
                "users": { "limit": user_limit },
                "api_keys": { "limit": key_limit },
                "automations": { "limit": auto_limit }
            },
            "pricing": {
                "free": { "price": 0, "label": "$0/mo", "users_included": 2 },
                "pro": { "price": 19, "label": "$19/mo", "users_included": 3, "extra_user_price": 19 },
                "enterprise": { "price": -1, "label": "On demand", "users_included": -1 }
            }
        }
    })))
}

/// GET /billing/ai-usage — detailed AI usage report with token breakdown
pub async fn get_ai_usage(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let from = params.get("from").cloned().unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-01").to_string()
    });
    let to = params.get("to").cloned().unwrap_or_else(|| {
        chrono::Utc::now().format("%Y-%m-%d").to_string()
    });

    // Summary: total messages, tokens, by event_type
    let rows = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT event_type, COUNT(*) as count, COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0) \
         FROM ai_usage WHERE user_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day') \
         GROUP BY event_type"
    )
    .bind(&auth.user_id)
    .bind(&from)
    .bind(&to)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut by_type = serde_json::Map::new();
    let mut total_messages: i64 = 0;
    let mut total_tokens_in: i64 = 0;
    let mut total_tokens_out: i64 = 0;

    for (event_type, count, t_in, t_out) in &rows {
        total_messages += count;
        total_tokens_in += t_in;
        total_tokens_out += t_out;
        by_type.insert(event_type.clone(), json!({
            "count": count,
            "tokens_in": t_in,
            "tokens_out": t_out,
        }));
    }

    // Daily breakdown
    let daily = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT created_at::date::text as day, COUNT(*), COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0) \
         FROM ai_usage WHERE user_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day') \
         GROUP BY day ORDER BY day"
    )
    .bind(&auth.user_id)
    .bind(&from)
    .bind(&to)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let daily_data: Vec<Value> = daily.iter().map(|(day, count, t_in, t_out)| json!({
        "date": day,
        "messages": count,
        "tokens_in": t_in,
        "tokens_out": t_out,
    })).collect();

    // Estimated cost (Gemini Flash pricing: ~$0.075/1M input, ~$0.30/1M output)
    let est_cost = (total_tokens_in as f64 * 0.000000075) + (total_tokens_out as f64 * 0.0000003);

    Ok(Json(json!({
        "data": {
            "period": { "from": from, "to": to },
            "total": {
                "messages": total_messages,
                "tokens_in": total_tokens_in,
                "tokens_out": total_tokens_out,
                "estimated_cost_usd": format!("{:.4}", est_cost),
            },
            "by_type": by_type,
            "daily": daily_data,
        }
    })))
}
