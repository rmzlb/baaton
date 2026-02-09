# Baaton System Architecture

---

## Overview

Baaton is a three-tier application with a React SPA frontend, Rust API backend, and PostgreSQL database hosted on Supabase.

```
┌───────────────────────────────────────────────────────────────┐
│                          CLIENTS                               │
│                                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐ │
│  │  Web Browser  │   │  AI Agents   │   │  Public Forms     │ │
│  │  (React SPA)  │   │  (API Key)   │   │  (No Auth)        │ │
│  └──────┬────────┘   └──────┬───────┘   └────────┬──────────┘ │
│         │                   │                     │           │
│         │ Clerk JWT         │ baa_* API Key       │ None      │
└─────────┼───────────────────┼─────────────────────┼───────────┘
          │                   │                     │
          ▼                   ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Rust / Axum 0.8)                     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐     │
│  │ Middleware Stack (tower-http)                           │     │
│  │  ├─ CORS (Allow-Origin: Any, All methods, All headers) │     │
│  │  ├─ Request Tracing (tower-http TraceLayer)            │     │
│  │  ├─ Clerk JWT Verification (clerk-rs)      [planned]   │     │
│  │  ├─ API Key Validation (SHA-256 hash)      [planned]   │     │
│  │  └─ Rate Limiting                          [planned]   │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐     │
│  │ Route Handlers (axum Router)                           │     │
│  │  ├─ GET    /health                                     │     │
│  │  ├─ GET    /api/v1/projects            (list)          │     │
│  │  ├─ POST   /api/v1/projects            (create)        │     │
│  │  ├─ GET    /api/v1/projects/{id}       (get)           │     │
│  │  ├─ PATCH  /api/v1/projects/{id}       (update)        │     │
│  │  ├─ DELETE /api/v1/projects/{id}       (remove)        │     │
│  │  ├─ GET    /api/v1/projects/{id}/issues (list)         │     │
│  │  ├─ POST   /api/v1/issues              (create)        │     │
│  │  ├─ GET    /api/v1/issues/{id}         (get)           │     │
│  │  ├─ PATCH  /api/v1/issues/{id}         (update)        │     │
│  │  ├─ DELETE /api/v1/issues/{id}         (remove)        │     │
│  │  ├─ PATCH  /api/v1/issues/{id}/position (D&D)          │     │
│  │  └─ POST   /api/v1/public/{slug}/submit (public)       │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                                 │
│  Runtime: Tokio async │ Binary: ~10MB │ Port: 4000              │
│  Dependencies: axum, sqlx, tower-http, clerk-rs, serde          │
└────────────────────────────┬────────────────────────────────────┘
                             │ sqlx (runtime queries, not compile-time)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DATABASE (Supabase PostgreSQL 17)                │
│                                                                 │
│  Tables:                                                        │
│  ├─ organizations      (synced from Clerk, TEXT PK)             │
│  ├─ projects           (org-scoped, JSONB statuses)             │
│  ├─ milestones         (per-project, target dates)              │
│  ├─ sprints            (optional grouping, added in 002)        │
│  ├─ issues             (core tickets, float position ordering)  │
│  ├─ tldrs              (agent work summaries, one-to-many)      │
│  ├─ comments           (threaded per issue)                     │
│  ├─ api_keys           (SHA-256 hashed, per org)                │
│  └─ activity_log       (append-only audit trail)                │
│                                                                 │
│  Indexes: (project_id, status), (milestone_id), (parent_id),   │
│           (sprint_id), (issue_id) on tldrs/comments/activity    │
│  Security: RLS policies planned (org_id scoping)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Technology Stack

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19.2 | UI rendering |
| Vite | 8.0-beta.13 | Build tool & dev server |
| TypeScript | 5.9 | Type safety (strict mode) |
| Tailwind CSS | 4.1 | Utility-first styling |
| Zustand | 5 | Client-side state management |
| TanStack Query | 5.90 | Server state, caching, mutations |
| @hello-pangea/dnd | 18 | Kanban drag & drop |
| Clerk React | 5.60 | Authentication UI & JWT |
| React Router | 7.13 | Client-side routing |
| Framer Motion | 12.33 | Animations & transitions |
| Lexical | 0.40 | Rich text editor |
| Lucide React | 0.563 | Icon library |

### State Management

Baaton uses a dual-store pattern:

```
┌──────────────────────────────────┐
│  TanStack Query                   │ ← Server state (issues, projects)
│  (cache, refetch, mutations)      │ ← Loading, error, stale handling
│  staleTime: 30s, retry: 1        │ ← Configured in main.tsx
└───────────┬──────────────────────┘
            │
            ▼
