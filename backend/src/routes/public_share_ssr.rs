//! Server-rendered pages for shared issues (`/i/:token`) and projects
//! (`/p/:token`).
//!
//! Why this exists at all: the app is a client-rendered SPA. Telegram, Slack,
//! WhatsApp and Discord crawlers do not execute JavaScript, so *every* link to
//! a Baaton ticket currently unfurls with the contents of
//! `frontend/index.html` — the marketing title, the marketing description, the
//! marketing OG image. Paste three different tickets into a channel and you get
//! three identical cards. The link tells the receiver nothing, so they have to
//! open it to find out whether it concerns them.
//!
//! These routes are therefore not a nicety. The product's whole claim is that
//! you stop digging through chat to find what the client asked for; a link that
//! previews as a grey brand card reintroduces exactly that dig, one hop later.
//!
//! Design notes:
//!   * Same shape as `public_run_ssr.rs` (top-level route, not under
//!     `/api/v1`), so the URL stays short enough to paste.
//!   * Real HTML for humans too, not a bare meta-tag stub: a client with no
//!     account lands here, and a page that renders nothing without JS would be
//!     broken for them.
//!   * `og:image` points at the SVG card. `twitter:image` too. WhatsApp is the
//!     one major client that will not render SVG previews, so the tags also
//!     carry explicit dimensions and a `og:image:type`, and the human page
//!     leads with the title — WhatsApp falls back to title+description, which
//!     stays informative because the description is built from real fields.
//!   * Only public columns are read, and only the token identifies the row. No
//!     org check: that is the point of a share link, and it matches the
//!     trade-off already live for run cards and public-submit tokens.
//!   * Comment bodies are NOT rendered. A shared ticket exposes the request and
//!     its state, not the internal thread — leaking a colleague's aside into a
//!     public URL is the failure mode that makes teams stop sharing entirely.

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::text::truncate_chars;

/* ─────────────── issue page ─────────────── */

#[derive(sqlx::FromRow)]
struct IssueRow {
    display_id: String,
    title: String,
    description: Option<String>,
    status: String,
    status_label: Option<String>,
    priority: Option<String>,
    issue_type: String,
    project_name: String,
    reporter_name: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    due_date: Option<DateTime<Utc>>,
    comment_count: i64,
    tldr_summary: Option<String>,
    tldr_agent: Option<String>,
    tldr_tests: Option<String>,
    tldr_files: i64,
}

