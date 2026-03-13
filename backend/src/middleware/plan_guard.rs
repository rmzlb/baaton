//! Plan enforcement guard — reusable quota checks for all create endpoints.
//! Plans are per-USER. Quotas count across ALL the user's organizations.
//!
//! Usage:
//! ```rust
//! enforce_quota(&pool, &auth, QuotaKind::Projects).await?;
//! ```

use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;

use crate::middleware::AuthUser;
use crate::routes::admin::{get_user_plan, plan_limits, is_super_admin_quick};
use crate::routes::issues::fetch_user_org_ids;

/// What resource is being quota-checked
#[derive(Debug, Clone, Copy)]
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

/// Check if the USER is within their plan quota for the given resource.
/// Counts across ALL the user's organizations.
/// Returns Ok(()) if allowed, Err(402) if limit reached.
/// Super admins always bypass quotas.
pub async fn enforce_quota(
    pool: &PgPool,
    auth: &AuthUser,
    kind: QuotaKind,
) -> Result<(), (StatusCode, axum::Json<serde_json::Value>)> {
    // Super admins bypass all quotas
    if is_super_admin_quick(pool, &auth.user_id).await {
        return Ok(());
    }

    let plan = get_user_plan(pool, &auth.user_id, None).await;
    let limits = plan_limits(&plan);

    // Resolve all user's org IDs for cross-org counting
    let org_ids = fetch_user_org_ids(&auth.user_id).await.unwrap_or_default();
    // Include current org if not already in list
    let mut all_orgs = org_ids;
    if let Some(ref current) = auth.org_id {
        if !all_orgs.contains(current) {
            all_orgs.push(current.clone());
        }
    }

    let (limit, current) = match kind {
        QuotaKind::Orgs => {
            (limits.org_limit, all_orgs.len() as i64)
        }
        QuotaKind::Projects => {
            let count: i64 = if all_orgs.is_empty() { 0 } else {
                sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE org_id = ANY($1)")
                    .bind(&all_orgs).fetch_one(pool).await.unwrap_or(0)
            };
            (limits.project_limit, count)
        }
        QuotaKind::Issues => {
            let count: i64 = if all_orgs.is_empty() { 0 } else {
                sqlx::query_scalar(
                    "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1)"
                ).bind(&all_orgs).fetch_one(pool).await.unwrap_or(0)
            };
            (limits.issue_limit, count)
        }
        QuotaKind::ApiKeys => {
            let count: i64 = if all_orgs.is_empty() { 0 } else {
                sqlx::query_scalar("SELECT COUNT(*) FROM api_keys WHERE org_id = ANY($1)")
                    .bind(&all_orgs).fetch_one(pool).await.unwrap_or(0)
            };
            (limits.key_limit, count)
        }
        QuotaKind::Automations => {
            let count: i64 = if all_orgs.is_empty() { 0 } else {
                sqlx::query_scalar(
                    "SELECT COUNT(*) FROM automation_rules ar JOIN projects p ON p.id = ar.project_id WHERE p.org_id = ANY($1)"
                ).bind(&all_orgs).fetch_one(pool).await.unwrap_or(0)
            };
            (limits.auto_limit, count)
        }
        QuotaKind::AiMessages => {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM ai_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())"
            ).bind(&auth.user_id).fetch_one(pool).await.unwrap_or(0);
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
                "error": format!("{} limit reached for your plan", kind.label()),
                "limit": limit,
                "current": current,
                "plan": plan,
                "upgrade_url": "https://baaton.dev/#pricing"
            })),
        ));
    }

    Ok(())
}
