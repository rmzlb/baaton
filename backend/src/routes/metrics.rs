use axum::{extract::{Query, State}, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;

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

    Ok(Json(json!({
        "issues_created": issues_created,
        "issues_closed": issues_closed,
        "avg_resolution_hours": avg_hours.map(|h| (h * 10.0).round() / 10.0),
        "active_issues": active_issues,
        "issues_by_status": issues_by_status,
        "issues_by_priority": issues_by_priority,
        "period_days": days,
    })))
}
