use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, IssueRelation};
use crate::routes::activity::log_activity;

// ─── Request / Response types ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateRelation {
    pub target_issue_id: Uuid,
    pub relation_type: String,
}

#[derive(Debug, Serialize)]
pub struct RelationsGrouped {
    pub blocks: Vec<IssueRelation>,
    pub blocked_by: Vec<IssueRelation>,
    pub relates_to: Vec<IssueRelation>,
    pub duplicate_of: Vec<IssueRelation>,
}

// ─── Helpers ──────────────────────────────────────────

const VALID_RELATION_TYPES: &[&str] = &["blocks", "blocked_by", "relates_to", "duplicate_of"];

/// Returns the inverse relation type, or None for duplicate_of (no inverse).
fn inverse_relation(rel_type: &str) -> Option<&'static str> {
    match rel_type {
        "blocks" => Some("blocked_by"),
        "blocked_by" => Some("blocks"),
        "relates_to" => Some("relates_to"),
        "duplicate_of" => None,
        _ => None,
    }
}

// ─── POST /issues/{id}/relations ──────────────────────

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateRelation>,
) -> Result<Json<ApiResponse<IssueRelation>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !VALID_RELATION_TYPES.contains(&body.relation_type.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Invalid relation_type '{}'. Accepted: {}", body.relation_type, VALID_RELATION_TYPES.join(", ")),
            "accepted_values": VALID_RELATION_TYPES,
            "field": "relation_type"
        }))));
    }

    if issue_id == body.target_issue_id {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Cannot relate an issue to itself"}))));
    }

    // Verify source issue belongs to org; capture its project_id
    let source_project_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT i.project_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let project_id = source_project_id
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Source issue not found"}))))?;

    // Verify target issue exists in org
    let target_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(body.target_issue_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !target_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Target issue not found"}))));
    }

    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let relation = sqlx::query_as::<_, IssueRelation>(
        r#"
        INSERT INTO issue_relations (source_issue_id, target_issue_id, relation_type, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (source_issue_id, target_issue_id, relation_type) DO UPDATE
            SET created_at = issue_relations.created_at
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(body.target_issue_id)
    .bind(&body.relation_type)
    .bind(&auth.user_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Auto-create inverse relation (blocks <-> blocked_by, relates_to <-> relates_to)
    if let Some(inverse) = inverse_relation(&body.relation_type) {
        let _ = sqlx::query(
            r#"
            INSERT INTO issue_relations (source_issue_id, target_issue_id, relation_type, created_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (source_issue_id, target_issue_id, relation_type) DO NOTHING
            "#,
        )
        .bind(body.target_issue_id)
        .bind(issue_id)
        .bind(inverse)
        .bind(&auth.user_id)
        .execute(tx.as_mut())
        .await;
    }

    // If duplicate_of: cancel the target issue and log activity
    if body.relation_type == "duplicate_of" {
        let old_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM issues WHERE id = $1"
        )
        .bind(body.target_issue_id)
        .fetch_optional(tx.as_mut())
        .await
        .ok()
        .flatten();

        let _ = sqlx::query(
            "UPDATE issues SET status = 'cancelled', updated_at = now() WHERE id = $1"
        )
        .bind(body.target_issue_id)
        .execute(tx.as_mut())
        .await;

        let _ = sqlx::query(
            r#"
            INSERT INTO activity_log (org_id, project_id, issue_id, user_id, user_name, action, field, old_value, new_value, metadata)
            VALUES ($1, $2, $3, $4, $5, 'status_changed', 'status', $6, 'cancelled', $7)
            "#,
        )
        .bind(org_id)
        .bind(project_id)
        .bind(body.target_issue_id)
        .bind(&auth.user_id)
        .bind(auth.display_name.as_deref())
        .bind(old_status.as_deref().unwrap_or("unknown"))
        .bind(json!({"reason": "marked_as_duplicate", "duplicate_of": issue_id.to_string()}))
        .execute(tx.as_mut())
        .await;
    }

    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Activity log (fire-and-forget)
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let oid = org_id.to_string();
        let rel_type = body.relation_type.clone();
        let target_str = body.target_issue_id.to_string();
        tokio::spawn(async move {
            log_activity(
                &pool2, &oid, Some(project_id), Some(issue_id),
                &uid, uname.as_deref(),
                "relation_added", Some("relation_type"),
                None, Some(&rel_type),
                Some(json!({"target_issue_id": target_str})),
            ).await;
        });
    }

    Ok(Json(ApiResponse::new(relation)))
}

// ─── GET /issues/{id}/relations ───────────────────────

pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<RelationsGrouped>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    let all = sqlx::query_as::<_, IssueRelation>(
        "SELECT * FROM issue_relations WHERE source_issue_id = $1 ORDER BY created_at ASC"
    )
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut grouped = RelationsGrouped {
        blocks: vec![],
        blocked_by: vec![],
        relates_to: vec![],
        duplicate_of: vec![],
    };

    for rel in all {
        match rel.relation_type.as_str() {
            "blocks" => grouped.blocks.push(rel),
            "blocked_by" => grouped.blocked_by.push(rel),
            "relates_to" => grouped.relates_to.push(rel),
            "duplicate_of" => grouped.duplicate_of.push(rel),
            _ => {}
        }
    }

    Ok(Json(ApiResponse::new(grouped)))
}

// ─── DELETE /issues/{id}/relations/{relation_id} ──────

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((issue_id, relation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    // Fetch the relation to find the inverse
    let relation: Option<IssueRelation> = sqlx::query_as(
        "SELECT * FROM issue_relations WHERE id = $1 AND source_issue_id = $2"
    )
    .bind(relation_id)
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let relation = relation
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Relation not found"}))))?;

    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    sqlx::query("DELETE FROM issue_relations WHERE id = $1")
        .bind(relation_id)
        .execute(tx.as_mut())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Delete inverse
    if let Some(inverse) = inverse_relation(&relation.relation_type) {
        let _ = sqlx::query(
            "DELETE FROM issue_relations WHERE source_issue_id = $1 AND target_issue_id = $2 AND relation_type = $3"
        )
        .bind(relation.target_issue_id)
        .bind(issue_id)
        .bind(inverse)
        .execute(tx.as_mut())
        .await;
    }

    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(())))
}