┌──────────────────────────────────┐
│  Zustand Stores (immer)           │ ← UI state (immediate)
│  ├─ useIssuesStore                │ ← Optimistic D&D, issue selection
│  │   ├─ issues: Record<id, Issue> │
│  │   ├─ setIssues / updateIssue   │
│  │   ├─ moveIssue (status+pos)    │
│  │   └─ selectIssue / openDetail  │
│  └─ useUIStore                    │ ← Sidebar, theme, command bar
│      ├─ sidebarCollapsed          │
│      ├─ theme: 'dark' | 'light'  │
│      └─ commandBarOpen           │
└──────────────────────────────────┘
```

**Why both?**
- **TanStack Query** handles server synchronization — caching, background refetching, optimistic mutations
- **Zustand** handles instant UI state — when a Kanban card is dragged, Zustand updates immediately (optimistic), then TanStack Query fires the API mutation and refetches

### API Client Pattern

Two-layer design:

```
┌─────────────────────────────────────────────────┐
│  hooks/useApi.ts                                 │
│  ├─ useAuth() → getToken()                      │ ← Clerk JWT
│  ├─ withErrorHandling()                          │ ← 401 → signOut()
│  ├─ projects.list/get/create/update/delete       │ ← Typed methods
│  ├─ issues.listByProject/get/create/update/...   │
│  ├─ apiKeys.list/create/delete                   │
│  ├─ get/post/patch/del (generic)                 │ ← Low-level access
│  └─ public.submit (no auth)                      │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  lib/api.ts                                      │
│  ├─ request<T>(path, opts)                       │ ← Core fetch wrapper
│  ├─ JSON envelope parsing (data / error)         │
│  ├─ ApiError class (status, code, message)       │
│  └─ api.get/post/patch/delete + api.public.*     │
│                                                  │
│  Base URL: import.meta.env.VITE_API_URL/api/v1   │
└─────────────────────────────────────────────────┘
```

### Component Architecture

```
App (React Router)
├── Landing           (/ — public marketing page)
├── PublicSubmit       (/submit/:slug — public feedback form, no auth)
├── SignIn / SignUp    (Clerk-managed auth pages)
└── OnboardingFlow    (wraps authenticated routes)
    └── AppLayout     (sidebar + content shell)
        ├── Sidebar           (nav, org switcher, project list)
        ├── TopBar            (search, user menu)
        ├── Dashboard         (/dashboard — stats, recent activity)
        ├── ProjectList       (/projects — project grid + create)
        ├── ProjectBoard      (/projects/:slug — Kanban board)
        │   ├── KanbanBoard   (column container + DragDropContext)
        │   │   └── KanbanColumn (per-status column)
        │   │       └── KanbanCard (draggable issue card)
        │   ├── IssueDrawer   (slide-over detail panel)
        │   └── CreateIssueModal
        └── Settings          (/settings — org profile, API keys)
