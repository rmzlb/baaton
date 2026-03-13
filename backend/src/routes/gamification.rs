use axum::{extract::{Path, Query, State}, http::StatusCode, Extension, Json};
use chrono::{NaiveDate, Utc, Datelike};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;

// ─── Types ────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
struct UserActivityRow {
    current_streak: i32,
    longest_streak: i32,
    last_active_date: Option<NaiveDate>,
    best_day_count: i32,
    best_week_count: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct DailyActivityRow {
    activity_date: NaiveDate,
    total_actions: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ContributorRow {
    user_id: String,
    user_name: Option<String>,
    action_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct HeatmapParams {
    pub days: Option<i64>,
}

// ─── Record activity (infallible — called from activity.rs and issues.rs) ───

/// Record a user action into gamification counters.
/// Velocity counts ALL action types (not just closes) — like git velocity.
/// Never fails the calling operation.
pub async fn record_activity(pool: &PgPool, user_id: &str, org_id: &str, action: &str) {
    if let Err(e) = do_record_activity(pool, user_id, org_id, action).await {
        tracing::warn!(
            user_id = %user_id,
            org_id = %org_id,
            action = %action,
            error = %e,
            "record_activity failed (non-fatal)"
        );
    }
}

async fn do_record_activity(
    pool: &PgPool,
    user_id: &str,
    org_id: &str,
    action: &str,
) -> Result<(), sqlx::Error> {
    let today = Utc::now().date_naive();

    // Map action string to column name
    let col = match action {
        "issue_create" | "issue_created" => "issues_created",
        "issue_close" | "issue_closed" | "issue_archived" => "issues_closed",
        "comment" | "comment_added" => "comments_posted",
        "tldr" => "tldrs_posted",
        "status_changed" | "status_change" => "status_changes",
        "assigned" | "assignee_changed" => "assignments",
        "updated" | "priority_changed" | "estimate_changed" => "updates",
        "tagged" | "tag_added" | "tag_removed" => "tags_added",
        "github_push" | "github_pr_merged" | "github_pr_opened" | "github_pr_review" => "github_actions",
        _ => "updates", // catch-all: still increments total_actions
    };

    // Upsert daily activity — each branch increments both the specific column and total_actions
    let today_total: i32 = match col {
        "issues_created" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, issues_created, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 issues_created = user_daily_activity.issues_created + 1,
                 total_actions  = user_daily_activity.total_actions  + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "issues_closed" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, issues_closed, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 issues_closed = user_daily_activity.issues_closed + 1,
                 total_actions = user_daily_activity.total_actions  + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "comments_posted" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, comments_posted, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 comments_posted = user_daily_activity.comments_posted + 1,
                 total_actions   = user_daily_activity.total_actions   + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "tldrs_posted" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, tldrs_posted, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 tldrs_posted  = user_daily_activity.tldrs_posted  + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "status_changes" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, status_changes, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 status_changes = user_daily_activity.status_changes + 1,
                 total_actions  = user_daily_activity.total_actions  + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "assignments" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, assignments, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 assignments   = user_daily_activity.assignments   + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "tags_added" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, tags_added, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 tags_added    = user_daily_activity.tags_added    + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "github_actions" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, github_actions, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 github_actions = user_daily_activity.github_actions + 1,
                 total_actions  = user_daily_activity.total_actions  + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        // "updates" catch-all
        _ => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, updates, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 updates       = user_daily_activity.updates       + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
    };

    // Update streak + personal bests
    let existing = sqlx::query_as::<_, UserActivityRow>(
        "SELECT current_streak, longest_streak, last_active_date, best_day_count, best_week_count
         FROM user_activity WHERE user_id = $1 AND org_id = $2"
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;

    let (new_streak, new_longest) = match &existing {
        None => (1, 1),
        Some(row) => {
            let yesterday = today.pred_opt().unwrap_or(today);
            match row.last_active_date {
                Some(d) if d == today => (row.current_streak, row.longest_streak),
                Some(d) if d == yesterday => {
                    let s = row.current_streak + 1;
                    (s, s.max(row.longest_streak))
                }
                _ => (1, row.longest_streak.max(1)),
            }
        }
    };

    // Week count: total actions in the current ISO week
    let iso_week_start = today
        - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let week_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3"
    )
    .bind(user_id)
    .bind(org_id)
    .bind(iso_week_start)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let best_day = existing.as_ref().map(|r| r.best_day_count).unwrap_or(0).max(today_total);
    let best_week = existing.as_ref().map(|r| r.best_week_count).unwrap_or(0).max(week_total as i32);

    sqlx::query(
        r#"INSERT INTO user_activity
               (user_id, org_id, current_streak, longest_streak, last_active_date, best_day_count, best_week_count, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, org_id) DO UPDATE SET
             current_streak    = $3,
             longest_streak    = $4,
             last_active_date  = $5,
             best_day_count    = $6,
             best_week_count   = $7,
             updated_at        = now()"#,
    )
    .bind(user_id)
    .bind(org_id)
    .bind(new_streak)
    .bind(new_longest)
    .bind(today)
    .bind(best_day)
    .bind(best_week)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── GET /gamification/me ─────────────────────────────

pub async fn get_me(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let activity = sqlx::query_as::<_, UserActivityRow>(
        "SELECT current_streak, longest_streak, last_active_date, best_day_count, best_week_count
         FROM user_activity WHERE user_id = $1 AND org_id = $2"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (streak, longest, best_day, best_week) = match &activity {
        Some(a) => (a.current_streak, a.longest_streak, a.best_day_count, a.best_week_count),
        None => (0, 0, 0, 0),
    };

    // Try personal stats first; if empty, fall back to org-wide
    // (useful for founders/admins whose agents do the work via API keys)
    let mut velocity_7d  = get_velocity(&pool, &auth.user_id, org_id, 7).await;
    let mut velocity_30d = get_velocity(&pool, &auth.user_id, org_id, 30).await;

    let today = Utc::now().date_naive();
    let iso_week_start = today
        - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);

    let mut this_week_count: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(iso_week_start)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let mut today_count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date = $3"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(today)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // If personal stats are all zero, show org-wide activity instead
    let is_personal_empty = velocity_7d == 0.0 && this_week_count == 0 && streak == 0;
    if is_personal_empty {
        velocity_7d  = get_velocity_org(&pool, org_id, 7).await;
        velocity_30d = get_velocity_org(&pool, org_id, 30).await;

        this_week_count = sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
             WHERE org_id = $1 AND activity_date >= $2"
        )
        .bind(org_id)
        .bind(iso_week_start)
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

        today_count = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
             WHERE org_id = $1 AND activity_date = $2"
        )
        .bind(org_id)
        .bind(today)
        .fetch_one(&pool)
        .await
        .unwrap_or(0);
    }

    let velocity_trend = velocity_trend(velocity_7d, velocity_30d);

    Ok(Json(json!({
        "data": {
            "current_streak":  streak,
            "longest_streak":  longest,
            "velocity_7d":     (velocity_7d  * 100.0).round() / 100.0,
            "velocity_30d":    (velocity_30d * 100.0).round() / 100.0,
            "velocity_trend":  velocity_trend,
            "personal_bests": { "best_day": best_day, "best_week": best_week },
            "today":     { "actions": today_count },
            "this_week": { "actions": this_week_count },
        }
    })))
}

// ─── GET /gamification/heatmap?days=90 ────────────────

pub async fn get_heatmap(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<HeatmapParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let days = params.days.unwrap_or(90).clamp(7, 365);
    let since = Utc::now().date_naive() - chrono::Duration::days(days);

    // Try personal heatmap first; if empty, fall back to org-wide
    let mut rows = sqlx::query_as::<_, DailyActivityRow>(
        "SELECT activity_date, total_actions FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3
         ORDER BY activity_date ASC"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(since)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if rows.is_empty() {
        rows = sqlx::query_as::<_, DailyActivityRow>(
            "SELECT activity_date, SUM(total_actions)::int AS total_actions
             FROM user_daily_activity
             WHERE org_id = $1 AND activity_date >= $2
             GROUP BY activity_date
             ORDER BY activity_date ASC"
        )
        .bind(org_id)
        .bind(since)
        .fetch_all(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
    }

    let cells: Vec<serde_json::Value> = rows.iter().map(|r| json!({
        "date":  r.activity_date.to_string(),
        "count": r.total_actions,
    })).collect();

    Ok(Json(json!({
        "data": { "cells": cells, "days": days }
    })))
}

// ─── GET /gamification/stats — API-key + Clerk friendly ───────────────

/// Full stats snapshot. Works with both Clerk JWT and API key auth.
/// Designed for external agents and CI integrations.
pub async fn get_stats(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // User-level stats (skipped for api-key callers that have no personal streaks)
    let is_api_key = auth.user_id.starts_with("apikey:");
    let user_stats = if !is_api_key {
        let activity = sqlx::query_as::<_, UserActivityRow>(
            "SELECT current_streak, longest_streak, last_active_date, best_day_count, best_week_count
             FROM user_activity WHERE user_id = $1 AND org_id = $2"
        )
        .bind(&auth.user_id)
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .unwrap_or(None);

        let (streak, longest, best_day, best_week) = match &activity {
            Some(a) => (a.current_streak, a.longest_streak, a.best_day_count, a.best_week_count),
            None => (0, 0, 0, 0),
        };

        let velocity_7d  = get_velocity(&pool, &auth.user_id, org_id, 7).await;
        let velocity_30d = get_velocity(&pool, &auth.user_id, org_id, 30).await;

        let today = Utc::now().date_naive();
        let iso_week_start = today
            - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
        let since_7d = today - chrono::Duration::days(7);

        let this_week: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
             WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3"
        ).bind(&auth.user_id).bind(org_id).bind(iso_week_start).fetch_one(&pool).await.unwrap_or(0);

        let today_count: i32 = sqlx::query_scalar(
            "SELECT COALESCE(total_actions, 0) FROM user_daily_activity
             WHERE user_id = $1 AND org_id = $2 AND activity_date = $3"
        ).bind(&auth.user_id).bind(org_id).bind(today).fetch_optional(&pool)
         .await.ok().flatten().unwrap_or(0);

        // Heatmap last 7 days
        let heatmap_rows = sqlx::query_as::<_, DailyActivityRow>(
            "SELECT activity_date, total_actions FROM user_daily_activity
             WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3
             ORDER BY activity_date ASC"
        ).bind(&auth.user_id).bind(org_id).bind(since_7d).fetch_all(&pool).await.unwrap_or_default();

        let heatmap_7d: Vec<serde_json::Value> = heatmap_rows.iter().map(|r| json!({
            "date": r.activity_date.to_string(), "count": r.total_actions
        })).collect();

        json!({
            "current_streak":  streak,
            "longest_streak":  longest,
            "velocity_7d":     (velocity_7d  * 100.0).round() / 100.0,
            "velocity_30d":    (velocity_30d * 100.0).round() / 100.0,
            "velocity_trend":  velocity_trend(velocity_7d, velocity_30d),
            "personal_bests":  { "best_day": best_day, "best_week": best_week },
            "today_actions":   today_count,
            "week_actions":    this_week,
            "heatmap_7d":      heatmap_7d,
        })
    } else {
        json!(null)
    };

    // Org-wide stats
    let total_actions_7d: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE org_id = $1 AND activity_date >= $2"
    ).bind(org_id).bind(Utc::now().date_naive() - chrono::Duration::days(7))
     .fetch_one(&pool).await.unwrap_or(0);

