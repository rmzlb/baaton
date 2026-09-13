//! OG cards for shared issues and projects (SVG, 1200×630).
//!
//! Lives apart from `og.rs` (agent runs) because the two cards answer different
//! questions and share nothing but the frame: a run card reports an outcome, an
//! issue card has to make a stranger in a Slack channel understand *what this
//! ticket is about* without opening it. Keeping them in one file would mean one
//! renderer with a `match` on object type and a widest-common-denominator
//! layout, which is exactly how these end up generic.
//!
//! SVG, not raster: matches the existing run card, no font binaries to ship, no
//! rasterizer in the image. Telegram, Slack, Discord, X and GitHub all render
//! SVG OG images. WhatsApp is the known exception — see `public_share_ssr.rs`,
//! which is why the meta tags there also advertise a PNG-safe fallback size.

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use sqlx::PgPool;

use crate::text::truncate_chars;

/* ─────────────── shared frame ─────────────── */

/// Card chrome: gradient, grid, wordmark, accent rule. Every card shares this
/// so a Baaton link is recognizable at thumbnail size before any text is read.
fn frame(eyebrow: &str, body: &str, footer_right: &str) -> String {
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
  <g transform="translate(64, 64)">
    <rect width="14" height="14" rx="3" fill="#f59e0b"/>
    <text x="24" y="13" font-size="20" font-weight="600" fill="#ededed" letter-spacing="-0.5">Baaton</text>
    <text x="24" y="34" font-size="12" font-weight="500" fill="#888" letter-spacing="1.5">{eyebrow}</text>
  </g>
{body}
  <text x="1136" y="554" text-anchor="end" font-family="'JetBrains Mono', monospace" font-size="14" fill="#666">{footer_right}</text>
  <rect x="0" y="626" width="1200" height="4" fill="#f59e0b"/>
</svg>"##
    )
}

/// Pill in the top-right corner (status, or project prefix).
fn pill(label: &str, color: &str, width: i32) -> String {
    let x = -width;
    let mid = -(width / 2);
    format!(
        r#"  <g transform="translate(1136, 64)" text-anchor="end">
    <rect x="{x}" y="-2" width="{width}" height="32" rx="16" fill="{color}" opacity="0.15"/>
    <rect x="{x}" y="-2" width="{width}" height="32" rx="16" fill="none" stroke="{color}" stroke-width="1" opacity="0.6"/>
    <text x="{mid}" y="19" font-size="14" font-weight="600" fill="{color}" text-anchor="middle" letter-spacing="0.5">{label}</text>
  </g>"#,
        label = xml_esc(label)
    )
}

/// One bottom-row metric.
fn stat(x: i32, label: &str, value: &str, color: &str) -> String {
    format!(
        r##"  <g transform="translate({x}, 528)">
    <text x="0" y="0" font-size="11" font-weight="500" fill="#888" letter-spacing="1.2">{label}</text>
    <text x="0" y="26" font-family="'JetBrains Mono', monospace" font-size="22" font-weight="600" fill="{color}">{value}</text>
  </g>"##,
        label = xml_esc(label),
        value = xml_esc(value)
    )
}

fn svg_response(svg: String, found: bool) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "image/svg+xml; charset=utf-8".parse().unwrap(),
    );
    // Short s-maxage: a renamed ticket must not keep unfurling under its old
    // title for a day. Crawlers refetch on each new paste, so this is cheap.
    headers.insert(
        header::CACHE_CONTROL,
        if found {
            "public, max-age=300, s-maxage=600".parse().unwrap()
        } else {
            "public, max-age=60".parse().unwrap()
        },
    );
    (StatusCode::OK, headers, svg)
}

/* ─────────────── issue card ─────────────── */

#[derive(sqlx::FromRow)]
struct IssueOgRow {
    display_id: String,
    title: String,
    status: String,
    status_label: Option<String>,
    status_color: Option<String>,
    priority: Option<String>,
    issue_type: String,
    project_name: String,
    comment_count: i64,
    tldr_summary: Option<String>,
    tldr_agent: Option<String>,
}

