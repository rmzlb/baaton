# Baaton REST API Reference

**Base URL:** `https://api.baaton.dev/api/v1`

**Source of truth:** `backend/src/routes/*.rs` and `backend/src/models/mod.rs`

---

## Authentication

Baaton supports two authentication methods:

### 1. Clerk JWT (Web UI)

Used by the frontend. The Clerk React SDK handles token refresh automatically.

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

### 2. API Key (Agents)

Used by AI agents and external integrations. Generated in **Settings → API Keys**.

```
Authorization: Bearer baa_abc123def456...
```

API keys are prefixed with `baa_` for easy identification. The full key is only shown once at creation — store it securely. Keys are stored as SHA-256 hashes in the database.

---

## Response Format

All responses follow a consistent envelope:

### Success

```json
{
  "data": { ... }
}
```

### Error

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found"
  }
}
```

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request body or parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource already exists (e.g., duplicate slug) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

---

## Rate Limits

| Context | Limit |
|---------|-------|
| Public endpoints (no auth) | 10 requests / hour / IP |
| API Key (agents) | 100 requests / minute / key |
| Clerk JWT (web UI) | 1000 requests / minute / user |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706745600
```

---

## Endpoints

### Health Check

```
GET /health
```

Returns `ok` as plain text. No authentication required. **Note:** This endpoint is at the root, not under `/api/v1`.

```bash
curl https://api.baaton.dev/health
# → ok
```

---

### Projects

#### List Projects

```
GET /projects
```

Returns all projects in the authenticated organization.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/projects | jq
```

**Response:**
```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "org_id": "default",
      "name": "My SaaS App",
      "slug": "my-saas-app",
      "description": "Main product project",
      "prefix": "MSA",
      "statuses": [
        {"key": "backlog", "label": "Backlog", "color": "#6b7280", "hidden": true},
        {"key": "todo", "label": "Todo", "color": "#3b82f6", "hidden": false},
        {"key": "in_progress", "label": "In Progress", "color": "#f59e0b", "hidden": false},
        {"key": "in_review", "label": "In Review", "color": "#8b5cf6", "hidden": false},
        {"key": "done", "label": "Done", "color": "#22c55e", "hidden": false},
        {"key": "cancelled", "label": "Cancelled", "color": "#ef4444", "hidden": true}
      ],
      "created_at": "2026-01-15T10:30:00Z"
    }
  ]
}
```

> **Note:** Currently returns all projects (TODO: filter by org_id from JWT). See `backend/src/routes/projects.rs`.

---

#### Create Project

```
POST /projects
```

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My SaaS App",
    "slug": "my-saas-app",
    "description": "Main product project",
    "prefix": "MSA"
  }' \
  https://api.baaton.dev/api/v1/projects | jq
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Project display name |
| `slug` | string | ✅ | URL-friendly identifier (unique per org) |
| `description` | string | ❌ | Project description |
| `prefix` | string | ✅ | Issue ID prefix (e.g., `MSA` → `MSA-1`) |

**Response:** `200` with the created project object (includes auto-generated `id`, default `statuses` JSONB, and `created_at`).

---

#### Get Project

```
GET /projects/{id}
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/projects/$PROJECT_ID | jq
```

**Response:** Single project object.

---

#### Update Project

```
PATCH /projects/{id}
```

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Name", "description": "New description"}' \
  https://api.baaton.dev/api/v1/projects/$PROJECT_ID | jq
```

Updatable fields (all optional):

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Project display name |
| `description` | string | Project description |

> **Implementation note:** The handler uses `COALESCE` — only provided fields are updated.

**Response:** Updated project object.

---

#### Delete Project

```
DELETE /projects/{id}
```

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/projects/$PROJECT_ID | jq
```

⚠️ **Destructive** — deletes the project and all associated issues, milestones, comments, etc. (cascading FK delete).

**Response:** `200` with `{ "data": null }`.

---

### Issues

#### List Issues by Project

```
GET /projects/{project_id}/issues
```

```bash
# All issues
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/projects/$PROJECT_ID/issues | jq

