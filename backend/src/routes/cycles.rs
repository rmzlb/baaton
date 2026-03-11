use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Cycle {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCycle {
    pub name: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCycle {
    pub name: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CycleStats {
    #[serde(flatten)]
    pub cycle: Cycle,
    pub total_issues: i64,
    pub completed_issues: i64,
    pub total_points: i64,
    pub completed_points: i64,
}

// ─── Handlers ─────────────────────────────────────────

/// GET /projects/{id}/cycles
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Cycle>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let cycles = sqlx::query_as::<_, Cycle>(
        "SELECT * FROM cycles WHERE project_id = $1 AND org_id = $2 ORDER BY start_date DESC"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "cycles.list query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(cycles)))
}

/// POST /projects/{id}/cycles
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateCycle>,
) -> Result<Json<ApiResponse<Cycle>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    if body.end_date <= body.start_date {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "end_date must be after start_date"}))));
    }

    let cycle = sqlx::query_as::<_, Cycle>(
        r#"INSERT INTO cycles (project_id, org_id, name, start_date, end_date)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *"#
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.name)
    .bind(body.start_date)
    .bind(body.end_date)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(cycle)))
}

/// GET /cycles/{id} — with stats
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<CycleStats>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let cycle = sqlx::query_as::<_, Cycle>(
        "SELECT * FROM cycles WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Cycle not found"}))))?;

    let stats: (i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT
             COUNT(*),
             COUNT(*) FILTER (WHERE status IN ('done', 'cancelled')),
             COALESCE(SUM(estimate), 0),
             COALESCE(SUM(estimate) FILTER (WHERE status IN ('done', 'cancelled')), 0)
           FROM issues
           WHERE cycle_id = $1"#
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(CycleStats {
        cycle,
        total_issues: stats.0,
        completed_issues: stats.1,
        total_points: stats.2,
        completed_points: stats.3,
    })))
}

/// PATCH /cycles/{id}
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateCycle>,
) -> Result<Json<ApiResponse<Cycle>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let cycle = sqlx::query_as::<_, Cycle>(
        r#"UPDATE cycles
           SET name   = COALESCE($1, name),
               status = COALESCE($2, status)
           WHERE id = $3 AND org_id = $4
           RETURNING *"#
    )
    .bind(body.name.as_deref())
    .bind(body.status.as_deref())
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Cycle not found"}))))?;

    Ok(Json(ApiResponse::new(cycle)))
}

/// POST /cycles/{id}/complete
/// Marks current cycle completed, creates next cycle, rolls over incomplete issues.
pub async fn complete(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<serde_json::Value>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let cycle = sqlx::query_as::<_, Cycle>(
        "SELECT * FROM cycles WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Cycle not found"}))))?;

    if cycle.status == "completed" {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Cycle is already completed"}))));
    }

    // Fetch project cycle duration (defaults to 2 weeks)
    let cycle_duration_weeks: i32 = sqlx::query_scalar(
        "SELECT COALESCE(cycle_duration_weeks, 2) FROM projects WHERE id = $1"
    )
    .bind(cycle.project_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Compute next cycle dates: start = end + 1 day, end = start + N weeks
    let next_start = cycle.end_date + chrono::Duration::days(1);
    let next_end = next_start + chrono::Duration::days(cycle_duration_weeks as i64 * 7);

    // Mark current cycle as completed
    sqlx::query("UPDATE cycles SET status = 'completed' WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Create the next cycle
    let next_cycle = sqlx::query_as::<_, Cycle>(
        r#"INSERT INTO cycles (project_id, org_id, name, start_date, end_date, status)
           VALUES ($1, $2, $3, $4, $5, 'upcoming')
           RETURNING *"#
    )
    .bind(cycle.project_id)
    .bind(org_id)
    .bind(format!("{} (auto)", cycle.name))
    .bind(next_start)
    .bind(next_end)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Rollover incomplete issues to the next cycle
    let rolled = sqlx::query(
        "UPDATE issues SET cycle_id = $2 WHERE cycle_id = $1 AND status NOT IN ('done', 'cancelled')"
    )
    .bind(id)
    .bind(next_cycle.id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(json!({
        "completed_cycle_id": id,
        "next_cycle": next_cycle,
        "rolled_over_issues": rolled.rows_affected(),
    }))))
}