```

### Routing

Defined in `App.tsx`:

| Route | Component | Auth | Description |
|-------|-----------|------|-------------|
| `/` | Landing | Public | Marketing page |
| `/submit/:slug` | PublicSubmit | Public | Feedback form |
| `/sign-in/*` | Clerk SignIn | Public | Auth |
| `/sign-up/*` | Clerk SignUp | Public | Auth |
| `/dashboard` | Dashboard | Required | Org overview |
| `/projects` | ProjectList | Required | Project grid |
| `/projects/:slug` | ProjectBoard | Required | Kanban board |
| `/settings` | Settings | Required | Org settings |
| `/org/*` | Clerk OrgProfile | Required | Org management |

---

## Backend Architecture

### Technology Stack

| Crate | Version | Purpose |
|-------|---------|---------|
| axum | 0.8 | HTTP framework |
| tokio | 1.x | Async runtime (full features) |
| sqlx | 0.8 | PostgreSQL driver (runtime queries) |
| tower-http | 0.6 | CORS, tracing |
| clerk-rs | 0.4 | Clerk JWT verification |
| serde / serde_json | 1.x | Serialization |
| uuid | 1.x | UUID v4 generation |
| chrono | 0.4 | DateTime handling |
| reqwest | 0.12 | HTTP client (for LLM qualifier) |
| sha2 | 0.10 | API key hashing |
| rand | 0.9 | Secure random generation |

### Request Flow

```
Incoming Request
    │
    ▼
┌──────────────┐
│  tower-http   │ ← CORS headers (Allow-Origin: Any)
│  layers       │ ← Request tracing (TraceLayer)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Auth Layer   │ ← Currently placeholder (middleware/mod.rs)
│  [planned]    │ ← Will: verify Clerk JWT OR hash+check API key
│               │ ← Extract org_id, user_id from auth context
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Route        │ ← Business logic in routes/*.rs
│  Handler      │ ← SQL queries via sqlx (runtime, not compile-time)
│               │ ← State: PgPool passed via axum State
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Response     │ ← JSON: { "data": T } or { "error": { code, message } }
│  (Serialize)  │ ← Via ApiResponse<T> wrapper struct
└──────────────┘
```

### Server Setup (main.rs)

Startup sequence:
1. Load `.env` via `dotenvy`
2. Initialize tracing subscriber with env filter
3. Connect to PostgreSQL (`PgPoolOptions`, max 10 connections)
4. Run migration 001 (`include_str!` embedded SQL)
5. Configure CORS (permissive)
6. Build router: `/health` + `/api/v1/*` routes
7. Bind and serve on `0.0.0.0:{PORT}`

### API Response Envelope

```rust
// Success
struct ApiResponse<T: Serialize> {
    data: T,
}

// Error
struct ApiError {
    error: ApiErrorBody {
        code: String,     // "NOT_FOUND", "VALIDATION_ERROR", etc.
        message: String,  // Human-readable
    }
}
```

### Position-Based Ordering

Kanban cards use **fractional indexing** for position:

```
Card A: position = 1000.0
Card B: position = 2000.0
Card C: position = 3000.0

Insert between A and B → position = 1500.0
Insert at start       → position = 500.0
Insert at end         → position = 4000.0
```

Benefits:
- O(1) insert/move — no reindexing other rows
- Works with concurrent users
- Float64 provides ~15 digits of precision

New issues get `position = MAX(position) + 1000` within their status column.

---

## Database Design

### Entity Relationships

```
organizations (1) ────── (N) projects
organizations (1) ────── (N) api_keys

projects      (1) ────── (N) issues
projects      (1) ────── (N) milestones
projects      (1) ────── (N) sprints

issues        (1) ────── (N) tldrs
issues        (1) ────── (N) comments
issues        (1) ────── (N) activity_log
issues        (1) ────── (N) issues         (parent_id self-ref)

milestones    (1) ────── (N) issues         (optional FK)
sprints       (1) ────── (N) issues         (optional FK, added in 002)
```

### Schema Overview

| Table | PK | Key Columns | Notes |
|-------|-----|-------------|-------|
| organizations | `id TEXT` | name, slug | Synced from Clerk |
| projects | `id UUID` | org_id (FK), name, slug, prefix, statuses (JSONB) | Unique(org_id, slug) |
| milestones | `id UUID` | project_id (FK), target_date, status | active/completed/cancelled |
| sprints | `id UUID` | project_id (FK), start_date, end_date, status | planning/active/completed |
| issues | `id UUID` | project_id (FK), display_id, type, status, priority, position (FLOAT) | Core entity |
| tldrs | `id UUID` | issue_id (FK), agent_name, summary, files_changed, tests_status | Agent work logs |
| comments | `id UUID` | issue_id (FK), author_id, body | Markdown support |
| api_keys | `id UUID` | org_id (FK), key_hash, key_prefix, permissions | SHA-256 hashed |
| activity_log | `id UUID` | issue_id (FK), actor_name, action, details (JSONB) | Append-only audit |

### Key Design Decisions

1. **JSONB for statuses** — Each project stores its Kanban column config (key, label, color, hidden) as a JSONB array. No join table needed. Default 6 statuses.

2. **Float positions** — Fractional indexing allows O(1) reordering without touching other rows. Frontend calculates midpoints.

3. **Text arrays for tags & assignees** — `TEXT[]` columns instead of junction tables. Simpler queries, atomic updates. Trade: harder to query "all issues with tag X" across projects.

4. **Separate TLDRs table** — Multiple TLDRs per issue (re-opens, iterations). One-to-many, not embedded.

5. **Activity log** — Append-only. Every status change, assignment, TLDR generates a log entry (not yet wired in handlers).

6. **API key hashing** — Keys stored as SHA-256 hashes. Full key returned only at creation. Prefix stored for display.

7. **Runtime SQL** — Using `sqlx` runtime queries (not compile-time checked). No database connection needed at build time.

8. **Migrations at startup** — `001_init.sql` is embedded via `include_str!` and run with `sqlx::raw_sql()` on every startup (idempotent with `CREATE TABLE IF NOT EXISTS`).

---

## Authentication Flow

### Web UI (Clerk JWT)

```
Browser                  Clerk                  Baaton API
   │                       │                       │
   ├── Sign in ──────────► │                       │
   │◄── JWT token ─────────│                       │
   │                       │                       │
   ├── API request ────────┼───────────────────────►│
   │   (Bearer: JWT)       │                       │
   │                       │                 ┌─────┤
   │                       │                 │ [planned] Verify JWT
   │                       │                 │ via clerk-rs
   │                       │                 │ Extract org_id
   │                       │                 └─────┤
   │◄── Response ──────────┼───────────────────────│
```

The frontend's `useApi()` hook:
1. Calls `getToken()` from Clerk's `useAuth()`
2. Attaches `Authorization: Bearer <jwt>` to every request
3. On 401 → calls `signOut()` to redirect to `/sign-in`

### Agent API (API Key) [Planned]

```
AI Agent                                    Baaton API
   │                                           │
   ├── API request ────────────────────────────►│
   │   (Bearer: baa_abc123...)                 │
   │                                     ┌─────┤
   │                                     │ Hash key (SHA-256)
   │                                     │ Lookup in api_keys table
   │                                     │ Extract org_id from match
   │                                     │ Update last_used_at
   │                                     └─────┤
   │◄── Response ──────────────────────────────│
```

---

## Deployment Architecture

### Production (Dokploy + Supabase)

```
┌─────────────────────────────────────────────┐
│        Dokploy (13.38.180.239:3000)          │
│        Docker-based PaaS                     │
│                                              │
│  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Frontend (SPA)   │  │ Backend (Rust)   │  │
│  │ Docker / Nginx   │  │ Docker container │  │
│  │ baaton.dev       │  │ api.baaton.dev   │  │
│  │ :80 (HTTPS)      │  │ :4000 (HTTPS)    │  │
│  └─────────────────┘  └───────┬──────────┘  │
│                               │              │
└───────────────────────────────┼──────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  Supabase (hosted)    │
                    │  PostgreSQL 17        │
                    │  EU-West-1            │
                    │  + Pooler (port 6543) │
                    │  + Direct (port 5432) │
                    └──────────────────────┘
```

### Resource Requirements

| Component | CPU | Memory | Storage |
|-----------|-----|--------|---------|
| Frontend | Minimal (static files) | — | ~5MB build output |
| Backend | 0.5 vCPU | ~128MB | ~10MB binary (stripped + LTO) |
| Database | Supabase-managed | — | Scales with data |

---

## Security Model

### Defense Layers

1. **Authentication** — Clerk JWT (web) + API Key hash (agents)
2. **Authorization** — Organization-scoped access (planned: RLS policies)
3. **Input Validation** — serde deserialization with typed structs + CHECK constraints in SQL
4. **Rate Limiting** — Planned: per-IP (public), per-key (API), per-user (web)
5. **CORS** — Currently permissive; will restrict to production domains
6. **Secret Handling** — API keys hashed with SHA-256, never stored in plain text

### API Key Security

- Generated with cryptographic randomness (`rand` crate)
- Stored as SHA-256 hashes (irreversible)
- Prefixed with `baa_` for easy identification
- Full key shown once at creation
- `last_used_at` tracked for monitoring
- Optional `expires_at` for time-limited keys

---

## Future Architecture

### Planned Components

1. **Auth Middleware** — Wire `clerk-rs` JWT verification and API key validation into axum middleware stack
2. **TLDR Routes** — Backend handler for `POST /issues/{id}/tldr`
3. **Comments Routes** — Backend handlers for issue comments
4. **MCP Server** — Model Context Protocol server for native AI agent integration
5. **Supabase Realtime** — Live WebSocket updates for Kanban board
6. **LLM Qualifier** — Auto-categorize, reformat, and deduplicate public submissions (via reqwest + OpenAI/Anthropic)
7. **Webhook System** — Outbound webhooks for Slack, Discord, GitHub
8. **File Storage** — Supabase Storage for issue attachments
9. **Full-text Search** — PostgreSQL `tsvector` for issue search beyond ILIKE
10. **RLS Policies** — Database-level row security by org_id
