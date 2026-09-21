//! Plan enforcement guard — reusable quota checks for all create endpoints.
//!
//! The plan belongs to the organization the action targets (see
//! `crate::entitlement`): quotas count **inside that org**, whoever clicks —
//! a member, or an API key created by a member. Superadmins bypass everything,
//! including through their API keys.
//!
//! Usage:
//! ```rust
//! enforce_quota(&pool, &auth, &org_id, QuotaKind::Projects).await?;
//! ```

use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;

use crate::entitlement::{effective_plan, human_actor, is_super_admin_actor};
use crate::middleware::AuthUser;
use crate::routes::admin::plan_limits;
use crate::routes::issues::fetch_user_org_ids;

/// What resource is being quota-checked
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // Orgs/AiMessages kept for upcoming plan-guard call-sites
pub enum QuotaKind {
    Orgs,
    Issues,
    Projects,
    ApiKeys,
    Automations,
    AiMessages,
}

impl QuotaKind {
    fn label(self) -> &'static str {
        match self {
            Self::Orgs => "organizations",
            Self::Issues => "issues",
            Self::Projects => "projects",
            Self::ApiKeys => "API keys",
            Self::Automations => "automations",
            Self::AiMessages => "AI messages",
        }
    }
}

/// Check that `org_id` is within its plan quota for the given resource.
/// Returns Ok(()) if allowed, Err(402) if the limit is reached.
///
/// `QuotaKind::Orgs` is the one per-human quota (how many orgs a person may
/// create) and `QuotaKind::AiMessages` is counted per human within the org's
/// plan; everything else is counted inside `org_id`.
pub async fn enforce_quota(
    pool: &PgPool,
    auth: &AuthUser,
    org_id: &str,
    kind: QuotaKind,
) -> Result<(), (StatusCode, axum::Json<serde_json::Value>)> {
    if is_super_admin_actor(pool, auth).await {
        return Ok(());
    }

    let plan = effective_plan(pool, auth, org_id).await;
    let limits = plan_limits(&plan);

    let (limit, current) = match kind {
        QuotaKind::Orgs => {
            let count = match human_actor(auth) {
                Some(user_id) => fetch_user_org_ids(user_id).await.unwrap_or_default().len() as i64,
                None => 0,
            };
            (limits.org_limit, count)
        }
        QuotaKind::Projects => {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE org_id = $1")
                .bind(org_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
            (limits.project_limit, count)
        }
        QuotaKind::Issues => {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1",
            )
            .bind(org_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);
            (limits.issue_limit, count)
        }
        QuotaKind::ApiKeys => {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_keys WHERE org_id = $1")
                .bind(org_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
            (limits.key_limit, count)
        }
        QuotaKind::Automations => {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM automation_rules ar JOIN projects p ON p.id = ar.project_id WHERE p.org_id = $1",
            )
            .bind(org_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);
            (limits.auto_limit, count)
        }
        QuotaKind::AiMessages => {
            let count: i64 = match human_actor(auth) {
                Some(user_id) => sqlx::query_scalar(
                    "SELECT COUNT(*) FROM ai_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())",
                )
                .bind(user_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0),
                None => 0,
            };
            (limits.ai_limit, count)
        }
    };

    // -1 means unlimited
    if limit < 0 {
        return Ok(());
    }

    if current >= limit {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            axum::Json(json!({
                "error": format!("{} limit reached for this organization's plan", kind.label()),
                "limit": limit,
                "current": current,
                "plan": plan,
                "org_id": org_id,
                "upgrade_url": "https://baaton.dev/#pricing"
            })),
        ));
    }

    Ok(())
}