pub async fn render_issue(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let row: Option<IssueRow> = sqlx::query_as::<_, IssueRow>(
        r#"
        SELECT
            i.display_id     AS display_id,
            i.title          AS title,
            i.description    AS description,
            i.status         AS status,
            i.status_label   AS status_label,
            i.priority       AS priority,
            i.type           AS issue_type,
            p.name           AS project_name,
            i.reporter_name  AS reporter_name,
            i.created_at     AS created_at,
            i.updated_at     AS updated_at,
            i.due_date       AS due_date,
            (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id)::bigint AS comment_count,
            t.summary        AS tldr_summary,
            t.agent_name     AS tldr_agent,
            t.tests_status   AS tldr_tests,
            COALESCE(array_length(t.files_changed, 1), 0)::bigint AS tldr_files
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN LATERAL (
            SELECT summary, agent_name, tests_status, files_changed
            FROM tldrs
            WHERE issue_id = i.id
            ORDER BY created_at DESC
            LIMIT 1
        ) t ON TRUE
        WHERE i.public_token = $1
          AND i.is_public    = TRUE
        "#,
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    match row {
        None => not_found_response("This issue link is private or has expired."),
        Some(r) => ok_response(issue_html(&token, &r)),
    }
}

fn issue_html(token: &str, r: &IssueRow) -> String {
    let api = api_origin();
    let app = app_origin();
    let share = share_origin();

    let og_image = format!("{}/api/v1/public/og/issue/{}", api, esc(token));
    let canonical = format!("{}/i/{}", share, esc(token));

    // Title: the id earns its place because it is what people quote back
    // ("what's up with ACM-124?"). Project name last so the tail truncates
    // first in a narrow client.
    let title = format!("{} · {} · {}", r.display_id, r.title, r.project_name);

    // Description is the line WhatsApp shows instead of the SVG. It has to
    // carry state, not adjectives: status, priority, activity, and what an
    // agent last reported.
    let status_label = r.status_label.as_deref().unwrap_or(&r.status);
    let mut bits: Vec<String> = vec![humanize(status_label)];
    if let Some(p) = r.priority.as_deref() {
        bits.push(format!("{} priority", p));
    }
    bits.push(plural(r.comment_count, "comment"));
    if let Some(s) = r.tldr_summary.as_deref().filter(|s| !s.is_empty()) {
        bits.push(format!("Last reported: {}", truncate_chars(s, 120)));
    } else if let Some(d) = r.description.as_deref().filter(|d| !d.trim().is_empty()) {
        bits.push(truncate_chars(&strip_markup(d), 140));
    }
    let description = truncate_chars(&bits.join(" · "), 300);

    let agent_block = match (&r.tldr_summary, &r.tldr_agent) {
        (Some(s), Some(a)) if !s.is_empty() => format!(
            r#"<section class="card agent">
      <div class="eyebrow">Last reported by {agent}</div>
      <p class="agent-summary">{summary}</p>
      <div class="agent-meta">{files} · tests: {tests}</div>
    </section>"#,
            agent = esc(a),
            summary = esc(s),
            files = esc(&plural(r.tldr_files, "file")),
            tests = esc(r.tldr_tests.as_deref().unwrap_or("none")),
        ),
        _ => String::new(),
    };

    let description_block = match r.description.as_deref().filter(|d| !d.trim().is_empty()) {
        Some(d) => format!(
            r#"<section class="card">
      <div class="eyebrow">The request</div>
      <p class="body-text">{}</p>
    </section>"#,
            esc(&truncate_chars(&strip_markup(d), 1400))
        ),
        None => String::new(),
    };

    let reporter = r
        .reporter_name
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            format!(
                r#"<div class="meta"><span class="meta-label">Reported by</span><span class="meta-value">{}</span></div>"#,
                esc(s)
            )
        })
        .unwrap_or_default();

    let due = r
        .due_date
        .map(|d| {
            format!(
                r#"<div class="meta"><span class="meta-label">Due</span><span class="meta-value">{}</span></div>"#,
                d.format("%b %d, %Y")
            )
        })
        .unwrap_or_default();

    let body = format!(
        r#"<main class="wrap">
  <div class="brand"><span class="brand-dot"></span><a href="{app}">Baaton</a></div>
  <article class="card head">
    <div class="eyebrow">{project} · shared issue</div>
    <h1><span class="did">{display_id}</span> {title_text}</h1>
    <div class="badges">
      <span class="badge {status_class}">{status_label}</span>
      <span class="badge muted">{issue_type}</span>
      {priority_badge}
    </div>
    <div class="divider"></div>
    <div class="meta-grid">
      <div class="meta"><span class="meta-label">Opened</span><span class="meta-value">{created}</span></div>
      <div class="meta"><span class="meta-label">Last update</span><span class="meta-value">{updated}</span></div>
      <div class="meta"><span class="meta-label">Discussion</span><span class="meta-value">{comments}</span></div>
      {reporter}
      {due}
    </div>
  </article>
  {description_block}
  {agent_block}
  <p class="foot">Shared from <a href="{app}">Baaton</a>. Comments and internal history stay private.</p>
</main>"#,
        app = esc(&app),
        project = esc(&r.project_name),
        display_id = esc(&r.display_id),
        title_text = esc(&r.title),
        status_class = esc(&status_class(&r.status)),
        status_label = esc(&humanize(status_label)),
        issue_type = esc(&r.issue_type),
        priority_badge = r
            .priority
            .as_deref()
            .map(|p| format!(
                r#"<span class="badge prio-{p}">{p} priority</span>"#,
                p = esc(p)
            ))
            .unwrap_or_default(),
        created = r.created_at.format("%b %d, %Y"),
        updated = r.updated_at.format("%b %d, %Y"),
        comments = esc(&plural(r.comment_count, "comment")),
        reporter = reporter,
        due = due,
        description_block = description_block,
        agent_block = agent_block,
    );

    page(&title, &description, &canonical, &og_image, "article", &body)
}

