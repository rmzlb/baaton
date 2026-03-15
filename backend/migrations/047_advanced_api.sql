-- Migration 047: Advanced API features
-- 1. Webhook delivery log + retry support
-- 2. Rate limit per-request tracking (hourly, not monthly)

-- ─── Webhook delivery log for retries ─────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, delivered, failed, retrying
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 4,
    last_attempt_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    last_error TEXT,
    delivery_id UUID NOT NULL DEFAULT gen_random_uuid(), -- unique ID per delivery for dedup
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
    ON webhook_deliveries (status, next_retry_at)
    WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
    ON webhook_deliveries (webhook_id, created_at DESC);

-- ─── Hourly rate limit table ──────────────────────────
CREATE TABLE IF NOT EXISTS api_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_key TEXT NOT NULL, -- "user:<user_id>" or "ip:<addr>"
    time_window TEXT NOT NULL, -- "2026-03-15T14" (hourly window)
    count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(rate_key, time_window)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_key_window
    ON api_rate_limits (rate_key, time_window);

-- ─── Add more webhook event types to documentation ────
-- (No schema change needed — event types are validated in Rust code)

-- ─── Add updated_at index for orderBy support ─────────
CREATE INDEX IF NOT EXISTS idx_issues_updated_at ON issues (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues (created_at DESC);

-- ─── Composite index for filtering ────────────────────
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues (project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_project_priority ON issues (project_id, priority);
CREATE INDEX IF NOT EXISTS idx_issues_due_date ON issues (due_date) WHERE due_date IS NOT NULL;
