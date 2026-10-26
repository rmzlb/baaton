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
/// build absolute footer and content links. `footer_html` says why this person
/// receives the mail and must already be escaped.
///
/// The Pixel Tanuki logo is served from a hosted static PNG; there is no
/// inline base64 — it inflates the message and is blocked by security-
/// conscious mail clients (Gmail strips `data:` URIs from `<img>` tags).
fn email_layout(accent: &str, content_html: &str, footer_html: &str, public_url: &str) -> String {
    let tanuki_url = "https://baaton.dev/brand/tanuki-email.png";
    let manage_url_esc = he(&manage_url(public_url));
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f5f3;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f5f3;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e6e5e1;border-radius:10px;margin:0 auto;">
<tr><td style="height:3px;background:{accent};border-radius:10px 10px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 24px 16px;">
<img src="{tanuki_url}" width="24" height="24" style="vertical-align:middle;margin-right:8px;" alt="">
<span style="font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:14px;color:#0a0a0a;letter-spacing:0.1em;vertical-align:middle;">BAATON</span>
</td></tr>
<tr><td style="height:1px;background:#e6e5e1;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:20px 24px;">{content_html}</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #f0eeea;background:#fafaf8;border-radius:0 0 10px 10px;font-size:11px;line-height:1.5;color:#9c9b95;font-family:Arial,Helvetica,sans-serif;">
{footer_html}<br>
<a href="{manage_url_esc}" style="color:#9c9b95;">G&#233;rer mes notifications</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"#
    )
}

/// /settings is the valid frontend route; /settings/integrations is not.
fn manage_url(public_url: &str) -> String {
    format!("{}/settings", public_url.trim_end_matches('/'))
}

fn issue_url(public_url: &str, display_id: &str) -> String {
    // Frontend router: /all-issues?issue=DISPLAY_ID (no /issues/:uuid route).
    format!(
        "{}/all-issues?issue={}",
        public_url.trim_end_matches('/'),
        display_id
    )
}

/// Digest email grouping several events on the same issue.
/// Returns `(subject, html)`.
pub fn digest_email_html(
    events: &[crate::pending_notif::DigestEvent],
    display_id: &str,
    title: &str,
    project_name: Option<&str>,
    public_url: &str,
) -> (String, String) {
    let count = events.len();
    let mention_actor = events.iter().find_map(|ev| match ev {
        crate::pending_notif::DigestEvent::Mention { actor, .. } => Some(actor.as_str()),
        _ => None,
    });
    let subject = match mention_actor {
        Some(actor) => format!(
            "[Baaton] {} \u{00b7} {} \u{2014} {} vous a mentionn\u{00e9}",
            project_name.unwrap_or("Baaton"),
            display_id,
            actor,
        ),
        None => format!(
            "[Baaton] {} \u{00b7} {} \u{2014} {} mise{} \u{00e0} jour",
            project_name.unwrap_or("Baaton"),
            he(display_id),
            count,
            if count > 1 { "s" } else { "" },
        ),
    };

    let issue_url = issue_url(public_url, display_id);

    let mut event_blocks = String::new();
    for ev in events {
        let block = match ev {
            crate::pending_notif::DigestEvent::Comment { actor, body, .. } => {
                let excerpt: String = body.chars().take(200).collect();
                format!(
                    r#"<div style="margin:8px 0;background:#f6f5f3;border-radius:6px;padding:10px 12px;font-size:12px;color:#3d3d3a;font-family:Arial,Helvetica,sans-serif;"><span style="font-weight:700;">{}</span> a commenté&nbsp;:<br><span style="margin-top:4px;display:block;color:#5c5c57;">{}</span></div>"#,
                    he(actor),
                    he(&excerpt),
                )
            }
            crate::pending_notif::DigestEvent::Mention { actor, body, .. } => {
                let excerpt: String = body.chars().take(200).collect();
                format!(
                    r#"<div style="margin:8px 0;background:#fdf6e7;border-left:3px solid #f59e0b;border-radius:6px;padding:10px 12px;font-size:12px;color:#3d3d3a;font-family:Arial,Helvetica,sans-serif;"><span style="font-weight:700;">{}</span> vous a mentionné&nbsp;:<br><span style="margin-top:4px;display:block;color:#5c5c57;">{}</span></div>"#,
                    he(actor),
                    he(&excerpt),
                )
            }
            crate::pending_notif::DigestEvent::Transition {
                actor,
                from_status,
                to_status,
                ..
            } => {
                let sc = status_color(&to_status.to_lowercase());
                let from_badge = if from_status.is_empty() {
                    String::new()
                } else {
                    format!("{} &#8594; ", status_badge(&he(from_status), "#9c9b95"))
                };
                let to_badge = status_badge(&he(to_status), sc);
                format!(
                    r#"<div style="margin:8px 0;padding:8px 0;font-size:12px;color:#5c5c57;font-family:Arial,Helvetica,sans-serif;"><span style="font-weight:700;">{}</span> a changé le statut&nbsp;: {}{}</div>"#,
                    he(actor),
                    from_badge,
                    to_badge,
                )
            }
        };
        event_blocks.push_str(&block);
    }

    let display_id_esc = he(display_id);
    let title_esc = he(title);
    let cta = cta_button(&issue_url, "Voir le ticket");
    let label = format!("{} mise{} \u{00e0} jour", count, if count > 1 { "s" } else { "" });
    let badge = status_badge(&label, "#0ea5e9");
    let content = format!(
        r#"{badge}<h2 style="margin:12px 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">{display_id_esc} &middot; {title_esc}</h2>{event_blocks}{cta}"#
    );
    // Rows queued before the recap existed (078) can still carry plain
    // comments and transitions; only a mention may claim to be one.
    let footer = if mention_actor.is_some() {
        format!(
            "Vous recevez ce mail tout de suite parce qu&#39;on vous a mentionn&#233; sur <b>{}</b>. \
             Le reste arrive dans le r&#233;cap de 08:00, 12:00, 16:00 et 20:00 (heure de Paris).",
            he(project_name.unwrap_or("Baaton"))
        )
    } else {
        format!(
            "Mise &#224; jour d&#39;un ticket que vous suivez sur <b>{}</b>.",
            he(project_name.unwrap_or("Baaton"))
        )
    };
    let html = email_layout("#0ea5e9", &content, &footer, public_url);
    (subject, html)
}

