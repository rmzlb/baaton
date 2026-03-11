-- Webhooks table for agent-first event delivery
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    event_types TEXT[] NOT NULL DEFAULT '{}',
    secret TEXT NOT NULL,
    enabled BOOL NOT NULL DEFAULT true,
    failure_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    last_delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org_id ON webhooks (org_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks (org_id, enabled);
