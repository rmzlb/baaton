# Baaton — Product Requirements Document

> **"The human holds the baton."**
> AI agents execute. You orchestrate.

## 1. Vision

Baaton is a **self-hosted, multi-tenant orchestration board** for teams managing AI coding agents. Unlike Vibe Kanban (which executes agents), Baaton focuses on **collecting, qualifying, prioritizing, and tracking** work items from any source — users, testers, clients, or automated systems.

Agents (Claude Code, Codex, etc.) connect via API to read tickets, update status, and post TLDRs. The human stays in control: reviewing, prioritizing, and deciding what ships.

**Domain:** baaton.dev
**Tagline:** "You orchestrate. AI executes."

---

## 2. Target Users

| Persona | Description |
|---------|-------------|
| **Orchestrator** | Tech lead / founder managing multiple AI agents across projects |
| **Team Member** | Developer or PM who submits/tracks issues |
| **External User** | Client, tester, or end-user submitting bugs/features via public form |
| **AI Agent** | Claude Code, Codex, etc. accessing tickets via REST API |

---

## 3. Core Features

### 3.1 Kanban Board
- Drag & drop columns (customizable per project)
- Default: Backlog → Todo → In Progress → In Review → Done → Cancelled
- Real-time updates via Supabase Realtime
- Multi-project view (cross-project board for orchestrators)
- Manual + auto sort (priority, date, assignee)
- Keyboard shortcuts (c = create, / = search, esc = close)

### 3.2 Ticket System
Each ticket (called an "Issue") contains:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Auto | Primary key |
| `display_id` | String | Auto | Human-readable (BAA-1, BAA-2...) |
| `title` | String | ✅ | Short description |
| `description` | Markdown | ❌ | Rich text (Lexical editor) |
| `type` | Enum | ✅ | bug / feature / improvement / question |
| `status` | Enum | ✅ | backlog / todo / in_progress / in_review / done / cancelled |
| `priority` | Enum | ❌ | urgent / high / medium / low |
| `source` | String | Auto | "web" / "api" / "form" / "email" |
| `reporter_name` | String | ❌ | Who submitted (can be anonymous) |
| `reporter_email` | String | ❌ | Contact email |
| `assignee_ids` | UUID[] | ❌ | Assigned team members |
| `project_id` | UUID | ✅ | Parent project |
| `milestone_id` | UUID | ❌ | Optional milestone/sprint |
| `parent_id` | UUID | ❌ | Parent issue (sub-tasks) |
| `tags` | String[] | ❌ | Colored labels |
| `attachments` | JSON[] | ❌ | Files (images, docs) via Supabase Storage |
| `position` | Float | Auto | Order within column |
| `created_at` | Timestamp | Auto | |
| `updated_at` | Timestamp | Auto | |
| `qualified_at` | Timestamp | ❌ | When LLM qualified it |
| `qualified_by` | String | ❌ | LLM model used |

### 3.3 TLDR System
After an agent works on a ticket, it posts a TLDR:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `issue_id` | UUID | Parent issue |
| `agent_name` | String | "claude-code", "codex", etc. |
| `summary` | Markdown | What was done |
| `files_changed` | String[] | List of files modified |
| `tests_status` | Enum | passed / failed / skipped / none |
| `pr_url` | String | Link to PR if created |
| `created_at` | Timestamp | |

Multiple TLDRs per issue (re-opens, iterations).

### 3.4 Comments & Activity
- Thread-based comments on each issue
- Activity log (status changes, assignments, TLDRs)
- Markdown support with @mentions

### 3.5 Projects
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Project name |
| `slug` | String | URL-friendly identifier |
| `description` | String | |
| `prefix` | String | Issue prefix (e.g., "BAA") |
| `org_id` | String | Clerk organization ID |
| `statuses` | JSON | Custom status columns with colors |
| `created_at` | Timestamp | |

### 3.6 Milestones
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | Parent project |
| `name` | String | Milestone name |
| `description` | String | |
| `target_date` | Date | Due date |
| `status` | Enum | active / completed / cancelled |

### 3.7 Public Submission Form
- Embeddable iframe (`<iframe src="baaton.dev/submit/PROJECT_SLUG">`)
- Direct link: `baaton.dev/submit/PROJECT_SLUG`
- No login required
- Fields: type, title, description, attachments, name (optional), email (optional)
- Rate limiting (10 submissions/hour per IP)
- Honeypot + basic anti-bot
- **LLM Qualifier** processes submissions:
  - Reformats description for clarity
  - Auto-categorizes (bug/feature/improvement/question)
  - Detects duplicates
  - **Sanitizes against prompt injection** (strips suspicious patterns)
  - Sets initial priority suggestion

