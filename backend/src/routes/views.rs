use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde_json::json;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SavedView {
    pub id: Uuid,
    pub org_id: String,
    pub user_id: String,
    pub name: String,
    pub filters: serde_json::Value,
    pub sort: Option<String>,
    pub is_shared: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateView {
    pub name: String,
    pub filters: serde_json::Value,
    pub sort: Option<String>,
    pub is_shared: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateView {
    pub name: Option<String>,
    pub filters: Option<serde_json::Value>,
    pub sort: Option<String>,
    pub is_shared: Option<bool>,
}

pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<SavedView>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let views = sqlx::query_as::<_, SavedView>(
        "SELECT * FROM saved_views WHERE org_id = $1 AND (user_id = $2 OR is_shared = true) ORDER BY created_at DESC"
    )
    .bind(org_id)
    .bind(&auth.user_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(views)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateView>,
) -> Result<Json<ApiResponse<SavedView>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let view = sqlx::query_as::<_, SavedView>(
        r#"INSERT INTO saved_views (org_id, user_id, name, filters, sort, is_shared)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *"#
    )
    .bind(org_id)
    .bind(&auth.user_id)
    .bind(&body.name)
    .bind(&body.filters)
    .bind(body.sort.as_deref().unwrap_or("manual"))
    .bind(body.is_shared.unwrap_or(false))
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(view)))
}

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateView>,
) -> Result<Json<ApiResponse<SavedView>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let view = sqlx::query_as::<_, SavedView>(
        r#"UPDATE saved_views
           SET name = COALESCE($1, name),
               filters = COALESCE($2, filters),
               sort = COALESCE($3, sort),
               is_shared = COALESCE($4, is_shared),
               updated_at = now()
           WHERE id = $5 AND org_id = $6 AND user_id = $7
           RETURNING *"#
    )
    .bind(body.name.as_deref())
    .bind(&body.filters)
    .bind(body.sort.as_deref())
    .bind(body.is_shared)
    .bind(id)
    .bind(org_id)
    .bind(&auth.user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "View not found"}))))?;

    Ok(Json(ApiResponse::new(view)))
}

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query("DELETE FROM saved_views WHERE id = $1 AND org_id = $2 AND user_id = $3")
        .bind(id)
        .bind(org_id)
        .bind(&auth.user_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "View not found"}))));
    }

    Ok(StatusCode::NO_CONTENT)
}
