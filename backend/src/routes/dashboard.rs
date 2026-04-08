use axum::{extract::{Extension, State}, http::StatusCode, Json};
use chrono::{Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::routes::issues::fetch_user_org_ids;

// ─── Clerk Org Cache ──────────────────────────────────

const ORG_CACHE_TTL: Duration = Duration::from_secs(300); // 5 min

#[derive(Clone)]
struct CachedOrg {
    name: String,
    slug: String,
    image_url: Option<String>,
    fetched_at: Instant,
}

static ORG_CACHE: OnceLock<RwLock<HashMap<String, CachedOrg>>> = OnceLock::new();

fn org_cache() -> &'static RwLock<HashMap<String, CachedOrg>> {
    ORG_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

#[derive(Deserialize)]
struct ClerkOrgResponse {
    name: String,
    slug: String,
    image_url: Option<String>,
}

async fn fetch_org_metadata(org_id: &str) -> Option<(String, String, Option<String>)> {
    // Check cache first
    {
        let cache = org_cache().read().await;
        if let Some(entry) = cache.get(org_id) {
            if entry.fetched_at.elapsed() < ORG_CACHE_TTL {
                return Some((entry.name.clone(), entry.slug.clone(), entry.image_url.clone()));
            }
        }
    }

    let secret = std::env::var("CLERK_SECRET_KEY").ok()?;
    let url = format!("https://api.clerk.com/v1/organizations/{}", org_id);

    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&secret)
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!("Clerk org fetch failed for {}: {}", org_id, resp.status());
        return None;
    }

    let data: ClerkOrgResponse = resp.json().await.ok()?;
    let result = (data.name.clone(), data.slug.clone(), data.image_url.clone());

    // Update cache
    {
        let mut cache = org_cache().write().await;
        cache.insert(org_id.to_string(), CachedOrg {
            name: data.name,
            slug: data.slug,
            image_url: data.image_url,
            fetched_at: Instant::now(),
        });
    }

    Some(result)
}

// ─── SQL Row Types ────────────────────────────────────

#[derive(sqlx::FromRow)]
struct ProjectStatusRow {
    id: Uuid,
    org_id: String,
    name: String,
    slug: String,
    prefix: String,
    description: Option<String>,
    backlog: i64,
    todo: i64,
    in_progress: i64,
    in_review: i64,
    done: i64,
    cancelled: i64,
    total_issues: i64,
}

#[derive(sqlx::FromRow)]
struct AssigneeRow {
    project_id: Uuid,
    assignee_id: String,
}

#[derive(sqlx::FromRow)]
struct DailyCount {
    date: NaiveDate,
    count: i64,
}

#[derive(sqlx::FromRow)]
struct DailyActivityRow {
    activity_date: NaiveDate,
    total_actions: i32,
}

#[derive(sqlx::FromRow)]
struct UserActivityRow {
    current_streak: i32,
    best_week_count: i32,
}

#[derive(sqlx::FromRow)]
struct BreakdownRow {
    ic: i64,
    ix: i64,
    co: i64,
    sc: i64,
    up: i64,
    gh: i64,
}

#[derive(sqlx::FromRow)]
struct ProjectActivityRow {
    project_id: Uuid,
    name: String,
    prefix: String,
    actions: i64,
}

#[derive(sqlx::FromRow)]
struct ContribRow {
    user_id: String,
    user_name: Option<String>,
    actions: i64,
}

#[derive(sqlx::FromRow)]
struct AssignedRow {
    id: Uuid,
    org_id: String,
    display_id: String,
    title: String,
    status: String,
    priority: Option<String>,
    project_prefix: String,
}

#[derive(sqlx::FromRow)]
struct ActivityRow {
    id: Uuid,
    org_id: String,
    project_id: Option<Uuid>,
    issue_id: Option<Uuid>,
    user_id: String,
    user_name: Option<String>,
    action: String,
    field: Option<String>,
    old_value: Option<String>,
    new_value: Option<String>,
    metadata: serde_json::Value,
    created_at: chrono::DateTime<Utc>,
    issue_title: Option<String>,
    issue_display_id: Option<String>,
}

// ─── GET /dashboard/summary ───────────────────────────