### 3.8 REST API (for AI Agents)
Authentication: API Key (per organization)

```
GET    /api/v1/issues?status=todo&project=PROJECT_ID
GET    /api/v1/issues/:id
POST   /api/v1/issues
PATCH  /api/v1/issues/:id
POST   /api/v1/issues/:id/tldr
GET    /api/v1/projects
GET    /api/v1/projects/:id/issues
```

Rate limit: 100 req/min per API key.

### 3.9 Authentication & Multi-tenancy
- **Clerk** for all auth (Gmail, email, magic link)
- **Organizations** = tenants (Clerk Organizations)
- **Roles**: Owner, Admin, Member, Viewer
- **Invitations**: Email invite or shareable link
- **API Keys**: Generated per organization for agent access
- **RLS**: All database queries scoped to org via Clerk JWT

---

## 4. Architecture

```
┌─────────────────────────────────────────────────┐
│              FRONTEND (SPA)                      │
│                                                  │
│  React 19.2 + Vite 8-beta.13 + TS 5.9.3        │
│  Tailwind 4.1 + shadcn/ui + Base UI 1.1         │
│  @hello-pangea/dnd 18 (kanban)                   │
│  Zustand 5 (state) + TanStack Query 5.90        │
│  Lexical 0.40 (rich text)                        │
│  Clerk React 5.60 (auth)                         │
│  React Router 7.13                               │
│  Framer Motion 12.33                             │
│                                                  │
│  Deploy: Railway (static / SPA)                  │
└───────────────────┬─────────────────────────────┘
                    │ REST JSON + Clerk JWT
┌───────────────────▼─────────────────────────────┐
│              BACKEND (Rust)                      │
│                                                  │
│  Axum 0.8.8 + Tokio                             │
│  clerk-rs (JWT Layer)                            │
│  sqlx 0.8.6 (PostgreSQL)                        │
│  tower-http (CORS, trace, rate-limit)            │
│  reqwest (LLM calls)                             │
│  serde + serde_json                              │
│                                                  │
│  Deploy: Railway (Docker, ~10MB binary)          │
└───────────────────┬─────────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │  Supabase (hosted)  │
         │  PostgreSQL 17      │
         │  RLS + Realtime     │
         │  Storage (files)    │
         └─────────────────────┘
```

---

## 5. Database Schema

### Organizations (managed by Clerk, synced via webhook)
```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,           -- Clerk org ID
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Projects
```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  prefix TEXT NOT NULL,          -- e.g. "BAA"
  statuses JSONB NOT NULL DEFAULT '[
    {"key":"backlog","label":"Backlog","color":"#6b7280","hidden":true},
    {"key":"todo","label":"Todo","color":"#3b82f6","hidden":false},
    {"key":"in_progress","label":"In Progress","color":"#f59e0b","hidden":false},
    {"key":"in_review","label":"In Review","color":"#8b5cf6","hidden":false},
    {"key":"done","label":"Done","color":"#22c55e","hidden":false},
    {"key":"cancelled","label":"Cancelled","color":"#ef4444","hidden":true}
  ]',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, slug)
);
```

### Milestones
```sql
CREATE TABLE milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Issues
```sql
CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL,
  parent_id UUID REFERENCES issues(id) ON DELETE SET NULL,
  display_id TEXT NOT NULL,         -- "BAA-1"
  title TEXT NOT NULL,
  description TEXT,                  -- Markdown
  type TEXT NOT NULL DEFAULT 'feature' CHECK (type IN ('bug','feature','improvement','question')),
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT CHECK (priority IN ('urgent','high','medium','low')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','api','form','email')),
  reporter_name TEXT,
  reporter_email TEXT,
  assignee_ids TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  attachments JSONB DEFAULT '[]',
  position FLOAT NOT NULL DEFAULT 0,
  qualified_at TIMESTAMPTZ,
  qualified_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, display_id)
);

CREATE INDEX idx_issues_project_status ON issues(project_id, status);
CREATE INDEX idx_issues_milestone ON issues(milestone_id);
```

### TLDRs
```sql
CREATE TABLE tldrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  summary TEXT NOT NULL,              -- Markdown
  files_changed TEXT[] DEFAULT '{}',
  tests_status TEXT DEFAULT 'none' CHECK (tests_status IN ('passed','failed','skipped','none')),
  pr_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Comments
```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,           -- Clerk user ID
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,                 -- Markdown
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### API Keys
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,            -- SHA-256 hash
  key_prefix TEXT NOT NULL,          -- First 8 chars for display
  permissions TEXT[] DEFAULT '{read,write}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Activity Log
