//! Share links for issues and projects.
//!
//! Two capabilities, deliberately separate from the existing public-submit
//! token (which grants *write* to a form) and from run cards (which are minted
//! automatically on completion):
//!
//!   * `POST   /issues/{id}/share`   -> mint or rotate, returns the URL
//!   * `DELETE /issues/{id}/share`   -> revoke (drops the token, not just a flag)
//!   * same pair for `/projects/{id}/share`
//!   * `GET /public/issues/{token}`  -> read-only JSON, no auth
//!
//! Revocation drops the token instead of flipping a boolean. A disabled flag
//! with a live token in the row is the classic "we un-shared it" bug where the
//! old URL keeps working; migration 072 makes that state impossible with a
//! CHECK, and this module never tries to preserve a token across a revoke. The
//! consequence is intentional and documented in the response: re-sharing yields
//! a *new* URL, so a leaked link cannot be resurrected.
//!
//! Every mint and every revoke writes an activity row. "Who made this
//! customer-visible, and when" is the first question after an accidental
//! disclosure, and it is unanswerable after the fact if only the current state
//! is stored.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use ulid::Ulid;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;
use crate::routes::activity::log_activity_as;

/// ULID, like run cards: sortable, URL-safe, 26 chars, no ambiguous glyphs.
/// Not a UUID — these end up in pasted links and get read aloud.
fn new_token() -> String {
    Ulid::new().to_string()
}

fn share_origin() -> String {
    std::env::var("SHARE_ORIGIN")
        .or_else(|_| std::env::var("PUBLIC_RUN_ORIGIN"))
        .unwrap_or_else(|_| "https://baaton.dev".into())
}

#[derive(Debug, Serialize)]
pub struct ShareState {
    pub is_public: bool,
    /// Absolute URL, ready to paste. Callers should not have to know the route
    /// shape or which host serves previews.
    pub url: Option<String>,
    pub token: Option<String>,
    /// The card a chat client will render for this URL. Exposed so the UI can
    /// show the actual preview before the user sends the link.
    pub preview_image: Option<String>,
    pub shared_at: Option<DateTime<Utc>>,
    pub shared_by: Option<String>,
}

impl ShareState {
    fn private() -> Self {
        Self {
            is_public: false,
            url: None,
            token: None,
            preview_image: None,
            shared_at: None,
            shared_by: None,
        }
    }

    fn public(kind: Kind, token: String, at: Option<DateTime<Utc>>, by: Option<String>) -> Self {
        let api = std::env::var("API_URL").unwrap_or_else(|_| "https://api.baaton.dev".into());
        Self {
            is_public: true,
            url: Some(format!("{}/{}/{}", share_origin(), kind.path(), token)),
            preview_image: Some(format!("{}/api/v1/public/og/{}/{}", api, kind.og(), token)),
            token: Some(token),
            shared_at: at,
            shared_by: by,
        }
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Issue,
    Project,
}

impl Kind {
    fn path(self) -> &'static str {
        match self {
            Kind::Issue => "i",
            Kind::Project => "p",
        }
    }
    fn og(self) -> &'static str {
        match self {
            Kind::Issue => "issue",
            Kind::Project => "project",
        }
    }
}

type ApiErr = (StatusCode, Json<serde_json::Value>);

fn internal(e: impl std::fmt::Display) -> ApiErr {
    tracing::error!(error = %e, "share link error");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "Internal server error"})),
    )
}

fn not_found(what: &str) -> ApiErr {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error": format!("{what} not found")})),
    )
}

/// Org scope for the caller. API keys carry their own scope (possibly
/// `all_dynamic`); humans get their current org. Sharing is a per-object
/// authority check, so a single org id is enough here — cross-org browsing is a
/// read concern, not a publish concern.
fn caller_org(auth: &AuthUser) -> Result<Vec<String>, ApiErr> {
    let current = auth.org_id.as_deref().ok_or((
        StatusCode::BAD_REQUEST,
        Json(json!({"error": "Organization required"})),
    ))?;
    if auth.is_api_key() && !auth.scoped_org_ids.is_empty() {
        return Ok(auth.scoped_org_ids.clone());
    }
    Ok(vec![current.to_string()])
}

/* ─────────────── issue ─────────────── */

