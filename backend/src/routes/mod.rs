use axum::{Router, routing::{get, post, patch, delete}};
use sqlx::PgPool;

mod projects;
mod issues;
mod health;

pub fn api_router(pool: PgPool) -> Router {
    Router::new()
        // Projects
        .route("/projects", get(projects::list).post(projects::create))
        .route("/projects/{id}", get(projects::get_one).patch(projects::update).delete(projects::remove))
        .route("/projects/{id}/issues", get(issues::list_by_project))
        // Issues
        .route("/issues", post(issues::create))
        .route("/issues/{id}", get(issues::get_one).patch(issues::update).delete(issues::remove))
        .route("/issues/{id}/position", patch(issues::update_position))
        // Public
        .route("/public/{slug}/submit", post(issues::public_submit))
        .with_state(pool)
}
