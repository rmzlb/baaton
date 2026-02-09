use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::github::{
    CreateRepoMapping, GitHubRepoMapping, GitHubRepository, IssueGitHubData, UpdateRepoMapping,
    GitHubIssueLink, GitHubPrLink, GitHubCommitLink,
};
use crate::models::ApiResponse;

// ─── List Available Repos ─────────────────────────────

/// GET /github/repos
///
/// List all repositories accessible via the org's GitHub installation.
pub async fn list_available(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<GitHubRepository>>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let repos = sqlx::query_as::<_, GitHubRepository>(
        r#"SELECT gr.* FROM github_repositories gr
           JOIN github_installations gi ON gi.installation_id = gr.installation_id
           WHERE gi.org_id = $1 AND gi.status = 'active'
           ORDER BY gr.full_name ASC"#,
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list repos: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ApiResponse::new(repos)))
}

// ─── List Mappings ────────────────────────────────────

/// GET /github/mappings
///
/// List all repo ↔ project mappings for the org.
pub async fn list_mappings(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<GitHubRepoMapping>>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let mappings = sqlx::query_as::<_, GitHubRepoMapping>(
        r#"SELECT grm.* FROM github_repo_mappings grm
           JOIN projects p ON p.id = grm.project_id
           WHERE p.org_id = $1
           ORDER BY grm.created_at DESC"#,
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list mappings: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ApiResponse::new(mappings)))
}

// ─── Create Mapping ───────────────────────────────────

/// POST /github/mappings
///
/// Create a new repo ↔ project mapping.
/// Validates that the project belongs to the current org and
/// the repo belongs to the org's installation.
pub async fn create_mapping(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateRepoMapping>,
) -> Result<Json<ApiResponse<GitHubRepoMapping>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    // Verify project belongs to org
    let project_exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM projects WHERE id = $1 AND org_id = $2",
    )
    .bind(body.project_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if project_exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    // Verify repo belongs to org's installation
    let repo_exists: Option<(i64,)> = sqlx::query_as(
        r#"SELECT gr.github_repo_id FROM github_repositories gr
           JOIN github_installations gi ON gi.installation_id = gr.installation_id
           WHERE gr.github_repo_id = $1 AND gi.org_id = $2 AND gi.status = 'active'"#,
    )
    .bind(body.github_repo_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if repo_exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let sync_direction = body.sync_direction.as_deref().unwrap_or("bidirectional");
    let status_mapping = body.status_mapping.clone().unwrap_or_else(|| {
        serde_json::json!({
            "issue_opened": "todo",
            "issue_closed": "done",
            "pr_opened": "in_progress",
            "pr_merged": "done",
            "pr_closed": null
        })
    });

    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        r#"INSERT INTO github_repo_mappings
           (project_id, github_repo_id, sync_direction,
            sync_issues, sync_prs, sync_comments, auto_create_issues, status_mapping)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *"#,
    )
    .bind(body.project_id)
    .bind(body.github_repo_id)
    .bind(sync_direction)
    .bind(body.sync_issues.unwrap_or(true))
    .bind(body.sync_prs.unwrap_or(true))
    .bind(body.sync_comments.unwrap_or(true))
    .bind(body.auto_create_issues.unwrap_or(false))
    .bind(&status_mapping)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create mapping: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ApiResponse::new(mapping)))
}

// ─── Update Mapping ───────────────────────────────────

/// PATCH /github/mappings/{id}
pub async fn update_mapping(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRepoMapping>,
) -> Result<Json<ApiResponse<GitHubRepoMapping>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    // Verify mapping belongs to org
    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        r#"SELECT grm.* FROM github_repo_mappings grm
           JOIN projects p ON p.id = grm.project_id
           WHERE grm.id = $1 AND p.org_id = $2"#,
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if mapping.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let updated = sqlx::query_as::<_, GitHubRepoMapping>(
        r#"UPDATE github_repo_mappings SET
            sync_direction = COALESCE($2, sync_direction),
            sync_issues = COALESCE($3, sync_issues),
            sync_prs = COALESCE($4, sync_prs),
            sync_comments = COALESCE($5, sync_comments),
            auto_create_issues = COALESCE($6, auto_create_issues),
            status_mapping = COALESCE($7, status_mapping),
            is_active = COALESCE($8, is_active),
            updated_at = now()
           WHERE id = $1
           RETURNING *"#,
    )
    .bind(id)
    .bind(&body.sync_direction)
    .bind(body.sync_issues)
    .bind(body.sync_prs)
    .bind(body.sync_comments)
    .bind(body.auto_create_issues)
    .bind(&body.status_mapping)
    .bind(body.is_active)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update mapping: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ApiResponse::new(updated)))
}

// ─── Delete Mapping ───────────────────────────────────

/// DELETE /github/mappings/{id}
pub async fn delete_mapping(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let result = sqlx::query(
        r#"DELETE FROM github_repo_mappings
           WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE org_id = $2)"#,
    )
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete mapping: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(ApiResponse::new(())))
}

// ─── Get Issue GitHub Data ────────────────────────────

/// GET /issues/{id}/github
///
/// Returns all GitHub-linked data for a single issue:
/// linked GitHub issue, PRs, commits, and a suggested branch name.
pub async fn get_issue_github_data(
    Extension(_auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<IssueGitHubData>>, StatusCode> {
    // Fetch the issue to generate branch name
    let issue: Option<(String, String)> = sqlx::query_as(
        "SELECT display_id, title FROM issues WHERE id = $1",
    )
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (display_id, title) = match issue {
        Some(i) => i,
        None => return Err(StatusCode::NOT_FOUND),
    };

    let github_issue = sqlx::query_as::<_, GitHubIssueLink>(
        "SELECT * FROM github_issue_links WHERE issue_id = $1",
    )
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let pull_requests = sqlx::query_as::<_, GitHubPrLink>(
        "SELECT * FROM github_pr_links WHERE issue_id = $1 ORDER BY created_at DESC",
    )
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let commits = sqlx::query_as::<_, GitHubCommitLink>(
        "SELECT * FROM github_commit_links WHERE issue_id = $1 ORDER BY committed_at DESC LIMIT 20",
    )
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let branch_name = crate::github::issue_linker::generate_branch_name(&display_id, &title);

    Ok(Json(ApiResponse::new(IssueGitHubData {
        github_issue,
        pull_requests,
        commits,
        branch_name,
    })))
}
