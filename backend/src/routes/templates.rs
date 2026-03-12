use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

// ─── Structs ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct IssueTemplate {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub name: String,
    pub title_prefix: Option<String>,
    pub description: Option<String>,
    pub default_tags: Vec<String>,
    pub default_priority: String,
    pub default_issue_type: String,
    pub default_assignee_ids: Vec<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplate {
    pub name: String,
    pub title_prefix: Option<String>,
    pub description: Option<String>,
    pub default_tags: Option<Vec<String>>,
    pub default_priority: Option<String>,
    pub default_issue_type: Option<String>,
    pub default_assignee_ids: Option<Vec<String>>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTemplate {
    pub name: Option<String>,
    pub title_prefix: Option<String>,
    pub description: Option<String>,
    pub default_tags: Option<Vec<String>>,
    pub default_priority: Option<String>,
    pub default_issue_type: Option<String>,
    pub default_assignee_ids: Option<Vec<String>>,
    pub is_default: Option<bool>,
}

// ─── Column list helper (avoid SELECT * with mixed old/new schema) ───────────

const TEMPLATE_COLS: &str = r#"
    id, project_id, org_id, name, title_prefix, description,
    default_tags, default_priority, default_issue_type,
    default_assignee_ids, is_default, created_at
"#;

// ─── Routes ──────────────────────────────────────────

/// GET /projects/{id}/templates
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<IssueTemplate>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let sql = format!(
        "SELECT {} FROM issue_templates WHERE project_id = $1 AND org_id = $2 ORDER BY is_default DESC, created_at ASC",
        TEMPLATE_COLS
    );

    let templates = sqlx::query_as::<_, IssueTemplate>(&sql)
        .bind(project_id)
        .bind(org_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error = %e, "templates.list query failed");
            vec![]
        });

    Ok(Json(ApiResponse::new(templates)))
}

/// GET /templates/{id}
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<IssueTemplate>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let sql = format!(
        "SELECT {} FROM issue_templates WHERE id = $1 AND org_id = $2",
        TEMPLATE_COLS
    );

    let template = sqlx::query_as::<_, IssueTemplate>(&sql)
        .bind(id)
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Template not found"}))))?;

    Ok(Json(ApiResponse::new(template)))
}

/// POST /projects/{id}/templates
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateTemplate>,
) -> Result<Json<ApiResponse<IssueTemplate>>, (StatusCode, Json<serde_json::Value>)> {
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

    let sql = format!(
        r#"
        INSERT INTO issue_templates (
            project_id, org_id, name, title_prefix, description,
            default_tags, default_priority, default_issue_type,
            default_assignee_ids, is_default
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING {}
        "#,
        TEMPLATE_COLS
    );

    let template = sqlx::query_as::<_, IssueTemplate>(&sql)
        .bind(project_id)
        .bind(org_id)
        .bind(&body.name)
        .bind(&body.title_prefix)
        .bind(&body.description)
        .bind(body.default_tags.unwrap_or_default())
        .bind(body.default_priority.as_deref().unwrap_or("medium"))
        .bind(body.default_issue_type.as_deref().unwrap_or("feature"))
        .bind(body.default_assignee_ids.unwrap_or_default())
        .bind(body.is_default.unwrap_or(false))
        .fetch_one(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(template)))
}

/// PATCH /templates/{id}
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateTemplate>,
) -> Result<Json<ApiResponse<IssueTemplate>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let sql = format!(
        r#"
        UPDATE issue_templates SET
            name               = COALESCE($2, name),
            title_prefix       = COALESCE($3, title_prefix),
            description        = COALESCE($4, description),
            default_tags       = COALESCE($5, default_tags),
            default_priority   = COALESCE($6, default_priority),
            default_issue_type = COALESCE($7, default_issue_type),
            default_assignee_ids = COALESCE($8, default_assignee_ids),
            is_default         = COALESCE($9, is_default)
        WHERE id = $1 AND org_id = $10
        RETURNING {}
        "#,
        TEMPLATE_COLS
    );

    let template = sqlx::query_as::<_, IssueTemplate>(&sql)
        .bind(id)
        .bind(&body.name)
        .bind(&body.title_prefix)
        .bind(&body.description)
        .bind(&body.default_tags)
        .bind(&body.default_priority)
        .bind(&body.default_issue_type)
        .bind(&body.default_assignee_ids)
        .bind(body.is_default)
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Template not found"}))))?;

    Ok(Json(ApiResponse::new(template)))
}

/// DELETE /templates/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM issue_templates WHERE id = $1 AND org_id = $2"
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


