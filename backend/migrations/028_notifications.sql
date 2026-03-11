CREATE TABLE IF NOT EXISTS issue_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('assigned', 'mentioned', 'status_changed', 'comment_added', 'issue_created', 'sla_breach')),
  issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_issue_notifications_user ON issue_notifications(user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, org_id, type)
);
