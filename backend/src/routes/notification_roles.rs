//! Notification roles: defined once for the organization, customisable per
//! project (migrations 080, 084).
//!
//! A role is a named rule ("Reviewer hears In Review and comments"). The org
//! holds the definitions and gives members a role on all its projects; a
//! project may replace the definitions with its own and give a member another
//! role (or none) on that project only. Recipient resolution reads all of it
//! at send time (`notification_prefs::member_rules_sql`), so nothing here
//! copies a role into anyone's subscription.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;
use crate::routes::issue_scope;

type ApiErr = (StatusCode, Json<Value>);

const MAX_ROLES: usize = 12;
const ALL_STATUSES: &str = "*";
/// Status keys an org role may name besides those of its projects: the default
/// workflow, plus `not_ok` used by the default Dev role. A project lacking one
/// simply never matches it.
const DEFAULT_STATUS_KEYS: [&str; 7] = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "cancelled",
    "not_ok",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationRole {
    pub key: String,
    pub label: String,
    pub notify_statuses: Vec<String>,
    pub notify_comments: bool,
    pub notify_issue_created: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RoleAssignment {
    pub user_id: String,
    pub role: String,
}

/// One member's role on a project, and where it comes from.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MemberRole {
    pub user_id: String,
    /// The role that applies here: the project's assignment if any, else the org's.
    pub role: Option<String>,
    pub org_role: Option<String>,
    /// The project gives this member its own role (`role`, possibly none).
    pub overridden: bool,
}

#[derive(Debug, Serialize)]
pub struct ProjectRolesView {
    pub project_id: Uuid,
    pub org_id: String,
    /// The project follows the org's role definitions.
    pub inherited: bool,
    /// The definitions that apply on this project.
    pub roles: Vec<NotificationRole>,
    pub org_roles: Vec<NotificationRole>,
    pub assignments: Vec<MemberRole>,
}

#[derive(Debug, Serialize)]
pub struct OrgRolesView {
    pub org_id: String,
    pub roles: Vec<NotificationRole>,
    pub assignments: Vec<RoleAssignment>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoles {
    pub roles: Vec<NotificationRole>,
}

#[derive(Debug, Deserialize)]
pub struct AssignRole {
    /// Org: `null` removes the member's org role. Project: `null` means "no
    /// role on this project"; `DELETE` goes back to the org's role.
    pub role: Option<String>,
}

fn bad_request(message: impl Into<String>) -> ApiErr {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error": message.into()})),
    )
}

fn forbidden(message: &str) -> ApiErr {
    (StatusCode::FORBIDDEN, Json(json!({"error": message})))
}

fn db_error(e: sqlx::Error) -> ApiErr {
    tracing::error!(error = %e, "notification_roles query failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "Database error"})),
    )
}

fn parse_roles(value: Value) -> Vec<NotificationRole> {
    serde_json::from_value(value).unwrap_or_default()
}