/* ─────────────── project page ─────────────── */

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: uuid::Uuid,
    name: String,
    description: Option<String>,
    prefix: String,
    total: i64,
    open: i64,
    done: i64,
    agent_actions: i64,
    last_activity: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct ProjectIssueRow {
    display_id: String,
    title: String,
    status: String,
    status_label: Option<String>,
}

pub async fn render_project(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let row: Option<ProjectRow> = sqlx::query_as::<_, ProjectRow>(
        r#"
        SELECT
            p.id          AS id,
            p.name        AS name,
            p.description AS description,
            p.prefix      AS prefix,
            COALESCE(s.total, 0)::bigint AS total,
            COALESCE(s.open,  0)::bigint AS open,
            COALESCE(s.done,  0)::bigint AS done,
            COALESCE(a.n,     0)::bigint AS agent_actions,
            s.last_activity              AS last_activity
        FROM projects p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE COALESCE(status_category, 'started') NOT IN ('completed', 'canceled')
                ) AS open,
                COUNT(*) FILTER (WHERE status_category = 'completed') AS done,
                MAX(updated_at) AS last_activity
            FROM issues
            WHERE project_id = p.id AND COALESCE(archived, FALSE) = FALSE
        ) s ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS n
            FROM activity_log
            WHERE project_id = p.id AND actor_type = 'api_key'
        ) a ON TRUE
        WHERE p.public_token = $1
          AND p.is_public    = TRUE
        "#,
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let Some(r) = row else {
        return not_found_response("This project link is private or has expired.");
    };

    // A project card with no examples is an empty promise, so show the most
    // recently touched open issues. Titles only — same privacy line as the
    // issue page: no descriptions, no comments.
    let recent: Vec<ProjectIssueRow> = sqlx::query_as::<_, ProjectIssueRow>(
        r#"
        SELECT display_id, title, status, status_label
        FROM issues
        WHERE project_id = $1
          AND COALESCE(archived, FALSE) = FALSE
          AND COALESCE(status_category, 'started') NOT IN ('completed', 'canceled')
        ORDER BY updated_at DESC
        LIMIT 8
        "#,
    )
    .bind(r.id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    ok_response(project_html(&token, &r, &recent))
}

fn project_html(token: &str, r: &ProjectRow, recent: &[ProjectIssueRow]) -> String {
    let api = api_origin();
    let app = app_origin();
    let share = share_origin();

    let og_image = format!("{}/api/v1/public/og/project/{}", api, esc(token));
    let canonical = format!("{}/p/{}", share, esc(token));

    let title = format!("{} · Project · Baaton", r.name);
    let mut bits = vec![
        format!("{} open of {} issues", r.open, r.total),
        format!("{} agent actions", r.agent_actions),
    ];
    if let Some(d) = r.description.as_deref().filter(|d| !d.trim().is_empty()) {
        bits.insert(0, truncate_chars(&strip_markup(d), 140));
    }
    let description = truncate_chars(&bits.join(" · "), 300);

    let rows: String = recent
        .iter()
        .map(|i| {
            format!(
                r#"<li><span class="li-id">{id}</span><span class="li-title">{title}</span><span class="badge {cls} small">{status}</span></li>"#,
                id = esc(&i.display_id),
                title = esc(&i.title),
                cls = esc(&status_class(&i.status)),
                status = esc(&humanize(i.status_label.as_deref().unwrap_or(&i.status)))
            )
        })
        .collect::<Vec<_>>()
        .join("\n      ");

    let recent_block = if recent.is_empty() {
        String::new()
    } else {
        format!(
            r#"<section class="card">
      <div class="eyebrow">Open, most recently touched</div>
      <ul class="issue-list">
      {rows}
      </ul>
    </section>"#
        )
    };

    let desc_block = r
        .description
        .as_deref()
        .filter(|d| !d.trim().is_empty())
        .map(|d| {
            format!(
                r#"<p class="subtitle">{}</p>"#,
                esc(&truncate_chars(&strip_markup(d), 400))
            )
        })
        .unwrap_or_default();

    let activity = r
        .last_activity
        .map(|d| d.format("%b %d, %Y").to_string())
        .unwrap_or_else(|| "—".into());

    let body = format!(
        r#"<main class="wrap">
  <div class="brand"><span class="brand-dot"></span><a href="{app}">Baaton</a></div>
  <article class="card head">
    <div class="eyebrow">Shared project · {prefix}</div>
    <h1>{name}</h1>
    {desc_block}
    <div class="divider"></div>
    <div class="meta-grid">
      <div class="meta"><span class="meta-label">Issues</span><span class="meta-value">{total}</span></div>
      <div class="meta"><span class="meta-label">Open</span><span class="meta-value open">{open}</span></div>
      <div class="meta"><span class="meta-label">Done</span><span class="meta-value done">{done}</span></div>
      <div class="meta"><span class="meta-label">Agent actions</span><span class="meta-value accent">{agent_actions}</span></div>
      <div class="meta"><span class="meta-label">Last activity</span><span class="meta-value">{activity}</span></div>
    </div>
  </article>
  {recent_block}
  <p class="foot">Shared from <a href="{app}">Baaton</a>. Descriptions and comments stay private.</p>
</main>"#,
        app = esc(&app),
        prefix = esc(&r.prefix),
        name = esc(&r.name),
        desc_block = desc_block,
        total = r.total,
        open = r.open,
        done = r.done,
        agent_actions = r.agent_actions,
        activity = activity,
        recent_block = recent_block,
    );

    page(&title, &description, &canonical, &og_image, "website", &body)
}

