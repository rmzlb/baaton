use axum::{extract::{Path, Query, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: String,
    pub org_id: String,
    #[sqlx(rename = "type")]
    pub notif_type: String,
    pub issue_id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub title: String,
    pub body: Option<String>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct NotificationPreference {
    pub user_id: String,
    pub org_id: String,
    #[sqlx(rename = "type")]
    pub pref_type: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub unread: Option<bool>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePreference {
    #[serde(rename = "type")]
    pub pref_type: String,
    pub enabled: bool,
}

// ─── Helper ───────────────────────────────────────────

/// Fire-and-forget helper to insert a notification row.
/// Designed to be called inside a `tokio::spawn` block.
pub async fn create_notification(
    pool: &PgPool,
    user_id: &str,
    org_id: &str,
    notif_type: &str,
    issue_id: Option<Uuid>,
    project_id: Option<Uuid>,
    title: &str,
    body: Option<&str>,
) {
    let result = sqlx::query(
        r#"INSERT INTO issue_notifications (user_id, org_id, type, issue_id, project_id, title, body)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#
    )
    .bind(user_id)
    .bind(org_id)
    .bind(notif_type)
    .bind(issue_id)
    .bind(project_id)
    .bind(title)
    .bind(body)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::error!(error = %e, "create_notification failed");
    }
}

// ─── Handlers ─────────────────────────────────────────

/// GET /notifications?unread=true&limit=20
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<ListParams>,
) -> Result<Json<ApiResponse<Vec<Notification>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let limit = params.limit.unwrap_or(20).min(100);

    // unread=true → only unread; unread=false or absent → all
    let notifications = sqlx::query_as::<_, Notification>(
        r#"SELECT * FROM issue_notifications
           WHERE user_id = $1 AND org_id = $2
             AND (NOT COALESCE($3::boolean, false) OR read = false)
           ORDER BY created_at DESC
           LIMIT $4"#
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(params.unread)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "notifications.list query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(notifications)))
}

/// GET /notifications/count — returns { unread: N }
pub async fn count(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let unread: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issue_notifications WHERE user_id = $1 AND org_id = $2 AND read = false"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    Ok(Json(json!({ "unread": unread })))
}

/// PATCH /notifications/{id}/read
pub async fn mark_read(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "UPDATE issue_notifications SET read = true WHERE id = $1 AND user_id = $2 AND org_id = $3"
    )
    .bind(id)
    .bind(&auth.user_id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Notification not found"}))));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /notifications/read-all
pub async fn read_all(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    sqlx::query(
        "UPDATE issue_notifications SET read = true WHERE user_id = $1 AND org_id = $2 AND read = false"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /notifications/preferences
pub async fn get_preferences(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<NotificationPreference>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let prefs = sqlx::query_as::<_, NotificationPreference>(
        "SELECT * FROM notification_preferences WHERE user_id = $1 AND org_id = $2"
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "notifications.get_preferences query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(prefs)))
}

/// PATCH /notifications/preferences
pub async fn update_preferences(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<UpdatePreference>,
) -> Result<Json<ApiResponse<NotificationPreference>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let pref = sqlx::query_as::<_, NotificationPreference>(
        r#"INSERT INTO notification_preferences (user_id, org_id, type, enabled)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, org_id, type)
           DO UPDATE SET enabled = EXCLUDED.enabled
           RETURNING *"#
    )
    .bind(&auth.user_id)
    .bind(org_id)
    .bind(&body.pref_type)
    .bind(body.enabled)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(pref)))
}