pub async fn get_issue_share(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ShareState>>, ApiErr> {
    let orgs = caller_org(&auth)?;
    let row = sqlx::query_as::<_, (bool, Option<String>, Option<DateTime<Utc>>, Option<String>)>(
        r#"
        SELECT i.is_public, i.public_token, i.shared_at, i.shared_by
        FROM issues i JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1 AND p.org_id = ANY($2)
        "#,
    )
    .bind(id)
    .bind(&orgs)
    .fetch_optional(&pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found("Issue"))?;

    Ok(Json(ApiResponse::new(state_from(Kind::Issue, row))))
}

pub async fn share_issue(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ShareState>>, ApiErr> {
    let orgs = caller_org(&auth)?;

    // Resolve org/project first: needed for the activity row, and it doubles as
    // the authorization check.
    let (org_id, project_id, existing): (String, Uuid, Option<String>) =
        sqlx::query_as::<_, (String, Uuid, Option<String>)>(
            r#"
        SELECT p.org_id, i.project_id, i.public_token
        FROM issues i JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1 AND p.org_id = ANY($2)
        "#,
        )
        .bind(id)
        .bind(&orgs)
        .fetch_optional(&pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| not_found("Issue"))?;

    // Idempotent: sharing an already-shared issue returns the same URL rather
    // than rotating it. Otherwise a UI that calls this on every dialog open
    // would silently break links people already sent.
    let token = existing.unwrap_or_else(new_token);

    let row = sqlx::query_as::<_, (bool, Option<String>, Option<DateTime<Utc>>, Option<String>)>(
        r#"
        UPDATE issues
           SET is_public = TRUE,
               public_token = $2,
               shared_at = COALESCE(shared_at, now()),
               shared_by = COALESCE(shared_by, $3)
         WHERE id = $1
        RETURNING is_public, public_token, shared_at, shared_by
        "#,
    )
    .bind(id)
    .bind(&token)
    .bind(auth.responsible_user_id())
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    log_activity_as(
        &pool,
        &auth,
        &org_id,
        Some(project_id),
        Some(id),
        "issue_shared",
        Some("is_public"),
        Some("false"),
        Some("true"),
        None,
    )
    .await;

    Ok(Json(ApiResponse::new(state_from(Kind::Issue, row))))
}

pub async fn unshare_issue(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ShareState>>, ApiErr> {
    let orgs = caller_org(&auth)?;

    let (org_id, project_id): (String, Uuid) = sqlx::query_as::<_, (String, Uuid)>(
        r#"
        SELECT p.org_id, i.project_id
        FROM issues i JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1 AND p.org_id = ANY($2)
        "#,
    )
    .bind(id)
    .bind(&orgs)
    .fetch_optional(&pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found("Issue"))?;

    // Token goes to NULL, not just the flag: the old URL must die here.
    sqlx::query(
        r#"
        UPDATE issues
           SET is_public = FALSE, public_token = NULL, shared_at = NULL, shared_by = NULL
         WHERE id = $1
        "#,
    )
    .bind(id)
    .execute(&pool)
    .await
    .map_err(internal)?;

    log_activity_as(
        &pool,
        &auth,
        &org_id,
        Some(project_id),
        Some(id),
        "issue_unshared",
        Some("is_public"),
        Some("true"),
        Some("false"),
        None,
    )
    .await;

    Ok(Json(ApiResponse::new(ShareState::private())))
}

/* ─────────────── project ─────────────── */

pub async fn get_project_share(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ShareState>>, ApiErr> {
    let orgs = caller_org(&auth)?;
    let row = sqlx::query_as::<_, (bool, Option<String>, Option<DateTime<Utc>>, Option<String>)>(
        "SELECT is_public, public_token, shared_at, shared_by FROM projects WHERE id = $1 AND org_id = ANY($2)",
    )
    .bind(id)
    .bind(&orgs)
    .fetch_optional(&pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| not_found("Project"))?;

    Ok(Json(ApiResponse::new(state_from(Kind::Project, row))))
}

pub async fn share_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ShareState>>, ApiErr> {
    let orgs = caller_org(&auth)?;

    let (org_id, existing): (String, Option<String>) =
        sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT org_id, public_token FROM projects WHERE id = $1 AND org_id = ANY($2)",
        )
        .bind(id)
        .bind(&orgs)
        .fetch_optional(&pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| not_found("Project"))?;

    let token = existing.unwrap_or_else(new_token);

    let row = sqlx::query_as::<_, (bool, Option<String>, Option<DateTime<Utc>>, Option<String>)>(
        r#"
        UPDATE projects
           SET is_public = TRUE,
               public_token = $2,
               shared_at = COALESCE(shared_at, now()),
               shared_by = COALESCE(shared_by, $3)
         WHERE id = $1
        RETURNING is_public, public_token, shared_at, shared_by
        "#,
    )
    .bind(id)
    .bind(&token)
    .bind(auth.responsible_user_id())
    .fetch_one(&pool)
    .await
    .map_err(internal)?;

    log_activity_as(
        &pool,
        &auth,
        &org_id,
        Some(id),
        None,
        "project_shared",
        Some("is_public"),
        Some("false"),
        Some("true"),
        None,
    )
    .await;

    Ok(Json(ApiResponse::new(state_from(Kind::Project, row))))
}

pub async fn unshare_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<ShareState>>, ApiErr> {
    let orgs = caller_org(&auth)?;

    let org_id: String =
        sqlx::query_scalar("SELECT org_id FROM projects WHERE id = $1 AND org_id = ANY($2)")
            .bind(id)
            .bind(&orgs)
            .fetch_optional(&pool)
            .await
            .map_err(internal)?
            .ok_or_else(|| not_found("Project"))?;

    sqlx::query(
        "UPDATE projects SET is_public = FALSE, public_token = NULL, shared_at = NULL, shared_by = NULL WHERE id = $1",
    )
    .bind(id)
    .execute(&pool)
    .await
    .map_err(internal)?;

    log_activity_as(
        &pool,
        &auth,
        &org_id,
        Some(id),
        None,
        "project_unshared",
        Some("is_public"),
        Some("true"),
        Some("false"),
        None,
    )
    .await;

    Ok(Json(ApiResponse::new(ShareState::private())))
}

fn state_from(
    kind: Kind,
    row: (bool, Option<String>, Option<DateTime<Utc>>, Option<String>),
) -> ShareState {
    match (row.0, row.1) {
        (true, Some(token)) => ShareState::public(kind, token, row.2, row.3),
        _ => ShareState::private(),
    }
}

/* ─────────────── public read ─────────────── */

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PublicIssue {
    pub display_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub status_label: Option<String>,
    pub priority: Option<String>,
    #[sqlx(rename = "type")]
    pub issue_type: String,
    pub project_name: String,
    pub reporter_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// JSON twin of the SSR page, so an agent handed a shared link can read it
/// without org credentials. Same column set as the HTML: no comments, no
/// internal history, no ids that would let a stranger walk the org.
pub async fn get_public_issue(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> Result<Json<ApiResponse<PublicIssue>>, ApiErr> {
    let row = sqlx::query_as::<_, PublicIssue>(
        r#"
        SELECT
            i.display_id, i.title, i.description, i.status, i.status_label,
            i.priority, i.type, p.name AS project_name, i.reporter_name,
            i.created_at, i.updated_at
        FROM issues i JOIN projects p ON p.id = i.project_id
        WHERE i.public_token = $1 AND i.is_public = TRUE
        "#,
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "This link is private or has expired"})),
        )
    })?;

    Ok(Json(ApiResponse::new(row)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_state_builds_a_pasteable_url_and_its_preview() {
        std::env::set_var("SHARE_ORIGIN", "https://baaton.dev");
        std::env::set_var("API_URL", "https://api.baaton.dev");
        let s = ShareState::public(Kind::Issue, "01HX".into(), None, None);
        assert_eq!(s.url.as_deref(), Some("https://baaton.dev/i/01HX"));
        assert_eq!(
            s.preview_image.as_deref(),
            Some("https://api.baaton.dev/api/v1/public/og/issue/01HX")
        );
    }

    #[test]
    fn project_urls_use_their_own_prefix() {
        std::env::set_var("SHARE_ORIGIN", "https://baaton.dev");
        let s = ShareState::public(Kind::Project, "01HP".into(), None, None);
        assert_eq!(s.url.as_deref(), Some("https://baaton.dev/p/01HP"));
    }

    #[test]
    fn a_row_with_a_token_but_public_false_reads_as_private() {
        // Migration 072 forbids this state; if it ever appears, never hand out
        // a URL for it.
        let s = state_from(Kind::Issue, (false, Some("01HX".into()), None, None));
        assert!(!s.is_public);
        assert!(s.url.is_none());
        assert!(s.token.is_none());
    }

    #[test]
    fn tokens_are_unique_and_url_safe() {
        let a = new_token();
        let b = new_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 26);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
