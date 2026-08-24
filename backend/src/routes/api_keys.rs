use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;
use crate::permissions::ADMIN_FULL;
use crate::routes::issues::fetch_user_org_ids;

const VALID_PERMISSIONS: &[&str] = &[
    "issues:read",
    "issues:write",
    "issues:delete",
    "projects:read",
    "projects:write",
    "projects:delete",
    "comments:read",
    "comments:write",
    "comments:delete",
    "labels:read",
    "labels:write",
    "milestones:read",
    "milestones:write",
    "sprints:read",
    "sprints:write",
    "automations:read",
    "automations:write",
    "webhooks:read",
    "webhooks:write",
    "members:read",
    "members:invite",
    "context:read",
    "context:write",
    "templates:read",
    "templates:write",
    "ai:chat",
    "ai:triage",
    "billing:read",
    "api-keys:read",
    "api-keys:write",
    "admin:full",
];

const ORG_SCOPE_MODE_FIXED: &str = "fixed";
const ORG_SCOPE_MODE_ALL_DYNAMIC: &str = "all_dynamic";

const API_KEY_ROW_SELECT: &str = r#"
    SELECT
        k.id,
        k.org_id,
        o.name as org_name,
        k.org_scope_mode,
        COALESCE(
            (SELECT array_agg(s.org_id ORDER BY s.org_id) FROM api_key_org_scopes s WHERE s.api_key_id = k.id),
            ARRAY[k.org_id]
        ) as org_ids,
        COALESCE(
            NULLIF((SELECT COUNT(*)::bigint FROM api_key_org_scopes s WHERE s.api_key_id = k.id), 0),
            1::bigint
        ) as org_count,
        k.name,
        k.key_prefix,
        k.permissions,
        COALESCE(k.project_ids, '{}') as project_ids,
        k.last_used_at,
        k.expires_at,
        k.created_at
    FROM api_keys k
    LEFT JOIN organizations o ON o.id = k.org_id
"#;

fn validate_permissions(perms: &[String]) -> Result<(), String> {
    for p in perms {
        if !VALID_PERMISSIONS.contains(&p.as_str()) {
            tracing::warn!(permission = %p, "api_keys.validate_permissions unknown permission");
            return Err(format!(
                "Unknown permission: '{}'. Valid permissions: {}",
                p,
                VALID_PERMISSIONS.join(", ")
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub id: Uuid,
    pub org_id: String,
    pub org_name: Option<String>,
    pub org_scope_mode: String,
    pub org_ids: Vec<String>,
    pub org_count: i64,
    pub name: String,
    pub key_prefix: String,
    pub permissions: Vec<String>,
    pub project_ids: Vec<Uuid>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyWithSecret {
    #[serde(flatten)]
    pub inner: ApiKeyRow,
    pub key: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    #[serde(default = "default_permissions")]
    pub permissions: Vec<String>,
    #[serde(default = "default_org_scope_mode")]
    pub org_scope_mode: String,
    #[serde(default)]
    pub org_ids: Vec<String>,
    #[serde(default)]
    pub project_ids: Vec<Uuid>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub org_scope_mode: Option<String>,
    pub org_ids: Option<Vec<String>>,
    pub project_ids: Option<Vec<Uuid>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn default_permissions() -> Vec<String> {
    vec![
        "issues:read".to_string(),
        "issues:write".to_string(),
        "projects:read".to_string(),
    ]
}

fn default_org_scope_mode() -> String {
    ORG_SCOPE_MODE_FIXED.to_string()
}

fn validate_org_scope_mode(mode: &str) -> Result<(), String> {
    match mode {
        ORG_SCOPE_MODE_FIXED | ORG_SCOPE_MODE_ALL_DYNAMIC => Ok(()),
        other => Err(format!(
            "Unknown org_scope_mode: '{}'. Valid values: {}, {}",
            other, ORG_SCOPE_MODE_FIXED, ORG_SCOPE_MODE_ALL_DYNAMIC
        )),
    }
}

fn is_all_dynamic_scope(mode: &str) -> bool {
    mode == ORG_SCOPE_MODE_ALL_DYNAMIC
}

#[allow(
    clippy::string_slice,
    reason = "hex::encode output is pure ASCII, so byte index 8 is always a char boundary"
)]
fn generate_api_key() -> (String, String, String) {
    use rand::Rng;
    let random: [u8; 32] = rand::rng().random();
    let hex_str = hex::encode(random);
    let full_key = format!("baa_{hex_str}");
    let prefix = format!("baa_{}...", &hex_str[..8]);
    let hash = format!("{:x}", Sha256::digest(full_key.as_bytes()));
    (full_key, prefix, hash)
}

/// Reject callers that may not manage API keys at all.
///
/// Humans are governed by `org_role`: managing credentials is an org-admin act,
/// so a plain member cannot mint keys even though their session carries
/// `admin:full` internally (that value exists so scope checks never lock a human
/// out of ordinary routes — see `AuthUser::permissions`).
///
/// API keys reach this point only when the middleware already matched
/// `api-keys:read` / `api-keys:write`, so no extra scope check is needed here;
/// what still has to be enforced is non-escalation, below.
fn require_key_manager(auth: &AuthUser) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if auth.is_human() && !auth.is_admin() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Only organization admins can manage API keys"})),
        ));
    }
    Ok(())
}

