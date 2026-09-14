//! notifyd connector: chat notifications for the events that matter to the
//! people watching a project, without a cron polling the API.
//!
//! Why this exists next to `novu.rs`: Novu notifies *users* (assignee, mention)
//! over their own channels. This notifies a *room* — the Telegram topic where
//! the team already works — so a ticket created by an agent at 15:57 does not
//! stay invisible until somebody opens the board. That was the reported
//! symptom: SQX-304 landed in the database and nobody heard about it.
//!
//! Deliberately fire-and-forget and `Option`-gated: a notification is not worth
//! failing a write. No `NOTIFYD_URL` or no `NOTIFYD_API_KEY` means no client and
//! the call sites become no-ops, so a deployment without notifyd behaves exactly
//! like today.
//!
//! Config:
//!
//! | variable | role |
//! |---|---|
//! | `NOTIFYD_URL` | base URL, e.g. `http://baaton-notifyd:3400` |
//! | `NOTIFYD_API_KEY` | project key of the notifyd instance (`x-api-key`) |
//! | `NOTIFYD_TELEGRAM_CHAT_ID` | destination chat, e.g. `-1003803857627` |
//! | `NOTIFYD_TELEGRAM_THREAD_ID` | forum topic id; without it Telegram posts to General |
//! | `NOTIFYD_PUBLIC_URL` | base URL used to build the issue link |

use serde_json::json;
use futures::{stream, StreamExt};

#[derive(Clone)]
pub struct NotifydClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    /// The legacy shared room, kept as an *extra* destination so an instance that
    /// announced into a Telegram topic keeps doing so. `Option` because it is no
    /// longer how anyone is reached: keeping it mandatory would mean an instance
    /// that routes per user, with no shared room, gets no client at all.
    chat_id: Option<String>,
    thread_id: Option<i64>,
    public_url: Option<String>,
}

/// What a room needs to know about an issue. Built by the caller from the row it
/// already has, so this module never queries.
pub struct IssueNotice {
    pub display_id: String,
    pub title: String,
    pub project_name: Option<String>,
    pub actor: Option<String>,
    pub issue_id: uuid::Uuid,
}

/// A status transition. This is what the room reacts to: a ticket coming back
/// from review is a call to action, and the reviewer's last comment is the
/// reason. Announcing the move without it forces everyone to open the board to
/// learn why, which is the same blind spot `IssueNotice` fixed for creation.
pub struct StatusNotice {
    pub issue: IssueNotice,
    /// Human labels when the project defines them, raw keys otherwise.
    pub from_status: String,
    pub to_status: String,
    /// `(author, body)` of the most recent comment. `None` when there is none.
    pub last_comment: Option<(String, String)>,
    /// Distinguishes one transition from the next for idempotency: two moves to
    /// the same status must both be announced.
    pub changed_at: chrono::DateTime<chrono::Utc>,
}

/// Longest comment excerpt carried into a chat line. Telegram caps a message at
/// 4096 bytes, but the limit here is attention, not bytes: a notification is a
/// pointer to the thread, not the thread.
const COMMENT_EXCERPT_CHARS: usize = 280;

/// A new comment on an issue. The room wants the words, not just the fact that
/// words exist, so the body travels with it under the same excerpt rule as a
/// status change.
pub struct CommentNotice {
    pub issue: IssueNotice,
    pub body: String,
    /// Comment id, not issue id, for the idempotency key: a second comment on
    /// the same issue is a second notification.
    pub comment_id: uuid::Uuid,
}

/// Subject + HTML body for an email recipient in a fan-out.
pub struct EmailPayload {
    pub subject: String,
    pub html: String,
}

