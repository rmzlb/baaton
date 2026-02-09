use axum::{extract::{Path, State}, Json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{ApiResponse, CreateProjectTag, ProjectTag};

pub async fn list_by_project(
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Json<ApiResponse<Vec<ProjectTag>>> {
    let tags = sqlx::query_as::<_, ProjectTag>(
        "SELECT * FROM project_tags WHERE project_id = $1 ORDER BY name ASC",
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(tags))
}

pub async fn create(
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateProjectTag>,
) -> Json<ApiResponse<ProjectTag>> {
    let color = body.color.as_deref().unwrap_or("#6b7280");

    let tag = sqlx::query_as::<_, ProjectTag>(
        r#"
        INSERT INTO project_tags (project_id, name, color)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, name) DO UPDATE SET color = $3
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(&body.name)
    .bind(color)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(tag))
}

pub async fn remove(
    State(pool): State<PgPool>,
    Path(tag_id): Path<Uuid>,
) -> Json<ApiResponse<()>> {
    sqlx::query("DELETE FROM project_tags WHERE id = $1")
        .bind(tag_id)
        .execute(&pool)
        .await
        .unwrap();

    Json(ApiResponse::new(()))
}
