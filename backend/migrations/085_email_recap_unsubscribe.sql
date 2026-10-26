-- Email recap unsubscribe (BAA-40).
--
-- The recap (083) goes to a person, whatever address it reaches them at: a
-- role holder without an email channel gets it at their account address. So
-- the choice to stop it belongs to the person too, not to a channel row.
-- @mentions (`pending_notifications`, 078) are not affected.
--
-- `user_email_settings` holds that choice. No row means the default: the
-- recap is on.
--
-- `email_unsubscribe_tokens` holds one SHA-256 per unsubscribe link, never the
-- link itself. Each recap mints its own link at its first send attempt and
-- keeps it in `email_digests.unsubscribe_token` only until the recap is sent,
-- skipped or abandoned, so a retry resends the exact same mail and no clear
-- token outlives its pending window.

CREATE TABLE IF NOT EXISTS user_email_settings (
    user_id       TEXT        PRIMARY KEY,
    recap_enabled BOOLEAN     NOT NULL DEFAULT true,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
    token_hash BYTEA       PRIMARY KEY CHECK (length(token_hash) = 32),
    user_id    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_unsubscribe_tokens_created_idx
    ON email_unsubscribe_tokens (created_at);

ALTER TABLE email_digests ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;

-- Deny every role but the owner the API connects as. No policy on purpose.
ALTER TABLE user_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- 076's per-project email statuses: nothing reads them since BAA-38 replaced
-- the panel with the recap. `IF EXISTS` keeps the file runnable on a schema
-- that never had the table (the recap tests).
ALTER TABLE IF EXISTS project_notification_subscriptions
    DROP CONSTRAINT IF EXISTS subs_email_notify_statuses_is_array;
ALTER TABLE IF EXISTS project_notification_subscriptions
    DROP COLUMN IF EXISTS email_notify_statuses;
