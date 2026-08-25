//! Normalizes every `/api/v1` error response into one machine-readable shape.
//!
//! ## The problem this solves
//!
//! Routes were written independently and each hand-rolled its failure body. The
//! dominant pattern was `Json(json!({"error": e.to_string()}))`, which for a
//! database failure produces:
//!
//! ```json
//! { "error": "error returned from database: column \"org_id\" does not exist" }
//! ```
//!
//! A human reads that and files a bug. An LLM agent reads it and concludes "the
//! server's database is broken" — which is sometimes right and sometimes a
//! completely wrong diagnosis of its own malformed request. It has no way to
//! tell, because nothing in the payload says whether the caller or the server is
//! at fault, what to do about it, or where the contract is documented.
//!
//! Worse, axum's own extractor rejections never went through any route code at
//! all, so a wrong `Content-Type` returned a bare `text/plain` body:
//! `Expected request with \`Content-Type: application/json\``. Agents parsing
//! JSON got a parse error on top of the original error.
//!
//! ## The approach: one outer layer, not 40 route edits
//!
//! Rewriting ~40 route modules to build structured errors by hand would be a
//! large diff, would drift the moment someone adds a route, and would leave two
//! error formats live during the transition. Two formats is worse for an agent
//! than one bad format, because it has to branch on shape before it can even
//! read the message.
//!
//! So normalization happens once, as a response-side layer wrapping the whole
//! API router. Routes keep returning whatever they return. Anything with a 4xx/
//! 5xx status gets reshaped on the way out:
//!
//! ```json
//! {
//!   "error": {
//!     "code": "DATABASE_ERROR",
//!     "message": "error returned from database: column \"org_id\" does not exist",
//!     "remediation": "Server-side defect: the request was well-formed but the query failed. Retrying will not help. Report this with the endpoint and payload.",
//!     "status": 500,
//!     "caller_fault": false,
//!     "docs_url": "https://api.baaton.dev/api/v1/public/docs"
//!   }
//! }
//! ```
//!
//! `caller_fault` is the field that actually matters for autonomous callers: it
//! answers "should I fix my request, or stop and escalate?" without pattern
//! matching on prose.
//!
//! ## Why the raw message is kept verbatim
//!
//! Truncating it to something tidy like "Internal error" would have hidden the
//! `column "org_id" does not exist` string that made the attachments bug
//! diagnosable in minutes. Debuggability wins here. The API is authenticated and
//! scoped per org, so the audience for these strings is integrators, not
//! anonymous traffic.
//!
//! ## Backwards compatibility
//!
//! The frontend (`frontend/src/lib/api.ts`) already accepted both
//! `{"error": "string"}` and `{"error": {code, message}}` before this layer
//! existed, so it reads the new shape unchanged. Already-structured bodies are
//! passed through untouched rather than double-wrapped.

use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};
use serde_json::{json, Value};

/// Where an agent should look for the contract it just violated.
const DOCS_URL: &str = "https://api.baaton.dev/api/v1/public/docs";

/// Ceiling on the error body we will buffer to rewrite. Error payloads are
/// prose; anything past this is not an error body we authored, so it streams
/// through untouched instead of being held in memory.
const MAX_ERROR_BODY: usize = 64 * 1024;

