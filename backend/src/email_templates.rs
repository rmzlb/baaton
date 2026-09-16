//! HTML email templates pour les notifications Baaton.
//! Inline styles uniquement — les clients mail suppriment les blocs <style>.

/// Minimal HTML-escape: &, <, >, ", '.
///
/// User-supplied strings (titles, names, comment bodies, status labels) go
/// through this before embedding in HTML.  A title that contains `<script>`
/// must not execute in the reader's mail client.
fn he(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
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
    // `label` must already be HTML-escaped by the caller; `color` is always a
    // hex literal from `status_color()` or a hardcoded constant.
    format!(
        r#"<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:{color}22;border:1px solid {color}44;color:{color};font-size:11px;font-weight:600;letter-spacing:0.03em;">{label}</span>"#
    )
}

fn cta_button(url: &str, label: &str) -> String {
    let url_esc = he(url);
    let label_esc = he(label);
    format!(
        r#"<a href="{url_esc}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#f59e0b;color:#0a0a0a;font-weight:700;font-size:13px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;">{label_esc} &#8594;</a>"#
    )
}

/// Shared email wrapper.
///
/// `public_url` is the app base URL (e.g. `https://app.baaton.dev`), used to
/// build absolute footer and content links.
///
/// The Pixel Tanuki logo is served from a hosted static PNG; there is no
/// inline base64 — it inflates the message and is blocked by security-
/// conscious mail clients (Gmail strips `data:` URIs from `<img>` tags).
/// The parent deploys the asset at `/brand/tanuki-email.png` on baaton.dev
/// before enabling email delivery.
fn email_layout(accent: &str, content_html: &str, project_name: &str, public_url: &str) -> String {
    let project_name_esc = he(project_name);
    let tanuki_url = "https://baaton.dev/brand/tanuki-email.png";
    // /settings is the valid frontend router path; /settings/integrations is not a route.
    let manage_url = format!("{}/settings", public_url.trim_end_matches('/'));
    let manage_url_esc = he(&manage_url);
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f5f3;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f5f3;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e6e5e1;border-radius:10px;margin:0 auto;">
<tr><td style="height:3px;background:{accent};border-radius:10px 10px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 24px 16px;">
<img src="{tanuki_url}" width="24" height="24" style="vertical-align:middle;margin-right:8px;" alt="">
<span style="font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:14px;color:#0a0a0a;letter-spacing:0.1em;vertical-align:middle;">BAATON</span>
</td></tr>
<tr><td style="height:1px;background:#e6e5e1;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 24px;">{content_html}</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #f0eeea;background:#fafaf8;border-radius:0 0 10px 10px;font-size:11px;color:#9c9b95;font-family:Arial,Helvetica,sans-serif;">
You follow <b>{project_name_esc}</b> on Baaton. &middot;
<a href="{manage_url_esc}" style="color:#9c9b95;">Manage notifications</a>
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
            r#"<p style="margin:4px 0 0;font-size:12px;color:#9c9b95;font-family:Arial,Helvetica,sans-serif;">Created by {}</p>"#,
            he(actor)
        ),
        None => String::new(),
    };
    let display_id = he(&notice.display_id);
    let title = he(&notice.title);
    // display_id is alphanumeric + hyphen (e.g. "BAA-42") — URL-safe as-is.
    let issue_url = format!(
        "{}/all-issues?issue={}",
        public_url.trim_end_matches('/'),
        notice.display_id,
    );
    let cta = cta_button(&issue_url, "View Issue");
    let content = format!(
        r#"{badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id} &middot; {title}</h2>{actor_line}{cta}"#
    );
    email_layout(
        "#f59e0b",
        &content,
        notice.project_name.as_deref().unwrap_or("Baaton"),
        public_url,
    )
}

