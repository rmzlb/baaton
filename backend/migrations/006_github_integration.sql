-- 006_github_integration.sql
-- GitHub App integration tables for Baaton

-- ═══════════════════════════════════════════════════════
-- GitHub Installations (one per org)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL UNIQUE,
    
    -- GitHub org/user that installed the app
    github_account_id BIGINT NOT NULL,
    github_account_login TEXT NOT NULL,
    github_account_type TEXT NOT NULL DEFAULT 'Organization'
        CHECK (github_account_type IN ('Organization', 'User')),
    
    -- Permissions granted at install time (snapshot)
    permissions JSONB NOT NULL DEFAULT '{}',
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'removed')),
    
    -- Metadata
    installed_by TEXT, -- Clerk user_id who initiated the install
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(org_id)  -- one installation per Baaton org
);

CREATE INDEX IF NOT EXISTS idx_gh_installations_org ON github_installations(org_id);
CREATE INDEX IF NOT EXISTS idx_gh_installations_iid ON github_installations(installation_id);

-- ═══════════════════════════════════════════════════════
-- GitHub User Connections (for comment attribution)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_user_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    github_user_id BIGINT NOT NULL,
    github_username TEXT NOT NULL,
    github_email TEXT,
    
    -- OAuth token for user-level actions (encrypted at rest)
    access_token_encrypted TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_gh_user_conn_user ON github_user_connections(user_id);

-- ═══════════════════════════════════════════════════════
-- GitHub Repositories (cached repo metadata)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
    
    github_repo_id BIGINT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    is_private BOOLEAN NOT NULL DEFAULT false,
    
    last_synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_repos_install ON github_repositories(installation_id);
CREATE INDEX IF NOT EXISTS idx_gh_repos_fullname ON github_repositories(full_name);

-- ═══════════════════════════════════════════════════════
-- Repo ↔ Project Mappings (the core link)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_repo_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL REFERENCES github_repositories(github_repo_id) ON DELETE CASCADE,
    
    sync_direction TEXT NOT NULL DEFAULT 'bidirectional'
        CHECK (sync_direction IN ('github_to_baaton', 'baaton_to_github', 'bidirectional')),
    
    sync_issues BOOLEAN NOT NULL DEFAULT true,
    sync_prs BOOLEAN NOT NULL DEFAULT true,
    sync_comments BOOLEAN NOT NULL DEFAULT true,
    auto_create_issues BOOLEAN NOT NULL DEFAULT false,
    
    status_mapping JSONB NOT NULL DEFAULT '{
        "issue_opened": "todo",
        "issue_closed": "done",
        "pr_opened": "in_progress",
        "pr_merged": "done",
        "pr_closed": null
    }',
    
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(github_repo_id)
);

CREATE INDEX IF NOT EXISTS idx_gh_mappings_project ON github_repo_mappings(project_id);
CREATE INDEX IF NOT EXISTS idx_gh_mappings_repo ON github_repo_mappings(github_repo_id);

-- ═══════════════════════════════════════════════════════
-- Issue Links (Baaton issue ↔ GitHub issue)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_issue_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL,
    github_issue_number INT NOT NULL,
    github_issue_id BIGINT NOT NULL,
    
    sync_status TEXT NOT NULL DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'pending_push', 'pending_pull', 'conflict', 'error')),
    last_synced_at TIMESTAMPTZ,
    last_github_updated_at TIMESTAMPTZ,
    last_baaton_updated_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(issue_id),
    UNIQUE(github_repo_id, github_issue_number)
);

CREATE INDEX IF NOT EXISTS idx_gh_issue_links_issue ON github_issue_links(issue_id);
CREATE INDEX IF NOT EXISTS idx_gh_issue_links_gh ON github_issue_links(github_repo_id, github_issue_number);

-- ═══════════════════════════════════════════════════════
-- PR Links (PRs linked to Baaton issues)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_pr_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL,
    
    pr_number INT NOT NULL,
    pr_id BIGINT NOT NULL,
    pr_title TEXT NOT NULL,
    pr_url TEXT NOT NULL,
    pr_state TEXT NOT NULL DEFAULT 'open'
        CHECK (pr_state IN ('open', 'closed', 'merged', 'draft')),
    
    head_branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    
    author_login TEXT NOT NULL,
    author_id BIGINT,
    
    additions INT DEFAULT 0,
    deletions INT DEFAULT 0,
    changed_files INT DEFAULT 0,
    
    review_status TEXT DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'changes_requested', 'commented')),
    
    merged_at TIMESTAMPTZ,
    merged_by TEXT,
    
    link_method TEXT NOT NULL DEFAULT 'branch_name'
        CHECK (link_method IN ('branch_name', 'pr_body', 'commit_message', 'manual')),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(github_repo_id, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_gh_pr_links_issue ON github_pr_links(issue_id);
CREATE INDEX IF NOT EXISTS idx_gh_pr_links_state ON github_pr_links(pr_state);

-- ═══════════════════════════════════════════════════════
-- Commit Links (commits linked to issues)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_commit_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL,
    
    sha TEXT NOT NULL,
    message TEXT NOT NULL,
    author_login TEXT,
    author_email TEXT,
    committed_at TIMESTAMPTZ NOT NULL,
    url TEXT NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(github_repo_id, sha)
);

CREATE INDEX IF NOT EXISTS idx_gh_commit_links_issue ON github_commit_links(issue_id);

-- ═══════════════════════════════════════════════════════
-- Webhook Events Log (raw events for debugging/replay)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    delivery_id TEXT NOT NULL UNIQUE,
    
    event_type TEXT NOT NULL,
    action TEXT,
    
    installation_id BIGINT,
    repository_full_name TEXT,
    sender_login TEXT,
    
    payload JSONB NOT NULL,
    
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
    error_message TEXT,
    processed_at TIMESTAMPTZ,
    retry_count INT NOT NULL DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_events_status ON github_webhook_events(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_gh_events_delivery ON github_webhook_events(delivery_id);
CREATE INDEX IF NOT EXISTS idx_gh_events_type ON github_webhook_events(event_type, action);

-- ═══════════════════════════════════════════════════════
-- Sync Jobs Queue
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    job_type TEXT NOT NULL
        CHECK (job_type IN (
            'sync_issue_to_github',
            'sync_issue_from_github',
            'sync_pr',
            'sync_comment_to_github',
            'sync_comment_from_github',
            'sync_status',
            'initial_import',
            'full_resync'
        )),
    
    issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
    github_repo_id BIGINT,
    
    payload JSONB NOT NULL DEFAULT '{}',
    
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
    priority INT NOT NULL DEFAULT 0,
    
    max_retries INT NOT NULL DEFAULT 3,
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_sync_jobs_pending 
    ON github_sync_jobs(priority DESC, scheduled_at ASC) 
    WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════
-- Extend existing issues table
-- ═══════════════════════════════════════════════════════

-- Add 'github' as a valid source
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_source_check;
ALTER TABLE issues ADD CONSTRAINT issues_source_check 
    CHECK (source IN ('web', 'api', 'form', 'email', 'github'));

-- Track which side last modified (for conflict resolution)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS sync_source TEXT DEFAULT 'local';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS sync_lock_until TIMESTAMPTZ;
