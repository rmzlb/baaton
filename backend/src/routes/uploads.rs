//! File upload endpoint — stores images in S3 (`baaton-uploads` bucket) and
//! returns a presigned HTTPS URL for immediate display + an opaque
//! `s3://baaton-uploads/<key>` marker that the caller persists in markdown.
//!
//! The serializer rewrites markers back to fresh presigned URLs on every read
//! (see `crate::s3::rewrite_markdown`), so users never see expired links.

use axum::{
    extract::{Extension, Json},
    http::StatusCode,
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;
use crate::s3::S3State;

/// Max decoded file size: 10MB (covers compressed images + documents).
const MAX_DECODED_BYTES: usize = 10 * 1024 * 1024;

/// Allowed MIME types — images + common documents. Attachments are stored in
/// S3 and served via presigned URLs / downloaded, never executed by the
/// browser, so the doc set mirrors what the issue drawer accepts.
const ALLOWED_MIME: &[&str] = &[
    // Images
    "image/webp",
    "image/jpeg",
    "image/png",
    "image/gif",
    // Documents
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
];

/// Map an allowed MIME type to a file extension for the S3 key. Falls back to
/// the original filename's extension (sanitized) and finally `bin`.
fn ext_for(content_type: &str, filename: Option<&str>) -> String {
    match content_type {
        "image/webp" => "webp",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "text/csv" => "csv",
        "text/markdown" => "md",
        "application/json" => "json",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/zip" => "zip",
        _ => {
            // Fallback: derive from filename extension (alnum only), else bin.
            let ext = filename
                .and_then(|f| f.rsplit('.').next())
                .map(|e| e.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>())
                .filter(|e| !e.is_empty() && e.len() <= 8)
                .unwrap_or_else(|| "bin".to_string());
            return ext.to_ascii_lowercase();
        }
    }
    .to_string()
}

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    /// Either raw base64 (`AAAA...`) or a data URI (`data:image/webp;base64,AAAA...`).
    pub data: String,
    /// Optional original filename (used for display/logs only).
    pub filename: Option<String>,
    /// MIME type — must be in `ALLOWED_MIME`.
    pub content_type: String,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    /// Presigned HTTPS URL for immediate use (expires after `S3_PRESIGN_TTL_SECS`).
    pub url: String,
    /// Stable opaque marker (`s3://baaton-uploads/<key>`) — persist this in
    /// markdown / DB. Re-rendered to a fresh presigned URL on each read.
    pub marker: String,
    pub filename: String,
    pub size: usize,
}

/// `POST /api/v1/uploads`
///
/// Accepts a base64-encoded image, uploads to S3, returns a presigned URL.
pub async fn upload(
    Extension(auth): Extension<AuthUser>,
    Extension(s3): Extension<Option<Arc<S3State>>>,
    Json(body): Json<UploadRequest>,
) -> Result<Json<ApiResponse<UploadResponse>>, (StatusCode, Json<serde_json::Value>)> {
    let s3 = s3.ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error": "Uploads disabled (S3 not configured)"})),
    ))?;

    let content_type = body.content_type.trim().to_lowercase();
    if !ALLOWED_MIME.contains(&content_type.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Unsupported content_type",
                "allowed": ALLOWED_MIME,
            })),
        ));
    }

    let raw_b64 = if let Some(idx) = body.data.find("base64,") {
        &body.data[idx + "base64,".len()..]
    } else {
        body.data.as_str()
    };

    let bytes = general_purpose::STANDARD
        .decode(raw_b64.trim())
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Invalid base64: {}", e)})),
            )
        })?;

    if bytes.len() > MAX_DECODED_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({
                "error": "File exceeds 10MB limit",
                "size": bytes.len(),
                "max": MAX_DECODED_BYTES,
            })),
        ));
    }

    if bytes.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Empty file data"})),
        ));
    }

    let ext = ext_for(&content_type, body.filename.as_deref());

    let id = Uuid::new_v4();
    // Key layout: `{org_id}/{uuid}.{ext}` — useful for per-tenant audit & purge.
    // Falls back to `u-{user_id}` if the user has no org context (rare).
    let scope = auth
        .org_id
        .as_deref()
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("u-{}", auth.user_id));
    let key = format!("{}/{}.{}", scope, id, ext);
    let size = bytes.len();

    s3.put_object(&key, bytes, &content_type).await.map_err(|e| {
        tracing::error!(key = %key, error = %e, "uploads.s3_put.failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Storage failed"})),
        )
    })?;

    let presigned = s3.presign_get(&key).await.map_err(|e| {
        tracing::error!(key = %key, error = %e, "uploads.presign.failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Could not sign URL"})),
        )
    })?;

    let marker = crate::s3::build_marker(&key);
    let display_name = body
        .filename
        .unwrap_or_else(|| format!("{}.{}", id, ext));

    tracing::info!(
        key = %key,
        size = size,
        content_type = %content_type,
        org = ?auth.org_id,
        "uploads.create.success"
    );

    Ok(Json(ApiResponse::new(UploadResponse {
        url: presigned,
        marker,
        filename: display_name,
        size,
    })))
}
