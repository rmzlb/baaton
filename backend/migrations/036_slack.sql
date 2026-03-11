CREATE TABLE IF NOT EXISTS slack_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT,
  bot_token TEXT NOT NULL,
  channel_mappings JSONB DEFAULT '{}',
  webhook_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, team_id)
);