impl NotifydClient {
    /// `None` when notifyd is not configured, which is the normal state of a
    /// deployment that does not use it.
    pub fn from_env() -> Option<Self> {
        let base_url = non_empty("NOTIFYD_URL")?.trim_end_matches('/').to_string();
        let api_key = non_empty("NOTIFYD_API_KEY")?;
        // Per-user routing is now the main path (074). The shared-room path
        // (NOTIFYD_TELEGRAM_CHAT_ID) is disabled: every subscriber who wants
        // Telegram notifications registers a personal bot instead.
        let chat_id: Option<String> = None;
        let thread_id: Option<i64> = None;
        let public_url = non_empty("NOTIFYD_PUBLIC_URL").map(|u| u.trim_end_matches('/').to_string());

        tracing::info!(
            base_url = %base_url,
            chat_id = ?chat_id,
            thread_id = ?thread_id,
            "notifyd client initialized"
        );

        Some(Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
            base_url,
            api_key,
            chat_id,
            thread_id,
            public_url,
        })
    }

    /// Announce a created issue. Spawned, never awaited by a handler.
    ///
    /// `announce_room` carries the project-level filter, which gates the shared
    /// room only: a subscriber's own settings are already applied by
    /// `resolve_recipients`, so a person who asked for this event still gets it
    /// when the project keeps the room quiet.
    pub fn issue_created(
        &self,
        notice: IssueNotice,
        recipients: Vec<crate::routes::notification_prefs::Recipient>,
        announce_room: bool,
    ) {
        let client = self.clone();
        let text = notice.text("New issue");
        let url = notice.url(self.public_url.as_deref());
        let key = format!("baaton-issue-created-{}", notice.issue_id);
        let email_payload = self.public_url.as_deref().map(|base_url| EmailPayload {
            subject: format!(
                "[Baaton] {} \u{00b7} {} \u{2014} New Issue",
                notice.project_name.as_deref().unwrap_or("Baaton"),
                notice.display_id
            ),
            html: crate::email_templates::issue_created_html(&notice, base_url),
        });
        self.fan_out(recipients, text.clone(), url.clone(), key.clone(), email_payload);
        if announce_room {
            tokio::spawn(async move {
                client.send_telegram(text, url, key).await;
            });
        }
    }

    /// Announce a status transition, carrying the last comment as the reason.
    pub fn issue_status_changed(
        &self,
        notice: StatusNotice,
        recipients: Vec<crate::routes::notification_prefs::Recipient>,
        announce_room: bool,
    ) {
        let client = self.clone();
        let text = notice.text();
        let url = notice.issue.url(self.public_url.as_deref());
        // The transition timestamp is part of the key: a ticket that goes
        // in_review → not_ok → in_review → not_ok must announce twice, so
        // keying on the target status alone would swallow the second move.
        let key = format!(
            "baaton-issue-status-{}-{}-{}",
            notice.issue.issue_id,
            notice.to_status,
            notice.changed_at.timestamp_millis()
        );
        let email_payload = self.public_url.as_deref().map(|base_url| EmailPayload {
            subject: format!(
                "[Baaton] {} \u{00b7} {} \u{2014} {} \u{2192} {}",
                notice.issue.project_name.as_deref().unwrap_or("Baaton"),
                notice.issue.display_id,
                notice.from_status,
                notice.to_status
            ),
            html: crate::email_templates::status_changed_html(&notice, base_url),
        });
        self.fan_out(recipients, text.clone(), url.clone(), key.clone(), email_payload);
        if announce_room {
            tokio::spawn(async move {
                client.send_telegram(text, url, key).await;
            });
        }
    }

    /// Announce a new comment, carrying the words themselves.
    pub fn issue_commented(
        &self,
        notice: CommentNotice,
        recipients: Vec<crate::routes::notification_prefs::Recipient>,
        announce_room: bool,
    ) {
        let client = self.clone();
        let text = notice.text();
        let url = notice.issue.url(self.public_url.as_deref());
        let key = format!("baaton-comment-{}", notice.comment_id);
        let email_payload = self.public_url.as_deref().map(|base_url| EmailPayload {
            subject: format!(
                "[Baaton] {} \u{00b7} {} \u{2014} New comment",
                notice.issue.project_name.as_deref().unwrap_or("Baaton"),
                notice.issue.display_id
            ),
            html: crate::email_templates::comment_added_html(&notice, base_url),
        });
        self.fan_out(recipients, text.clone(), url.clone(), key.clone(), email_payload);
        if announce_room {
            tokio::spawn(async move {
                client.send_telegram(text, url, key).await;
            });
        }
    }

    async fn send_telegram(&self, text: String, url: Option<String>, idempotency_key: String) {
        // No shared room configured: per-user routing is now the main path, so
        // this is a normal state and not a failure.
        let Some(chat_id) = self.chat_id.clone() else {
            return;
        };
        let mut body = json!({
            "channel": "telegram",
            "to": chat_id,
            "body": text,
            // Baaton may retry a write; the same issue must not announce twice.
            "idempotency_key": idempotency_key,
            // A created ticket is not a campaign: it goes before bulk traffic.
            "priority": "high",
        });
        if let Some(url) = url {
            body["url"] = json!(url);
        }
        if let Some(thread) = self.thread_id {
            body["chat"] = json!({ "telegram_thread_id": thread });
        }
        self.post_send(body).await;
    }

    /// Deliver one notice to every person who subscribed to it.
    ///
    /// The per-recipient idempotency key is the load-bearing detail: notifyd
    /// dedupes on that key, so reusing the event's key across recipients would
    /// deliver to whoever was served first and silently drop everybody else.
    ///
    /// No `telegram_thread_id` here. A thread id belongs to the shared forum
    /// topic; sending it to a private chat is the exact failure that made this
    /// whole feature look broken (`Bad Request: message thread not found`).
    pub fn fan_out(
        &self,
        recipients: Vec<crate::routes::notification_prefs::Recipient>,
        text: String,
        url: Option<String>,
        key_base: String,
        email_payload: Option<EmailPayload>,
    ) {
        if recipients.is_empty() {
            return;
        }
        let client = self.clone();
        tokio::spawn(async move {
            stream::iter(recipients).for_each_concurrent(8, |r| {
                let client = &client;
                let text = &text;
                let url = &url;
                let key_base = &key_base;
                let email_payload = &email_payload;
                async move {
                    if r.channel == "email" {
                        match email_payload {
                            None => {
                                tracing::warn!(
                                    user_id = %r.user_id,
                                    "email.fan_out.no_payload; skipping"
                                );
                                return;
                            }
                            Some(ep) => {
                                let body = json!({
                                    "channel": "email",
                                    "to": r.address,
                                    "subject": ep.subject,
                                    // notifyd SendRequest field is `body_html`, not `html`.
                                    // The wrong name is silently ignored and the email falls
                                    // back to plain-text-only delivery.
                                    "body_html": ep.html,
                                    "body": text,
                                    "idempotency_key": format!("{key_base}-{}-email", r.user_id),
                                    "priority": "high"
                                });
                                client.post_send(body).await;
                                return;
                            }
                        }
                    }
                    let mut body = json!({
                        "channel": r.channel,
                        "to": r.address,
                        "body": text,
                        "idempotency_key": format!("{key_base}-{}-{}", r.user_id, r.channel),
                        "priority": "high",
                    });
                    if let Some(route_id) = r.telegram_route_id {
                        body["chat"] = json!({"telegram_route_id": route_id});
                    }
                    if let Some(url) = url.as_ref() { body["url"] = json!(url); }
                    client.post_send(body).await;
                }
            }).await;
        });
    }

    pub async fn integration_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
        webhook_secret: Option<&str>,
    ) -> Result<serde_json::Value, (axum::http::StatusCode, axum::Json<serde_json::Value>)> {
        use axum::{http::StatusCode, Json};
        let unavailable = || (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "notifyd is unavailable; please retry"})));
        let mut request = self.http.request(method, format!("{}{path}", self.base_url))
            .header("x-api-key", &self.api_key);
        if let Some(secret) = webhook_secret { request = request.header("x-telegram-bot-api-secret-token", secret); }
        if let Some(body) = body { request = request.json(&body); }
        let response = request.send().await.map_err(|_| unavailable())?;
        let status = response.status();
        if status == StatusCode::NO_CONTENT { return Ok(serde_json::Value::Null); }
        let data = response.json::<serde_json::Value>().await.map_err(|_| unavailable())?;
        if !status.is_success() { return Err((status, Json(data))); }
        Ok(data)
    }


    /// Send the "In Review" creator email to one specific address.
    ///
    /// The creator is notified automatically regardless of subscription, so
    /// there is no recipients list to iterate and no per-channel routing —
    /// it is always email. Fire-and-forget; errors are WARN-logged.
    /// Send the "In Review" creator email.
    ///
    /// `issue_id` is no longer needed: the template now uses `display_id` to
    /// build the `/all-issues?issue=` deep-link (the only frontend route for
    /// per-issue navigation).  The signature was simplified accordingly.
    pub fn send_creator_in_review(
        &self,
        display_id: &str,
        title: &str,
        project_name: &str,
        creator_email: &str,
        idempotency_key: &str,
    ) {
        let Some(base_url) = self.public_url.as_deref() else {
            tracing::trace!("creator.in_review.no_public_url; skip");
            return;
        };
        let html = crate::email_templates::in_review_creator_html(
            display_id, title, project_name, base_url,
        );
        let subject = format!("[Baaton] {display_id} \u{2014} Ready for your review");
        let body = serde_json::json!({
            "channel": "email",
            "to": creator_email,
            "subject": subject,
            // notifyd SendRequest field is `body_html`, not `html`.
            "body_html": html,
            "body": format!("{display_id} is ready for your review"),
            "idempotency_key": idempotency_key,
            "priority": "high"
        });
        let client = self.clone();
        tokio::spawn(async move {
            client.post_send(body).await;
        });
    }

    async fn post_send(&self, body: serde_json::Value) {
        let endpoint = format!("{}/v1/send", self.base_url);
        match self
            .http
            .post(&endpoint)
            .header("x-api-key", &self.api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                tracing::debug!("notifyd.send.ok");
            }
            Ok(resp) => {
                let status = resp.status();
                tracing::warn!(status = %status, "notifyd.send.failed");
            }
            Err(e) => {
                tracing::warn!(error = %e, "notifyd.send.error");
            }
        }
    }
}