/// Stable error code + remediation for a status/message pair.
///
/// Codes are derived from the status plus, for 500s, a coarse look at the
/// message. They are deliberately coarse: a code an agent can branch on is
/// useful, a code per call site is noise.
fn classify(status: StatusCode, message: &str) -> (&'static str, &'static str, bool) {
    let lower = message.to_ascii_lowercase();

    match status {
        StatusCode::BAD_REQUEST => (
            "BAD_REQUEST",
            "The request was rejected before any work happened. Fix the payload or path parameters, then retry.",
            true,
        ),
        StatusCode::UNAUTHORIZED => (
            "UNAUTHENTICATED",
            "Missing or invalid credentials. Send `Authorization: Bearer <api_key>`. Retrying the same request will fail identically.",
            true,
        ),
        StatusCode::FORBIDDEN => (
            "FORBIDDEN",
            "Authenticated but not permitted. The API key lacks the required permission scope, or the target belongs to another org or project. Check the key's scopes rather than retrying.",
            true,
        ),
        StatusCode::NOT_FOUND => (
            "NOT_FOUND",
            "No such resource is visible to this caller. Either the id is wrong or it lives outside this key's org/project scope. Re-resolve the id via a list endpoint instead of retrying.",
            true,
        ),
        StatusCode::METHOD_NOT_ALLOWED => (
            "METHOD_NOT_ALLOWED",
            "The path exists but not for this HTTP method. Check the endpoint table in the docs.",
            true,
        ),
        StatusCode::CONFLICT => (
            "CONFLICT",
            "The request collides with existing state (duplicate, or a concurrent change). Re-read the resource before retrying.",
            true,
        ),
        StatusCode::PAYLOAD_TOO_LARGE => (
            "PAYLOAD_TOO_LARGE",
            "Body exceeds the limit. Uploads decode to a maximum of 10MB; the JSON request ceiling is 20MB to allow for base64 overhead. Compress or split the payload.",
            true,
        ),
        StatusCode::UNSUPPORTED_MEDIA_TYPE => (
            "UNSUPPORTED_MEDIA_TYPE",
            "This API is JSON-only. Send `Content-Type: application/json` with a JSON body. `multipart/form-data` is not accepted anywhere, including file uploads — encode binaries as base64 and POST them to /uploads.",
            true,
        ),
        StatusCode::UNPROCESSABLE_ENTITY => (
            "VALIDATION_ERROR",
            "The body parsed as JSON but failed validation. The message names the offending field; correct it and retry.",
            true,
        ),
        StatusCode::TOO_MANY_REQUESTS => (
            "RATE_LIMITED",
            "Rate limit hit. Back off and retry; honor `Retry-After` when present.",
            true,
        ),
        StatusCode::SERVICE_UNAVAILABLE => (
            "SERVICE_UNAVAILABLE",
            "A dependency the endpoint needs is not configured or is down (for example object storage for uploads). Not caused by the request. Retry later or escalate.",
            false,
        ),
        StatusCode::INTERNAL_SERVER_ERROR => {
            if lower.contains("error returned from database")
                || lower.contains("column")
                || lower.contains("relation")
                || lower.contains("constraint")
            {
                (
                    "DATABASE_ERROR",
                    "Server-side defect: the request reached the database and the query itself failed. Retrying will not help and the payload is not at fault. Report this with the endpoint and the request body.",
                    false,
                )
            } else {
                (
                    "INTERNAL_ERROR",
                    "Unhandled server-side failure. Not caused by the request. Retry once; if it persists, report it with the endpoint and the request body.",
                    false,
                )
            }
        }
        s if s.is_client_error() => (
            "CLIENT_ERROR",
            "The request was rejected. Fix it per the message before retrying.",
            true,
        ),
        _ => (
            "SERVER_ERROR",
            "Server-side failure. Not caused by the request.",
            false,
        ),
    }
}

/// Pull a human-readable message out of whatever the route (or axum) produced.
///
/// Returns `None` when the body is already a structured error object, which
/// signals "leave this alone" to the caller.
fn extract_message(bytes: &Bytes) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim();

    if trimmed.is_empty() {
        return Some(String::new());
    }

    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Object(map)) => match map.get("error") {
            // Already structured (`{"error": {code, message, ...}}`) — do not
            // re-wrap, or agents get `error.error.message`.
            Some(Value::Object(_)) => None,
            Some(Value::String(s)) => Some(s.clone()),
            // `{"error": <non-string>}` or no `error` key at all: keep the whole
            // body as the message so nothing is silently dropped.
            _ => map
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| Some(trimmed.to_string())),
        },
        // Plain-text bodies: axum's own extractor rejections land here.
        _ => Some(trimmed.to_string()),
    }
}

