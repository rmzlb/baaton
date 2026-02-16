use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Comment};

#[derive(Debug, Deserialize)]
pub struct CreateComment {
    pub author_id: String,
    pub author_name: String,
    pub body: String,
}

pub async fn list_by_issue(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Comment>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify issue belongs to org
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

    let comments = sqlx::query_as::<_, Comment>(
        "SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC",
    )
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "comments.list query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(comments)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    Extension(novu): Extension<Option<crate::novu::NovuClient>>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateComment>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify issue belongs to org
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

    let comment = sqlx::query_as::<_, Comment>(
        r#"
        INSERT INTO comments (issue_id, author_id, author_name, body)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(&body.author_id)
    .bind(&body.author_name)
    .bind(&body.body)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // ── Novu notifications (fire-and-forget) ─────────────
    if let Some(ref novu) = novu {
        let novu = novu.clone();
        let pool = pool.clone();
        let commenter_id = body.author_id.clone();
        let commenter_name = body.author_name.clone();
        let comment_body = body.body.clone();

        tokio::spawn(async move {
            // Fetch issue to get assignees and display info
            let issue = sqlx::query_as::<_, (String, String, Vec<String>)>(
                "SELECT display_id, title, assignee_ids FROM issues WHERE id = $1",
            )
            .bind(issue_id)
            .fetch_optional(&pool)
            .await;

            let (display_id, title, assignee_ids) = match issue {
                Ok(Some(row)) => row,
                _ => return,
            };

            let preview = if comment_body.len() > 120 {
                format!("{}...", &comment_body[..120])
            } else {
                comment_body.clone()
            };

            // Notify assignees (exclude commenter)
            let assignees: Vec<String> = assignee_ids
                .iter()
                .filter(|id| **id != commenter_id)
                .cloned()
                .collect();

            if !assignees.is_empty() {
                let subs: Vec<crate::novu::Subscriber> = assignees
                    .into_iter()
                    .map(|id| crate::novu::Subscriber { id, email: None, name: None })
                    .collect();
                novu.trigger_many(
                    "comment-on-assigned-issue",
                    subs,
                    json!({
                        "actorName": commenter_name,
                        "issueId": display_id,
                        "issueTitle": title,
                        "commentPreview": preview,
                    }),
                );
            }

            // Notify @mentioned users (exclude commenter)
            let mentioned = crate::novu::parse_mentions(&comment_body);
            let mentioned: Vec<String> = mentioned
                .into_iter()
                .filter(|id| *id != commenter_id)
                .collect();

            if !mentioned.is_empty() {
                let subs: Vec<crate::novu::Subscriber> = mentioned
                    .into_iter()
                    .map(|id| crate::novu::Subscriber { id, email: None, name: None })
                    .collect();
                novu.trigger_many(
                    "mentioned-in-comment",
                    subs,
                    json!({
                        "actorName": commenter_name,
                        "issueId": display_id,
                        "issueTitle": title,
                        "commentPreview": preview,
                    }),
                );
            }
        });
    }

    Ok(Json(ApiResponse::new(comment)))
}