# Filtered: todo issues, high priority, search
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.baaton.dev/api/v1/projects/$PROJECT_ID/issues?status=todo&priority=high&search=auth&limit=10" | jq
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | — | Filter by status (`backlog`, `todo`, `in_progress`, `in_review`, `done`, `cancelled`) |
| `priority` | string | — | Filter by priority (`urgent`, `high`, `medium`, `low`) |
| `type` | string | — | Filter by type (`bug`, `feature`, `improvement`, `question`) |
| `search` | string | — | Case-insensitive title search (`ILIKE '%search%'`) |
| `limit` | integer | `100` | Max results |
| `offset` | integer | `0` | Pagination offset |

Results are ordered by `position ASC`.

**Response:**
```json
{
  "data": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
      "project_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "milestone_id": null,
      "parent_id": null,
      "display_id": "MSA-1",
      "title": "Implement OAuth login",
      "description": "Add Google and GitHub OAuth providers",
      "type": "feature",
      "status": "todo",
      "priority": "high",
      "source": "web",
      "reporter_name": null,
      "reporter_email": null,
      "assignee_ids": [],
      "tags": ["auth", "backend"],
      "attachments": [],
      "position": 1000.0,
      "qualified_at": null,
      "qualified_by": null,
      "created_at": "2026-01-15T12:00:00Z",
      "updated_at": "2026-01-15T12:00:00Z"
    }
  ]
}
```

> **Note:** The Rust model renames the DB column `type` to `issue_type` via `#[sqlx(rename = "type")]` and serializes it back as `type` to JSON. The frontend type uses the `type` field name.

---

#### Create Issue

```
POST /issues
```

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "PROJECT_UUID",
    "title": "Fix login timeout bug",
    "description": "Users report being logged out after 5 minutes",
    "type": "bug",
    "priority": "high",
    "tags": ["auth", "urgent"],
    "assignee_ids": ["user_abc123"]
  }' \
  https://api.baaton.dev/api/v1/issues | jq
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | UUID | ✅ | Parent project |
| `title` | string | ✅ | Issue title |
| `description` | string | ❌ | Markdown description |
| `type` | enum | ❌ | `bug` / `feature` / `improvement` / `question` (default: `feature`) |
| `priority` | enum | ❌ | `urgent` / `high` / `medium` / `low` |
| `milestone_id` | UUID | ❌ | Associated milestone |
| `parent_id` | UUID | ❌ | Parent issue (for sub-tasks) |
| `tags` | string[] | ❌ | Label tags |
| `assignee_ids` | string[] | ❌ | Assigned user IDs |

**Auto-generated fields:**
- `display_id` — Computed as `{project.prefix}-{count+1}` (e.g., `MSA-1`)
- `position` — Set to `MAX(position) + 1000` within the status column, or `1000` if first
- `source` — Always `"web"` for this endpoint
- `status` — Defaults to `"todo"`

**Response:** `200` with the created issue object.

---

#### Get Issue

```
GET /issues/{id}
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/issues/$ISSUE_ID | jq
```

Returns a single issue with full details.

**Response:** Issue object.

---

#### Update Issue

```
PATCH /issues/{id}
```

```bash
# Change status
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' \
  https://api.baaton.dev/api/v1/issues/$ISSUE_ID | jq

# Update multiple fields
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated title", "priority": "urgent", "status": "in_progress"}' \
  https://api.baaton.dev/api/v1/issues/$ISSUE_ID | jq
```

Updatable fields (all optional):

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Issue title |
| `description` | string | Markdown description |
| `type` | enum | `bug` / `feature` / `improvement` / `question` |
| `status` | enum | `backlog` / `todo` / `in_progress` / `in_review` / `done` / `cancelled` |

