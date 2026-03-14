-- Approval workflow: structured comments for agent approval requests
ALTER TABLE comments ADD COLUMN IF NOT EXISTS comment_type TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS approval_metadata JSONB;

-- Index for quickly finding pending approvals
CREATE INDEX IF NOT EXISTS idx_comments_approval_status ON comments (approval_status) WHERE approval_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_comment_type ON comments (comment_type) WHERE comment_type != 'comment';