pub fn status_changed_html(notice: &crate::notifyd::StatusNotice, public_url: &str) -> String {
    let sc = status_color(&notice.to_status.to_lowercase());
    let from_badge = status_badge(&he(&notice.from_status), "#9c9b95");
    let to_badge = status_badge(&he(&notice.to_status), sc);
    let comment_block = match &notice.last_comment {
        Some((author, body)) => {
            let excerpt: String = body.chars().take(200).collect();
            format!(
                r#"<div style="margin:12px 0;background:#f6f5f3;border-radius:6px;padding:10px 12px;font-size:12px;color:#5c5c57;font-family:Arial,Helvetica,sans-serif;">&#128172; {}: {}</div>"#,
                he(author),
                he(&excerpt)
            )
        }
        None => String::new(),
    };
    let display_id = he(&notice.issue.display_id);
    let title = he(&notice.issue.title);
    let issue_url = format!(
        "{}/all-issues?issue={}",
        public_url.trim_end_matches('/'),
        notice.issue.display_id,
    );
    let cta = cta_button(&issue_url, "View Issue");
    let content = format!(
        r#"{from_badge} &#8594; {to_badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id} &middot; {title}</h2>{comment_block}{cta}"#
    );
    email_layout(
        sc,
        &content,
        notice.issue.project_name.as_deref().unwrap_or("Baaton"),
        public_url,
    )
}

pub fn comment_added_html(notice: &crate::notifyd::CommentNotice, public_url: &str) -> String {
    let badge = status_badge("New Comment", "#7c3aed");
    let actor = he(notice.issue.actor.as_deref().unwrap_or("Someone"));
    let excerpt: String = notice.body.chars().take(200).collect();
    let excerpt_esc = he(&excerpt);
    let display_id = he(&notice.issue.display_id);
    let title = he(&notice.issue.title);
    let issue_url = format!(
        "{}/all-issues?issue={}",
        public_url.trim_end_matches('/'),
        notice.issue.display_id,
    );
    let cta = cta_button(&issue_url, "View Issue");
    let content = format!(
        r#"{badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id} &middot; {title}</h2><p style="margin:12px 0 4px;font-size:12px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{actor}</p><div style="background:#f6f5f3;border-radius:6px;padding:10px 12px;font-size:13px;color:#3d3d3a;font-family:Arial,Helvetica,sans-serif;">{excerpt_esc}</div>{cta}"#
    );
    email_layout(
        "#7c3aed",
        &content,
        notice.issue.project_name.as_deref().unwrap_or("Baaton"),
        public_url,
    )
}

