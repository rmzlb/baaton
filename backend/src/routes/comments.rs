use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Comment};
use crate::routes::activity::log_activity;
use crate::routes::notifications::create_notification;
use crate::routes::sse::{EventSender, broadcast_event};
use crate::routes::webhooks::dispatch_event;

#[derive(Debug, Deserialize)]
pub struct CreateComment {
    /// Optional: auto-filled from API key name or Clerk user if omitted.
    ///
    /// Rejected when it names a *different* principal than the caller: this is
    /// the identity comment ownership and edit rights are keyed on, so letting
    /// any key claim `user_<clerk_id>` was impersonation with write rights, not
    /// display metadata. Use `on_behalf_of_name` / `on_behalf_of_email` to
    /// record an external requester.
    pub author_id: Option<String>,
    /// Optional: auto-filled from API key name or Clerk display_name if omitted
    pub author_name: Option<String>,
    pub body: String,
    /// Free-text name of the person this comment is posted for. Never used for
    /// authorization — display and reporting only, and shown as unverified.
    pub on_behalf_of_name: Option<String>,
    /// Free-text email of that person. Not tied to a Baaton account.
    pub on_behalf_of_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateComment {
    pub body: String,
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

/// Resolve any caller/author identity to its underlying human owner.
///
/// API-key identities (`apikey:<uuid>`) map to the key's `created_by` user, so
/// a human and every API key they created share a single ownership identity.
/// This lets a human edit/delete comments their own key posted (and vice-versa)
/// while still blocking unrelated users and unrelated keys.
async fn resolve_owner_identity(pool: &PgPool, identity: &str) -> String {
    if let Some(key_id_str) = identity.strip_prefix("apikey:") {
        if let Ok(key_id) = Uuid::parse_str(key_id_str) {
            let owner: Option<String> = sqlx::query_scalar(
                "SELECT created_by FROM api_keys WHERE id = $1",
            )
            .bind(key_id)
            .fetch_one(pool)
            .await
            .unwrap_or(None);
            if let Some(owner) = owner {
                return owner;
            }
        }
    }
    identity.to_string()
}

/// Check issue belongs to ANY of the user's scoped orgs (for all_dynamic keys)
async fn verify_issue_org_any(pool: &PgPool, issue_id: Uuid, org_ids: &[String]) -> Result<bool, (StatusCode, Json<serde_json::Value>)> {
    if org_ids.is_empty() {
        return Ok(false);
    }
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2))"
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "verify_issue_org_any query failed");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Database error"})))
    })
}