/// A rendered email: subject, HTML part and plain-text part.
pub struct Mail {
    pub subject: String,
    pub html: String,
    pub text: String,
}

/// Why a person hears about a project, in the words of the footer.
fn reason_label(reason: &str) -> String {
    match reason.strip_prefix("role:") {
        Some(role) => format!("r\u{00f4}le {role}"),
        None if reason == "participant" => {
            "vos tickets (cr\u{00e9}\u{00e9}s, assign\u{00e9}s ou demand\u{00e9}s)".to_string()
        }
        None => "abonnement au projet".to_string(),
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n > 1 { many } else { one })
}

/// One line of the recap, without the time.
fn recap_line(l: &crate::email_digest::DigestLine) -> String {
    let actor = if l.actor_name.trim().is_empty() {
        "Quelqu'un"
    } else {
        l.actor_name.as_str()
    };
    let to = l.to_status.as_deref().unwrap_or_default();
    match l.kind.as_str() {
        "issue_created" => format!("{actor} a cr\u{00e9}\u{00e9} le ticket"),
        "status_changed" => match l.from_status.as_deref().filter(|f| !f.is_empty()) {
            Some(from) => format!("{actor} : {from} \u{2192} {to}"),
            None => format!("{actor} a cr\u{00e9}\u{00e9} le ticket en {to}"),
        },
        _ => format!(
            "{actor} a comment\u{00e9} : \u{00ab} {} \u{00bb}",
            l.body.as_deref().unwrap_or_default()
        ),
    }
}

