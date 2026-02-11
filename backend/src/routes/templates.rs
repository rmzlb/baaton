use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct IssueTemplate {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub title_template: Option<String>,
    pub description_template: Option<String>,
    #[sqlx(rename = "type")]
    pub template_type: String,
    pub priority: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplate {
    pub name: String,
    pub title_template: Option<String>,
    pub description_template: Option<String>,
    #[serde(rename = "type")]
    pub template_type: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// GET /projects/:project_id/templates
pub async fn list_by_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<IssueTemplate>>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let templates = sqlx::query_as::<_, IssueTemplate>(
        r#"
        SELECT t.id, t.project_id, t.name, t.title_template, t.description_template,
               t.type, t.priority, t.tags, t.created_at
        FROM issue_templates t
        JOIN projects p ON p.id = t.project_id
        WHERE t.project_id = $1 AND p.org_id = $2
        ORDER BY t.created_at
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(templates)))
}

/// POST /projects/:project_id/templates
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateTemplate>,
) -> Result<Json<ApiResponse<IssueTemplate>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
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

    let template = sqlx::query_as::<_, IssueTemplate>(
        r#"
        INSERT INTO issue_templates (project_id, name, title_template, description_template, type, priority, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, project_id, name, title_template, description_template, type, priority, tags, created_at
        "#,
    )
    .bind(project_id)
    .bind(&body.name)
    .bind(&body.title_template)
    .bind(&body.description_template)
    .bind(body.template_type.as_deref().unwrap_or("feature"))
    .bind(&body.priority)
    .bind(&body.tags.unwrap_or_default())
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(template)))
}

/// DELETE /templates/:id
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM issue_templates WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE org_id = $2)"
    )
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Template not found"}))))
    }
}
