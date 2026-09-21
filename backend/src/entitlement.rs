//! Entitlement resolution — which plan applies to an action, and for whom.
//!
//! The plan belongs to the **organization** (the workspace), as in Linear or
//! Notion: the owner pays, every member and every API key of the org consumes
//! the org's entitlement. Concretely, an org's effective plan is the highest of
//!
//! * `organizations.plan` — set by an org admin or a superadmin
//!   (`PATCH /admin/orgs/{id}/plan`);
//! * the `user_plans` row of the org's **owner** (Clerk `created_by`, cached in
//!   `organizations.owner_user_id`) — so a user who buys Pro, or is granted
//!   `unlimited` by a superadmin, carries it into every org they own.
//!
//! A human's own plan never follows them into an org they merely joined, with
//! one exception: the superadmin-granted plans (`partner`, `tester`,
//! `unlimited`, `enterprise`) are trust grants, not products, and apply to
//! everything that human does — directly or through the API keys they created.
//!
//! Quotas are counted **inside the org** (see `middleware::plan_guard`).

use sqlx::PgPool;

use crate::middleware::{ActorKind, AuthUser};
use crate::routes::admin::{get_user_plan, is_super_admin_quick};

/// Free < Pro < the unlimited family. Unknown values are treated as free.
pub fn plan_rank(plan: &str) -> u8 {
    match plan {
        "pro" => 1,
        "enterprise" | "partner" | "tester" | "unlimited" => 2,
        _ => 0,
    }
}

fn higher<'a>(a: &'a str, b: &'a str) -> &'a str {
    if plan_rank(b) > plan_rank(a) {
        b
    } else {
        a
    }
}

/// The human responsible for the request: the caller for a Clerk session, the
/// key's creator for an API key. `None` for keys whose creator is unknown.
pub fn human_actor(auth: &AuthUser) -> Option<&str> {
    match auth.actor_kind {
        ActorKind::ApiKey => auth.on_behalf_of.as_deref(),
        _ => Some(auth.user_id.as_str()),
    }
}

/// Superadmins bypass every quota — including through the API keys they created.
pub async fn is_super_admin_actor(pool: &PgPool, auth: &AuthUser) -> bool {
    match human_actor(auth) {
        Some(user_id) => is_super_admin_quick(pool, user_id).await,
        None => false,
    }
}

/// The plan an organization is entitled to: its own plan, raised to its
/// owner's plan. Unknown org → free.
pub async fn org_plan(pool: &PgPool, org_id: &str) -> String {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT o.plan, o.owner_user_id FROM organizations o WHERE o.id = $1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (plan, owner) = match row {
        Some((plan, owner)) => (plan.unwrap_or_else(|| "free".to_string()), owner),
        None => ("free".to_string(), None),
    };
    match owner {
        Some(ref owner_id) if !owner_id.is_empty() => {
            let owner_plan = get_user_plan(pool, owner_id, None).await;
            higher(&plan, &owner_plan).to_string()
        }
        _ => plan,
    }
}

/// The plan that governs `auth` acting inside `org_id`: the org's plan, raised
/// by a superadmin-granted plan on the human behind the request.
pub async fn effective_plan(pool: &PgPool, auth: &AuthUser, org_id: &str) -> String {
    let plan = org_plan(pool, org_id).await;
    if plan_rank(&plan) == 2 {
        return plan;
    }
    match human_actor(auth) {
        Some(user_id) => {
            let granted = get_user_plan(pool, user_id, None).await;
            if plan_rank(&granted) == 2 {
                granted
            } else {
                plan
            }
        }
        None => plan,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_are_ordered_free_pro_unlimited() {
        assert_eq!(plan_rank("free"), 0);
        assert_eq!(plan_rank("pro"), 1);
        for special in ["enterprise", "partner", "tester", "unlimited"] {
            assert_eq!(plan_rank(special), 2, "{special}");
        }
        // An unknown label never grants anything.
        assert_eq!(plan_rank("platinum"), 0);
    }

    #[test]
    fn the_higher_plan_wins_and_ties_keep_the_org_label() {
        assert_eq!(higher("free", "pro"), "pro");
        assert_eq!(higher("pro", "free"), "pro");
        assert_eq!(higher("unlimited", "pro"), "unlimited");
        assert_eq!(higher("enterprise", "unlimited"), "enterprise");
    }
}
