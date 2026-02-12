use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Sha256, Digest};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub id: Uuid,
    pub org_id: String,
    pub name: String,
    pub key_prefix: String,
    pub permissions: Vec<String>,
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
}

fn default_permissions() -> Vec<String> {
    vec!["read".to_string(), "write".to_string()]
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
        "SELECT id, org_id, name, key_prefix, permissions, last_used_at, expires_at, created_at \
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

    // Ensure the org exists
    let _ = sqlx::query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING"
    )
    .bind(org_id)
    .execute(&pool)
    .await;

    let (full_key, prefix, hash) = generate_api_key();

    let row = sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO api_keys (org_id, name, key_hash, key_prefix, permissions) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING id, org_id, name, key_prefix, permissions, last_used_at, expires_at, created_at"
    )
    .bind(org_id)
    .bind(body.name.trim())
    .bind(&hash)
    .bind(&prefix)
    .bind(&body.permissions)
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
