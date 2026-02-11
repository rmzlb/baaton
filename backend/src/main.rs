use axum::{Router, routing::get, middleware as axum_mw};
use tower_http::cors::{CorsLayer, Any};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;

mod routes;
mod models;
mod middleware;
mod github;

use middleware::{JwksKeys, fetch_jwks_keys, jwks_refresh_task};

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
    let connect_opts = database_url.parse::<sqlx::postgres::PgConnectOptions>()?
        .statement_cache_capacity(0);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect_with(connect_opts)
        .await?;

    tracing::info!("Connected to database");

    // ── Migration tracking ─────────────────────────────
    sqlx::raw_sql("CREATE TABLE IF NOT EXISTS _migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())")
        .execute(&pool)
        .await?;

    let migrations: &[(i32, &str)] = &[
        (1, include_str!("../migrations/001_init.sql")),
        (2, include_str!("../migrations/002_sprints.sql")),
        (3, include_str!("../migrations/003_project_tags.sql")),
        (4, include_str!("../migrations/004_issue_category.sql")),
        (5, include_str!("../migrations/005_org_upsert.sql")),
        (6, include_str!("../migrations/006_github_integration.sql")),
        (7, include_str!("../migrations/007_issue_creator_duedate.sql")),
        (8, include_str!("../migrations/008_activity_log.sql")),
        (9, include_str!("../migrations/009_openclaw_integration.sql")),
        (10, include_str!("../migrations/010_milestone_enhancements.sql")),
        (11, include_str!("../migrations/011_saved_views.sql")),
        (12, include_str!("../migrations/012_templates_estimates.sql")),
        (13, include_str!("../migrations/013_project_auto_assign.sql")),
    ];

    for &(version, sql) in migrations {
        let applied: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM _migrations WHERE version = $1)")
            .bind(version)
            .fetch_one(&pool)
            .await
            .unwrap_or(false);
        if !applied {
            sqlx::raw_sql(sql).execute(&pool).await?;
            sqlx::query("INSERT INTO _migrations (version) VALUES ($1)")
                .bind(version)
                .execute(&pool)
                .await?;
            tracing::info!("Applied migration {}", version);
        }
    }
    tracing::info!("Migrations applied");

    // ── JWKS setup ─────────────────────────────────────
    let clerk_issuer = std::env::var("CLERK_ISSUER")
        .unwrap_or_else(|_| "https://clerk.baaton.dev".to_string());

    let jwks_keys = match fetch_jwks_keys(&clerk_issuer).await {
        Ok(keys) => {
            tracing::info!("Fetched {} JWKS keys from Clerk", keys.len());
            keys
        }
        Err(e) => {
            tracing::warn!("Failed to fetch initial JWKS (will retry on first request): {}", e);
            std::collections::HashMap::new()
        }
    };
    let jwks_state: JwksKeys = Arc::new(RwLock::new(jwks_keys));

    // Background JWKS refresh
    let jwks_bg = jwks_state.clone();
    let issuer_bg = clerk_issuer.clone();
    tokio::spawn(async move {
        jwks_refresh_task(jwks_bg, issuer_bg).await;
    });

    // Start GitHub sync job runner
    let job_pool = pool.clone();
    tokio::spawn(async move {
        github::jobs::start_job_runner(job_pool).await;
    });

    // CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Router
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/api/v1", routes::api_router(pool.clone(), jwks_state.clone()))
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
