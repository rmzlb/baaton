use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool, QueryBuilder};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Issue};

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct CustomView {
    pub id: Uuid,
    pub org_id: String,
    pub project_id: Option<Uuid>,
    pub created_by: String,
    pub name: String,
    pub filters: serde_json::Value,
    pub display_options: serde_json::Value,
    pub visibility: String,
    pub pinned: bool,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateView {
    pub name: String,
    pub filters: Option<serde_json::Value>,
    pub display_options: Option<serde_json::Value>,
    pub visibility: Option<String>,
    pub pinned: Option<bool>,
    pub project_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateView {
    pub name: Option<String>,
    pub filters: Option<serde_json::Value>,
    pub display_options: Option<serde_json::Value>,
    pub visibility: Option<String>,
    pub pinned: Option<bool>,
}

// ─── Handlers ─────────────────────────────────────────

/// GET /views — personal + shared views for org
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<CustomView>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let views = sqlx::query_as::<_, CustomView>(
        r#"SELECT * FROM custom_views
           WHERE org_id = $1
             AND (created_by = $2 OR visibility = 'shared')
           ORDER BY pinned DESC, created_at DESC"#
    )
    .bind(org_id)
    .bind(&auth.user_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "views.list query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(views)))
}

/// POST /views
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateView>,
) -> Result<Json<ApiResponse<CustomView>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let visibility = body.visibility.as_deref().unwrap_or("personal");
    if !["personal", "shared"].contains(&visibility) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "visibility must be 'personal' or 'shared'"}))));
    }

    let view = sqlx::query_as::<_, CustomView>(
        r#"INSERT INTO custom_views (org_id, project_id, created_by, name, filters, display_options, visibility, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *"#
    )
    .bind(org_id)
    .bind(body.project_id)
    .bind(&auth.user_id)
    .bind(&body.name)
    .bind(body.filters.unwrap_or_else(|| json!({})))
    .bind(body.display_options.unwrap_or_else(|| json!({})))
    .bind(visibility)
    .bind(body.pinned.unwrap_or(false))
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(view)))
}

/// PATCH /views/{id}
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateView>,
) -> Result<Json<ApiResponse<CustomView>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let view = sqlx::query_as::<_, CustomView>(
        r#"UPDATE custom_views
           SET name            = COALESCE($1, name),
               filters         = COALESCE($2, filters),
               display_options = COALESCE($3, display_options),
               visibility      = COALESCE($4, visibility),
               pinned          = COALESCE($5, pinned)
           WHERE id = $6 AND org_id = $7
           RETURNING *"#
    )
    .bind(body.name.as_deref())
    .bind(&body.filters)
    .bind(&body.display_options)
    .bind(body.visibility.as_deref())
    .bind(body.pinned)
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "View not found"}))))?;

    Ok(Json(ApiResponse::new(view)))
}

/// DELETE /views/{id} — only creator can delete
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM custom_views WHERE id = $1 AND org_id = $2 AND created_by = $3"
    )
    .bind(id)
    .bind(org_id)
    .bind(&auth.user_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "View not found or not authorized"}))));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// GET /views/{id}/issues — apply stored filters and return matching issues
///
/// Filter keys supported:
///   status        → []string
///   priority      → []string
///   assignee_ids  → []string  (any match)
///   tags          → []string  (any match)
///   due_before    → "YYYY-MM-DD"
///   is_overdue    → bool
pub async fn get_issues(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Issue>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Fetch the view (personal or shared within org)
    let view = sqlx::query_as::<_, CustomView>(
        r#"SELECT * FROM custom_views
           WHERE id = $1 AND org_id = $2
             AND (created_by = $3 OR visibility = 'shared')"#
    )
    .bind(id)
    .bind(org_id)
    .bind(&auth.user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "View not found"}))))?;

    let filters = &view.filters;

    // ── Build dynamic query ───────────────────────────────
    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new(
        r#"SELECT i.*
           FROM issues i
           JOIN projects p ON p.id = i.project_id
           WHERE p.org_id = "#
    );
    qb.push_bind(org_id);
    qb.push(" AND i.archived = false");

    // filter: status
    if let Some(statuses) = filters.get("status").and_then(|v| v.as_array()) {
        let vals: Vec<String> = statuses.iter()
            .filter_map(|s| s.as_str().map(String::from))
            .collect();
        if !vals.is_empty() {
            qb.push(" AND i.status = ANY(");
            qb.push_bind(vals);
            qb.push(")");
        }
    }

    // filter: priority
    if let Some(priorities) = filters.get("priority").and_then(|v| v.as_array()) {
        let vals: Vec<String> = priorities.iter()
            .filter_map(|s| s.as_str().map(String::from))
            .collect();
        if !vals.is_empty() {
            qb.push(" AND i.priority = ANY(");
            qb.push_bind(vals);
            qb.push(")");
        }
    }

    // filter: assignee_ids (any match via &&)
    if let Some(assignees) = filters.get("assignee_ids").and_then(|v| v.as_array()) {
        let vals: Vec<String> = assignees.iter()
            .filter_map(|s| s.as_str().map(String::from))
            .collect();
        if !vals.is_empty() {
            qb.push(" AND i.assignee_ids && ");
            qb.push_bind(vals);
        }
    }

    // filter: tags (any match via &&)
    if let Some(tags) = filters.get("tags").and_then(|v| v.as_array()) {
        let vals: Vec<String> = tags.iter()
            .filter_map(|s| s.as_str().map(String::from))
            .collect();
        if !vals.is_empty() {
            qb.push(" AND i.tags && ");
            qb.push_bind(vals);
        }
    }

    // filter: due_before
    if let Some(due_str) = filters.get("due_before").and_then(|v| v.as_str()) {
        if let Ok(due_date) = chrono::NaiveDate::parse_from_str(due_str, "%Y-%m-%d") {
            qb.push(" AND i.due_date < ");
            qb.push_bind(due_date);
        }
    }

    // filter: is_overdue
    if let Some(true) = filters.get("is_overdue").and_then(|v| v.as_bool()) {
        qb.push(" AND i.due_date < CURRENT_DATE AND i.status NOT IN ('done', 'cancelled')");
    }

    // Scope to view's project if set
    if let Some(project_id) = view.project_id {
        qb.push(" AND i.project_id = ");
        qb.push_bind(project_id);
    }

    qb.push(" ORDER BY i.created_at DESC LIMIT 500");

    let issues = qb
        .build_query_as::<Issue>()
        .fetch_all(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(issues)))
}
