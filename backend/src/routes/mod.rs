use axum::{Router, routing::{get, post, put, patch, delete}, middleware as axum_mw, extract::DefaultBodyLimit};
use sqlx::PgPool;

use crate::middleware::{auth_middleware, JwksKeys};

mod projects;
mod issues;
mod comments;
mod tldrs;
mod tags;
mod invites;
mod milestones;
mod sprints;
mod cycles;
mod templates;
mod ai;
pub mod activity;
pub mod automations;
pub mod github;
mod sla;
mod views;
pub mod notifications;
mod api_keys;
mod docs;
pub mod webhooks;
mod metrics;
pub mod relations;
pub mod recurring;
pub mod triage;
pub mod email_intake;
pub mod attachments;
pub mod agent_config;
pub mod slack;
mod admin;
mod initiatives;
mod import_export;

pub fn api_router(pool: PgPool, jwks: JwksKeys) -> Router {
    let routes = Router::new()
        // Projects
        .route("/projects", get(projects::list).post(projects::create))
        .route("/projects/{id}", get(projects::get_one).patch(projects::update).delete(projects::remove))
        .route("/projects/{id}/auto-assign", get(projects::get_auto_assign_settings).patch(projects::update_auto_assign_settings))
        .route("/projects/{id}/refresh-github", post(projects::refresh_github))
        .route("/projects/{id}/issues", get(issues::list_by_project))
        .route("/projects/{id}/tags", get(tags::list_by_project).post(tags::create))
        .route("/projects/{id}/public-submit", get(projects::get_public_submit_settings).patch(projects::update_public_submit_settings))
        .route("/projects/by-slug/{slug}/board", get(projects::board_by_slug))
        // Milestones
        .route("/projects/{id}/milestones", get(milestones::list_by_project).post(milestones::create))
        // Sprints
        .route("/projects/{id}/sprints", get(sprints::list_by_project).post(sprints::create))
        // Cycles
        .route("/projects/{id}/cycles", get(cycles::list).post(cycles::create))
        .route("/cycles/{id}", get(cycles::get_one).patch(cycles::update))
        .route("/cycles/{id}/complete", post(cycles::complete))
        // Issues
        .route("/issues", get(issues::list_all).post(issues::create))
        .route("/issues/mine", get(issues::list_mine))
        .route("/issues/batch", patch(issues::batch_update).delete(issues::batch_delete))
        .route("/search", get(issues::search))
        .route("/search/global", get(issues::search_global))
        .route("/issues/{id}", get(issues::get_one).patch(issues::update).delete(issues::remove))
        .route("/issues/{id}/position", patch(issues::update_position))
        .route("/issues/{id}/archive", post(issues::archive))
        .route("/issues/{id}/unarchive", post(issues::unarchive))
        .route("/issues/{id}/comments", get(comments::list_by_issue).post(comments::create))
        .route("/issues/{issue_id}/comments/{comment_id}", delete(comments::remove))
        .route("/issues/{id}/tldr", post(tldrs::create))
        // Sub-issues (children)
        .route("/issues/{id}/children", get(issues::list_children))
        // Relations (BAA-3)
        .route("/issues/{id}/relations", get(relations::list).post(relations::create))
        .route("/issues/{id}/relations/{relation_id}", delete(relations::remove))
        // Activity
        .route("/issues/{id}/activity", get(activity::list_by_issue))
        .route("/activity", get(activity::list_recent))
        // GitHub
        .route("/github/install", get(github::oauth::install_redirect))
        .route("/github/callback", get(github::oauth::callback))
        .route("/github/installation", get(github::oauth::get_installation))
        .route("/github/disconnect", post(github::oauth::disconnect))
        .route("/github/repos", get(github::repos::list_available))
        .route("/github/mappings", get(github::repos::list_mappings).post(github::repos::create_mapping))
        .route("/github/mappings/{id}", patch(github::repos::update_mapping).delete(github::repos::delete_mapping))
        .route("/issues/{id}/github", get(github::repos::get_issue_github_data))
        // AI
        .route("/ai/chat", post(ai::chat))
        .route("/ai/key", get(ai::get_key))
        .route("/ai/pm-full-review", post(ai::pm_full_review))
        // Tags
        .route("/tags/{id}", delete(tags::remove))
        // Milestones by ID
        .route("/milestones/{id}", get(milestones::get_one).put(milestones::update).delete(milestones::remove))
        // Templates (BAA-13)
        .route("/projects/{id}/templates", get(templates::list).post(templates::create))
        .route("/templates/{id}", get(templates::get_one).patch(templates::update).delete(templates::remove))
        // SLA (BAA-8)
        .route("/projects/{id}/sla-rules", get(sla::list).post(sla::create))
        .route("/sla-rules/{id}", delete(sla::remove))
        .route("/projects/{id}/sla-stats", get(sla::stats))
        // Automations (BAA-27)
        .route("/projects/{id}/automations", get(automations::list).post(automations::create))
        .route("/automations/{id}", patch(automations::update).delete(automations::remove))
        // Sprints by ID
        .route("/sprints/{id}", put(sprints::update).delete(sprints::remove))
        // Views
        .route("/views", get(views::list).post(views::create))
        .route("/views/{id}", patch(views::update).delete(views::remove))
        .route("/views/{id}/issues", get(views::get_issues))
        // Notifications
        .route("/notifications", get(notifications::list))
        .route("/notifications/count", get(notifications::count))
        .route("/notifications/{id}/read", patch(notifications::mark_read))
        .route("/notifications/read-all", post(notifications::read_all))
        .route("/notifications/preferences", get(notifications::get_preferences).patch(notifications::update_preferences))
        // API Keys
        .route("/api-keys", get(api_keys::list).post(api_keys::create))
        .route("/api-keys/{id}", patch(api_keys::update).delete(api_keys::remove))
        .route("/api-keys/{id}/regenerate", post(api_keys::regenerate))
        .route("/invites", get(invites::list).post(invites::create))
        // Docs (public, auth skipped via path prefix)
        .route("/public/docs", get(docs::api_docs))
        .route("/public/skill", get(docs::agent_skill))
        // Public routes (auth skipped in middleware)
        .route("/invite/{code}", get(invites::redirect_invite))
        // Public routes (auth skipped in middleware based on path)
        .route("/public/{slug}/submit", post(issues::public_submit)
            .layer(DefaultBodyLimit::max(20 * 1024 * 1024))) // 20MB for base64 attachments
        .route("/public/resolve/{token}", get(projects::resolve_public_token))
        // Webhook (GitHub integration)
        .route("/webhooks/github", post(github::webhooks::handle))
        // Slack webhook (public, no auth)
        .route("/public/slack/command", post(slack::handle_command))
        // Baaton Webhooks (org-level event subscriptions)
        .route("/webhooks", get(webhooks::list).post(webhooks::create))
        .route("/webhooks/{id}", get(webhooks::get_one).patch(webhooks::update).delete(webhooks::remove))
        // Recurring issues (BAA-17)
        .route("/projects/{id}/recurring", get(recurring::list).post(recurring::create))
        .route("/recurring/{id}", patch(recurring::update).delete(recurring::remove))
        .route("/recurring/{id}/trigger", post(recurring::trigger))
        // Metrics
        .route("/metrics", get(metrics::get_metrics))
        .route("/issues/{id}/triage", post(triage::analyze))
        .route("/public/{slug}/email-intake", post(email_intake::intake))
        .route("/issues/{id}/attachments", get(attachments::list).post(attachments::create))
        .route("/issues/{id}/attachments/{att_id}", delete(attachments::remove))
        // Admin (BAA-1)
        .route("/admin/orgs/{id}/plan", patch(admin::set_plan))
        .route("/admin/superadmin/check", get(admin::check_superadmin))
        .route("/admin/overview", get(admin::platform_overview))
        .route("/admin/users", get(admin::list_users))
        .route("/admin/superadmins", get(admin::list_super_admins).post(admin::add_super_admin))
        .route("/admin/superadmins/{email}", delete(admin::remove_super_admin))
        .route("/admin/users/{user_id}/plan", patch(admin::set_user_plan))
        .route("/admin/audit-log", get(admin::get_audit_log))
        .route("/billing", get(admin::get_billing))
        .route("/billing/ai-usage", get(admin::get_ai_usage))
        .route("/agent-config", get(agent_config::get_config).patch(agent_config::update_config))
        // Initiatives (BAA-9)
        .route("/initiatives", get(initiatives::list).post(initiatives::create))
        .route("/initiatives/{id}", get(initiatives::get_one).patch(initiatives::update).delete(initiatives::remove))
        .route("/initiatives/{id}/projects", post(initiatives::add_project))
        .route("/initiatives/{id}/projects/{project_id}", delete(initiatives::remove_project))
        // Import/Export (BAA-23)
        .route("/projects/{id}/export", get(import_export::export))
        .route("/projects/{id}/import", post(import_export::import))
        // Slack (BAA-25)
        .route("/integrations/slack", get(slack::list).post(slack::create))
        .route("/integrations/slack/{id}", delete(slack::remove))
        .route("/integrations/slack/{id}/channels", patch(slack::update_channels));

    // Apply auth middleware and inject JWKS state
    // Layer order: last added runs first (outer). Auth needs JWKS, so JWKS must be outer.
    routes
        .layer(axum_mw::from_fn(auth_middleware))
        .layer(axum::Extension(jwks))
        .with_state(pool)
}