pub(crate) fn status_keys(statuses: &Value) -> Vec<String> {
    statuses
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.get("key").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Check and normalise submitted roles against the statuses they may name. An
/// unknown status would silently never match.
fn validate_roles(
    roles: Vec<NotificationRole>,
    known: &[String],
) -> Result<Vec<NotificationRole>, ApiErr> {
    if roles.len() > MAX_ROLES {
        return Err(bad_request(format!("At most {MAX_ROLES} roles")));
    }
    let mut out: Vec<NotificationRole> = Vec::with_capacity(roles.len());
    for mut role in roles {
        role.key = role.key.trim().to_string();
        role.label = role.label.trim().to_string();
        let key_ok = !role.key.is_empty()
            && role.key.len() <= 32
            && role
                .key
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
        if !key_ok {
            return Err(bad_request(format!(
                "Invalid role key '{}': use a-z, 0-9, '-' or '_' (max 32)",
                role.key
            )));
        }
        if role.label.is_empty() || role.label.chars().count() > 40 {
            return Err(bad_request(format!(
                "Role '{}' needs a label of 1 to 40 characters",
                role.key
            )));
        }
        if out.iter().any(|r| r.key == role.key) {
            return Err(bad_request(format!("Duplicate role key '{}'", role.key)));
        }
        let mut statuses_seen: Vec<String> = Vec::new();
        for status in role.notify_statuses {
            if status != ALL_STATUSES && !known.contains(&status) {
                return Err(bad_request(format!(
                    "Unknown status '{status}' in role '{}'",
                    role.key
                )));
            }
            if !statuses_seen.contains(&status) {
                statuses_seen.push(status);
            }
        }
        role.notify_statuses = statuses_seen;
        out.push(role);
    }
    Ok(out)
}

fn role_keys(roles: &[NotificationRole]) -> Vec<String> {
    roles.iter().map(|r| r.key.clone()).collect()
}

/// Only members of the org can hold one of its roles: it routes its content.
async fn require_org_member(user_id: &str, org_id: &str) -> Result<(), ApiErr> {
    let member = crate::routes::issues::fetch_user_org_ids(user_id)
        .await
        .is_ok_and(|ids| ids.iter().any(|id| id == org_id));
    if member {
        Ok(())
    } else {
        Err(bad_request("This user is not a member of the organization"))
    }
}

// ─────────────────────────── organization ───────────────────────────

/// Who may read or change an organization's roles.
///
/// - Reading: a member of the org (a human in any org of theirs, a key within
///   its own org scope). The roles span every project, so a key limited to
///   some projects is refused, like every org-wide route (BAA-36).
/// - Changing: an admin of the org, signed in with it active. `org_role` only
///   describes the active org, and an API key carries no org role at all, the
///   convention of `PATCH /orgs/{id}/settings`: these settings route every
///   project's notifications, so they stay with the org's admins.
fn org_roles_access(
    auth: &AuthUser,
    org_id: &str,
    member_org_ids: &[String],
    write: bool,
) -> Result<(), ApiErr> {
    issue_scope::require_org_wide(auth)?;
    if write {
        if !auth.is_human() {
            return Err(forbidden(
                "Organization notification roles are changed by an org admin, not an API key",
            ));
        }
        if !issue_scope::is_admin_of(auth, org_id) {
            return Err(forbidden(
                "Only an admin of this organization can change its notification roles",
            ));
        }
        return Ok(());
    }
    let member = if auth.is_human() {
        auth.org_id.as_deref() == Some(org_id) || member_org_ids.iter().any(|id| id == org_id)
    } else {
        auth.scoped_org_ids.iter().any(|id| id == org_id)
    };
    if member {
        Ok(())
    } else {
        Err(forbidden("You are not a member of this organization"))
    }
}

async fn check_org_access(auth: &AuthUser, org_id: &str, write: bool) -> Result<(), ApiErr> {
    let needs_lookup = !write && auth.is_human() && auth.org_id.as_deref() != Some(org_id);
    let member_org_ids = if needs_lookup {
        crate::routes::issues::fetch_user_org_ids(&auth.user_id)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    org_roles_access(auth, org_id, &member_org_ids, write)
}

/// The org's role definitions. Callers have already proved membership; an org
/// whose row does not exist yet (no project, row created in the background by
/// `admin::upsert_org_background`) gets it now, with the default roles.
async fn load_org_roles(pool: &PgPool, org_id: &str) -> Result<Vec<NotificationRole>, ApiErr> {
    let roles: Value = sqlx::query_scalar(
        "WITH ins AS ( \
           INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1) \
           ON CONFLICT (id) DO NOTHING RETURNING notification_roles) \
         SELECT notification_roles FROM ins \
         UNION ALL SELECT notification_roles FROM organizations WHERE id = $1",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(db_error)?;
    Ok(parse_roles(roles))
}

async fn org_view(pool: &PgPool, org_id: &str) -> Result<OrgRolesView, ApiErr> {
    let roles = load_org_roles(pool, org_id).await?;
    let assignments = sqlx::query_as::<_, RoleAssignment>(
        "SELECT user_id, role FROM org_member_roles WHERE org_id = $1 ORDER BY created_at",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(OrgRolesView {
        org_id: org_id.to_string(),
        roles,
        assignments,
    })
}

pub async fn get_org_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
) -> Result<Json<ApiResponse<OrgRolesView>>, ApiErr> {
    check_org_access(&auth, &org_id, false).await?;
    Ok(Json(ApiResponse::new(org_view(&pool, &org_id).await?)))
}

pub async fn update_org_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(org_id): Path<String>,
    Json(body): Json<UpdateRoles>,
) -> Result<Json<ApiResponse<OrgRolesView>>, ApiErr> {
    check_org_access(&auth, &org_id, true).await?;
    load_org_roles(&pool, &org_id).await?;
    let statuses: Vec<Value> =
        sqlx::query_scalar("SELECT statuses FROM projects WHERE org_id = $1")
            .bind(&org_id)
            .fetch_all(&pool)
            .await
            .map_err(db_error)?;
    let mut known: Vec<String> = DEFAULT_STATUS_KEYS.iter().map(|s| s.to_string()).collect();
    for s in statuses.iter().flat_map(status_keys) {
        if !known.contains(&s) {
            known.push(s);
        }
    }
    let roles = validate_roles(body.roles, &known)?;
    let keys = role_keys(&roles);

    let mut tx = pool.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE organizations SET notification_roles = $2 WHERE id = $1")
        .bind(&org_id)
        .bind(serde_json::to_value(&roles).unwrap_or_else(|_| json!([])))
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    // A removed role takes its assignments with it, so no screen shows someone
    // holding a role that no longer exists: the org's, and those of projects
    // that follow the org's definitions.
    sqlx::query("DELETE FROM org_member_roles WHERE org_id = $1 AND role <> ALL($2)")
        .bind(&org_id)
        .bind(&keys)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    sqlx::query(
        "DELETE FROM project_member_role_overrides o USING projects p \
          WHERE p.id = o.project_id AND p.org_id = $1 AND p.custom_notification_roles IS NULL \
            AND o.role IS NOT NULL AND o.role <> ALL($2)",
    )
    .bind(&org_id)
    .bind(&keys)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    Ok(Json(ApiResponse::new(org_view(&pool, &org_id).await?)))
}

pub async fn assign_org_role(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((org_id, user_id)): Path<(String, String)>,
    Json(body): Json<AssignRole>,
) -> Result<Json<ApiResponse<OrgRolesView>>, ApiErr> {
    check_org_access(&auth, &org_id, true).await?;
    let roles = load_org_roles(&pool, &org_id).await?;

    let Some(role) = body
        .role
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
    else {
        sqlx::query("DELETE FROM org_member_roles WHERE org_id = $1 AND user_id = $2")
            .bind(&org_id)
            .bind(&user_id)
            .execute(&pool)
            .await
            .map_err(db_error)?;
        return Ok(Json(ApiResponse::new(org_view(&pool, &org_id).await?)));
    };
    if !roles.iter().any(|r| r.key == role) {
        return Err(bad_request(format!(
            "Unknown role '{role}' for this organization"
        )));
    }
    require_org_member(&user_id, &org_id).await?;

    sqlx::query(
        "INSERT INTO org_member_roles (org_id, user_id, role, assigned_by) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (org_id, user_id) DO UPDATE SET \
           role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by, updated_at = now()",
    )
    .bind(&org_id)
    .bind(&user_id)
    .bind(&role)
    .bind(&auth.user_id)
    .execute(&pool)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::new(org_view(&pool, &org_id).await?)))
}