pub async fn render_issue_svg(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let token = token.strip_suffix(".svg").unwrap_or(&token).to_string();

    let row: Option<IssueOgRow> = sqlx::query_as::<_, IssueOgRow>(
        r#"
        SELECT
            i.display_id        AS display_id,
            i.title             AS title,
            i.status            AS status,
            i.status_label      AS status_label,
            i.status_color      AS status_color,
            i.priority          AS priority,
            i.type              AS issue_type,
            p.name              AS project_name,
            (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id)::bigint AS comment_count,
            t.summary           AS tldr_summary,
            t.agent_name        AS tldr_agent
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN LATERAL (
            SELECT summary, agent_name
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
        None => svg_response(not_found_svg("This link is private or has expired."), false),
        Some(r) => svg_response(issue_svg(&r), true),
    }
}

fn issue_svg(r: &IssueOgRow) -> String {
    // The title is the payload. Three lines at 42px is the largest size that
    // still fits a real ticket title ("Le PDF doit partir au comptable, pas au
    // client" is 48 chars); anything bigger truncates the sentence that the
    // reader needs, which defeats the purpose of the card.
    let lines = wrap(&r.title, 42, 3);
    let title_block: String = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            format!(
                r##"  <text x="64" y="{y}" font-size="42" font-weight="600" fill="#ededed" letter-spacing="-0.8">{l}</text>"##,
                y = 268 + (i as i32 * 54),
                l = xml_esc(l)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let status_color = r
        .status_color
        .as_deref()
        .filter(|c| is_safe_color(c))
        .unwrap_or_else(|| default_status_color(&r.status));
    let status_label = r.status_label.as_deref().unwrap_or(&r.status);

    // Below the title: what an agent last reported, if anything. This is the
    // line that tells a reader whether the ticket is still a question or
    // already answered.
    let tldr_block = match (&r.tldr_summary, &r.tldr_agent) {
        (Some(s), Some(a)) if !s.is_empty() => {
            let (l1, _) = split_two(&truncate_chars(s, 92), 92);
            format!(
                r##"  <g transform="translate(64, {y})">
    <rect x="0" y="-20" width="4" height="52" rx="2" fill="#f59e0b" opacity="0.8"/>
    <text x="20" y="-2" font-size="11" font-weight="500" fill="#888" letter-spacing="1.2">LAST REPORTED BY {agent}</text>
    <text x="20" y="22" font-size="19" fill="#ddd">{summary}</text>
  </g>"##,
                y = 268 + (lines.len() as i32 * 54) + 24,
                agent = xml_esc(&a.to_uppercase()),
                summary = xml_esc(&l1)
            )
        }
        _ => String::new(),
    };

    let priority = r.priority.as_deref().unwrap_or("—");
    let body = format!(
        "{pill}\n  <text x=\"64\" y=\"196\" font-family=\"'JetBrains Mono', ui-monospace, monospace\" font-size=\"26\" font-weight=\"700\" fill=\"#f59e0b\" letter-spacing=\"-0.5\">{did}</text>\n  <text x=\"{px}\" y=\"196\" font-size=\"22\" fill=\"#888\">{project}</text>\n{title_block}\n{tldr_block}\n{s1}\n{s2}\n{s3}",
        pill = pill(&status_label.to_uppercase(), status_color, 180),
        did = xml_esc(&r.display_id),
        // Monospace at 26px ≈ 15.6px/char. Offset the project name past the id
        // instead of guessing a fixed column, so BAA-7 and CRAIE-1042 both sit
        // right next to their project.
        px = 64 + (r.display_id.chars().count() as i32 * 16) + 20,
        project = xml_esc(&format!("· {}", r.project_name)),
        s1 = stat(64, "TYPE", &r.issue_type, "#ededed"),
        s2 = stat(280, "PRIORITY", priority, priority_color(priority)),
        s3 = stat(520, "DISCUSSION", &plural(r.comment_count, "comment"), "#ededed"),
    );

    frame("SHARED ISSUE", &body, "baaton.dev")
}

/* ─────────────── project card ─────────────── */

#[derive(sqlx::FromRow)]
struct ProjectOgRow {
    name: String,
    description: Option<String>,
    prefix: String,
    total: i64,
    open: i64,
    done: i64,
    agent_actions: i64,
}

pub async fn render_project_svg(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let token = token.strip_suffix(".svg").unwrap_or(&token).to_string();

    let row: Option<ProjectOgRow> = sqlx::query_as::<_, ProjectOgRow>(
        r#"
        SELECT
            p.name        AS name,
            p.description AS description,
            p.prefix      AS prefix,
            COALESCE(s.total, 0)::bigint  AS total,
            COALESCE(s.open,  0)::bigint  AS open,
            COALESCE(s.done,  0)::bigint  AS done,
            COALESCE(a.n,     0)::bigint  AS agent_actions
        FROM projects p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE COALESCE(status_category, 'started') NOT IN ('completed', 'canceled')
                ) AS open,
                COUNT(*) FILTER (WHERE status_category = 'completed') AS done
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

    match row {
        None => svg_response(not_found_svg("This project link is private or has expired."), false),
        Some(r) => svg_response(project_svg(&r), true),
    }
}

fn project_svg(r: &ProjectOgRow) -> String {
    let name_lines = wrap(&r.name, 26, 2);
    let name_block: String = name_lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            format!(
                r##"  <text x="64" y="{y}" font-size="64" font-weight="700" fill="#ededed" letter-spacing="-2">{l}</text>"##,
                y = 280 + (i as i32 * 76),
                l = xml_esc(l)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let desc_block = match r.description.as_deref().filter(|d| !d.trim().is_empty()) {
        Some(d) => {
            let (l1, l2) = split_two(&truncate_chars(d, 120), 60);
            format!(
                r##"  <text x="64" y="{y1}" font-size="21" fill="#bbb">{l1}</text>
  <text x="64" y="{y2}" font-size="21" fill="#bbb">{l2}</text>"##,
                y1 = 280 + (name_lines.len() as i32 * 76) + 8,
                y2 = 280 + (name_lines.len() as i32 * 76) + 36,
                l1 = xml_esc(&l1),
                l2 = xml_esc(&l2)
            )
        }
        None => String::new(),
    };

    // `agent_actions` is the one number no other tracker can print, so it gets
    // the accent colour and the last slot — the position the eye lands on after
    // the title.
    let body = format!(
        "{pill}\n  <text x=\"64\" y=\"196\" font-size=\"14\" font-weight=\"500\" fill=\"#888\" letter-spacing=\"2\">PROJECT</text>\n{name_block}\n{desc_block}\n{s1}\n{s2}\n{s3}\n{s4}",
        pill = pill(&r.prefix.to_uppercase(), "#f59e0b", 130),
        s1 = stat(64, "ISSUES", &r.total.to_string(), "#ededed"),
        s2 = stat(260, "OPEN", &r.open.to_string(), "#3b82f6"),
        s3 = stat(430, "DONE", &r.done.to_string(), "#10b981"),
        s4 = stat(600, "AGENT ACTIONS", &r.agent_actions.to_string(), "#f59e0b"),
    );

    frame("SHARED PROJECT", &body, "baaton.dev")
}

/* ─────────────── helpers ─────────────── */

fn not_found_svg(msg: &str) -> String {
    let body = format!(
        r##"  <text x="600" y="320" text-anchor="middle" font-size="40" font-weight="600" fill="#ededed">Not available</text>
  <text x="600" y="372" text-anchor="middle" font-size="21" fill="#888">{}</text>"##,
        xml_esc(msg)
    );
    frame("BAATON", &body, "baaton.dev")
}

/// Greedy word wrap into at most `max_lines` lines of `max_chars`, ellipsizing
/// the last line when the text does not fit. Operates on chars, never bytes:
/// French ticket titles are the normal case here, not the edge case.
fn wrap(s: &str, max_chars: usize, max_lines: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();

    for word in s.split_whitespace() {
        let candidate_len = if cur.is_empty() {
            word.chars().count()
        } else {
            cur.chars().count() + 1 + word.chars().count()
        };
        if candidate_len <= max_chars {
            if !cur.is_empty() {
                cur.push(' ');
            }
            cur.push_str(word);
            continue;
        }
        if !cur.is_empty() {
            lines.push(std::mem::take(&mut cur));
        }
        if lines.len() == max_lines {
            break;
        }
        // A single word longer than the line (a pasted URL, a stack frame) would
        // loop forever if we only ever pushed the accumulator, so cut it across
        // the lines that are left. Chunk instead of truncating once: a 300-char
        // URL used to collapse to a single line and drop the rest silently.
        if word.chars().count() > max_chars {
            let mut chars = word.chars().peekable();
            while chars.peek().is_some() && lines.len() < max_lines {
                let chunk: String = chars.by_ref().take(max_chars).collect();
                lines.push(chunk);
            }
            if lines.len() == max_lines {
                break;
            }
        } else {
            cur.push_str(word);
        }
    }
    if !cur.is_empty() && lines.len() < max_lines {
        lines.push(cur);
    }
    if lines.is_empty() {
        return vec![String::from("(untitled)")];
    }
    // Signal truncation on the last line so the reader knows the title continues.
    if lines.len() == max_lines {
        let consumed: usize = lines.iter().map(|l| l.chars().count() + 1).sum();
        if consumed < s.chars().count() {
            // Build the ellipsized line by hand: `truncate_chars` already appends
            // its own "…" when it cuts, so wrapping it in `format!("{}…")` pushed
            // the line one char over `max_chars` (it overflowed the SVG box).
            let last = lines.last_mut().unwrap();
            let keep = max_chars.saturating_sub(1);
            *last = last.chars().take(keep).collect::<String>();
            last.push('…');
        }
    }
    lines
}

fn split_two(s: &str, max_chars: usize) -> (String, String) {
    let w = wrap(s, max_chars, 2);
    (
        w.first().cloned().unwrap_or_default(),
        w.get(1).cloned().unwrap_or_default(),
    )
}

fn plural(n: i64, noun: &str) -> String {
    if n == 1 {
        format!("1 {noun}")
    } else {
        format!("{n} {noun}s")
    }
}

fn default_status_color(status: &str) -> &'static str {
    match status {
        "done" => "#10b981",
        "cancelled" | "canceled" => "#ef4444",
        "in_progress" => "#f59e0b",
        "in_review" => "#8b5cf6",
        "todo" => "#3b82f6",
        _ => "#888888",
    }
}

fn priority_color(p: &str) -> &'static str {
    match p {
        "urgent" => "#ef4444",
        "high" => "#f59e0b",
        "medium" => "#3b82f6",
        "low" => "#888888",
        _ => "#888888",
    }
}

/// Custom status colours come from user input (`status_color`), and they are
/// interpolated straight into an SVG attribute. Allow only `#rgb` / `#rrggbb`
/// so a crafted value cannot close the attribute and inject markup.
fn is_safe_color(c: &str) -> bool {
    let bytes = c.as_bytes();
    (bytes.len() == 4 || bytes.len() == 7)
        && bytes[0] == b'#'
        && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_breaks_on_words() {
        let out = wrap("Le PDF doit partir au comptable, pas au client", 20, 3);
        assert!(out.len() >= 2);
        assert!(out.iter().all(|l| l.chars().count() <= 20));
    }

    #[test]
    fn wrap_hard_cuts_a_single_long_word() {
        // A pasted URL must not spin the greedy loop forever.
        let out = wrap(&"a".repeat(300), 40, 2);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|l| l.chars().count() <= 40));
    }

    #[test]
    fn wrap_is_char_safe_on_french_titles() {
        // Byte slicing here would panic mid-codepoint; chars must be used.
        let out = wrap("tête de lit à régler très rapidement pour le client", 12, 3);
        assert!(out.iter().all(|l| l.chars().count() <= 12));
    }

    #[test]
    fn wrap_marks_truncation() {
        let out = wrap("one two three four five six seven eight nine ten", 10, 2);
        assert_eq!(out.len(), 2);
        assert!(out[1].ends_with('…'));
    }

    #[test]
    fn wrap_never_returns_empty() {
        assert_eq!(wrap("   ", 20, 2), vec!["(untitled)".to_string()]);
    }

    #[test]
    fn unsafe_status_color_is_rejected() {
        assert!(is_safe_color("#f59e0b"));
        assert!(is_safe_color("#fff"));
        // Attribute-breaking payload must not reach the SVG.
        assert!(!is_safe_color("\"/><script>alert(1)</script>"));
        assert!(!is_safe_color("red"));
    }

    #[test]
    fn issue_card_renders_with_no_tldr_and_no_priority() {
        let r = IssueOgRow {
            display_id: "BAA-7".into(),
            title: "Le client veut le SSO Google sur son portail".into(),
            status: "in_progress".into(),
            status_label: None,
            status_color: None,
            priority: None,
            issue_type: "feature".into(),
            project_name: "Baaton".into(),
            comment_count: 1,
            tldr_summary: None,
            tldr_agent: None,
        };
        let svg = issue_svg(&r);
        assert!(svg.contains("BAA-7"));
        assert!(svg.contains("1 comment"));
        assert!(svg.contains("IN_PROGRESS"));
    }

    #[test]
    fn issue_card_escapes_a_title_containing_markup() {
        let r = IssueOgRow {
            display_id: "BAA-8".into(),
            title: "<script>alert('x')</script> & more".into(),
            status: "todo".into(),
            status_label: None,
            status_color: Some("\"/><script>".into()),
            priority: Some("urgent".into()),
            issue_type: "bug".into(),
            project_name: "A & B".into(),
            comment_count: 0,
            tldr_summary: None,
            tldr_agent: None,
        };
        let svg = issue_svg(&r);
        assert!(!svg.contains("<script>"));
        assert!(svg.contains("&amp;"));
    }

    #[test]
    fn project_card_renders_counts() {
        let r = ProjectOgRow {
            name: "Baaton".into(),
            description: Some("The board agents actually use".into()),
            prefix: "BAA".into(),
            total: 1074,
            open: 500,
            done: 574,
            agent_actions: 2411,
        };
        let svg = project_svg(&r);
        assert!(svg.contains("1074"));
        assert!(svg.contains("2411"));
        assert!(svg.contains("BAA"));
    }
}
