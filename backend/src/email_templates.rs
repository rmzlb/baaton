//! HTML email templates pour les notifications Baaton.
//! Inline styles uniquement — les clients mail suppriment les blocs <style>.

use std::sync::OnceLock;
use base64::Engine as _;

#[rustfmt::skip]
const TANUKI_GRID: [[u8; 16]; 16] = [
    [0,0,0,0,0,2,2,0,0,2,2,0,0,0,0,0],
    [0,0,0,0,2,1,1,2,2,1,1,2,0,0,0,0],
    [0,0,0,2,1,1,1,1,1,1,1,1,2,0,0,0],
    [0,0,2,1,1,1,1,1,1,1,1,1,1,2,0,0],
    [0,0,2,1,2,3,1,1,1,2,3,1,1,2,0,0],
    [0,0,2,1,1,1,1,2,1,1,1,1,1,2,0,0],
    [0,0,0,2,1,1,1,1,1,1,1,1,2,0,0,0],
    [0,0,0,0,2,1,1,1,1,1,1,2,0,0,0,0],
    [0,0,0,2,1,1,1,1,1,1,1,1,2,0,0,0],
    [0,0,2,1,1,1,1,1,1,1,1,1,1,2,0,4],
    [0,0,2,1,1,1,1,1,1,1,1,1,1,2,4,0],
    [0,0,0,2,1,1,1,1,1,1,1,1,4,0,0,0],
    [0,0,0,0,2,2,1,1,1,2,2,4,0,0,0,0],
    [0,0,0,0,2,1,2,0,2,1,4,0,0,0,0,0],
    [0,0,0,0,2,1,2,0,2,4,2,0,0,0,0,0],
    [0,0,0,0,2,2,2,0,4,2,2,0,0,0,0,0],
];

const PIXEL_COLORS: [&str; 5] = ["", "#d4a574", "#5c3d2e", "#1a1a1a", "#f59e0b"];

static TANUKI_DATA_URI: OnceLock<String> = OnceLock::new();

fn tanuki_data_uri() -> &'static str {
    TANUKI_DATA_URI.get_or_init(|| {
        let mut svg = String::from(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">"#,
        );
        for (row, cols) in TANUKI_GRID.iter().enumerate() {
            for (col, &val) in cols.iter().enumerate() {
                if val != 0 {
                    let fill = PIXEL_COLORS[val as usize];
                    svg.push_str(&format!(
                        r#"<rect x="{col}" y="{row}" width="1" height="1" fill="{fill}"/>"#
                    ));
                }
            }
        }
        svg.push_str("</svg>");
        let b64 = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
        format!("data:image/svg+xml;base64,{b64}")
    })
}

fn status_color(status_key: &str) -> &'static str {
    let k = status_key;
    if ["not_ok", "not-ok", "notok", "blocked", "failed"]
        .iter()
        .any(|s| k.contains(*s))
    {
        "#ef4444"
    } else if ["in_progress", "in-progress", "inprogress", "doing", "review", "testing"]
        .iter()
        .any(|s| k.contains(*s))
    {
        "#3b82f6"
    } else if ["done", "ok", "complete", "closed", "resolved"]
        .iter()
        .any(|s| k.contains(*s))
    {
        "#16a34a"
    } else {
        "#9c9b95"
    }
}

fn status_badge(label: &str, color: &str) -> String {
    format!(
        r#"<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:{color}22;border:1px solid {color}44;color:{color};font-size:11px;font-weight:600;letter-spacing:0.03em;">{label}</span>"#
    )
}

fn cta_button(url: &str) -> String {
    format!(
        r#"<a href="{url}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#f59e0b;color:#0a0a0a;font-weight:700;font-size:13px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;">View Issue &#8594;</a>"#
    )
}

