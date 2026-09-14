-- Email is deliberately quieter than chat: no inherited/all-channel opt-in.
-- An empty array means creator in_review emails only; selected project status
-- keys add explicit subscription emails without changing Telegram preferences.
ALTER TABLE project_notification_subscriptions
  ADD COLUMN IF NOT EXISTS email_notify_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE project_notification_subscriptions
  ADD CONSTRAINT subs_email_notify_statuses_is_array
    CHECK (jsonb_typeof(email_notify_statuses) = 'array');
