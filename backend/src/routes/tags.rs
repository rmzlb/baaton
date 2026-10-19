use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::routes::issue_scope;
use crate::models::{ApiResponse, CreateProjectTag, ProjectTag};

pub async fn list_by_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<ProjectTag>>>, (StatusCode, Json<serde_json::Value>)> {
    // Resolve the org that owns the project and check the caller's org and
    // project scope against it (BAA-34).
    crate::routes::issue_scope::require_project(&pool, &auth, project_id).await?;

    let tags = sqlx::query_as::<_, ProjectTag>(
        "SELECT * FROM project_tags WHERE project_id = $1 ORDER BY name ASC",
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "tags.list query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(tags)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateProjectTag>,
) -> Result<Json<ApiResponse<ProjectTag>>, (StatusCode, Json<serde_json::Value>)> {
    // Resolve the org that owns the project and check the caller's org and
    // project scope against it (BAA-34).
    crate::routes::issue_scope::require_project(&pool, &auth, project_id).await?;

    let color = body.color.as_deref().unwrap_or("#6b7280");

    let tag = sqlx::query_as::<_, ProjectTag>(
        r#"
        INSERT INTO project_tags (project_id, name, color, group_name, description)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (project_id, name) DO UPDATE
            SET color = EXCLUDED.color,
                group_name = EXCLUDED.group_name,
                description = EXCLUDED.description
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(&body.name)
    .bind(color)
    .bind(&body.group_name)
    .bind(&body.description)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(tag)))
}

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(tag_id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let owner_org = require_tag(&pool, &auth, tag_id).await?;
    let org_id = owner_org.as_str();

    // Verify tag belongs to a project in user's org
    let result = sqlx::query(
        "DELETE FROM project_tags WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE org_id = $2)"
    )
    .bind(tag_id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Tag not found"}))))
    }
}

/// Org owning tag `id` (through its project), or 404 when it is
/// missing or outside the caller's org/project scope.
async fn require_tag(
    pool: &PgPool,
    auth: &AuthUser,
    id: Uuid,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let row: Option<(String, Uuid)> = sqlx::query_as(
        "SELECT p.org_id, p.id FROM project_tags r JOIN projects p ON p.id = r.project_id WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, %id, "project_tags scope lookup failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
    })?;
    match row {
        Some((org_id, project_id)) if issue_scope::entitled(auth, &org_id, project_id).await => Ok(org_id),
        _ => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Tag not found"})))),
    }
}