fn email_layout(accent: &str, content_html: &str, project_name: &str) -> String {
    let tanuki_uri = tanuki_data_uri();
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f5f3;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f5f3;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e6e5e1;border-radius:10px;margin:0 auto;">
<tr><td style="height:3px;background:{accent};border-radius:10px 10px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 24px 16px;">
<img src="{tanuki_uri}" width="24" height="24" style="image-rendering:pixelated;vertical-align:middle;margin-right:8px;" alt="">
<span style="font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:14px;color:#0a0a0a;letter-spacing:0.1em;vertical-align:middle;">BAATON</span>
</td></tr>
<tr><td style="height:1px;background:#e6e5e1;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 24px;">{content_html}</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #f0eeea;background:#fafaf8;border-radius:0 0 10px 10px;font-size:11px;color:#9c9b95;font-family:Arial,Helvetica,sans-serif;">
You follow <b>{project_name}</b> on Baaton. &middot;
<a href="https://app.baaton.dev/settings/integrations" style="color:#9c9b95;">Manage</a> &middot;
<a href="https://app.baaton.dev/settings/integrations" style="color:#9c9b95;">Unsubscribe</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"#
    )
}

pub fn issue_created_html(notice: &crate::notifyd::IssueNotice, public_url: &str) -> String {
    let badge = status_badge("New Issue", "#f59e0b");
    let actor_line = match notice.actor.as_deref().filter(|a| !a.trim().is_empty()) {
        Some(actor) => format!(
            r#"<p style="margin:4px 0 0;font-size:12px;color:#9c9b95;font-family:Arial,Helvetica,sans-serif;">Created by {actor}</p>"#
        ),
        None => String::new(),
    };
    let display_id = &notice.display_id;
    let title = &notice.title;
    let issue_url = format!("{public_url}/issues/{}", notice.issue_id);
    let cta = cta_button(&issue_url);
    let content = format!(
        r#"{badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id} &middot; {title}</h2>{actor_line}{cta}"#
    );
    email_layout(
        "#f59e0b",
        &content,
        notice.project_name.as_deref().unwrap_or("Baaton"),
    )
}

pub fn status_changed_html(notice: &crate::notifyd::StatusNotice, public_url: &str) -> String {
    let sc = status_color(&notice.to_status.to_lowercase());
    let from_badge = status_badge(&notice.from_status, "#9c9b95");
    let to_badge = status_badge(&notice.to_status, sc);
    let comment_block = match &notice.last_comment {
        Some((author, body)) => {
            let excerpt: String = body.chars().take(200).collect();
            format!(
                r#"<div style="margin:12px 0;background:#f6f5f3;border-radius:6px;padding:10px 12px;font-size:12px;color:#5c5c57;font-family:Arial,Helvetica,sans-serif;">&#128172; {author}: {excerpt}</div>"#
            )
        }
        None => String::new(),
    };
    let display_id = &notice.issue.display_id;
    let title = &notice.issue.title;
    let issue_url = format!("{public_url}/issues/{}", notice.issue.issue_id);
    let cta = cta_button(&issue_url);
    let content = format!(
        r#"{from_badge} &#8594; {to_badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id} &middot; {title}</h2>{comment_block}{cta}"#
    );
    email_layout(
        sc,
        &content,
        notice.issue.project_name.as_deref().unwrap_or("Baaton"),
    )
}

pub fn comment_added_html(notice: &crate::notifyd::CommentNotice, public_url: &str) -> String {
    let badge = status_badge("New Comment", "#7c3aed");
    let actor = notice.issue.actor.as_deref().unwrap_or("Someone");
    let excerpt: String = notice.body.chars().take(200).collect();
    let display_id = &notice.issue.display_id;
    let title = &notice.issue.title;
    let issue_url = format!("{public_url}/issues/{}", notice.issue.issue_id);
    let cta = cta_button(&issue_url);
    let content = format!(
        r#"{badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id} &middot; {title}</h2><p style="margin:12px 0 4px;font-size:12px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{actor}</p><div style="background:#f6f5f3;border-radius:6px;padding:10px 12px;font-size:13px;color:#3d3d3a;font-family:Arial,Helvetica,sans-serif;">{excerpt}</div>{cta}"#
    );
    email_layout(
        "#7c3aed",
        &content,
        notice.issue.project_name.as_deref().unwrap_or("Baaton"),
    )
}