```sql
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  actor_id TEXT,                     -- Clerk user ID or "agent:name"
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,              -- "status_changed", "assigned", "commented", "tldr_added"
  details JSONB,                     -- {"from":"todo","to":"in_progress"}
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### RLS Policies
```sql
-- All tables scoped to organization via Clerk JWT
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_org ON projects
  USING (org_id = auth.jwt()->>'org_id');

-- Issues scoped through project → org
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY issues_org ON issues
  USING (project_id IN (
    SELECT id FROM projects WHERE org_id = auth.jwt()->>'org_id'
  ));

-- Similar for all other tables...
```

---

## 6. API Routes (Backend)

### Auth Routes (Clerk JWT required)
```
GET    /api/v1/projects                    List projects (org-scoped)
POST   /api/v1/projects                    Create project
GET    /api/v1/projects/:id                Get project
PATCH  /api/v1/projects/:id                Update project
DELETE /api/v1/projects/:id                Delete project

GET    /api/v1/projects/:id/issues         List issues (filterable)
POST   /api/v1/issues                      Create issue
GET    /api/v1/issues/:id                  Get issue (with TLDRs, comments)
PATCH  /api/v1/issues/:id                  Update issue (status, priority, etc.)
DELETE /api/v1/issues/:id                  Delete issue
PATCH  /api/v1/issues/:id/position         Update position (drag & drop)
PATCH  /api/v1/issues/bulk                 Bulk update (status, assignee, etc.)

POST   /api/v1/issues/:id/comments         Add comment
GET    /api/v1/issues/:id/activity         Get activity log

GET    /api/v1/milestones                  List milestones
POST   /api/v1/milestones                  Create milestone
PATCH  /api/v1/milestones/:id              Update milestone

