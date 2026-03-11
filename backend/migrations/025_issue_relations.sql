CREATE TABLE IF NOT EXISTS issue_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  target_issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('blocks', 'blocked_by', 'relates_to', 'duplicate_of')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_issue_id, target_issue_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON issue_relations(source_issue_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON issue_relations(target_issue_id);
