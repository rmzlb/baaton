use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, CreateProject, Project};

/// List projects — filtered by the user's current org_id if available.
/// If no org_id in token (no active org selected), return ALL projects accessible to user.
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Json<ApiResponse<Vec<Project>>> {
    let projects = if let Some(ref org_id) = auth.org_id {
        // User has an active org selected → filter by org
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at DESC"
        )
        .bind(org_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    } else {
        // No active org → return empty (frontend should auto-select org)
        vec![]
    };

    Json(ApiResponse::new(projects))
}

/// Create a project — assigns to the user's current org.
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateProject>,
) -> Result<Json<ApiResponse<Project>>, (StatusCode, Json<serde_json::Value>)> {
    let effective_org = match &auth.org_id {
        Some(id) => id.clone(),
        None => return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Must have active organization"})))),
    };

    // Input validation
    if body.name.trim().is_empty() || body.name.len() > 200 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Project name is required and must be under 200 characters"}))));
    }
    // Slug: non-empty, max 100 chars, alphanumeric + dash only
    if body.slug.trim().is_empty()
        || body.slug.len() > 100
        || !body.slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid slug format"}))));
    }
    if body.prefix.trim().is_empty() || body.prefix.len() > 10 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Prefix is required and must be under 10 characters"}))));
    }

    // Ensure the org exists in the organizations table (upsert)
    let _ = sqlx::query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING"
    )
    .bind(&effective_org)
    .execute(&pool)
    .await;

    let project = sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (org_id, name, slug, description, prefix)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(&effective_org)
    .bind(&body.name)
    .bind(&body.slug)
    .bind(&body.description)
    .bind(&body.prefix)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(project)))
}

/// Get one project — must belong to user's active org.
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Project>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    }
}

/// Update a project — must belong to user's active org.
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<Project>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let project = sqlx::query_as::<_, Project>(
        r#"UPDATE projects SET name = COALESCE($3, name), description = COALESCE($4, description)
           WHERE id = $1 AND org_id = $2 RETURNING *"#,
    )
    .bind(id).bind(org_id)
    .bind(body.get("name").and_then(|v| v.as_str()))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    }
}

/// Delete a project — must belong to user's active org.
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query("DELETE FROM projects WHERE id = $1 AND org_id = $2")
        .bind(id).bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))
    }
}
