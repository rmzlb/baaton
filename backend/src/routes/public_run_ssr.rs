//! Server-rendered HTML for /r/:token — the public Run Card receipt.
//!
//! Reads agent_sessions WHERE public_token=$1 AND is_public=TRUE, joins
//! issues + projects to surface display_id and project name, and renders
//! a minimal HTML page with full OG/Twitter meta tags so the URL previews
//! correctly when pasted in Slack, X, GitHub PRs, Discord, LinkedIn.
//!
//! NOT served under /api/v1 — mounted as a top-level route in main.rs so
//! the URL is short and shareable.

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;

#[derive(sqlx::FromRow)]
struct RunRow {
    display_id: String,
    project_name: String,
    agent_name: String,
    status: String,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    summary: Option<String>,
    files_changed: Vec<String>,
    tests_status: String,
    pr_url: Option<String>,
}

pub async fn render(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let row: Option<RunRow> = sqlx::query_as::<_, RunRow>(
        r#"
        SELECT
            i.display_id          AS display_id,
            p.name                AS project_name,
            s.agent_name          AS agent_name,
            s.status              AS status,
            s.started_at          AS started_at,
            s.completed_at        AS completed_at,
            s.summary             AS summary,
            s.files_changed       AS files_changed,
            s.tests_status        AS tests_status,
            s.pr_url              AS pr_url
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

    match row {
        None => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            not_found_html(),
        )
            .into_response(),
        Some(r) => {
            let html = render_html(&token, &r);
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                "text/html; charset=utf-8".parse().unwrap(),
            );
            headers.insert(
                header::CACHE_CONTROL,
                "public, max-age=300, s-maxage=600".parse().unwrap(),
            );
            (StatusCode::OK, headers, html).into_response()
        }
    }
}

