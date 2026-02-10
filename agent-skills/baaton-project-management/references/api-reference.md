# Baaton API Reference

Base URL: `https://api.baaton.dev/api/v1`

All requests require `Authorization: Bearer baa_xxx` header.
All responses wrapped in `{"data": ...}`. Errors return `{"error": "message"}`.

---

## Projects

### List Projects
```
GET /projects
```
Returns all projects in the authenticated org.

**Response:**
```json
{"data": [{"id": "uuid", "org_id": "org_xxx", "name": "My Project", "slug": "my-project", "description": "...", "prefix": "MP", "statuses": [...], "created_at": "2026-01-01T00:00:00Z"}]}
```

### Create Project
```
POST /projects
```
**Body:**
```json
{"name": "My Project", "slug": "my-project", "prefix": "MP", "description": "optional"}
```

### Get Project
```
GET /projects/{id}
```

### Update Project
```
PATCH /projects/{id}
```
**Body:** `{"name": "New Name", "description": "New desc"}`

### Delete Project
```
DELETE /projects/{id}
```

---

## Issues

### List Issues by Project
```
GET /projects/{project_id}/issues
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter: backlog, todo, in_progress, in_review, done, cancelled |
| `priority` | string | Filter: urgent, high, medium, low |
| `type` | string | Filter: bug, feature, improvement, question |
| `search` | string | Title search (ILIKE) |
| `category` | string | Filter by category tag |
| `limit` | int | Max results (default 100) |
| `offset` | int | Pagination offset |

**Response:**
```json
{"data": [{"id": "uuid", "project_id": "uuid", "display_id": "MP-1", "title": "Fix login", "description": "...", "issue_type": "bug", "status": "todo", "priority": "high", "source": "web", "tags": ["backend"], "category": [], "assignee_ids": [], "position": 1000.0, "milestone_id": null, "parent_id": null, "due_date": null, "created_at": "...", "updated_at": "..."}]}
```

### List My Issues
```
GET /issues/mine?assignee_id=USER_ID
```
Returns issues assigned to the specified ID, sorted by priority.

### Create Issue
```
POST /issues
```
**Body:**
```json
{
  "project_id": "uuid (required)",
  "title": "string (required)",
  "description": "markdown string",
  "type": "bug|feature|improvement|question (default: feature)",
  "status": "backlog|todo|... (default: backlog)",
  "priority": "urgent|high|medium|low",
  "milestone_id": "uuid",
  "parent_id": "uuid",
  "tags": ["backend", "urgent"],
  "category": ["api"],
  "assignee_ids": ["user_id"],
  "due_date": "2026-03-01"
}
```

### Get Issue (with TLDRs + Comments)
```
GET /issues/{id}
```
**Response:**
```json
{
  "data": {
    "id": "uuid",
    "display_id": "MP-1",
    "title": "Fix login",
    "status": "in_progress",
    "tldrs": [{"id": "uuid", "agent_name": "claude-code", "summary": "...", "files_changed": ["src/auth.rs"], "tests_status": "passed", "pr_url": "https://...", "created_at": "..."}],
    "comments": [{"id": "uuid", "author_name": "haroz", "body": "...", "created_at": "..."}]
  }
}
```

### Update Issue
```
PATCH /issues/{id}
```
**Body (all fields optional):**
```json
{
  "title": "string",
  "description": "markdown",
  "type": "bug|feature|improvement|question",
  "status": "backlog|todo|in_progress|in_review|done|cancelled",
  "priority": "urgent|high|medium|low",
  "tags": ["new-tags"],
  "assignee_ids": ["user_id"],
  "milestone_id": "uuid or null",
  "category": ["api"],
  "due_date": "2026-03-01 or null",
  "attachments": []
}
```
Note: To clear `priority`, `milestone_id`, or `due_date`, send `null` explicitly.

### Delete Issue
```
DELETE /issues/{id}
```

### Update Issue Position (Drag & Drop)
```
PATCH /issues/{id}/position
```
**Body:** `{"status": "in_progress", "position": 2000.0}`

---

## TLDRs (Agent Work Summaries)

### Post TLDR
```
POST /issues/{issue_id}/tldr
```
**Body:**
```json
{
  "agent_name": "claude-code (required)",
  "summary": "markdown summary of work done (required)",
  "files_changed": ["src/main.rs", "tests/test_auth.rs"],
  "tests_status": "passed|failed|skipped|none (default: none)",
  "pr_url": "https://github.com/org/repo/pull/42"
}
```

---

## Comments

### List Comments
```
GET /issues/{issue_id}/comments
```

### Add Comment
```
POST /issues/{issue_id}/comments
```
**Body:**
```json
{
  "author_id": "string (required)",
  "author_name": "string (required)",
  "body": "markdown comment (required)"
}
```

---

## Activity Log

### Issue Activity
```
GET /issues/{issue_id}/activity?limit=50
```

### Recent Org Activity
```
GET /activity?limit=30
```

**Response:**
```json
{"data": [{"id": "uuid", "issue_id": "uuid", "user_id": "...", "user_name": "claude-code", "action": "status_changed", "field": "status", "old_value": "todo", "new_value": "in_progress", "metadata": {}, "created_at": "..."}]}
```

---

## Milestones

### List Milestones
```
GET /projects/{project_id}/milestones
```
Returns milestones with issue counts (total, done, by type).

### Create Milestone
```
POST /projects/{project_id}/milestones
```
**Body:**
```json
{
  "name": "v1.0 Launch (required)",
  "description": "optional",
  "target_date": "2026-03-01",
  "status": "active|completed|cancelled (default: active)",
  "order": 0,
  "estimated_days": 14
}
```

### Get Milestone (with Issues)
```
GET /milestones/{id}
```
Returns milestone details + all linked issues.

### Update Milestone
```
PUT /milestones/{id}
```
**Body (all optional):**
```json
{"name": "...", "description": "...", "target_date": "2026-03-01", "status": "completed", "order": 1, "estimated_days": 7}
```

### Delete Milestone
```
DELETE /milestones/{id}
```

---

## Sprints

### List Sprints
```
GET /projects/{project_id}/sprints
```

### Create Sprint
```
POST /projects/{project_id}/sprints
```
**Body:**
```json
{
  "name": "Sprint 1 (required)",
  "goal": "optional sprint goal",
  "start_date": "2026-02-10",
  "end_date": "2026-02-24",
  "status": "planning|active|completed (default: planning)"
}
```

### Update Sprint
```
PUT /sprints/{id}
```
**Body (all optional):**
```json
{"name": "...", "goal": "...", "start_date": "2026-02-10", "end_date": "2026-02-24", "status": "active"}
```

### Delete Sprint
```
DELETE /sprints/{id}
```

---

## Tags

### List Project Tags
```
GET /projects/{project_id}/tags
```

### Create Tag
```
POST /projects/{project_id}/tags
```
**Body:** `{"name": "backend", "color": "#3b82f6"}`

Upserts — if tag name exists, updates color.

### Delete Tag
```
DELETE /tags/{id}
```

---

## Public Submission (No Auth)

### Submit Issue
```
POST /public/{project_slug}/submit
```
**Body:**
```json
{
  "title": "Bug report (required)",
  "description": "optional details",
  "type": "bug|feature|improvement|question",
  "reporter_name": "optional",
  "reporter_email": "optional"
}
```
Rate limited: 10 req/hour per IP.