/// Scopes the caller is allowed to hand out.
///
/// Org admins may grant anything in the vocabulary. An API key may only grant
/// what it already holds — with `admin:full` expanded, since a wildcard holder
/// can reach every route anyway and refusing to let it name the scopes
/// explicitly would be theatre.
fn grantable_scopes(auth: &AuthUser) -> Vec<&'static str> {
    if auth.is_human() || auth.permissions.iter().any(|p| p == ADMIN_FULL) {
        return VALID_PERMISSIONS.to_vec();
    }
    VALID_PERMISSIONS
        .iter()
        .copied()
        .filter(|valid| {
            auth.permissions
                .iter()
                .any(|granted| crate::permissions::scope_satisfies(granted, valid))
        })
        .collect()
}

/// Refuse to mint or widen a key beyond the caller's own authority.
///
/// This is the rule that makes `api-keys:write` safe to delegate. Without it a
/// scoped key could create an `admin:full` key and escalate in one call, which
/// would make every other scope check pointless. It runs on **update** as well
/// as create, otherwise the same escalation works in two steps: mint a narrow
/// key, then widen it.
///
/// `admin:full` is included in the check rather than special-cased: a caller
/// that lacks it simply never has it among `grantable_scopes`.
fn enforce_no_escalation(
    auth: &AuthUser,
    requested: &[String],
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let grantable = grantable_scopes(auth);
    let refused: Vec<&str> = requested
        .iter()
        .map(String::as_str)
        .filter(|scope| !grantable.contains(scope))
        .collect();

    if refused.is_empty() {
        return Ok(());
    }

    tracing::warn!(
        actor = %auth.user_id,
        refused = ?refused,
        granted = ?auth.permissions,
        "api_keys.escalation_refused"
    );
    Err((
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": format!(
                "Cannot grant permissions you do not hold: {}",
                refused.join(", ")
            )
        })),
    ))
}

fn unique_org_ids(org_ids: &[String]) -> Vec<String> {
    let mut unique = Vec::new();
    for org_id in org_ids {
        if !org_id.trim().is_empty() && !unique.iter().any(|existing| existing == org_id) {
            unique.push(org_id.clone());
        }
    }
    unique
}

async fn fetch_manageable_org_ids(auth: &AuthUser) -> Vec<String> {
    // API keys have no Clerk membership to look up (`user_id` is
    // `apikey:<uuid>`), so their reach is the org scope resolved at
    // authentication time. Falling through to `fetch_user_org_ids` here would
    // log an error and silently narrow the key to a single org.
    if !auth.is_human() {
        if !auth.scoped_org_ids.is_empty() {
            return auth.scoped_org_ids.clone();
        }
        return auth.org_id.iter().cloned().collect();
    }
    match fetch_user_org_ids(&auth.user_id).await {
        Ok(ids) if !ids.is_empty() => ids,
        Ok(_) => auth.org_id.iter().cloned().collect(),
        Err(e) => {
            tracing::warn!("fetch_user_org_ids failed in api_keys route: {}", e);
            auth.org_id.iter().cloned().collect()
        }
    }
}

