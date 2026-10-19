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
//!
//! Widening org access is only safe if the *narrowing* scopes are enforced in
//! the same place, so `resolve` also applies `scoped_project_ids` and refuses a
//! caller with no org membership at all. `AuthUser::has_org_access` treats an
//! empty `scoped_org_ids` as "no narrowing" and returns true for every org,
//! which is correct for its callers but is not a membership proof; this module
//! must not rely on it alone.

use axum::http::StatusCode;
use axum::Json;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;

/// The error shape every issue-scoped handler already returns.
type ApiErr = (StatusCode, Json<serde_json::Value>);

/// The organization and project that own an issue.
pub struct IssueScope {
    pub org_id: String,
    pub project_id: Uuid,
}

/// Outcome of resolving an issue for a caller.
pub enum IssueAccess {
    /// The issue exists and the caller may act on its org and project.
    Allowed(IssueScope),
    /// The issue does not exist at all.
    NotFound,
    /// The issue exists but is outside the caller's org or project scope.
    /// Callers answer 404 (not 403) so an out-of-scope id stays unconfirmed.
    Forbidden,
}

/// Whether `auth` may act on an issue owned by `org_id` / `project_id`.
///
/// Split out from the query so the scope rules are unit-testable without a
/// database. Three conditions, all required:
///
/// 1. the caller has at least one org (an identity with none is not a tenant),
/// 2. the owning org is one of `scoped_org_ids`,
/// 3. the owning project passes `scoped_project_ids`.
///
/// The home org gets no shortcut: `org_id` is derived from `scoped_org_ids` for
/// keys and mirrors it for humans, so a home org outside the scoped set means
/// the two disagree, and the scoped set is the authority.
pub fn is_entitled(auth: &AuthUser, org_id: &str, project_id: Uuid) -> bool {
    if auth.scoped_org_ids.is_empty() {
        return false;
    }
    if !auth.scoped_org_ids.iter().any(|id| id == org_id) {
        return false;
    }
    auth.has_project_access(project_id)
}

/// `is_entitled`, widened for a human to every org they belong to in Clerk.
///
/// A human's JWT carries one *active* org, so `scoped_org_ids` holds only that
/// org. Reads already span every membership (`resolve_user_org_ids`), so a
/// human could open an issue of another org of theirs and then get 404 when
/// commenting on it (PHI-125). Membership of the owning org is the rule for
/// writes too.
///
/// Only humans are widened. An API key keeps the scope recorded on the key,
/// whatever its creator belongs to. Project scoping still applies.
pub fn is_entitled_as_member(
    auth: &AuthUser,
    org_id: &str,
    project_id: Uuid,
    member_org_ids: &[String],
) -> bool {
    if is_entitled(auth, org_id, project_id) {
        return true;
    }
    auth.is_human()
        && member_org_ids.iter().any(|id| id == org_id)
        && auth.has_project_access(project_id)
}

/// Whether the caller holds an admin role *in `org_id`*.
///
/// `org_role` comes from the JWT and describes the active org only. Now that a
/// human may write in another org they belong to, an admin of the active org
/// must not be treated as an admin there.
pub fn is_admin_of(auth: &AuthUser, org_id: &str) -> bool {
    auth.is_admin() && auth.org_id.as_deref() == Some(org_id)
}

/// Entitlement check used by `resolve` and `require_project`.
///
/// The Clerk lookup runs only when the synchronous rule refuses a human, and
/// goes through the 5-minute membership cache of `fetch_user_org_ids`. A failed
/// lookup refuses (fail closed).
pub(crate) async fn entitled(auth: &AuthUser, org_id: &str, project_id: Uuid) -> bool {
    if is_entitled(auth, org_id, project_id) {
        return true;
    }
    if !auth.is_human() {
        return false;
    }
    match crate::routes::issues::fetch_user_org_ids(&auth.user_id).await {
        Ok(member_org_ids) => is_entitled_as_member(auth, org_id, project_id, &member_org_ids),
        Err(e) => {
            tracing::warn!(error = %e, user_id = %auth.user_id, "membership lookup failed; cross-org access refused");
            false
        }
    }
}

/// Look up the org and project owning `issue_id`, then check them against the
/// caller's scope.
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

    if entitled(auth, &org_id, project_id).await {
        return Ok(IssueAccess::Allowed(IssueScope { org_id, project_id }));
    }

    Ok(IssueAccess::Forbidden)
}

