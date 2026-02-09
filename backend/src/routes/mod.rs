use axum::{Router, routing::{get, post, patch, delete}, middleware as axum_mw};
use sqlx::PgPool;

use crate::middleware::auth_middleware;

mod projects;
mod issues;
mod comments;
mod tldrs;
mod tags;

pub fn api_router(pool: PgPool) -> Router {
    // Protected routes — require valid Clerk JWT with org_id filtering
    let protected = Router::new()
        // Projects (org-scoped)
        .route("/projects", get(projects::list).post(projects::create))
        .route("/projects/{id}", get(projects::get_one).patch(projects::update).delete(projects::remove))
        .route("/projects/{id}/issues", get(issues::list_by_project))
        .route("/projects/{id}/tags", get(tags::list_by_project).post(tags::create))
        // Issues
        .route("/issues", post(issues::create))
        .route("/issues/mine", get(issues::list_mine))
        .route("/issues/{id}", get(issues::get_one).patch(issues::update).delete(issues::remove))
        .route("/issues/{id}/position", patch(issues::update_position))
        .route("/issues/{id}/comments", get(comments::list_by_issue).post(comments::create))
        .route("/issues/{id}/tldr", post(tldrs::create))
        // Tags
        .route("/tags/{id}", delete(tags::remove))
        .layer(axum_mw::from_fn(auth_middleware));

    // Public routes — no auth needed
    let public = Router::new()
        .route("/public/{slug}/submit", post(issues::public_submit));

    Router::new()
        .merge(protected)
        .merge(public)
        .with_state(pool)
}
