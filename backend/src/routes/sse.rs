use axum::{
    response::sse::{Event, KeepAlive, Sse},
    Extension,
};
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::middleware::AuthUser;

/// Shared broadcast channel sender for SSE events.
pub type EventSender = broadcast::Sender<SseEvent>;

/// An SSE event scoped to an organization.
#[derive(Debug, Clone)]
pub struct SseEvent {
    pub org_id: String,
    pub payload: String,
}

/// SSE endpoint: clients subscribe to real-time events for their org.
pub async fn event_stream(
    Extension(auth): Extension<AuthUser>,
    Extension(tx): Extension<EventSender>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let rx = tx.subscribe();
    let user_org_id = auth.org_id.clone().unwrap_or_default();

    let stream = BroadcastStream::new(rx).filter_map(move |msg| match msg {
        Ok(evt) if evt.org_id == user_org_id => Some(Ok(Event::default().data(evt.payload))),
        _ => None,
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new().interval(Duration::from_secs(15)),
    )
}

/// Helper to broadcast an event (fire-and-forget).
pub fn broadcast_event(tx: &EventSender, org_id: &str, payload: &str) {
    let _ = tx.send(SseEvent {
        org_id: org_id.to_string(),
        payload: payload.to_string(),
    });
}