/// `resolve`, with every refusal already mapped to the 404 handlers return.
///
/// `subject` names the thing in the error body ("Issue", "Source issue") so a
/// caller relating two issues can still say which one was rejected. Missing and
/// out-of-scope collapse to the same answer on purpose.
pub async fn require(
    pool: &PgPool,
    auth: &AuthUser,
    issue_id: Uuid,
    subject: &str,
) -> Result<IssueScope, ApiErr> {
    match resolve(pool, auth, issue_id).await {
        Ok(IssueAccess::Allowed(scope)) => Ok(scope),
        Ok(IssueAccess::NotFound) | Ok(IssueAccess::Forbidden) => Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": format!("{subject} not found")})),
        )),
        Err(e) => {
            tracing::error!(error = %e, %issue_id, "issue scope lookup failed");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            ))
        }
    }
}

/// Same entitlement check for a handler addressed by project instead of issue.
///
/// Returns the owning org so activity rows and webhooks are filed under the
/// tenant that owns the project, not the caller's home org.
pub async fn require_project(
    pool: &PgPool,
    auth: &AuthUser,
    project_id: Uuid,
) -> Result<String, ApiErr> {
    let org_id: Option<String> = sqlx::query_scalar("SELECT org_id FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, %project_id, "project scope lookup failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    match org_id {
        Some(org_id) if entitled(auth, &org_id, project_id).await => Ok(org_id),
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Project not found"})),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::ActorKind;

    const PROJ_A: Uuid = Uuid::from_u128(0xa1);
    const PROJ_B: Uuid = Uuid::from_u128(0xb2);

    fn key(home: Option<&str>, scoped_orgs: &[&str], scoped_projects: &[Uuid]) -> AuthUser {
        AuthUser {
            user_id: "apikey:5f8dc5e2-e05f-43be-9100-72b7d7b61198".to_string(),
            org_id: home.map(|o| o.to_string()),
            org_slug: None,
            org_role: None,
            email: None,
            display_name: Some("studio key".to_string()),
            scoped_org_ids: scoped_orgs.iter().map(|o| o.to_string()).collect(),
            scoped_project_ids: scoped_projects.to_vec(),
            actor_kind: ActorKind::ApiKey,
            actor_key_id: None,
            on_behalf_of: Some("user_3C6wp4YNAtiN9kxXQKY9BoifjI8".to_string()),
            permissions: vec!["issues:write".to_string()],
            legacy_full_access: false,
        }
    }

    /// BAA-31: the reported repro. A studio key entitled to the Philoe org must
    /// be able to act on a Philoe issue, even though its home org is studio.
    #[test]
    fn multi_org_key_may_act_outside_its_home_org() {
        let auth = key(Some("org_studio"), &["org_studio", "org_philoe"], &[]);
        assert!(is_entitled(&auth, "org_philoe", PROJ_A));
    }

    #[test]
    fn single_org_key_may_act_on_its_own_org() {
        let auth = key(Some("org_studio"), &["org_studio"], &[]);
        assert!(is_entitled(&auth, "org_studio", PROJ_A));
    }

    /// The fix must not become a cross-tenant hole: an org the key was never
    /// granted stays refused.
    #[test]
    fn org_outside_the_scoped_set_is_refused() {
        let auth = key(Some("org_studio"), &["org_studio", "org_philoe"], &[]);
        assert!(!is_entitled(&auth, "org_someone_else", PROJ_A));
    }

    /// An identity with no org membership is not a tenant. `has_org_access`
    /// alone would return true here, which is why it is not used on its own.
    #[test]
    fn caller_without_any_org_is_refused() {
        let auth = key(None, &[], &[]);
        assert!(!is_entitled(&auth, "org_philoe", PROJ_A));
        assert!(auth.has_org_access("org_philoe"));
    }

    /// A home org that is not in the scoped set must not grant access: the two
    /// disagree and the scoped set wins.
    #[test]
    fn stale_home_org_grants_nothing() {
        let auth = key(Some("org_stale"), &["org_studio"], &[]);
        assert!(!is_entitled(&auth, "org_stale", PROJ_A));
    }

    /// Project scoping was not enforced on this path before. A key restricted
    /// to one project must not write on another project of the same org.
    #[test]
    fn project_scoped_key_is_confined_to_its_projects() {
        let auth = key(Some("org_studio"), &["org_studio"], &[PROJ_A]);
        assert!(is_entitled(&auth, "org_studio", PROJ_A));
        assert!(!is_entitled(&auth, "org_studio", PROJ_B));
    }

    /// Empty project scope means "every project in the entitled orgs", which is
    /// how unscoped keys already behave elsewhere.
    #[test]
    fn empty_project_scope_allows_any_project_of_an_entitled_org() {
        let auth = key(Some("org_studio"), &["org_studio"], &[]);
        assert!(is_entitled(&auth, "org_studio", PROJ_B));
    }

    fn human(active: &str, role: Option<&str>) -> AuthUser {
        AuthUser {
            user_id: "user_3C6wp4YNAtiN9kxXQKY9BoifjI8".to_string(),
            org_id: Some(active.to_string()),
            org_slug: None,
            org_role: role.map(|r| r.to_string()),
            email: None,
            display_name: Some("rmzlb".to_string()),
            scoped_org_ids: vec![active.to_string()],
            scoped_project_ids: vec![],
            actor_kind: ActorKind::Human,
            actor_key_id: None,
            on_behalf_of: None,
            permissions: vec![crate::permissions::ADMIN_FULL.to_string()],
            legacy_full_access: false,
        }
    }

    fn orgs(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|o| o.to_string()).collect()
    }

    // ── BAA-33 / PHI-125 failure cases, written before the fix ──────────
    //
    // 1. Human member of the owning org, another org active → refused (bug).
    // 2. Human not a member of the owning org → must stay refused.
    // 3. Membership lookup failed / empty → must not open anything.
    // 4. API key whose creator is a member elsewhere → must not widen.
    // 5. Project-scoped key → must stay confined to its projects.
    // 6. Admin of the active org → must not moderate another org it joined
    //    as a plain member (role is only known for the active org).

    /// PHI-125: rmzlb reads PHI-125 (org_philoe) with org_studio active, but
    /// commenting answered 404. Membership of the owning org is enough.
    #[test]
    fn human_member_may_write_outside_the_active_org() {
        let auth = human("org_studio", None);
        let member = orgs(&["org_studio", "org_philoe"]);
        assert!(!is_entitled(&auth, "org_philoe", PROJ_A), "sync rule unchanged");
        assert!(is_entitled_as_member(&auth, "org_philoe", PROJ_A, &member));
    }

    #[test]
    fn human_non_member_stays_refused() {
        let auth = human("org_studio", None);
        let member = orgs(&["org_studio", "org_philoe"]);
        assert!(!is_entitled_as_member(&auth, "org_someone_else", PROJ_A, &member));
    }

    #[test]
    fn human_without_known_memberships_gets_only_the_active_org() {
        let auth = human("org_studio", None);
        assert!(!is_entitled_as_member(&auth, "org_philoe", PROJ_A, &[]));
        assert!(is_entitled_as_member(&auth, "org_studio", PROJ_A, &[]));
    }

    /// A key never inherits its creator's Clerk memberships: its scope is the
    /// one recorded on the key.
    #[test]
    fn api_key_ignores_memberships() {
        let auth = key(Some("org_studio"), &["org_studio"], &[]);
        let member = orgs(&["org_studio", "org_philoe"]);
        assert!(!is_entitled_as_member(&auth, "org_philoe", PROJ_A, &member));
        assert!(is_entitled_as_member(&auth, "org_studio", PROJ_A, &member));
    }

    #[test]
    fn project_scoped_key_stays_confined_with_memberships() {
        let auth = key(Some("org_studio"), &["org_studio"], &[PROJ_A]);
        let member = orgs(&["org_studio"]);
        assert!(is_entitled_as_member(&auth, "org_studio", PROJ_A, &member));
        assert!(!is_entitled_as_member(&auth, "org_studio", PROJ_B, &member));
    }

    /// `org_role` describes the active org only. Once a human may write in
    /// another org, that role must not grant admin rights there.
    #[test]
    fn admin_role_applies_to_the_active_org_only() {
        let admin = human("org_studio", Some("org:admin"));
        assert!(is_admin_of(&admin, "org_studio"));
        assert!(!is_admin_of(&admin, "org_philoe"));
        assert!(!is_admin_of(&human("org_studio", Some("org:member")), "org_studio"));
    }
}
