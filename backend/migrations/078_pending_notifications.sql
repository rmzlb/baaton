-- Digest window: events batched per (issue, recipient) before email delivery.
-- A fixed 2-minute window starts at the first event; new events for the same
-- pair extend the content but not the window.
CREATE TABLE pending_notifications (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id           UUID        NOT NULL,
    issue_display_id   TEXT        NOT NULL,
    issue_title        TEXT        NOT NULL,
    project_name       TEXT,
    recipient_identity TEXT        NOT NULL,
    events             JSONB       NOT NULL DEFAULT '[]',
    fire_at            TIMESTAMPTZ NOT NULL,
    sent_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one pending (unsent) batch per issue × recipient.
CREATE UNIQUE INDEX pending_notifications_active_idx
    ON pending_notifications (issue_id, recipient_identity)
    WHERE sent_at IS NULL;

CREATE INDEX pending_notifications_fire_at_idx
    ON pending_notifications (fire_at)
    WHERE sent_at IS NULL;
