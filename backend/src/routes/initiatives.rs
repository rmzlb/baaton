use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Initiative {
    pub id: Uuid,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateInitiative {
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateInitiative {
    pub name: Option<String>,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InitiativeWithProgress {
    #[serde(flatten)]
    pub initiative: Initiative,
    pub projects: Vec<LinkedProject>,
    pub progress: InitiativeProgress,
}

#[derive(Debug, Serialize, FromRow)]
pub struct LinkedProject {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
}

#[derive(Debug, Serialize)]
pub struct InitiativeProgress {
    pub done_issues: i64,
    pub total_issues: i64,
    pub percent: f64,
}

#[derive(Debug, Deserialize)]
pub struct AddProjectBody {
    pub project_id: Uuid,
}

// ─── Handlers ─────────────────────────────────────────

/// GET /initiatives — list all org initiatives
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<Initiative>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let items = sqlx::query_as::<_, Initiative>(
        "SELECT * FROM initiatives WHERE org_id = $1 ORDER BY created_at DESC"
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(items)))
}

/// POST /initiatives — create an initiative
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateInitiative>,
) -> Result<Json<ApiResponse<Initiative>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Name is required"}))));
    }

    let status = body.status.as_deref().unwrap_or("planned");
    if !matches!(status, "planned" | "active" | "completed" | "paused") {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid status"}))));
    }

    let item = sqlx::query_as::<_, Initiative>(
        r#"
        INSERT INTO initiatives (org_id, name, description, target_date, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(body.name.trim())
    .bind(&body.description)
    .bind(&body.target_date)
    .bind(status)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(item)))
}

/// GET /initiatives/{id} — get one initiative with linked projects + progress
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<InitiativeWithProgress>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let initiative = sqlx::query_as::<_, Initiative>(
        "SELECT * FROM initiatives WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Initiative not found"}))))?;

    // Linked projects
    let projects = sqlx::query_as::<_, LinkedProject>(
        r#"
        SELECT p.id, p.name, p.slug
        FROM projects p
        JOIN initiative_projects ip ON ip.project_id = p.id
        WHERE ip.initiative_id = $1
        ORDER BY p.name ASC
        "#,
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Progress: done issues / total issues across all linked projects
    let project_ids: Vec<Uuid> = projects.iter().map(|p| p.id).collect();

    let progress = if project_ids.is_empty() {
        InitiativeProgress { done_issues: 0, total_issues: 0, percent: 0.0 }
    } else {
        #[derive(sqlx::FromRow)]
        struct ProgressRow { done: i64, total: i64 }

        let row = sqlx::query_as::<_, ProgressRow>(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE status = 'done') AS done,
                COUNT(*) AS total
            FROM issues
            WHERE project_id = ANY($1)
              AND archived = false
            "#,
        )
        .bind(&project_ids)
        .fetch_one(&pool)
        .await
        .unwrap_or(ProgressRow { done: 0, total: 0 });

        let percent = if row.total > 0 {
            (row.done as f64 / row.total as f64) * 100.0
        } else {
            0.0
        };

        InitiativeProgress {
            done_issues: row.done,
            total_issues: row.total,
            percent: (percent * 10.0).round() / 10.0,
        }
    };

    Ok(Json(ApiResponse::new(InitiativeWithProgress { initiative, projects, progress })))
}

/// PATCH /initiatives/{id} — update an initiative
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateInitiative>,
) -> Result<Json<ApiResponse<Initiative>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if let Some(ref s) = body.status {
        if !matches!(s.as_str(), "planned" | "active" | "completed" | "paused") {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid status"}))));
        }
    }

    let item = sqlx::query_as::<_, Initiative>(
        r#"
        UPDATE initiatives
        SET name        = COALESCE($3, name),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            target_date = CASE WHEN $6::boolean THEN $7 ELSE target_date END,
            status      = COALESCE($8, status)
        WHERE id = $1 AND org_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(org_id)
    .bind(body.name.as_deref())
    .bind(body.description.is_some())
    .bind(body.description.as_deref())
    .bind(body.target_date.is_some())
    .bind(body.target_date)
    .bind(body.status.as_deref())
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Initiative not found"}))))?;

    Ok(Json(ApiResponse::new(item)))
}

/// DELETE /initiatives/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query("DELETE FROM initiatives WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Initiative not found"}))))
    }
}

/// POST /initiatives/{id}/projects — link a project to this initiative
pub async fn add_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<AddProjectBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Check initiative belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM initiatives WHERE id = $1 AND org_id = $2)"
    )
    .bind(id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Initiative not found"}))));
    }

    // Check project belongs to org
    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(body.project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    sqlx::query(
        "INSERT INTO initiative_projects (initiative_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(id)
    .bind(body.project_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({ "data": { "initiative_id": id, "project_id": body.project_id } })))
}

/// DELETE /initiatives/{id}/projects/{project_id} — unlink a project
pub async fn remove_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((id, project_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify initiative is in org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM initiatives WHERE id = $1 AND org_id = $2)"
    )
    .bind(id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Initiative not found"}))));
    }

    let result = sqlx::query(
        "DELETE FROM initiative_projects WHERE initiative_id = $1 AND project_id = $2"
    )
    .bind(id)
    .bind(project_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not linked to this initiative"}))))
    }
}
