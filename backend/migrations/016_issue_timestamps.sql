-- Track when issues change status and when they are closed
ALTER TABLE issues ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Backfill status_changed_at with updated_at for all existing issues
UPDATE issues SET status_changed_at = updated_at WHERE status_changed_at IS NULL;

-- Backfill closed_at for already-done/cancelled issues
UPDATE issues SET closed_at = updated_at
WHERE (status = 'done' OR status = 'cancelled') AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_issues_closed_at ON issues(closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_issues_status_changed_at ON issues(status_changed_at);