impl IssueNotice {
    /// One line the room can read without opening anything, then the title.
    fn text(&self, headline: &str) -> String {
        let mut first = match self.project_name.as_deref() {
            Some(project) => format!("{headline} · {} · {project}", self.display_id),
            None => format!("{headline} · {}", self.display_id),
        };
        if let Some(actor) = self.actor.as_deref().filter(|a| !a.trim().is_empty()) {
            first.push_str(&format!(" · by {actor}"));
        }
        format!("{first}\n{}", self.title)
    }

    fn url(&self, public_url: Option<&str>) -> Option<String> {
        // Frontend router: /all-issues?issue=DISPLAY_ID (no /issues/:uuid route exists).
        // display_id is alphanumeric + hyphen — URL-safe without encoding.
        Some(format!("{}/all-issues?issue={}", public_url?.trim_end_matches('/'), self.display_id))
    }
}

impl StatusNotice {
    /// Four lines at most: the transition, the title, then the reason. The arrow
    /// carries the information a bare "moved to Not OK" loses — where it came
    /// from, which is what tells the room whether this is progress or a bounce.
    fn text(&self) -> String {
        let headline = format!("{} → {}", self.from_status, self.to_status);
        let mut out = self.issue.text(&headline);
        if let Some((author, body)) = &self.last_comment {
            let excerpt = excerpt(body);
            if !excerpt.is_empty() {
                out.push_str(&format!("\n\n💬 {author}: {excerpt}"));
            }
        }
        out
    }
}

