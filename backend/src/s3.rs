//! S3 client + helpers for the uploads bucket.
//!
//! The bucket is private. Public read happens through presigned URLs that the
//! backend mints on demand (see `presign_get`). Inline images persisted in
//! markdown are stored as `s3://baaton-uploads/<key>` and rewritten to
//! presigned HTTPS URLs by the response serializer.
//!
//! Auth chain:
//!   1. Env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) — useful in dev.
//!   2. EC2 instance role via IMDSv2 — what we use in prod (Dokploy on belotte-arm).
//! The default `aws-config::load_defaults` walks the chain in this order.

use aws_sdk_s3::{
    presigning::PresigningConfig,
    primitives::ByteStream,
    Client,
};
use std::{sync::Arc, time::Duration};

/// Shared S3 state attached to every request via `axum::Extension`.
#[derive(Clone)]
pub struct S3State {
    pub client: Client,
    pub uploads_bucket: String,
    /// Default presigned URL TTL (seconds). 7 days is the SigV4 max.
    pub presign_ttl_secs: u64,
}

/// Default presign TTL (7 days = SigV4 max). Override via `S3_PRESIGN_TTL_SECS`.
const DEFAULT_PRESIGN_TTL: u64 = 7 * 24 * 3600;

/// Marker prefix for keys stored in markdown / DB.
pub const S3_URL_SCHEME: &str = "s3://";

impl S3State {
    /// Initialize from env. Returns `None` if `S3_UPLOADS_BUCKET` is not set
    /// (the backend then refuses uploads with 503).
    pub async fn from_env() -> Option<Arc<Self>> {
        let bucket = std::env::var("S3_UPLOADS_BUCKET").ok()?;

        let region = std::env::var("AWS_REGION")
            .or_else(|_| std::env::var("AWS_DEFAULT_REGION"))
            .unwrap_or_else(|_| "eu-west-3".to_string());

        let presign_ttl_secs = std::env::var("S3_PRESIGN_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_PRESIGN_TTL);

        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new(region))
            .load()
            .await;

        let client = Client::new(&config);

        tracing::info!(
            bucket = %bucket,
            ttl_secs = presign_ttl_secs,
            "S3 client initialized"
        );

        Some(Arc::new(Self {
            client,
            uploads_bucket: bucket,
            presign_ttl_secs,
        }))
    }

    /// Upload bytes to the uploads bucket.
    pub async fn put_object(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
    ) -> anyhow::Result<()> {
        self.client
            .put_object()
            .bucket(&self.uploads_bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(bytes))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("S3 PutObject failed: {}", e))?;
        Ok(())
    }

    /// Mint a short-lived presigned HTTPS URL for a GET on `key`.
    pub async fn presign_get(&self, key: &str) -> anyhow::Result<String> {
        let presigning = PresigningConfig::expires_in(Duration::from_secs(self.presign_ttl_secs))?;
        let req = self
            .client
            .get_object()
            .bucket(&self.uploads_bucket)
            .key(key)
            .presigned(presigning)
            .await
            .map_err(|e| anyhow::anyhow!("S3 presign failed: {}", e))?;
        Ok(req.uri().to_string())
    }
}

/// Build an S3 marker URL from a raw key (e.g. `org-1/uuid.webp`).
pub fn build_marker(key: &str) -> String {
    format!("{}baaton-uploads/{}", S3_URL_SCHEME, key)
}

