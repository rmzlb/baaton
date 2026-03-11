use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub filename: String,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub storage_url: Option<String>,
    pub uploaded_by: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAttachment {
    pub filename: String,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub storage_url: Option<String>,
}

/// GET /issues/{id}/attachments — list attachments
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Attachment>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let attachments = sqlx::query_as::<_, Attachment>(
        "SELECT * FROM attachments WHERE issue_id = $1 AND org_id = $2 ORDER BY created_at ASC"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse { data: attachments }))
}

/// POST /issues/{id}/attachments — register attachment metadata
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateAttachment>,
) -> Result<Json<ApiResponse<Attachment>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Get project_id from issue
    let project_id: (Uuid,) = sqlx::query_as(
        "SELECT project_id FROM issues WHERE id = $1 AND org_id = $2"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;

    let attachment = sqlx::query_as::<_, Attachment>(
        r#"INSERT INTO attachments (issue_id, project_id, org_id, filename, content_type, size_bytes, storage_url, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *"#,
    )
    .bind(issue_id)
    .bind(project_id.0)
    .bind(org_id)
    .bind(&body.filename)
    .bind(&body.content_type)
    .bind(body.size_bytes)
    .bind(&body.storage_url)
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse { data: attachment }))
}

/// DELETE /issues/{id}/attachments/{att_id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((issue_id, att_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query("DELETE FROM attachments WHERE id = $1 AND issue_id = $2 AND org_id = $3")
        .bind(att_id)
        .bind(issue_id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Attachment not found"}))));
    }

    Ok(Json(json!({"deleted": true})))
}
