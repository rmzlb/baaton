//! GitHub-style README badge for a repo's Baaton agent run activity.
//! Public, cached 5 minutes, hand-rolled SVG (shields.io aesthetic but
//! Baaton-themed — amber accent, dark surface).
//!
//! Resolves the project via `github_repositories(owner, name)` joined to
//! `github_repo_mappings(github_repo_id → project_id)` and aggregates:
//! - total agent runs (any status)
//! - runs marked completed
//! - runs this week (created_at > now() - 7d)
//!
//! If the repo isn't tracked by Baaton, returns a "not tracked" badge (200).

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use sqlx::PgPool;

#[derive(Debug, sqlx::FromRow)]
struct BadgeStats {
    total: i64,
    completed: i64,
    week: i64,
}

pub async fn render(
    State(pool): State<PgPool>,
    Path((owner, repo)): Path<(String, String)>,
) -> impl IntoResponse {
    let repo = repo.strip_suffix(".svg").unwrap_or(&repo).to_string();

    let stats: Option<BadgeStats> = sqlx::query_as::<_, BadgeStats>(
        r#"
        SELECT
            COUNT(*)::bigint                                                          AS total,
            COUNT(*) FILTER (WHERE s.status = 'completed')::bigint                    AS completed,
            COUNT(*) FILTER (WHERE s.created_at > NOW() - INTERVAL '7 days')::bigint  AS week
        FROM agent_sessions s
        JOIN github_repo_mappings grm ON grm.project_id = s.project_id
        JOIN github_repositories gr ON gr.github_repo_id = grm.github_repo_id
        WHERE gr.owner = $1 AND gr.name = $2
        "#,
    )
    .bind(&owner)
    .bind(&repo)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let svg = match stats {
        Some(s) if s.total > 0 => render_active_badge(&s),
        _ => render_inactive_badge(),
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "image/svg+xml; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=300, s-maxage=300".parse().unwrap(),
    );
    (StatusCode::OK, headers, svg).into_response()
}

fn render_active_badge(s: &BadgeStats) -> String {
    let label = "agent runs";
    let value = format!(
        "{} · {} reviewed · {} this week",
        s.total, s.completed, s.week
    );
    badge_svg(label, &value, "#f59e0b")
}

fn render_inactive_badge() -> String {
    badge_svg("agent runs", "not tracked", "#666666")
}

/// Hand-rolled badge in the shields.io two-pill aesthetic.
fn badge_svg(label: &str, value: &str, value_color: &str) -> String {
    // Approximate text width: ~7px per char at 11px font-size, +16px padding.
    let label_w = (label.chars().count() as i32 * 7 + 16).max(60);
    let value_w = (value.chars().count() as i32 * 7 + 16).max(60);
    let total_w = label_w + value_w;
    let height = 22;

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="{height}" viewBox="0 0 {total} {height}" role="img" aria-label="{label_esc}: {value_esc}">
  <title>{label_esc}: {value_esc}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="{total}" height="{height}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_w}" height="{height}" fill="#1a1a1a"/>
    <rect x="{label_w}" width="{value_w}" height="{height}" fill="{value_color}"/>
    <rect width="{total}" height="{height}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="{label_x}" y="15" fill="#000" fill-opacity=".3">{label_esc}</text>
    <text x="{label_x}" y="14">{label_esc}</text>
    <text x="{value_x}" y="15" fill="#000" fill-opacity=".3">{value_esc}</text>
    <text x="{value_x}" y="14">{value_esc}</text>
  </g>
</svg>"##,
        total = total_w,
        height = height,
        label_w = label_w,
        value_w = value_w,
        label_x = label_w / 2,
        value_x = label_w + value_w / 2,
        label_esc = xml_esc(label),
        value_esc = xml_esc(value),
        value_color = value_color,
    )
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
    fn active_badge_contains_counts() {
        let s = BadgeStats {
            total: 12,
            completed: 9,
            week: 4,
        };
        let svg = render_active_badge(&s);
        assert!(svg.contains("12 · 9 reviewed · 4 this week"));
        assert!(svg.contains("agent runs"));
        assert!(svg.starts_with("<svg"));
    }

    #[test]
    fn inactive_badge_says_not_tracked() {
        let svg = render_inactive_badge();
        assert!(svg.contains("not tracked"));
        assert!(svg.contains("agent runs"));
    }

    #[test]
    fn xml_escape_handles_entities() {
        assert_eq!(xml_esc("<script>"), "&lt;script&gt;");
        assert_eq!(xml_esc("a&b"), "a&amp;b");
    }

    #[test]
    fn badge_width_scales_with_value_length() {
        let short = badge_svg("a", "b", "#000");
        let long = badge_svg("a", "very long value here", "#000");
        let extract_width = |s: &str| {
            s.split("width=\"")
                .nth(1)
                .unwrap()
                .split('"')
                .next()
                .unwrap()
                .parse::<i32>()
                .unwrap()
        };
        assert!(extract_width(&long) > extract_width(&short));
    }
}
