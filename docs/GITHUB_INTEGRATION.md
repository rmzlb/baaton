# Baaton × GitHub Integration — Definitive Plan

> **Status**: Planning  
> **Author**: AI Architect  
> **Date**: 2026-02-09  
> **Version**: 1.0  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Research & Prior Art](#3-research--prior-art)
4. [GitHub App vs OAuth App](#4-github-app-vs-oauth-app)
5. [Database Migrations](#5-database-migrations)
6. [Backend Implementation](#6-backend-implementation)
7. [Webhook Handler](#7-webhook-handler)
8. [Sync Engine](#8-sync-engine)
9. [Frontend Components](#9-frontend-components)
10. [Status Mapping](#10-status-mapping)
11. [Security](#11-security)
12. [Edge Cases & Error Handling](#12-edge-cases--error-handling)
13. [Implementation Phases](#13-implementation-phases)
14. [Estimated Effort](#14-estimated-effort)

---

## 1. Executive Summary

Baaton's GitHub integration will enable **bidirectional synchronization** between Baaton projects and GitHub repositories. AI coding agents working on GitHub will have their work (PRs, commits, branches) automatically reflected in the Baaton board, and status changes in Baaton will be pushed back to GitHub.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | **GitHub App** (not OAuth App) | Fine-grained permissions, org-level install, installation tokens, built-in webhooks, higher rate limits |
| API crate | **octocrab 0.49+** | Mature, typed webhook payloads, GitHub App auth support, active maintenance |
| Sync direction | **Bidirectional** (configurable per project) | Maximum flexibility — uni or bi per mapping |
| Conflict resolution | **Last-write-wins + sync_source tracking** | Simple, predictable, auditable |
| Background jobs | **tokio tasks + pg-based job queue** | No external dependency (Redis/RabbitMQ), fits existing stack |
| Webhook processing | **Async via job queue** | Respond 200 immediately, process in background |

---

## 2. Architecture Overview

### System Architecture (ASCII)

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BAATON FRONTEND                           │
│                      (React 19 + Vite + Clerk)                      │
│                                                                     │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────────┐ │
│  │ Settings  │ │ Repo Mapping │ │ PR Badges  │ │ Commit Timeline  │ │
│  │ (GitHub)  │ │   Config     │ │ on Issues  │ │   on Issues      │ │
│  └─────┬────┘ └──────┬───────┘ └─────┬──────┘ └────────┬─────────┘ │
│        │              │               │                  │           │
└────────┼──────────────┼───────────────┼──────────────────┼───────────┘
         │              │               │                  │
         ▼              ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          BAATON API (Rust/Axum)                     │
│                         api.baaton.dev                               │
│                                                                     │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ GitHub Routes  │  │  Webhook     │  │  Sync Engine            │  │
│  │ /api/v1/gh/*   │  │  Handler     │  │  (Background Workers)   │  │
│  │                │  │  POST /wh/gh │  │                         │  │
│  │ - OAuth flow   │  │              │  │  - push_to_github()     │  │
│  │ - Repos list   │  │  - Verify    │  │  - pull_from_github()   │  │
│  │ - Mappings     │  │    HMAC      │  │  - resolve_conflicts()  │  │
│  │ - Status map   │  │  - Enqueue   │  │  - link_pr_to_issue()   │  │
│  └───────┬───────┘  └──────┬───────┘  └──────────┬──────────────┘  │
│          │                  │                      │                 │
│          ▼                  ▼                      ▼                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     PostgreSQL (Supabase)                    │   │
│  │                                                              │   │
│  │  github_installations  github_repo_mappings  github_events  │   │
│  │  github_pr_links       github_sync_log       sync_jobs      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│          │                                         │                │
└──────────┼─────────────────────────────────────────┼────────────────┘
           │                                         │
           ▼                                         ▼
┌──────────────────┐                    ┌──────────────────────┐
│   GitHub API     │◄───────────────────│   GitHub Webhooks    │
│   (REST/GraphQL) │                    │   (push events)      │
│                  │                    │                      │
│  octocrab 0.49+  │                    │  issues, pull_request│
│                  │                    │  push, installation  │
└──────────────────┘                    └──────────────────────┘
```

### Data Flow: Issue Created in Baaton → GitHub

```
User creates issue in Baaton
        │
        ▼
  issues::create() handler
        │
        ├─ Insert into `issues` table (source = 'web')
        │
        ▼
  Check: is project mapped to a GitHub repo?
        │
        YES ──► Enqueue sync job: SyncDirection::BaatonToGithub
                        │
                        ▼
                Background worker picks up job
                        │
                        ▼
                octocrab: create GitHub issue
                        │
                        ▼
                Store link in `github_issue_links`
                (baaton_issue_id ↔ github_issue_number)
```

### Data Flow: PR Opened on GitHub → Baaton

```
Developer opens PR on GitHub
    (branch: "BAA-42-fix-login-bug")
        │
        ▼
  GitHub sends pull_request.opened webhook
        │
        ▼
  POST /api/v1/webhooks/github
        │
        ├─ Verify HMAC-SHA256 signature
        ├─ Store raw event in `github_events`
        ├─ Respond HTTP 200 immediately
        │
        ▼
  Background worker processes event
        │
        ├─ Parse branch name → extract "BAA-42"
        ├─ Parse PR body → look for "fixes #", "closes #"
        ├─ Find matching Baaton issue by display_id
        │
        ▼
  Create entry in `github_pr_links`
        │
        ▼
  Apply status mapping: PR opened → issue moves to "in_progress"
        │
        ▼
  Update `issues` table, log in `activity_log`
```

---

## 3. Research & Prior Art

### How Linear Does It

**Architecture**: GitHub App with organization-level installation. Branch name contains Linear issue ID (e.g., `feat/LIN-123-add-auth`). PRs are linked bidirectionally via issue ID detection in branch names, PR titles, and PR bodies using "magic words" (fixes, closes, resolves).

**Key patterns we adopt**:
- Issue ID in branch name as primary linking mechanism
- Per-team workflow automations (PR opened → In Progress, PR merged → Done)
- Personal GitHub account connection for comment attribution
- Keyboard shortcut to copy `git checkout -b <branch-name>` — we'll add this

### How Plane Does It

**Architecture**: GitHub App with separate "Silo" service for integration logic. Uses label-based sync trigger — adding a "Plane" label to a GitHub issue syncs it to Plane, and vice versa.

**Sync properties**: Title, description, assignees (mapped), labels (auto-created), states (mapped open/closed to configurable statuses), comments (bidirectional with source attribution), mentions.

**Key patterns we adopt**:
- Configurable state mapping per project (not just global)
- Bidirectional/unidirectional toggle per repo mapping
- GitHub → Plane label as sync trigger (optional, we default to auto-sync)
- PR state mapping separate from issue state mapping

### How Huly Does It

**Architecture**: GitHub App with full two-way sync. Every issue created in the Huly project auto-creates in GitHub (unless explicitly opted out). Pull requests appear in a dedicated "Pull Requests" tab within the project.

**Key patterns we adopt**:
- PR tab/section within project view
- "Create issue without GitHub" override option
- Comment sync with source attribution

### Key Differences from All Three

Baaton's unique value: **AI agent orchestration**. Our integration must be deeply aware of:
- **TLDRs**: Agent work summaries linked to PRs
- **Agent identity**: Commits/PRs by AI agents should show agent name
- **Automated status flow**: Agent picks up issue → In Progress → opens PR → In Review → merges → Done — all automated
- **Multi-agent**: Multiple agents may work on the same issue (one for code, one for tests)

---

## 4. GitHub App vs OAuth App

### Decision: GitHub App ✅

| Criteria | GitHub App | OAuth App |
|----------|-----------|-----------|
| Permissions | Fine-grained (issues, PRs, repos separately) | Coarse scopes |
| Installation | Org-level, persists across users | Per-user, dies with user |
| Rate limits | 5,000 req/hr per installation (scales) | 5,000 req/hr per user (fixed) |
| Webhooks | Built-in, centralized | Must configure per-repo |
| Token type | Installation access tokens (1hr, auto-refresh) | OAuth tokens (long-lived, revocable) |
| Best for | Integrations, bots, CI/CD | User impersonation |

### GitHub App Registration

**App Name**: `Baaton` (or `Baaton Dev` for staging)

**Homepage URL**: `https://baaton.dev`

**Callback URL**: `https://api.baaton.dev/api/v1/github/callback`

**Setup URL (post-install)**: `https://api.baaton.dev/api/v1/github/setup`

**Webhook URL**: `https://api.baaton.dev/api/v1/webhooks/github`

### Permissions Required

#### Repository Permissions

| Permission | Access | Purpose |
|-----------|--------|---------|
| **Issues** | Read & Write | Create/update/close issues, read issue data |
| **Pull requests** | Read & Write | Read PR data, post comments, update PR body |
| **Contents** | Read-only | Read file contents for TLDR context |
| **Metadata** | Read-only | List repos, read repo metadata |
| **Commit statuses** | Read-only | Read CI status for PR badges |

#### Account Permissions

| Permission | Access | Purpose |
|-----------|--------|---------|
| **Email addresses** | Read-only | Match GitHub users to Baaton members |

#### Webhook Events to Subscribe

| Event | Purpose |
|-------|---------|
| `installation` | Track app install/uninstall |
| `installation_repositories` | Track added/removed repos |
| `issues` | Sync issue CRUD, state changes |
| `issue_comment` | Sync comments bidirectionally |
| `pull_request` | PR opened/closed/merged/review_requested |
| `pull_request_review` | Track review approvals/changes |
| `push` | Link commits to issues via message parsing |

### Token Flow

```
1. Org admin clicks "Connect GitHub" in Baaton settings
2. Redirect to: https://github.com/apps/baaton/installations/new
3. User selects org, chooses repos (all or specific)
4. GitHub redirects to our callback URL with:
   - installation_id
   - setup_action (install/update)
5. Backend:
   a. Exchange code for user access token (optional, for user attribution)
   b. Store installation_id in github_installations table
   c. Generate installation access token via JWT + private key
   d. Cache token (expires in 1hr, auto-refresh)
```

### Token Management

```rust
// Installation access token generation (pseudocode)
async fn get_installation_token(installation_id: u64) -> Result<String> {
    // 1. Check cache (token valid for ~55 min)
    if let Some(cached) = token_cache.get(installation_id) {
        if cached.expires_at > Utc::now() + Duration::minutes(5) {
            return Ok(cached.token);
        }
    }
    
    // 2. Generate JWT from app private key
    let jwt = create_app_jwt(&app_private_key, app_id)?;
    
    // 3. Exchange JWT for installation token
    let token = octocrab::Octocrab::builder()
        .app(app_id.into(), app_private_key.clone())
        .build()?
        .installation(installation_id.into())
        .token()?;
    
    // 4. Cache and return
    token_cache.insert(installation_id, token.clone());
    Ok(token)
}
```

---

## 5. Database Migrations

### Migration 006: GitHub Integration

```sql
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
    
    -- App credentials
    -- Private key stored in env var, not DB
    -- Installation access token is ephemeral (1hr), cached in memory
    
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
-- Maps Clerk user_id to GitHub user for personal actions
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_user_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,  -- Clerk user_id
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    github_user_id BIGINT NOT NULL,
    github_username TEXT NOT NULL,
    github_email TEXT,
    
    -- OAuth token for user-level actions (comments as user)
    access_token_encrypted TEXT,  -- encrypted at rest
    
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
    full_name TEXT NOT NULL,  -- "owner/name"
    default_branch TEXT NOT NULL DEFAULT 'main',
    is_private BOOLEAN NOT NULL DEFAULT false,
    
    -- Last sync metadata
    last_synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gh_repos_install ON github_repositories(installation_id);
CREATE INDEX IF NOT EXISTS idx_gh_repos_fullname ON github_repositories(full_name);

-- ═══════════════════════════════════════════════════════
-- Repo ↔ Project Mappings (the core link)
-- One Baaton project can map to multiple repos
-- One repo can only map to one project
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_repo_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL REFERENCES github_repositories(github_repo_id) ON DELETE CASCADE,
    
    -- Sync configuration
    sync_direction TEXT NOT NULL DEFAULT 'bidirectional'
        CHECK (sync_direction IN ('github_to_baaton', 'baaton_to_github', 'bidirectional')),
    
    -- What to sync
    sync_issues BOOLEAN NOT NULL DEFAULT true,
    sync_prs BOOLEAN NOT NULL DEFAULT true,
    sync_comments BOOLEAN NOT NULL DEFAULT true,
    auto_create_issues BOOLEAN NOT NULL DEFAULT false,  -- auto-create GitHub issues for Baaton issues
    
    -- Status mapping (JSON object: { "pr_opened": "in_progress", "pr_merged": "done", ... })
    status_mapping JSONB NOT NULL DEFAULT '{
        "issue_opened": "todo",
        "issue_closed": "done",
        "pr_opened": "in_progress",
        "pr_merged": "done",
        "pr_closed": null
    }',
    
    -- Active/paused
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(github_repo_id)  -- one repo → one project
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
    
    -- Track sync state
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
-- One issue can have multiple PRs
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_pr_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    github_repo_id BIGINT NOT NULL,
    
    -- PR data
    pr_number INT NOT NULL,
    pr_id BIGINT NOT NULL,
    pr_title TEXT NOT NULL,
    pr_url TEXT NOT NULL,
    pr_state TEXT NOT NULL DEFAULT 'open'
        CHECK (pr_state IN ('open', 'closed', 'merged', 'draft')),
    
    -- Branch info
    head_branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    
    -- Author
    author_login TEXT NOT NULL,
    author_id BIGINT,
    
    -- Stats (updated on sync)
    additions INT DEFAULT 0,
    deletions INT DEFAULT 0,
    changed_files INT DEFAULT 0,
    
    -- Review status
    review_status TEXT DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'changes_requested', 'commented')),
    
    -- Merge info
    merged_at TIMESTAMPTZ,
    merged_by TEXT,
    
    -- Link type: how was this PR linked?
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
    
    -- GitHub delivery ID for idempotency
    delivery_id TEXT NOT NULL UNIQUE,
    
    -- Event metadata
    event_type TEXT NOT NULL,  -- "issues", "pull_request", "push", etc.
    action TEXT,               -- "opened", "closed", "synchronize", etc.
    
    -- Source
    installation_id BIGINT,
    repository_full_name TEXT,
    sender_login TEXT,
    
    -- Payload (full JSON)
    payload JSONB NOT NULL,
    
    -- Processing status
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
-- Sync Jobs Queue (simple pg-based job queue)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Job type
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
    
    -- References
    issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
    github_repo_id BIGINT,
    
    -- Job payload (varies by type)
    payload JSONB NOT NULL DEFAULT '{}',
    
    -- Scheduling
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
    priority INT NOT NULL DEFAULT 0,  -- higher = more urgent
    
    -- Retry logic
    max_retries INT NOT NULL DEFAULT 3,
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    
    -- Timing
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
```

---

## 6. Backend Implementation

### New Cargo Dependencies

Add to `backend/Cargo.toml`:

```toml
# GitHub integration
octocrab = { version = "0.49", features = ["default"] }
jsonwebtoken = "9"
hmac = "0.12"
sha2 = "0.10"    # already present
hex = "0.4"

# Background job processing
tokio-cron-scheduler = "0.10"  # optional, for periodic sync

# Encryption for stored tokens
aes-gcm = "0.10"
```

### New Module Structure

```
backend/src/
├── routes/
│   ├── mod.rs              # Add github routes
│   ├── github/
│   │   ├── mod.rs          # GitHub route module
│   │   ├── oauth.rs        # OAuth flow handlers
│   │   ├── repos.rs        # Repository listing & mapping
│   │   ├── settings.rs     # Integration settings
│   │   └── webhooks.rs     # Webhook receiver
│   └── ... (existing)
├── github/
│   ├── mod.rs              # GitHub module root
│   ├── client.rs           # Octocrab client wrapper + token management
│   ├── sync.rs             # Sync engine (bidirectional)
│   ├── webhook_processor.rs # Webhook event processing logic
│   ├── issue_linker.rs     # Branch/PR/commit → issue matching
│   ├── status_mapper.rs    # Status mapping logic
│   └── jobs.rs             # Background job runner
├── models/
│   ├── mod.rs              # Existing models
│   └── github.rs           # GitHub-specific models
└── ... (existing)
```

### Backend API Routes

Add to `routes/mod.rs`:

```rust
mod github;

pub fn api_router(pool: PgPool) -> Router {
    let routes = Router::new()
        // ... existing routes ...
        
        // ── GitHub Integration ──
        // OAuth / Installation flow
        .route("/github/install", get(github::oauth::install_redirect))
        .route("/github/callback", get(github::oauth::callback))
        .route("/github/user/connect", get(github::oauth::user_connect))
        .route("/github/user/callback", get(github::oauth::user_callback))
        .route("/github/disconnect", post(github::oauth::disconnect))
        
        // Repository management
        .route("/github/repos", get(github::repos::list_available))
        .route("/github/installation", get(github::settings::get_installation))
        
        // Repo ↔ Project mappings
        .route("/github/mappings", get(github::repos::list_mappings).post(github::repos::create_mapping))
        .route("/github/mappings/{id}", patch(github::repos::update_mapping).delete(github::repos::delete_mapping))
        
        // Issue-level GitHub data
        .route("/issues/{id}/github", get(github::repos::get_issue_github_data))
        .route("/issues/{id}/github/link", post(github::repos::link_issue_to_github))
        
        // Webhook endpoint (public, no auth — uses HMAC verification)
        .route("/webhooks/github", post(github::webhooks::handle))
        
        .with_state(pool);
    
    routes.layer(axum_mw::from_fn(auth_middleware))
}
```

### Complete Route Reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/github/install` | Clerk JWT | Redirect user to GitHub App installation page |
| `GET` | `/github/callback` | Cookie/Query | Handle post-installation redirect from GitHub |
| `GET` | `/github/user/connect` | Clerk JWT | Start personal GitHub OAuth flow |
| `GET` | `/github/user/callback` | Cookie/Query | Handle personal OAuth callback |
| `POST` | `/github/disconnect` | Clerk JWT (admin) | Remove GitHub installation for org |
| `GET` | `/github/installation` | Clerk JWT | Get installation status & metadata |
| `GET` | `/github/repos` | Clerk JWT | List available repos from GitHub installation |
| `GET` | `/github/mappings` | Clerk JWT | List all repo↔project mappings for org |
| `POST` | `/github/mappings` | Clerk JWT (admin) | Create new repo↔project mapping |
| `PATCH` | `/github/mappings/{id}` | Clerk JWT (admin) | Update mapping config (sync direction, status map) |
| `DELETE` | `/github/mappings/{id}` | Clerk JWT (admin) | Remove mapping |
| `GET` | `/issues/{id}/github` | Clerk JWT | Get linked PRs, commits, GitHub issue for a Baaton issue |
| `POST` | `/issues/{id}/github/link` | Clerk JWT | Manually link a Baaton issue to a GitHub issue |
| `POST` | `/webhooks/github` | HMAC-SHA256 | Receive webhook events from GitHub |

### GitHub Client Wrapper

```rust
// backend/src/github/client.rs

use octocrab::{Octocrab, models::InstallationId};
use jsonwebtoken::{encode, EncodingKey, Header, Algorithm};
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

pub struct GitHubClient {
    app_id: u64,
    private_key: EncodingKey,
    // Cache: installation_id → (token, expires_at)
    token_cache: Arc<RwLock<HashMap<u64, (String, chrono::DateTime<chrono::Utc>)>>>,
}

impl GitHubClient {
    pub fn new(app_id: u64, private_key_pem: &[u8]) -> Result<Self, anyhow::Error> {
        Ok(Self {
            app_id,
            private_key: EncodingKey::from_rsa_pem(private_key_pem)?,
            token_cache: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    /// Get an authenticated Octocrab instance for a specific installation
    pub async fn for_installation(&self, installation_id: u64) -> Result<Octocrab, anyhow::Error> {
        // Check cache first
        {
            let cache = self.token_cache.read().await;
            if let Some((token, expires)) = cache.get(&installation_id) {
                if *expires > chrono::Utc::now() + chrono::Duration::minutes(5) {
                    return Octocrab::builder()
                        .personal_token(token.clone())
                        .build()
                        .map_err(Into::into);
                }
            }
        }
        
        // Generate new token
        let app_crab = Octocrab::builder()
            .app(
                self.app_id.into(),
                self.private_key.clone(),
            )
            .build()?;
        
        let installation = InstallationId(installation_id);
        let token = app_crab
            .installation_and_token(installation)
            .await?;
        
        // Cache it
        let expires = chrono::Utc::now() + chrono::Duration::minutes(55);
        {
            let mut cache = self.token_cache.write().await;
            cache.insert(installation_id, (token.1.clone(), expires));
        }
        
        Octocrab::builder()
            .personal_token(token.1)
            .build()
            .map_err(Into::into)
    }
}
```

### Models

```rust
// backend/src/models/github.rs

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubInstallation {
    pub id: Uuid,
    pub org_id: String,
    pub installation_id: i64,
    pub github_account_id: i64,
    pub github_account_login: String,
    pub github_account_type: String,
    pub permissions: serde_json::Value,
    pub status: String,
    pub installed_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubRepository {
    pub id: Uuid,
    pub installation_id: i64,
    pub github_repo_id: i64,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: String,
    pub is_private: bool,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubRepoMapping {
    pub id: Uuid,
    pub project_id: Uuid,
    pub github_repo_id: i64,
    pub sync_direction: String,
    pub sync_issues: bool,
    pub sync_prs: bool,
    pub sync_comments: bool,
    pub auto_create_issues: bool,
    pub status_mapping: serde_json::Value,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubPrLink {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub github_repo_id: i64,
    pub pr_number: i32,
    pub pr_id: i64,
    pub pr_title: String,
    pub pr_url: String,
    pub pr_state: String,
    pub head_branch: String,
    pub base_branch: String,
    pub author_login: String,
    pub author_id: Option<i64>,
    pub additions: Option<i32>,
    pub deletions: Option<i32>,
    pub changed_files: Option<i32>,
    pub review_status: Option<String>,
    pub merged_at: Option<DateTime<Utc>>,
    pub merged_by: Option<String>,
    pub link_method: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubCommitLink {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub github_repo_id: i64,
    pub sha: String,
    pub message: String,
    pub author_login: Option<String>,
    pub author_email: Option<String>,
    pub committed_at: DateTime<Utc>,
    pub url: String,
    pub created_at: DateTime<Utc>,
}

/// Data returned for an issue's GitHub sidebar
#[derive(Debug, Serialize)]
pub struct IssueGitHubData {
    pub github_issue: Option<GitHubIssueLink>,
    pub pull_requests: Vec<GitHubPrLink>,
    pub commits: Vec<GitHubCommitLink>,
    pub branch_name: String,  // suggested branch name
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubIssueLink {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub github_repo_id: i64,
    pub github_issue_number: i32,
    pub github_issue_id: i64,
    pub sync_status: String,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Request to create a repo mapping
#[derive(Debug, Deserialize)]
pub struct CreateRepoMapping {
    pub project_id: Uuid,
    pub github_repo_id: i64,
    pub sync_direction: Option<String>,
    pub sync_issues: Option<bool>,
    pub sync_prs: Option<bool>,
    pub sync_comments: Option<bool>,
    pub auto_create_issues: Option<bool>,
    pub status_mapping: Option<serde_json::Value>,
}

/// Request to update a repo mapping
#[derive(Debug, Deserialize)]
pub struct UpdateRepoMapping {
    pub sync_direction: Option<String>,
    pub sync_issues: Option<bool>,
    pub sync_prs: Option<bool>,
    pub sync_comments: Option<bool>,
    pub auto_create_issues: Option<bool>,
    pub status_mapping: Option<serde_json::Value>,
    pub is_active: Option<bool>,
}
```

---

## 7. Webhook Handler

### Webhook Verification

```rust
// backend/src/routes/github/webhooks.rs

use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
    Json,
    extract::State,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;

type HmacSha256 = Hmac<Sha256>;

/// POST /api/v1/webhooks/github
/// 
/// This endpoint does NOT use Clerk auth middleware.
/// It uses GitHub's HMAC-SHA256 webhook signature for verification.
///
/// Flow:
/// 1. Verify X-Hub-Signature-256 header
/// 2. Check X-GitHub-Delivery for idempotency
/// 3. Store raw event
/// 4. Respond 200 immediately
/// 5. Process asynchronously via job queue
pub async fn handle(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, StatusCode> {
    // 1. Extract headers
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    
    let event_type = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::BAD_REQUEST)?
        .to_string();
    
    let delivery_id = headers
        .get("x-github-delivery")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::BAD_REQUEST)?
        .to_string();
    
    // 2. Verify HMAC-SHA256 signature
    let webhook_secret = std::env::var("GITHUB_WEBHOOK_SECRET")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    verify_signature(&body, &webhook_secret, signature)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    
    // 3. Idempotency check
    let exists: Option<(bool,)> = sqlx::query_as(
        "SELECT true FROM github_webhook_events WHERE delivery_id = $1"
    )
    .bind(&delivery_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if exists.is_some() {
        // Already processed, return 200 (idempotent)
        return Ok(StatusCode::OK);
    }
    
    // 4. Parse payload
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    
    let action = payload.get("action")
        .and_then(|v| v.as_str())
        .map(String::from);
    
    let installation_id = payload
        .get("installation")
        .and_then(|i| i.get("id"))
        .and_then(|v| v.as_i64());
    
    let repo_full_name = payload
        .get("repository")
        .and_then(|r| r.get("full_name"))
        .and_then(|v| v.as_str())
        .map(String::from);
    
    let sender = payload
        .get("sender")
        .and_then(|s| s.get("login"))
        .and_then(|v| v.as_str())
        .map(String::from);
    
    // 5. Store raw event
    sqlx::query(
        r#"INSERT INTO github_webhook_events 
           (delivery_id, event_type, action, installation_id, 
            repository_full_name, sender_login, payload, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')"#
    )
    .bind(&delivery_id)
    .bind(&event_type)
    .bind(&action)
    .bind(installation_id)
    .bind(&repo_full_name)
    .bind(&sender)
    .bind(&payload)
    .execute(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    // 6. Enqueue for async processing (non-blocking)
    let pool_clone = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = process_webhook_event(&pool_clone, &delivery_id).await {
            tracing::error!("Webhook processing failed for {}: {}", delivery_id, e);
        }
    });
    
    // 7. Respond immediately
    Ok(StatusCode::OK)
}

fn verify_signature(body: &[u8], secret: &str, signature: &str) -> Result<(), ()> {
    let signature = signature.strip_prefix("sha256=").ok_or(())?;
    let signature_bytes = hex::decode(signature).map_err(|_| ())?;
    
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| ())?;
    mac.update(body);
    
    mac.verify_slice(&signature_bytes).map_err(|_| ())
}
```

### Webhook Event Processing

```rust
// backend/src/github/webhook_processor.rs

/// Process a webhook event by delivery_id
pub async fn process_webhook_event(pool: &PgPool, delivery_id: &str) -> Result<()> {
    // Mark as processing
    sqlx::query(
        "UPDATE github_webhook_events SET status = 'processing' WHERE delivery_id = $1"
    )
    .bind(delivery_id)
    .execute(pool)
    .await?;
    
    // Fetch the event
    let event = sqlx::query_as::<_, WebhookEvent>(
        "SELECT * FROM github_webhook_events WHERE delivery_id = $1"
    )
    .bind(delivery_id)
    .fetch_one(pool)
    .await?;
    
    let result = match event.event_type.as_str() {
        "installation" => handle_installation_event(pool, &event).await,
        "installation_repositories" => handle_installation_repos_event(pool, &event).await,
        "issues" => handle_issues_event(pool, &event).await,
        "issue_comment" => handle_issue_comment_event(pool, &event).await,
        "pull_request" => handle_pull_request_event(pool, &event).await,
        "pull_request_review" => handle_pr_review_event(pool, &event).await,
        "push" => handle_push_event(pool, &event).await,
        _ => {
            tracing::debug!("Ignoring unhandled event type: {}", event.event_type);
            Ok(())
        }
    };
    
    match result {
        Ok(()) => {
            sqlx::query(
                "UPDATE github_webhook_events SET status = 'completed', processed_at = now() WHERE delivery_id = $1"
            )
            .bind(delivery_id)
            .execute(pool)
            .await?;
        }
        Err(e) => {
            let retry_count = event.retry_count + 1;
            let new_status = if retry_count >= 3 { "failed" } else { "pending" };
            
            sqlx::query(
                "UPDATE github_webhook_events SET status = $2, error_message = $3, retry_count = $4 WHERE delivery_id = $1"
            )
            .bind(delivery_id)
            .bind(new_status)
            .bind(e.to_string())
            .bind(retry_count)
            .execute(pool)
            .await?;
        }
    }
    
    Ok(())
}
```

### Event Handlers

#### Installation Events

```rust
async fn handle_installation_event(pool: &PgPool, event: &WebhookEvent) -> Result<()> {
    let action = event.action.as_deref().unwrap_or("");
    let payload = &event.payload;
    
    match action {
        "created" => {
            // New installation — store it
            let installation = &payload["installation"];
            let account = &installation["account"];
            
            sqlx::query(
                r#"INSERT INTO github_installations 
                   (installation_id, org_id, github_account_id, github_account_login, 
                    github_account_type, permissions, status)
                   VALUES ($1, $2, $3, $4, $5, $6, 'active')
                   ON CONFLICT (installation_id) DO UPDATE SET
                    status = 'active', updated_at = now()"#
            )
            .bind(installation["id"].as_i64().unwrap())
            // org_id will be set during the callback flow
            .bind("pending") // temporary, updated in callback
            .bind(account["id"].as_i64().unwrap())
            .bind(account["login"].as_str().unwrap())
            .bind(account["type"].as_str().unwrap_or("Organization"))
            .bind(&installation["permissions"])
            .execute(pool)
            .await?;
            
            // Also cache repo list
            if let Some(repos) = payload["repositories"].as_array() {
                for repo in repos {
                    upsert_repository(pool, event.installation_id.unwrap(), repo).await?;
                }
            }
        }
        "deleted" => {
            // Installation removed
            let installation_id = payload["installation"]["id"].as_i64().unwrap();
            sqlx::query(
                "UPDATE github_installations SET status = 'removed', updated_at = now() WHERE installation_id = $1"
            )
            .bind(installation_id)
            .execute(pool)
            .await?;
        }
        "suspend" => {
            let installation_id = payload["installation"]["id"].as_i64().unwrap();
            sqlx::query(
                "UPDATE github_installations SET status = 'suspended', updated_at = now() WHERE installation_id = $1"
            )
            .bind(installation_id)
            .execute(pool)
            .await?;
        }
        "unsuspend" => {
            let installation_id = payload["installation"]["id"].as_i64().unwrap();
            sqlx::query(
                "UPDATE github_installations SET status = 'active', updated_at = now() WHERE installation_id = $1"
            )
            .bind(installation_id)
            .execute(pool)
            .await?;
        }
        _ => {}
    }
    
    Ok(())
}
```

#### Pull Request Events (the most important for AI agents)

```rust
async fn handle_pull_request_event(pool: &PgPool, event: &WebhookEvent) -> Result<()> {
    let action = event.action.as_deref().unwrap_or("");
    let payload = &event.payload;
    let pr = &payload["pull_request"];
    let repo = &payload["repository"];
    
    let github_repo_id = repo["id"].as_i64().unwrap();
    let pr_number = pr["number"].as_i64().unwrap() as i32;
    
    // Find the repo mapping
    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        "SELECT * FROM github_repo_mappings WHERE github_repo_id = $1 AND is_active = true"
    )
    .bind(github_repo_id)
    .fetch_optional(pool)
    .await?;
    
    let mapping = match mapping {
        Some(m) if m.sync_prs => m,
        _ => return Ok(()), // No active mapping for this repo, skip
    };
    
    // Extract branch name and try to find linked issue
    let head_branch = pr["head"]["ref"].as_str().unwrap_or("");
    let pr_body = pr["body"].as_str().unwrap_or("");
    let pr_title = pr["title"].as_str().unwrap_or("");
    
    // Try to find linked Baaton issue
    let issue_id = find_linked_issue(pool, &mapping, head_branch, pr_title, pr_body).await?;
    
    let issue_id = match issue_id {
        Some(id) => id,
        None => {
            tracing::debug!("PR #{} in {} has no linked Baaton issue", pr_number, repo["full_name"]);
            return Ok(());
        }
    };
    
    let pr_state = match (action, pr["merged"].as_bool()) {
        ("closed", Some(true)) => "merged",
        ("closed", _) => "closed",
        (_, _) if pr["draft"].as_bool().unwrap_or(false) => "draft",
        _ => "open",
    };
    
    // Upsert PR link
    sqlx::query(
        r#"INSERT INTO github_pr_links 
           (issue_id, github_repo_id, pr_number, pr_id, pr_title, pr_url,
            pr_state, head_branch, base_branch, author_login, author_id,
            additions, deletions, changed_files, link_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (github_repo_id, pr_number) DO UPDATE SET
            pr_title = $5, pr_state = $7, 
            additions = $12, deletions = $13, changed_files = $14,
            updated_at = now()"#
    )
    .bind(issue_id)
    .bind(github_repo_id)
    .bind(pr_number)
    .bind(pr["id"].as_i64().unwrap())
    .bind(pr_title)
    .bind(pr["html_url"].as_str().unwrap_or(""))
    .bind(pr_state)
    .bind(head_branch)
    .bind(pr["base"]["ref"].as_str().unwrap_or("main"))
    .bind(pr["user"]["login"].as_str().unwrap_or("unknown"))
    .bind(pr["user"]["id"].as_i64())
    .bind(pr["additions"].as_i64().map(|v| v as i32))
    .bind(pr["deletions"].as_i64().map(|v| v as i32))
    .bind(pr["changed_files"].as_i64().map(|v| v as i32))
    .bind("branch_name")  // could be refined based on detection method
    .execute(pool)
    .await?;
    
    // Apply status mapping
    let status_mapping: serde_json::Value = mapping.status_mapping;
    let mapping_key = match pr_state {
        "open" | "draft" => "pr_opened",
        "merged" => "pr_merged",
        "closed" => "pr_closed",
        _ => return Ok(()),
    };
    
    if let Some(new_status) = status_mapping.get(mapping_key).and_then(|v| v.as_str()) {
        // Update issue status (with sync lock to prevent echo)
        sqlx::query(
            r#"UPDATE issues SET 
                status = $2, 
                sync_source = 'github',
                sync_lock_until = now() + interval '5 seconds',
                updated_at = now()
               WHERE id = $1 AND sync_lock_until IS NULL OR sync_lock_until < now()"#
        )
        .bind(issue_id)
        .bind(new_status)
        .execute(pool)
        .await?;
        
        // Log activity
        sqlx::query(
            r#"INSERT INTO activity_log (issue_id, actor_name, action, details)
               VALUES ($1, $2, 'status_changed', $3)"#
        )
        .bind(issue_id)
        .bind(format!("GitHub ({})", pr["user"]["login"].as_str().unwrap_or("bot")))
        .bind(serde_json::json!({
            "from_github": true,
            "pr_number": pr_number,
            "pr_state": pr_state,
            "new_status": new_status
        }))
        .execute(pool)
        .await?;
    }
    
    // Handle merged PR: check for review status
    if action == "closed" && pr["merged"].as_bool() == Some(true) {
        // Update merged metadata
        sqlx::query(
            "UPDATE github_pr_links SET merged_at = $2, merged_by = $3 WHERE github_repo_id = $4 AND pr_number = $5"
        )
        .bind(issue_id)
        .bind(pr["merged_at"].as_str())
        .bind(pr["merged_by"]["login"].as_str())
        .bind(github_repo_id)
        .bind(pr_number)
        .execute(pool)
        .await?;
    }
    
    Ok(())
}
```

### Issue Linker — Parsing Branch Names, PR Bodies, Commit Messages

```rust
// backend/src/github/issue_linker.rs

use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    // Match patterns like "BAA-42", "PROJ-123", etc.
    static ref ISSUE_ID_REGEX: Regex = Regex::new(
        r"(?i)([A-Z]{2,10})-(\d+)"
    ).unwrap();
    
    // Match "fixes #123", "closes #456", "resolves #789"
    static ref GITHUB_CLOSE_REGEX: Regex = Regex::new(
        r"(?i)(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)"
    ).unwrap();
    
    // Match branch name patterns: "feature/BAA-42-description" or "BAA-42/description"
    static ref BRANCH_ISSUE_REGEX: Regex = Regex::new(
        r"(?i)(?:^|/)([A-Z]{2,10}-\d+)"
    ).unwrap();
}

/// Try to find the linked Baaton issue from various sources
pub async fn find_linked_issue(
    pool: &PgPool,
    mapping: &GitHubRepoMapping,
    branch_name: &str,
    pr_title: &str,
    pr_body: &str,
) -> Result<Option<Uuid>> {
    // Priority order:
    // 1. Branch name (most reliable)
    // 2. PR title
    // 3. PR body (fixes/closes keywords)
    
    // 1. Check branch name
    if let Some(cap) = BRANCH_ISSUE_REGEX.captures(branch_name) {
        let display_id = cap.get(1).unwrap().as_str().to_uppercase();
        if let Some(issue) = find_issue_by_display_id(pool, mapping.project_id, &display_id).await? {
            return Ok(Some(issue));
        }
    }
    
    // 2. Check PR title
    for cap in ISSUE_ID_REGEX.captures_iter(pr_title) {
        let display_id = format!("{}-{}", 
            cap.get(1).unwrap().as_str().to_uppercase(),
            cap.get(2).unwrap().as_str()
        );
        if let Some(issue) = find_issue_by_display_id(pool, mapping.project_id, &display_id).await? {
            return Ok(Some(issue));
        }
    }
    
    // 3. Check PR body for "fixes/closes" patterns
    for cap in ISSUE_ID_REGEX.captures_iter(pr_body) {
        let display_id = format!("{}-{}", 
            cap.get(1).unwrap().as_str().to_uppercase(),
            cap.get(2).unwrap().as_str()
        );
        if let Some(issue) = find_issue_by_display_id(pool, mapping.project_id, &display_id).await? {
            return Ok(Some(issue));
        }
    }
    
    // 4. Check for GitHub issue number references ("fixes #42")
    for cap in GITHUB_CLOSE_REGEX.captures_iter(pr_body) {
        let gh_issue_number: i32 = cap.get(1).unwrap().as_str().parse().unwrap_or(0);
        if gh_issue_number > 0 {
            if let Some(issue) = find_issue_by_github_number(
                pool, mapping.github_repo_id, gh_issue_number
            ).await? {
                return Ok(Some(issue));
            }
        }
    }
    
    Ok(None)
}

async fn find_issue_by_display_id(
    pool: &PgPool,
    project_id: Uuid,
    display_id: &str,
) -> Result<Option<Uuid>> {
    let result: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM issues WHERE project_id = $1 AND display_id = $2"
    )
    .bind(project_id)
    .bind(display_id)
    .fetch_optional(pool)
    .await?;
    
    Ok(result.map(|r| r.0))
}

async fn find_issue_by_github_number(
    pool: &PgPool,
    github_repo_id: i64,
    github_issue_number: i32,
) -> Result<Option<Uuid>> {
    let result: Option<(Uuid,)> = sqlx::query_as(
        "SELECT issue_id FROM github_issue_links WHERE github_repo_id = $1 AND github_issue_number = $2"
    )
    .bind(github_repo_id)
    .bind(github_issue_number)
    .fetch_optional(pool)
    .await?;
    
    Ok(result.map(|r| r.0))
}

/// Generate a branch name for a Baaton issue
pub fn generate_branch_name(display_id: &str, title: &str) -> String {
    let slug = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>();
    
    // Collapse multiple dashes
    let slug = slug.split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    
    // Truncate to reasonable length
    let slug = if slug.len() > 50 { &slug[..50] } else { &slug };
    let slug = slug.trim_end_matches('-');
    
    format!("{}-{}", display_id.to_lowercase(), slug)
}
```

---

## 8. Sync Engine

### Background Job Runner

```rust
// backend/src/github/jobs.rs

use std::time::Duration;
use sqlx::PgPool;

/// Start the background job processor
/// Runs in a tokio task, polls for pending jobs
pub async fn start_job_runner(pool: PgPool) {
    tracing::info!("GitHub sync job runner started");
    
    loop {
        match process_next_job(&pool).await {
            Ok(true) => {
                // Processed a job, check for more immediately
                continue;
            }
            Ok(false) => {
                // No pending jobs, wait before polling again
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(e) => {
                tracing::error!("Job runner error: {}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// Claim and process the next pending job (using SELECT FOR UPDATE SKIP LOCKED)
async fn process_next_job(pool: &PgPool) -> Result<bool> {
    // Atomic claim: prevents double-processing in multi-instance deployments
    let job: Option<SyncJob> = sqlx::query_as(
        r#"UPDATE github_sync_jobs SET 
            status = 'processing', started_at = now()
           WHERE id = (
               SELECT id FROM github_sync_jobs
               WHERE status = 'pending' AND scheduled_at <= now()
               ORDER BY priority DESC, scheduled_at ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
           )
           RETURNING *"#
    )
    .fetch_optional(pool)
    .await?;
    
    let job = match job {
        Some(j) => j,
        None => return Ok(false),
    };
    
    let result = match job.job_type.as_str() {
        "sync_issue_to_github" => sync_issue_to_github(pool, &job).await,
        "sync_issue_from_github" => sync_issue_from_github(pool, &job).await,
        "sync_pr" => sync_pr(pool, &job).await,
        "sync_comment_to_github" => sync_comment_to_github(pool, &job).await,
        "sync_comment_from_github" => sync_comment_from_github(pool, &job).await,
        "sync_status" => sync_status(pool, &job).await,
        "initial_import" => initial_import(pool, &job).await,
        "full_resync" => full_resync(pool, &job).await,
        _ => {
            tracing::warn!("Unknown job type: {}", job.job_type);
            Ok(())
        }
    };
    
    match result {
        Ok(()) => {
            sqlx::query(
                "UPDATE github_sync_jobs SET status = 'completed', completed_at = now() WHERE id = $1"
            )
            .bind(job.id)
            .execute(pool)
            .await?;
        }
        Err(e) => {
            let new_status = if job.retry_count + 1 >= job.max_retries {
                "dead"
            } else {
                "pending"
            };
            
            // Exponential backoff: 5s, 25s, 125s
            let backoff_secs = 5i64.pow((job.retry_count + 1) as u32);
            
            sqlx::query(
                r#"UPDATE github_sync_jobs SET 
                    status = $2, last_error = $3, retry_count = retry_count + 1,
                    scheduled_at = now() + ($4 || ' seconds')::interval
                   WHERE id = $1"#
            )
            .bind(job.id)
            .bind(new_status)
            .bind(e.to_string())
            .bind(backoff_secs.to_string())
            .execute(pool)
            .await?;
        }
    }
    
    Ok(true)
}
```

### Bidirectional Sync — Conflict Resolution

```rust
// backend/src/github/sync.rs

/// Sync a Baaton issue to GitHub
async fn sync_issue_to_github(pool: &PgPool, job: &SyncJob) -> Result<()> {
    let issue_id = job.issue_id.ok_or(anyhow::anyhow!("Missing issue_id"))?;
    
    let issue = sqlx::query_as::<_, Issue>(
        "SELECT * FROM issues WHERE id = $1"
    )
    .bind(issue_id)
    .fetch_one(pool)
    .await?;
    
    // Check sync lock (prevent echo loops)
    if let Some(lock_until) = issue.sync_lock_until {
        if lock_until > chrono::Utc::now() {
            tracing::debug!("Issue {} is sync-locked, skipping", issue.display_id);
            return Ok(());
        }
    }
    
    // Find the mapping
    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        "SELECT * FROM github_repo_mappings WHERE project_id = $1 AND is_active = true LIMIT 1"
    )
    .bind(issue.project_id)
    .fetch_optional(pool)
    .await?;
    
    let mapping = match mapping {
        Some(m) => m,
        None => return Ok(()), // No mapping, nothing to sync
    };
    
    // Check sync direction
    if mapping.sync_direction == "github_to_baaton" {
        return Ok(()); // One-way from GitHub, don't push
    }
    
    // Get GitHub client
    let installation = sqlx::query_as::<_, GitHubInstallation>(
        "SELECT * FROM github_installations WHERE installation_id = (SELECT installation_id FROM github_repositories WHERE github_repo_id = $1)"
    )
    .bind(mapping.github_repo_id)
    .fetch_one(pool)
    .await?;
    
    let gh_client = get_github_client()?;
    let octocrab = gh_client.for_installation(installation.installation_id as u64).await?;
    
    let repo = sqlx::query_as::<_, GitHubRepository>(
        "SELECT * FROM github_repositories WHERE github_repo_id = $1"
    )
    .bind(mapping.github_repo_id)
    .fetch_one(pool)
    .await?;
    
    // Check if already linked
    let existing_link = sqlx::query_as::<_, GitHubIssueLink>(
        "SELECT * FROM github_issue_links WHERE issue_id = $1"
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await?;
    
    match existing_link {
        Some(link) => {
            // Update existing GitHub issue
            octocrab.issues(&repo.owner, &repo.name)
                .update(link.github_issue_number as u64)
                .title(&issue.title)
                .body(issue.description.as_deref().unwrap_or(""))
                .send()
                .await?;
            
            // Map Baaton status to GitHub open/closed
            let gh_state = match issue.status.as_str() {
                "done" | "cancelled" => "closed",
                _ => "open",
            };
            
            // Update state if different
            octocrab.issues(&repo.owner, &repo.name)
                .update(link.github_issue_number as u64)
                .state(gh_state.parse()?)
                .send()
                .await?;
            
            // Update sync timestamp
            sqlx::query(
                "UPDATE github_issue_links SET last_synced_at = now(), sync_status = 'synced' WHERE id = $1"
            )
            .bind(link.id)
            .execute(pool)
            .await?;
        }
        None if mapping.auto_create_issues => {
            // Create new GitHub issue
            let gh_issue = octocrab.issues(&repo.owner, &repo.name)
                .create(&issue.title)
                .body(issue.description.as_deref().unwrap_or(""))
                .send()
                .await?;
            
            // Store link
            sqlx::query(
                r#"INSERT INTO github_issue_links 
                   (issue_id, github_repo_id, github_issue_number, github_issue_id, sync_status, last_synced_at)
                   VALUES ($1, $2, $3, $4, 'synced', now())"#
            )
            .bind(issue_id)
            .bind(mapping.github_repo_id)
            .bind(gh_issue.number as i32)
            .bind(gh_issue.id.0 as i64)
            .execute(pool)
            .await?;
        }
        None => {
            // No link and auto-create disabled, skip
        }
    }
    
    Ok(())
}

/// Anti-echo mechanism: when updating a Baaton issue from a GitHub webhook,
/// set a sync_lock_until timestamp. When the Baaton→GitHub sync fires,
/// it checks this lock and skips if still within the window.
/// 
/// Window: 5 seconds (accounts for propagation delay)
```

---

## 9. Frontend Components

### Component Tree

```
frontend/src/
├── components/
│   ├── github/
│   │   ├── GitHubConnectionStatus.tsx    # Shows connected/disconnected state
│   │   ├── GitHubInstallButton.tsx       # "Connect GitHub" button
│   │   ├── GitHubRepoSelector.tsx        # Multi-select repos to map
│   │   ├── GitHubRepoMappingCard.tsx     # One mapping card with config
│   │   ├── GitHubStatusMappingEditor.tsx # Configure status ↔ PR state mapping
│   │   ├── GitHubPrBadge.tsx             # PR badge shown on issue cards
│   │   ├── GitHubPrList.tsx              # List of PRs for an issue
│   │   ├── GitHubCommitTimeline.tsx      # Commits linked to an issue
│   │   ├── GitHubBranchCopy.tsx          # "Copy branch name" button
│   │   └── GitHubSyncIndicator.tsx       # Sync status indicator
│   ├── settings/
│   │   └── IntegrationsTab.tsx           # New tab in project/org settings
│   └── issues/
│       └── IssueDrawer.tsx               # MODIFIED — add GitHub sidebar section
├── hooks/
│   └── useApi.ts                         # MODIFIED — add github methods
└── lib/
    └── types.ts                          # MODIFIED — add GitHub types
```

### Key Component: GitHubPrBadge (on Kanban cards)

```tsx
// frontend/src/components/github/GitHubPrBadge.tsx

import { GitPullRequest, GitMerge, CircleDot, GitPullRequestClosed } from 'lucide-react';

interface Props {
  prs: GitHubPrLink[];
}

export function GitHubPrBadge({ prs }: Props) {
  if (prs.length === 0) return null;
  
  // Show the most relevant PR (latest, or merged)
  const pr = prs.find(p => p.pr_state === 'merged') 
    || prs.find(p => p.pr_state === 'open')
    || prs[0];
  
  const stateConfig = {
    open: { icon: GitPullRequest, color: 'text-green-500', bg: 'bg-green-500/10' },
    draft: { icon: CircleDot, color: 'text-gray-400', bg: 'bg-gray-500/10' },
    merged: { icon: GitMerge, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    closed: { icon: GitPullRequestClosed, color: 'text-red-500', bg: 'bg-red-500/10' },
  };
  
  const config = stateConfig[pr.pr_state] || stateConfig.open;
  const Icon = config.icon;
  
  return (
    <a
      href={pr.pr_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${config.bg} ${config.color} hover:opacity-80 transition-opacity`}
      title={`PR #${pr.pr_number}: ${pr.pr_title}`}
    >
      <Icon size={12} />
      <span>#{pr.pr_number}</span>
      {prs.length > 1 && (
        <span className="text-secondary">+{prs.length - 1}</span>
      )}
    </a>
  );
}
```

### Key Component: Issue GitHub Sidebar

```tsx
// Added to IssueDrawer.tsx — GitHub section

function GitHubSection({ issueId }: { issueId: string }) {
  const api = useApi();
  const { data, isLoading } = useQuery({
    queryKey: ['issue-github', issueId],
    queryFn: () => api.get<IssueGitHubData>(`/issues/${issueId}/github`),
  });
  
  if (isLoading || !data) return null;
  
  return (
    <div className="border-t border-border pt-4 mt-4">
      <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">
        <GitPullRequest size={12} className="inline mr-1" />
        GitHub
      </h3>
      
      {/* Branch name with copy button */}
      <div className="flex items-center gap-2 mb-3 p-2 rounded bg-surface-hover">
        <code className="text-xs text-primary font-mono truncate flex-1">
          {data.branch_name}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`git checkout -b ${data.branch_name}`);
          }}
          className="text-secondary hover:text-primary"
          title="Copy git checkout command"
        >
          <Copy size={14} />
        </button>
      </div>
      
      {/* Linked PRs */}
      {data.pull_requests.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-[10px] text-secondary uppercase">Pull Requests</p>
          {data.pull_requests.map(pr => (
            <a
              key={pr.id}
              href={pr.pr_url}
              target="_blank"
              className="flex items-center gap-2 p-2 rounded hover:bg-surface-hover transition-colors"
            >
              <PrStateIcon state={pr.pr_state} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary truncate">{pr.pr_title}</p>
                <p className="text-[10px] text-secondary">
                  #{pr.pr_number} • {pr.author_login} • 
                  +{pr.additions} -{pr.deletions}
                </p>
              </div>
              {pr.review_status === 'approved' && (
                <CheckCircle size={14} className="text-green-500" />
              )}
            </a>
          ))}
        </div>
      )}
      
      {/* Linked Commits */}
      {data.commits.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-secondary uppercase">Recent Commits</p>
          {data.commits.slice(0, 5).map(commit => (
            <a
              key={commit.sha}
              href={commit.url}
              target="_blank"
              className="flex items-center gap-2 p-1.5 rounded hover:bg-surface-hover"
            >
              <GitCommit size={12} className="text-secondary shrink-0" />
              <p className="text-xs text-primary truncate">{commit.message}</p>
              <code className="text-[10px] text-secondary font-mono shrink-0">
                {commit.sha.slice(0, 7)}
              </code>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Settings Flow: Integration Page

```tsx
// frontend/src/components/settings/IntegrationsTab.tsx

export function IntegrationsTab() {
  const api = useApi();
  const { data: installation } = useQuery({
    queryKey: ['github-installation'],
    queryFn: () => api.get<GitHubInstallation | null>('/github/installation'),
  });
  
  const { data: mappings = [] } = useQuery({
    queryKey: ['github-mappings'],
    queryFn: () => api.get<GitHubRepoMapping[]>('/github/mappings'),
    enabled: !!installation,
  });
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-primary">Integrations</h2>
        <p className="text-sm text-secondary mt-1">
          Connect external services to sync issues and pull requests.
        </p>
      </div>
      
      {/* GitHub Card */}
      <div className="border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <GitHubIcon size={24} />
          <div>
            <h3 className="font-semibold text-primary">GitHub</h3>
            <p className="text-xs text-secondary">
              Sync issues, PRs, and commits with your repositories
            </p>
          </div>
          <div className="ml-auto">
            {installation ? (
              <span className="flex items-center gap-1.5 text-xs text-green-500">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                Connected to @{installation.github_account_login}
              </span>
            ) : (
              <a
                href={`${API_URL}/api/v1/github/install`}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Connect GitHub
              </a>
            )}
          </div>
        </div>
        
        {installation && (
          <>
            {/* Repo Mappings */}
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-primary">Repository Mappings</h4>
                <AddMappingButton />
              </div>
              
              <div className="space-y-3">
                {mappings.map(mapping => (
                  <GitHubRepoMappingCard
                    key={mapping.id}
                    mapping={mapping}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

### Frontend Types Addition

```typescript
// Add to frontend/src/lib/types.ts

// ─── GitHub Integration ───────────────────────────────

export interface GitHubInstallation {
  id: string;
  org_id: string;
  installation_id: number;
  github_account_login: string;
  github_account_type: string;
  status: 'active' | 'suspended' | 'removed';
  created_at: string;
}

export interface GitHubRepository {
  id: string;
  github_repo_id: number;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  is_private: boolean;
}

export interface GitHubRepoMapping {
  id: string;
  project_id: string;
  github_repo_id: number;
  sync_direction: 'github_to_baaton' | 'baaton_to_github' | 'bidirectional';
  sync_issues: boolean;
  sync_prs: boolean;
  sync_comments: boolean;
  auto_create_issues: boolean;
  status_mapping: Record<string, string | null>;
  is_active: boolean;
  // Joined data
  repo?: GitHubRepository;
  project?: Project;
}

export interface GitHubPrLink {
  id: string;
  issue_id: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  pr_state: 'open' | 'closed' | 'merged' | 'draft';
  head_branch: string;
  base_branch: string;
  author_login: string;
  additions: number;
  deletions: number;
  changed_files: number;
  review_status: 'pending' | 'approved' | 'changes_requested' | 'commented';
  merged_at: string | null;
  link_method: string;
  created_at: string;
}

export interface GitHubCommitLink {
  id: string;
  issue_id: string;
  sha: string;
  message: string;
  author_login: string | null;
  committed_at: string;
  url: string;
}

export interface IssueGitHubData {
  github_issue: GitHubIssueLink | null;
  pull_requests: GitHubPrLink[];
  commits: GitHubCommitLink[];
  branch_name: string;
}

export interface GitHubIssueLink {
  id: string;
  issue_id: string;
  github_issue_number: number;
  sync_status: string;
  last_synced_at: string | null;
}
```

### useApi Extension

```typescript
// Add to frontend/src/hooks/useApi.ts

// ─── GitHub ────────────────────────────────
github: {
  getInstallation: async (): Promise<GitHubInstallation | null> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.get<GitHubInstallation | null>('/github/installation', token);
    }),

  listRepos: async (): Promise<GitHubRepository[]> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.get<GitHubRepository[]>('/github/repos', token);
    }),

  listMappings: async (): Promise<GitHubRepoMapping[]> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.get<GitHubRepoMapping[]>('/github/mappings', token);
    }),

  createMapping: async (body: {
    project_id: string;
    github_repo_id: number;
    sync_direction?: string;
  }): Promise<GitHubRepoMapping> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.post<GitHubRepoMapping>('/github/mappings', body, token);
    }),

  updateMapping: async (id: string, body: Partial<GitHubRepoMapping>): Promise<GitHubRepoMapping> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.patch<GitHubRepoMapping>(`/github/mappings/${id}`, body, token);
    }),

  deleteMapping: async (id: string): Promise<void> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.delete(`/github/mappings/${id}`, token);
    }),

  getIssueData: async (issueId: string): Promise<IssueGitHubData> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.get<IssueGitHubData>(`/issues/${issueId}/github`, token);
    }),

  disconnect: async (): Promise<void> =>
    withErrorHandling(async () => {
      const token = await getAuthToken();
      return api.post('/github/disconnect', {}, token);
    }),
},
```

---

## 10. Status Mapping

### Default Mapping

Every new repo mapping gets this default, which users can customize:

```json
{
  "issue_opened": "todo",
  "issue_closed": "done",
  "issue_reopened": "todo",
  "pr_opened": "in_progress",
  "pr_draft": null,
  "pr_ready_for_review": "in_review",
  "pr_review_approved": "in_review",
  "pr_merged": "done",
  "pr_closed": null
}
```

`null` means "don't change status for this event".

### Reverse Mapping (Baaton → GitHub)

| Baaton Status | GitHub Issue State | GitHub PR Action |
|---------------|-------------------|-----------------|
| `backlog` | open | — |
| `todo` | open | — |
| `in_progress` | open | — |
| `in_review` | open | — |
| `done` | closed (as completed) | — |
| `cancelled` | closed (as not planned) | — |

### Status Mapping Editor (Frontend)

The editor shows a grid of GitHub events → Baaton statuses, with dropdowns populated from the project's configured `statuses` array.

```
┌──────────────────────────────────────────────────┐
│  PR State Mapping                                │
│                                                  │
│  PR opened     → [ In Progress    ▼ ]           │
│  PR ready      → [ In Review      ▼ ]           │
│  PR approved   → [ In Review      ▼ ]           │
│  PR merged     → [ Done           ▼ ]           │
│  PR closed     → [ — Don't change ▼ ]           │
│                                                  │
│  Issue State Mapping                             │
│                                                  │
│  Issue opened  → [ Todo           ▼ ]           │
│  Issue closed  → [ Done           ▼ ]           │
│  Issue reopened→ [ Todo           ▼ ]           │
│                                                  │
│          [ Reset to Defaults ]  [ Save ]         │
└──────────────────────────────────────────────────┘
```

### AI Agent Flow (the killer feature)

```
Agent picks up issue BAA-42 from Baaton API
    │
    ├─ Agent creates branch: baa-42-implement-dark-mode
    │   (No status change yet — branch creation alone doesn't trigger)
    │
    ├─ Agent pushes commits
    │   push webhook → link commits to BAA-42
    │   
    ├─ Agent opens PR: "BAA-42: Implement dark mode"
    │   pull_request.opened → status mapping → "in_progress"
    │   
    ├─ Agent marks PR as ready for review
    │   pull_request.ready_for_review → "in_review"
    │   
    ├─ Human reviewer approves
    │   pull_request_review.submitted (approved) → stays "in_review"
    │   
    ├─ PR merged
    │   pull_request.closed (merged=true) → "done"
    │   
    └─ Baaton issue BAA-42 is now Done, with full PR trail
```

---

## 11. Security

### Token Storage

| Secret | Storage | Access Pattern |
|--------|---------|---------------|
| **App Private Key** | Environment variable (`GITHUB_APP_PRIVATE_KEY`) | Read once at startup, kept in memory |
| **Webhook Secret** | Environment variable (`GITHUB_WEBHOOK_SECRET`) | Read per webhook request |
| **App ID** | Environment variable (`GITHUB_APP_ID`) | Read once at startup |
| **Client ID** | Environment variable (`GITHUB_CLIENT_ID`) | Used in OAuth flows |
| **Client Secret** | Environment variable (`GITHUB_CLIENT_SECRET`) | Used in OAuth token exchange |
| **Installation tokens** | In-memory cache (1hr TTL) | Generated on-demand, never persisted to DB |
| **User OAuth tokens** | DB `github_user_connections.access_token_encrypted` | AES-256-GCM encrypted at rest |

### Encryption for User Tokens

```rust
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};

fn encrypt_token(token: &str, key: &[u8; 32]) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(b"unique nonce"); // In practice, generate random nonce
    let ciphertext = cipher.encrypt(nonce, token.as_bytes())?;
    Ok(base64::encode(ciphertext))
}