> **Current implementation note:** The `PATCH /issues/{id}` handler uses `COALESCE` for `title`, `description`, `type`, and `status`. Fields like `priority`, `milestone_id`, `assignee_ids`, and `tags` are defined in the `UpdateIssue` model but not yet wired in the SQL query. See `backend/src/routes/issues.rs`.

**Response:** Updated issue object (with `updated_at` refreshed).

---

#### Update Issue Position (Drag & Drop)

```
PATCH /issues/{id}/position
```

Used by the Kanban board for drag-and-drop reordering.

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress", "position": 2500.0}' \
  https://api.baaton.dev/api/v1/issues/$ISSUE_ID | jq
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | ✅ | Target column status (default: `"todo"` if missing) |
| `position` | float | ✅ | Fractional position within column (default: `1000.0` if missing) |

Position uses **fractional indexing** — the frontend calculates the midpoint between adjacent cards:

```
Card A: position = 1000
Card B: position = 2000
Card C: position = 3000

Insert between A and B → position = 1500
Insert at start       → position = 500
Insert at end         → position = 4000
```

**Response:** Updated issue object.

---

#### Delete Issue

```
DELETE /issues/{id}
```

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/issues/$ISSUE_ID | jq
```

**Response:** `200` with `{ "data": null }`.

---

### Public Endpoints

These endpoints require **no authentication** and are rate-limited.

#### Submit Public Issue

```
POST /public/{project_slug}/submit
```

Used by the public feedback form at `/submit/{slug}`. Resolves the project by slug.

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Login button doesn'\''t work on mobile",
    "description": "When I tap the login button on iPhone Safari, nothing happens.",
    "type": "bug",
    "reporter_name": "Jane Doe",
    "reporter_email": "jane@example.com"
  }' \
  https://api.baaton.dev/api/v1/public/my-project/submit | jq
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Brief summary |
| `description` | string | ❌ | Detailed description (markdown) |
| `type` | string | ❌ | `bug` / `feature` / `improvement` / `question` (default: `bug`) |
| `reporter_name` | string | ❌ | Submitter's name |
| `reporter_email` | string | ❌ | Submitter's email |

**Auto-generated fields:**
- `display_id` — `{project.prefix}-{count+1}`
- `source` — Always `"form"`
- `position` — Set to `99999` (end of backlog)

**Response:** `200` with the created issue object.

---

### API Keys

> **Note:** API key endpoints (`/api-keys`) are defined in the frontend types and `useApi` hook but the backend route handlers are not yet implemented. The database schema and models are ready.

#### List API Keys

```
GET /api-keys
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/api-keys | jq
```

Returns all API keys for the organization (keys are masked — only the prefix is shown).

**Response:**
```json
{
  "data": [
    {
      "id": "c3d4e5f6-a7b8-9012-cdef-345678901234",
      "org_id": "org_2abc123",
      "name": "claude-code-agent",
      "key_prefix": "baa_abc1",
      "permissions": ["read", "write"],
      "last_used_at": "2026-02-08T15:30:00Z",
      "expires_at": null,
      "created_at": "2026-01-20T09:00:00Z"
    }
  ]
}
```

#### Create API Key

```
POST /api-keys
```

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-code-agent", "permissions": ["read", "write"]}' \
  https://api.baaton.dev/api/v1/api-keys | jq
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Descriptive name for the key |
| `permissions` | string[] | ❌ | Permissions (default: `["read", "write"]`) |

**Response:** `200` with the API key object **including the full key**:

```json
{
  "data": {
    "id": "c3d4e5f6-a7b8-9012-cdef-345678901234",
    "name": "claude-code-agent",
    "key": "baa_abc123def456ghi789jkl012mno345",
    "key_prefix": "baa_abc1",
    "permissions": ["read", "write"],
    "created_at": "2026-01-20T09:00:00Z"
  }
}
```

⚠️ The full `key` field is **only returned at creation time**. Store it securely.

#### Revoke API Key

```
DELETE /api-keys/{id}
```

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
  https://api.baaton.dev/api/v1/api-keys/$KEY_ID | jq
```