// ─────────────────────────── project ───────────────────────────

struct ProjectRoles {
    org_id: String,
    custom: Option<Vec<NotificationRole>>,
    org_roles: Vec<NotificationRole>,
    statuses: Value,
}

impl ProjectRoles {
    fn effective(&self) -> &[NotificationRole] {
        self.custom.as_deref().unwrap_or(&self.org_roles)
    }
}

async fn load_project(pool: &PgPool, project_id: Uuid) -> Result<ProjectRoles, ApiErr> {
    let (org_id, custom, org_roles, statuses): (String, Option<Value>, Value, Value) =
        sqlx::query_as(
            "SELECT p.org_id, p.custom_notification_roles, o.notification_roles, p.statuses \
           FROM projects p JOIN organizations o ON o.id = p.org_id WHERE p.id = $1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(db_error)?;
    Ok(ProjectRoles {
        org_id,
        custom: custom.map(parse_roles),
        org_roles: parse_roles(org_roles),
        statuses,
    })
}

async fn project_view(pool: &PgPool, project_id: Uuid) -> Result<ProjectRolesView, ApiErr> {
    let project = load_project(pool, project_id).await?;
    let assignments = sqlx::query_as::<_, MemberRole>(
        "SELECT u.user_id, \
                CASE WHEN pr.user_id IS NOT NULL THEN pr.role ELSE omr.role END AS role, \
                omr.role AS org_role, pr.user_id IS NOT NULL AS overridden \
           FROM ( \
             SELECT user_id FROM org_member_roles WHERE org_id = $2 \
             UNION SELECT user_id FROM project_member_role_overrides WHERE project_id = $1 \
           ) u \
           LEFT JOIN org_member_roles omr ON omr.org_id = $2 AND omr.user_id = u.user_id \
           LEFT JOIN project_member_role_overrides pr ON pr.project_id = $1 AND pr.user_id = u.user_id \
          ORDER BY u.user_id",
    )
    .bind(project_id)
    .bind(&project.org_id)
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(ProjectRolesView {
        project_id,
        inherited: project.custom.is_none(),
        roles: project.effective().to_vec(),
        org_id: project.org_id,
        org_roles: project.org_roles,
        assignments,
    })
}

/// Drop project assignments naming a role the project no longer defines.
/// "No role here" (`NULL`) stays: it is a choice, not a stale reference.
async fn prune_overrides(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    project_id: Uuid,
    keys: &[String],
) -> Result<(), ApiErr> {
    sqlx::query(
        "DELETE FROM project_member_role_overrides \
          WHERE project_id = $1 AND role IS NOT NULL AND role <> ALL($2)",
    )
    .bind(project_id)
    .bind(keys)
    .execute(&mut **tx)
    .await
    .map_err(db_error)?;
    Ok(())
}

pub async fn get_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ProjectRolesView>>, ApiErr> {
    issue_scope::require_project(&pool, &auth, project_id).await?;
    Ok(Json(ApiResponse::new(
        project_view(&pool, project_id).await?,
    )))
}

/// Give the project its own role definitions ("Customise for this project").
pub async fn update_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<UpdateRoles>,
) -> Result<Json<ApiResponse<ProjectRolesView>>, ApiErr> {
    issue_scope::require_project(&pool, &auth, project_id).await?;
    let project = load_project(&pool, project_id).await?;
    let roles = validate_roles(body.roles, &status_keys(&project.statuses))?;

    let mut tx = pool.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE projects SET custom_notification_roles = $2 WHERE id = $1")
        .bind(project_id)
        .bind(serde_json::to_value(&roles).unwrap_or_else(|_| json!([])))
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    prune_overrides(&mut tx, project_id, &role_keys(&roles)).await?;
    tx.commit().await.map_err(db_error)?;

    Ok(Json(ApiResponse::new(
        project_view(&pool, project_id).await?,
    )))
}