    let active_users_7d: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM user_daily_activity
         WHERE org_id = $1 AND activity_date >= $2 AND total_actions > 0"
    ).bind(org_id).bind(Utc::now().date_naive() - chrono::Duration::days(7))
     .fetch_one(&pool).await.unwrap_or(0);

    Ok(Json(json!({
        "data": {
            "user":    user_stats,
            "org": {
                "total_actions_7d": total_actions_7d,
                "active_users_7d":  active_users_7d,
            }
        }
    })))
}

// ─── GET /projects/:id/gamification ──────────────────

pub async fn get_project_gamification(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let today     = Utc::now().date_naive();
    let since_7d  = today - chrono::Duration::days(7);
    let since_30d = today - chrono::Duration::days(30);

    // Issues created / closed this week
    let issues_created_7d: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1 AND created_at >= $2"
    ).bind(project_id).bind(Utc::now() - chrono::Duration::days(7))
     .fetch_one(&pool).await.unwrap_or(0);

    let issues_closed_7d: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1 AND closed_at IS NOT NULL AND closed_at >= $2"
    ).bind(project_id).bind(Utc::now() - chrono::Duration::days(7))
     .fetch_one(&pool).await.unwrap_or(0);

    // Completion rate
    let total_issues: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1 AND status != 'cancelled'"
    ).bind(project_id).fetch_one(&pool).await.unwrap_or(0);

    let done_issues: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1 AND status = 'done'"
    ).bind(project_id).fetch_one(&pool).await.unwrap_or(0);

    let completion_rate = if total_issues > 0 {
        (done_issues as f64 / total_issues as f64 * 100.0).round() / 100.0
    } else {
        0.0
    };

    // Velocity: issues closed per day over last 7d
    let velocity_7d = issues_closed_7d as f64 / 7.0;

    // Top contributors (by activity_log action count, last 30d)
    let contributors = sqlx::query_as::<_, ContributorRow>(
        r#"SELECT user_id, user_name, COUNT(*) AS action_count
           FROM activity_log
           WHERE project_id = $1
             AND org_id = $2
             AND created_at >= $3
             AND NOT user_id LIKE 'apikey:%'
           GROUP BY user_id, user_name
           ORDER BY action_count DESC
           LIMIT 5"#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(Utc::now() - chrono::Duration::days(30))
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Project heatmap: actions per day from activity_log (project-scoped, last 30d)
    #[derive(sqlx::FromRow)]
    struct DateCount { activity_date: NaiveDate, total_actions: i64 }

    let heatmap_rows = sqlx::query_as::<_, DateCount>(
        r#"SELECT DATE(created_at) AS activity_date, COUNT(*) AS total_actions
           FROM activity_log
           WHERE project_id = $1 AND org_id = $2 AND created_at >= $3
           GROUP BY DATE(created_at)
           ORDER BY activity_date ASC"#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(Utc::now() - chrono::Duration::days(30))
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let heatmap: Vec<serde_json::Value> = heatmap_rows.iter().map(|r| json!({
        "date":  r.activity_date.to_string(),
        "count": r.total_actions,
    })).collect();

    let contributor_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM activity_log
         WHERE project_id = $1 AND org_id = $2 AND created_at >= $3
           AND NOT user_id LIKE 'apikey:%'"
    ).bind(project_id).bind(org_id).bind(Utc::now() - chrono::Duration::days(30))
     .fetch_one(&pool).await.unwrap_or(0);

    let _ = since_7d; // suppress unused warning
    let _ = since_30d;

    Ok(Json(json!({
        "data": {
            "velocity_7d":       (velocity_7d * 100.0).round() / 100.0,
            "completion_rate":   completion_rate,
            "contributor_count": contributor_count,
            "issues_created_7d": issues_created_7d,
            "issues_closed_7d":  issues_closed_7d,
            "top_contributors":  contributors.iter().map(|c| json!({
                "user_id":     c.user_id,
                "user_name":   c.user_name,
                "action_count": c.action_count,
            })).collect::<Vec<_>>(),
            "heatmap_30d":       heatmap,
        }
    })))
}

// ─── Helpers ──────────────────────────────────────────

/// Velocity = total actions / days (not just closes — all activity counts)
async fn get_velocity(pool: &PgPool, user_id: &str, org_id: &str, days: i64) -> f64 {
    let since = Utc::now().date_naive() - chrono::Duration::days(days);
    let count: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3"
    )
    .bind(user_id)
    .bind(org_id)
    .bind(since)
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    (count as f64) / (days as f64)
}

/// Org-wide velocity (all users combined) — fallback when personal data is empty
async fn get_velocity_org(pool: &PgPool, org_id: &str, days: i64) -> f64 {
    let since = Utc::now().date_naive() - chrono::Duration::days(days);
    let count: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE org_id = $1 AND activity_date >= $2"
    )
    .bind(org_id)
    .bind(since)
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    (count as f64) / (days as f64)
}

fn velocity_trend(v7: f64, v30: f64) -> &'static str {
    if v7 > v30 * 1.1 { "up" }
    else if v7 < v30 * 0.9 { "down" }
    else { "stable" }
}
