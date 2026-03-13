//! Plan enforcement guard — reusable quota checks for all create endpoints.
//!
//! Usage:
//! ```rust
//! enforce_quota(&pool, org_id, &auth.user_id, QuotaKind::ApiKeys).await?;
//! ```

use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;

use crate::routes::admin::{get_user_plan, plan_limits};

/// What resource is being quota-checked
#[derive(Debug, Clone, Copy)]
pub enum QuotaKind {
    Issues,
    Projects,
    ApiKeys,
    Automations,
    AiMessages,
}

impl QuotaKind {
    fn label(self) -> &'static str {
        match self {
            Self::Issues => "issues",
            Self::Projects => "projects",
            Self::ApiKeys => "API keys",
            Self::Automations => "automations",
            Self::AiMessages => "AI messages",
        }
    }
}

/// Check if the org is within its plan quota for the given resource.
/// Returns Ok(()) if allowed, Err(402) if limit reached.
pub async fn enforce_quota(
    pool: &PgPool,
    org_id: &str,
    user_id: &str,
    kind: QuotaKind,
) -> Result<(), (StatusCode, axum::Json<serde_json::Value>)> {
    let plan = get_user_plan(pool, user_id, Some(org_id)).await;
    let limits = plan_limits(&plan);

    let (limit, count_query): (i64, &str) = match kind {
        QuotaKind::Issues => (
            limits.issue_limit,
            "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1",
        ),
        QuotaKind::Projects => (
            limits.project_limit,
            "SELECT COUNT(*) FROM projects WHERE org_id = $1",
        ),
        QuotaKind::ApiKeys => (
            limits.key_limit,
            "SELECT COUNT(*) FROM api_keys WHERE org_id = $1",
        ),
        QuotaKind::Automations => (
            limits.auto_limit,
            "SELECT COUNT(*) FROM automation_rules ar JOIN projects p ON p.id = ar.project_id WHERE p.org_id = $1",
        ),
        QuotaKind::AiMessages => {
            let month = chrono::Utc::now().format("%Y-%m").to_string();
            let count: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(count), 0)::bigint FROM api_request_log WHERE org_id = $1 AND month = $2",
            )
            .bind(org_id)
            .bind(&month)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

            if limits.ai_limit >= 0 && count >= limits.ai_limit {
                return Err((
                    StatusCode::PAYMENT_REQUIRED,
                    axum::Json(json!({
                        "error": format!("{} limit reached for your plan", kind.label()),
                        "limit": limits.ai_limit,
                        "current": count,
                        "plan": plan,
                        "upgrade_url": "https://baaton.dev/#pricing"
                    })),
                ));
            }
            return Ok(());
        }
    };

    // -1 means unlimited
    if limit < 0 {
        return Ok(());
    }

    let count: i64 = sqlx::query_scalar(count_query)
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    if count >= limit {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            axum::Json(json!({
                "error": format!("{} limit reached for your plan", kind.label()),
                "limit": limit,
                "current": count,
                "plan": plan,
                "upgrade_url": "https://baaton.dev/#pricing"
            })),
        ));
    }

    Ok(())
}
