use axum::{Router, routing::get, middleware as axum_mw};
use tower_http::cors::{CorsLayer, Any};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::net::SocketAddr;
use tokio::sync::broadcast;

mod routes;
mod models;
mod middleware;
mod github;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    // Tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "baaton_api=debug,tower_http=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Database
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");
    // Disable prepared statement cache to work with PgBouncer/connection poolers
    let connect_opts = database_url.parse::<sqlx::postgres::PgConnectOptions>()?
        .statement_cache_capacity(0);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect_with(connect_opts)
        .await?;

    tracing::info!("Connected to database");

    // Run migrations at runtime (reads .sql files from disk or embedded)
    let migration_001 = include_str!("../migrations/001_init.sql");
    sqlx::raw_sql(migration_001).execute(&pool).await?;
    let migration_002 = include_str!("../migrations/002_sprints.sql");
    sqlx::raw_sql(migration_002).execute(&pool).await?;
    let migration_003 = include_str!("../migrations/003_project_tags.sql");
    sqlx::raw_sql(migration_003).execute(&pool).await?;
    let migration_004 = include_str!("../migrations/004_issue_category.sql");
    sqlx::raw_sql(migration_004).execute(&pool).await?;
    let migration_005 = include_str!("../migrations/005_org_upsert.sql");
    sqlx::raw_sql(migration_005).execute(&pool).await?;
    let migration_006 = include_str!("../migrations/006_github_integration.sql");
    sqlx::raw_sql(migration_006).execute(&pool).await?;
    let migration_007 = include_str!("../migrations/007_issue_creator_duedate.sql");
    sqlx::raw_sql(migration_007).execute(&pool).await?;
    let migration_008 = include_str!("../migrations/008_activity_log.sql");
    sqlx::raw_sql(migration_008).execute(&pool).await?;
    tracing::info!("Migrations applied");

    // SSE broadcast channel for real-time events
    let (event_tx, _) = broadcast::channel::<routes::sse::SseEvent>(100);

    // Start GitHub sync job runner (background task)
    let job_pool = pool.clone();
    tokio::spawn(async move {
        github::jobs::start_job_runner(job_pool).await;
    });

    // CORS — restrict to known origins
    let allowed_origins = [
        "https://app.baaton.dev".parse().unwrap(),
        "https://baaton.dev".parse().unwrap(),
        "http://localhost:3000".parse().unwrap(),
    ];
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_credentials(true);

    // Router
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/api/v1", routes::api_router(pool.clone(), event_tx.clone()))
        .layer(axum_mw::from_fn(middleware::security::security_headers))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Serve
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "4000".into())
        .parse()?;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("Baaton API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