fn apply_dynamic_scope_to_row(row: &mut ApiKeyRow, manageable_org_ids: &[String]) {
    if is_all_dynamic_scope(&row.org_scope_mode) {
        row.org_ids = manageable_org_ids.to_vec();
        row.org_count = row.org_ids.len() as i64;
    }
}

async fn resolve_requested_org_ids(
    auth: &AuthUser,
    requested_org_ids: &[String],
) -> Result<Vec<String>, (StatusCode, Json<serde_json::Value>)> {
    let manageable_org_ids = fetch_manageable_org_ids(auth).await;
    let requested = if requested_org_ids.is_empty() {
        auth.org_id.iter().cloned().collect()
    } else {
        unique_org_ids(requested_org_ids)
    };

    if requested.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "At least one organization is required"})),
        ));
    }

    let invalid: Vec<String> = requested
        .iter()
        .filter(|org_id| !manageable_org_ids.iter().any(|allowed| allowed == *org_id))
        .cloned()
        .collect();

    if !invalid.is_empty() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "API key can only be scoped to your current organizations",
                "invalid_org_ids": invalid,
            })),
        ));
    }

    Ok(requested)
}

async fn validate_project_scope(
    pool: &PgPool,
    project_ids: &[Uuid],
    org_ids: &[String],
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if project_ids.is_empty() {
        return Ok(());
    }

    if org_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Organization scope is required before project scope"})),
        ));
    }

    let unique_project_ids: Vec<Uuid> = {
        let mut ids = Vec::new();
        for project_id in project_ids {
            if !ids.contains(project_id) {
                ids.push(*project_id);
            }
        }
        ids
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM projects WHERE id = ANY($1) AND org_id = ANY($2)",
    )
    .bind(&unique_project_ids)
    .bind(org_ids)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.validate_project_scope failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to validate project scope"})),
        )
    })?;

    if count != unique_project_ids.len() as i64 {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "Selected projects must belong to the selected organizations"})),
        ));
    }

    Ok(())
}

async fn replace_org_scopes(
    tx: &mut Transaction<'_, Postgres>,
    api_key_id: Uuid,
    org_ids: &[String],
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    sqlx::query("DELETE FROM api_key_org_scopes WHERE api_key_id = $1")
        .bind(api_key_id)
        .execute(tx.as_mut())
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "api_keys.replace_org_scopes delete failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update organization scope"})),
            )
        })?;

    for org_id in org_ids {
        sqlx::query("INSERT INTO api_key_org_scopes (api_key_id, org_id) VALUES ($1, $2)")
            .bind(api_key_id)
            .bind(org_id)
            .execute(tx.as_mut())
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "api_keys.replace_org_scopes insert failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Failed to update organization scope"})),
                )
            })?;
    }

    Ok(())
}

async fn fetch_api_key_row(
    pool: &PgPool,
    key_id: Uuid,
) -> Result<ApiKeyRow, (StatusCode, Json<serde_json::Value>)> {
    let sql = format!("{} WHERE k.id = $1", API_KEY_ROW_SELECT);
    sqlx::query_as::<_, ApiKeyRow>(&sql)
        .bind(key_id)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, key_id = %key_id, "api_keys.fetch_api_key_row failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to load API key"})),
            )
        })
}

pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<ApiKeyRow>>>, (StatusCode, Json<serde_json::Value>)> {
    require_key_manager(&auth)?;

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;
    let sql = format!(
        "{} WHERE k.created_by = $1 OR (k.created_by IS NULL AND k.org_id = ANY($2)) ORDER BY k.created_at DESC",
        API_KEY_ROW_SELECT
    );

    let mut keys = sqlx::query_as::<_, ApiKeyRow>(&sql)
        .bind(&auth.user_id)
        .bind(&manageable_org_ids)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "api_keys.list query failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to list API keys"})),
            )
        })?;

    for row in &mut keys {
        apply_dynamic_scope_to_row(row, &manageable_org_ids);
    }

    Ok(Json(ApiResponse::new(keys)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateApiKeyRequest>,
) -> Result<Json<ApiResponse<ApiKeyWithSecret>>, (StatusCode, Json<serde_json::Value>)> {
    require_key_manager(&auth)?;

    if body.name.trim().is_empty() || body.name.len() > 200 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Name is required and must be under 200 characters"})),
        ));
    }

    validate_permissions(&body.permissions)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;
    enforce_no_escalation(&auth, &body.permissions)?;

    validate_org_scope_mode(&body.org_scope_mode)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;
    let scoped_org_ids = if is_all_dynamic_scope(&body.org_scope_mode) {
        manageable_org_ids.clone()
    } else {
        resolve_requested_org_ids(&auth, &body.org_ids).await?
    };
    validate_project_scope(&pool, &body.project_ids, &scoped_org_ids).await?;

    crate::middleware::plan_guard::enforce_quota(
        &pool,
        &auth,
        crate::middleware::plan_guard::QuotaKind::ApiKeys,
    )
    .await?;

    let anchor_org_id = auth
        .org_id
        .clone()
        .filter(|id| scoped_org_ids.contains(id))
        .unwrap_or_else(|| scoped_org_ids[0].clone());
    crate::routes::admin::upsert_org_background(pool.clone(), anchor_org_id.clone());
    for org_id in &scoped_org_ids {
        crate::routes::admin::upsert_org_background(pool.clone(), org_id.clone());
    }

    let (full_key, prefix, hash) = generate_api_key();

    let mut tx = pool.begin().await.map_err(|e| {
        tracing::error!(error = %e, "api_keys.create begin failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to create API key"})),
        )
    })?;

    let key_id: Uuid = sqlx::query_scalar(
        "INSERT INTO api_keys (org_id, created_by, name, key_hash, key_prefix, permissions, org_scope_mode, project_ids, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"
    )
    .bind(&anchor_org_id)
    .bind(&auth.user_id)
    .bind(body.name.trim())
    .bind(&hash)
    .bind(&prefix)
    .bind(&body.permissions)
    .bind(&body.org_scope_mode)
    .bind(&body.project_ids)
    .bind(body.expires_at)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.create insert failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to create API key"})))
    })?;

    replace_org_scopes(&mut tx, key_id, &scoped_org_ids).await?;

    tx.commit().await.map_err(|e| {
        tracing::error!(error = %e, "api_keys.create commit failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to create API key"})),
        )
    })?;

    let mut row = fetch_api_key_row(&pool, key_id).await?;
    apply_dynamic_scope_to_row(&mut row, &manageable_org_ids);

    let key_name = row.name.clone();
    let log_pool = pool.clone();
    let log_auth = auth.clone();
    let log_org_id = anchor_org_id.clone();
    let log_key_id = key_id;
    let log_prefix = prefix.clone();
    let log_perms = row.permissions.clone();
    tokio::spawn(async move {
        // Previously this wrote to `actor_id`/`actor_name` with `LIMIT 0`, so it
        // silently inserted nothing: those columns were dropped in migration 008
        // and the row count was always zero. API key creation is exactly the
        // event an audit trail must never miss, so it now goes through the
        // standard activity logger (issue_id NULL = org-level event).
        crate::routes::activity::log_activity_as(
            &log_pool,
            &log_auth,
            &log_org_id,
            None,
            None,
            "api_key_created",
            None,
            None,
            None,
            Some(json!({
                "key_name": key_name,
                "key_id": log_key_id.to_string(),
                "key_prefix": log_prefix,
                "permissions": log_perms,
            })),
        )
        .await;
    });

    tracing::info!(
        user_id = %auth.user_id,
        anchor_org_id = %anchor_org_id,
        key_prefix = %prefix,
        org_scope_mode = %row.org_scope_mode,
        org_count = row.org_count,
        "api_keys.create"
    );

    Ok(Json(ApiResponse::new(ApiKeyWithSecret {
        inner: row,
        key: full_key,
    })))
}

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(key_id): Path<Uuid>,
    Json(body): Json<UpdateApiKeyRequest>,
) -> Result<Json<ApiResponse<ApiKeyRow>>, (StatusCode, Json<serde_json::Value>)> {
    require_key_manager(&auth)?;

    if let Some(ref name) = body.name {
        if name.trim().is_empty() || name.len() > 200 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Name must be between 1 and 200 characters"})),
            ));
        }
    }

    if let Some(ref perms) = body.permissions {
        validate_permissions(perms)
            .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;
        enforce_no_escalation(&auth, perms)?;
    }

    if let Some(ref org_scope_mode) = body.org_scope_mode {
        validate_org_scope_mode(org_scope_mode)
            .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;
    }

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;
    let existing_row = sqlx::query_as::<_, (String, String, Vec<Uuid>)>(
        "SELECT org_id, org_scope_mode, COALESCE(project_ids, '{}') as project_ids FROM api_keys \
         WHERE id = $1 AND (created_by = $2 OR (created_by IS NULL AND org_id = ANY($3)))",
    )
    .bind(key_id)
    .bind(&auth.user_id)
    .bind(&manageable_org_ids)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.update access check failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to update API key"})),
        )
    })?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "API key not found"})),
        )
    })?;

    let effective_scope_mode = body
        .org_scope_mode
        .clone()
        .unwrap_or_else(|| existing_row.1.clone());

    let scoped_org_ids = if is_all_dynamic_scope(&effective_scope_mode) {
        manageable_org_ids.clone()
    } else {
        match body.org_ids.as_ref() {
            Some(org_ids) => resolve_requested_org_ids(&auth, org_ids).await?,
            None => {
                let row = fetch_api_key_row(&pool, key_id).await?;
                unique_org_ids(&row.org_ids)
            }
        }
    };

    let effective_project_ids = body.project_ids.clone().unwrap_or(existing_row.2.clone());
    validate_project_scope(&pool, &effective_project_ids, &scoped_org_ids).await?;
    let anchor_org_id = auth
        .org_id
        .clone()
        .filter(|id| scoped_org_ids.contains(id))
        .unwrap_or_else(|| scoped_org_ids[0].clone());

    let mut tx = pool.begin().await.map_err(|e| {
        tracing::error!(error = %e, "api_keys.update begin failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to update API key"})),
        )
    })?;

    let result = sqlx::query(
        "UPDATE api_keys SET \
           org_id = $4, \
           name = COALESCE($5, name), \
           permissions = COALESCE($6, permissions), \
           project_ids = COALESCE($7, project_ids), \
           expires_at = CASE WHEN $8 THEN $9 ELSE expires_at END, \
           org_scope_mode = $10 \
         WHERE id = $1 AND (created_by = $2 OR (created_by IS NULL AND org_id = ANY($3)))",
    )
    .bind(key_id)
    .bind(&auth.user_id)
    .bind(&manageable_org_ids)
    .bind(&anchor_org_id)
    .bind(body.name.as_deref().map(|s| s.trim()))
    .bind(body.permissions.as_ref())
    .bind(body.project_ids.as_ref())
    .bind(body.expires_at.is_some())
    .bind(body.expires_at)
    .bind(&effective_scope_mode)
    .execute(tx.as_mut())
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.update failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to update API key"})),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "API key not found"})),
        ));
    }

    replace_org_scopes(&mut tx, key_id, &scoped_org_ids).await?;

    tx.commit().await.map_err(|e| {
        tracing::error!(error = %e, "api_keys.update commit failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to update API key"})),
        )
    })?;

    let mut row = fetch_api_key_row(&pool, key_id).await?;
    apply_dynamic_scope_to_row(&mut row, &manageable_org_ids);

    tracing::info!(
        user_id = %auth.user_id,
        key_id = %key_id,
        org_scope_mode = %row.org_scope_mode,
        org_count = row.org_count,
        "api_keys.update"
    );

    Ok(Json(ApiResponse::new(row)))
}

