use axum::{
    extract::Query,
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
    Extension,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::middleware::AuthUser;

/// Global atomic counter for SSE event IDs (monotonically increasing).
static EVENT_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Shared broadcast channel sender for SSE events.
pub type EventSender = broadcast::Sender<SseEvent>;

/// An SSE event scoped to an organization with typed event name.
#[derive(Debug, Clone, Serialize)]
pub struct SseEvent {
    /// Monotonically increasing event ID for `Last-Event-ID` reconnection.
    pub id: u64,
    /// Organization scope — only clients in this org receive the event.
    pub org_id: String,
    /// Event type, e.g. "issue.created", "comment.created", "sprint.updated".
    pub event_type: String,
    /// JSON-serialized payload.
    pub payload: String,
}

/// Query params for the SSE endpoint.
#[derive(Debug, Deserialize)]
pub struct EventStreamParams {
    /// Optional: only receive events of this type (e.g. "issue.updated").
    pub event_type: Option<String>,
    /// Optional: only receive events for this project.
    pub project_id: Option<String>,
}

/// SSE endpoint: clients subscribe to real-time events for their org.
///
/// Supports:
/// - `Last-Event-ID` header for reconnection (resumes after missed events)
/// - `?event_type=issue.updated` filter
/// - `?project_id=<uuid>` filter
/// - Automatic keep-alive every 15s
/// - Handles `RecvError::Lagged` gracefully (notifies client, continues)
pub async fn event_stream(
    Extension(auth): Extension<AuthUser>,
    Extension(tx): Extension<EventSender>,
    headers: HeaderMap,
    Query(params): Query<EventStreamParams>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let rx = tx.subscribe();
    let user_org_id = auth.org_id.clone().unwrap_or_default();

    // Parse Last-Event-ID for reconnection support
    let last_event_id: u64 = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let event_type_filter = params.event_type;
    let project_id_filter = params.project_id;

    let stream = BroadcastStream::new(rx).filter_map(move |msg| {
        match msg {
            Ok(evt) => {
                // Filter by org
                if evt.org_id != user_org_id {
                    return None;
                }
                // Skip events already seen (reconnection)
                if evt.id <= last_event_id {
                    return None;
                }
                // Filter by event type if requested
                if let Some(ref filter) = event_type_filter {
                    if !evt.event_type.starts_with(filter.as_str()) {
                        return None;
                    }
                }
                // Filter by project_id if requested (check payload)
                if let Some(ref pid) = project_id_filter {
                    if !evt.payload.contains(pid.as_str()) {
                        return None;
                    }
                }

                Some(Ok(
                    Event::default()
                        .event(&evt.event_type)
                        .id(evt.id.to_string())
                        .data(evt.payload),
                ))
            }
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                // Client fell behind — notify them so they can re-fetch via API
                tracing::warn!(
                    org_id = %user_org_id,
                    missed = n,
                    "SSE client lagged behind, missed {} events",
                    n
                );
                Some(Ok(
                    Event::default()
                        .event("system.lagged")
                        .data(format!(
                            r#"{{"missed":{},"action":"refetch","message":"You missed {} events. Re-fetch current state via API."}}"#,
                            n, n
                        )),
                ))
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

/// Broadcast a typed event to all connected SSE clients in an org.
///
/// # Arguments
/// * `tx` - The shared broadcast sender
/// * `org_id` - Organization scope
/// * `event_type` - Event name (e.g. "issue.created", "comment.deleted")
/// * `payload` - JSON string payload
pub fn broadcast_event(tx: &EventSender, org_id: &str, event_type: &str, payload: &str) {
    let id = EVENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let _ = tx.send(SseEvent {
        id,
        org_id: org_id.to_string(),
        event_type: event_type.to_string(),
        payload: payload.to_string(),
    });
}
