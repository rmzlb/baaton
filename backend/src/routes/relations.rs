use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet, VecDeque};
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

// ─── Dependency Graph types ────────────────────────────

#[derive(Debug, Serialize)]
pub struct DependencyNode {
    pub id: String,
    pub display_id: String,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DependencyEdge {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String,
}

#[derive(Debug, Serialize)]
pub struct BlockedIssue {
    pub id: String,
    pub display_id: String,
    pub title: String,
    pub blocked_by: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DependencyGraph {
    pub nodes: Vec<DependencyNode>,
    pub edges: Vec<DependencyEdge>,
    pub suggested_order: Vec<String>,
    pub blocked_issues: Vec<BlockedIssue>,
}

// ─── GET /projects/{id}/dependency-graph ──────────────

pub async fn dependency_graph(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<DependencyGraph>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    // Fetch all issues in the project
    let issues = sqlx::query_as::<_, (Uuid, String, String, String, Option<String>)>(
        "SELECT id, display_id, title, status, priority FROM issues WHERE project_id = $1 ORDER BY created_at ASC"
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Build ID → display_id map
    let id_to_display: HashMap<Uuid, String> = issues.iter()
        .map(|(id, did, _, _, _)| (*id, did.clone()))
        .collect();

    // Fetch all "blocks" relations for issues in this project
    let raw_edges = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"
        SELECT r.source_issue_id, r.target_issue_id, r.relation_type
        FROM issue_relations r
        JOIN issues i ON i.id = r.source_issue_id
        WHERE i.project_id = $1
          AND r.relation_type IN ('blocks', 'blocked_by', 'relates_to', 'duplicate_of')
        "#,
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Build nodes
    let nodes: Vec<DependencyNode> = issues.iter().map(|(id, did, title, status, priority)| {
        DependencyNode {
            id: id.to_string(),
            display_id: did.clone(),
            title: title.clone(),
            status: status.clone(),
            priority: priority.clone(),
        }
    }).collect();

    // Build edges (deduplicate for blocks/blocked_by pairs — keep blocks direction only)
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();
    let mut edges: Vec<DependencyEdge> = Vec::new();

    for (src, tgt, rel_type) in &raw_edges {
        let src_str = src.to_string();
        let tgt_str = tgt.to_string();
        // For blocks/blocked_by pairs, only emit the "blocks" direction
        if rel_type == "blocked_by" {
            continue;
        }
        let key = (src_str.clone(), tgt_str.clone());
        if !seen_edges.contains(&key) {
            seen_edges.insert(key);
            edges.push(DependencyEdge {
                source: src_str,
                target: tgt_str,
                edge_type: rel_type.clone(),
            });
        }
    }

    // Build blocked issues: issues that are blocked by unresolved blockers
    // "blocks" means: source blocks target. So target is blocked by source.
    let issue_status: HashMap<Uuid, String> = issues.iter()
        .map(|(id, _, _, status, _)| (*id, status.clone()))
        .collect();

    // For each issue: collect which display_ids block it (where blocker is not done/cancelled)
    let mut blocked_map: HashMap<Uuid, Vec<String>> = HashMap::new();
    for (src, tgt, rel_type) in &raw_edges {
        if rel_type == "blocks" {
            let blocker_status = issue_status.get(src).map(|s| s.as_str()).unwrap_or("");
            if blocker_status != "done" && blocker_status != "cancelled" {
                if let Some(blocker_did) = id_to_display.get(src) {
                    blocked_map.entry(*tgt).or_default().push(blocker_did.clone());
                }
            }
        }
    }

    let blocked_issues: Vec<BlockedIssue> = blocked_map.into_iter()
        .filter_map(|(issue_id, blockers)| {
            let issue = issues.iter().find(|(id, _, _, _, _)| *id == issue_id)?;
            Some(BlockedIssue {
                id: issue_id.to_string(),
                display_id: issue.1.clone(),
                title: issue.2.clone(),
                blocked_by: blockers,
            })
        })
        .collect();

    // Topological sort for suggested_order (Kahn's algorithm)
    // Only include non-done, non-cancelled issues with no unresolved blockers
    let active_ids: HashSet<Uuid> = issues.iter()
        .filter(|(_, _, _, status, _)| status != "done" && status != "cancelled")
        .map(|(id, _, _, _, _)| *id)
        .collect();

    // Build adjacency for "blocks" edges among active issues only
    let mut in_degree: HashMap<Uuid, usize> = active_ids.iter().map(|id| (*id, 0)).collect();
    let mut adj: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

    for (src, tgt, rel_type) in &raw_edges {
        if rel_type == "blocks" && active_ids.contains(src) && active_ids.contains(tgt) {
            adj.entry(*src).or_default().push(*tgt);
            *in_degree.entry(*tgt).or_insert(0) += 1;
        }
    }

    let mut queue: VecDeque<Uuid> = in_degree.iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(id, _)| *id)
        .collect();

    // Sort queue for deterministic output (by display_id)
    let mut queue_vec: Vec<Uuid> = queue.drain(..).collect();
    queue_vec.sort_by_key(|id| id_to_display.get(id).cloned().unwrap_or_default());
    queue = queue_vec.into();

    let mut suggested_order: Vec<String> = Vec::new();

    while let Some(node) = queue.pop_front() {
        if let Some(did) = id_to_display.get(&node) {
            suggested_order.push(did.clone());
        }
        if let Some(neighbors) = adj.get(&node) {
            let mut next_batch: Vec<Uuid> = Vec::new();
            for &neighbor in neighbors {
                let deg = in_degree.entry(neighbor).or_insert(0);
                *deg = deg.saturating_sub(1);
                if *deg == 0 {
                    next_batch.push(neighbor);
                }
            }
            next_batch.sort_by_key(|id| id_to_display.get(id).cloned().unwrap_or_default());
            for n in next_batch {
                queue.push_back(n);
            }
        }
    }

    Ok(Json(ApiResponse::new(DependencyGraph {
        nodes,
        edges,
        suggested_order,
        blocked_issues,
    })))
}
