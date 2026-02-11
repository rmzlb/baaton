use axum::{extract::{Path, Query, State}, Extension, Json};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ActivityEntry, ApiResponse};

#[derive(Debug, Deserialize)]
pub struct ActivityParams {
    pub limit: Option<i64>,
}

/// GET /api/v1/issues/:id/activity — activity log for a specific issue
pub async fn list_by_issue(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Query(params): Query<ActivityParams>,
) -> Json<ApiResponse<Vec<ActivityEntry>>> {
    let org_id = auth.org_id.unwrap_or_default();
    let limit = params.limit.unwrap_or(50);

    let entries = sqlx::query_as::<_, ActivityEntry>(
        r#"
        SELECT * FROM activity_log
        WHERE issue_id = $1 AND org_id = $2
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(issue_id)
    .bind(&org_id)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(entries))
}

/// GET /api/v1/activity — recent activity across the org (for dashboard)
pub async fn list_recent(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<ActivityParams>,
) -> Json<ApiResponse<Vec<ActivityEntry>>> {
    let org_id = auth.org_id.unwrap_or_default();
    let limit = params.limit.unwrap_or(30);

    let entries = sqlx::query_as::<_, ActivityEntry>(
        r#"
        SELECT * FROM activity_log
        WHERE org_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(&org_id)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(entries))
}

/// Helper: log an activity entry (used from issues.rs, comments.rs, etc.)
#[allow(dead_code)]
pub async fn log_activity(
    pool: &PgPool,
    org_id: &str,
    project_id: Option<Uuid>,
    issue_id: Option<Uuid>,
    user_id: &str,
    user_name: Option<&str>,
    action: &str,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    let meta = metadata.unwrap_or(serde_json::json!({}));
    let _ = sqlx::query(
        r#"
        INSERT INTO activity_log (org_id, project_id, issue_id, user_id, user_name, action, field, old_value, new_value, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(org_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(user_id)
    .bind(user_name)
    .bind(action)
    .bind(field)
    .bind(old_value)
    .bind(new_value)
    .bind(meta)
    .execute(pool)
    .await;
}
