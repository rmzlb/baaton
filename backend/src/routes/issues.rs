use axum::{extract::{Path, Query, State}, Json};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{ApiResponse, CreateIssue, Issue, UpdateIssue};

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub r#type: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_by_project(
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<ListParams>,
) -> Json<ApiResponse<Vec<Issue>>> {
    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);

    let issues = sqlx::query_as::<_, Issue>(
        r#"
        SELECT * FROM issues
        WHERE project_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR priority = $3)
          AND ($4::text IS NULL OR type = $4)
          AND ($5::text IS NULL OR title ILIKE '%' || $5 || '%')
        ORDER BY position ASC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(project_id)
    .bind(&params.status)
    .bind(&params.priority)
    .bind(&params.r#type)
    .bind(&params.search)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(issues))
}

pub async fn create(
    State(pool): State<PgPool>,
    Json(body): Json<CreateIssue>,
) -> Json<ApiResponse<Issue>> {
    // Generate display_id
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1"
    )
    .bind(body.project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let project = sqlx::query_as::<_, (String,)>(
        "SELECT prefix FROM projects WHERE id = $1"
    )
    .bind(body.project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let display_id = format!("{}-{}", project.0, count.0 + 1);

    // Get max position for the status
    let max_pos: Option<(f64,)> = sqlx::query_as(
        "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = $2"
    )
    .bind(body.project_id)
    .bind(body.issue_type.as_deref().unwrap_or("todo"))
    .fetch_optional(&pool)
    .await
    .unwrap();

    let position = max_pos.map(|p| p.0 + 1000.0).unwrap_or(1000.0);

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, priority,
            milestone_id, parent_id, tags, assignee_ids, position, source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'web')
        RETURNING *
        "#,
    )
    .bind(body.project_id)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.issue_type.as_deref().unwrap_or("feature"))
    .bind(&body.priority)
    .bind(body.milestone_id)
    .bind(body.parent_id)
    .bind(&body.tags.unwrap_or_default())
    .bind(&body.assignee_ids.unwrap_or_default())
    .bind(position)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(issue))
}

pub async fn get_one(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Json<ApiResponse<Issue>> {
    let issue = sqlx::query_as::<_, Issue>(
        "SELECT * FROM issues WHERE id = $1"
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(issue))
}

pub async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateIssue>,
) -> Json<ApiResponse<Issue>> {
    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            type = COALESCE($4, type),
            status = COALESCE($5, status),
            updated_at = now()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(&body.issue_type)
    .bind(&body.status)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(issue))
}

pub async fn update_position(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<Issue>> {
    let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("todo");
    let position = body.get("position").and_then(|v| v.as_f64()).unwrap_or(1000.0);

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues SET status = $2, position = $3, updated_at = now()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(status)
    .bind(position)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(issue))
}

pub async fn remove(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Json<ApiResponse<()>> {
    sqlx::query("DELETE FROM issues WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    Json(ApiResponse::new(()))
}

// ─── Public Submission ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PublicSubmission {
    pub title: String,
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub reporter_name: Option<String>,
    pub reporter_email: Option<String>,
}

pub async fn public_submit(
    State(pool): State<PgPool>,
    Path(slug): Path<String>,
    Json(body): Json<PublicSubmission>,
) -> Json<ApiResponse<Issue>> {
    // Find project by slug
    let project = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, prefix FROM projects WHERE slug = $1"
    )
    .bind(&slug)
    .fetch_one(&pool)
    .await
    .unwrap();

    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1"
    )
    .bind(project.0)
    .fetch_one(&pool)
    .await
    .unwrap();

    let display_id = format!("{}-{}", project.1, count.0 + 1);

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type,
            reporter_name, reporter_email, source, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'form', 99999)
        RETURNING *
        "#,
    )
    .bind(project.0)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.r#type.as_deref().unwrap_or("bug"))
    .bind(&body.reporter_name)
    .bind(&body.reporter_email)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(issue))
}
