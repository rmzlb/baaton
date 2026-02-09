use axum::{extract::{Path, State}, Json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{ApiResponse, CreateProject, Project};

pub async fn list(State(pool): State<PgPool>) -> Json<ApiResponse<Vec<Project>>> {
    // TODO: Filter by org_id from Clerk JWT
    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects ORDER BY created_at DESC"
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(projects))
}

pub async fn create(
    State(pool): State<PgPool>,
    Json(body): Json<CreateProject>,
) -> Json<ApiResponse<Project>> {
    // TODO: Get org_id from Clerk JWT
    let org_id = "default";

    let project = sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (org_id, name, slug, description, prefix)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(org_id)
    .bind(&body.name)
    .bind(&body.slug)
    .bind(&body.description)
    .bind(&body.prefix)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(project))
}

pub async fn get_one(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Json<ApiResponse<Project>> {
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1"
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(project))
}

pub async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<Project>> {
    // Dynamic update based on provided fields
    let project = sqlx::query_as::<_, Project>(
        r#"
        UPDATE projects SET
            name = COALESCE($2, name),
            description = COALESCE($3, description)
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(body.get("name").and_then(|v| v.as_str()))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(project))
}

pub async fn remove(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Json<ApiResponse<()>> {
    sqlx::query("DELETE FROM projects WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    Json(ApiResponse::new(()))
}
