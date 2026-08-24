//! OG image for public agent runs. Hand-rolled SVG (1200×630) so the URL
//! preview in Slack, X, GitHub PR comments, Discord, LinkedIn shows a
//! real branded card instead of a generic site card.
//!
//! SVG-only (no rasterization). All major social crawlers and GitHub
//! render SVG OG images correctly in 2026.

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;

#[derive(sqlx::FromRow)]
struct OgRow {
    display_id: String,
    project_name: String,
    agent_name: String,
    status: String,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    summary: Option<String>,
    tests_status: String,
    files_count: i64,
}

pub async fn render_run_svg(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    // Strip `.svg` if the router didn't already
    let token = token.strip_suffix(".svg").unwrap_or(&token).to_string();

    let row: Option<OgRow> = sqlx::query_as::<_, OgRow>(
        r#"
        SELECT
            i.display_id                       AS display_id,
            p.name                             AS project_name,
            s.agent_name                       AS agent_name,
            s.status                           AS status,
            s.started_at                       AS started_at,
            s.completed_at                     AS completed_at,
            s.summary                          AS summary,
            s.tests_status                     AS tests_status,
            COALESCE(array_length(s.files_changed, 1), 0)::bigint AS files_count
        FROM agent_sessions s
        JOIN issues   i ON i.id = s.issue_id
        JOIN projects p ON p.id = s.project_id
        WHERE s.public_token = $1
          AND s.is_public    = TRUE
        "#,
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let r = match row {
        None => {
            return (
                StatusCode::NOT_FOUND,
                [(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8")],
                fallback_svg(),
            )
                .into_response();
        }
        Some(r) => r,
    };

    let svg = render_svg(&r, &token);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "image/svg+xml; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=3600, s-maxage=3600".parse().unwrap(),
    );
    (StatusCode::OK, headers, svg).into_response()
}

fn render_svg(r: &OgRow, token: &str) -> String {
    let duration = match (r.started_at, r.completed_at) {
        (Some(s), Some(e)) => format_duration_secs((e - s).num_seconds().max(0)),
        (Some(_), None) => "running".into(),
        _ => "—".into(),
    };

    let summary = r
        .summary
        .as_deref()
        .map(|s| {
            // For SVG <text>, no markup escapes needed beyond XML safety.
            // Truncate at ~96 chars to fit on two lines. Use char-boundary-safe
            // slicing so multibyte UTF-8 summaries (emoji, accents) don't panic.
            truncate_chars(s, 96)
        })
        .unwrap_or_else(|| "No summary recorded yet.".into());

    let (line1, line2) = split_for_two_lines(&summary, 56);

    let status_color = match r.status.as_str() {
        "completed" => "#10b981",
        "error" | "failed" => "#ef4444",
        "active" | "awaiting_input" | "pending" => "#3b82f6",
        _ => "#888888",
    };

    let tests_color = match r.tests_status.as_str() {
        "passed" => "#10b981",
        "failed" => "#ef4444",
        "skipped" => "#f59e0b",
        _ => "#888888",
    };

    format!(
        r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0a0a"/>
      <stop offset="1" stop-color="#111"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#1f1f1f" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.6"/>

  <!-- Top bar: Baaton wordmark + status badge -->
  <g transform="translate(64, 64)">
    <rect width="14" height="14" rx="3" fill="#f59e0b"/>
    <text x="24" y="13" font-size="20" font-weight="600" fill="#ededed" letter-spacing="-0.5">Baaton</text>
    <text x="24" y="34" font-size="12" font-weight="500" fill="#888" letter-spacing="1.5">RECEIPTS FOR AI AGENT WORK</text>
  </g>

  <g transform="translate(1136, 64)" text-anchor="end">
    <rect x="-150" y="-2" width="150" height="32" rx="16" fill="{status_color}" opacity="0.15"/>
    <rect x="-150" y="-2" width="150" height="32" rx="16" fill="none" stroke="{status_color}" stroke-width="1" opacity="0.6"/>
    <text x="-75" y="19" font-size="14" font-weight="600" fill="{status_color}" text-anchor="middle" letter-spacing="0.5">{status_upper}</text>
  </g>

  <!-- Eyebrow -->
  <text x="64" y="220" font-size="14" font-weight="500" fill="#888" letter-spacing="2">AGENT RUN</text>

  <!-- Display ID huge -->
  <text x="64" y="306" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="84" font-weight="700" fill="#ededed" letter-spacing="-2">{display_id}</text>

  <!-- Project · Agent -->
  <text x="64" y="362" font-size="22" fill="#bbb">in <tspan font-weight="600" fill="#ededed">{project_name}</tspan> · by <tspan font-weight="600" fill="#ededed">{agent_name}</tspan></text>

  <!-- Summary (two lines) -->
  <text x="64" y="424" font-size="20" fill="#ddd">{summary_line1}</text>
  <text x="64" y="452" font-size="20" fill="#ddd">{summary_line2}</text>

  <!-- Bottom row: stats -->
  <g transform="translate(64, 528)">
    <text x="0" y="0" font-size="11" font-weight="500" fill="#888" letter-spacing="1.2">DURATION</text>
    <text x="0" y="26" font-family="'JetBrains Mono', monospace" font-size="22" font-weight="600" fill="#ededed">{duration}</text>
  </g>
  <g transform="translate(280, 528)">
    <text x="0" y="0" font-size="11" font-weight="500" fill="#888" letter-spacing="1.2">FILES CHANGED</text>
    <text x="0" y="26" font-family="'JetBrains Mono', monospace" font-size="22" font-weight="600" fill="#ededed">{files_count}</text>
  </g>
  <g transform="translate(520, 528)">
    <text x="0" y="0" font-size="11" font-weight="500" fill="#888" letter-spacing="1.2">TESTS</text>
    <text x="0" y="26" font-family="'JetBrains Mono', monospace" font-size="22" font-weight="600" fill="{tests_color}">{tests_status}</text>
  </g>

  <!-- Footer URL -->
  <text x="1136" y="554" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="14" fill="#666">r.baaton.dev/{token_short}</text>

  <!-- Bottom accent -->
  <rect x="0" y="626" width="1200" height="4" fill="#f59e0b"/>
</svg>"##,
        status_color = status_color,
        status_upper = xml_esc(&r.status.to_uppercase()),
        display_id = xml_esc(&r.display_id),
        project_name = xml_esc(&r.project_name),
        agent_name = xml_esc(&r.agent_name),
        summary_line1 = xml_esc(&line1),
        summary_line2 = xml_esc(&line2),
        duration = xml_esc(&duration),
        files_count = r.files_count,
        tests_color = tests_color,
        tests_status = xml_esc(&r.tests_status),
        token_short = xml_esc(&truncate_token(token)),
    )
}

/// SVG when no run is found — generic Baaton card so social previews still look intentional.
fn fallback_svg() -> String {
    r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" font-family="Inter, sans-serif">
  <rect width="1200" height="630" fill="#0a0a0a"/>
  <text x="600" y="300" text-anchor="middle" font-size="36" font-weight="600" fill="#ededed">Run not found</text>
  <text x="600" y="350" text-anchor="middle" font-size="20" fill="#888">This Baaton run is private or expired.</text>
  <rect x="0" y="626" width="1200" height="4" fill="#f59e0b"/>
</svg>"##
        .into()
}

fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn format_duration_secs(s: i64) -> String {
    if s < 60 {
        return format!("{s}s");
    }
    let m = s / 60;
    let rem_s = s % 60;
    if m < 60 {
        return if rem_s > 0 {
            format!("{m}m {rem_s}s")
        } else {
            format!("{m}m")
        };
    }
    let h = m / 60;
    let rem_m = m % 60;
    if rem_m > 0 {
        format!("{h}h {rem_m}m")
    } else {
        format!("{h}h")
    }
}

fn truncate_token(t: &str) -> String {
    truncate_chars(t, 12)
}

/// Truncate `s` to at most `max_chars` characters (Unicode scalars), appending `…` if truncated.
/// Uses char boundaries so this never panics on multibyte input.
use crate::text::truncate_chars;

/// Word-wrap a string into two lines around `max_chars` for line 1, rest on line 2.
///
/// Char-boundary safe: `cut_idx` comes from `char_indices()` and `break_at` from
/// `rfind(' ')`, both of which can only yield real boundaries.
#[allow(
    clippy::string_slice,
    reason = "indices originate from char_indices()/rfind(), so they are always char boundaries"
)]
fn split_for_two_lines(s: &str, max_chars: usize) -> (String, String) {
    // Locate the byte index right after the `max_chars`-th char.
    let cut_idx = s
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    if cut_idx == s.len() {
        return (s.to_string(), String::new());
    }
    // Prefer breaking on the last space before cut_idx for readability.
    let break_at = s[..cut_idx].rfind(' ').unwrap_or(cut_idx);
    let line1 = s[..break_at].to_string();
    let rest = s[break_at..].trim_start();
    let line2 = truncate_chars(rest, max_chars);
    (line1, line2)
}