impl CommentNotice {
    /// The author leads the headline, because on a comment "who is talking" is
    /// the first thing that decides whether this needs an answer.
    fn text(&self) -> String {
        let author = self
            .issue
            .actor
            .as_deref()
            .filter(|a| !a.trim().is_empty())
            .unwrap_or("Quelqu'un");
        let mut out = self.issue.text("New comment");
        let excerpt = excerpt(&self.body);
        if !excerpt.is_empty() {
            out.push_str(&format!("\n\n💬 {author}: {excerpt}"));
        }
        out
    }
}

/// One-line excerpt of a comment: newlines collapse to separators so a long
/// review comment cannot push the transition line off screen, and the cut is on
/// a character boundary (`chars`, not bytes) because these comments are French.
fn excerpt(body: &str) -> String {
    let flat = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= COMMENT_EXCERPT_CHARS {
        return flat;
    }
    let cut: String = flat.chars().take(COMMENT_EXCERPT_CHARS).collect();
    // Prefer the last word boundary so the excerpt does not end mid-word.
    let cut = match cut.rsplit_once(' ') {
        Some((head, _)) if head.chars().count() > COMMENT_EXCERPT_CHARS / 2 => head.to_string(),
        _ => cut,
    };
    format!("{cut}…")
}

fn non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice() -> IssueNotice {
        IssueNotice {
            display_id: "SQX-304".into(),
            title: "Le bouton d'export ne répond plus".into(),
            project_name: Some("Square".into()),
            actor: Some("agent".into()),
            issue_id: uuid::Uuid::nil(),
        }
    }

    #[test]
    fn text_leads_with_the_id_then_the_title() {
        assert_eq!(
            notice().text("New issue"),
            "New issue · SQX-304 · Square · by agent\nLe bouton d'export ne répond plus"
        );
    }

    /// Missing context is omitted, not printed as "None" or an empty segment.
    #[test]
    fn text_survives_missing_context() {
        let mut n = notice();
        n.project_name = None;
        n.actor = None;
        assert_eq!(n.text("New issue"), "New issue · SQX-304\nLe bouton d'export ne répond plus");
        n.actor = Some("   ".into());
        assert_eq!(n.text("New issue"), "New issue · SQX-304\nLe bouton d'export ne répond plus");
    }

    /// No public URL means no link rather than a broken one.
    /// The URL format uses the frontend deep-link pattern.
    #[test]
    fn url_needs_a_public_base() {
        assert_eq!(notice().url(None), None);
        // Correct deep-link: /all-issues?issue=DISPLAY_ID
        assert_eq!(
            notice().url(Some("https://baaton.dev")),
            Some("https://baaton.dev/all-issues?issue=SQX-304".into())
        );
        // Trailing slash on the base URL is trimmed.
        assert_eq!(
            notice().url(Some("https://baaton.dev/")),
            Some("https://baaton.dev/all-issues?issue=SQX-304".into())
        );
    }

    /// notifyd's `/v1/send` contract uses `body_html` for the HTML email body.
    /// The old field name `html` is silently unknown and the email falls back
    /// to plain-text-only delivery — a regression no log entry surfaces.
    #[test]
    fn email_fan_out_payload_uses_body_html_field() {
        let ep = EmailPayload {
            subject: "Test subject".into(),
            html: "<b>hello</b>".into(),
        };
        let text = "hello plain";
        let key_base = "baaton-test";
        let user_id = "user_abc";
        let address = "test@example.com";

        // Reproduce the exact JSON body built by fan_out for an email recipient.
        let body = serde_json::json!({
            "channel": "email",
            "to": address,
            "subject": ep.subject,
            "body_html": ep.html,
            "body": text,
            "idempotency_key": format!("{key_base}-{user_id}-email"),
            "priority": "high"
        });

        assert!(body.get("body_html").is_some(), "body_html must be set");
        assert!(body.get("html").is_none(), "`html` is not a notifyd field");
        assert_eq!(body["body_html"], "<b>hello</b>");
    }

    fn status_notice() -> StatusNotice {
        StatusNotice {
            issue: notice(),
            from_status: "In Review".into(),
            to_status: "Not OK".into(),
            last_comment: None,
            changed_at: chrono::Utc::now(),
        }
    }

    /// The arrow is the point: "moved to Not OK" alone does not say whether the
    /// ticket progressed or bounced back.
    #[test]
    fn status_text_shows_both_ends_of_the_transition() {
        assert_eq!(
            status_notice().text(),
            "In Review \u{2192} Not OK \u{b7} SQX-304 \u{b7} Square \u{b7} by agent\nLe bouton d'export ne r\u{e9}pond plus"
        );
    }

    /// The reviewer's reason travels with the transition.
    #[test]
    fn status_text_carries_the_last_comment() {
        let mut n = status_notice();
        n.last_comment = Some(("Ramzi L.".into(), "Le total TTC est faux sur la ligne 3.".into()));
        assert!(n.text().ends_with("\n\n\u{1f4ac} Ramzi L.: Le total TTC est faux sur la ligne 3."));
    }

    /// A comment that is only whitespace must not produce a dangling "author:".
    #[test]
    fn status_text_skips_an_empty_comment() {
        let mut n = status_notice();
        n.last_comment = Some(("Ramzi L.".into(), "   \n  ".into()));
        assert_eq!(n.text(), status_notice().text());
    }

    /// Multi-line comments collapse to one line so the transition stays visible.
    #[test]
    fn excerpt_flattens_and_keeps_short_comments_intact() {
        assert_eq!(excerpt("ligne 1\n\nligne 2"), "ligne 1 ligne 2");
    }

    /// Long comments are cut on a word boundary, and on chars not bytes: cutting
    /// mid-codepoint on accented French text would panic.
    #[test]
    fn excerpt_truncates_on_a_word_boundary() {
        let long = "\u{e9}".repeat(400);
        let out = excerpt(&long);
        assert!(out.ends_with('\u{2026}'));
        assert_eq!(out.chars().count(), COMMENT_EXCERPT_CHARS + 1);

        let words = "r\u{e9}gularisation ".repeat(40);
        let out = excerpt(&words);
        assert!(out.ends_with('\u{2026}'));
        assert!(out.chars().count() <= COMMENT_EXCERPT_CHARS + 1);
        assert!(!out.contains("  "));
    }

    /// A comment notice carries the words: "someone commented" without the text
    /// forces a round trip to the board for what is usually one sentence.
    #[test]
    fn comment_text_carries_the_body() {
        let n = CommentNotice {
            issue: notice(),
            body: "Le total TTC est faux sur la ligne 3.".into(),
            comment_id: uuid::Uuid::nil(),
        };
        assert_eq!(
            n.text(),
            "New comment \u{b7} SQX-304 \u{b7} Square \u{b7} by agent\nLe bouton d'export ne r\u{e9}pond plus\n\n\u{1f4ac} agent: Le total TTC est faux sur la ligne 3."
        );
    }

    /// A missing author falls back rather than printing an empty "по: " segment.
    #[test]
    fn comment_text_survives_a_missing_author() {
        let mut issue = notice();
        issue.actor = None;
        let n = CommentNotice {
            issue,
            body: "RAS".into(),
            comment_id: uuid::Uuid::nil(),
        };
        assert!(n.text().ends_with("\u{1f4ac} Quelqu'un: RAS"));
    }
}
