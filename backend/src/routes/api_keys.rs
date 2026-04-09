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
    "ai:chat",
    "ai:triage",
    "billing:read",
    "admin:full",
];

const API_KEY_ROW_SELECT: &str = r#"
    SELECT
        k.id,
        k.org_id,
        o.name as org_name,
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

fn generate_api_key() -> (String, String, String) {
    use rand::Rng;
    let random: [u8; 32] = rand::rng().random();
    let hex_str = hex::encode(random);
    let full_key = format!("baa_{hex_str}");
    let prefix = format!("baa_{}...", &hex_str[..8]);
    let hash = format!("{:x}", Sha256::digest(full_key.as_bytes()));
    (full_key, prefix, hash)
}

fn require_clerk_user(auth: &AuthUser) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if auth.user_id.starts_with("apikey:") {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "API keys cannot manage other API keys"})),
        ));
    }
    Ok(())
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
    match fetch_user_org_ids(&auth.user_id).await {
        Ok(ids) if !ids.is_empty() => ids,
        Ok(_) => auth.org_id.iter().cloned().collect(),
        Err(e) => {
            tracing::warn!("fetch_user_org_ids failed in api_keys route: {}", e);
            auth.org_id.iter().cloned().collect()
        }
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
    require_clerk_user(&auth)?;

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;
    let sql = format!(
        "{} WHERE k.created_by = $1 OR (k.created_by IS NULL AND k.org_id = ANY($2)) ORDER BY k.created_at DESC",
        API_KEY_ROW_SELECT
    );

    let keys = sqlx::query_as::<_, ApiKeyRow>(&sql)
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

    Ok(Json(ApiResponse::new(keys)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateApiKeyRequest>,
) -> Result<Json<ApiResponse<ApiKeyWithSecret>>, (StatusCode, Json<serde_json::Value>)> {
    require_clerk_user(&auth)?;

    if body.name.trim().is_empty() || body.name.len() > 200 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Name is required and must be under 200 characters"})),
        ));
    }

    validate_permissions(&body.permissions)
        .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error": e}))))?;

    let scoped_org_ids = resolve_requested_org_ids(&auth, &body.org_ids).await?;
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
        "INSERT INTO api_keys (org_id, created_by, name, key_hash, key_prefix, permissions, project_ids, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"
    )
    .bind(&anchor_org_id)
    .bind(&auth.user_id)
    .bind(body.name.trim())
    .bind(&hash)
    .bind(&prefix)
    .bind(&body.permissions)
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

    let row = fetch_api_key_row(&pool, key_id).await?;

    let key_name = row.name.clone();
    let actor_name = auth
        .display_name
        .clone()
        .or(auth.email.clone())
        .unwrap_or_else(|| auth.user_id.clone());
    let log_pool = pool.clone();
    let actor_id = auth.user_id.clone();
    tokio::spawn(async move {
        let _ = sqlx::query(
            "INSERT INTO activity_log (issue_id, actor_id, actor_name, action, details) \
             SELECT id, $1, $2, 'api_key_created', $3::jsonb FROM issues LIMIT 0",
        )
        .bind(&actor_id)
        .bind(&actor_name)
        .bind(json!({"key_name": key_name}).to_string())
        .execute(&log_pool)
        .await;
    });

    tracing::info!(
        user_id = %auth.user_id,
        anchor_org_id = %anchor_org_id,
        key_prefix = %prefix,
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
    require_clerk_user(&auth)?;

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
    }

    let manageable_org_ids = fetch_manageable_org_ids(&auth).await;
    let existing_row = sqlx::query_as::<_, (String, Vec<Uuid>)>(
        "SELECT org_id, COALESCE(project_ids, '{}') as project_ids FROM api_keys \
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

    let scoped_org_ids = match body.org_ids.as_ref() {
        Some(org_ids) => resolve_requested_org_ids(&auth, org_ids).await?,
        None => {
            let row = fetch_api_key_row(&pool, key_id).await?;
            unique_org_ids(&row.org_ids)
        }
    };

    let effective_project_ids = body.project_ids.clone().unwrap_or(existing_row.1.clone());
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
           expires_at = CASE WHEN $8 THEN $9 ELSE expires_at END \
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

    let row = fetch_api_key_row(&pool, key_id).await?;

    tracing::info!(
        user_id = %auth.user_id,
        key_id = %key_id,
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
    require_clerk_user(&auth)?;

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

    let row = fetch_api_key_row(&pool, key_id).await?;

    tracing::info!(
        user_id = %auth.user_id,
        key_id = %key_id,
        key_prefix = %prefix,
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
    require_clerk_user(&auth)?;

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
