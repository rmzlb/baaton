use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{
    ApiResponse, CreateProject, Project, ProjectAutoAssignSettings, UpdateProjectAutoAssignSettings,
};

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
        .unwrap_or_else(|e| {
            tracing::error!(
                user_id = %auth.user_id,
                org_id = ?auth.org_id,
                error = %e,
                "projects.list query failed"
            );
            vec![]
        })
    } else {
        // No active org → return empty (frontend should auto-select org)
        vec![]
    };

    tracing::info!(
        user_id = %auth.user_id,
        org_id = ?auth.org_id,
        project_count = projects.len(),
        "projects.list"
    );

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

    let auto_assign_mode = body.auto_assign_mode.as_deref().unwrap_or("off");
    if !matches!(auto_assign_mode, "off" | "default_assignee" | "round_robin") {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid auto_assign_mode"}))));
    }

    let project = sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (org_id, name, slug, description, prefix, auto_assign_mode, default_assignee_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        "#,
    )
    .bind(&effective_org)
    .bind(&body.name)
    .bind(&body.slug)
    .bind(&body.description)
    .bind(&body.prefix)
    .bind(auto_assign_mode)
    .bind(&body.default_assignee_id)
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

    let auto_assign_mode = body.get("auto_assign_mode").and_then(|v| v.as_str());
    if let Some(mode) = auto_assign_mode {
        if !matches!(mode, "off" | "default_assignee" | "round_robin") {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid auto_assign_mode"}))));
        }
    }

    let project = sqlx::query_as::<_, Project>(
        r#"UPDATE projects
           SET name = COALESCE($3, name),
               description = COALESCE($4, description),
               auto_assign_mode = COALESCE($5, auto_assign_mode),
               default_assignee_id = CASE WHEN $6::boolean THEN $7 ELSE default_assignee_id END
           WHERE id = $1 AND org_id = $2
           RETURNING *"#,
    )
    .bind(id).bind(org_id)
    .bind(body.get("name").and_then(|v| v.as_str()))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .bind(auto_assign_mode)
    .bind(body.get("default_assignee_id").is_some())
    .bind(body.get("default_assignee_id").and_then(|v| v.as_str()))
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    }
}

#[derive(Debug, Serialize)]
pub struct PublicSubmitSettings {
    pub enabled: bool,
    pub token: Option<String>,
    pub slug: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePublicSubmitSettings {
    pub enabled: Option<bool>,
    pub rotate_token: Option<bool>,
}

/// Get public submit settings for a project
pub async fn get_public_submit_settings(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<PublicSubmitSettings>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let row = sqlx::query_as::<_, (bool, Option<String>, String)>(
        "SELECT public_submit_enabled, public_submit_token, slug FROM projects WHERE id = $1 AND org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match row {
        Some((enabled, token, slug)) => Ok(Json(ApiResponse::new(PublicSubmitSettings { enabled, token, slug }))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    }
}

/// Update public submit settings (enable/disable + rotate token)
pub async fn update_public_submit_settings(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePublicSubmitSettings>,
) -> Result<Json<ApiResponse<PublicSubmitSettings>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let current = sqlx::query_as::<_, (bool, Option<String>, String)>(
        "SELECT public_submit_enabled, public_submit_token, slug FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (current_enabled, current_token, _slug) = match current {
        Some(row) => row,
        None => return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    };

    let enabled = body.enabled.unwrap_or(current_enabled);
    let rotate = body.rotate_token.unwrap_or(false);

    let token = if rotate || (enabled && current_token.is_none()) {
        Some(Uuid::new_v4().to_string())
    } else {
        current_token
    };

    let updated = sqlx::query_as::<_, (bool, Option<String>, String)>(
        "UPDATE projects SET public_submit_enabled = $3, public_submit_token = $4 WHERE id = $1 AND org_id = $2 RETURNING public_submit_enabled, public_submit_token, slug",
    )
    .bind(id)
    .bind(org_id)
    .bind(enabled)
    .bind(&token)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(PublicSubmitSettings { enabled: updated.0, token: updated.1, slug: updated.2 })))
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

pub async fn get_auto_assign_settings(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ProjectAutoAssignSettings>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let settings = sqlx::query_as::<_, ProjectAutoAssignSettings>(
        r#"
        SELECT id AS project_id, auto_assign_mode, default_assignee_id
        FROM projects
        WHERE id = $1 AND org_id = $2
        "#,
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match settings {
        Some(s) => Ok(Json(ApiResponse::new(s))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    }
}

pub async fn update_auto_assign_settings(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProjectAutoAssignSettings>,
) -> Result<Json<ApiResponse<ProjectAutoAssignSettings>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !matches!(body.auto_assign_mode.as_str(), "off" | "default_assignee" | "round_robin") {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid auto_assign_mode"}))));
    }

    let settings = sqlx::query_as::<_, ProjectAutoAssignSettings>(
        r#"
        UPDATE projects
        SET auto_assign_mode = $3,
            default_assignee_id = $4
        WHERE id = $1 AND org_id = $2
        RETURNING id AS project_id, auto_assign_mode, default_assignee_id
        "#,
    )
    .bind(id)
    .bind(org_id)
    .bind(&body.auto_assign_mode)
    .bind(&body.default_assignee_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match settings {
        Some(s) => Ok(Json(ApiResponse::new(s))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"})))),
    }
}