pub async fn list_by_issue(
    Extension(auth): Extension<AuthUser>,
    Extension(s3): Extension<Option<std::sync::Arc<crate::s3::S3State>>>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Comment>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !verify_issue_org(&pool, issue_id, org_id).await? && !verify_issue_org_any(&pool, issue_id, &auth.scoped_org_ids).await? {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    let mut comments = sqlx::query_as::<_, Comment>(
        "SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC",
    )
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "comments.list query failed");
        vec![]
    });

    let s3_ref = s3.as_deref();
    for c in comments.iter_mut() {
        crate::s3::rewrite_str(&mut c.body, s3_ref).await;
    }

    Ok(Json(ApiResponse::new(comments)))
}

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    Extension(novu): Extension<Option<crate::novu::NovuClient>>,
    Extension(sse_tx): Extension<EventSender>,
    Extension(s3): Extension<Option<std::sync::Arc<crate::s3::S3State>>>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateComment>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !verify_issue_org(&pool, issue_id, org_id).await? && !verify_issue_org_any(&pool, issue_id, &auth.scoped_org_ids).await? {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    if body.body.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Comment body cannot be empty"}))));
    }
    if body.body.len() > 50_000 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Comment body must be under 50000 characters"}))));
    }

    // Collapse presigned baaton-uploads URLs back to stable s3:// markers so the
    // DB never holds short-lived URLs.
    let body_text = crate::s3::collapse_to_markers(&body.body);

    // Auto-fill author from auth context if not provided.
    // `author_id` stays the *acting* identity (`apikey:<id>` for agents): comment
    // ownership and edit rights are keyed on it, and collapsing it to the human
    // would make "which key posted this" unrecoverable. The human behind an API
    // key is recorded separately in `on_behalf_of` (migration 068).
    //
    // An override may only *restate* the caller's own identity. Accepting an
    // arbitrary value let any API key post as `user_<clerk_id>` and inherit that
    // human's edit/delete rights (`resolve_owner_identity` keys on `author_id`).
    // External requesters go in `on_behalf_of_name` / `on_behalf_of_email`,
    // which carry no rights.
    if let Some(requested) = body.author_id.as_deref() {
        if requested != auth.user_id {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({
                    "error": "author_id cannot name a different principal than the caller",
                    "hint": "Omit author_id. To credit an external person, use on_behalf_of_name / on_behalf_of_email.",
                    "caller": auth.user_id,
                })),
            ));
        }
    }

    let author_id = body.author_id.unwrap_or_else(|| auth.user_id.clone());
    let author_name = body.author_name.unwrap_or_else(|| {
        auth.display_name.clone()
            .or(auth.email.clone())
            .unwrap_or_else(|| auth.user_id.clone())
    });
    let actor = crate::routes::activity::ActorContext::from_auth(&auth);
    let on_behalf_of = auth.on_behalf_of.clone();

    // Declared requester identity: display/reporting only, never authorization.
    let declared_name = body
        .on_behalf_of_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 200)
        .map(str::to_string);
    let declared_email = body
        .on_behalf_of_email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 320)
        .map(str::to_string);

    let mut comment = sqlx::query_as::<_, Comment>(
        r#"
        INSERT INTO comments (issue_id, author_id, author_name, body, actor_type, actor_key_id, on_behalf_of,
                              on_behalf_of_name, on_behalf_of_email)
        VALUES ($1, $2, $3, $4, $5, $6,
                COALESCE($7, (SELECT created_by FROM api_keys WHERE id = $6)),
                $8, $9)
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(&author_id)
    .bind(&author_name)
    .bind(&body_text)
    .bind(actor.kind.as_str())
    .bind(actor.key_id)
    .bind(on_behalf_of.as_deref())
    .bind(declared_name.as_deref())
    .bind(declared_email.as_deref())
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // ── Gamification: award XP for comment (fire-and-forget) ──
    // Humans only. An API key commenting for a human is attributed to them in
    // the audit trail, but must not earn them XP.
    if actor.kind.earns_gamification() {
        let pool2 = pool.clone();
        let uid = author_id.clone();
        let oid = org_id.to_string();
        tokio::spawn(async move {
            crate::routes::gamification::record_activity(&pool2, &uid, &oid, "comment").await;
        });
    }

    // ── Novu notifications (fire-and-forget) ─────────────
    if let Some(ref novu) = novu {
        let novu = novu.clone();
        let pool = pool.clone();
        let commenter_id = author_id.clone();
        let commenter_name = author_name.clone();
        let comment_body = body.body.clone();

        tokio::spawn(async move {
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

            let preview = if comment_body.chars().count() > 120 {
                crate::text::truncate_ascii_ellipsis(&comment_body, 120)
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

    // ── Activity log (fire-and-forget) ───────────────────
    {
        let pool2 = pool.clone();
        let uid = author_id.clone();
        let uname_opt = Some(author_name.clone());
        let comment_preview = if body.body.chars().count() > 120 {
            crate::text::truncate_ascii_ellipsis(&body.body, 120)
        } else {
            body.body.clone()
        };
        let oid = org_id.to_string();
        tokio::spawn(async move {
            // Fetch project_id for the issue
            let pid: Option<uuid::Uuid> = sqlx::query_scalar("SELECT project_id FROM issues WHERE id = $1")
                .bind(issue_id)
                .fetch_optional(&pool2)
                .await
                .ok()
                .flatten();
            log_activity(
                &pool2, &oid, pid, Some(issue_id), &uid, uname_opt.as_deref(),
                "comment_added", None, None, None,
                Some(serde_json::json!({"preview": comment_preview})),
            ).await;
        });
    }

    // ── Internal notifications (fire-and-forget) ─────────
    {
        let pool2 = pool.clone();
        let oid = org_id.to_string();
        let commenter = author_id.clone();
        let preview = if body.body.chars().count() > 80 {
            crate::text::truncate_ascii_ellipsis(&body.body, 80)
        } else {
            body.body.clone()
        };
        tokio::spawn(async move {
            // Fetch issue creator + assignees
            let row: Option<(Option<String>, Vec<String>, Uuid)> = sqlx::query_as(
                "SELECT created_by_id, assignee_ids, project_id FROM issues WHERE id = $1"
            )
            .bind(issue_id)
            .fetch_optional(&pool2)
            .await
            .ok()
            .flatten();

            if let Some((creator_id, assignee_ids, project_id)) = row {
                let notif_body = Some(preview.as_str());
                let title = "New comment on an issue you're involved in";

                // Collect unique recipients (creator + assignees, exclude commenter)
                let mut recipients: Vec<String> = assignee_ids
                    .into_iter()
                    .filter(|uid| *uid != commenter)
                    .collect();
                if let Some(ref cid) = creator_id {
                    if *cid != commenter && !recipients.contains(cid) {
                        recipients.push(cid.clone());
                    }
                }

                for uid in recipients {
                    create_notification(
                        &pool2, &uid, &oid, "comment_added",
                        Some(issue_id), Some(project_id),
                        title, notif_body,
                    ).await;
                }
            }
        });
    }

    // ── Webhook dispatch (fire-and-forget) ───────────
    dispatch_event(pool.clone(), org_id.to_string(), "comment.created", serde_json::to_value(&comment).unwrap_or_default()).await;

    // ── SSE broadcast ────────────────────────────────
    broadcast_event(&sse_tx, org_id, "comment.created", &serde_json::to_string(&comment).unwrap_or_default());

    // AI-first: action hints
    let hints = vec![
        crate::models::ActionHint::recommended(
            "update_status",
            "Comment added. If this comment resolves the issue or unblocks work, update the issue status.",
            Some(&format!("PATCH /issues/{}", issue_id)),
        ),
        crate::models::ActionHint::optional(
            "add_tldr",
            "If this comment summarizes completed work, consider adding a structured TLDR instead.",
            Some(&format!("POST /issues/{}/tldr", issue_id)),
        ),
    ];

    // Rewrite S3 markers in body to presigned HTTPS URLs before returning.
    crate::s3::rewrite_str(&mut comment.body, s3.as_deref()).await;

    Ok(Json(ApiResponse::with_hints(comment, hints)))
}

/// PATCH /api/v1/issues/{issue_id}/comments/{comment_id}
///
/// Edit a comment's body. Permission model: ownership is tied to `author_id`,
/// which is auto-filled with the caller's identity at creation (the API key id
/// for agents, the Clerk user id for humans). API-key authors are mapped to the
/// human who created the key (`resolve_owner_identity`), so a human can edit
/// comments posted by their own keys and vice-versa. Admins may delete any
/// comment but may only edit their own (or their keys').
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    Extension(s3): Extension<Option<std::sync::Arc<crate::s3::S3State>>>,
    State(pool): State<PgPool>,
    Path((issue_id, comment_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateComment>,
) -> Result<Json<ApiResponse<Comment>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !verify_issue_org(&pool, issue_id, org_id).await? && !verify_issue_org_any(&pool, issue_id, &auth.scoped_org_ids).await? {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    if body.body.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Comment body cannot be empty"}))));
    }
    if body.body.len() > 50_000 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Comment body must be under 50000 characters"}))));
    }

    // Fetch current author to enforce ownership.
    let author_id: Option<String> = sqlx::query_scalar(
        "SELECT author_id FROM comments WHERE id = $1 AND issue_id = $2",
    )
    .bind(comment_id)
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let author_id = author_id
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Comment not found"}))))?;

    // Edit is restricted to the author identity. API-key authors resolve to the
    // human who owns the key, so a human and their keys count as one author.
    // The caller side needs no DB lookup: auth already carries `on_behalf_of`.
    let caller_owner = auth.responsible_user_id().to_string();
    let comment_owner = resolve_owner_identity(&pool, &author_id).await;
    if comment_owner != caller_owner {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "You can only edit your own comments"}))));
    }

    // Collapse presigned baaton-uploads URLs back to stable s3:// markers so the
    // DB never holds short-lived URLs.
    let body_text = crate::s3::collapse_to_markers(&body.body);

    let mut comment = sqlx::query_as::<_, Comment>(
        r#"
        UPDATE comments
        SET body = $1, updated_at = now()
        WHERE id = $2 AND issue_id = $3
        RETURNING *
        "#,
    )
    .bind(&body_text)
    .bind(comment_id)
    .bind(issue_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tracing::info!(
        user_id = %auth.user_id,
        comment_id = %comment_id,
        issue_id = %issue_id,
        "comments.update"
    );

    // ── Activity log (fire-and-forget) ───────────────────
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname_opt = auth.created_by_label();
        let comment_preview = if body.body.chars().count() > 120 {
            crate::text::truncate_ascii_ellipsis(&body.body, 120)
        } else {
            body.body.clone()
        };
        let oid = org_id.to_string();
        tokio::spawn(async move {
            let pid: Option<uuid::Uuid> = sqlx::query_scalar("SELECT project_id FROM issues WHERE id = $1")
                .bind(issue_id)
                .fetch_optional(&pool2)
                .await
                .ok()
                .flatten();
            log_activity(
                &pool2, &oid, pid, Some(issue_id), &uid, uname_opt.as_deref(),
                "comment_updated", None, None, None,
                Some(serde_json::json!({"preview": comment_preview})),
            ).await;
        });
    }

    // ── Webhook dispatch (fire-and-forget) ───────────
    dispatch_event(pool.clone(), org_id.to_string(), "comment.updated", serde_json::to_value(&comment).unwrap_or_default()).await;

    // ── SSE broadcast ────────────────────────────────
    broadcast_event(&sse_tx, org_id, "comment.updated", &serde_json::to_string(&comment).unwrap_or_default());

    // Rewrite S3 markers in body to presigned HTTPS URLs before returning.
    crate::s3::rewrite_str(&mut comment.body, s3.as_deref()).await;

    Ok(Json(ApiResponse::new(comment)))
}