/* ─────────────── shared shell ─────────────── */

/// One HTML shell for both pages so the meta-tag set can never drift between
/// object types — a preview bug that only shows up on one of the two is the
/// kind that survives for months.
fn page(
    title: &str,
    description: &str,
    canonical: &str,
    og_image: &str,
    og_type: &str,
    body: &str,
) -> String {
    format!(
        r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">

<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:type" content="image/svg+xml">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{description}">
<meta property="og:url" content="{canonical}">
<meta property="og:site_name" content="Baaton">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{og_image}">
<meta name="twitter:image:alt" content="{description}">

<meta name="theme-color" content="#0a0a0a">
<meta name="robots" content="noindex, nofollow">
<style>
:root{{--bg:#0a0a0a;--surface:#111;--border:#222;--text:#ededed;--muted:#888;--accent:#f59e0b;--ok:#10b981;--err:#ef4444;--info:#3b82f6;--purple:#8b5cf6}}
*{{box-sizing:border-box}}
html,body{{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55}}
.wrap{{max-width:760px;margin:0 auto;padding:32px 20px 56px}}
.brand{{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:24px}}
.brand-dot{{width:8px;height:8px;border-radius:2px;background:var(--accent)}}
.brand a{{color:var(--text);text-decoration:none}}
.card{{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px}}
.eyebrow{{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:500;margin-bottom:10px}}
h1{{font-size:27px;line-height:1.25;letter-spacing:-.02em;margin:0 0 14px;font-weight:600}}
.did{{font-family:'JetBrains Mono',ui-monospace,monospace;color:var(--accent);font-size:22px;margin-right:8px}}
.subtitle{{color:var(--muted);font-size:16px;margin:0 0 4px}}
.badges{{display:flex;flex-wrap:wrap;gap:8px}}
.badge{{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;border:1px solid currentColor}}
.badge.small{{font-size:10px;padding:2px 8px}}
.badge.done{{color:var(--ok)}}
.badge.cancelled{{color:var(--err)}}
.badge.progress{{color:var(--accent)}}
.badge.review{{color:var(--purple)}}
.badge.todo{{color:var(--info)}}
.badge.muted,.badge.other{{color:var(--muted)}}
.badge.prio-urgent{{color:var(--err)}}
.badge.prio-high{{color:var(--accent)}}
.badge.prio-medium{{color:var(--info)}}
.badge.prio-low{{color:var(--muted)}}
.divider{{height:1px;background:var(--border);margin:20px 0}}
.meta-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;font-variant-numeric:tabular-nums}}
.meta{{display:flex;flex-direction:column;gap:4px}}
.meta-label{{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}}
.meta-value{{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:15px}}
.meta-value.accent{{color:var(--accent)}}
.meta-value.open{{color:var(--info)}}
.meta-value.done{{color:var(--ok)}}
.body-text{{margin:0;white-space:pre-wrap;word-break:break-word;color:#ddd;font-size:15px}}
.agent{{border-left:3px solid var(--accent)}}
.agent-summary{{margin:0 0 10px;color:#ddd;white-space:pre-wrap;word-break:break-word}}
.agent-meta{{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)}}
.issue-list{{list-style:none;margin:0;padding:0}}
.issue-list li{{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border)}}
.issue-list li:first-child{{border-top:0}}
.li-id{{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);flex-shrink:0}}
.li-title{{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}}
.foot{{margin-top:20px;text-align:center;font-size:12px;color:var(--muted)}}
.foot a{{color:var(--accent);text-decoration:none}}
@media(prefers-color-scheme:light){{:root{{--bg:#fafafa;--surface:#fff;--border:#e7e7e7;--text:#0a0a0a;--muted:#666}}}}
</style>
</head>
<body>
{body}
</body>
</html>
"##,
        title = esc(title),
        description = esc(description),
        canonical = esc(canonical),
        og_image = esc(og_image),
        og_type = og_type,
        body = body,
    )
}

fn ok_response(html: String) -> axum::response::Response {
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

fn not_found_response(msg: &str) -> axum::response::Response {
    let app = app_origin();
    let html = format!(
        r##"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Not available · Baaton</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="Not available · Baaton">
<meta property="og:description" content="{msg}">
<style>html,body{{margin:0;background:#0a0a0a;color:#ededed;font-family:Inter,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center}}.w{{padding:40px}}h1{{font-size:24px;margin:0 0 8px}}p{{color:#888;font-size:14px}}a{{color:#f59e0b;text-decoration:none}}</style>
</head><body><main class="w"><h1>Not available</h1><p>{msg}</p><p><a href="{app}">Go to Baaton</a></p></main></body></html>"##,
        msg = esc(msg),
        app = esc(&app)
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/html; charset=utf-8".parse().unwrap(),
    );
    (StatusCode::NOT_FOUND, headers, html).into_response()
}

fn api_origin() -> String {
    std::env::var("API_URL").unwrap_or_else(|_| "https://api.baaton.dev".into())
}

fn app_origin() -> String {
    std::env::var("APP_URL").unwrap_or_else(|_| "https://baaton.dev".into())
}

/// Share links are served from the same host as run cards unless overridden, so
/// one DNS record covers every public object.
fn share_origin() -> String {
    std::env::var("SHARE_ORIGIN")
        .or_else(|_| std::env::var("PUBLIC_RUN_ORIGIN"))
        .unwrap_or_else(|_| "https://baaton.dev".into())
}

fn status_class(status: &str) -> String {
    match status {
        "done" => "done",
        "cancelled" | "canceled" => "cancelled",
        "in_progress" => "progress",
        "in_review" => "review",
        "todo" | "backlog" => "todo",
        _ => "other",
    }
    .into()
}

/// `in_progress` -> `In progress`. Custom statuses arrive already labelled, so
/// only touch the snake_case built-ins.
fn humanize(s: &str) -> String {
    if !s.contains('_') {
        return s.to_string();
    }
    let spaced = s.replace('_', " ");
    let mut c = spaced.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => spaced,
    }
}

fn plural(n: i64, noun: &str) -> String {
    if n == 1 {
        format!("1 {noun}")
    } else {
        format!("{n} {noun}s")
    }
}

/// Descriptions are Notion-style rich text stored as markdown-ish strings with
/// occasional inline HTML and base64 images. For a preview line we want prose,
/// so drop tags, collapse whitespace, and drop `data:` blobs entirely rather
/// than feed a 2 MB base64 string into a meta tag.
fn strip_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len().min(2048));
    let mut in_tag = false;
    let mut last_space = false;
    for ch in s.chars().take(8000) {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if in_tag => {}
            c if c.is_whitespace() => {
                if !last_space && !out.is_empty() {
                    out.push(' ');
                    last_space = true;
                }
            }
            c => {
                out.push(c);
                last_space = false;
            }
        }
    }
    // An embedded image line is noise in a preview.
    let cleaned = out
        .split(' ')
        .filter(|w| !w.starts_with("data:") && !w.starts_with("!["))
        .collect::<Vec<_>>()
        .join(" ");
    cleaned.trim().to_string()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(title: &str, desc: Option<&str>) -> IssueRow {
        IssueRow {
            display_id: "ACM-124".into(),
            title: title.into(),
            description: desc.map(|d| d.into()),
            status: "in_progress".into(),
            status_label: None,
            priority: Some("high".into()),
            issue_type: "feature".into(),
            project_name: "Acme".into(),
            reporter_name: Some("Client".into()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            due_date: None,
            comment_count: 3,
            tldr_summary: None,
            tldr_agent: None,
            tldr_tests: None,
            tldr_files: 0,
        }
    }

    #[test]
    fn issue_page_carries_object_specific_meta() {
        // The whole point: the preview must not be the marketing card.
        let html = issue_html("01HX", &issue("Le client veut le SSO Google", None));
        assert!(html.contains(r#"<meta property="og:title" content="ACM-124 · Le client veut le SSO Google · Acme">"#));
        assert!(html.contains("/api/v1/public/og/issue/01HX"));
        assert!(html.contains("summary_large_image"));
        // Shared links must never be indexed.
        assert!(html.contains(r#"content="noindex, nofollow""#));
    }

    #[test]
    fn issue_description_falls_back_into_the_preview_line() {
        let html = issue_html("01HX", &issue("Titre", Some("Le PDF part au comptable")));
        assert!(html.contains("Le PDF part au comptable"));
        assert!(html.contains("3 comments"));
        assert!(html.contains("high priority"));
    }

    #[test]
    fn markup_in_a_title_cannot_break_out_of_a_meta_attribute() {
        let html = issue_html("01HX", &issue(r#"a" onload="alert(1)"#, None));
        assert!(!html.contains(r#"onload="alert(1)"#));
        assert!(html.contains("&quot;"));
    }

    #[test]
    fn multibyte_titles_do_not_panic() {
        let html = issue_html("01HX", &issue(&"é".repeat(400), Some(&"à".repeat(4000))));
        assert!(html.contains("ACM-124"));
    }

    #[test]
    fn strip_markup_drops_tags_and_data_urls() {
        let out = strip_markup("<p>Hello   <b>world</b></p> data:image/png;base64,AAAA end");
        assert_eq!(out, "Hello world end");
    }

    #[test]
    fn humanize_only_touches_snake_case() {
        assert_eq!(humanize("in_progress"), "In progress");
        assert_eq!(humanize("Waiting on client"), "Waiting on client");
    }

    #[test]
    fn project_page_shows_counts_and_open_issues() {
        let r = ProjectRow {
            id: uuid::Uuid::nil(),
            name: "Acme portal".into(),
            description: Some("Client portal work".into()),
            prefix: "ACM".into(),
            total: 42,
            open: 12,
            done: 30,
            agent_actions: 311,
            last_activity: Some(Utc::now()),
        };
        let recent = vec![ProjectIssueRow {
            display_id: "ACM-124".into(),
            title: "SSO Google".into(),
            status: "in_progress".into(),
            status_label: None,
        }];
        let html = project_html("01HP", &r, &recent);
        assert!(html.contains("Acme portal"));
        assert!(html.contains("311"));
        assert!(html.contains("ACM-124"));
        assert!(html.contains("/api/v1/public/og/project/01HP"));
        // Titles only — never descriptions of listed issues.
        assert!(!html.contains("Client portal work</span>"));
    }

    #[test]
    fn project_page_without_open_issues_omits_the_list() {
        let r = ProjectRow {
            id: uuid::Uuid::nil(),
            name: "Empty".into(),
            description: None,
            prefix: "EMP".into(),
            total: 0,
            open: 0,
            done: 0,
            agent_actions: 0,
            last_activity: None,
        };
        let html = project_html("01HP", &r, &[]);
        // The stylesheet always ships `.issue-list`; what must be absent is the
        // rendered list itself.
        assert!(!html.contains(r#"<ul class="issue-list">"#));
        assert!(html.contains("Empty"));
    }
}
