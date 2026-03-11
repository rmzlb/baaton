use axum::{extract::{Extension, Path, Query, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{
    ApiResponse, CreateProject, Project, ProjectAutoAssignSettings, UpdateProjectAutoAssignSettings,
};

/// Parse "owner/repo" from a GitHub URL like https://github.com/owner/repo
fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let url = url.trim().trim_end_matches('/').trim_end_matches(".git");
    // Handle both https://github.com/owner/repo and github.com/owner/repo
    let path = url.strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("github.com/"))?;
    let parts: Vec<&str> = path.splitn(3, '/').collect();
    if parts.len() >= 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

/// Fetch public repo metadata from GitHub API (no auth needed for public repos)
async fn fetch_github_metadata(url: &str) -> Option<serde_json::Value> {
    let (owner, repo) = parse_github_owner_repo(url)?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("https://api.github.com/repos/{}/{}", owner, repo))
        .header("User-Agent", "Baaton/1.0")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        tracing::warn!("GitHub API returned {} for {}/{}", resp.status(), owner, repo);
        return None;
    }
    let data: serde_json::Value = resp.json().await.ok()?;
    Some(json!({
        "full_name": data.get("full_name").and_then(|v| v.as_str()),
        "description": data.get("description").and_then(|v| v.as_str()),
        "language": data.get("language").and_then(|v| v.as_str()),
        "stars": data.get("stargazers_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "forks": data.get("forks_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "open_issues": data.get("open_issues_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "default_branch": data.get("default_branch").and_then(|v| v.as_str()).unwrap_or("main"),
        "is_private": data.get("private").and_then(|v| v.as_bool()).unwrap_or(false),
        "topics": data.get("topics"),
        "updated_at": data.get("updated_at").and_then(|v| v.as_str()),
        "fetched_at": chrono::Utc::now().to_rfc3339(),
    }))
}

/// Refresh GitHub metadata for a project
pub async fn refresh_github(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Project>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let row = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT github_repo_url FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(id).bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let url = match row {
        Some((Some(u),)) if !u.is_empty() => u,
        _ => return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "No GitHub repo URL configured for this project"})))),
    };

    let metadata = fetch_github_metadata(&url).await
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, Json(json!({"error": "Failed to fetch GitHub metadata — repo may be private or not found"}))))?;

    let project = sqlx::query_as::<_, Project>(
        "UPDATE projects SET github_metadata = $3 WHERE id = $1 AND org_id = $2 RETURNING *"
    )
    .bind(id).bind(org_id).bind(&metadata)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(project)))
}

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

    // Fetch GitHub metadata if repo URL provided
    let github_metadata = if let Some(ref url) = body.github_repo_url {
        fetch_github_metadata(url).await
    } else {
        None
    };

    let project = sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (org_id, name, slug, description, prefix, auto_assign_mode, default_assignee_id, github_repo_url, github_metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
    .bind(&body.github_repo_url)
    .bind(&github_metadata)
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

    // If github_repo_url changed, re-fetch metadata
    let new_github_url = body.get("github_repo_url").and_then(|v| v.as_str());
    let github_metadata = if let Some(url) = new_github_url {
        if url.is_empty() { None } else { fetch_github_metadata(url).await }
    } else {
        None
    };

    let project = sqlx::query_as::<_, Project>(
        r#"UPDATE projects
           SET name = COALESCE($3, name),
               description = COALESCE($4, description),
               auto_assign_mode = COALESCE($5, auto_assign_mode),
               default_assignee_id = CASE WHEN $6::boolean THEN $7 ELSE default_assignee_id END,
               github_repo_url = CASE WHEN $8::boolean THEN $9 ELSE github_repo_url END,
               github_metadata = CASE WHEN $10::jsonb IS NOT NULL THEN $10 ELSE github_metadata END
           WHERE id = $1 AND org_id = $2
           RETURNING *"#,
    )
    .bind(id).bind(org_id)
    .bind(body.get("name").and_then(|v| v.as_str()))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .bind(auto_assign_mode)
    .bind(body.get("default_assignee_id").is_some())
    .bind(body.get("default_assignee_id").and_then(|v| v.as_str()))
    .bind(new_github_url.is_some())
    .bind(new_github_url)
    .bind(&github_metadata)
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

#[derive(Debug, serde::Deserialize)]
pub struct BoardParams {
    pub include_archived: Option<bool>,
    pub include_snoozed: Option<bool>,
}

/// Composite board endpoint: project + issues + tags in one request
pub async fn board_by_slug(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(slug): Path<String>,
    Query(params): Query<BoardParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let start = std::time::Instant::now();
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE slug = $1 AND org_id = $2"
    )
    .bind(&slug)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    let include_archived = params.include_archived.unwrap_or(false);
    let include_snoozed = params.include_snoozed.unwrap_or(false);

    // Fetch issues and tags in parallel
    let (issues, tags) = tokio::join!(
        sqlx::query_as::<_, crate::models::Issue>(
            r#"
            SELECT * FROM issues
            WHERE project_id = $1
              AND (archived = false OR $2::boolean)
              AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_DATE OR $3::boolean)
            ORDER BY position ASC
            "#
        )
        .bind(project.id)
        .bind(include_archived)
        .bind(include_snoozed)
        .fetch_all(&pool),
        sqlx::query_as::<_, crate::models::ProjectTag>(
            "SELECT * FROM project_tags WHERE project_id = $1 ORDER BY name ASC"
        )
        .bind(project.id)
        .fetch_all(&pool),
    );

    let issues = issues.unwrap_or_default();
    let tags = tags.unwrap_or_default();
    let elapsed = start.elapsed();

    tracing::info!(
        slug = %slug,
        issue_count = issues.len(),
        tag_count = tags.len(),
        elapsed_ms = elapsed.as_millis() as u64,
        "board_by_slug"
    );

    Ok(Json(json!({
        "data": {
            "project": project,
            "issues": issues,
            "tags": tags,
        }
    })))
}

/// Resolve a public submit token to project info (no auth — public endpoint)
pub async fn resolve_public_token(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT slug, name FROM projects WHERE public_submit_token = $1 AND public_submit_enabled = true",
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match row {
        Some((slug, name)) => Ok(Json(json!({ "slug": slug, "name": name, "token": token }))),
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Invalid or disabled public link"})))),
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
