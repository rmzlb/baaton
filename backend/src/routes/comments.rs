use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Comment};
use crate::routes::activity::log_activity;
use crate::routes::sse::{EventSender, broadcast_event};

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
    Extension(auth): Extension<AuthUser>,
    Extension(event_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateComment>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, &'static str)> {
    // Input validation
    if body.body.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "comment body must not be empty"));
    }
    if body.body.len() > 10_000 {
        return Err((StatusCode::BAD_REQUEST, "comment body must be at most 10000 characters"));
    }
    if body.author_name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "author_name must not be empty"));
    }

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
    .unwrap();

    // Log activity
    let org_id = auth.org_id.unwrap_or_default();
    // Look up the issue to get its project_id for the activity log
    let issue_info = sqlx::query_as::<_, (Uuid,)>(
        "SELECT project_id FROM issues WHERE id = $1"
    )
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let project_id = issue_info.map(|i| i.0);
    log_activity(
        &pool,
        &org_id,
        project_id,
        Some(issue_id),
        &auth.user_id,
        Some(&body.author_name),
        "commented",
        None,
        None,
        None,
        Some(serde_json::json!({ "comment_id": comment.id.to_string() })),
    )
    .await;

    // Broadcast SSE event
    let event_payload = serde_json::json!({
        "type": "comment_created",
        "issue_id": issue_id.to_string(),
        "comment_id": comment.id.to_string(),
        "author_name": body.author_name,
    });
    broadcast_event(&event_tx, &org_id, &event_payload.to_string());

    Ok(Json(ApiResponse::new(comment)))
}