fn decrypt_token(encrypted: &str, key: &[u8; 32]) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(b"unique nonce");
    let ciphertext = base64::decode(encrypted)?;
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())?;
    Ok(String::from_utf8(plaintext)?)
}
```

### Webhook Security

1. **HMAC-SHA256 verification**: Every incoming webhook is verified against `X-Hub-Signature-256`
2. **Constant-time comparison**: Use `hmac.verify_slice()` which is timing-safe
3. **Idempotency**: `X-GitHub-Delivery` ID stored in DB, duplicates rejected
4. **Rate limiting**: Webhook endpoint has a separate rate limit (100 req/min per installation)
5. **Payload size limit**: Max 25MB (GitHub's limit), enforce in Axum with `RequestBodyLimitLayer`

### Webhook Endpoint: Auth Bypass

The webhook endpoint (`POST /api/v1/webhooks/github`) must bypass Clerk JWT auth. Update the middleware:

```rust
// In middleware/mod.rs - update auth_middleware
pub async fn auth_middleware(mut req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    
    // Skip auth for public routes, health checks, AND webhooks
    if path.contains("/public/") 
        || path == "/health" 
        || path.starts_with("/api/v1/webhooks/")  // NEW
        || path == "/api/v1/github/callback"       // NEW (OAuth callback)
        || path == "/api/v1/github/user/callback"  // NEW
    {
        return next.run(req).await;
    }
    // ... rest of middleware
}
```

### Multi-Tenant Isolation

- Every GitHub installation is scoped to an `org_id`
- Repo mappings are validated: the project must belong to the org that owns the installation
- Webhook events are routed via `installation_id` → `org_id` → correct tenant's data
- No cross-tenant data leakage possible

---

## 12. Edge Cases & Error Handling

### Rate Limits

| Token Type | Limit | Strategy |
|-----------|-------|----------|
| Installation tokens | 5,000/hr (scales with repos) | Track `X-RateLimit-Remaining`, back off at <100 |
| App JWT | 60/hr | Cache installation tokens, minimize JWT exchanges |
| User tokens | 5,000/hr | Only used for comment attribution, low volume |

```rust
// Rate limit tracking
async fn check_rate_limit(response: &reqwest::Response) -> bool {
    let remaining = response.headers()
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(1000);
    
    if remaining < 100 {
        let reset = response.headers()
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        
        let wait_secs = reset - chrono::Utc::now().timestamp();
        if wait_secs > 0 {
            tracing::warn!("Rate limit low ({}), waiting {}s", remaining, wait_secs);
            tokio::time::sleep(Duration::from_secs(wait_secs as u64)).await;
        }
    }
    
    remaining > 0
}
```

### Large Repositories

- **Initial import**: Paginate with GitHub's 100-per-page limit, process in batches
- **Many issues**: Only sync issues modified in last 30 days on initial sync (configurable)
- **Many PRs**: Index PRs on-demand (when webhook fires), not bulk import

### Deleted/Archived Repositories

```rust
// Handle repository deleted event
async fn handle_repo_deleted(pool: &PgPool, github_repo_id: i64) -> Result<()> {
    // Deactivate mapping (don't delete — preserve history)
    sqlx::query(
        "UPDATE github_repo_mappings SET is_active = false, updated_at = now() WHERE github_repo_id = $1"
    )
    .bind(github_repo_id)
    .execute(pool)
    .await?;
    
    // Mark repo as deleted
    sqlx::query(
        "DELETE FROM github_repositories WHERE github_repo_id = $1"
    )
    .bind(github_repo_id)
    .execute(pool)
    .await?;
    
    // PR/commit links remain for historical record
    // Issue links remain but sync_status → "disconnected"
    sqlx::query(
        "UPDATE github_issue_links SET sync_status = 'error' WHERE github_repo_id = $1"
    )
    .bind(github_repo_id)
    .execute(pool)
    .await?;
    
    Ok(())
}
```

### Revoked App Access

When the `installation.deleted` event fires:
1. Mark installation as `removed`
2. Deactivate all repo mappings for that org
3. Show "GitHub disconnected" banner in frontend
4. Preserve all historical data (PRs, commits, links)

### Webhook Delivery Failures

GitHub retries failed webhook deliveries (non-2xx responses) with exponential backoff:
- Retry 1: after 10 seconds
- Retry 2: after 60 seconds
- Retry 3: after 360 seconds
- After 3 failures: webhook is marked as failed in GitHub

Our strategy:
1. Always respond 200 immediately (process async)
2. If processing fails, store in `github_webhook_events` with `status = 'failed'`
3. Background worker retries failed events with our own backoff
4. After 3 retries, mark as `dead` — requires manual intervention
5. Admin endpoint to replay dead events: `POST /github/events/{id}/replay`

### Sync Loops Prevention

The "echo" problem: Baaton updates issue → pushes to GitHub → GitHub fires webhook → Baaton receives update → pushes to GitHub → ...

**Solution: Sync Lock**

```sql
-- On every sync from external source:
UPDATE issues SET 
    sync_source = 'github',
    sync_lock_until = now() + interval '5 seconds'
