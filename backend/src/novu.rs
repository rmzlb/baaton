use lazy_static::lazy_static;
use regex::Regex;
use serde_json::json;

lazy_static! {
    static ref MENTION_RE: Regex = Regex::new(r"@(user_[a-zA-Z0-9]+)").unwrap();
}

#[derive(Clone)]
pub struct NovuClient {
    http: reqwest::Client,
    api_url: String,
    secret_key: String,
}

/// Subscriber info for trigger_many
pub struct Subscriber {
    pub id: String,
    pub email: Option<String>,
    pub name: Option<String>,
}

impl NovuClient {
    /// Returns None if NOVU_SECRET_KEY is not set (graceful degradation).
    pub fn from_env() -> Option<Self> {
        let secret_key = std::env::var("NOVU_SECRET_KEY").ok()?;
        let api_url = std::env::var("NOVU_API_URL")
            .unwrap_or_else(|_| "https://novu-api.ctrlnz.com".to_string());

        tracing::info!("Novu client initialized (api: {})", api_url);

        Some(Self {
            http: reqwest::Client::new(),
            api_url,
            secret_key,
        })
    }

    /// Fire a single notification trigger.
    pub async fn trigger(
        &self,
        workflow_id: &str,
        subscriber_id: &str,
        email: Option<&str>,
        name: Option<&str>,
        payload: serde_json::Value,
    ) {
        let mut subscriber = json!({ "subscriberId": subscriber_id });
        if let Some(e) = email {
            subscriber["email"] = json!(e);
        }
        if let Some(n) = name {
            subscriber["firstName"] = json!(n);
        }

        let body = json!({
            "name": workflow_id,
            "to": subscriber,
            "payload": payload,
        });

        let url = format!("{}/v1/events/trigger", self.api_url);
        match self
            .http
            .post(&url)
            .header("Authorization", format!("ApiKey {}", self.secret_key))
            .json(&body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                tracing::debug!(
                    workflow = workflow_id,
                    subscriber = subscriber_id,
                    "novu.trigger.ok"
                );
            }
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                tracing::warn!(
                    workflow = workflow_id,
                    subscriber = subscriber_id,
                    status = %status,
                    body = %text,
                    "novu.trigger.failed"
                );
            }
            Err(e) => {
                tracing::warn!(
                    workflow = workflow_id,
                    subscriber = subscriber_id,
                    error = %e,
                    "novu.trigger.error"
                );
            }
        }
    }

    /// Trigger a workflow for multiple subscribers concurrently (fire-and-forget each).
    pub fn trigger_many(
        &self,
        workflow_id: &str,
        subscribers: Vec<Subscriber>,
        payload: serde_json::Value,
    ) {
        for sub in subscribers {
            let client = self.clone();
            let wf = workflow_id.to_string();
            let p = payload.clone();
            tokio::spawn(async move {
                client
                    .trigger(&wf, &sub.id, sub.email.as_deref(), sub.name.as_deref(), p)
                    .await;
            });
        }
    }
}

/// Extract `@user_xxx` mentions from text.
pub fn parse_mentions(text: &str) -> Vec<String> {
    MENTION_RE
        .captures_iter(text)
        .map(|c| c[1].to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mentions() {
        let text = "Hey @user_abc123 and @user_XYZ789, check this out!";
        let mentions = parse_mentions(text);
        assert_eq!(mentions, vec!["user_abc123", "user_XYZ789"]);
    }

    #[test]
    fn test_parse_mentions_empty() {
        assert!(parse_mentions("no mentions here").is_empty());
    }

    #[test]
    fn test_parse_mentions_duplicate() {
        let text = "@user_abc @user_abc";
        let mentions = parse_mentions(text);
        assert_eq!(mentions.len(), 2); // returns all occurrences
    }
}