/// Template for the "In Review" creator notification.
///
/// Distinct from `status_changed_html` (for subscribers): the creator is
/// notified automatically when someone transitions their ticket to `in_review`,
/// no subscription required.
///
/// The `issue_id: uuid::Uuid` parameter that existed in earlier versions has
/// been removed: the deep link now uses `display_id` via the
/// `/all-issues?issue=` route, which is the only route the frontend router
/// exposes for this navigation.
pub fn in_review_creator_html(
    display_id: &str,
    title: &str,
    project_name: &str,
    public_url: &str,
) -> String {
    let accent = "#6366f1";
    let badge = status_badge("IN REVIEW", accent);
    let issue_url = format!(
        "{}/all-issues?issue={}",
        public_url.trim_end_matches('/'),
        display_id,
    );
    let display_id_esc = he(display_id);
    let title_esc = he(title);
    let cta = cta_button(&issue_url, &format!("Review {display_id}"));
    let content = format!(
        "{badge}\
<h2 style=\"margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;\
font-family:Arial,Helvetica,sans-serif;\">{display_id_esc} is ready for your review</h2>\
<p style=\"margin:4px 0 12px;font-size:13px;color:#5c5c57;\
font-family:Arial,Helvetica,sans-serif;\">Someone has submitted their work on this \
ticket. Take a look when you&#39;re ready.</p>\
<div style=\"margin:8px 0;padding:10px 12px;background:#f6f5f3;border-radius:6px;\
font-size:13px;color:#3d3d3a;font-family:Arial,Helvetica,sans-serif;\">{title_esc}</div>\
{cta}"
    );
    email_layout(accent, &content, project_name, public_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice() -> crate::notifyd::IssueNotice {
        crate::notifyd::IssueNotice {
            display_id: "BAA-42".into(),
            title: "Export button unresponsive".into(),
            project_name: Some("Baaton".into()),
            actor: Some("agent".into()),
            issue_id: uuid::Uuid::nil(),
        }
    }

    /// The hosted PNG asset must appear; inline base64 SVG must not.
    /// A base64-encoded SVG inflates the email ~4× and is stripped by Gmail.
    #[test]
    fn logo_is_hosted_png_not_inline_svg() {
        let html = issue_created_html(&notice(), "https://app.baaton.dev");
        assert!(
            html.contains("baaton.dev/brand/tanuki-email.png"),
            "hosted PNG expected"
        );
        assert!(
            !html.contains("data:image/svg+xml;base64"),
            "inline SVG must be removed"
        );
        assert!(!html.contains("data:image/"), "no inline image data-URIs");
    }

    /// The issue CTA must link to the frontend router path.
    /// There is no /issues/:id route; the correct deep-link is
    /// /all-issues?issue=DISPLAY_ID.
    #[test]
    fn cta_links_to_all_issues_deep_link() {
        let html = issue_created_html(&notice(), "https://app.baaton.dev");
        assert!(
            html.contains("/all-issues?issue=BAA-42"),
            "deep link must use display_id, got: {}",
            html.find("href").map_or_else(String::new, |i| html[i..].chars().take(80).collect::<String>())
        );
        assert!(
            !html.contains("/issues/"),
            "UUID-based /issues/ path must be absent"
        );
    }

    /// Trailing slash on public_url must not produce a double-slash in links.
    #[test]
    fn trailing_slash_trimmed_in_url() {
        let html = issue_created_html(&notice(), "https://app.baaton.dev/");
        assert!(
            html.contains("https://app.baaton.dev/all-issues?issue=BAA-42"),
            "double-slash must not appear"
        );
        assert!(!html.contains("//all-issues"), "double-slash in URL path");
    }

    /// User-controlled strings must be HTML-escaped.
    /// A crafted title must not execute as a script in the reader's mail client.
    #[test]
    fn user_data_is_html_escaped() {
        let mut n = notice();
        n.title = "<script>alert(1)</script>".into();
        n.actor = Some("Alice & Bob".into());
        let html = issue_created_html(&n, "https://app.baaton.dev");
        assert!(!html.contains("<script>"), "raw script tag must not appear");
        assert!(html.contains("&lt;script&gt;"), "escaped form expected");
        assert!(html.contains("Alice &amp; Bob"), "& must be escaped");
    }

    /// Comment bodies in status-change emails must be HTML-escaped.
    #[test]
    fn status_changed_escapes_comment_body() {
        let notice = crate::notifyd::StatusNotice {
            issue: crate::notifyd::IssueNotice {
                display_id: "BAA-42".into(),
                title: "Title".into(),
                project_name: Some("Baaton".into()),
                actor: Some("user".into()),
                issue_id: uuid::Uuid::nil(),
            },
            from_status: "todo".into(),
            to_status: "in_review".into(),
            last_comment: Some(("Rev".into(), "<img src=x onerror=alert(1)>".into())),
            changed_at: chrono::Utc::now(),
        };
        let html = status_changed_html(&notice, "https://app.baaton.dev");
        assert!(
            !html.contains("<img src=x"),
            "raw HTML in comment body must be escaped"
        );
        assert!(html.contains("&lt;img"), "escaped form expected");
    }

    /// The footer must not present a link labelled "Unsubscribe" that navigates
    /// to the same page as "Manage" — that is deceptive.
    /// A single accurate "Manage notifications" link is sufficient.
    #[test]
    fn footer_has_no_fake_unsubscribe_link() {
        let html = issue_created_html(&notice(), "https://app.baaton.dev");
        assert!(
            !html.contains(">Unsubscribe<"),
            "fake unsubscribe label must be removed"
        );
        assert!(
            html.contains("Manage notifications"),
            "manage link must be present"
        );
        // /settings is the valid route; /settings/integrations does not exist.
        assert!(
            html.contains("app.baaton.dev/settings\""),
            "must link to /settings, not a non-existent sub-path"
        );
        assert!(
            !html.contains("/settings/integrations"),
            "/settings/integrations is not a valid frontend route"
        );
    }

    #[test]
    fn he_escapes_all_dangerous_chars() {
        assert_eq!(he("<b>a</b>"), "&lt;b&gt;a&lt;/b&gt;");
        assert_eq!(he("a & b"), "a &amp; b");
        assert_eq!(he("\"quoted\""), "&quot;quoted&quot;");
        assert_eq!(he("it's"), "it&#x27;s");
        // Ampersand in an already-encoded context is encoded once at the boundary.
        assert_eq!(he("safe"), "safe");
    }

    #[test]
    fn in_review_cta_says_review() {
        let html = in_review_creator_html(
            "BAA-42",
            "Fix the export button",
            "Baaton",
            "https://app.baaton.dev",
        );
        assert!(html.contains("Review BAA-42"), "CTA must say Review");
        assert!(
            html.contains("/all-issues?issue=BAA-42"),
            "deep link must be correct"
        );
    }
}
