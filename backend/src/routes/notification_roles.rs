//! Notification roles of a project (migration 080).
//!
//! A role is a named rule stored on the project; editors assign it to members.
//! Recipient resolution reads roles at send time (`notification_prefs`), so
//! nothing here copies a role into anyone's subscription.

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

#[derive(Debug, Serialize)]
pub struct NotificationRolesView {
    pub project_id: Uuid,
    pub roles: Vec<NotificationRole>,
    pub assignments: Vec<RoleAssignment>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoles {
    pub roles: Vec<NotificationRole>,
}

#[derive(Debug, Deserialize)]
pub struct AssignRole {
    /// `null` removes the member's role.
    pub role: Option<String>,
}

fn bad_request(message: impl Into<String>) -> ApiErr {
    (StatusCode::BAD_REQUEST, Json(json!({"error": message.into()})))
}

fn db_error(e: sqlx::Error) -> ApiErr {
    tracing::error!(error = %e, "notification_roles query failed");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
}

async fn load_roles(pool: &PgPool, project_id: Uuid) -> Result<(Vec<NotificationRole>, Value), ApiErr> {
    let (roles, statuses): (Value, Value) =
        sqlx::query_as("SELECT notification_roles, statuses FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(db_error)?;
    let roles = serde_json::from_value(roles).unwrap_or_default();
    Ok((roles, statuses))
}

async fn view(pool: &PgPool, project_id: Uuid) -> Result<NotificationRolesView, ApiErr> {
    let (roles, _) = load_roles(pool, project_id).await?;
    let assignments = sqlx::query_as::<_, RoleAssignment>(
        "SELECT user_id, role FROM project_member_roles WHERE project_id = $1 ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    Ok(NotificationRolesView { project_id, roles, assignments })
}

/// Check and normalise the roles an editor submits against the project's own
/// statuses. An unknown status would silently never match.
fn validate_roles(roles: Vec<NotificationRole>, statuses: &Value) -> Result<Vec<NotificationRole>, ApiErr> {
    if roles.len() > MAX_ROLES {
        return Err(bad_request(format!("At most {MAX_ROLES} roles per project")));
    }
    let known: Vec<&str> = statuses
        .as_array()
        .map(|a| a.iter().filter_map(|s| s.get("key").and_then(Value::as_str)).collect())
        .unwrap_or_default();
    let mut out: Vec<NotificationRole> = Vec::with_capacity(roles.len());
    for mut role in roles {
        role.key = role.key.trim().to_string();
        role.label = role.label.trim().to_string();
        let key_ok = !role.key.is_empty()
            && role.key.len() <= 32
            && role.key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
        if !key_ok {
            return Err(bad_request(format!("Invalid role key '{}': use a-z, 0-9, '-' or '_' (max 32)", role.key)));
        }
        if role.label.is_empty() || role.label.chars().count() > 40 {
            return Err(bad_request(format!("Role '{}' needs a label of 1 to 40 characters", role.key)));
        }
        if out.iter().any(|r| r.key == role.key) {
            return Err(bad_request(format!("Duplicate role key '{}'", role.key)));
        }
        let mut statuses_seen: Vec<String> = Vec::new();
        for status in role.notify_statuses {
            if status != ALL_STATUSES && !known.contains(&status.as_str()) {
                return Err(bad_request(format!("Unknown status '{status}' in role '{}'", role.key)));
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

pub async fn get_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<NotificationRolesView>>, ApiErr> {
    issue_scope::require_project(&pool, &auth, project_id).await?;
    Ok(Json(ApiResponse::new(view(&pool, project_id).await?)))
}

pub async fn update_roles(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<UpdateRoles>,
) -> Result<Json<ApiResponse<NotificationRolesView>>, ApiErr> {
    issue_scope::require_project(&pool, &auth, project_id).await?;
    let (_, statuses) = load_roles(&pool, project_id).await?;
    let roles = validate_roles(body.roles, &statuses)?;
    let keys: Vec<String> = roles.iter().map(|r| r.key.clone()).collect();

    let mut tx = pool.begin().await.map_err(db_error)?;
    sqlx::query("UPDATE projects SET notification_roles = $2 WHERE id = $1")
        .bind(project_id)
        .bind(serde_json::to_value(&roles).unwrap_or_else(|_| json!([])))
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    // A removed role takes its assignments with it, so the members screen never
    // shows someone holding a role that no longer exists.
    sqlx::query("DELETE FROM project_member_roles WHERE project_id = $1 AND role <> ALL($2)")
        .bind(project_id)
        .bind(&keys)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    Ok(Json(ApiResponse::new(view(&pool, project_id).await?)))
}

pub async fn assign_role(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((project_id, user_id)): Path<(Uuid, String)>,
    Json(body): Json<AssignRole>,
) -> Result<Json<ApiResponse<NotificationRolesView>>, ApiErr> {
    let org_id = issue_scope::require_project(&pool, &auth, project_id).await?;

    let Some(role) = body.role.map(|r| r.trim().to_string()).filter(|r| !r.is_empty()) else {
        sqlx::query("DELETE FROM project_member_roles WHERE project_id = $1 AND user_id = $2")
            .bind(project_id)
            .bind(&user_id)
            .execute(&pool)
            .await
            .map_err(db_error)?;
        return Ok(Json(ApiResponse::new(view(&pool, project_id).await?)));
    };

    let (roles, _) = load_roles(&pool, project_id).await?;
    if !roles.iter().any(|r| r.key == role) {
        return Err(bad_request(format!("Unknown role '{role}' for this project")));
    }
    // Only members of the project's org can hold a role: it routes project
    // content to them.
    let member = crate::routes::issues::fetch_user_org_ids(&user_id)
        .await
        .is_ok_and(|ids| ids.contains(&org_id));
    if !member {
        return Err(bad_request("This user is not a member of the project's organization"));
    }

    let assigned_by = crate::routes::comments::resolve_owner_identity(&pool, &auth.user_id).await;
    sqlx::query(
        "INSERT INTO project_member_roles (project_id, user_id, role, assigned_by) \
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

    Ok(Json(ApiResponse::new(view(&pool, project_id).await?)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn role(key: &str, statuses: &[&str]) -> NotificationRole {
        NotificationRole {
            key: key.into(),
            label: key.into(),
            notify_statuses: statuses.iter().map(|s| s.to_string()).collect(),
            notify_comments: false,
            notify_issue_created: false,
        }
    }

    fn statuses() -> Value {
        json!([{"key": "in_review"}, {"key": "backlog"}])
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
        let roles = validate_roles(vec![role("all", &["*", "backlog", "backlog"])], &statuses()).unwrap();
        assert_eq!(roles[0].notify_statuses, vec!["*", "backlog"]);
    }
}