GET    /api/v1/api-keys                    List API keys
POST   /api/v1/api-keys                    Generate API key
DELETE /api/v1/api-keys/:id                Revoke API key
```

### Agent Routes (API Key required)
```
GET    /api/v1/agent/issues                List assigned/open issues
GET    /api/v1/agent/issues/:id            Get issue details
PATCH  /api/v1/agent/issues/:id            Update status
POST   /api/v1/agent/issues/:id/tldr       Post TLDR
```

### Public Routes (rate-limited, no auth)
```
GET    /api/v1/public/:project_slug/form   Get form config
POST   /api/v1/public/:project_slug/submit Submit issue
POST   /api/v1/webhooks/clerk              Clerk webhook (org sync)
```

---

## 7. Frontend Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Landing | Marketing page |
| `/sign-in` | Auth | Clerk sign-in |
| `/sign-up` | Auth | Clerk sign-up |
| `/dashboard` | Dashboard | Org overview, recent activity |
| `/projects` | Projects List | All projects in org |
| `/projects/:slug` | Kanban Board | Main board view |
| `/projects/:slug/list` | List View | Table view of issues |
| `/projects/:slug/settings` | Project Settings | Statuses, members, API keys |
| `/issues/:id` | Issue Detail | Side panel or full page |
| `/milestones` | Milestones | Timeline / list view |
| `/settings` | Org Settings | Organization, members, billing |
| `/submit/:slug` | Public Form | Public issue submission |

---

## 8. Brand Identity

### Name: Baaton
- **Meaning:** The conductor's baton — the human directs, the orchestra (AI) plays
- **Pronunciation:** /bɑːtɒn/ (like "baa-ton")
- **Domain:** baaton.dev

### Mascot: Pixel Tanuki (raccoon dog)
- Japanese folklore: shape-shifter, clever orchestrator
- Holding a tiny conductor's baton
- 8-bit pixel art style (16x16 grid)
- Primary color: warm amber/gold on dark
- The tanuki represents: clever, resourceful, orchestrating chaos into harmony

### Color Palette
```
Background:     #0a0a0a (near black)
Surface:        #141414 (cards, panels)
Surface Hover:  #1f1f1f
Border:         #262626
Text Primary:   #fafafa
Text Secondary: #a1a1aa
Accent:         #f59e0b (amber — the baton, warmth)
Accent Hover:   #d97706
Success:        #22c55e
Warning:        #eab308
Error:          #ef4444
Info:           #3b82f6
```

### Typography
- **Headings:** Inter (clean, modern)
- **Body:** Inter
- **Code/IDs:** JetBrains Mono
- **Style:** Lowercase for nav, uppercase tracking-wide for labels

### Design Principles
1. **Dark-first** — light mode is optional
2. **Dense but breathable** — lots of info, not cluttered
3. **Instant feedback** — optimistic updates, smooth animations
4. **Keyboard-first** — every action has a shortcut
5. **Linear-inspired** — clean, minimal, fast

---

## 9. Sprint Plan

### Phase 1: Foundation (Week 1)
- [ ] P1-01: Scaffold monorepo (frontend + backend)
- [ ] P1-02: Vite 8 + React 19 + Tailwind 4 + shadcn setup
- [ ] P1-03: Clerk integration (sign-in/up, org, middleware)
- [ ] P1-04: Axum backend scaffold + clerk-rs middleware
- [ ] P1-05: Supabase project + schema migration (all tables)
- [ ] P1-06: sqlx queries for CRUD operations
- [ ] P1-07: React Router setup + layout (sidebar, header)
- [ ] P1-08: Zustand stores (projects, issues, UI state)
- [ ] P1-09: TanStack Query hooks for all API endpoints

### Phase 2: Kanban Core (Week 2)
- [ ] P2-01: Kanban board component (columns, cards, header)
- [ ] P2-02: Drag & drop with @hello-pangea/dnd
- [ ] P2-03: Issue card component (priority badge, tags, assignee)
- [ ] P2-04: Issue detail panel (slide-over drawer)
- [ ] P2-05: Lexical editor for description (markdown in/out)
- [ ] P2-06: Status change (drag + dropdown)
- [ ] P2-07: Filter bar (priority, assignee, tags, search)
- [ ] P2-08: Sort (manual, priority, date, title)
- [ ] P2-09: Column customization (add, rename, reorder, hide)
- [ ] P2-10: Keyboard shortcuts (c, /, esc, arrow nav)

### Phase 3: Data & Features (Week 3)
- [ ] P3-01: Project CRUD (create, settings, delete)
- [ ] P3-02: Milestone CRUD + timeline view
- [ ] P3-03: Comments system (markdown, activity log)
- [ ] P3-04: TLDR display on issues (agent summaries)
- [ ] P3-05: File upload (Supabase Storage, drag & drop)
- [ ] P3-06: Sub-issues (parent/child, 1 level)
- [ ] P3-07: List view (table alternative to kanban)
- [ ] P3-08: Multi-project view (cross-project board)
- [ ] P3-09: Bulk actions (multi-select, status change, assign)

### Phase 4: Public & API (Week 4)
- [ ] P4-01: Public submission form (standalone page)
- [ ] P4-02: Embeddable form (iframe mode)
- [ ] P4-03: LLM qualifier (categorize, reformat, dedupe)
- [ ] P4-04: Anti-injection sanitizer
- [ ] P4-05: REST API for agents (/api/v1/agent/*)
- [ ] P4-06: API key management (generate, revoke, permissions)
- [ ] P4-07: Rate limiting (public + API)
- [ ] P4-08: Webhooks (Clerk org sync)
- [ ] P4-09: Real-time updates (Supabase Realtime → Zustand)

### Phase 5: Polish (Week 5)
- [ ] P5-01: Landing page (baaton.dev)
- [ ] P5-02: Pixel Tanuki mascot/logo
- [ ] P5-03: Onboarding flow (first project wizard)
- [ ] P5-04: Notifications (in-app)
- [ ] P5-05: Dashboard (org overview, stats)
- [ ] P5-06: Dark/light theme toggle
- [ ] P5-07: Mobile responsive
- [ ] P5-08: Performance optimization (virtual lists, lazy load)
- [ ] P5-09: Error boundaries + empty states
- [ ] P5-10: Documentation (API docs, guides)

---

## 10. Security Considerations

### Prompt Injection Prevention
- All user-submitted text is sanitized before LLM processing
- Pattern matching for common injection patterns
- LLM qualifier uses system prompt with explicit instructions to ignore embedded commands
- User content is always wrapped in `<user_content>` tags when sent to LLM
- Never execute code from user submissions

### Multi-tenancy Isolation
- All DB queries filtered by org_id from Clerk JWT
- RLS policies enforced at database level
- API keys scoped to organization
- File uploads namespaced by org_id

### Rate Limiting
- Public form: 10 req/hour per IP
- API (authenticated): 100 req/min per key
- Web UI: 1000 req/min per user

---

## 11. Success Metrics

| Metric | Target |
|--------|--------|
| Time to first ticket | < 2 minutes |
| Kanban drag latency | < 100ms |
| API response time | < 50ms (p95) |
| Public form to qualified | < 5 seconds |
| Concurrent agents | 10+ per org |
