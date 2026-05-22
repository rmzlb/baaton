use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, CreateMemory, Memory};

#[derive(Debug, Deserialize)]
pub struct ListMemoryQuery {
    pub q: Option<String>,
    pub kind: Option<String>,
    pub source: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SearchMemoryRequest {
    pub q: Option<String>,
    pub project_id: Option<String>,
    pub kind: Option<String>,
    pub source: Option<String>,
    pub tags: Option<Vec<String>>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NewMemory {
    pub org_id: String,
    pub project_id: Option<Uuid>,
    pub source: String,
    pub kind: String,
    pub content: String,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub external_url: Option<String>,
    pub metadata: serde_json::Value,
    pub created_by: Option<String>,
    pub created_by_name: Option<String>,
}

const VALID_KINDS: &[&str] = &[
    "fact",
    "decision",
    "learning",
    "constraint",
    "risk",
    "handoff",
    "integration",
    "note",
];
const VALID_SOURCES: &[&str] = &[
    "manual",
    "api",
    "ai_chat",
    "tldr",
    "github",
    "slack",
    "email",
    "memory_store",
];

fn validate_kind(kind: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if VALID_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Invalid memory kind '{}'.", kind),
                "accepted_values": VALID_KINDS,
                "field": "kind"
            })),
        ))
    }
}

fn validate_source(source: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if VALID_SOURCES.contains(&source) {
        Ok(())
    } else {
        Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Invalid memory source '{}'.", source),
                "accepted_values": VALID_SOURCES,
                "field": "source"
            })),
        ))
    }
}

fn normalize_confidence(confidence: Option<f64>) -> f64 {
    confidence.unwrap_or(0.8).clamp(0.0, 1.0)
}

async fn project_org_id(
    pool: &PgPool,
    project_id: Uuid,
    org_ids: &[String],
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query_scalar::<_, String>(
        "SELECT org_id FROM projects WHERE id = $1 AND org_id = ANY($2::text[])",
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Project not found"})),
        )
    })
}

fn auth_org_ids(auth: &AuthUser) -> Result<Vec<String>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Organization required"})),
        )
    })?;
    Ok(vec![org_id.to_string()])
}

pub async fn insert_memory(pool: &PgPool, input: NewMemory) -> Result<Memory, sqlx::Error> {
    sqlx::query_as::<_, Memory>(
        r#"
        INSERT INTO memories
            (org_id, project_id, source, kind, content, tags, confidence, external_url, metadata, created_by, created_by_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
        "#,
    )
    .bind(&input.org_id)
    .bind(input.project_id)
    .bind(&input.source)
    .bind(&input.kind)
    .bind(&input.content)
    .bind(&input.tags)
    .bind(input.confidence)
    .bind(&input.external_url)
    .bind(&input.metadata)
    .bind(&input.created_by)
    .bind(&input.created_by_name)
    .fetch_one(pool)
    .await
}

pub async fn create_project_memory(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateMemory>,
) -> Result<Json<ApiResponse<Memory>>, (StatusCode, Json<serde_json::Value>)> {
    let org_ids = auth_org_ids(&auth)?;
    let org_id = project_org_id(&pool, project_id, &org_ids).await?;
    let source = body.source.unwrap_or_else(|| "manual".to_string());
    let kind = body.kind.unwrap_or_else(|| "fact".to_string());
    validate_source(&source)?;
    validate_kind(&kind)?;

    if body.content.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "content is required"})),
        ));
    }

    let memory = insert_memory(
        &pool,
        NewMemory {
            org_id,
            project_id: Some(project_id),
            source,
            kind,
            content: body.content.trim().to_string(),
            tags: body.tags.unwrap_or_default(),
            confidence: normalize_confidence(body.confidence),
            external_url: body.external_url,
            metadata: body.metadata.unwrap_or_else(|| json!({})),
            created_by: Some(auth.user_id),
            created_by_name: auth.display_name,
        },
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok(Json(ApiResponse::new(memory)))
}

pub async fn list_project_memory(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<ListMemoryQuery>,
) -> Result<Json<ApiResponse<Vec<Memory>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_ids = auth_org_ids(&auth)?;
    let org_id = project_org_id(&pool, project_id, &org_ids).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 200);

    if let Some(kind) = query.kind.as_deref() {
        validate_kind(kind)?;
    }
    if let Some(source) = query.source.as_deref() {
        validate_source(source)?;
    }

    let memories = sqlx::query_as::<_, Memory>(
        r#"
        SELECT * FROM memories
        WHERE org_id = $1
          AND project_id = $2
          AND ($3::text IS NULL OR kind = $3)
          AND ($4::text IS NULL OR source = $4)
          AND (
              $5::text IS NULL
              OR content ILIKE '%' || $5 || '%'
              OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE '%' || $5 || '%')
          )
        ORDER BY confidence DESC, created_at DESC
        LIMIT $6
        "#,
    )
    .bind(&org_id)
    .bind(project_id)
    .bind(&query.kind)
    .bind(&query.source)
    .bind(&query.q)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok(Json(ApiResponse::new(memories)))
}

pub async fn delete_project_memory(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((project_id, memory_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ApiResponse<serde_json::Value>>, (StatusCode, Json<serde_json::Value>)> {
    let org_ids = auth_org_ids(&auth)?;
    project_org_id(&pool, project_id, &org_ids).await?;

    let deleted_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        DELETE FROM memories
        WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])
        RETURNING id
        "#,
    )
    .bind(memory_id)
    .bind(project_id)
    .bind(&org_ids)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    match deleted_id {
        Some(id) => Ok(Json(ApiResponse::new(json!({ "deleted": true, "id": id })))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Memory not found"})),
        )),
    }
}

pub async fn search_memory(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<SearchMemoryRequest>,
) -> Result<Json<ApiResponse<Vec<Memory>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_ids = auth_org_ids(&auth)?;
    let limit = body.limit.unwrap_or(20).clamp(1, 100);

    if let Some(kind) = body.kind.as_deref() {
        validate_kind(kind)?;
    }
    if let Some(source) = body.source.as_deref() {
        validate_source(source)?;
    }

    let project_id = match body.project_id.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(raw.parse::<Uuid>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "project_id must be a UUID"})),
            )
        })?),
        _ => None,
    };

    let memories = sqlx::query_as::<_, Memory>(
        r#"
        SELECT * FROM memories
        WHERE org_id = ANY($1::text[])
          AND ($2::uuid IS NULL OR project_id = $2)
          AND ($3::text IS NULL OR kind = $3)
          AND ($4::text IS NULL OR source = $4)
          AND ($5::text[] IS NULL OR tags && $5)
          AND (
              $6::text IS NULL
              OR content ILIKE '%' || $6 || '%'
              OR EXISTS (SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE '%' || $6 || '%')
              OR to_tsvector('simple', content) @@ plainto_tsquery('simple', $6)
          )
        ORDER BY
          CASE WHEN $6::text IS NULL THEN 0 ELSE ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', $6)) END DESC,
          confidence DESC,
          created_at DESC
        LIMIT $7
        "#,
    )
    .bind(&org_ids)
    .bind(project_id)
    .bind(&body.kind)
    .bind(&body.source)
    .bind(&body.tags)
    .bind(&body.q)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(memories)))
}

#[allow(dead_code)]
pub async fn record_memory_best_effort(pool: &PgPool, input: NewMemory) {
    if input.content.trim().is_empty() {
        return;
    }
    if let Err(e) = insert_memory(pool, input).await {
        tracing::warn!("memory insert failed: {}", e);
    }
}