WHERE id = $1;

-- On every outgoing sync, check:
WHERE sync_lock_until IS NULL OR sync_lock_until < now()
```

The 5-second window is enough for the webhook round-trip to complete. After that, genuine user edits will sync normally.

---

## 13. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: GitHub App registration, OAuth flow, installation storage

- [ ] Register GitHub App (dev + production)
- [ ] Implement migration `006_github_integration.sql`
- [ ] Backend: GitHub client wrapper (`octocrab` + token management)
- [ ] Backend: OAuth flow routes (`/github/install`, `/github/callback`)
- [ ] Backend: Installation CRUD (`/github/installation`, `/github/disconnect`)
- [ ] Frontend: Integrations settings page with "Connect GitHub" button
- [ ] Frontend: Connection status display

**Dependencies**: None (standalone)  
**Deliverable**: User can connect their GitHub org to Baaton

### Phase 2: Repository Mapping (Week 2-3)

**Goal**: Link GitHub repos to Baaton projects

- [ ] Backend: List available repos from installation (`/github/repos`)
- [ ] Backend: CRUD for repo mappings (`/github/mappings`)
- [ ] Frontend: Repo selector component
- [ ] Frontend: Mapping configuration card (sync direction, toggles)
- [ ] Frontend: Status mapping editor

**Dependencies**: Phase 1  
**Deliverable**: User can map repos to projects with custom sync config

### Phase 3: Webhook Receiver (Week 3-4)

**Goal**: Receive and store GitHub events

- [ ] Backend: Webhook handler with HMAC verification
- [ ] Backend: Raw event storage with idempotency
- [ ] Backend: Webhook event processor (skeleton)
- [ ] Backend: Background job queue (`github_sync_jobs`)
- [ ] Backend: Job runner with retry logic
- [ ] Testing: Webhook signature verification tests
- [ ] Testing: Use GitHub's webhook tester / `ngrok` for local dev

**Dependencies**: Phase 1  
**Deliverable**: Webhooks are received, verified, and stored

### Phase 4: PR Tracking (Week 4-5) ⭐ _Highest value_

**Goal**: PRs linked to issues, status updates

- [ ] Backend: Issue linker (branch name, PR title, body parsing)
- [ ] Backend: `handle_pull_request_event` processor
- [ ] Backend: PR link CRUD
- [ ] Backend: Status mapping engine (PR state → issue status)
- [ ] Backend: Anti-echo sync lock
- [ ] Frontend: PR badge on Kanban cards
- [ ] Frontend: GitHub section in issue drawer (PRs, branch name)
- [ ] Frontend: Copy branch name button
- [ ] Testing: End-to-end PR → status change flow

**Dependencies**: Phase 2, Phase 3  
**Deliverable**: PR badges on cards, automated status changes

### Phase 5: Commit & Push Tracking (Week 5-6)

**Goal**: Commits linked to issues

- [ ] Backend: `handle_push_event` processor (parse commit messages for issue IDs)
- [ ] Backend: Commit link storage
- [ ] Frontend: Commit timeline in issue drawer
- [ ] Frontend: Link commits to TLDRs (when agent name matches)

**Dependencies**: Phase 4  
**Deliverable**: Full commit history visible on issues

### Phase 6: Bidirectional Issue Sync (Week 6-8)

**Goal**: Issues sync both ways

- [ ] Backend: `handle_issues_event` processor (GitHub → Baaton)
- [ ] Backend: `sync_issue_to_github` (Baaton → GitHub)
- [ ] Backend: Comment sync (`handle_issue_comment_event` + outgoing)
- [ ] Backend: User identity mapping (GitHub ↔ Clerk)
- [ ] Backend: Personal GitHub connection flow (for comment attribution)
- [ ] Frontend: Personal account connection in profile settings
- [ ] Frontend: Sync status indicator on issues
- [ ] Testing: Bidirectional sync with conflict scenarios

**Dependencies**: Phase 4  
**Deliverable**: Full bidirectional issue + comment sync

### Phase 7: Polish & Resilience (Week 8-9)

**Goal**: Production hardening

- [ ] Backend: Rate limit tracking and backoff
- [ ] Backend: Admin endpoint to replay failed events
- [ ] Backend: Periodic reconciliation job (detect drift)
- [ ] Backend: Handle edge cases (deleted repos, revoked access, suspended installs)
- [ ] Frontend: Error states and recovery UI
- [ ] Frontend: Sync health dashboard (admin)
- [ ] Documentation: Setup guide for users
- [ ] Load testing: Simulate 1000 webhook events/minute

**Dependencies**: Phase 6  
**Deliverable**: Production-ready integration

---

## 14. Estimated Effort

| Phase | Description | Effort | Cumulative |
|-------|-------------|--------|------------|
| 1 | Foundation (GitHub App, OAuth, DB) | 3-4 days | 3-4 days |
| 2 | Repository Mapping | 2-3 days | 5-7 days |
| 3 | Webhook Receiver | 2-3 days | 7-10 days |
| 4 | PR Tracking ⭐ | 4-5 days | 11-15 days |
| 5 | Commit Tracking | 2 days | 13-17 days |
| 6 | Bidirectional Issue Sync | 5-7 days | 18-24 days |
| 7 | Polish & Resilience | 3-4 days | 21-28 days |
| **Total** | | **21-28 days** | ~4-6 weeks |

### Quick Win Path (MVP in 2 weeks)

If you want the highest-value features fast:
1. Phase 1 (3 days) — Connect GitHub
2. Phase 3 (2 days) — Receive webhooks
3. Phase 4 (5 days) — PR tracking + status mapping

**10 days → PRs linked to issues with automated status flow.**

This alone covers 80% of the value for AI agent orchestration.

---

## Environment Variables Required

Add to `.env` for both dev and production:

```bash
# GitHub App (register at github.com/settings/apps)
GITHUB_APP_ID=123456
GITHUB_CLIENT_ID=Iv1.abc123
GITHUB_CLIENT_SECRET=secret_abc123
GITHUB_WEBHOOK_SECRET=whsec_random_string
GITHUB_APP_PRIVATE_KEY=base64_encoded_pem_key