/// Follow the org's role definitions again ("Back to the org's roles").
pub async fn reset_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ProjectRolesView>>, ApiErr> {
    issue_scope::require_project(&pool, &auth, project_id).await?;
    let project = load_project(&pool, project_id).await?;

    let mut tx = pool.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE projects SET custom_notification_roles = NULL WHERE id = $1")
        .bind(project_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    prune_overrides(&mut tx, project_id, &role_keys(&project.org_roles)).await?;
    tx.commit().await.map_err(db_error)?;

    Ok(Json(ApiResponse::new(
        project_view(&pool, project_id).await?,
    )))
}

/// Give a member a role on this project only, or none (`role: null`),
/// whatever their org role.
pub async fn assign_role(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((project_id, user_id)): Path<(Uuid, String)>,
    Json(body): Json<AssignRole>,
) -> Result<Json<ApiResponse<ProjectRolesView>>, ApiErr> {
    let org_id = issue_scope::require_project(&pool, &auth, project_id).await?;
    let role = body
        .role
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty());

    if let Some(role) = role.as_deref() {
        let project = load_project(&pool, project_id).await?;
        if !project.effective().iter().any(|r| r.key == role) {
            return Err(bad_request(format!(
                "Unknown role '{role}' for this project"
            )));
        }
    }
    require_org_member(&user_id, &org_id).await?;

    let assigned_by = crate::routes::comments::resolve_owner_identity(&pool, &auth.user_id).await;
    sqlx::query(
        "INSERT INTO project_member_role_overrides (project_id, user_id, role, assigned_by) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (project_id, user_id) DO UPDATE SET \
           role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by, updated_at = now()",
    )
    .bind(project_id)
    .bind(&user_id)
    .bind(&role)
    .bind(&assigned_by)
    .execute(&pool)
    .await
    .map_err(db_error)?;

    Ok(Json(ApiResponse::new(
        project_view(&pool, project_id).await?,
    )))
}

