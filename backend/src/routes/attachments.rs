//! Issue file attachments.
//!
//! Two endpoints cooperate and neither is useful alone:
//!
//! * `POST /uploads` (see [`crate::routes::uploads`]) takes the base64 bytes,
//!   stores them in S3, and returns a durable `s3://baaton-uploads/<key>` marker.
//! * `POST /issues/{id}/attachments` (here) records the marker against an issue.
//!
//! The split exists because the same uploaded object can be referenced from an
//! issue description, a comment, or an attachment row, so storage is decoupled
//! from linkage. The cost of that design is discoverability: a caller who only
//! sees the attachments endpoint will try to POST bytes to it. Both the schema
//! (`deny_unknown_fields`) and the public docs now say so explicitly.

use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use std::sync::Arc;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ActionHint, ApiResponse};
use crate::s3::S3State;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub filename: String,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub storage_url: Option<String>,
    pub uploaded_by: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Attachment *metadata*. The bytes are never sent here.
///
/// Registering an attachment is the second half of a two-step flow:
///
/// 1. `POST /uploads` with `{data: <base64>, content_type, filename}` stores the
///    bytes in S3 and returns a stable `marker` (`s3://baaton-uploads/<key>`).
/// 2. `POST /issues/{id}/attachments` with that `marker` as `storage_url` links
///    the stored object to the issue.
///
/// `deny_unknown_fields` is load-bearing, not hygiene. Callers (agents in
/// particular) reasonably guess that a field named `data` exists here and POST
/// base64 straight to this endpoint. With serde's default leniency that key was
/// dropped silently and the row was written with `storage_url = NULL` — an
/// attachment that exists in the API and points at nothing. A 400 naming the
/// right endpoint is strictly better than a phantom row.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAttachment {
    pub filename: String,
    pub content_type: Option<String>,
    pub size_bytes: Option<i64>,
    /// The `marker` returned by `POST /uploads`. Presigned HTTPS URLs are
    /// accepted but collapsed to a marker before storage, because presigned URLs
    /// expire and a stored expired URL looks to users like a deleted file.
    pub storage_url: Option<String>,
}

/// GET /issues/{id}/attachments — list attachments
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    Extension(s3): Extension<Option<Arc<S3State>>>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<Attachment>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // API keys may be scoped to multiple orgs (all_dynamic); honor the full scope
    // instead of just the key's home org so cross-org reads match get_one.
    let org_ids: Vec<String> = if auth.is_api_key() && !auth.scoped_org_ids.is_empty() {
        auth.scoped_org_ids.clone()
    } else {
        vec![org_id.to_string()]
    };

    let mut attachments = sqlx::query_as::<_, Attachment>(
        "SELECT * FROM attachments WHERE issue_id = $1 AND org_id = ANY($2) ORDER BY created_at ASC"
    )
    .bind(issue_id)
    .bind(&org_ids)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Stored values are `s3://` markers; re-sign them on every read so the
    // client never receives an expired link. `issues::get_one` already does this
    // for the same rows — this list endpoint was handing out raw markers.
    for a in attachments.iter_mut() {
        crate::s3::rewrite_opt(&mut a.storage_url, s3.as_deref()).await;
    }

    Ok(Json(ApiResponse::new(attachments)))
}

