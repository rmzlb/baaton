---
name: baaton-project-management
description: |
  Manage projects, issues, sprints, and workflows on Baaton (baaton.dev) — a multi-tenant
  orchestration board for AI coding agents. Use when:
  (1) Reading or searching tickets/issues across projects and orgs
  (2) Creating/updating issues (bugs, features, improvements)
  (3) Posting TLDRs (work summaries) after completing tasks
  (4) Planning milestones, sprints, or initiatives
  (5) Managing automations, SLA rules, recurring issues, templates
  (6) Triaging issues with AI suggestions
  (7) Import/export project data
  Trigger words: ticket, issue, bug, feature, backlog, sprint, milestone,
  kanban, baaton, TLDR, project board, triage, prioritize, work summary,
  automation, SLA, recurring, template, initiative, import, export
---

# Baaton Project Management

## Setup

Set `BAATON_API_KEY` env var, or create `.baaton` in project root:

```
api_url=https://api.baaton.dev
api_key=baa_your_key_here
project_id=YOUR_PROJECT_UUID
```

## Authentication

All requests require `Authorization: Bearer baa_xxx` header.
Generate keys at **baaton.dev → API Keys**.

```bash
BASE=https://api.baaton.dev/api/v1
AUTH="-H 'Authorization: Bearer $BAATON_API_KEY'"
```

## Core Workflows

### 1. Search issues (full-text, cross-org)

```bash
# Per-org search
curl -s "$BASE/search?q=login+bug&limit=20" $AUTH

# Cross-org global search (all user's orgs)
curl -s "$BASE/search/global?q=login+bug&limit=30" $AUTH
```

### 2. Create an issue

```bash
curl -s -X POST "$BASE/issues" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"project_id":"UUID","title":"Fix login bug","type":"bug","priority":"high"}'
```

### 3. Update issue

```bash
curl -s -X PATCH "$BASE/issues/$ID" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress","priority":"urgent","assignee_ids":["user_xxx"]}'
```

### 4. Post TLDR (work summary)

```bash
curl -s -X POST "$BASE/issues/$ID/tldr" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"claude-code","summary":"Implemented X","files_changed":["src/main.rs"],"tests_status":"passed"}'
```

### 5. Batch update issues

```bash
curl -s -X PATCH "$BASE/issues/batch" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"issue_ids":["id1","id2"],"status":"done"}'
```

### 6. AI Triage (get suggestions)

```bash
curl -s -X POST "$BASE/issues/$ID/triage" $AUTH
# Returns: suggested_priority, suggested_tags, suggested_assignee, similar_issues, reasoning
```

### 7. Manage initiatives (strategic goals)

```bash
# List
curl -s "$BASE/initiatives" $AUTH

# Create
curl -s -X POST "$BASE/initiatives" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"name":"Q1 Launch","description":"Ship all Q1 features"}'

# Link project
curl -s -X POST "$BASE/initiatives/$INIT_ID/projects/$PROJECT_ID" $AUTH
```

### 8. Manage automations

```bash
# List project automations
curl -s "$BASE/projects/$PID/automations" $AUTH

# Create: when status changes to done → add label "shipped"
curl -s -X POST "$BASE/projects/$PID/automations" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"name":"Auto-label shipped","trigger_type":"status_changed","trigger_config":{"to_status":"done"},"action_type":"add_label","action_config":{"label":"shipped"}}'

# Toggle
curl -s -X PATCH "$BASE/automations/$AUTO_ID" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

### 9. SLA rules & stats

```bash
# List rules
curl -s "$BASE/projects/$PID/sla-rules" $AUTH

# Create rule: urgent = 24h deadline
curl -s -X POST "$BASE/projects/$PID/sla-rules" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"priority":"urgent","deadline_hours":24}'

# Get stats
curl -s "$BASE/projects/$PID/sla-stats" $AUTH
# Returns: achievement_pct, on_time, breached, total
```

### 10. Issue templates

```bash
# List
curl -s "$BASE/projects/$PID/templates" $AUTH

# Create
curl -s -X POST "$BASE/projects/$PID/templates" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"name":"Bug Report","description":"## Steps to Reproduce\n\n## Expected\n\n## Actual","default_priority":"high","default_type":"bug"}'
```

### 11. Recurring issues

```bash
# List
curl -s "$BASE/projects/$PID/recurring" $AUTH

# Create: weekly standup every Monday 9am
curl -s -X POST "$BASE/projects/$PID/recurring" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"title":"Weekly standup notes","cron_expression":"0 9 * * 1","priority":"medium","issue_type":"feature"}'

# Manual trigger
curl -s -X POST "$BASE/recurring/$REC_ID/trigger" $AUTH
```

### 12. Import/Export

```bash
# Export project (JSON)
curl -s "$BASE/projects/$PID/export" $AUTH > project-backup.json

# Import
curl -s -X POST "$BASE/projects/$PID/import" $AUTH \
  -H "Content-Type: application/json" \
  -d @project-backup.json
```

### 13. Issue relations & sub-issues

```bash
# List relations
curl -s "$BASE/issues/$ID/relations" $AUTH

# Create relation (blocks, blocked_by, relates_to, duplicates)
curl -s -X POST "$BASE/issues/$ID/relations" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"target_issue_id":"other_id","relation_type":"blocks"}'

# List sub-issues
curl -s "$BASE/issues/$ID/children" $AUTH
```

### 14. Milestones & sprints

```bash
# Create milestone
curl -s -X POST "$BASE/projects/$PID/milestones" $AUTH \
  -H "Content-Type: application/json" \
  -d '{"name":"v1.0","target_date":"2026-04-01"}'

# List sprints
curl -s "$BASE/projects/$PID/sprints" $AUTH
```

### 15. Notifications

```bash
curl -s "$BASE/notifications" $AUTH
curl -s "$BASE/notifications/count" $AUTH
curl -s -X POST "$BASE/notifications/$NID/read" $AUTH
```

## Status Transitions

Valid: `backlog` → `todo` → `in_progress` → `in_review` → `done` | `cancelled`

## Best Practices

1. **Move to `in_progress`** before starting work
2. **Post a TLDR** after completing — include files changed and test status
3. **Move to `in_review`** (not `done`) — let humans verify
4. **Use AI triage** on new issues to get priority/tag suggestions
5. **Set up automations** for repetitive status transitions
6. **Use SLA rules** to track response time commitments
7. **Create templates** for common issue types

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Parse `data` field |
| 400 | Bad request | Check fields, see `accepted_values` in error |
| 401 | Unauthorized | Check API key |
| 404 | Not found | Verify ID |
| 500 | Server error | Retry with backoff |

All responses: `{"data": ...}`. Errors: `{"error": "message"}`.