pub async fn summary(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let active_org_id = auth.org_id.clone().unwrap_or_default();

    // 1. Resolve all org IDs
    let all_org_ids: Vec<String> = if !auth.user_id.starts_with("apikey:") {
        match fetch_user_org_ids(&auth.user_id).await {
            Ok(mut orgs) => {
                if !orgs.contains(&active_org_id) && !active_org_id.is_empty() {
                    orgs.push(active_org_id.clone());
                }
                orgs
            }
            Err(e) => {
                tracing::warn!("fetch_user_org_ids failed: {}", e);
                if active_org_id.is_empty() {
                    return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))));
                }
                vec![active_org_id.clone()]
            }
        }
    } else {
        if active_org_id.is_empty() {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))));
        }
        vec![active_org_id.clone()]
    };

    let today = Utc::now().date_naive();
    let week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let thirty_days_ago = today - chrono::Duration::days(30);
    let since_30d = Utc::now() - chrono::Duration::days(30);
    let hm_since = today - chrono::Duration::days(365);

    // 2. Run ALL queries in parallel
    let (
        projects_result,
        assignees_result,
        created_result,
        closed_result,
        avg_hours_result,
        active_issues_result,
        personal_week_result,
        personal_today_result,
        personal_v7_result,
        personal_v30_result,
        streak_result,
        personal_bd_result,
        org_week_result,
        org_today_result,
        org_v7_result,
        org_bd_result,
        proj_activity_result,
        contribs_result,
        assigned_result,
        recent_activity_result,
        personal_heatmap_result,
        org_heatmap_result,
    ) = tokio::join!(
        // a) Projects with status counts
        sqlx::query_as::<_, ProjectStatusRow>(
            r#"SELECT p.id, p.org_id, p.name, p.slug, p.prefix, p.description,
                   COUNT(*) FILTER (WHERE i.status = 'backlog')::bigint AS backlog,
                   COUNT(*) FILTER (WHERE i.status = 'todo')::bigint AS todo,
                   COUNT(*) FILTER (WHERE i.status = 'in_progress')::bigint AS in_progress,
                   COUNT(*) FILTER (WHERE i.status = 'in_review')::bigint AS in_review,
                   COUNT(*) FILTER (WHERE i.status = 'done')::bigint AS done,
                   COUNT(*) FILTER (WHERE i.status = 'cancelled')::bigint AS cancelled,
                   COUNT(i.id)::bigint AS total_issues
               FROM projects p
               LEFT JOIN issues i ON i.project_id = p.id
               WHERE p.org_id = ANY($1)
               GROUP BY p.id
               ORDER BY p.created_at DESC"#
        ).bind(&all_org_ids).fetch_all(&pool),

        // b) Assignees per project
        sqlx::query_as::<_, AssigneeRow>(
            r#"SELECT DISTINCT i.project_id, a AS assignee_id
               FROM issues i, UNNEST(i.assignee_ids) AS a
               WHERE i.project_id IN (SELECT id FROM projects WHERE org_id = ANY($1))
               AND a != ''"#
        ).bind(&all_org_ids).fetch_all(&pool),

        // c) Metrics: created per day (30d, cross-org)
        sqlx::query_as::<_, DailyCount>(
            r#"SELECT i.created_at::date AS date, COUNT(*)::bigint AS count
               FROM issues i JOIN projects p ON p.id = i.project_id
               WHERE p.org_id = ANY($1) AND i.created_at >= $2
               GROUP BY i.created_at::date ORDER BY date ASC"#
        ).bind(&all_org_ids).bind(since_30d).fetch_all(&pool),

        // d) Metrics: closed per day
        sqlx::query_as::<_, DailyCount>(
            r#"SELECT i.closed_at::date AS date, COUNT(*)::bigint AS count
               FROM issues i JOIN projects p ON p.id = i.project_id
               WHERE p.org_id = ANY($1) AND i.closed_at IS NOT NULL AND i.closed_at >= $2
               GROUP BY i.closed_at::date ORDER BY date ASC"#
        ).bind(&all_org_ids).bind(since_30d).fetch_all(&pool),

        // e) Avg resolution hours
        sqlx::query_scalar::<_, Option<f64>>(
            r#"SELECT AVG(EXTRACT(EPOCH FROM (i.closed_at - i.created_at)) / 3600)
               FROM issues i JOIN projects p ON p.id = i.project_id
               WHERE p.org_id = ANY($1) AND i.closed_at IS NOT NULL AND i.closed_at >= $2"#
        ).bind(&all_org_ids).bind(since_30d).fetch_optional(&pool),

        // f) Active issues count
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id
               WHERE p.org_id = ANY($1) AND i.status NOT IN ('done', 'cancelled')"#
        ).bind(&all_org_ids).fetch_one(&pool),

        // g) Personal: this week
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = $1 AND activity_date >= $2"
        ).bind(&auth.user_id).bind(week_start).fetch_one(&pool),

        // h) Personal: today
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = $1 AND activity_date = $2"
        ).bind(&auth.user_id).bind(today).fetch_one(&pool),

        // i) Personal velocity 7d
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = $1 AND activity_date >= $2"
        ).bind(&auth.user_id).bind(today - chrono::Duration::days(7)).fetch_one(&pool),

        // j) Personal velocity 30d
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = $1 AND activity_date >= $2"
        ).bind(&auth.user_id).bind(thirty_days_ago).fetch_one(&pool),

        // k) Streak
        sqlx::query_as::<_, UserActivityRow>(
            "SELECT COALESCE(MAX(current_streak),0) AS current_streak, COALESCE(MAX(best_week_count),0) AS best_week_count
             FROM user_activity WHERE user_id = $1"
        ).bind(&auth.user_id).fetch_optional(&pool),

        // l) Personal breakdown
        sqlx::query_as::<_, BreakdownRow>(
            "SELECT COALESCE(SUM(issues_created),0) AS ic, COALESCE(SUM(issues_closed),0) AS ix,
                    COALESCE(SUM(comments_posted),0) AS co, COALESCE(SUM(status_changes),0) AS sc,
                    COALESCE(SUM(updates),0) AS up, COALESCE(SUM(github_actions),0) AS gh
             FROM user_daily_activity WHERE user_id = $1 AND activity_date >= $2"
        ).bind(&auth.user_id).bind(week_start).fetch_optional(&pool),

        // m) Org: this week
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2"
        ).bind(&all_org_ids).bind(week_start).fetch_one(&pool),

        // n) Org: today
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date = $2"
        ).bind(&all_org_ids).bind(today).fetch_one(&pool),

        // o) Org velocity 7d
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2"
        ).bind(&all_org_ids).bind(today - chrono::Duration::days(7)).fetch_one(&pool),

        // p) Org breakdown
        sqlx::query_as::<_, BreakdownRow>(
            "SELECT COALESCE(SUM(issues_created),0) AS ic, COALESCE(SUM(issues_closed),0) AS ix,
                    COALESCE(SUM(comments_posted),0) AS co, COALESCE(SUM(status_changes),0) AS sc,
                    COALESCE(SUM(updates),0) AS up, COALESCE(SUM(github_actions),0) AS gh
             FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2"
        ).bind(&all_org_ids).bind(week_start).fetch_optional(&pool),

        // q) Projects activity (30d)
        sqlx::query_as::<_, ProjectActivityRow>(
            "SELECT p.id AS project_id, p.name, p.prefix, COUNT(a.id)::bigint AS actions
             FROM projects p LEFT JOIN activity_log a ON a.project_id = p.id AND a.created_at >= $2
             WHERE p.org_id = ANY($1)
             GROUP BY p.id, p.name, p.prefix ORDER BY actions DESC"
        ).bind(&all_org_ids).bind(thirty_days_ago).fetch_all(&pool),

        // r) Contributors (this week, all orgs)
        sqlx::query_as::<_, ContribRow>(
            "SELECT d.user_id, MAX(a.user_name) AS user_name, SUM(d.total_actions)::bigint AS actions
             FROM user_daily_activity d
             LEFT JOIN LATERAL (
               SELECT user_name FROM activity_log WHERE user_id = d.user_id AND org_id = ANY($1) LIMIT 1
             ) a ON true
             WHERE d.org_id = ANY($1) AND d.activity_date >= $2
             GROUP BY d.user_id ORDER BY actions DESC LIMIT 10"
        ).bind(&all_org_ids).bind(week_start).fetch_all(&pool),

        // s) Assigned to user (cross-org)
        sqlx::query_as::<_, AssignedRow>(
            r#"SELECT i.id, p.org_id, i.display_id, i.title, i.status, i.priority, p.prefix AS project_prefix
               FROM issues i JOIN projects p ON p.id = i.project_id
               WHERE p.org_id = ANY($1) AND $2 = ANY(i.assignee_ids)
                 AND i.status NOT IN ('done', 'cancelled')
               ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                        i.created_at DESC
               LIMIT 20"#
        ).bind(&all_org_ids).bind(&auth.user_id).fetch_all(&pool),

        // t) Recent activity (cross-org, limit 15)
        sqlx::query_as::<_, ActivityRow>(
            r#"SELECT al.id, COALESCE(al.org_id, p.org_id) AS org_id, al.project_id, al.issue_id, al.user_id, al.user_name,
                      al.action, al.field, al.old_value, al.new_value, al.metadata, al.created_at,
                      i.title AS issue_title, i.display_id AS issue_display_id
               FROM activity_log al
               LEFT JOIN issues i ON i.id = al.issue_id
               LEFT JOIN projects p ON p.id = COALESCE(al.project_id, i.project_id)
               WHERE p.org_id = ANY($1)
               ORDER BY al.created_at DESC
               LIMIT 15"#
        ).bind(&all_org_ids).fetch_all(&pool),

        // u) Personal heatmap (365d)
        sqlx::query_as::<_, DailyActivityRow>(
            "SELECT activity_date, SUM(total_actions)::int AS total_actions
             FROM user_daily_activity WHERE user_id = $1 AND activity_date >= $2
             GROUP BY activity_date ORDER BY activity_date ASC"
        ).bind(&auth.user_id).bind(hm_since).fetch_all(&pool),

        // v) Org heatmap (365d)
        sqlx::query_as::<_, DailyActivityRow>(
            "SELECT activity_date, SUM(total_actions)::int AS total_actions
             FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2
             GROUP BY activity_date ORDER BY activity_date ASC"
        ).bind(&all_org_ids).bind(hm_since).fetch_all(&pool),
    );

    // 3. Unwrap results (with defaults on error)
    let projects = projects_result.unwrap_or_default();
    let assignees = assignees_result.unwrap_or_default();
    let created = created_result.unwrap_or_default();
    let closed = closed_result.unwrap_or_default();
    let avg_hours = avg_hours_result.ok().flatten().flatten();
    let active_issues = active_issues_result.unwrap_or(0);
    let personal_week = personal_week_result.unwrap_or(0);
    let personal_today = personal_today_result.unwrap_or(0);
    let pv7_total = personal_v7_result.unwrap_or(0);
    let pv30_total = personal_v30_result.unwrap_or(0);
    let streak = streak_result.ok().flatten();
    let personal_bd = personal_bd_result.ok().flatten();
    let org_week = org_week_result.unwrap_or(0);
    let org_today = org_today_result.unwrap_or(0);
    let ov7_total = org_v7_result.unwrap_or(0);
    let org_bd = org_bd_result.ok().flatten();
    let proj_activity = proj_activity_result.unwrap_or_default();
    let contribs = contribs_result.unwrap_or_default();
    let assigned = assigned_result.unwrap_or_default();
    let recent_activity = recent_activity_result.unwrap_or_default();
    let personal_heatmap = personal_heatmap_result.unwrap_or_default();
    let org_heatmap = org_heatmap_result.unwrap_or_default();

    // 4. Build assignees map: project_id -> Vec<String>
    let mut assignees_map: HashMap<Uuid, Vec<String>> = HashMap::new();
    for a in &assignees {
        assignees_map.entry(a.project_id).or_default().push(a.assignee_id.clone());
    }

    // 5. Group projects by org_id
    let mut projects_by_org: HashMap<String, Vec<&ProjectStatusRow>> = HashMap::new();
    for p in &projects {
        projects_by_org.entry(p.org_id.clone()).or_default().push(p);
    }

    // 6. Fetch org metadata (parallel, cached)
    let org_metadata_futures: Vec<_> = all_org_ids.iter().map(|oid| {
        let oid = oid.clone();
        async move {
            let meta = fetch_org_metadata(&oid).await;
            (oid, meta)
        }
    }).collect();
    let org_metadata_results = futures::future::join_all(org_metadata_futures).await;

    // 7. Build orgs array
    let orgs_json: Vec<serde_json::Value> = org_metadata_results.into_iter().map(|(oid, meta)| {
        let (name, slug, image_url) = meta.unwrap_or_else(|| (oid.clone(), oid.clone(), None));
        let org_projects = projects_by_org.get(&oid).cloned().unwrap_or_default();
        let projects_json: Vec<serde_json::Value> = org_projects.iter().map(|p| {
            let proj_assignees = assignees_map.get(&p.id).cloned().unwrap_or_default();
            json!({
                "id": p.id,
                "name": p.name,
                "slug": p.slug,
                "prefix": p.prefix,
                "description": p.description,
                "status_counts": {
                    "backlog": p.backlog,
                    "todo": p.todo,
                    "in_progress": p.in_progress,
                    "in_review": p.in_review,
                    "done": p.done,
                    "cancelled": p.cancelled,
                },
                "total_issues": p.total_issues,
                "assignees": proj_assignees,
            })
        }).collect();

        json!({
            "id": oid,
            "name": name,
            "slug": slug,
            "image_url": image_url,
            "is_active": oid == active_org_id,
            "projects": projects_json,
        })
    }).collect();

    // 8. Velocities
    let pv7 = pv7_total as f64 / 7.0;
    let pv30 = pv30_total as f64 / 30.0;
    let ov7 = ov7_total as f64 / 7.0;
    let velocity_trend = if pv7 > pv30 * 1.1 { "up" } else if pv7 < pv30 * 0.9 { "down" } else { "stable" };

    let (streak_val, best_week) = match &streak {
        Some(s) => (s.current_streak, s.best_week_count),
        None => (0, 0),
    };
    let goal = if best_week > 0 && personal_week < best_week as i64 {
        Some(best_week as i64 - personal_week)
    } else {
        None
    };

    fn bd_json(b: &Option<BreakdownRow>) -> serde_json::Value {
        json!({
            "issues_created": b.as_ref().map(|x| x.ic).unwrap_or(0),
            "issues_closed": b.as_ref().map(|x| x.ix).unwrap_or(0),
            "comments": b.as_ref().map(|x| x.co).unwrap_or(0),
            "status_changes": b.as_ref().map(|x| x.sc).unwrap_or(0),
            "updates": b.as_ref().map(|x| x.up).unwrap_or(0),
            "github": b.as_ref().map(|x| x.gh).unwrap_or(0),
        })
    }

    Ok(Json(json!({
        "data": {
            "orgs": orgs_json,
            "metrics": {
                "issues_created": created.iter().map(|r| json!({"date": r.date.to_string(), "count": r.count})).collect::<Vec<_>>(),
                "issues_closed": closed.iter().map(|r| json!({"date": r.date.to_string(), "count": r.count})).collect::<Vec<_>>(),
                "avg_resolution_hours": avg_hours.map(|h| (h * 10.0).round() / 10.0),
                "active_issues": active_issues,
                "period_days": 30,
            },
            "personal": {
                "velocity_7d": (pv7 * 100.0).round() / 100.0,
                "velocity_30d": (pv30 * 100.0).round() / 100.0,
                "velocity_trend": velocity_trend,
                "this_week": personal_week,
                "today": personal_today,
                "streak": streak_val,
                "best_week": best_week,
                "goal": goal,
                "breakdown": bd_json(&personal_bd),
                "heatmap": personal_heatmap.iter().map(|r| json!({"date": r.activity_date.to_string(), "count": r.total_actions})).collect::<Vec<_>>(),
            },
            "org_activity": {
                "velocity_7d": (ov7 * 100.0).round() / 100.0,
                "this_week": org_week,
                "today": org_today,
                "breakdown": bd_json(&org_bd),
                "heatmap": org_heatmap.iter().map(|r| json!({"date": r.activity_date.to_string(), "count": r.total_actions})).collect::<Vec<_>>(),
            },
            "projects_activity": proj_activity.iter().map(|p| json!({
                "id": p.project_id,
                "name": p.name,
                "prefix": p.prefix,
                "actions_30d": p.actions,
            })).collect::<Vec<_>>(),
            "contributors": contribs.iter().map(|c| json!({
                "user_id": c.user_id,
                "name": c.user_name.as_deref().unwrap_or("Agent"),
                "actions": c.actions,
                "is_agent": c.user_id.starts_with("apikey:") || c.user_id.starts_with("github:"),
            })).collect::<Vec<_>>(),
            "assigned": assigned.iter().map(|i| json!({
                "id": i.id,
                "org_id": i.org_id,
                "display_id": i.display_id,
                "title": i.title,
                "status": i.status,
                "priority": i.priority,
                "project_prefix": i.project_prefix,
            })).collect::<Vec<_>>(),
            "recent_activity": recent_activity.iter().map(|a| json!({
                "id": a.id,
                "action": a.action,
                "user_id": a.user_id,
                "user_name": a.user_name,
                "issue_id": a.issue_id,
                "issue_title": a.issue_title,
                "issue_display_id": a.issue_display_id,
                "field": a.field,
                "old_value": a.old_value,
                "new_value": a.new_value,
                "metadata": a.metadata,
                "created_at": a.created_at,
            })).collect::<Vec<_>>(),
        }
    })))
}
