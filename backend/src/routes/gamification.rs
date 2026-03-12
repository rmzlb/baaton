use axum::{extract::{Query, State}, http::StatusCode, Extension, Json};
use chrono::{NaiveDate, Utc, Datelike};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;

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

#[derive(Debug, Deserialize)]
pub struct HeatmapParams {
    pub days: Option<i64>,
}

// ─── Record activity (infallible — called from other routes) ──

/// Record a user action. Updates streak, daily counters, and personal bests.
/// Never fails the calling operation — logs errors and continues.
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

    // 1. Upsert daily activity counter
    let col = match action {
        "issue_create" => "issues_created",
        "issue_close" => "issues_closed",
        "comment" => "comments_posted",
        "tldr" => "tldrs_posted",
        _ => "issues_created",
    };

    // Dynamic column update via separate queries (sqlx doesn't support dynamic column names)
    let today_total: i32 = match col {
        "issues_created" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, issues_created, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 issues_created = user_daily_activity.issues_created + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "issues_closed" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, issues_closed, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 issues_closed = user_daily_activity.issues_closed + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "comments_posted" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, comments_posted, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 comments_posted = user_daily_activity.comments_posted + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        "tldrs_posted" => sqlx::query_scalar(
            r#"INSERT INTO user_daily_activity (user_id, org_id, activity_date, tldrs_posted, total_actions)
               VALUES ($1, $2, $3, 1, 1)
               ON CONFLICT (user_id, org_id, activity_date) DO UPDATE SET
                 tldrs_posted = user_daily_activity.tldrs_posted + 1,
                 total_actions = user_daily_activity.total_actions + 1
               RETURNING total_actions"#,
        ).bind(user_id).bind(org_id).bind(today).fetch_one(pool).await?,
        _ => 1,
    };

    // 2. Update streak + personal bests
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
    let iso_week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
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
        r#"INSERT INTO user_activity (user_id, org_id, current_streak, longest_streak, last_active_date, best_day_count, best_week_count, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, org_id) DO UPDATE SET
             current_streak = $3,
             longest_streak = $4,
             last_active_date = $5,
             best_day_count = $6,
             best_week_count = $7,
             updated_at = now()"#,
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

    // Velocity: issues closed in last 7d and 30d
    let velocity_7d = get_velocity(&pool, &auth.user_id, org_id, 7).await;
    let velocity_30d = get_velocity(&pool, &auth.user_id, org_id, 30).await;
    let velocity_trend = if velocity_7d > velocity_30d * 1.1 {
        "up"
    } else if velocity_7d < velocity_30d * 0.9 {
        "down"
    } else {
        "stable"
    };

    // This week's count
    let today = Utc::now().date_naive();
    let iso_week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let this_week_count: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_actions), 0) FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date >= $3"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(iso_week_start)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // Today's count
    let today_count: i32 = sqlx::query_scalar(
        "SELECT COALESCE(total_actions, 0) FROM user_daily_activity
         WHERE user_id = $1 AND org_id = $2 AND activity_date = $3"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(today)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(0);

    Ok(Json(json!({
        "data": {
            "current_streak": streak,
            "longest_streak": longest,
            "velocity_7d": (velocity_7d * 100.0).round() / 100.0,
            "velocity_30d": (velocity_30d * 100.0).round() / 100.0,
            "velocity_trend": velocity_trend,
            "personal_bests": {
                "best_day": best_day,
                "best_week": best_week,
            },
            "today": {
                "actions": today_count,
            },
            "this_week": {
                "actions": this_week_count,
            }
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

    let rows = sqlx::query_as::<_, DailyActivityRow>(
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

    let cells: Vec<serde_json::Value> = rows.iter().map(|r| {
        json!({
            "date": r.activity_date.to_string(),
            "count": r.total_actions,
        })
    }).collect();

    Ok(Json(json!({
        "data": {
            "cells": cells,
            "days": days,
        }
    })))
}

// ─── Velocity helper ──────────────────────────────────

async fn get_velocity(pool: &PgPool, user_id: &str, org_id: &str, days: i64) -> f64 {
    let since = Utc::now() - chrono::Duration::days(days);
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM issues i
           JOIN projects p ON p.id = i.project_id
           WHERE i.created_by_id = $1 AND p.org_id = $2
             AND i.closed_at IS NOT NULL AND i.closed_at >= $3"#,
    )
    .bind(user_id)
    .bind(org_id)
    .bind(since)
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    (count as f64) / (days as f64)
}
