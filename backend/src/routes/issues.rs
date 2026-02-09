use axum::{extract::{Path, Query, State}, Json};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{ApiResponse, Comment, CreateIssue, Issue, IssueDetail, Tldr, UpdateIssue};

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub r#type: Option<String>,
    pub category: Option<String>,
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
          AND ($6::text IS NULL OR $6 = ANY(category))
        ORDER BY position ASC
        LIMIT $7 OFFSET $8
        "#,
    )
    .bind(project_id)
    .bind(&params.status)
    .bind(&params.priority)
    .bind(&params.r#type)
    .bind(&params.search)
    .bind(&params.category)
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
        "SELECT COALESCE(COUNT(*), 0) FROM issues WHERE project_id = $1"
    )
    .bind(body.project_id)
    .fetch_one(&pool)
    .await
    .unwrap_or((0i64,));

    let project = sqlx::query_as::<_, (String,)>(
        "SELECT prefix FROM projects WHERE id = $1"
    )
    .bind(body.project_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let display_id = format!("{}-{}", project.0, count.0 + 1);

    // Get max position for the status
    let max_pos: Option<(Option<f64>,)> = sqlx::query_as(
        "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = $2"
    )
    .bind(body.project_id)
    .bind(body.status.as_deref().unwrap_or("backlog"))
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    let position = max_pos.and_then(|p| p.0).map(|p| p + 1000.0).unwrap_or(1000.0);

    let status = body.status.as_deref().unwrap_or("backlog");
    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, status, priority,
            milestone_id, parent_id, tags, category, assignee_ids, position, source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'web')
        RETURNING *
        "#,
    )
    .bind(body.project_id)
    .bind(&display_id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.issue_type.as_deref().unwrap_or("feature"))
    .bind(status)
    .bind(&body.priority)
    .bind(body.milestone_id)
    .bind(body.parent_id)
    .bind(&body.tags.unwrap_or_default())
    .bind(&body.category.unwrap_or_default())
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
) -> Json<ApiResponse<IssueDetail>> {
    let issue = sqlx::query_as::<_, Issue>(
        "SELECT * FROM issues WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let tldrs = sqlx::query_as::<_, Tldr>(
        "SELECT * FROM tldrs WHERE issue_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let comments = sqlx::query_as::<_, Comment>(
        "SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(IssueDetail {
        issue,
        tldrs,
        comments,
    }))
}

pub async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateIssue>,
) -> Json<ApiResponse<Issue>> {
    // Option<Option<T>> pattern: outer None = not provided, Some(None) = set to null, Some(Some(v)) = set value
    let priority_provided = body.priority.is_some();
    let priority_value = body.priority.flatten();
    let milestone_provided = body.milestone_id.is_some();
    let milestone_value = body.milestone_id.flatten();

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            type = COALESCE($4, type),
            status = COALESCE($5, status),
            priority = CASE WHEN $6::boolean THEN $7 ELSE priority END,
            tags = COALESCE($8, tags),
            assignee_ids = COALESCE($9, assignee_ids),
            milestone_id = CASE WHEN $10::boolean THEN $11 ELSE milestone_id END,
            category = COALESCE($12, category),
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
    .bind(priority_provided)
    .bind(&priority_value)
    .bind(&body.tags)
    .bind(&body.assignee_ids)
    .bind(milestone_provided)
    .bind(milestone_value)
    .bind(&body.category)
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

#[derive(Debug, Deserialize)]
pub struct MineParams {
    pub assignee_id: String,
}

pub async fn list_mine(
    State(pool): State<PgPool>,
    Query(params): Query<MineParams>,
) -> Json<ApiResponse<Vec<Issue>>> {
    let issues = sqlx::query_as::<_, Issue>(
        r#"
        SELECT * FROM issues
        WHERE $1 = ANY(assignee_ids)
        ORDER BY
            CASE priority
                WHEN 'urgent' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
            END,
            updated_at DESC
        "#,
    )
    .bind(&params.assignee_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(issues))
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
        "SELECT COALESCE(COUNT(*), 0) FROM issues WHERE project_id = $1"
    )
    .bind(project.0)
    .fetch_one(&pool)
    .await
    .unwrap_or((0i64,));

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
