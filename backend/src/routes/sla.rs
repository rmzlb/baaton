use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SlaRule {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub priority: String,
    pub deadline_hours: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSlaRule {
    pub priority: String,
    pub deadline_hours: i32,
}

#[derive(Debug, Serialize)]
pub struct SlaStats {
    pub total: i64,
    pub on_time: i64,
    pub breached: i64,
    pub achievement_pct: f64,
}

// ─── Internal Helper ──────────────────────────────────

/// Apply SLA deadline to an issue based on its priority.
/// Looks up sla_rules for the project; if found, sets sla_deadline = now + hours.
pub async fn apply_sla_deadline(pool: &PgPool, issue_id: Uuid, project_id: Uuid, priority: Option<&str>) {
    let priority = match priority {
        Some(p) => p,
        None => return,
    };

    let deadline_hours: Option<i32> = sqlx::query_scalar(
        "SELECT deadline_hours FROM sla_rules WHERE project_id = $1 AND priority = $2"
    )
    .bind(project_id)
    .bind(priority)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    if let Some(hours) = deadline_hours {
        let _ = sqlx::query(
            "UPDATE issues SET sla_deadline = now() + interval '1 hour' * $1 WHERE id = $2"
        )
        .bind(hours)
        .bind(issue_id)
        .execute(pool)
        .await;
    }
}

// ─── Routes ──────────────────────────────────────────

/// GET /projects/{id}/sla-rules
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<SlaRule>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let rules = sqlx::query_as::<_, SlaRule>(
        "SELECT * FROM sla_rules WHERE project_id = $1 AND org_id = $2 ORDER BY created_at ASC"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(rules)))
}

/// POST /projects/{id}/sla-rules
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateSlaRule>,
) -> Result<Json<ApiResponse<SlaRule>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let rule = sqlx::query_as::<_, SlaRule>(
        r#"
        INSERT INTO sla_rules (project_id, org_id, priority, deadline_hours)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, priority) DO UPDATE
            SET deadline_hours = EXCLUDED.deadline_hours
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.priority)
    .bind(body.deadline_hours)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(rule)))
}

/// DELETE /sla-rules/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM sla_rules WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "SLA rule not found"}))))
    }
}

/// GET /projects/{id}/sla-stats
pub async fn stats(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<SlaStats>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let row: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            count(*) as total,
            count(*) FILTER (WHERE sla_breached = false AND sla_deadline IS NOT NULL) as on_time,
            count(*) FILTER (WHERE sla_breached = true) as breached
        FROM issues
        WHERE project_id = $1 AND sla_deadline IS NOT NULL
        "#,
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (total, on_time, breached) = row;
    let achievement_pct = if total > 0 {
        (on_time as f64 / total as f64) * 100.0
    } else {
        100.0
    };

    Ok(Json(ApiResponse::new(SlaStats {
        total,
        on_time,
        breached,
        achievement_pct,
    })))
}