/// Inverse of `rewrite_markdown`: replace presigned `https://baaton-uploads.s3.<region>.amazonaws.com/<key>?...`
/// URLs back to stable `s3://baaton-uploads/<key>` markers, so we never persist
/// short-lived URLs in the database.
///
/// Called on the WRITE path (create/update issue/comment) before storing the markdown.
pub fn collapse_to_markers(markdown: &str) -> String {
    use regex::Regex;
    static PRESIGNED_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = PRESIGNED_RE.get_or_init(|| {
        // Matches https URLs targeting the baaton-uploads bucket on any region/path style:
        //   https://baaton-uploads.s3.<region>.amazonaws.com/<key>?<query>
        //   https://baaton-uploads.s3.amazonaws.com/<key>?<query>
        //   https://s3.<region>.amazonaws.com/baaton-uploads/<key>?<query>
        Regex::new(
            r#"https://(?:baaton-uploads\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com/|s3(?:\.[a-z0-9-]+)?\.amazonaws\.com/baaton-uploads/)([A-Za-z0-9_\-/\.]+)(?:\?[^\s)\]"'<>]*)?"#
        ).expect("regex")
    });
    re.replace_all(markdown, "s3://baaton-uploads/$1").into_owned()
}

/// Inverse rewrite for an optional field (write path).
#[allow(dead_code)]
pub fn collapse_opt(field: &mut Option<String>) {
    if let Some(text) = field {
        if text.contains("baaton-uploads") {
            *text = collapse_to_markers(text);
        }
    }
}

/// Inverse rewrite for a required field (write path).
#[allow(dead_code)]
pub fn collapse_str(field: &mut String) {
    if field.contains("baaton-uploads") {
        *field = collapse_to_markers(field);
    }
}

/// Recursively collapse presigned `https://...baaton-uploads...` URLs back to
/// stable `s3://baaton-uploads/<key>` markers inside an arbitrary JSON value.
///
/// WRITE-path counterpart of [`rewrite_json_value`], and the reason inline
/// `issue.attachments` used to rot: `GET /issues/{id}` hands the client
/// presigned URLs, the client echoes the whole array back on the next mutation,
/// and without this call the short-lived URL is persisted and 403s once the
/// SigV4 window closes. Per AWS guidance we only ever store the object key.
///
/// Returns the number of URLs collapsed so callers can log it.
pub fn collapse_json_value(value: &mut serde_json::Value) -> usize {
    let mut collapsed = 0usize;
    collapse_json_inner(value, &mut collapsed);
    collapsed
}