/// The recap of one person for one slot (BAA-38).
///
/// Grouped by project, then ticket, in the order things happened; every
/// ticket links to itself. The footer gives, per project, the real reason this
/// person hears about it, then the one-click unsubscribe link of this recap
/// (BAA-40). Every user-supplied string goes through `he` in the HTML part;
/// the plain-text part carries the same words unescaped.
pub fn recap_email(
    lines: &[crate::email_digest::DigestLine],
    slot_at: chrono::DateTime<chrono::Utc>,
    public_url: &str,
    unsubscribe_url: &str,
) -> Mail {
    use chrono_tz::Europe::Paris;
    let slot_local = slot_at.with_timezone(&Paris);
    let when = |t: chrono::DateTime<chrono::Utc>| {
        let local = t.with_timezone(&Paris);
        if local.date_naive() == slot_local.date_naive() {
            local.format("%H:%M").to_string()
        } else {
            local.format("%d/%m %H:%M").to_string()
        }
    };

    // Keyed by project id: two orgs may each have a project with the same name.
    // (name, reasons, [(display_id, title, [lines])])
    type Ticket<'a> = (&'a str, &'a str, Vec<&'a crate::email_digest::DigestLine>);
    let mut ids: Vec<uuid::Uuid> = Vec::new();
    let mut projects: Vec<(&str, Vec<String>, Vec<Ticket>)> = Vec::new();
    for l in lines {
        let idx = match ids.iter().position(|id| *id == l.project_id) {
            Some(i) => i,
            None => {
                ids.push(l.project_id);
                projects.push((l.project_name.as_str(), Vec::new(), Vec::new()));
                projects.len() - 1
            }
        };
        let (_, reasons, tickets) = &mut projects[idx];
        let reason = reason_label(&l.reason);
        if !reasons.contains(&reason) {
            reasons.push(reason);
        }
        match tickets
            .iter_mut()
            .find(|(id, _, _)| *id == l.issue_display_id)
        {
            Some((_, _, ls)) => ls.push(l),
            None => tickets.push((l.issue_display_id.as_str(), l.issue_title.as_str(), vec![l])),
        }
    }

    // A ticket created straight into a status the person follows would read
    // "created" twice: the initial-status line says it better.
    for (_, _, tickets) in projects.iter_mut() {
        for (_, _, ls) in tickets.iter_mut() {
            let initial = ls.iter().any(|l| {
                l.kind == "status_changed"
                    && l.from_status.as_deref().unwrap_or_default().is_empty()
            });
            if initial {
                ls.retain(|l| l.kind != "issue_created");
            }
        }
    }

    let updates: usize = projects
        .iter()
        .flat_map(|(_, _, t)| t.iter())
        .map(|(_, _, ls)| ls.len())
        .sum();
    let ticket_count: usize = projects.iter().map(|(_, _, t)| t.len()).sum();
    let summary = format!(
        "{} sur {}",
        plural(updates, "mise \u{00e0} jour", "mises \u{00e0} jour"),
        plural(ticket_count, "ticket", "tickets")
    );
    let slot_label = slot_local.format("%H:%M").to_string();
    let subject = format!("[Baaton] R\u{00e9}cap de {slot_label} \u{00b7} {summary}");

    let mut html = format!(
        r#"<h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">R&#233;cap de {}</h2><p style="margin:0 0 16px;font-size:13px;color:#5c5c57;font-family:Arial,Helvetica,sans-serif;">{}</p>"#,
        he(&slot_label),
        he(&summary)
    );
    let mut text = format!("R\u{00e9}cap Baaton de {slot_label} \u{2014} {summary}\n");

    for (project, _, tickets) in &projects {
        html.push_str(&format!(
            r#"<p style="margin:20px 0 6px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9c9b95;font-family:Arial,Helvetica,sans-serif;">{}</p>"#,
            he(project)
        ));
        text.push_str(&format!("\n== {project} ==\n"));
        for (display_id, title, ls) in tickets {
            let url = issue_url(public_url, display_id);
            html.push_str(&format!(
                r#"<div style="margin:0 0 10px;padding:10px 12px;background:#f6f5f3;border-radius:6px;font-family:Arial,Helvetica,sans-serif;"><a href="{}" style="font-size:13px;font-weight:700;color:#0a0a0a;text-decoration:none;">{} &middot; {}</a>"#,
                he(&url),
                he(display_id),
                he(title)
            ));
            text.push_str(&format!("\n{display_id} \u{00b7} {title}\n{url}\n"));
            for l in ls {
                let at = when(l.occurred_at);
                let line = recap_line(l);
                html.push_str(&format!(
                    r#"<div style="margin-top:6px;font-size:12px;color:#3d3d3a;"><span style="color:#9c9b95;font-family:'JetBrains Mono',monospace;">{}</span>&nbsp;&nbsp;{}</div>"#,
                    he(&at),
                    he(&line)
                ));
                text.push_str(&format!("  {at}  {line}\n"));
            }
            html.push_str("</div>");
        }
    }

    let reasons: Vec<String> = projects
        .iter()
        .map(|(project, reasons, _)| format!("{project} : {}", reasons.join(", ")))
        .collect();
    let schedule = "Un r\u{00e9}cap part \u{00e0} 08:00, 12:00, 16:00 et 20:00 (heure de Paris), seulement s'il y a du nouveau. Vos propres actions n'y figurent pas.";
    let footer = format!(
        r#"Pourquoi ce mail : {}.<br>{}<br><a href="{}" style="color:#9c9b95;">Se d&#233;sabonner du r&#233;cap</a>"#,
        reasons
            .iter()
            .map(|r| he(r))
            .collect::<Vec<_>>()
            .join(" &middot; "),
        he(schedule),
        he(unsubscribe_url)
    );
    text.push_str(&format!(
        "\nPourquoi ce mail :\n{}\n\n{schedule}\nSe d\u{00e9}sabonner du r\u{00e9}cap : {unsubscribe_url}\nG\u{00e9}rer mes notifications : {}\n",
        reasons
            .iter()
            .map(|r| format!("- {r}"))
            .collect::<Vec<_>>()
            .join("\n"),
        manage_url(public_url)
    ));

    Mail {
        subject,
        html: email_layout("#f59e0b", &html, &footer, public_url),
        text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn he_escapes_all_dangerous_chars() {
        assert_eq!(he("<b>a</b>"), "&lt;b&gt;a&lt;/b&gt;");
        assert_eq!(he("a & b"), "a &amp; b");
        assert_eq!(he("\"quoted\""), "&quot;quoted&quot;");
        assert_eq!(he("it's"), "it&#x27;s");
    }

    /// A mention body is user text: it must not run in the reader's client.
    #[test]
    fn mention_email_escapes_the_comment() {
        let events = vec![crate::pending_notif::DigestEvent::Mention {
            actor: "<b>Eve</b>".into(),
            body: "<img src=x onerror=alert(1)>".into(),
            at: chrono::Utc::now(),
        }];
        let (_, html) = digest_email_html(
            &events,
            "BAA-1",
            "<script>x</script>",
            Some("P"),
            "https://app.baaton.dev",
        );
        assert!(
            !html.contains("<img src=x") && !html.contains("<script>") && !html.contains("<b>Eve")
        );
    }
}
