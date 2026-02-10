use axum::{extract::{Extension, Path, State}, Json};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Sprint {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub goal: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub status: String,
    pub org_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSprint {
    pub name: String,
    pub goal: Option<String>,
    pub start_date: Option<NaiveDate>,
    pub end_date: Option<NaiveDate>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSprint {
    pub name: Option<String>,
    pub goal: Option<String>,
    pub start_date: Option<Option<NaiveDate>>,
    pub end_date: Option<Option<NaiveDate>>,
    pub status: Option<String>,
}

// ─── Handlers ─────────────────────────────────────────

/// GET /projects/:project_id/sprints
pub async fn list_by_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Sprint>>>, axum::http::StatusCode> {
    let _org_id = auth.org_id.as_deref().ok_or(axum::http::StatusCode::BAD_REQUEST)?;

    let sprints = sqlx::query_as::<_, Sprint>(
        r#"
        SELECT id, project_id, name, goal, start_date, end_date, status, org_id, created_at
        FROM sprints
        WHERE project_id = $1
        ORDER BY start_date NULLS LAST, created_at
        "#,
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(sprints)))
}

/// POST /projects/:project_id/sprints
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateSprint>,
) -> Result<Json<ApiResponse<Sprint>>, axum::http::StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(axum::http::StatusCode::BAD_REQUEST)?;

    if body.name.trim().is_empty() {
        return Err(axum::http::StatusCode::BAD_REQUEST);
    }

    let status = body.status.as_deref().unwrap_or("planning");

    let sprint = sqlx::query_as::<_, Sprint>(
        r#"
        INSERT INTO sprints (project_id, name, goal, start_date, end_date, status, org_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, project_id, name, goal, start_date, end_date, status, org_id, created_at
        "#,
    )
    .bind(project_id)
    .bind(&body.name)
    .bind(&body.goal)
    .bind(body.start_date)
    .bind(body.end_date)
    .bind(status)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    Ok(Json(ApiResponse::new(sprint)))
}

/// PUT /sprints/:id
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateSprint>,
) -> Result<Json<ApiResponse<Sprint>>, axum::http::StatusCode> {
    let _org_id = auth.org_id.as_deref().ok_or(axum::http::StatusCode::BAD_REQUEST)?;

    let start_date_provided = body.start_date.is_some();
    let start_date_value = body.start_date.flatten();
    let end_date_provided = body.end_date.is_some();
    let end_date_value = body.end_date.flatten();

    let sprint = sqlx::query_as::<_, Sprint>(
        r#"
        UPDATE sprints SET
            name = COALESCE($2, name),
            goal = COALESCE($3, goal),
            start_date = CASE WHEN $4::boolean THEN $5 ELSE start_date END,
            end_date = CASE WHEN $6::boolean THEN $7 ELSE end_date END,
            status = COALESCE($8, status)
        WHERE id = $1
        RETURNING id, project_id, name, goal, start_date, end_date, status, org_id, created_at
        "#,
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.goal)
    .bind(start_date_provided)
    .bind(start_date_value)
    .bind(end_date_provided)
    .bind(end_date_value)
    .bind(&body.status)
    .fetch_optional(&pool)
    .await
    .unwrap();

    match sprint {
        Some(s) => Ok(Json(ApiResponse::new(s))),
        None => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

/// DELETE /sprints/:id
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, axum::http::StatusCode> {
    let _org_id = auth.org_id.as_deref().ok_or(axum::http::StatusCode::BAD_REQUEST)?;

    let result = sqlx::query("DELETE FROM sprints WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}
