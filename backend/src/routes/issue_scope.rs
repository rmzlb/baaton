//! Resolving which organization owns an issue, for a caller that may see several.
//!
//! A multi-org API key (`api_key_org_scopes`, or `org_scope_mode=all_dynamic`)
//! carries a *home* org in `auth.org_id` plus every org it may act on in
//! `auth.scoped_org_ids`. Checking an issue against the home org alone answers
//! "not found" for an issue the key is fully entitled to write, which is what
//! BAA-31 reported: `GET /issues/{id}`, `POST /issues/{id}/comments` and
//! `PATCH /issues/{id}` accepted a cross-org issue while
//! `POST /issues/{id}/tldr` answered 404 for the same id with the same key.
//!
//! Handlers should resolve the *owning* org from the issue and then check that
//! the caller is entitled to it, instead of assuming the home org. The owning
//! org is also what activity rows, memories and webhooks must be filed under:
//! attributing them to the key's home org would put another tenant's history in
//! the wrong org.

use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;

/// The organization and project that own an issue.
pub struct IssueScope {
    pub org_id: String,
    pub project_id: Uuid,
}

/// Outcome of resolving an issue for a caller.
pub enum IssueAccess {
    /// The issue exists and the caller may act on its org.
    Allowed(IssueScope),
    /// The issue does not exist at all.
    NotFound,
    /// The issue exists but belongs to an org outside the caller's scope.
    /// Callers answer 404 (not 403) so an out-of-scope id stays unconfirmed.
    Forbidden,
}

/// Look up the org and project owning `issue_id`, then check it against the
/// caller's scope. `scoped_org_ids` empty means "no org narrowing" and keeps the
/// legacy behaviour of trusting the home org.
pub async fn resolve(
    pool: &PgPool,
    auth: &AuthUser,
    issue_id: Uuid,
) -> Result<IssueAccess, sqlx::Error> {
    let row: Option<(String, Uuid)> = sqlx::query_as(
        "SELECT p.org_id, p.id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1",
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await?;

    let Some((org_id, project_id)) = row else {
        return Ok(IssueAccess::NotFound);
    };

    let home_org_matches = auth.org_id.as_deref() == Some(org_id.as_str());
    if home_org_matches || auth.has_org_access(&org_id) {
        return Ok(IssueAccess::Allowed(IssueScope { org_id, project_id }));
    }

    Ok(IssueAccess::Forbidden)
}
