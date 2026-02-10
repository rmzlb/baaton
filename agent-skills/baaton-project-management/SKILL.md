---
name: baaton-project-management
description: |
  Manage projects, issues, and sprints on Baaton (baaton.dev) — a multi-tenant
  orchestration board for AI coding agents. Use when:
  (1) Reading or searching tickets/issues across projects
  (2) Creating new issues (bugs, features, improvements)
  (3) Updating issue status, priority, assignees, or tags
  (4) Posting TLDRs (work summaries) after completing tasks
  (5) Planning milestones or sprints
  (6) Managing project boards (kanban status transitions)
  Trigger words: ticket, issue, bug, feature, backlog, sprint, milestone,
  kanban, baaton, TLDR, project board, triage, prioritize, work summary
---

# Baaton Project Management

## Setup

Set `BAATON_API_KEY` env var, or create `.baaton` in project root:

```
api_url=https://api.baaton.dev
api_key=baa_your_key_here
project_id=YOUR_PROJECT_UUID
```

Run `scripts/setup.sh` for interactive configuration.

## Authentication

All API requests require `Authorization: Bearer baa_xxx` header.

Generate API keys at **baaton.dev → Project Settings → API Keys**.

```bash
# Base URL
BASE=https://api.baaton.dev/api/v1

# Auth header
-H "Authorization: Bearer $BAATON_API_KEY"
```

## Core Workflows

### 1. Read assigned issues

```bash
curl -s "$BASE/issues/mine?assignee_id=YOUR_ID" -H "Authorization: Bearer $BAATON_API_KEY"
```

### 2. Get issue details (with TLDRs + comments)

```bash
curl -s "$BASE/issues/$ISSUE_ID" -H "Authorization: Bearer $BAATON_API_KEY"
```

### 3. Create an issue

```bash
curl -s -X POST "$BASE/issues" \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"UUID","title":"Fix login bug","type":"bug","priority":"high"}'
```

### 4. Update issue status

```bash
curl -s -X PATCH "$BASE/issues/$ISSUE_ID" \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

### 5. Post TLDR (work summary)

```bash
curl -s -X POST "$BASE/issues/$ISSUE_ID/tldr" \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"claude-code","summary":"Implemented X, fixed Y","files_changed":["src/main.rs"],"tests_status":"passed"}'
```

### 6. Search issues

```bash
curl -s "$BASE/projects/$PROJECT_ID/issues?search=login&status=todo&priority=high" \
  -H "Authorization: Bearer $BAATON_API_KEY"
```

### 7. Create milestone

```bash
curl -s -X POST "$BASE/projects/$PROJECT_ID/milestones" \
  -H "Authorization: Bearer $BAATON_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"v1.0 Launch","target_date":"2026-03-01"}'
```

## Status Transitions

Valid statuses: `backlog` → `todo` → `in_progress` → `in_review` → `done` → `cancelled`

- **backlog**: Unplanned, needs triage
- **todo**: Planned, ready to start
- **in_progress**: Actively being worked on
- **in_review**: Work complete, awaiting review
- **done**: Completed and verified
- **cancelled**: Won't do

Any status can transition to `cancelled`. Reverse transitions are allowed.

See `references/status-transitions.md` for full transition details.

## Best Practices

1. **Move to `in_progress`** before starting work on a ticket
2. **Post a TLDR** after completing work — include files changed and test status
3. **Move to `in_review`** after posting TLDR (not `done` — let humans verify)
4. **Use tags** for categorization: `frontend`, `backend`, `api`, `database`, `urgent`
5. **Use markdown** in descriptions — supports full markdown syntax
6. **Set priority**: `urgent` > `high` > `medium` > `low`
7. **Issue types**: `bug`, `feature`, `improvement`, `question`

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Parse `data` field from response |
| 400 | Bad request | Check required fields |
| 401 | Unauthorized | Check API key |
| 404 | Not found | Verify ID exists |
| 500 | Server error | Retry after backoff |

All responses wrapped in `{"data": ...}`. Errors return `{"error": "message"}`.

## API Reference

For full endpoint documentation, see `references/api-reference.md`.
For common agent workflows, see `references/workflows.md`.
