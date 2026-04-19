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

    // Aggregate across ALL orgs the user belongs to (not just current)
    let activity = sqlx::query_as::<_, UserActivityRow>(
        "SELECT COALESCE(MAX(current_streak), 0) AS current_streak,
                COALESCE(MAX(longest_streak), 0) AS longest_streak,
                MAX(last_active_date) AS last_active_date,
                COALESCE(MAX(best_day_count), 0) AS best_day_count,
                COALESCE(MAX(best_week_count), 0) AS best_week_count
         FROM user_activity WHERE user_id = $1"
    )
    .bind(&auth.user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (streak, longest, best_day, best_week) = match &activity {
        Some(a) => (a.current_streak, a.longest_streak, a.best_day_count, a.best_week_count),
        None => (0, 0, 0, 0),
    };

    let today = Utc::now().date_naive();
    let iso_week_start = today
        - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);

    // ── Scope resolution: personal → org-wide (includes agents) ──
    // Check if user has any personal activity this org
    let personal_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = $1 AND org_id = $2"
    ).bind(&auth.user_id).bind(org_id).fetch_one(&pool).await.unwrap_or(0);

    // If user has personal data, show personal. Otherwise, show full org (user + agents).
    let scope = if personal_total > 0 { "personal" } else { "org" };

    let (where_clause, bind_val) = if scope == "personal" {
        ("user_id = $1", auth.user_id.clone())
    } else {
        ("org_id = $1", org_id.to_string())
    };

    // ── Velocity ──
    let velocity_7d  = get_velocity_scoped(&pool, &where_clause, &bind_val, 7).await;
    let velocity_30d = get_velocity_scoped(&pool, &where_clause, &bind_val, 30).await;
    let velocity_trend = velocity_trend(velocity_7d, velocity_30d);

    // ── This week / Today ──
    let this_week_count: i64 = sqlx::query_scalar(&format!(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE {} AND activity_date >= $2", where_clause
    )).bind(&bind_val).bind(iso_week_start).fetch_one(&pool).await.unwrap_or(0);

    let today_count: i64 = sqlx::query_scalar(&format!(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE {} AND activity_date = $2", where_clause
    )).bind(&bind_val).bind(today).fetch_one(&pool).await.unwrap_or(0);

    // ── Action breakdown (this week) ──
    #[derive(sqlx::FromRow)]
    #[allow(dead_code)] // assignments/tags_added stay in the row for upcoming UI columns
    struct BreakdownRow {
        issues_created: i64,
        issues_closed: i64,
        comments_posted: i64,
        tldrs_posted: i64,
        status_changes: i64,
        assignments: i64,
        updates: i64,
        tags_added: i64,
        github_actions: i64,
    }
    let breakdown = sqlx::query_as::<_, BreakdownRow>(&format!(
        "SELECT COALESCE(SUM(issues_created),0) AS issues_created,
                COALESCE(SUM(issues_closed),0) AS issues_closed,
                COALESCE(SUM(comments_posted),0) AS comments_posted,
                COALESCE(SUM(tldrs_posted),0) AS tldrs_posted,
                COALESCE(SUM(status_changes),0) AS status_changes,
                COALESCE(SUM(assignments),0) AS assignments,
                COALESCE(SUM(updates),0) AS updates,
                COALESCE(SUM(tags_added),0) AS tags_added,
                COALESCE(SUM(github_actions),0) AS github_actions
         FROM user_daily_activity WHERE {} AND activity_date >= $2", where_clause
    )).bind(&bind_val).bind(iso_week_start).fetch_optional(&pool).await.ok().flatten();

    // ── Top contributors (org scope always, for the widget) ──
    #[derive(sqlx::FromRow)]
    struct ContributorRow { user_id: String, user_name: Option<String>, actions: i64 }
    let contributors = sqlx::query_as::<_, ContributorRow>(
        "SELECT user_id, MAX(user_name) AS user_name, SUM(total_actions)::bigint AS actions
         FROM (
           SELECT d.user_id, a.user_name, d.total_actions
           FROM user_daily_activity d
           LEFT JOIN LATERAL (
             SELECT user_name FROM activity_log WHERE user_id = d.user_id AND org_id = $1 LIMIT 1
           ) a ON true
           WHERE d.org_id = $1 AND d.activity_date >= $2
         ) sub
         GROUP BY user_id ORDER BY actions DESC LIMIT 5"
    ).bind(org_id).bind(iso_week_start).fetch_all(&pool).await.unwrap_or_default();

    // ── Completion rate (issues closed / created this week) ──
    let bd = &breakdown;
    let created = bd.as_ref().map(|b| b.issues_created).unwrap_or(0);
    let closed  = bd.as_ref().map(|b| b.issues_closed).unwrap_or(0);
    let completion_rate = if created > 0 { ((closed as f64 / created as f64) * 100.0).round() } else { 0.0 };

    // ── Goal tracking: beat your best week ──
    let to_beat_best = if best_week > 0 && this_week_count < best_week as i64 {
        Some(best_week as i64 - this_week_count)
    } else { None };

    Ok(Json(json!({
        "data": {
            "scope": scope,
            "current_streak":  streak,
            "longest_streak":  longest,
            "velocity_7d":     (velocity_7d  * 100.0).round() / 100.0,
            "velocity_30d":    (velocity_30d * 100.0).round() / 100.0,
            "velocity_trend":  velocity_trend,
            "personal_bests": { "best_day": best_day, "best_week": best_week },
            "today":     { "actions": today_count },
            "this_week": { "actions": this_week_count },
            "completion_rate": completion_rate,
            "goal": to_beat_best,
            "breakdown": {
                "issues_created": bd.as_ref().map(|b| b.issues_created).unwrap_or(0),
                "issues_closed":  bd.as_ref().map(|b| b.issues_closed).unwrap_or(0),
                "comments":       bd.as_ref().map(|b| b.comments_posted).unwrap_or(0),
                "tldrs":          bd.as_ref().map(|b| b.tldrs_posted).unwrap_or(0),
                "status_changes": bd.as_ref().map(|b| b.status_changes).unwrap_or(0),
                "updates":        bd.as_ref().map(|b| b.updates).unwrap_or(0),
                "github":         bd.as_ref().map(|b| b.github_actions).unwrap_or(0),
            },
            "contributors": contributors.iter().map(|c| json!({
                "user_id": c.user_id,
                "name": c.user_name.as_deref().unwrap_or("Agent"),
                "actions": c.actions,
                "is_agent": c.user_id.starts_with("apikey:") || c.user_id.starts_with("github:"),
            })).collect::<Vec<_>>(),
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

    // Personal heatmap: cross-org (all user activity everywhere)
    let mut rows = sqlx::query_as::<_, DailyActivityRow>(
        "SELECT activity_date, SUM(total_actions)::int AS total_actions
         FROM user_daily_activity
         WHERE user_id = $1 AND activity_date >= $2
         GROUP BY activity_date
         ORDER BY activity_date ASC"
    )
    .bind(&auth.user_id)
    .bind(since)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Fallback: org-wide if personal is empty
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

/// Scoped velocity — works with any WHERE clause (user_id or org_id)
async fn get_velocity_scoped(pool: &PgPool, where_clause: &str, bind_val: &str, days: i64) -> f64 {
    let since = Utc::now().date_naive() - chrono::Duration::days(days);
    let q = format!(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE {} AND activity_date >= $2",
        where_clause
    );
    let count: i64 = sqlx::query_scalar(&q)
        .bind(bind_val)
        .bind(since)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    (count as f64) / (days as f64)
}

/// Org-wide velocity (all users combined) — fallback when personal data is empty
#[allow(dead_code)] // public helper kept for upcoming velocity panels
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

// ─── GET /gamification/dashboard ──────────────────────
// Combined endpoint: personal stats + per-project activity + assigned issues

pub async fn get_dashboard(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;
    let today = Utc::now().date_naive();
    let week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let thirty_days_ago = today - chrono::Duration::days(30);

    // ── Resolve ALL orgs via Clerk memberships ──
    let all_org_ids: Vec<String> = if !auth.user_id.starts_with("apikey:") {
        match crate::routes::issues::fetch_user_org_ids(&auth.user_id).await {
            Ok(mut orgs) => {
                if !orgs.contains(&org_id.to_string()) {
                    orgs.push(org_id.to_string());
                }
                orgs
            }
            Err(_) => vec![org_id.to_string()],
        }
    } else {
        vec![org_id.to_string()]
    };

    // ── Resolve all user identities (Clerk user_id + all API key identities across all orgs) ──
    let mut user_ids: Vec<String> = vec![auth.user_id.clone()];
    let api_key_ids: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT 'apikey:' || id::text FROM api_keys WHERE org_id = ANY($1)"
    ).bind(&all_org_ids).fetch_all(&pool).await.unwrap_or_default();
    user_ids.extend(api_key_ids);

    // ── 1. Personal stats (cross-org, all identities) ──
    let personal_week: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = ANY($1) AND activity_date >= $2"
    ).bind(&user_ids).bind(week_start).fetch_one(&pool).await.unwrap_or(0);

    let personal_today: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE user_id = ANY($1) AND activity_date = $2"
    ).bind(&user_ids).bind(today).fetch_one(&pool).await.unwrap_or(0);

    // Velocity: cross-org, all identities
    let personal_v7: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions)::float / GREATEST($2, 1), 0.0)
         FROM user_daily_activity WHERE user_id = ANY($1) AND activity_date >= CURRENT_DATE - $2"
    ).bind(&user_ids).bind(7i32).fetch_one(&pool).await.unwrap_or(0.0);

    let personal_v30: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions)::float / GREATEST($2, 1), 0.0)
         FROM user_daily_activity WHERE user_id = ANY($1) AND activity_date >= CURRENT_DATE - $2"
    ).bind(&user_ids).bind(30i32).fetch_one(&pool).await.unwrap_or(0.0);

    // Streak (best across all identities)
    let streak_row = sqlx::query_as::<_, UserActivityRow>(
        "SELECT COALESCE(MAX(current_streak),0) AS current_streak, COALESCE(MAX(longest_streak),0) AS longest_streak,
                MAX(last_active_date) AS last_active_date, COALESCE(MAX(best_day_count),0) AS best_day_count,
                COALESCE(MAX(best_week_count),0) AS best_week_count
         FROM user_activity WHERE user_id = ANY($1)"
    ).bind(&user_ids).fetch_optional(&pool).await.ok().flatten();
    let (streak, longest, best_day, best_week) = match &streak_row {
        Some(a) => (a.current_streak, a.longest_streak, a.best_day_count, a.best_week_count),
        None => (0, 0, 0, 0),
    };

    // Personal breakdown this week (cross-org, all identities)
    #[derive(sqlx::FromRow)]
    struct Bd { ic: i64, ix: i64, co: i64, tl: i64, sc: i64, up: i64, gh: i64 }
    let pbd = sqlx::query_as::<_, Bd>(
        "SELECT COALESCE(SUM(issues_created),0) AS ic, COALESCE(SUM(issues_closed),0) AS ix,
                COALESCE(SUM(comments_posted),0) AS co, COALESCE(SUM(tldrs_posted),0) AS tl,
                COALESCE(SUM(status_changes),0) AS sc, COALESCE(SUM(updates),0) AS up,
                COALESCE(SUM(github_actions),0) AS gh
         FROM user_daily_activity WHERE user_id = ANY($1) AND activity_date >= $2"
    ).bind(&user_ids).bind(week_start).fetch_optional(&pool).await.ok().flatten();

    // ── 2. All-orgs stats (cross all orgs the user has access to) ──
    let org_week: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2"
    ).bind(&all_org_ids).bind(week_start).fetch_one(&pool).await.unwrap_or(0);

    let org_today: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date = $2"
    ).bind(&all_org_ids).bind(today).fetch_one(&pool).await.unwrap_or(0);

    let org_v7: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions)::float / GREATEST($2, 1), 0.0)
         FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= CURRENT_DATE - $2"
    ).bind(&all_org_ids).bind(7i32).fetch_one(&pool).await.unwrap_or(0.0);

    // Org breakdown this week (all orgs)
    let obd = sqlx::query_as::<_, Bd>(
        "SELECT COALESCE(SUM(issues_created),0) AS ic, COALESCE(SUM(issues_closed),0) AS ix,
                COALESCE(SUM(comments_posted),0) AS co, COALESCE(SUM(tldrs_posted),0) AS tl,
                COALESCE(SUM(status_changes),0) AS sc, COALESCE(SUM(updates),0) AS up,
                COALESCE(SUM(github_actions),0) AS gh
         FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2"
    ).bind(&all_org_ids).bind(week_start).fetch_optional(&pool).await.ok().flatten();

    // ── 3. Per-project activity (ALL orgs, last 30 days) ──
    #[derive(sqlx::FromRow)]
    struct ProjectActivity { project_id: Uuid, name: String, prefix: String, actions: i64 }
    // Unused first query removed — using activity_log count directly

    let project_activity = sqlx::query_as::<_, ProjectActivity>(
        "SELECT p.id AS project_id, p.name, p.prefix,
                COUNT(a.id)::bigint AS actions
         FROM projects p
         LEFT JOIN activity_log a ON a.project_id = p.id AND a.created_at >= $2
         WHERE p.org_id = ANY($1)
         GROUP BY p.id, p.name, p.prefix
         ORDER BY actions DESC"
    ).bind(&all_org_ids).bind(thirty_days_ago).fetch_all(&pool).await.unwrap_or_default();

    // ── 4. Top contributors (all orgs this week) ──
    #[derive(sqlx::FromRow)]
    struct ContribRow { user_id: String, user_name: Option<String>, actions: i64 }
    let contributors = sqlx::query_as::<_, ContribRow>(
        "SELECT d.user_id, MAX(a.user_name) AS user_name, SUM(d.total_actions)::bigint AS actions
         FROM user_daily_activity d
         LEFT JOIN LATERAL (
           SELECT user_name FROM activity_log WHERE user_id = d.user_id AND org_id = ANY($1) LIMIT 1
         ) a ON true
         WHERE d.org_id = ANY($1) AND d.activity_date >= $2
         GROUP BY d.user_id ORDER BY actions DESC LIMIT 8"
    ).bind(&all_org_ids).bind(week_start).fetch_all(&pool).await.unwrap_or_default();

    // ── 5. Assigned issues (open, assigned to user, ALL orgs) ──
    #[derive(sqlx::FromRow)]
    struct AssignedIssue {
        id: Uuid, display_id: String, title: String, status: String,
        priority: Option<String>, project_prefix: String, project_name: String,
    }
    let assigned = sqlx::query_as::<_, AssignedIssue>(
        "SELECT i.id, i.display_id, i.title, i.status, i.priority,
                p.prefix AS project_prefix, p.name AS project_name
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE p.org_id = ANY($1)
           AND $2 = ANY(i.assignee_ids)
           AND i.status NOT IN ('done', 'cancelled')
         ORDER BY
           CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
           i.created_at DESC
         LIMIT 20"
    ).bind(&all_org_ids).bind(&auth.user_id).fetch_all(&pool).await.unwrap_or_default();

    // ── 6. Heatmaps (personal cross-org + all-orgs team, last 365 days) ──
    let hm_since = today - chrono::Duration::days(365);

    let personal_heatmap = sqlx::query_as::<_, DailyActivityRow>(
        "SELECT activity_date, SUM(total_actions)::int AS total_actions
         FROM user_daily_activity WHERE user_id = ANY($1) AND activity_date >= $2
         GROUP BY activity_date ORDER BY activity_date ASC"
    ).bind(&user_ids).bind(hm_since).fetch_all(&pool).await.unwrap_or_default();

    let org_heatmap = sqlx::query_as::<_, DailyActivityRow>(
        "SELECT activity_date, SUM(total_actions)::int AS total_actions
         FROM user_daily_activity WHERE org_id = ANY($1) AND activity_date >= $2
         GROUP BY activity_date ORDER BY activity_date ASC"
    ).bind(&all_org_ids).bind(hm_since).fetch_all(&pool).await.unwrap_or_default();

    fn bd_json(b: &Option<Bd>) -> serde_json::Value {
        json!({
            "issues_created": b.as_ref().map(|x| x.ic).unwrap_or(0),
            "issues_closed":  b.as_ref().map(|x| x.ix).unwrap_or(0),
            "comments":       b.as_ref().map(|x| x.co).unwrap_or(0),
            "tldrs":          b.as_ref().map(|x| x.tl).unwrap_or(0),
            "status_changes": b.as_ref().map(|x| x.sc).unwrap_or(0),
            "updates":        b.as_ref().map(|x| x.up).unwrap_or(0),
            "github":         b.as_ref().map(|x| x.gh).unwrap_or(0),
        })
    }

    let goal = if best_week > 0 && personal_week < best_week as i64 {
        Some(best_week as i64 - personal_week)
    } else { None };

    Ok(Json(json!({
        "data": {
            "personal": {
                "velocity_7d": (personal_v7 * 100.0).round() / 100.0,
                "velocity_30d": (personal_v30 * 100.0).round() / 100.0,
                "velocity_trend": velocity_trend(personal_v7, personal_v30),
                "this_week": personal_week,
                "today": personal_today,
                "streak": streak,
                "longest_streak": longest,
                "best_day": best_day,
                "best_week": best_week,
                "goal": goal,
                "breakdown": bd_json(&pbd),
                "heatmap": personal_heatmap.iter().map(|r| json!({"date": r.activity_date, "count": r.total_actions})).collect::<Vec<_>>(),
            },
            "org": {
                "velocity_7d": (org_v7 * 100.0).round() / 100.0,
                "this_week": org_week,
                "today": org_today,
                "breakdown": bd_json(&obd),
                "heatmap": org_heatmap.iter().map(|r| json!({"date": r.activity_date, "count": r.total_actions})).collect::<Vec<_>>(),
            },
            "projects": project_activity.iter().map(|p| json!({
                "id": p.project_id,
                "name": p.name,
                "prefix": p.prefix,
                "actions_30d": p.actions,
            })).collect::<Vec<_>>(),
            "contributors": contributors.iter().map(|c| json!({
                "user_id": c.user_id,
                "name": c.user_name.as_deref().unwrap_or("Agent"),
                "actions": c.actions,
                "is_agent": c.user_id.starts_with("apikey:") || c.user_id.starts_with("github:"),
            })).collect::<Vec<_>>(),
            "assigned": assigned.iter().map(|i| json!({
                "id": i.id,
                "display_id": i.display_id,
                "title": i.title,
                "status": i.status,
                "priority": i.priority,
                "project_prefix": i.project_prefix,
                "project_name": i.project_name,
            })).collect::<Vec<_>>(),
        }
    })))
}
