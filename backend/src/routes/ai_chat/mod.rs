pub mod types;
pub mod convert;
pub mod stream;

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::{
        sse::{KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::time::Duration;

use crate::middleware::AuthUser;
use crate::routes::issues::resolve_user_org_ids_from_auth;
use types::ChatRequest;

const MAX_HISTORY_MESSAGES: usize = 40;

pub async fn chat_handler(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<ChatRequest>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let org_id = auth
        .org_id
        .as_deref()
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Organization required"})),
            )
        })?
        .to_string();

    let org_ids: Vec<String> = match resolve_user_org_ids_from_auth(&auth).await {
        Ok(ids) if !ids.is_empty() => ids,
        _ => {
            auth.org_id.as_ref().map(|id| vec![id.clone()]).unwrap_or_default()
        }
    };

    // ── Quota check (same as ai_agent.rs) ──
    let plan =
        crate::routes::admin::get_user_plan(&pool, &auth.user_id, Some(&org_id))
            .await;
    let limits = crate::routes::admin::plan_limits(&plan);
    let ai_limit: i64 = if limits.ai_limit < 0 {
        i64::MAX
    } else {
        limits.ai_limit
    };

    let ai_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ai_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())",
    )
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    if ai_count >= ai_limit {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            Json(json!({
                "error": "AI message quota exceeded for this month",
                "limit": ai_limit,
                "current": ai_count,
                "plan": plan,
                "upgrade_url": "https://baaton.dev/#pricing"
            })),
        ));
    }

    // ── Validate messages ──
    if body.messages.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "messages must not be empty"})),
        ));
    }

    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "AI service not configured"})),
            ));
        }
    };

    // Cap history length
    let messages = if body.messages.len() > MAX_HISTORY_MESSAGES {
        body.messages[body.messages.len() - MAX_HISTORY_MESSAGES..].to_vec()
    } else {
        body.messages
    };

    let contents = convert::ui_messages_to_gemini_contents(&messages);

    let sse_stream = stream::build_stream(
        pool,
        org_ids,
        auth.user_id,
        body.project_ids,
        contents,
        api_key,
    );

    let response = Sse::new(sse_stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
        .into_response();

    let mut response = response;
    response.headers_mut().insert(
        "x-vercel-ai-ui-message-stream",
        "v1".parse().unwrap(),
    );
    response.headers_mut().insert(
        "cache-control",
        "no-cache".parse().unwrap(),
    );

    Ok(response)
}
