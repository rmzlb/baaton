use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Comment};
use crate::routes::activity::log_activity;
use crate::routes::webhooks::dispatch_event;

#[derive(Debug, Deserialize)]
pub struct CreateApprovalRequest {
    pub action: String,
    pub description: String,
    pub confidence: Option<f64>,
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ApprovalResponse {
    pub approval_comment_id: Uuid,
    pub decision: String,
    pub comment: Option<String>,
}

/// Verify issue belongs to caller's org. Returns true if it exists.
async fn verify_issue_org(pool: &PgPool, issue_id: Uuid, org_id: &str) -> Result<bool, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = $2)"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "verify_issue_org query failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
    })
}

/// POST /issues/{id}/approval-request
pub async fn create_approval_request(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateApprovalRequest>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !verify_issue_org(&pool, issue_id, org_id).await? {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    if body.action.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Action is required"}))));
    }
    if body.description.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Description is required"}))));
    }

    let author_id = auth.user_id.clone();
    let author_name = auth.display_name.clone()
        .or(auth.email.clone())
        .unwrap_or_else(|| auth.user_id.clone());

    let metadata = json!({
        "action": body.action,
        "description": body.description,
        "confidence": body.confidence,
        "options": body.options.unwrap_or_else(|| vec!["approve".to_string(), "reject".to_string()]),
    });

    let comment = sqlx::query_as::<_, Comment>(
        r#"
        INSERT INTO comments (issue_id, author_id, author_name, body, comment_type, approval_status, approval_metadata)
        VALUES ($1, $2, $3, $4, 'approval_request', 'pending', $5)
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(&author_id)
    .bind(&author_name)
    .bind(&body.description)
    .bind(&metadata)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Activity log
    {
        let pool2 = pool.clone();
        let uid = author_id.clone();
        let uname_opt = Some(author_name.clone());
        let oid = org_id.to_string();
        let action_name = body.action.clone();
        tokio::spawn(async move {
            let pid: Option<Uuid> = sqlx::query_scalar("SELECT project_id FROM issues WHERE id = $1")
                .bind(issue_id)
                .fetch_optional(&pool2)
                .await
                .ok()
                .flatten();
            log_activity(
                &pool2, &oid, pid, Some(issue_id), &uid, uname_opt.as_deref(),
                "approval_requested", None, None, None,
                Some(json!({"action": action_name})),
            ).await;
        });
    }

    // Webhook
    dispatch_event(pool.clone(), org_id.to_string(), "issue.approval_requested", serde_json::to_value(&comment).unwrap_or_default()).await;

    Ok(Json(ApiResponse::new(comment)))
}

/// POST /issues/{id}/approval-response
pub async fn create_approval_response(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<ApprovalResponse>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !verify_issue_org(&pool, issue_id, org_id).await? {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    // Validate decision
    let valid_decisions = ["approved", "rejected", "request_changes"];
    if !valid_decisions.contains(&body.decision.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Invalid decision '{}'. Accepted: {}", body.decision, valid_decisions.join(", ")),
        }))));
    }

    // Verify the approval comment exists and is pending
    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT comment_type, COALESCE(approval_status, '') FROM comments WHERE id = $1 AND issue_id = $2"
    )
    .bind(body.approval_comment_id)
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match existing {
        None => return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Approval comment not found"})))),
        Some((ctype, status)) => {
            if ctype != "approval_request" {
                return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Comment is not an approval request"}))));
            }
            if status != "pending" {
                return Err((StatusCode::BAD_REQUEST, Json(json!({"error": format!("Approval already resolved: {}", status)}))));
            }
        }
    }

    let responder_name = auth.display_name.clone()
        .or(auth.email.clone())
        .unwrap_or_else(|| auth.user_id.clone());

    // Update the original approval comment with the decision
    let updated = sqlx::query_as::<_, Comment>(
        r#"
        UPDATE comments
        SET approval_status = $1,
            approval_metadata = COALESCE(approval_metadata, '{}'::jsonb) || jsonb_build_object(
                'decision', $1::text,
                'decided_by', $2::text,
                'decided_by_name', $3::text,
                'decided_at', NOW()::text,
                'decision_comment', $4::text
            ),
            updated_at = NOW()
        WHERE id = $5 AND issue_id = $6
        RETURNING *
        "#,
    )
    .bind(&body.decision)
    .bind(&auth.user_id)
    .bind(&responder_name)
    .bind(&body.comment.clone().unwrap_or_default())
    .bind(body.approval_comment_id)
    .bind(issue_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Activity log
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname_opt = Some(responder_name.clone());
        let oid = org_id.to_string();
        let decision = body.decision.clone();
        tokio::spawn(async move {
            let pid: Option<Uuid> = sqlx::query_scalar("SELECT project_id FROM issues WHERE id = $1")
                .bind(issue_id)
                .fetch_optional(&pool2)
                .await
                .ok()
                .flatten();
            log_activity(
                &pool2, &oid, pid, Some(issue_id), &uid, uname_opt.as_deref(),
                "approval_decision", None, None, Some(&decision),
                None,
            ).await;
        });
    }

    // Webhook: dispatch approval decision
    dispatch_event(pool.clone(), org_id.to_string(), "issue.approval_decision", serde_json::to_value(&updated).unwrap_or_default()).await;

    Ok(Json(ApiResponse::new(updated)))
}