/// Remove the member's project assignment: their org role applies again.
pub async fn clear_role(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((project_id, user_id)): Path<(Uuid, String)>,
) -> Result<Json<ApiResponse<ProjectRolesView>>, ApiErr> {
    issue_scope::require_project(&pool, &auth, project_id).await?;
    sqlx::query("DELETE FROM project_member_role_overrides WHERE project_id = $1 AND user_id = $2")
        .bind(project_id)
        .bind(&user_id)
        .execute(&pool)
        .await
        .map_err(db_error)?;
    Ok(Json(ApiResponse::new(
        project_view(&pool, project_id).await?,
    )))
}

#[cfg(test)]
#[path = "notification_roles/migration_tests.rs"]
mod migration_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middleware::ActorKind;

    fn role(key: &str, statuses: &[&str]) -> NotificationRole {
        NotificationRole {
            key: key.into(),
            label: key.into(),
            notify_statuses: statuses.iter().map(|s| s.to_string()).collect(),
            notify_comments: false,
            notify_issue_created: false,
        }
    }

    fn statuses() -> Vec<String> {
        vec!["in_review".into(), "backlog".into()]
    }

    #[test]
    fn rejects_a_status_the_project_does_not_have() {
        assert!(validate_roles(vec![role("reviewer", &["in_revew"])], &statuses()).is_err());
    }

    #[test]
    fn rejects_duplicate_and_malformed_keys() {
        assert!(validate_roles(vec![role("dev", &[]), role("dev", &[])], &statuses()).is_err());
        assert!(validate_roles(vec![role("Dev Team", &[])], &statuses()).is_err());
    }

    #[test]
    fn keeps_the_all_statuses_marker_and_dedupes() {
        let roles =
            validate_roles(vec![role("all", &["*", "backlog", "backlog"])], &statuses()).unwrap();
        assert_eq!(roles[0].notify_statuses, vec!["*", "backlog"]);
    }

    fn caller(
        kind: ActorKind,
        active: &str,
        org_role: Option<&str>,
        scoped_projects: &[Uuid],
    ) -> AuthUser {
        AuthUser {
            user_id: match kind {
                ActorKind::ApiKey => "apikey:test".into(),
                _ => "user_admin".into(),
            },
            org_id: Some(active.into()),
            org_slug: None,
            org_role: org_role.map(str::to_string),
            email: None,
            display_name: None,
            scoped_org_ids: vec![active.into()],
            scoped_project_ids: scoped_projects.to_vec(),
            actor_kind: kind,
            actor_key_id: None,
            on_behalf_of: None,
            permissions: vec![crate::permissions::ADMIN_FULL.into()],
            legacy_full_access: false,
        }
    }

    // Ways the org's roles could leak or be changed by the wrong caller:
    // 1. a plain member changes them;
    // 2. an admin of org A changes org B's, or reads it without belonging to it;
    // 3. an API key changes them, even a full-access, org-wide one;
    // 4. a key limited to some projects reads roles spanning every project;
    // 5. a key reads another org's roles.
    #[test]
    fn only_an_admin_of_the_org_changes_its_roles() {
        let admin = caller(ActorKind::Human, "org_a", Some("org:admin"), &[]);
        assert!(org_roles_access(&admin, "org_a", &[], true).is_ok());
        assert!(
            org_roles_access(&admin, "org_b", &[], true).is_err(),
            "admin of A changing B"
        );
        assert!(
            org_roles_access(&admin, "org_b", &[], false).is_err(),
            "not a member of B"
        );
        assert!(
            org_roles_access(&admin, "org_b", &["org_b".into()], false).is_ok(),
            "member of B reads it"
        );
        assert!(
            org_roles_access(&admin, "org_b", &["org_b".into()], true).is_err(),
            "admin rights describe the active org only"
        );

        let member = caller(ActorKind::Human, "org_a", Some("org:member"), &[]);
        assert!(org_roles_access(&member, "org_a", &[], false).is_ok());
        assert!(org_roles_access(&member, "org_a", &[], true).is_err());

        let key = caller(ActorKind::ApiKey, "org_a", None, &[]);
        assert!(org_roles_access(&key, "org_a", &[], false).is_ok());
        assert!(org_roles_access(&key, "org_a", &[], true).is_err());
        assert!(
            org_roles_access(&key, "org_b", &["org_b".into()], false).is_err(),
            "a key ignores memberships"
        );

        let limited = caller(ActorKind::ApiKey, "org_a", None, &[Uuid::new_v4()]);
        assert!(org_roles_access(&limited, "org_a", &[], false).is_err());
        assert!(org_roles_access(&limited, "org_a", &[], true).is_err());
    }
}
