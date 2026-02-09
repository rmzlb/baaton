use axum::{extract::{Path, State}, Json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{ApiResponse, CreateTldr, Tldr};

pub async fn create(
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateTldr>,
) -> Json<ApiResponse<Tldr>> {
    let tldr = sqlx::query_as::<_, Tldr>(
        r#"
        INSERT INTO tldrs (issue_id, agent_name, summary, files_changed, tests_status, pr_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(&body.agent_name)
    .bind(&body.summary)
    .bind(&body.files_changed.unwrap_or_default())
    .bind(body.tests_status.as_deref().unwrap_or("none"))
    .bind(&body.pr_url)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(tldr))
}
