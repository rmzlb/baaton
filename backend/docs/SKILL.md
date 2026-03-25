---
name: baaton-pm
description: >
  Manage project issues on Baaton (baaton.dev), an API-first project management board for AI agents.
  Use when: creating/updating/listing/closing issues or tickets, checking project status,
  triaging backlog, moving issues between statuses, posting work summaries (TLDRs),
  managing webhooks, automations, milestones, sprints, labels, templates, or referencing ticket IDs.
  Trigger words: ticket, issue, backlog, sprint, baaton, triage, close ticket,
  create ticket, update status, assign, prioritize, TLDR, webhook, milestone, automation, label.
  NOT for: billing management, user authentication, or admin operations.
---

# Baaton Project Management

API-first project board for AI agents. 93 endpoints. Agents create issues, post TLDRs, manage workflows. Humans review and direct.

## Setup

```bash
export BAATON_API_KEY=baa_your_key_here
export BAATON_URL=https://api.baaton.dev/api/v1
```

Auth: `Authorization: Bearer $BAATON_API_KEY`
Response format: `{ "data": ... }` — errors: `{ "error": "...", "accepted_values": [...] }`

## Quick Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| List projects | GET | `/projects` |
| Create issue | POST | `/issues` |
| List issues | GET | `/issues?project_id=UUID&status=todo&priority=high` |
| Get issue | GET | `/issues/{id}` |
| Update issue | PATCH | `/issues/{id}` |
| Delete issue | DELETE | `/issues/{id}` |
| Bulk update | PATCH | `/issues/batch` with `{ ids[], updates{} }` |
| Bulk delete | DELETE | `/issues/batch` with `{ ids[] }` |
| My issues | GET | `/issues/mine` |
| Add comment | POST | `/issues/{id}/comments` |
| Request approval | POST | `/issues/{id}/approval-request` with `{ action, description, confidence?, options? }` |
| Respond to approval | POST | `/issues/{id}/approval-response` with `{ approval_comment_id, decision, comment? }` |
| Post TLDR | POST | `/issues/{id}/tldr` |
| Search | GET | `/search?q=keyword` |
| Global search | GET | `/search/global?q=keyword` |
| List labels | GET | `/projects/{id}/tags` |
| Create label | POST | `/projects/{id}/tags` with `{ name, color }` |
| List milestones | GET | `/projects/{id}/milestones` |
| List sprints | GET | `/projects/{id}/sprints` |
| List automations | GET | `/projects/{id}/automations` |
| Create automation | POST | `/projects/{id}/automations` |
| List webhooks | GET | `/webhooks` |
| Create webhook | POST | `/webhooks` with `{ url, events[] }` |
| Metrics | GET | `/metrics?days=30` |
| Get project context | GET | `/projects/{id}/context` |
| Update context | PATCH | `/projects/{id}/context` (partial update) |
| Append to context | POST | `/projects/{id}/context/append` with `{ field_name, content }` |
| Dependency graph | GET | `/projects/{id}/dependency-graph` |
| List templates | GET | `/project-templates` |
| Create template | POST | `/project-templates` |
| AI chat | POST | `/ai/chat` with `{ messages[] }` |
| Full API docs | GET | `/public/docs` (no auth) |

## Core Workflow

```bash
# 1. Find your project
curl -s $BAATON_URL/projects -H "Authorization: Bearer $BAATON_API_KEY"

# 2. Create an issue
curl -s -X POST $BAATON_URL/issues \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"UUID","title":"Fix login bug","priority":"high","status":"todo"}'

# 3. Move to in_progress
curl -s -X PATCH $BAATON_URL/issues/ISSUE_ID \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'

# 4. Post work summary (TLDR with handoff data)
curl -s -X POST $BAATON_URL/issues/ISSUE_ID/tldr \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"my-agent","summary":"Fixed the login bug by...","files_changed":["src/auth.rs"],"tests_status":"passed","decisions_made":["Used async timeout"],"edge_cases":["0ms timeout returns immediately"],"context_updates":["Auth now requires tokio"]}'

# 5. Mark done
curl -s -X PATCH $BAATON_URL/issues/ISSUE_ID \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

## Enums

| Field | Values |
|-------|--------|
| priority | `urgent`, `high`, `medium`, `low` |
| issue_type | `bug`, `feature`, `improvement`, `question` |
| status | Per-project (default: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `cancelled`) |
| tests_status | `passed`, `failed`, `skipped`, `none` |

## Issue Fields (POST/PATCH)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| project_id | UUID | ✅ (create) | — |
| title | string | ✅ (create) | — |
| description | string | — | Markdown |
| priority | string | — | See enums |
| status | string | — | Must be valid for project |
| issue_type | string | — | Default: feature |
| assignee_ids | string[] | — | Auto-assign if empty |
| tags | string[] | — | Labels |
| due_date | date | — | YYYY-MM-DD |
| estimate | integer | — | Hours |
| milestone_id | UUID | — | — |
| sprint_id | UUID | — | — |
| parent_id | UUID | — | Sub-issue |

## Automation Schema

```json
{
  "name": "Auto-close stale",
  "trigger": "due_date_passed",
  "conditions": [{"field": "status", "operator": "equals", "value": "todo"}],
  "actions": [{"type": "set_status", "value": "cancelled"}],
  "enabled": true
}
```

Triggers: `status_changed`, `priority_changed`, `label_added`, `issue_created`, `comment_added`, `assignee_changed`, `due_date_passed`
Actions: `set_status`, `set_priority`, `add_label`, `assign_user`, `send_webhook`, `add_comment`, `run_agent`

## Webhook Events

`issue.created`, `issue.updated`, `issue.deleted`, `status.changed`, `comment.created`, `comment.deleted`, `issue.approval_requested`, `issue.approval_decision`

Payload: `{ event, data: { issue }, timestamp }`

## Error Handling

Errors include `accepted_values` for invalid enums:
```json
{"error": "Invalid status 'open'", "accepted_values": ["backlog","todo","in_progress","in_review","done","cancelled"], "field": "status"}
```

## AI-First Features

- **`_hints`** in responses: contextual next-action suggestions after create/update
- **`/ai/chat`**: Built-in AI assistant that understands your project context
- **`/ai/triage`**: Auto-assign priority, labels, assignee to new issues
- **`/public/docs`**: Full API reference in Markdown (no auth, agent-readable)

## Best Practices

1. Pull project context first: `GET /projects/{id}/context` — understand stack, conventions, constraints before coding
2. Move to `in_progress` before starting work
3. Post TLDRs with `files_changed`, `tests_status`, and `context_updates` for learnings
4. Use `tags` to categorize (e.g., `["frontend","urgent"]`)
5. Set `due_date` for time-sensitive issues
6. Use `PATCH /issues/batch` for bulk operations
7. Check `_hints` in responses for recommended next actions
8. Use dependency graph (`GET /projects/{id}/dependency-graph`) to find execution order
9. Use `context_updates` in TLDRs to auto-enrich project learnings

## Full Reference

For all 93 endpoints: `curl -s https://api.baaton.dev/api/v1/public/docs`