pub async fn regenerate(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(key_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ApiKeyWithSecret>>, (StatusCode, Json<serde_json::Value>)> {
    require_key_manager(&auth)?;

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;
    let (full_key, prefix, hash) = generate_api_key();

    let result = sqlx::query(
        "UPDATE api_keys SET key_hash = $1, key_prefix = $2 \
         WHERE id = $3 AND (created_by = $4 OR (created_by IS NULL AND org_id = ANY($5)))",
    )
    .bind(&hash)
    .bind(&prefix)
    .bind(key_id)
    .bind(&auth.user_id)
    .bind(&manageable_org_ids)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "API key not found"})),
        ));
    }

    let mut row = fetch_api_key_row(&pool, key_id).await?;
    apply_dynamic_scope_to_row(&mut row, &manageable_org_ids);

    tracing::info!(
        user_id = %auth.user_id,
        key_id = %key_id,
        key_prefix = %prefix,
        org_scope_mode = %row.org_scope_mode,
        org_count = row.org_count,
        "api_keys.regenerate"
    );

    Ok(Json(ApiResponse::new(ApiKeyWithSecret {
        inner: row,
        key: full_key,
    })))
}

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(key_id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    require_key_manager(&auth)?;

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;

    let result = sqlx::query(
        "DELETE FROM api_keys WHERE id = $1 AND (created_by = $2 OR (created_by IS NULL AND org_id = ANY($3)))"
    )
    .bind(key_id)
    .bind(&auth.user_id)
    .bind(&manageable_org_ids)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.remove delete failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to delete API key"})))
    })?;

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "API key not found"})),
        ));
    }

    tracing::info!(
        user_id = %auth.user_id,
        key_id = %key_id,
        "api_keys.remove"
    );

    Ok(Json(ApiResponse::new(())))
}

