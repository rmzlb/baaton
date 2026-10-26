-- Email recap at fixed times (BAA-38).
--
-- Every notification email except @mentions becomes one recap per person,
-- sent at 08:00, 12:00, 16:00 and 20:00 Europe/Paris, and only when something
-- new happened. `pending_notifications` (078) keeps carrying @mentions, which
-- stay immediate.
--
-- `email_digest_events` holds one row per (recipient, event). `email_digests`
-- holds one row per (recipient, slot): it freezes which events a recap
-- contains before the first send attempt, so a retry resends the same content
-- under the same idempotency key, and a later event goes to the next recap
-- instead of being swallowed by notifyd's deduplication.
--
-- Additive only: the revision still running during the deploy never reads
-- these tables.

CREATE TABLE IF NOT EXISTS email_digests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT        NOT NULL,
    slot_at         TIMESTAMPTZ NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
    attempts        INT         NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until    TIMESTAMPTZ,
    last_error      TEXT,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, slot_at)
);

CREATE INDEX IF NOT EXISTS email_digests_due_idx
    ON email_digests (next_attempt_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS email_digest_events (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT        NOT NULL,
    address          TEXT        NOT NULL CHECK (length(trim(address)) > 0),
    org_id           TEXT        NOT NULL,
    project_id       UUID        NOT NULL,
    project_name     TEXT        NOT NULL,
    -- A deleted ticket leaves no line pointing at nothing.
    issue_id         UUID        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    issue_display_id TEXT        NOT NULL,
    issue_title      TEXT        NOT NULL,
    kind             TEXT        NOT NULL
                     CHECK (kind IN ('issue_created', 'status_changed', 'comment_added')),
    actor_name       TEXT        NOT NULL DEFAULT '',
    from_status      TEXT,
    to_status        TEXT,
    body             TEXT,
    -- Why this person hears it: 'role:<label>', 'subscription' or 'participant'.
    reason           TEXT        NOT NULL,
    -- One event reaches one person once, whichever path queued it.
    dedupe_key       TEXT        NOT NULL,
    occurred_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    digest_id        UUID        REFERENCES email_digests(id) ON DELETE CASCADE,
    UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS email_digest_events_unassigned_idx
    ON email_digest_events (created_at) WHERE digest_id IS NULL;
CREATE INDEX IF NOT EXISTS email_digest_events_digest_idx
    ON email_digest_events (digest_id);

-- Addresses and comment excerpts: deny every role but the owner the API
-- connects as. No policy is defined on purpose.
ALTER TABLE email_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_digest_events ENABLE ROW LEVEL SECURITY;
