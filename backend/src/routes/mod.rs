use axum::{Router, routing::{get, post, put, patch, delete}, middleware as axum_mw};
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
mod templates;
mod ai;
pub mod activity;
pub mod github;
mod views;

pub fn api_router(pool: PgPool, jwks: JwksKeys) -> Router {
    let routes = Router::new()
        // Projects
        .route("/projects", get(projects::list).post(projects::create))
        .route("/projects/{id}", get(projects::get_one).patch(projects::update).delete(projects::remove))
        .route("/projects/{id}/issues", get(issues::list_by_project))
        .route("/projects/{id}/tags", get(tags::list_by_project).post(tags::create))
        // Milestones
        .route("/projects/{id}/milestones", get(milestones::list_by_project).post(milestones::create))
        // Sprints
        .route("/projects/{id}/sprints", get(sprints::list_by_project).post(sprints::create))
        // Issues
        .route("/issues", get(issues::list_all).post(issues::create))
        .route("/issues/mine", get(issues::list_mine))
        .route("/issues/{id}", get(issues::get_one).patch(issues::update).delete(issues::remove))
        .route("/issues/{id}/position", patch(issues::update_position))
        .route("/issues/{id}/comments", get(comments::list_by_issue).post(comments::create))
        .route("/issues/{id}/tldr", post(tldrs::create))
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
        // Tags
        .route("/tags/{id}", delete(tags::remove))
        // Milestones by ID
        .route("/milestones/{id}", get(milestones::get_one).put(milestones::update).delete(milestones::remove))
        // Templates
        .route("/projects/{id}/templates", get(templates::list_by_project).post(templates::create))
        .route("/templates/{id}", delete(templates::remove))
        // Sprints by ID
        .route("/sprints/{id}", put(sprints::update).delete(sprints::remove))
        // Views
        .route("/views", get(views::list).post(views::create))
        .route("/views/{id}", patch(views::update).delete(views::remove))
        .route("/invites", get(invites::list).post(invites::create))
        // Public routes (auth skipped in middleware)
        .route("/invite/{code}", get(invites::redirect_invite))
        // Public routes (auth skipped in middleware based on path)
        .route("/public/{slug}/submit", post(issues::public_submit))
        // Webhook
        .route("/webhooks/github", post(github::webhooks::handle));

    // Apply auth middleware and inject JWKS state
    // Layer order: last added runs first (outer). Auth needs JWKS, so JWKS must be outer.
    routes
        .layer(axum_mw::from_fn(auth_middleware))
        .layer(axum::Extension(jwks))
        .with_state(pool)
}