# Encryption key for user OAuth tokens (generate: openssl rand -hex 32)
GITHUB_TOKEN_ENCRYPTION_KEY=64_hex_chars

# App URL (for OAuth callbacks)
APP_URL=https://app.baaton.dev
API_URL=https://api.baaton.dev
```

---

## Appendix A: Octocrab Quick Reference

```rust
// Authentication as GitHub App
let octocrab = Octocrab::builder()
    .app(app_id.into(), private_key)
    .build()?;

// Get installation token
let installation = octocrab
    .installation_and_token(InstallationId(installation_id))
    .await?;

// List repos for installation
let repos = octocrab.apps()
    .installation_repositories(InstallationId(installation_id))
    .await?;

// Create issue
let issue = octocrab.issues("owner", "repo")
    .create("Title")
    .body("Description")
    .labels(vec!["bug"])
    .send()
    .await?;

// Update issue
octocrab.issues("owner", "repo")
    .update(issue_number)
    .title("New title")
    .state(IssueState::Closed)
    .send()
    .await?;

// Create comment
octocrab.issues("owner", "repo")
    .create_comment(issue_number, "Comment body")
    .await?;

// List PRs
let prs = octocrab.pulls("owner", "repo")
    .list()
    .state(State::Open)
    .send()
    .await?;
