use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{ApiResponse, Comment};

#[derive(Debug, Deserialize)]
pub struct CreateComment {
    pub author_id: String,
    pub author_name: String,
    pub body: String,
}

pub async fn list_by_issue(
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Json<ApiResponse<Vec<Comment>>> {
    let comments = sqlx::query_as::<_, Comment>(
        "SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC",
    )
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(comments))
}

pub async fn create(
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateComment>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, Json<serde_json::Value>)> {
    let comment = sqlx::query_as::<_, Comment>(
        r#"
        INSERT INTO comments (issue_id, author_id, author_name, body)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(&body.author_id)
    .bind(&body.author_name)
    .bind(&body.body)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(comment)))
}