/// DELETE /api/v1/issues/{issue_id}/comments/{comment_id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    Extension(sse_tx): Extension<EventSender>,
    State(pool): State<PgPool>,
    Path((issue_id, comment_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !verify_issue_org(&pool, issue_id, org_id).await? && !verify_issue_org_any(&pool, issue_id, &auth.scoped_org_ids).await? {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))));
    }

    // Permission model: admins may delete any comment; everyone else may only
    // delete their own (ownership tied to author_id == caller identity).
    let author_id: Option<String> = sqlx::query_scalar(
        "SELECT author_id FROM comments WHERE id = $1 AND issue_id = $2",
    )
    .bind(comment_id)
    .bind(issue_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let author_id = author_id
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Comment not found"}))))?;

    if !auth.is_admin() {
        let caller_owner = auth.responsible_user_id().to_string();
        let comment_owner = resolve_owner_identity(&pool, &author_id).await;
        if comment_owner != caller_owner {
            return Err((StatusCode::FORBIDDEN, Json(json!({"error": "You can only delete your own comments"}))));
        }
    }

    let result = sqlx::query("DELETE FROM comments WHERE id = $1 AND issue_id = $2")
        .bind(comment_id)
        .bind(issue_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Comment not found"}))));
    }

    tracing::info!(
        user_id = %auth.user_id,
        comment_id = %comment_id,
        issue_id = %issue_id,
        "comments.remove"
    );

    // ── Webhook dispatch (fire-and-forget) ───────────
    dispatch_event(pool.clone(), org_id.to_string(), "comment.deleted", serde_json::json!({"id": comment_id.to_string(), "issue_id": issue_id.to_string()})).await;

    // ── SSE broadcast ────────────────────────────────
    broadcast_event(&sse_tx, org_id, "comment.deleted", &format!(r#"{{"id":"{}","issue_id":"{}"}}"#, comment_id, issue_id));

    Ok(Json(ApiResponse::new(())))
}