/// Response-side layer. Applied once around the API router.
pub async fn error_envelope(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    let status = response.status();

    if !(status.is_client_error() || status.is_server_error()) {
        return response;
    }

    // Server-Sent Events and other streaming responses must not be buffered.
    let is_event_stream = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.starts_with("text/event-stream"));
    if is_event_stream {
        return response;
    }

    let (mut parts, body) = response.into_parts();

    let bytes = match axum::body::to_bytes(body, MAX_ERROR_BODY).await {
        Ok(b) => b,
        // Oversized or unreadable: we cannot rewrite what we cannot read, and an
        // error path must never itself fail. Emit a valid envelope instead.
        Err(_) => {
            let (code, remediation, caller_fault) = classify(status, "");
            let body = json!({
                "error": {
                    "code": code,
                    "message": "Error body was unavailable or exceeded the buffering limit.",
                    "remediation": remediation,
                    "status": status.as_u16(),
                    "caller_fault": caller_fault,
                    "docs_url": DOCS_URL,
                }
            });
            return json_response(parts.status, &body);
        }
    };

    let Some(message) = extract_message(&bytes) else {
        // Already structured — hand it back exactly as it was.
        return Response::from_parts(parts, Body::from(bytes));
    };

    let (code, remediation, caller_fault) = classify(status, &message);
    let message = if message.is_empty() {
        status
            .canonical_reason()
            .unwrap_or("Request failed")
            .to_string()
    } else {
        message
    };

    let envelope = json!({
        "error": {
            "code": code,
            // Verbatim. See module docs: the raw string is what makes failures
            // diagnosable.
            "message": message,
            "remediation": remediation,
            "status": status.as_u16(),
            "caller_fault": caller_fault,
            "docs_url": DOCS_URL,
        }
    });

    // Content-Length is about to change and Content-Type may have been text.
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );

    let serialized = serde_json::to_vec(&envelope).unwrap_or_else(|_| {
        br#"{"error":{"code":"INTERNAL_ERROR","message":"Error serialization failed"}}"#.to_vec()
    });

    Response::from_parts(parts, Body::from(serialized))
}

/// Build a fresh JSON response, preserving only the status.
fn json_response(status: StatusCode, body: &Value) -> Response {
    let serialized = serde_json::to_vec(body).unwrap_or_default();
    let mut response = Response::new(Body::from(serialized));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_errors_are_not_the_callers_fault() {
        // The exact string that made a caller conclude "their DB is broken" and
        // stop, when the request was also malformed. The code now says which.
        let (code, _, caller_fault) = classify(
            StatusCode::INTERNAL_SERVER_ERROR,
            "error returned from database: column \"org_id\" does not exist",
        );
        assert_eq!(code, "DATABASE_ERROR");
        assert!(!caller_fault);
    }

    #[test]
    fn client_errors_are_the_callers_fault() {
        for status in [
            StatusCode::BAD_REQUEST,
            StatusCode::UNAUTHORIZED,
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND,
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            StatusCode::PAYLOAD_TOO_LARGE,
        ] {
            let (_, _, caller_fault) = classify(status, "whatever");
            assert!(caller_fault, "{status} should be caller_fault");
        }
    }

    #[test]
    fn dependency_outages_are_not_the_callers_fault() {
        let (code, _, caller_fault) =
            classify(StatusCode::SERVICE_UNAVAILABLE, "Uploads disabled (S3 not configured)");
        assert_eq!(code, "SERVICE_UNAVAILABLE");
        assert!(!caller_fault);
    }

    #[test]
    fn generic_500s_are_separated_from_database_500s() {
        let (code, _, caller_fault) =
            classify(StatusCode::INTERNAL_SERVER_ERROR, "Storage failed");
        assert_eq!(code, "INTERNAL_ERROR");
        assert!(!caller_fault);
    }

    #[test]
    fn extracts_the_message_from_the_legacy_string_shape() {
        let bytes = Bytes::from(r#"{"error":"Issue not found"}"#);
        assert_eq!(extract_message(&bytes).as_deref(), Some("Issue not found"));
    }

    #[test]
    fn already_structured_bodies_are_left_alone() {
        // Guards against `error.error.message` double-wrapping.
        let bytes = Bytes::from(r#"{"error":{"code":"NOT_FOUND","message":"nope"}}"#);
        assert!(extract_message(&bytes).is_none());
    }

    #[test]
    fn plain_text_extractor_rejections_become_messages() {
        // axum's own rejections never reach route code and were not JSON at all.
        let bytes = Bytes::from("Expected request with `Content-Type: application/json`");
        assert_eq!(
            extract_message(&bytes).as_deref(),
            Some("Expected request with `Content-Type: application/json`")
        );
    }

    #[test]
    fn empty_bodies_yield_an_empty_message_not_a_panic() {
        assert_eq!(extract_message(&Bytes::new()).as_deref(), Some(""));
    }

    #[test]
    fn unrecognized_json_bodies_are_preserved_whole() {
        // Nothing is silently dropped: no `error` key means keep the payload.
        let bytes = Bytes::from(r#"{"detail":"something odd"}"#);
        assert_eq!(
            extract_message(&bytes).as_deref(),
            Some(r#"{"detail":"something odd"}"#)
        );
    }

    #[test]
    fn message_field_is_used_when_error_key_is_absent() {
        let bytes = Bytes::from(r#"{"message":"plan limit reached"}"#);
        assert_eq!(extract_message(&bytes).as_deref(), Some("plan limit reached"));
    }
}