#[cfg(test)]
mod key_management_tests {
    use super::*;
    use crate::middleware::ActorKind;

    fn auth(kind: ActorKind, org_role: Option<&str>, perms: &[&str]) -> AuthUser {
        AuthUser {
            user_id: match kind {
                ActorKind::ApiKey => "apikey:5f8dc5e2-e05f-43be-9100-72b7d7b61198".to_string(),
                _ => "user_3C6wp4YNAtiN9kxXQKY9BoifjI8".to_string(),
            },
            org_id: Some("org_1".to_string()),
            org_slug: Some("acme".to_string()),
            org_role: org_role.map(|r| r.to_string()),
            email: None,
            display_name: None,
            scoped_org_ids: vec!["org_1".to_string()],
            scoped_project_ids: vec![],
            actor_kind: kind,
            actor_key_id: None,
            on_behalf_of: None,
            permissions: perms.iter().map(|p| p.to_string()).collect(),
            legacy_full_access: false,
        }
    }

    fn org_admin() -> AuthUser {
        auth(ActorKind::Human, Some("org:admin"), &[ADMIN_FULL])
    }
    fn member() -> AuthUser {
        auth(ActorKind::Human, Some("org:member"), &[ADMIN_FULL])
    }
    fn key(perms: &[&str]) -> AuthUser {
        auth(ActorKind::ApiKey, None, perms)
    }
    fn perms(list: &[&str]) -> Vec<String> {
        list.iter().map(|p| p.to_string()).collect()
    }

    // ── Who may manage keys at all ───────────────────────────────────────

    #[test]
    fn org_admin_may_manage_keys() {
        assert!(require_key_manager(&org_admin()).is_ok());
    }