Immediately revokes the key. Agents using it will receive `401` errors.

**Response:** `200` with empty data.

---

## Data Types

### Issue Status Values

| Status | Description | Default Kanban Column |
|--------|-------------|----------------------|
| `backlog` | Not yet planned | Hidden by default |
| `todo` | Planned, ready to work | Visible |
| `in_progress` | Currently being worked on | Visible |
| `in_review` | Work done, pending review | Visible |
| `done` | Completed | Visible |
| `cancelled` | Won't do | Hidden by default |

Statuses are stored as customizable JSONB on the project (see `projects.statuses`).

### Issue Type Values

| Type | Description |
|------|-------------|
| `bug` | Something is broken |
| `feature` | New functionality |
| `improvement` | Enhance existing functionality |
| `question` | Needs clarification |

### Issue Priority Values

| Priority | Description |
|----------|-------------|
| `urgent` | Drop everything |
| `high` | Do soon |
| `medium` | Normal priority |
| `low` | Nice to have |

### Issue Source Values

| Source | Description |
|--------|-------------|
| `web` | Created via web UI |
| `api` | Created via API/agent |
| `form` | Created via public form |
| `email` | Created via email integration |

### Tests Status Values (TLDRs)

| Status | Description |
|--------|-------------|
| `passed` | All tests pass |
| `failed` | Some tests fail |
| `skipped` | Tests not run |
| `none` | No tests applicable |

---

## Database Schema

Defined in `backend/migrations/001_init.sql` and `002_sprints.sql`:

| Table | Description |
|-------|-------------|
| `organizations` | Clerk orgs (synced via webhook) |
| `projects` | Org-scoped projects with custom statuses (JSONB) |
| `milestones` | Per-project milestones/versions |
| `sprints` | Optional sprint groupings (added in migration 002) |
| `issues` | Core tickets with position ordering |
| `tldrs` | Agent work summaries (one-to-many per issue) |
| `comments` | Threaded comments on issues |
| `api_keys` | SHA-256 hashed keys per org |
| `activity_log` | Append-only audit trail |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for entity relationships and design decisions.

---

## Complete Examples

### cURL — Full Agent Workflow

```bash
export TOKEN="baa_your_api_key"
export API="https://api.baaton.dev/api/v1"

# 1. List projects
curl -s -H "Authorization: Bearer $TOKEN" "$API/projects" | jq '.data[] | {id, name, prefix}'

# 2. Get todo issues from a project
export PROJECT_ID="your-project-uuid"
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/projects/$PROJECT_ID/issues?status=todo&limit=5" | jq '.data[] | {id, display_id, title, priority}'

# 3. Claim an issue (set to in_progress)
export ISSUE_ID="issue-uuid-here"
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' \
  "$API/issues/$ISSUE_ID" | jq

# 4. Submit for review
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review"}' \
  "$API/issues/$ISSUE_ID" | jq

# 5. Public form submission (no auth)
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"title":"Button broken","type":"bug","reporter_name":"User"}' \
  "$API/public/my-project/submit" | jq
```

### JavaScript / TypeScript

```typescript
const API_BASE = 'https://api.baaton.dev/api/v1';
const API_KEY = 'baa_your_key_here';

async function baaton<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json.data;
}

// List todo issues
const issues = await baaton<Issue[]>('GET', `/projects/${projectId}/issues?status=todo`);

// Update status
await baaton('PATCH', `/issues/${issueId}`, { status: 'in_progress' });
```

### Python

```python
import requests

API_BASE = "https://api.baaton.dev/api/v1"
HEADERS = {"Authorization": f"Bearer {api_key}"}

# List todo issues
resp = requests.get(f"{API_BASE}/projects/{project_id}/issues",
                    headers=HEADERS, params={"status": "todo"})
issues = resp.json()["data"]

# Update issue status
requests.patch(f"{API_BASE}/issues/{issue_id}",
               headers=HEADERS, json={"status": "in_progress"})
```
