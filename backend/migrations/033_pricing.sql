-- BAA-1: Pricing Tier Enforcement
-- Add plan column to existing organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise'));

-- API request counter per org per month (for rate limiting)
CREATE TABLE IF NOT EXISTS api_request_log (
  org_id TEXT NOT NULL,
  month TEXT NOT NULL,  -- format: "YYYY-MM"
  count INT DEFAULT 0,
  PRIMARY KEY (org_id, month)
);
