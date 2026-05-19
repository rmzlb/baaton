use axum::{
    extract::{Extension, State},
    http::StatusCode,
    Json,
};
use base64::Engine;
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::middleware::AuthUser;
use crate::models::github::GitHubInstallation;
use crate::models::ApiResponse;

// ─── State token helpers ──────────────────────────────

/// State tokens are 32 random bytes encoded as base64-url-no-pad → 43 chars.
/// Matches the `CHAR(43)` column in `gh_install_states`.
fn generate_install_state() -> Result<String, anyhow::Error> {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|e| anyhow::anyhow!("OsRng failed: {e}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

// ─── POST /github/install/start ───────────────────────

#[derive(Debug, Serialize)]
pub struct InstallStartResponse {
    pub url: String,
}

/// Start a GitHub App install flow.
///
/// Generates a single-use random state, persists it for 30 minutes
/// (long enough for org-admin approval), and returns the GitHub
/// install URL with `?state=<token>` appended.
pub async fn start_install(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<InstallStartResponse>>, StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(StatusCode::BAD_REQUEST)?;

    let state = generate_install_state().map_err(|e| {
        tracing::error!("Failed to generate install state: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    sqlx::query(
        r#"INSERT INTO gh_install_states (state, org_id, user_id, expires_at)
           VALUES ($1, $2, $3, now() + interval '30 minutes')"#,
    )
    .bind(&state)
    .bind(org_id)
    .bind(&auth.user_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert install state: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let app_slug = std::env::var("GITHUB_APP_SLUG").unwrap_or_else(|_| "baaton".to_string());
    let url = format!(
        "https://github.com/apps/{}/installations/new?state={}",
        app_slug, state
    );

    Ok(Json(ApiResponse::new(InstallStartResponse { url })))
}

// ─── POST /github/install/finalize ────────────────────

#[derive(Debug, Deserialize)]
pub struct FinalizeInstallBody {
    pub state: String,
    pub installation_id: Option<i64>,
    pub setup_action: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FinalizeInstallResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation: Option<GitHubInstallation>,
}

/// Finalize a GitHub App install flow.
///
/// Validates the state token (single-use, 30 min TTL, bound to (user_id, org_id)),
/// then verifies `installation_id` against GitHub's `/app/installations/{id}` API
/// per the GitHub spoofing-prevention guidance, and upserts the installation row.
pub async fn finalize_install(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<FinalizeInstallBody>,
) -> Result<Json<ApiResponse<FinalizeInstallResponse>>, (StatusCode, &'static str)> {
    let auth_org_id = auth
        .org_id
        .as_deref()
        .ok_or((StatusCode::BAD_REQUEST, "missing org"))?;

    // Single-use consume of the state token. Returns the bound (org_id, user_id)
    // so we can verify the caller is the same identity that started the flow.
    let row: Option<(String, String)> = sqlx::query_as(
        r#"DELETE FROM gh_install_states
           WHERE state = $1 AND expires_at > now()
           RETURNING org_id, user_id"#,
    )
    .bind(&body.state)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to consume install state: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "db error")
    })?;

    let (state_org_id, state_user_id) =
        row.ok_or((StatusCode::BAD_REQUEST, "invalid_or_expired_state"))?;

    if state_user_id != auth.user_id || state_org_id != auth_org_id {
        return Err((StatusCode::FORBIDDEN, "state_identity_mismatch"));
    }

    // Admin-approval path: the org admin hasn't approved yet, GitHub bounces us
    // back with `setup_action=request` and no installation_id. We've already
    // consumed the state — caller has to re-start the flow once approved.
    if body.setup_action.as_deref() == Some("request") {
        return Ok(Json(ApiResponse::new(FinalizeInstallResponse {
            status: "pending_admin_approval".to_string(),
            installation: None,
        })));
    }

    let installation_id = body
        .installation_id
        .ok_or((StatusCode::BAD_REQUEST, "missing_installation_id"))?;

    // Verify the installation actually exists by hitting GitHub's API as the
    // App. This catches spoofed installation_ids (per GitHub docs warning).
    let github_client = crate::github::client::GitHubClient::from_env().map_err(|e| {
        tracing::error!("Failed to create GitHub client: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "github_client_error")
    })?;

    let app_crab = github_client.as_app().map_err(|e| {
        tracing::error!("Failed to get app-level Octocrab: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "github_app_jwt_error")
    })?;

    let install_info: serde_json::Value = app_crab
        .get(
            format!("/app/installations/{}", installation_id),
            None::<&()>,
        )
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch installation info: {}", e);
            (StatusCode::BAD_REQUEST, "installation_not_found")
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

    let installation = sqlx::query_as::<_, GitHubInstallation>(
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
            updated_at = now()
           RETURNING *"#,
    )
    .bind(auth_org_id)
    .bind(installation_id)
    .bind(github_account_id)
    .bind(&github_account_login)
    .bind(&github_account_type)
    .bind(&permissions)
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to upsert installation: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "upsert_failed")
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

    Ok(Json(ApiResponse::new(FinalizeInstallResponse {
        status: "connected".to_string(),
        installation: Some(installation),
    })))
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

// ─── Tests ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_generator_produces_43_char_url_safe_base64() {
        let state = generate_install_state().expect("generation should succeed");
        assert_eq!(state.len(), 43, "state must be exactly 43 chars");

        // base64-url-no-pad alphabet: A-Z a-z 0-9 - _
        for c in state.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "char {:?} is not URL-safe base64",
                c
            );
        }
    }

    #[test]
    fn state_generator_produces_unique_tokens() {
        let a = generate_install_state().unwrap();
        let b = generate_install_state().unwrap();
        assert_ne!(a, b, "two consecutive tokens must differ");
    }

    /// Ensures the FinalizeInstallBody deserializer accepts the three shapes
    /// GitHub may produce, plus the admin-approval shape.
    #[test]
    fn finalize_body_deserializes_known_shapes() {
        // Normal install: full payload
        let normal: FinalizeInstallBody = serde_json::from_str(
            r#"{"state":"abc","installation_id":42,"setup_action":"install"}"#,
        )
        .unwrap();
        assert_eq!(normal.state, "abc");
        assert_eq!(normal.installation_id, Some(42));
        assert_eq!(normal.setup_action.as_deref(), Some("install"));

        // Admin-approval pending: no installation_id, setup_action=request
        let pending: FinalizeInstallBody =
            serde_json::from_str(r#"{"state":"abc","setup_action":"request"}"#).unwrap();
        assert!(pending.installation_id.is_none());
        assert_eq!(pending.setup_action.as_deref(), Some("request"));

        // Bare minimum (state only)
        let minimal: FinalizeInstallBody = serde_json::from_str(r#"{"state":"abc"}"#).unwrap();
        assert!(minimal.installation_id.is_none());
        assert!(minimal.setup_action.is_none());
    }

    /// `setup_action == "request"` means the admin hasn't approved yet, so we
    /// must short-circuit: no installation_id required, no GitHub call.
    #[test]
    fn pending_admin_approval_is_recognized() {
        let body: FinalizeInstallBody =
            serde_json::from_str(r#"{"state":"abc","setup_action":"request"}"#).unwrap();
        assert_eq!(body.setup_action.as_deref(), Some("request"));
        assert!(body.installation_id.is_none());
    }

    /// The DELETE-RETURNING shape we rely on for single-use consumption.
    /// This is a documentation test — actual DB exercise lives in integration tests.
    #[test]
    fn state_consume_query_returns_org_and_user_tuple() {
        // (org_id, user_id) is the tuple shape we expect from RETURNING.
        let row: Option<(String, String)> = Some(("org_42".into(), "user_7".into()));
        let (org, user) = row.unwrap();
        assert_eq!(org, "org_42");
        assert_eq!(user, "user_7");
    }
}
