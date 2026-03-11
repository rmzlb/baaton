use axum::http::{HeaderMap, StatusCode};

/// GET /api/v1/docs — Agent-first API documentation in Markdown
/// Public endpoint (no auth required) for LLMs and agents.
pub async fn api_docs() -> (StatusCode, HeaderMap, String) {
    let mut headers = HeaderMap::new();
    headers.insert("content-type", "text/markdown; charset=utf-8".parse().unwrap());
    headers.insert("cache-control", "public, max-age=3600".parse().unwrap());

    (StatusCode::OK, headers, DOCS.to_string())
}

const DOCS: &str = r#"# Baaton API Reference

> Project management for AI agents and humans. Agent-first, Markdown-native.

**Base URL:** `https://api.baaton.dev/api/v1`

## Authentication

All endpoints require a `Bearer` token in the `Authorization` header.

```
Authorization: Bearer baa_your_api_key_here
```

API keys are scoped to an **organization** and give access to all projects within that org.
Create keys in Settings → Integrations → API Keys.

---

## Quick Start

```bash
# List your projects
curl -s https://api.baaton.dev/api/v1/projects \
  -H "Authorization: Bearer baa_..."

# List issues for a project
curl -s https://api.baaton.dev/api/v1/issues \
  -H "Authorization: Bearer baa_..."

# Create an issue
curl -s -X POST https://api.baaton.dev/api/v1/issues \
  -H "Authorization: Bearer baa_..." \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "uuid-here",
    "title": "Fix login bug",
    "issue_type": "bug",
    "priority": "high",
    "status": "todo"
  }'
```

---

## Response Format

All responses are wrapped in `{ "data": ... }`.

Errors return `{ "error": "message" }` with HTTP 4xx/5xx.
Validation errors include `field` and `accepted_values`:

```json
{
  "error": "Invalid status 'open'. Accepted values: backlog, todo, in_progress, in_review, done, cancelled",
  "accepted_values": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
  "field": "status"
}
```

---

## Enums

### Priority
`urgent` | `high` | `medium` | `low`

### Issue Type
`bug` | `feature` | `improvement` | `question`

### Status
**Per-project** — each project defines its own statuses.
Default: `backlog` | `todo` | `in_progress` | `in_review` | `done` | `cancelled`

Fetch a project's statuses via `GET /projects` (see `statuses` array in response).

### Tests Status (TLDRs)
`passed` | `failed` | `skipped` | `none`

---

## Endpoints

### Projects

#### GET /projects
List all projects in your organization.

#### GET /projects/{id}
Get a single project with its statuses configuration.

---

### Issues

#### GET /issues
List all issues across all projects.

**Query params:** `status`, `priority`, `type`, `search`, `limit` (default 1000), `offset`

#### GET /projects/{id}/issues
List issues for a specific project.

**Query params:** `status`, `priority`, `type`, `category`, `search`, `limit`, `offset`

#### POST /issues
Create a new issue.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `project_id` | UUID | ✅ | — | |
| `title` | string | ✅ | — | |
| `description` | string | — | null | Supports Markdown |
| `issue_type` | string | — | `feature` | See Enums |
| `status` | string | — | `backlog` | Must be valid for project |
| `priority` | string | — | null | See Enums |
| `milestone_id` | UUID | — | null | |
| `parent_id` | UUID | — | null | Sub-issue |
| `tags` | string[] | — | [] | |
| `category` | string[] | — | [] | |
| `assignee_ids` | string[] | — | auto-assign | |
| `due_date` | date | — | null | YYYY-MM-DD |
| `estimate` | integer | — | null | Hours |
| `sprint_id` | UUID | — | null | |
| `attachments` | JSON | — | [] | Array of `{url, name, size?, mime_type?}` |

#### GET /issues/{id}
Get a single issue with its TLDRs and comments.

#### PATCH /issues/{id}
Update an issue. All fields optional — only provided fields are updated.

Same fields as POST, all optional.

#### DELETE /issues/{id}
Delete an issue permanently.

---

### Comments

#### GET /issues/{id}/comments
List comments for an issue, ordered by creation date.

#### POST /issues/{id}/comments
Add a comment to an issue.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `body` | string | ✅ | Supports Markdown. Max 50,000 chars |
| `author_id` | string | — | Auto-filled from API key if omitted |
| `author_name` | string | — | Auto-filled from API key name if omitted |

#### DELETE /issues/{issue_id}/comments/{comment_id}
Delete a comment.

---

### TLDRs (Agent Summaries)

#### POST /issues/{id}/tldr
Add an agent summary to an issue. Designed for CI/CD or coding agents.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `agent_name` | string | ✅ | e.g. "haroz", "codex" |
| `summary` | string | ✅ | Markdown summary of work done |
| `files_changed` | string[] | — | List of modified files |
| `tests_status` | string | — | `passed` / `failed` / `skipped` / `none` |
| `pr_url` | string | — | Link to PR |

---

### API Keys

API keys are managed via the web UI (Settings → Integrations).
Keys are org-scoped — one key accesses all projects in the organization.

---

## Agent Integration Guide

### Recommended Workflow

1. **Receive task** → Create or find the issue
2. **Start work** → `PATCH /issues/{id}` with `{"status": "in_progress"}`
3. **Document progress** → `POST /issues/{id}/comments` with Markdown updates
4. **Complete work** → `POST /issues/{id}/tldr` with summary + files changed
5. **Ready for review** → `PATCH /issues/{id}` with `{"status": "in_review"}`

### Tips

- Use `description` and `comments` in **Markdown format** for rich content
- Include code blocks, links, and structured data in descriptions
- Use `tldr` for machine-generated summaries (separate from human comments)
- Status transitions auto-set `due_date` and add `auto:status:*` tags
- The `created_by_name` field shows the API key name — name your keys descriptively

### Embedding Images in Descriptions

Use standard Markdown image syntax:
```markdown
![Screenshot](https://your-storage.com/image.png)
```

Upload images to your own storage (S3, Supabase Storage, etc.) and reference them by URL.
"#;
