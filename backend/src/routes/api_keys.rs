use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Sha256, Digest};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

/// Full list of valid permission strings for API keys.
/// "admin:full" grants all permissions (superkey).
const VALID_PERMISSIONS: &[&str] = &[
    "issues:read", "issues:write", "issues:delete",
    "projects:read", "projects:write", "projects:delete",
    "comments:read", "comments:write", "comments:delete",
    "labels:read", "labels:write",
    "milestones:read", "milestones:write",
    "sprints:read", "sprints:write",
    "automations:read", "automations:write",
    "webhooks:read", "webhooks:write",
    "members:read", "members:invite",
    "ai:chat", "ai:triage",
    "billing:read",
    "admin:full",
];

fn validate_permissions(perms: &[String]) -> Result<(), String> {
    for p in perms {
        if !VALID_PERMISSIONS.contains(&p.as_str()) {
            return Err(format!("Unknown permission: '{}'. Valid permissions: {}", p, VALID_PERMISSIONS.join(", ")));
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub id: Uuid,
    pub org_id: String,
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
    /// Optional: restrict key to specific projects. Empty = all projects in org.
    #[serde(default)]
    pub project_ids: Vec<Uuid>,
    /// Optional expiry: ISO 8601 datetime string
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub project_ids: Option<Vec<Uuid>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn default_permissions() -> Vec<String> {
    vec!["issues:read".to_string(), "issues:write".to_string(), "projects:read".to_string()]
}

fn generate_api_key() -> (String, String, String) {
    use rand::Rng;
    let random: [u8; 32] = rand::rng().random();
    let hex_str = hex::encode(random);
    let full_key = format!("baa_{hex_str}");
    let prefix = format!("baa_{}...", &hex_str[..8]);
    let hash = format!("{:x}", Sha256::digest(full_key.as_bytes()));
    (full_key, prefix, hash)
}

/// Guard: reject requests made with an API key (only Clerk JWT users can manage keys)
fn require_clerk_user(auth: &AuthUser) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if auth.user_id.starts_with("apikey:") {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "API keys cannot manage other API keys"})),
        ));
    }
    Ok(())
}

/// GET /api/v1/api-keys — list org keys (never exposes key_hash)
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<Vec<ApiKeyRow>>>, (StatusCode, Json<serde_json::Value>)> {
    require_clerk_user(&auth)?;

    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let keys = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, org_id, name, key_prefix, permissions, COALESCE(project_ids, '{}') as project_ids, last_used_at, expires_at, created_at \
         FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC"
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.list query failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to list API keys"})))
    })?;

    Ok(Json(ApiResponse::new(keys)))
}

/// POST /api/v1/api-keys — create a new API key (returns plaintext key once)
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateApiKeyRequest>,
) -> Result<Json<ApiResponse<ApiKeyWithSecret>>, (StatusCode, Json<serde_json::Value>)> {
    require_clerk_user(&auth)?;

    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.name.trim().is_empty() || body.name.len() > 200 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Name is required and must be under 200 characters"}))));
    }

    validate_permissions(&body.permissions)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;

    // Plan quota check
    crate::middleware::plan_guard::enforce_quota(
        &pool, org_id, &auth.user_id, crate::middleware::plan_guard::QuotaKind::ApiKeys
    ).await?;

    // Ensure the org exists
    let _ = sqlx::query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING"
    )
    .bind(org_id)
    .execute(&pool)
    .await;

    let (full_key, prefix, hash) = generate_api_key();

    let row = sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO api_keys (org_id, name, key_hash, key_prefix, permissions, project_ids, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING id, org_id, name, key_prefix, permissions, COALESCE(project_ids, '{}') as project_ids, last_used_at, expires_at, created_at"
    )
    .bind(org_id)
    .bind(body.name.trim())
    .bind(&hash)
    .bind(&prefix)
    .bind(&body.permissions)
    .bind(&body.project_ids)
    .bind(body.expires_at)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.create insert failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to create API key"})))
    })?;

    // Activity log
    let key_name = row.name.clone();
    let actor_name = auth.display_name.clone().or(auth.email.clone()).unwrap_or_else(|| auth.user_id.clone());
    let log_pool = pool.clone();
    let actor_id = auth.user_id.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "INSERT INTO activity_log (issue_id, actor_id, actor_name, action, details) \
             SELECT id, $1, $2, 'api_key_created', $3::jsonb FROM issues LIMIT 0"
            // No issue_id for org-level events — skip if activity_log requires issue_id
        )
        .bind(&actor_id)
        .bind(&actor_name)
        .bind(json!({"key_name": key_name}).to_string())
        .execute(&log_pool)
        .await;
    });

    tracing::info!(
        user_id = %auth.user_id,
        org_id = org_id,
        key_prefix = %prefix,
        "api_keys.create"
    );

    Ok(Json(ApiResponse::new(ApiKeyWithSecret {
        inner: row,
        key: full_key,
    })))
}