```

## Appendix B: Webhook Payload Examples

### pull_request.opened

```json
{
  "action": "opened",
  "number": 42,
  "pull_request": {
    "id": 123456789,
    "number": 42,
    "title": "BAA-42: Implement dark mode",
    "body": "Closes BAA-42\n\nImplements dark mode...",
    "state": "open",
    "draft": false,
    "html_url": "https://github.com/org/repo/pull/42",
    "head": {
      "ref": "baa-42-implement-dark-mode",
      "sha": "abc123"
    },
    "base": {
      "ref": "main"
    },
    "user": {
      "login": "ai-agent-1",
      "id": 12345
    },
    "additions": 150,
    "deletions": 30,
    "changed_files": 8,
    "merged": false,
    "merged_at": null
  },
  "repository": {
    "id": 987654321,
    "full_name": "org/repo"
  },
  "installation": {
    "id": 11111111
  },
  "sender": {
    "login": "ai-agent-1"
  }
}
```

### issues.closed

```json
{
  "action": "closed",
  "issue": {
    "id": 111222333,
    "number": 15,
    "title": "Login page crashes on Safari",
    "state": "closed",
    "state_reason": "completed",
    "html_url": "https://github.com/org/repo/issues/15",
    "labels": [{"name": "bug"}],
    "assignees": [{"login": "dev1"}]
  },
  "repository": {
    "id": 987654321,
    "full_name": "org/repo"
  },
  "installation": {
    "id": 11111111
  }
}
```

---

*This plan references the actual Baaton codebase at `/home/openclaw/workspace/projects/baaton/` — all models, routes, migrations, and frontend patterns are consistent with the existing architecture.*