fn collapse_json_inner(value: &mut serde_json::Value, collapsed: &mut usize) {
    match value {
        serde_json::Value::String(s) => {
            if s.contains("baaton-uploads") {
                let next = collapse_to_markers(s);
                if next != *s {
                    *collapsed += 1;
                    *s = next;
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                collapse_json_inner(v, collapsed);
            }
        }
        serde_json::Value::Object(map) => {
            for (_k, v) in map.iter_mut() {
                collapse_json_inner(v, collapsed);
            }
        }
        _ => {}
    }
}

/// Rewrite all `s3://baaton-uploads/<key>` occurrences in `markdown` to
/// presigned HTTPS URLs. Non-S3 URLs are left untouched.
///
/// Best-effort: if presigning fails for a specific key, we leave the marker
/// in place rather than failing the whole response.
pub async fn rewrite_markdown(markdown: &str, s3: &S3State) -> String {
    // Fast path: no marker, no work.
    if !markdown.contains(S3_URL_SCHEME) {
        return markdown.to_string();
    }

    use regex::Regex;
    // Match `s3://baaton-uploads/<key>` where key is any non-whitespace,
    // non-paren, non-bracket, non-quote char run (covers markdown image syntax).
    static MARKER_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = MARKER_RE.get_or_init(|| {
        Regex::new(r#"s3://baaton-uploads/([A-Za-z0-9_\-/\.]+)"#).expect("regex")
    });

    let mut out = String::with_capacity(markdown.len());
    let mut last = 0;
    for m in re.captures_iter(markdown) {
        let full = m.get(0).unwrap();
        let key = m.get(1).unwrap().as_str();
        out.push_str(&markdown[last..full.start()]);
        match s3.presign_get(key).await {
            Ok(signed) => out.push_str(&signed),
            Err(e) => {
                tracing::warn!(key = %key, error = %e, "presign failed; keeping marker");
                out.push_str(full.as_str());
            }
        }
        last = full.end();
    }
    out.push_str(&markdown[last..]);
    out
}

/// Rewrite an optional markdown field. No-op if `s3` is None or the field is None/empty.
pub async fn rewrite_opt(field: &mut Option<String>, s3: Option<&S3State>) {
    let Some(s3) = s3 else { return };
    if let Some(text) = field {
        if text.contains(S3_URL_SCHEME) {
            *text = rewrite_markdown(text, s3).await;
        }
    }
}

/// Rewrite a required markdown field in place.
pub async fn rewrite_str(field: &mut String, s3: Option<&S3State>) {
    let Some(s3) = s3 else { return };
    if field.contains(S3_URL_SCHEME) {
        *field = rewrite_markdown(field, s3).await;
    }
}

/// Recursively rewrite `s3://baaton-uploads/<key>` markers to presigned HTTPS
/// URLs inside an arbitrary JSON value.
///
/// Used for inline `issue.attachments` (a `serde_json::Value`) so the client
/// receives fetchable URLs for any attachment whose payload lives in S3 rather
/// than inline as a `data:` URL. No-op when `s3` is None or no marker is found.
pub async fn rewrite_json_value(value: &mut serde_json::Value, s3: Option<&S3State>) {
    let Some(s3) = s3 else { return };
    rewrite_json_inner(value, s3).await;
}

fn rewrite_json_inner<'a>(
    value: &'a mut serde_json::Value,
    s3: &'a S3State,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        match value {
            serde_json::Value::String(s) => {
                if s.contains(S3_URL_SCHEME) {
                    *s = rewrite_markdown(s, s3).await;
                }
            }
            serde_json::Value::Array(arr) => {
                for v in arr.iter_mut() {
                    rewrite_json_inner(v, s3).await;
                }
            }
            serde_json::Value::Object(map) => {
                for (_k, v) in map.iter_mut() {
                    rewrite_json_inner(v, s3).await;
                }
            }
            _ => {}
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The regression that made attachments look "removed": a presigned URL
    /// round-tripped through the client must collapse back to a stable marker.
    #[test]
    fn collapses_presigned_attachment_urls() {
        let mut atts = json!([
            {
                "url": "https://baaton-uploads.s3.eu-west-3.amazonaws.com/org_1/abc.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=604800",
                "name": "shot.webp",
                "size": 25518,
                "mime_type": "image/webp"
            }
        ]);

        assert_eq!(collapse_json_value(&mut atts), 1);
        assert_eq!(atts[0]["url"], "s3://baaton-uploads/org_1/abc.webp");
        // Sibling metadata must survive untouched.
        assert_eq!(atts[0]["name"], "shot.webp");
        assert_eq!(atts[0]["size"], 25518);
    }

    /// Idempotent + non-destructive: markers, inline data URIs and foreign
    /// https URLs (legacy Airtable imports) must be left alone.
    #[test]
    fn leaves_markers_data_uris_and_foreign_urls_alone() {
        let mut atts = json!([
            {"url": "s3://baaton-uploads/org_1/abc.webp", "name": "a"},
            {"url": "data:image/webp;base64,AAAA", "name": "b"},
            {"url": "https://v5.airtableusercontent.com/v3/u/50/x.png", "name": "c"},
        ]);
        let before = atts.clone();

        assert_eq!(collapse_json_value(&mut atts), 0);
        assert_eq!(atts, before);
    }

    #[test]
    fn collapses_path_style_and_regionless_urls() {
        let mut atts = json!([
            {"url": "https://s3.eu-west-3.amazonaws.com/baaton-uploads/org_1/p.png?X-Amz-Signature=deadbeef"},
            {"url": "https://baaton-uploads.s3.amazonaws.com/org_2/q.pdf?X-Amz-Signature=deadbeef"},
        ]);

        assert_eq!(collapse_json_value(&mut atts), 2);
        assert_eq!(atts[0]["url"], "s3://baaton-uploads/org_1/p.png");
        assert_eq!(atts[1]["url"], "s3://baaton-uploads/org_2/q.pdf");
    }
}
