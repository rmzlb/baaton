use axum::{extract::{Path, Query, State}, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::middleware::AuthUser;

#[derive(Debug, Deserialize)]
pub struct MetricsParams {
    pub days: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct DailyCount {
    date: chrono::NaiveDate,
    count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct StatusCount {
    status: String,
    count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct PriorityCount {
    priority: Option<String>,
    count: i64,
}

/// GET /api/v1/metrics?days=30
pub async fn get_metrics(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<MetricsParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let days = params.days.unwrap_or(30).clamp(1, 365);
    let since = chrono::Utc::now() - chrono::Duration::days(days);

    // Issues created per day
    let created = sqlx::query_as::<_, DailyCount>(
        r#"
        SELECT
            i.created_at::date AS date,
            COUNT(*)::bigint AS count
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1 AND i.created_at >= $2
        GROUP BY i.created_at::date
        ORDER BY date ASC
        "#,
    )
    .bind(org_id)
    .bind(since)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Issues closed per day (closed_at set)
    let closed = sqlx::query_as::<_, DailyCount>(
        r#"
        SELECT
            i.closed_at::date AS date,
            COUNT(*)::bigint AS count
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1 AND i.closed_at IS NOT NULL AND i.closed_at >= $2
        GROUP BY i.closed_at::date
        ORDER BY date ASC
        "#,
    )
    .bind(org_id)
    .bind(since)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Average resolution time in hours
    let avg_hours: Option<f64> = sqlx::query_scalar(
        r#"
        SELECT AVG(EXTRACT(EPOCH FROM (i.closed_at - i.created_at)) / 3600)
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1 AND i.closed_at IS NOT NULL AND i.closed_at >= $2
        "#,
    )
    .bind(org_id)
    .bind(since)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None)
    .flatten();

    // Active issues count (not done/cancelled)
    let active_issues: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1 AND i.status NOT IN ('done', 'cancelled')
        "#,
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    // Issues by status
    let by_status_rows = sqlx::query_as::<_, StatusCount>(
        r#"
        SELECT i.status, COUNT(*)::bigint AS count
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1
        GROUP BY i.status
        "#,
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let issues_by_status: HashMap<String, i64> = by_status_rows
        .into_iter()
        .map(|r| (r.status, r.count))
        .collect();

    // Issues by priority
    let by_priority_rows = sqlx::query_as::<_, PriorityCount>(
        r#"
        SELECT i.priority, COUNT(*)::bigint AS count
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1
        GROUP BY i.priority
        "#,
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let issues_by_priority: HashMap<String, i64> = by_priority_rows
        .into_iter()
        .map(|r| (r.priority.unwrap_or_else(|| "none".to_string()), r.count))
        .collect();

    let issues_created: Vec<serde_json::Value> = created
        .into_iter()
        .map(|r| json!({"date": r.date.to_string(), "count": r.count}))
        .collect();

    let issues_closed: Vec<serde_json::Value> = closed
        .into_iter()
        .map(|r| json!({"date": r.date.to_string(), "count": r.count}))
        .collect();

    // Velocity: issues closed per day over 7d and 30d
    let since_7d = chrono::Utc::now() - chrono::Duration::days(7);
    let since_30d = chrono::Utc::now() - chrono::Duration::days(30);

    let closed_7d: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1 AND i.closed_at IS NOT NULL AND i.closed_at >= $2
        "#,
    )
    .bind(org_id)
    .bind(since_7d)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let closed_30d: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1 AND i.closed_at IS NOT NULL AND i.closed_at >= $2
        "#,
    )
    .bind(org_id)
    .bind(since_30d)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    let velocity_7d = (closed_7d as f64) / 7.0;
    let velocity_30d = (closed_30d as f64) / 30.0;
    let velocity_trend = if velocity_7d > velocity_30d * 1.1 {
        "up"
    } else if velocity_7d < velocity_30d * 0.9 {
        "down"
    } else {
        "stable"
    };

    Ok(Json(json!({
        "issues_created": issues_created,
        "issues_closed": issues_closed,
        "avg_resolution_hours": avg_hours.map(|h| (h * 10.0).round() / 10.0),
        "active_issues": active_issues,
        "issues_by_status": issues_by_status,
        "issues_by_priority": issues_by_priority,
        "period_days": days,
        "velocity": {
            "issues_per_day_7d": (velocity_7d * 100.0).round() / 100.0,
            "issues_per_day_30d": (velocity_30d * 100.0).round() / 100.0,
            "trend": velocity_trend,
        },
    })))
}

// ─── Burndown ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BurndownParams {
    pub sprint_id: Option<Uuid>,
    pub days: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct BurndownPoint {
    date: chrono::NaiveDate,
    open_count: i64,
    closed_count: i64,
}

/// GET /projects/{id}/burndown?sprint_id=xxx&days=14
///
/// Returns a daily snapshot of open vs closed issues for the last N days
/// (or filtered by sprint_id). Uses closed_at to determine closure date.
pub async fn burndown(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<BurndownParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)",
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("burndown project check error: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
    })?;

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let days = params.days.unwrap_or(14).clamp(1, 90);
    let since = chrono::Utc::now().date_naive() - chrono::Duration::days(days - 1);

    // Generate a series of dates from `since` to today, then compute open/closed per day
    // "open on day D" = created_at::date <= D AND (closed_at IS NULL OR closed_at::date > D)
    // "closed on day D" = closed_at::date = D
    let rows = if let Some(sprint_id) = params.sprint_id {
        sqlx::query_as::<_, BurndownPoint>(
            r#"
            WITH date_series AS (
                SELECT generate_series($3::date, CURRENT_DATE, '1 day'::interval)::date AS date
            )
            SELECT
                d.date,
                COUNT(*) FILTER (
                    WHERE i.created_at::date <= d.date
                    AND (i.closed_at IS NULL OR i.closed_at::date > d.date)
                )::bigint AS open_count,
                COUNT(*) FILTER (
                    WHERE i.closed_at IS NOT NULL AND i.closed_at::date = d.date
                )::bigint AS closed_count
            FROM date_series d
            CROSS JOIN issues i
            WHERE i.project_id = $1 AND i.sprint_id = $2
            GROUP BY d.date
            ORDER BY d.date ASC
            "#,
        )
        .bind(project_id)
        .bind(sprint_id)
        .bind(since)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as::<_, BurndownPoint>(
            r#"
            WITH date_series AS (
                SELECT generate_series($2::date, CURRENT_DATE, '1 day'::interval)::date AS date
            )
            SELECT
                d.date,
                COUNT(*) FILTER (
                    WHERE i.created_at::date <= d.date
                    AND (i.closed_at IS NULL OR i.closed_at::date > d.date)
                )::bigint AS open_count,
                COUNT(*) FILTER (
                    WHERE i.closed_at IS NOT NULL AND i.closed_at::date = d.date
                )::bigint AS closed_count
            FROM date_series d
            CROSS JOIN issues i
            WHERE i.project_id = $1
            GROUP BY d.date
            ORDER BY d.date ASC
            "#,
        )
        .bind(project_id)
        .bind(since)
        .fetch_all(&pool)
        .await
    };

    let points = rows.map_err(|e| {
        tracing::error!("burndown query error: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to fetch burndown data"})))
    })?;

    let data: Vec<serde_json::Value> = points
        .into_iter()
        .map(|p| json!({
            "date": p.date.to_string(),
            "open": p.open_count,
            "closed": p.closed_count,
        }))
        .collect();

    Ok(Json(json!({
        "project_id": project_id,
        "sprint_id": params.sprint_id,
        "days": days,
        "burndown": data,
    })))
}
