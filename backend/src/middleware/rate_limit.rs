use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use chrono::{Datelike, Timelike};
use serde_json::json;
use sqlx::PgPool;

// ─── Plan-based monthly limits (for billing) ──────────

#[allow(dead_code)]
pub const FREE_LIMIT: i64 = 100;
#[allow(dead_code)]
pub const PRO_LIMIT_PER_USER: i64 = 500;
#[allow(dead_code)]
pub const PRO_LIMIT: i64 = 500;

/// Result of a rate-limit check
pub struct RateLimitResult {
    pub allowed: bool,
    pub limit: i64,
    pub remaining: i64,
    pub count: i64,
    pub reset: String,
}

/// Get the monthly limit for a given plan
fn plan_limit(plan: &str) -> Option<i64> {
    match plan {
        "free" => Some(FREE_LIMIT),
        "pro" => Some(PRO_LIMIT),
        "enterprise" => None,
        _ => Some(FREE_LIMIT),
    }
}

/// Increment the request counter and check if the org is within its plan limit.
pub async fn check_and_increment(
    pool: &PgPool,
    org_id: &str,
) -> Result<RateLimitResult, (StatusCode, serde_json::Value)> {
    let now = chrono::Utc::now();
    let month = now.format("%Y-%m").to_string();

    let count: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO api_request_log (org_id, month, count)
        VALUES ($1, $2, 1)
        ON CONFLICT (org_id, month)
        DO UPDATE SET count = api_request_log.count + 1
        RETURNING count
        "#,
    )
    .bind(org_id)
    .bind(&month)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "rate_limit: counter increment failed");
        (StatusCode::INTERNAL_SERVER_ERROR, json!({"error": "Rate limit check failed"}))
    })?;

    let plan: String = sqlx::query_scalar(
        "SELECT COALESCE(plan, 'free') FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "rate_limit: plan lookup failed");
        (StatusCode::INTERNAL_SERVER_ERROR, json!({"error": "Rate limit check failed"}))
    })?
    .unwrap_or_else(|| "free".to_string());

    let reset = if now.month() == 12 {
        format!("{}-01-01T00:00:00Z", now.year() + 1)
    } else {
        format!("{}-{:02}-01T00:00:00Z", now.year(), now.month() + 1)
    };

    match plan_limit(&plan) {
        None => {
            Ok(RateLimitResult {
                allowed: true,
                limit: i64::MAX,
                remaining: i64::MAX,
                count,
                reset,
            })
        }
        Some(limit) => {
            let remaining = (limit - count).max(0);
            Ok(RateLimitResult {
                allowed: count <= limit,
                limit,
                remaining,
                count,
                reset,
            })
        }
    }
}

/// Build rate limit response headers from a RateLimitResult
pub fn rate_limit_headers(result: &RateLimitResult) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let limit_str = if result.limit == i64::MAX {
        "unlimited".to_string()
    } else {
        result.limit.to_string()
    };
    let remaining_str = if result.remaining == i64::MAX {
        "unlimited".to_string()
    } else {
        result.remaining.to_string()
    };
    if let Ok(v) = HeaderValue::from_str(&limit_str) {
        headers.insert(
            HeaderName::from_static("x-ratelimit-limit"),
            v,
        );
    }
    if let Ok(v) = HeaderValue::from_str(&remaining_str) {
        headers.insert(
            HeaderName::from_static("x-ratelimit-remaining"),
            v,
        );
    }
    if let Ok(v) = HeaderValue::from_str(&result.reset) {
        headers.insert(
            HeaderName::from_static("x-ratelimit-reset"),
            v,
        );
    }
    headers
}

// ─── Rate limit extension for response headers ───────

/// Extension stored in request to inject rate limit headers in responses.
#[derive(Clone)]
pub struct RateLimitExtension {
    pub limit: i64,
    pub remaining: i64,
    pub reset_epoch_ms: i64,
}

// ─── Hourly rate limiting (per-request, per-user) ─────

/// Per-user hourly rate limits
pub const HOURLY_LIMIT_API_KEY: i64 = 5000;
pub const HOURLY_LIMIT_JWT: i64 = 5000;
pub const HOURLY_LIMIT_UNAUTHENTICATED: i64 = 60;

pub struct HourlyRateLimitResult {
    pub allowed: bool,
    pub limit: i64,
    pub remaining: i64,
    pub reset_epoch_ms: i64,
}

/// Check hourly rate limit for a given key (user_id or IP).
/// Uses the api_rate_limits table with upsert.
pub async fn check_hourly(
    pool: &PgPool,
    rate_key: &str,
    limit: i64,
) -> Result<HourlyRateLimitResult, ()> {
    let now = chrono::Utc::now();
    let window = now.format("%Y-%m-%dT%H").to_string();

    // Calculate reset: next hour boundary
    let next_hour = now.date_naive().and_hms_opt(now.time().hour() + 1, 0, 0);
    let reset_epoch_ms = if let Some(nh) = next_hour {
        chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(nh, chrono::Utc).timestamp_millis()
    } else {
        // Midnight rollover
        let tomorrow = now.date_naive() + chrono::Duration::days(1);
        chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
            tomorrow.and_hms_opt(0, 0, 0).unwrap(),
            chrono::Utc,
        ).timestamp_millis()
    };

    let count: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO api_rate_limits (key, window, count)
        VALUES ($1, $2, 1)
        ON CONFLICT (key, window)
        DO UPDATE SET count = api_rate_limits.count + 1
        RETURNING count
        "#,
    )
    .bind(rate_key)
    .bind(&window)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "hourly_rate_limit: increment failed");
    })?;

    let remaining = (limit - count).max(0);

    Ok(HourlyRateLimitResult {
        allowed: count <= limit,
        limit,
        remaining,
        reset_epoch_ms,
    })
}

/// Build hourly rate limit headers
pub fn hourly_rate_limit_headers(result: &HourlyRateLimitResult) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&result.limit.to_string()) {
        headers.insert(HeaderName::from_static("x-ratelimit-requests-limit"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&result.remaining.to_string()) {
        headers.insert(HeaderName::from_static("x-ratelimit-requests-remaining"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&result.reset_epoch_ms.to_string()) {
        headers.insert(HeaderName::from_static("x-ratelimit-requests-reset"), v);
    }
    headers
}
