use axum::{middleware as axum_mw, routing::get, Router};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod filter;
mod github;
mod middleware;
mod models;
mod novu;
mod routes;

use middleware::{fetch_jwks_keys, jwks_refresh_task, JwksKeys};

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
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let max_conns: u32 = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);
    let connect_opts = database_url
        .parse::<sqlx::postgres::PgConnectOptions>()?
        .statement_cache_capacity(0);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(max_conns)
        .acquire_timeout(std::time::Duration::from_secs(5))
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
        (
            7,
            include_str!("../migrations/007_issue_creator_duedate.sql"),
        ),
        (8, include_str!("../migrations/008_activity_log.sql")),
        (
            9,
            include_str!("../migrations/009_openclaw_integration.sql"),
        ),
        (
            10,
            include_str!("../migrations/010_milestone_enhancements.sql"),
        ),
        (11, include_str!("../migrations/011_saved_views.sql")),
        (
            12,
            include_str!("../migrations/012_templates_estimates.sql"),
        ),
        (
            13,
            include_str!("../migrations/013_project_auto_assign.sql"),
        ),
        (15, include_str!("../migrations/015_public_submit.sql")),
        (16, include_str!("../migrations/016_issue_timestamps.sql")),
        (
            17,
            include_str!("../migrations/017_api_key_project_scope.sql"),
        ),
        (18, include_str!("../migrations/018_webhooks.sql")),
        (
            19,
            include_str!("../migrations/019_project_github_metadata.sql"),
        ),
        (20, include_str!("../migrations/020_label_colors.sql")),
        (21, include_str!("../migrations/021_search_vector.sql")),
        (22, include_str!("../migrations/022_snooze.sql")),
        (23, include_str!("../migrations/023_activity_log.sql")),
        (24, include_str!("../migrations/024_auto_archive.sql")),
        (25, include_str!("../migrations/025_issue_relations.sql")),
        (26, include_str!("../migrations/026_recurring_issues.sql")),
        (27, include_str!("../migrations/027_cycles.sql")),
        (28, include_str!("../migrations/028_notifications.sql")),
        (29, include_str!("../migrations/029_custom_views.sql")),
        (30, include_str!("../migrations/030_sla.sql")),
        (31, include_str!("../migrations/031_templates.sql")),
        (32, include_str!("../migrations/032_automations.sql")),
        (33, include_str!("../migrations/033_pricing.sql")),
        (34, include_str!("../migrations/034_initiatives.sql")),
        (35, include_str!("../migrations/035_attachments.sql")),
        (36, include_str!("../migrations/036_slack.sql")),
        (37, include_str!("../migrations/037_ai_usage.sql")),
        (371, include_str!("../migrations/037_agent_config.sql")), // was duplicate v37, re-indexed as 371
        (38, include_str!("../migrations/038_superadmin.sql")),
        (39, include_str!("../migrations/039_admin_audit_log.sql")),
        (40, include_str!("../migrations/040_user_plans.sql")),
        (41, include_str!("../migrations/041_gamification.sql")),
        (42, include_str!("../migrations/042_gamification_v2.sql")),
        (
            43,
            include_str!("../migrations/043_backfill_gamification.sql"),
        ),
        (
            44,
            include_str!("../migrations/044_custom_fields_estimates.sql"),
        ),
        (45, include_str!("../migrations/045_plans_per_user.sql")),
        (46, include_str!("../migrations/046_approval_workflow.sql")),
        (47, include_str!("../migrations/047_advanced_api.sql")),
        (48, include_str!("../migrations/048_agent_sessions.sql")),
        (49, include_str!("../migrations/049_project_context.sql")),
        (
            50,
            include_str!("../migrations/050_api_keys_created_by.sql"),
        ),
        (51, include_str!("../migrations/051_api_key_org_scopes.sql")),
        (52, include_str!("../migrations/052_api_key_org_scope_mode.sql")),
        (53, include_str!("../migrations/053_source_ai.sql")),
    ];

    for &(version, sql) in migrations {
        let applied: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM _migrations WHERE version = $1)")
                .bind(version)
                .fetch_one(&pool)
                .await
                .unwrap_or(false);
        if !applied {
            match sqlx::raw_sql(sql).execute(&pool).await {
                Ok(_) => {
                    let _ = sqlx::query("INSERT INTO _migrations (version) VALUES ($1)")
                        .bind(version)
                        .execute(&pool)
                        .await;
                    tracing::info!("Applied migration {}", version);
                }
                Err(e) => {
                    tracing::warn!(
                        "Migration {} failed (will retry on next restart): {}",
                        version,
                        e
                    );
                }
            }
        }
    }
    tracing::info!("Migrations applied");

    // ── JWKS setup ─────────────────────────────────────
    let clerk_issuer =
        std::env::var("CLERK_ISSUER").unwrap_or_else(|_| "https://clerk.baaton.dev".to_string());

    let jwks_keys = match fetch_jwks_keys(&clerk_issuer).await {
        Ok(keys) => {
            tracing::info!("Fetched {} JWKS keys from Clerk", keys.len());
            keys
        }
        Err(e) => {
            tracing::warn!(
                "Failed to fetch initial JWKS (will retry on first request): {}",
                e
            );
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

    // Start webhook retry worker
    let webhook_pool = pool.clone();
    tokio::spawn(async move {
        routes::webhooks::retry_worker(webhook_pool).await;
    });

    // ── SSE broadcast channel ───────────────────────────
    // Buffer 256 events — slow clients get a Lagged notification
    let (sse_tx, _) = tokio::sync::broadcast::channel::<routes::sse::SseEvent>(256);

    // Novu notifications (None if NOVU_SECRET_KEY unset)
    let novu_client = novu::NovuClient::from_env();

    // CORS — restrict origins in production, permissive in dev
    let cors = {
        let allowed_origins = std::env::var("CORS_ORIGINS").unwrap_or_default();
        if allowed_origins.is_empty() || allowed_origins == "*" {
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        } else {
            let origins: Vec<axum::http::HeaderValue> = allowed_origins
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods(Any)
                .allow_headers(Any)
                .allow_credentials(true)
        }
    };

    // Router
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest(
            "/api/v1",
            routes::api_router(pool.clone(), jwks_state.clone()),
        )
        .layer(axum::Extension(novu_client))
        .layer(axum::Extension(sse_tx))
        .layer(axum::Extension(pool.clone()))
        .layer(axum_mw::from_fn(middleware::security::security_headers))
        .layer(cors)
        // Default body limit: 2MB (attachment routes override to 20MB)
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(TraceLayer::new_for_http());

    // Serve
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "4000".into())
        .parse()?;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("Baaton API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("Baaton API shut down gracefully");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down..."); },
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down..."); },
    }
}