/// PATCH /api/v1/api-keys/{id} — update name, permissions, project_ids, expires_at
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(key_id): Path<Uuid>,
    Json(body): Json<UpdateApiKeyRequest>,
) -> Result<Json<ApiResponse<ApiKeyRow>>, (StatusCode, Json<serde_json::Value>)> {
    require_clerk_user(&auth)?;

    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if let Some(ref name) = body.name {
        if name.trim().is_empty() || name.len() > 200 {
            return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Name must be between 1 and 200 characters"}))));
        }
    }

    if let Some(ref perms) = body.permissions {
        validate_permissions(perms)
            .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;
    }

    // Build dynamic update — only touch provided fields
    let row = sqlx::query_as::<_, ApiKeyRow>(
        "UPDATE api_keys SET \
           name       = COALESCE($3, name), \
           permissions = COALESCE($4, permissions), \
           project_ids = COALESCE($5, project_ids), \
           expires_at  = CASE WHEN $6 THEN $7 ELSE expires_at END \
         WHERE id = $1 AND org_id = $2 \
         RETURNING id, org_id, name, key_prefix, permissions, COALESCE(project_ids, '{}') as project_ids, last_used_at, expires_at, created_at"
    )
    .bind(key_id)
    .bind(org_id)
    .bind(body.name.as_deref().map(|s| s.trim()))
    .bind(body.permissions.as_ref())
    .bind(body.project_ids.as_ref())
    .bind(body.expires_at.is_some())  // $6: whether to update expires_at
    .bind(body.expires_at)             // $7: new value (or null to clear)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "api_keys.update failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update API key"})))
    })?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "API key not found"}))))?;

    tracing::info!(
        user_id = %auth.user_id,
        org_id = org_id,
        key_id = %key_id,
        "api_keys.update"
    );

    Ok(Json(ApiResponse::new(row)))
}

/// POST /api/v1/api-keys/{id}/regenerate — regenerate a key (old key immediately revoked)
/// Returns new plaintext key once. Same name/permissions/scopes preserved.
pub async fn regenerate(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(key_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ApiKeyWithSecret>>, (StatusCode, Json<serde_json::Value>)> {
    require_clerk_user(&auth)?;

    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let (full_key, prefix, hash) = generate_api_key();

    let row = sqlx::query_as::<_, ApiKeyRow>(
        "UPDATE api_keys SET key_hash = $1, key_prefix = $2 \
         WHERE id = $3 AND org_id = $4 \
         RETURNING id, org_id, name, key_prefix, permissions, COALESCE(project_ids, '{}') as project_ids, last_used_at, expires_at, created_at"
    )
    .bind(&hash)
    .bind(&prefix)
    .bind(key_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "API key not found"}))))?;

    tracing::info!(
        user_id = %auth.user_id,
        org_id = org_id,
        key_id = %key_id,
        key_prefix = %prefix,
        "api_keys.regenerate — old key revoked"
    );

    Ok(Json(ApiResponse::new(ApiKeyWithSecret {
        inner: row,
        key: full_key,
    })))
}

/// DELETE /api/v1/api-keys/{id} — revoke an API key
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(key_id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    require_clerk_user(&auth)?;

    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query("DELETE FROM api_keys WHERE id = $1 AND org_id = $2")
        .bind(key_id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "api_keys.remove delete failed");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to delete API key"})))
        })?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "API key not found"}))));
    }

    tracing::info!(
        user_id = %auth.user_id,
        org_id = org_id,
        key_id = %key_id,
        "api_keys.remove"
    );

    Ok(Json(ApiResponse::new(())))
}
