use axum::{extract::{Path, Query, State}, Extension, Json};
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::middleware::{ActorKind, AuthUser};
use crate::models::{ActivityEntry, ApiResponse};

#[derive(Debug, Deserialize)]
pub struct ActivityParams {
    pub limit: Option<i64>,
}

/// GET /api/v1/issues/:id/activity — activity log for a specific issue
pub async fn list_by_issue(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Query(params): Query<ActivityParams>,
) -> Json<ApiResponse<Vec<ActivityEntry>>> {
    let org_id = auth.org_id.unwrap_or_default();
    let limit = params.limit.unwrap_or(50);

    let entries = sqlx::query_as::<_, ActivityEntry>(
        r#"
        SELECT al.*,
               i.title      AS issue_title,
               i.display_id AS issue_display_id
        FROM activity_log al
        LEFT JOIN issues i ON i.id = al.issue_id
        WHERE al.issue_id = $1 AND al.org_id = $2
        ORDER BY al.created_at DESC
        LIMIT $3
        "#,
    )
    .bind(issue_id)
    .bind(&org_id)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "activity.list_by_issue query failed");
        vec![]
    });

    let entries = resolve_on_behalf_names(entries).await;

    Json(ApiResponse::new(entries))
}

/// GET /api/v1/activity — recent activity across the org (for dashboard)
pub async fn list_recent(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Query(params): Query<ActivityParams>,
) -> Json<ApiResponse<Vec<ActivityEntry>>> {
    let org_id = auth.org_id.unwrap_or_default();
    let limit = params.limit.unwrap_or(30);

    let entries = sqlx::query_as::<_, ActivityEntry>(
        r#"
        SELECT al.*,
               i.title      AS issue_title,
               i.display_id AS issue_display_id
        FROM activity_log al
        LEFT JOIN issues i ON i.id = al.issue_id
        WHERE al.org_id = $1
        ORDER BY al.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(&org_id)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "activity.list_recent query failed");
        vec![]
    });

    let entries = resolve_on_behalf_names(entries).await;

    Json(ApiResponse::new(entries))
}

/// Fill `on_behalf_of_name` for rows attributed to a human behind an API key.
///
/// Ids are deduplicated first, so a page of 50 agent actions from one owner
/// costs a single (cached) Clerk lookup instead of 50.
async fn resolve_on_behalf_names(mut entries: Vec<ActivityEntry>) -> Vec<ActivityEntry> {
    let ids: HashSet<String> = entries
        .iter()
        .filter_map(|e| e.on_behalf_of.clone())
        .filter(|id| !id.is_empty())
        .collect();

    if ids.is_empty() {
        return entries;
    }

    let mut names: HashMap<String, String> = HashMap::new();
    for id in ids {
        if let Some((display_name, email)) =
            crate::middleware::resolve_profile_cached(&id).await
        {
            if let Some(label) = display_name.or(email) {
                names.insert(id, label);
            }
        }
    }

    for entry in entries.iter_mut() {
        if let Some(id) = entry.on_behalf_of.as_deref() {
            entry.on_behalf_of_name = names.get(id).cloned();
        }
    }

    entries
}

/// Helper: log an activity entry AND fire gamification counters.
///
/// This is the single authoritative entry point for all activity recording.
/// Called from issues.rs, comments.rs, relations.rs, recurring.rs, etc.
/// Never fails the calling operation — errors are logged and swallowed.
///
/// `user_id` / `user_name` describe the identity that *acted* (an `apikey:<id>`
/// pseudo-user for agent calls). Use `log_activity_as` to also record the human
/// behind an API key; this wrapper classifies the actor from the identity string
/// for legacy call sites that have no `AuthUser` in scope.
#[allow(dead_code)]
pub async fn log_activity(
    pool: &PgPool,
    org_id: &str,
    project_id: Option<Uuid>,
    issue_id: Option<Uuid>,
    user_id: &str,
    user_name: Option<&str>,
    action: &str,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    let actor = ActorContext::from_identity(user_id);
    log_activity_inner(
        pool, org_id, project_id, issue_id, user_id, user_name, &actor, action, field, old_value,
        new_value, metadata,
    )
    .await;
}

/// Same as [`log_activity`], but takes the authenticated caller so the row also
/// records `actor_type`, `actor_key_id` and `on_behalf_of` (see migration 068).
/// Prefer this variant wherever an `AuthUser` is available.
#[allow(dead_code)]
pub async fn log_activity_as(
    pool: &PgPool,
    auth: &AuthUser,
    org_id: &str,
    project_id: Option<Uuid>,
    issue_id: Option<Uuid>,
    action: &str,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    let actor = ActorContext::from_auth(auth);
    let user_name = auth.created_by_label();
    log_activity_inner(
        pool,
        org_id,
        project_id,
        issue_id,
        &auth.user_id,
        user_name.as_deref(),
        &actor,
        action,
        field,
        old_value,
        new_value,
        metadata,
    )
    .await;
}

/// Attribution triple written alongside the acting identity.
#[derive(Debug, Clone)]
pub struct ActorContext {
    pub kind: ActorKind,
    pub key_id: Option<Uuid>,
    pub on_behalf_of: Option<String>,
}

impl ActorContext {
    pub fn from_auth(auth: &AuthUser) -> Self {
        Self {
            kind: auth.actor_kind,
            key_id: auth.actor_key_id,
            on_behalf_of: auth.on_behalf_of.clone(),
        }
    }

    /// Best-effort classification when only the raw identity is known.
    /// The API key id is recovered from the `apikey:<uuid>` pseudo-user, but the
    /// owning human is left unset: resolving it would need a DB round-trip that
    /// these fire-and-forget call sites cannot afford. Migration 068 backfills
    /// `on_behalf_of` from `actor_key_id`, and the same join covers new rows.
    pub fn from_identity(identity: &str) -> Self {
        let kind = ActorKind::from_identity(identity);
        let key_id = identity
            .strip_prefix("apikey:")
            .and_then(|raw| Uuid::parse_str(raw).ok());
        Self {
            kind,
            key_id,
            on_behalf_of: None,
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn log_activity_inner(
    pool: &PgPool,
    org_id: &str,
    project_id: Option<Uuid>,
    issue_id: Option<Uuid>,
    user_id: &str,
    user_name: Option<&str>,
    actor: &ActorContext,
    action: &str,
    field: Option<&str>,
    old_value: Option<&str>,
    new_value: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    let meta = metadata.unwrap_or(serde_json::json!({}));
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO activity_log
            (org_id, project_id, issue_id, user_id, user_name, action, field, old_value, new_value, metadata,
             actor_type, actor_key_id, on_behalf_of)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                COALESCE($13, (SELECT created_by FROM api_keys WHERE id = $12)))
        "#,
    )
    .bind(org_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(user_id)
    .bind(user_name)
    .bind(action)
    .bind(field)
    .bind(old_value)
    .bind(new_value)
    .bind(&meta)
    .bind(actor.kind.as_str())
    .bind(actor.key_id)
    .bind(actor.on_behalf_of.as_deref())
    .execute(pool)
    .await
    {
        tracing::error!(error = %e, action = %action, "activity.log_activity insert failed");
    }

    // Mirror every action into the gamification counters so velocity is always accurate.
    // Only humans earn personal XP and streaks: an API key acting on behalf of a
    // human is attributed to them in the audit trail but must not inflate their
    // counters, so attribution and credit stay separate.
    if actor.kind.earns_gamification() {
        crate::routes::gamification::record_activity(pool, user_id, org_id, action).await;
    }
}
