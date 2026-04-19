#![allow(dead_code)]
//! Centralized event bus for Baaton.
//!
//! All side effects from mutations (SSE, webhooks, activity log, notifications,
//! gamification) are routed through a single `emit()` call.
//!
//! This replaces the scattered pattern of 5+ manual calls in each handler.
//!
//! Best practices applied:
//! - Single responsibility: handlers do the mutation, event_bus does the side effects
//! - Domain event naming: `resource.action` (e.g. `issue.created`, `comment.deleted`)
//! - Fan-out is async and fire-and-forget — mutations never block on side effects
//! - New channels (Slack, email digest, etc.) are added here, not in every handler

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::routes::sse::{EventSender, broadcast_event};
use crate::routes::webhooks::dispatch_event;
use crate::routes::activity::log_activity;

/// A domain event emitted after a mutation.
#[derive(Debug, Clone)]
pub struct AppEvent {
    /// Organization scope
    pub org_id: String,
    /// Domain event type (e.g. "issue.created", "comment.deleted")
    pub event_type: String,
    /// Project ID (if applicable)
    pub project_id: Option<Uuid>,
    /// Issue ID (if applicable)
    pub issue_id: Option<Uuid>,
    /// Actor who triggered the event
    pub actor_id: String,
    /// Actor display name
    pub actor_name: Option<String>,
    /// JSON-serialized payload (the created/updated entity)
    pub payload: serde_json::Value,
    /// Activity log action (may differ from event_type, e.g. "status_changed")
    pub activity_action: Option<String>,
    /// Activity log: field that changed
    pub activity_field: Option<String>,
    /// Activity log: old value
    pub activity_old: Option<String>,
    /// Activity log: new value
    pub activity_new: Option<String>,
    /// Activity log: extra metadata
    pub activity_meta: Option<serde_json::Value>,
}

/// Emit a domain event — fans out to all side-effect channels.
///
/// This is fire-and-forget: the caller does not wait for side effects.
/// All channels are processed in a spawned task.
pub fn emit(pool: PgPool, sse_tx: EventSender, event: AppEvent) {
    // 1. SSE broadcast (synchronous, in-memory — instant)
    let payload_str = serde_json::to_string(&event.payload).unwrap_or_default();
    broadcast_event(&sse_tx, &event.org_id, &event.event_type, &payload_str);

    // 2. Everything else in a background task (async, fire-and-forget)
    tokio::spawn(async move {
        // Webhook dispatch
        dispatch_event(
            pool.clone(),
            event.org_id.clone(),
            &event.event_type,
            event.payload.clone(),
        )
        .await;

        // Activity log (if action specified)
        if let Some(ref action) = event.activity_action {
            log_activity(
                &pool,
                &event.org_id,
                event.project_id,
                event.issue_id,
                &event.actor_id,
                event.actor_name.as_deref(),
                action,
                event.activity_field.as_deref(),
                event.activity_old.as_deref(),
                event.activity_new.as_deref(),
                event.activity_meta.clone(),
            )
            .await;
        }
    });
}

/// Builder for constructing AppEvent with less boilerplate in handlers.
pub struct EventBuilder {
    event: AppEvent,
}

impl EventBuilder {
    pub fn new(org_id: &str, event_type: &str, actor_id: &str) -> Self {
        Self {
            event: AppEvent {
                org_id: org_id.to_string(),
                event_type: event_type.to_string(),
                project_id: None,
                issue_id: None,
                actor_id: actor_id.to_string(),
                actor_name: None,
                payload: serde_json::Value::Null,
                activity_action: None,
                activity_field: None,
                activity_old: None,
                activity_new: None,
                activity_meta: None,
            },
        }
    }

    pub fn project(mut self, id: Uuid) -> Self {
        self.event.project_id = Some(id);
        self
    }

    pub fn issue(mut self, id: Uuid) -> Self {
        self.event.issue_id = Some(id);
        self
    }

    pub fn actor_name(mut self, name: &str) -> Self {
        self.event.actor_name = Some(name.to_string());
        self
    }

    pub fn payload<T: Serialize>(mut self, data: &T) -> Self {
        self.event.payload = serde_json::to_value(data).unwrap_or_default();
        self
    }

    pub fn activity(mut self, action: &str) -> Self {
        self.event.activity_action = Some(action.to_string());
        self
    }

    pub fn field_change(mut self, field: &str, old: &str, new: &str) -> Self {
        self.event.activity_field = Some(field.to_string());
        self.event.activity_old = Some(old.to_string());
        self.event.activity_new = Some(new.to_string());
        self
    }

    pub fn meta(mut self, meta: serde_json::Value) -> Self {
        self.event.activity_meta = Some(meta);
        self
    }

    /// Emit the event (consumes the builder).
    pub fn emit(self, pool: PgPool, sse_tx: EventSender) {
        super::event_bus::emit(pool, sse_tx, self.event);
    }

    /// Build without emitting (for testing or conditional emit).
    pub fn build(self) -> AppEvent {
        self.event
    }
}
