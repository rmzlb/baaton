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

/// Max decoded image size: 10MB.
const MAX_DECODED_BYTES: usize = 10 * 1024 * 1024;

/// Allowed image MIME types.
const ALLOWED_MIME: &[&str] = &[
    "image/webp",
    "image/jpeg",
    "image/png",
    "image/gif",
];

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
                "error": "Image exceeds 10MB limit",
                "size": bytes.len(),
                "max": MAX_DECODED_BYTES,
            })),
        ));
    }

    if bytes.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Empty image data"})),
        ));
    }

    let ext = match content_type.as_str() {
        "image/webp" => "webp",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        _ => unreachable!(), // checked above
    };

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
