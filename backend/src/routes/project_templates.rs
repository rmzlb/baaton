use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, CreateProjectTemplate, ProjectTemplate};

// ─── GET /project-templates ───────────────────────────

pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<ProjectTemplate>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let templates = sqlx::query_as::<_, ProjectTemplate>(
        "SELECT * FROM project_templates WHERE is_system = true OR org_id = $1 ORDER BY is_system DESC, name ASC"
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(templates)))
}

// ─── POST /project-templates ──────────────────────────

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateProjectTemplate>,
) -> Result<Json<ApiResponse<ProjectTemplate>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let template = sqlx::query_as::<_, ProjectTemplate>(
        r#"
        INSERT INTO project_templates (org_id, name, description, default_context, default_statuses, default_tags, is_system)
        VALUES ($1, $2, $3, COALESCE($4, '{}'), $5, COALESCE($6, '{}'), false)
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(body.default_context.as_ref())
    .bind(body.default_statuses.as_ref())
    .bind(&body.default_tags.unwrap_or_default())
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(template)))
}

// ─── DELETE /project-templates/{id} ───────────────────

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Check template exists and is not a system template
    let tmpl: Option<(bool, Option<String>)> = sqlx::query_as(
        "SELECT is_system, org_id FROM project_templates WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match tmpl {
        None => return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Template not found"})))),
        Some((true, _)) => return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Cannot delete system templates"})))),
        Some((false, Some(ref tid))) if tid != org_id => {
            return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Cannot delete templates from another organization"}))))
        }
        _ => {}
    }

    sqlx::query("DELETE FROM project_templates WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(())))
}