/// POST /issues/{id}/attachments — register attachment metadata
/// POST /issues/{id}/attachments — register attachment metadata
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    Extension(s3): Extension<Option<Arc<S3State>>>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(raw): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<Attachment>>, (StatusCode, Json<serde_json::Value>)> {
    // Deserialize by hand rather than via `Json<CreateAttachment>` for exactly one
    // reason: the most common wrong call is POSTing base64 bytes as `data` here
    // instead of to `/uploads`. Serde's own `unknown field \`data\`` rejection is
    // technically correct and operationally useless — it does not name the
    // endpoint that actually accepts bytes. A caller that cannot find the right
    // endpoint from the error will keep guessing.
    if let Some(obj) = raw.as_object() {
        for byte_field in ["data", "file", "content", "base64", "bytes", "body"] {
            if obj.contains_key(byte_field) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!(
                            "This endpoint registers attachment metadata only and does not accept file bytes (received `{byte_field}`). \
                             Upload the bytes first: POST /uploads with {{\"data\": \"<base64>\", \"content_type\": \"image/png\", \"filename\": \"shot.png\"}}. \
                             That returns a `marker` (s3://baaton-uploads/<key>); then POST here with {{\"filename\", \"content_type\", \"size_bytes\", \"storage_url\": <marker>}}."
                        ),
                    })),
                ));
            }
        }
    }

    let body: CreateAttachment = serde_json::from_value(raw).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "Invalid attachment metadata: {e}. Accepted fields: filename (required), content_type, size_bytes, storage_url."
                ),
            })),
        )
    })?;

    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Resolve the issue's project, scoped to the caller's org.
    //
    // This query used to read `... FROM issues WHERE id = $1 AND org_id = $2`.
    // `issues` has no `org_id` column — tenancy lives on `projects` — so every
    // call to this endpoint failed with a raw Postgres error
    // (`column "org_id" does not exist`) and the table stayed empty from the day
    // it shipped. Every other route already scopes through the join below.
    //
    // API keys can hold a multi-org scope (`all_dynamic`), so honor the full
    // scope here the same way `list` and `issues::get_one` do, otherwise
    // registering an attachment would fail on issues the caller can read.
    let org_ids: Vec<String> = if auth.is_api_key() && !auth.scoped_org_ids.is_empty() {
        auth.scoped_org_ids.clone()
    } else {
        vec![org_id.to_string()]
    };

    let issue_row: (Uuid, String) = sqlx::query_as(
        "SELECT i.project_id, p.org_id \
           FROM issues i \
           JOIN projects p ON p.id = i.project_id \
          WHERE i.id = $1 AND p.org_id = ANY($2)",
    )
    .bind(issue_id)
    .bind(&org_ids)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;

    let (project_id, issue_org_id) = issue_row;

    // Never persist a presigned URL: they expire, and `GET` would then hand the
    // client a dead link that reads as "the file was removed". `collapse_to_markers`
    // rewrites presigned S3 URLs back to `s3://baaton-uploads/<key>`; the read
    // path re-signs markers on every response.
    let storage_url = body
        .storage_url
        .as_deref()
        .map(crate::s3::collapse_to_markers);

    let attachment = sqlx::query_as::<_, Attachment>(
        r#"INSERT INTO attachments (issue_id, project_id, org_id, filename, content_type, size_bytes, storage_url, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *"#,
    )
    .bind(issue_id)
    .bind(project_id)
    // The issue's own org, not the caller's home org: a multi-org key writing to
    // another scoped org must not stamp its home org onto the row, or `list`
    // (which filters on `org_id`) would never return it again.
    .bind(&issue_org_id)
    .bind(&body.filename)
    .bind(&body.content_type)
    .bind(body.size_bytes)
    .bind(&storage_url)
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let mut attachment = attachment;
    // Hand back a usable URL immediately so the caller does not need a second
    // GET to display what it just registered.
    crate::s3::rewrite_opt(&mut attachment.storage_url, s3.as_deref()).await;

    let hints = if attachment.storage_url.is_none() {
        vec![ActionHint::recommended(
            "upload_file_bytes",
            "This attachment has no storage_url, so nothing is downloadable. Upload the bytes to POST /uploads and PATCH the marker in, or delete this row.",
            Some("POST /uploads"),
        )]
    } else {
        vec![ActionHint::recommended(
            "reference_in_issue",
            "Registered attachments are listed on the issue but not shown inline. To display it in the description or a comment, embed the returned storage_url as Markdown.",
            Some("PATCH /issues/{id}"),
        )]
    };

    Ok(Json(ApiResponse::with_hints(attachment, hints)))
}

/// DELETE /issues/{id}/attachments/{att_id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path((issue_id, att_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Same multi-org scope as list/create: a key that could create the row must
    // be able to delete it.
    let org_ids: Vec<String> = if auth.is_api_key() && !auth.scoped_org_ids.is_empty() {
        auth.scoped_org_ids.clone()
    } else {
        vec![org_id.to_string()]
    };

    let result = sqlx::query("DELETE FROM attachments WHERE id = $1 AND issue_id = $2 AND org_id = ANY($3)")
        .bind(att_id)
        .bind(issue_id)
        .bind(&org_ids)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Attachment not found"}))));
    }

    Ok(Json(json!({"deleted": true})))
}
