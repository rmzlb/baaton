//! File upload endpoint — stores images on local disk under `./data/uploads/`
//! and returns a public URL served via the static `/uploads/` mount.
//!
//! Used by the NotionEditor (Tiptap) to persist inline images as URLs instead
//! of base64 data URIs (which were being stripped by `sanitize_description`).

use axum::{
    extract::{Extension, Json},
    http::StatusCode,
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

/// Max decoded image size: 10MB.
const MAX_DECODED_BYTES: usize = 10 * 1024 * 1024;

/// Allowed image MIME types.
const ALLOWED_MIME: &[&str] = &[
    "image/webp",
    "image/jpeg",
    "image/png",
    "image/gif",
];

/// Disk path where uploads are written. Served statically at `/uploads/`.
/// Override with `UPLOAD_DIR` env var (e.g. when mounting a Dokploy volume).
fn upload_dir() -> String {
    std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "/app/data/uploads".to_string())
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
    /// Public URL (relative path). Caller prepends API origin.
    pub url: String,
    pub filename: String,
    pub size: usize,
}

/// `POST /api/v1/uploads`
///
/// Accepts a base64-encoded image, writes it to disk, returns its public URL.
pub async fn upload(
    Extension(_auth): Extension<AuthUser>,
    Json(body): Json<UploadRequest>,
) -> Result<Json<ApiResponse<UploadResponse>>, (StatusCode, Json<serde_json::Value>)> {
    // ── Validate content type ─────────────────────────
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

    // ── Strip data URI prefix if present ──────────────
    let raw_b64 = if let Some(idx) = body.data.find("base64,") {
        &body.data[idx + "base64,".len()..]
    } else {
        body.data.as_str()
    };

    // ── Decode ────────────────────────────────────────
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

    // ── Pick extension from MIME ──────────────────────
    let ext = match content_type.as_str() {
        "image/webp" => "webp",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        _ => unreachable!(), // checked above
    };

    let id = Uuid::new_v4();
    let stored_filename = format!("{}.{}", id, ext);

    // ── Write to disk ─────────────────────────────────
    let dir = upload_dir();
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        tracing::error!("Failed to create upload dir: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Storage unavailable"})),
        )
    })?;

    let disk_path = format!("{}/{}", dir, stored_filename);
    tokio::fs::write(&disk_path, &bytes).await.map_err(|e| {
        tracing::error!(path = %disk_path, error = %e, "Failed to write upload");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to write file"})),
        )
    })?;

    let display_name = body.filename.unwrap_or_else(|| stored_filename.clone());
    let url = format!("/uploads/{}", stored_filename);

    tracing::info!(
        url = %url,
        size = bytes.len(),
        content_type = %content_type,
        "uploads.create.success"
    );

    Ok(Json(ApiResponse::new(UploadResponse {
        url,
        filename: display_name,
        size: bytes.len(),
    })))
}
