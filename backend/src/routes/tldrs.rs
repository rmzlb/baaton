use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, CreateTldr, Tldr};

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<CreateTldr>,
) -> Result<Json<ApiResponse<Tldr>>, (StatusCode, Json<serde_json::Value>)> {
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

    let tldr = sqlx::query_as::<_, Tldr>(
        r#"
        INSERT INTO tldrs (issue_id, agent_name, summary, files_changed, tests_status, pr_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(issue_id)
    .bind(&body.agent_name)
    .bind(&body.summary)
    .bind(&body.files_changed.unwrap_or_default())
    .bind(body.tests_status.as_deref().unwrap_or("none"))
    .bind(&body.pr_url)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // ── Activity log + Gamification ──
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let oid = org_id.to_string();
        let iid = issue_id;
        let aname = body.agent_name.clone();
        // Get project_id for activity log
        let pid: Option<Uuid> = sqlx::query_scalar("SELECT project_id FROM issues WHERE id = $1")
            .bind(iid)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
        tokio::spawn(async move {
            crate::routes::activity::log_activity(
                &pool2, &oid, pid, Some(iid), &uid, uname.as_deref(),
                "tldr_posted", Some("agent_name"), None, Some(&aname), None,
            ).await;
            crate::routes::gamification::record_activity(&pool2, &uid, &oid, "tldr").await;
        });
    }

    // ── Webhook dispatch (fire-and-forget) ───────────
    crate::routes::webhooks::dispatch_event(
        pool.clone(),
        org_id.to_string(),
        "tldr.created",
        serde_json::to_value(&tldr).unwrap_or_default(),
    ).await;

    // AI-first: action hints
    let hints = vec![
        crate::models::ActionHint::recommended(
            "move_to_review",
            "TLDR posted. Move the issue to in_review so a human can verify the work.",
            Some(&format!("PATCH /issues/{} with status=in_review", issue_id)),
        ),
        crate::models::ActionHint::optional(
            "add_comment",
            "Add a comment with any additional context, blockers, or follow-up items.",
            Some(&format!("POST /issues/{}/comments", issue_id)),
        ),
    ];

    Ok(Json(ApiResponse::with_hints(tldr, hints)))
}