fn render_html(token: &str, r: &RunRow) -> String {
    let api_origin =
        std::env::var("API_URL").unwrap_or_else(|_| "https://api.baaton.dev".into());
    let app_origin = std::env::var("APP_URL").unwrap_or_else(|_| "https://baaton.dev".into());
    let public_origin =
        std::env::var("PUBLIC_RUN_ORIGIN").unwrap_or_else(|_| "https://r.baaton.dev".into());

    let og_image = format!("{}/api/v1/public/og/run/{}", api_origin, esc(token));
    let canonical = format!("{}/{}", public_origin, esc(token));

    let duration = match (r.started_at, r.completed_at) {
        (Some(s), Some(e)) => format_duration_secs((e - s).num_seconds().max(0)),
        (Some(s), None) => format!("running · started {}", s.format("%b %d %H:%M UTC")),
        _ => "—".into(),
    };

    let summary = r
        .summary
        .as_deref()
        .map(|s| truncate_chars(s, 240))
        .unwrap_or_else(|| "No summary recorded yet.".into());

    let title = format!("{} · Agent Run · Baaton", r.display_id);
    let description = format!(
        "{} finished {} in {}. {} files changed. Tests: {}.",
        r.agent_name,
        r.display_id,
        duration,
        r.files_changed.len(),
        r.tests_status
    );

    let pr_block = match &r.pr_url {
        Some(url) => format!(
            r#"<div class="meta-row"><span class="meta-label">PR</span><a class="meta-link" href="{}" rel="noopener nofollow">{}</a></div>"#,
            esc(url),
            esc(url)
        ),
        None => String::new(),
    };

    let files_block = if r.files_changed.is_empty() {
        String::new()
    } else {
        let mut s = String::from(r#"<details class="files"><summary>Files changed</summary><ul>"#);
        for f in r.files_changed.iter().take(50) {
            s.push_str(&format!("<li><code>{}</code></li>", esc(f)));
        }
        if r.files_changed.len() > 50 {
            s.push_str(&format!(
                "<li class=\"more\">… +{} more</li>",
                r.files_changed.len() - 50
            ));
        }
        s.push_str("</ul></details>");
        s
    };

    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical}">

<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="{canonical}">
<meta property="og:site_name" content="Baaton">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{og_image}">

<style>
:root{{--bg:#0a0a0a;--surface:#111;--border:#222;--text:#ededed;--muted:#888;--accent:#f59e0b;--ok:#10b981;--err:#ef4444;--info:#3b82f6}}
*{{box-sizing:border-box}}
html,body{{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;text-rendering:optimizeLegibility}}
.wrap{{max-width:720px;margin:0 auto;padding:32px 20px 56px}}
.brand{{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:-0.01em;margin-bottom:24px}}
.brand-dot{{width:8px;height:8px;border-radius:2px;background:var(--accent)}}
.brand a{{color:var(--text);text-decoration:none}}
.card{{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px}}
.eyebrow{{font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);font-weight:500;margin-bottom:8px}}
h1{{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:-0.01em;margin:0 0 4px}}
.subtitle{{color:var(--muted);font-size:14px;margin-bottom:20px}}
.subtitle b{{color:var(--text);font-weight:500}}
.divider{{height:1px;background:var(--border);margin:20px 0}}
.meta-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;font-variant-numeric:tabular-nums}}
.meta{{display:flex;flex-direction:column;gap:4px}}
.meta-label{{font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)}}
.meta-value{{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:14px}}
.meta-row{{display:flex;justify-content:space-between;gap:14px;margin-top:14px;font-size:13px;align-items:flex-start}}
.meta-row .meta-label{{flex-shrink:0}}
.meta-link{{color:var(--accent);text-decoration:none;word-break:break-all}}
.meta-link:hover{{text-decoration:underline}}
.badge{{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:500;letter-spacing:0.02em;text-transform:capitalize;border:1px solid currentColor}}
.badge.completed{{color:var(--ok)}}
.badge.error,.badge.failed{{color:var(--err)}}
.badge.active,.badge.awaiting_input,.badge.pending{{color:var(--info)}}
.summary{{margin-top:18px;font-size:14px;color:#ddd;white-space:pre-wrap;word-break:break-word}}
.files{{margin-top:18px;font-size:13px}}
.files summary{{cursor:pointer;color:var(--muted);font-weight:500;font-size:11px;letter-spacing:0.06em;text-transform:uppercase}}
.files ul{{list-style:none;padding:0;margin:10px 0 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:#bbb}}
.files li{{padding:2px 0;word-break:break-all}}
.files li.more{{color:var(--muted);font-style:italic}}
.foot{{margin-top:24px;text-align:center;font-size:12px;color:var(--muted)}}
.foot a{{color:var(--accent);text-decoration:none}}
.foot a:hover{{text-decoration:underline}}
@media(prefers-color-scheme:light){{:root{{--bg:#fafafa;--surface:#fff;--border:#e7e7e7;--text:#0a0a0a;--muted:#666}}}}
</style>
</head>
<body>
<main class="wrap">
  <div class="brand"><span class="brand-dot"></span><a href="{app_origin}">Baaton</a></div>
  <article class="card">
    <div class="eyebrow">Agent Run</div>
    <h1>{display_id}</h1>
    <div class="subtitle">in <b>{project_name}</b> · by <b>{agent_name}</b> · <span class="badge {status}">{status}</span></div>
    <div class="divider"></div>
    <div class="meta-grid">
      <div class="meta"><span class="meta-label">Duration</span><span class="meta-value">{duration}</span></div>
      <div class="meta"><span class="meta-label">Files changed</span><span class="meta-value">{files_count}</span></div>
      <div class="meta"><span class="meta-label">Tests</span><span class="meta-value">{tests_status}</span></div>
    </div>
    {pr_block}
    <div class="summary">{summary}</div>
    {files_block}
  </article>
  <p class="foot">Powered by <a href="{app_origin}">Baaton</a> — receipts for AI agent work.</p>
</main>
</body>
</html>
"#,
        title = esc(&title),
        description = esc(&description),
        canonical = esc(&canonical),
        og_image = esc(&og_image),
        app_origin = esc(&app_origin),
        display_id = esc(&r.display_id),
        project_name = esc(&r.project_name),
        agent_name = esc(&r.agent_name),
        status = esc(&r.status),
        duration = esc(&duration),
        files_count = r.files_changed.len(),
        tests_status = esc(&r.tests_status),
        pr_block = pr_block,
        summary = esc(&summary),
        files_block = files_block,
    )
}

fn not_found_html() -> String {
    let app_origin = std::env::var("APP_URL").unwrap_or_else(|_| "https://baaton.dev".into());
    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Run not found · Baaton</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{{margin:0;background:#0a0a0a;color:#ededed;font-family:Inter,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center}}.wrap{{padding:40px}}h1{{font-size:24px;margin:0 0 8px}}p{{color:#888;font-size:14px}}a{{color:#f59e0b;text-decoration:none}}</style>
</head><body><main class="wrap"><h1>Run not found</h1><p>This Baaton run is private or the link has expired.</p><p><a href="{}">Back to Baaton</a></p></main></body></html>"#,
        esc(&app_origin)
    )
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// C2: Truncate `s` to at most `max_chars` Unicode scalars, appending `…` if truncated.
/// Uses char boundaries so this never panics on multibyte input (e.g. French summaries
/// with accents whose byte length exceeds `max_chars`).
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut count = 0usize;
    let mut end = s.len();
    for (i, _) in s.char_indices() {
        if count == max_chars {
            end = i;
            break;
        }
        count += 1;
    }
    if end == s.len() {
        s.to_string()
    } else {
        format!("{}…", &s[..end])
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row(summary: Option<String>) -> RunRow {
        RunRow {
            display_id: "BAA-7".into(),
            project_name: "Baaton".into(),
            agent_name: "openclaw:haroz".into(),
            status: "completed".into(),
            started_at: None,
            completed_at: None,
            summary,
            files_changed: vec!["src/foo.rs".into()],
            tests_status: "passed".into(),
            pr_url: None,
        }
    }

    #[test]
    fn render_html_with_multibyte_summary_does_not_panic() {
        // C2 regression: 300 × "é" = 600 bytes / 300 chars (> 240 threshold).
        // Old code did `&s[..240]` which panicked because byte 240 fell
        // mid-codepoint. truncate_chars uses char_indices so it's safe.
        let multibyte = "é".repeat(300);
        let row = sample_row(Some(multibyte));
        let html = render_html("01HX0Z9ABC", &row);
        assert!(html.contains("…"));
        assert!(html.contains("BAA-7"));
    }

    #[test]
    fn truncate_chars_handles_multibyte() {
        let s = "é".repeat(300);
        let out = truncate_chars(&s, 240);
        // 240 × "é" + "…" — counted in chars, not bytes
        assert_eq!(out.chars().count(), 241);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn truncate_chars_passthrough_when_short() {
        let out = truncate_chars("hello", 240);
        assert_eq!(out, "hello");
    }
}