    #[test]
    fn plain_member_may_not_manage_keys() {
        // A member's session carries `admin:full` internally so ordinary scope
        // checks never lock them out; authority here comes from `org_role`.
        let err = require_key_manager(&member()).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn owner_role_may_manage_keys() {
        let owner = auth(ActorKind::Human, Some("org:owner"), &[ADMIN_FULL]);
        assert!(require_key_manager(&owner).is_ok());
    }

    #[test]
    fn key_with_management_scope_may_manage_keys() {
        // The middleware already matched `api-keys:*` before reaching here.
        assert!(require_key_manager(&key(&["api-keys:write"])).is_ok());
    }

    // ── Non-escalation: the rule that makes delegation safe ──────────────

    #[test]
    fn admin_may_grant_anything_including_admin_full() {
        assert!(enforce_no_escalation(&org_admin(), &perms(&[ADMIN_FULL])).is_ok());
        assert!(enforce_no_escalation(&org_admin(), &perms(VALID_PERMISSIONS)).is_ok());
    }

    #[test]
    fn scoped_key_cannot_mint_admin_full() {
        // The core escalation: one call to full org control.
        let caller = key(&["api-keys:write", "issues:read"]);
        let err = enforce_no_escalation(&caller, &perms(&[ADMIN_FULL])).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn scoped_key_cannot_grant_scopes_it_lacks() {
        let caller = key(&["api-keys:write", "issues:read", "issues:write"]);
        for forbidden in [
            "issues:delete",
            "billing:read",
            "members:invite",
            "webhooks:write",
            "projects:delete",
        ] {
            let err = enforce_no_escalation(&caller, &perms(&[forbidden])).unwrap_err();
            assert_eq!(err.0, StatusCode::FORBIDDEN, "{forbidden} must be refused");
        }
    }

    #[test]
    fn scoped_key_may_grant_a_subset_of_itself() {
        let caller = key(&["api-keys:write", "issues:read", "issues:write", "projects:read"]);
        assert!(enforce_no_escalation(&caller, &perms(&["issues:read"])).is_ok());
        assert!(
            enforce_no_escalation(&caller, &perms(&["issues:read", "projects:read"])).is_ok()
        );
    }

    #[test]
    fn scoped_key_may_grant_exactly_itself_but_no_more() {
        let held = ["api-keys:write", "issues:read", "issues:write"];
        let caller = key(&held);
        assert!(enforce_no_escalation(&caller, &perms(&held)).is_ok());
        let mut widened = perms(&held);
        widened.push("issues:delete".to_string());
        assert!(enforce_no_escalation(&caller, &widened).is_err());
    }

    #[test]
    fn write_implies_read_when_granting() {
        // `issues:write` holder may issue a read-only key: strictly narrower.
        let caller = key(&["api-keys:write", "issues:write"]);
        assert!(enforce_no_escalation(&caller, &perms(&["issues:read"])).is_ok());
    }

    #[test]
    fn read_does_not_imply_write_when_granting() {
        let caller = key(&["api-keys:write", "issues:read"]);
        assert!(enforce_no_escalation(&caller, &perms(&["issues:write"])).is_err());
    }

    #[test]
    fn key_holding_admin_full_may_grant_anything() {
        // A wildcard holder already reaches every route; refusing to let it name
        // scopes explicitly would be theatre, not security.
        let caller = key(&[ADMIN_FULL]);
        assert!(enforce_no_escalation(&caller, &perms(VALID_PERMISSIONS)).is_ok());
    }

    #[test]
    fn key_cannot_hand_out_key_management_it_lacks() {
        // Holding `api-keys:read` must not let a key mint `api-keys:write`.
        let caller = key(&["api-keys:read", "issues:read"]);
        assert!(enforce_no_escalation(&caller, &perms(&["api-keys:write"])).is_err());
    }

    #[test]
    fn error_message_names_the_refused_scopes() {
        let caller = key(&["api-keys:write", "issues:read"]);
        let err = enforce_no_escalation(&caller, &perms(&["billing:read", "issues:delete"]))
            .unwrap_err();
        let body = err.1 .0.to_string();
        assert!(body.contains("billing:read"), "got {body}");
        assert!(body.contains("issues:delete"), "got {body}");
    }

    #[test]
    fn empty_grant_is_allowed() {
        assert!(enforce_no_escalation(&key(&["api-keys:write"]), &[]).is_ok());
    }

    #[test]
    fn every_scope_in_the_vocabulary_is_refused_to_a_bare_manager() {
        // Exhaustive: a key whose ONLY power is managing keys can grant nothing
        // except the read side of what it holds.
        let caller = key(&["api-keys:write"]);
        for scope in VALID_PERMISSIONS {
            let allowed = enforce_no_escalation(&caller, &perms(&[scope])).is_ok();
            let expected = *scope == "api-keys:write" || *scope == "api-keys:read";
            assert_eq!(allowed, expected, "scope {scope} mis-handled");
        }
    }

    #[test]
    fn grantable_set_never_exceeds_the_vocabulary() {
        for caller in [org_admin(), key(&[ADMIN_FULL]), key(&["issues:write"])] {
            for scope in grantable_scopes(&caller) {
                assert!(VALID_PERMISSIONS.contains(&scope), "{scope} is not a valid permission");
            }
        }
    }
}
