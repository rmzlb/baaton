use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::middleware::AuthUser;
use crate::models::github::GitHubInstallation;
use crate::models::ApiResponse;

// ─── Install Redirect ─────────────────────────────────

/// GET /github/install
///
/// Redirects the user to GitHub's App installation page.
/// After the user installs/configures, GitHub redirects back to `/github/callback`.
pub async fn install_redirect(
    Extension(auth): Extension<AuthUser>,
) -> Result<Response, StatusCode> {
    let _org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let app_slug = std::env::var("GITHUB_APP_SLUG")
        .unwrap_or_else(|_| "baaton".to_string());

    let url = format!("https://github.com/apps/{}/installations/new", app_slug);
    Ok(Redirect::temporary(&url).into_response())
}

// ─── OAuth Callback ───────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CallbackParams {
    pub installation_id: Option<i64>,
    pub setup_action: Option<String>,
    /// state parameter we'll use to pass the org_id through the OAuth round-trip
    pub state: Option<String>,
}

/// GET /github/callback
///
/// GitHub redirects here after the user installs or updates the App.
/// We record the installation and redirect back to the frontend settings page.
pub async fn callback(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<CallbackParams>,
) -> Result<Response, StatusCode> {
    let org_id = auth
        .org_id
        .as_deref()
        .ok_or(StatusCode::BAD_REQUEST)?
        .to_string();

    let installation_id = params.installation_id.ok_or(StatusCode::BAD_REQUEST)?;

    // Fetch installation details from GitHub API
    let github_client = crate::github::client::GitHubClient::from_env()
        .map_err(|e| {
            tracing::error!("Failed to create GitHub client: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let app_crab = github_client.as_app().map_err(|e| {
        tracing::error!("Failed to get app-level Octocrab: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // GET /app/installations/{installation_id}
    let install_info: serde_json::Value = app_crab
        .get(
            format!("/app/installations/{}", installation_id),
            None::<&()>,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch installation info: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let account = &install_info["account"];
    let github_account_id = account["id"].as_i64().unwrap_or(0);
    let github_account_login = account["login"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let github_account_type = account["type"]
        .as_str()
        .unwrap_or("Organization")
        .to_string();
    let permissions = install_info["permissions"].clone();

    // Upsert installation
    sqlx::query(
        r#"INSERT INTO github_installations
           (org_id, installation_id, github_account_id, github_account_login,
            github_account_type, permissions, status, installed_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
           ON CONFLICT (org_id) DO UPDATE SET
            installation_id = $2,
            github_account_id = $3,
            github_account_login = $4,
            github_account_type = $5,
            permissions = $6,
            status = 'active',
            updated_at = now()"#,
    )
    .bind(&org_id)
    .bind(installation_id)
    .bind(github_account_id)
    .bind(&github_account_login)
    .bind(&github_account_type)
    .bind(&permissions)
    .bind(&auth.user_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to upsert installation: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Sync available repos in the background
    let pool_bg = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = sync_installation_repos(&pool_bg, installation_id).await {
            tracing::error!(
                "Failed to sync repos for installation {}: {}",
                installation_id,
                e
            );
        }
    });

    let app_url =
        std::env::var("APP_URL").unwrap_or_else(|_| "https://app.baaton.dev".to_string());
    let redirect_url = format!("{}/settings/integrations?github=connected", app_url);

    Ok(Redirect::temporary(&redirect_url).into_response())
}

// ─── Get Installation ─────────────────────────────────

/// GET /github/installation
///
/// Returns the current org's GitHub installation, or null if not connected.
pub async fn get_installation(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Option<GitHubInstallation>>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let installation = sqlx::query_as::<_, GitHubInstallation>(
        "SELECT * FROM github_installations WHERE org_id = $1 AND status = 'active'",
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query installation: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ApiResponse::new(installation)))
}

// ─── Disconnect ───────────────────────────────────────

/// POST /github/disconnect
///
/// Removes the GitHub installation for the current org.
/// Does NOT delete historical data (PR links, commit links, etc.).
pub async fn disconnect(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    sqlx::query(
        "UPDATE github_installations SET status = 'removed', updated_at = now() WHERE org_id = $1",
    )
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to disconnect GitHub: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Deactivate all mappings
    sqlx::query(
        r#"UPDATE github_repo_mappings SET is_active = false, updated_at = now()
           WHERE project_id IN (SELECT id FROM projects WHERE org_id = $1)"#,
    )
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to deactivate mappings: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ApiResponse::new(())))
}

// ─── Helpers ──────────────────────────────────────────

/// Sync the list of repositories accessible to an installation and cache them.
async fn sync_installation_repos(
    pool: &PgPool,
    installation_id: i64,
) -> Result<(), anyhow::Error> {
    let gh_client = crate::github::client::GitHubClient::from_env()?;
    let crab = gh_client.for_installation(installation_id as u64).await?;

    // Paginate through all repos
    let mut page: u32 = 1;
    loop {
        let response: serde_json::Value = crab
            .get(
                format!("/installation/repositories?per_page=100&page={}", page),
                None::<&()>,
            )
            .await?;

        let repos = response["repositories"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        if repos.is_empty() {
            break;
        }

        for repo in &repos {
            let github_repo_id = repo["id"].as_i64().unwrap_or(0);
            let owner = repo["owner"]["login"].as_str().unwrap_or("").to_string();
            let name = repo["name"].as_str().unwrap_or("").to_string();
            let full_name = repo["full_name"].as_str().unwrap_or("").to_string();
            let default_branch = repo["default_branch"]
                .as_str()
                .unwrap_or("main")
                .to_string();
            let is_private = repo["private"].as_bool().unwrap_or(false);

            sqlx::query(
                r#"INSERT INTO github_repositories
                   (installation_id, github_repo_id, owner, name, full_name, default_branch, is_private)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (github_repo_id) DO UPDATE SET
                    owner = $3, name = $4, full_name = $5,
                    default_branch = $6, is_private = $7, updated_at = now()"#,
            )
            .bind(installation_id)
            .bind(github_repo_id)
            .bind(&owner)
            .bind(&name)
            .bind(&full_name)
            .bind(&default_branch)
            .bind(is_private)
            .execute(pool)
            .await?;
        }

        if repos.len() < 100 {
            break;
        }
        page += 1;
    }

    Ok(())
}
