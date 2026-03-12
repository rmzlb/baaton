# Baaton — Complete API Reference for AI Agents

> Project management for AI agents and engineering teams. API-first. Every endpoint. Every field. Every enum.

**Base URL:** `https://api.baaton.dev/api/v1`
**Auth:** `Authorization: Bearer baa_your_api_key_here`
**Response format:** `{ "data": ... }` — errors: `{ "error": "...", "field": "...", "accepted_values": [...] }`
**AI responses include `_hints`:** contextual next-action suggestions for agents.

---

## Enums

- **Priority:** `urgent` | `high` | `medium` | `low`
- **Issue Type:** `bug` | `feature` | `improvement` | `question`
- **Status:** per-project (default: `backlog` | `todo` | `in_progress` | `in_review` | `done` | `cancelled`)
- **Tests Status:** `passed` | `failed` | `skipped` | `none`
- **Webhook Events:** `issue.created` | `issue.updated` | `issue.deleted` | `status.changed` | `comment.created` | `comment.deleted`
- **Automation Triggers:** `status_changed` | `priority_changed` | `label_added` | `issue_created` | `comment_added` | `assignee_changed` | `due_date_passed`
- **Automation Actions:** `set_status` | `set_priority` | `add_label` | `assign_user` | `send_webhook` | `add_comment` | `run_agent`
- **Permissions:** `issues:read` | `issues:write` | `issues:delete` | `projects:read` | `projects:write` | `projects:delete` | `comments:read` | `comments:write` | `comments:delete` | `labels:read` | `labels:write` | `milestones:read` | `milestones:write` | `sprints:read` | `sprints:write` | `automations:read` | `automations:write` | `webhooks:read` | `webhooks:write` | `members:read` | `members:invite` | `ai:chat` | `ai:triage` | `billing:read` | `admin:full`

---

## Projects

### GET /projects
List all projects in your organization.
**Response:** `[{ id, name, slug, prefix, description, statuses[], created_at }]`

### GET /projects/{id}
Get a single project with configuration.

### POST /projects
Create a project.
| Field | Type | Required |
|-------|------|----------|
| name | string | ✅ |
| slug | string | ✅ |
| prefix | string | ✅ (e.g. "HLM") |
| description | string | — |

### PATCH /projects/{id}
Update project name, description, statuses, etc.

### DELETE /projects/{id}
Delete a project and all its issues.

---

## Issues

### GET /issues
List all issues across all projects.
**Params:** `status`, `priority`, `type`, `search`, `assignee_id`, `label`, `limit` (default 1000), `offset`

### GET /projects/{id}/issues
List issues for a specific project.
**Params:** `status`, `priority`, `type`, `category`, `search`, `limit`, `offset`

### GET /issues/{id}
Get a single issue with TLDRs, comments, and relations.

### GET /issues/mine
Get issues assigned to the authenticated user.

### POST /issues
Create an issue.
| Field | Type | Required | Default |
|-------|------|----------|---------|
| project_id | UUID | ✅ | — |
| title | string | ✅ | — |
| description | string | — | null |
| issue_type | string | — | feature |
| status | string | — | backlog |
| priority | string | — | null |
| assignee_ids | string[] | — | auto-assign |
| milestone_id | UUID | — | null |
| sprint_id | UUID | — | null |
| parent_id | UUID | — | null |
| tags | string[] | — | [] |
| category | string[] | — | [] |
| due_date | date | — | null |
| estimate | integer | — | null |
| attachments | JSON[] | — | [] |

### PATCH /issues/{id}
Update an issue. All fields optional.

### DELETE /issues/{id}
Delete an issue.

### PATCH /issues/batch
Bulk update issues: `{ "ids": ["uuid1","uuid2"], "updates": { "status": "done" } }`

### DELETE /issues/batch
Bulk delete: `{ "ids": ["uuid1","uuid2"] }`

### POST /issues/{id}/archive
Archive an issue.

### POST /issues/{id}/unarchive
Unarchive an issue.

### PATCH /issues/{id}/position
Reorder issue in board: `{ "status": "todo", "position": 2 }`

---

## Comments

### GET /issues/{id}/comments
List comments on an issue.

### POST /issues/{id}/comments
Add a comment. Body: `{ "body": "markdown text", "author_id?": "...", "author_name?": "..." }`

### DELETE /issues/{issue_id}/comments/{comment_id}
Delete a comment.

---

## TLDRs (Agent Summaries)

### POST /issues/{id}/tldr
Post an agent work summary.
| Field | Type | Required |
|-------|------|----------|
| agent_name | string | ✅ |
| summary | string | ✅ |
| files_changed | string[] | — |
| tests_status | string | — |
| pr_url | string | — |

---

## Labels / Tags

### GET /projects/{id}/tags
List project labels.

### POST /projects/{id}/tags
Create label: `{ "name": "bug", "color": "#ef4444" }`

### PATCH /tags/{id}
Update label.

### DELETE /tags/{id}
Delete label.

---

## Milestones

### GET /projects/{id}/milestones
List milestones for a project.

### POST /projects/{id}/milestones
Create: `{ "name": "v1.0", "due_date": "2026-04-01", "description": "..." }`

### PATCH /milestones/{id}
Update milestone.

### DELETE /milestones/{id}
Delete milestone.

---

## Sprints

### GET /projects/{id}/sprints
List sprints.

### POST /projects/{id}/sprints
Create sprint: `{ "name": "Sprint 1", "start_date": "...", "end_date": "...", "goal": "..." }`

### PATCH /sprints/{id}
Update sprint.

### DELETE /sprints/{id}
Delete sprint.

---

## Cycles

### GET /projects/{id}/cycles
List cycles.

### PATCH /cycles/{id}
Update cycle.

### POST /cycles/{id}/complete
Complete a cycle.

---

## Initiatives

### GET /initiatives
List initiatives (cross-project epics).

### POST /initiatives
Create: `{ "name": "Q1 Goals", "description": "..." }`

### GET /initiatives/{id}
Get initiative details.

### PATCH /initiatives/{id}
Update initiative.

### DELETE /initiatives/{id}
Delete initiative.

### POST /initiatives/{id}/projects
Link project to initiative: `{ "project_id": "..." }`

### DELETE /initiatives/{id}/projects/{project_id}
Unlink project.

---

## Automations

### GET /projects/{id}/automations
List automations for a project.

### POST /projects/{id}/automations
Create automation:
```json
{
  "name": "Auto-close stale issues",
  "trigger": "due_date_passed",
  "conditions": [{"field": "status", "operator": "equals", "value": "todo"}],
  "actions": [{"type": "set_status", "value": "cancelled"}],
  "enabled": true
}
```

### PATCH /automations/{id}
Update automation (name, trigger, conditions, actions, enabled).

### DELETE /automations/{id}
Delete automation.

---

## Webhooks

### GET /webhooks
List webhook subscriptions.

### POST /webhooks
Create: `{ "url": "https://...", "events": ["issue.created", "status.changed"], "secret": "optional" }`

### PATCH /webhooks/{id}
Update webhook.

### DELETE /webhooks/{id}
Delete webhook.

---

## Recurring Issues

### GET /projects/{id}/recurring
List recurring issue templates.

### POST /projects/{id}/recurring
Create: `{ "title": "Weekly review", "cron": "0 9 * * 1", "template": {...} }`

### PATCH /recurring/{id}
Update recurring template.

### DELETE /recurring/{id}
Delete template.

### POST /recurring/{id}/trigger
Manually trigger a recurring issue.

---

## SLA Rules

### GET /projects/{id}/sla-rules
List SLA rules.

### POST /projects/{id}/sla-rules
Create SLA: `{ "name": "Urgent 4h", "priority": "urgent", "response_hours": 4, "resolution_hours": 24 }`

### PATCH /sla-rules/{id}
Update rule.

### DELETE /sla-rules/{id}
Delete rule.

### GET /projects/{id}/sla-stats
Get SLA compliance stats.

---

## Templates

### GET /projects/{id}/templates
List issue templates.

### POST /projects/{id}/templates
Create template: `{ "name": "Bug Report", "template": { "title": "...", "description": "...", "priority": "high" } }`

### PATCH /templates/{id}
Update template.

### DELETE /templates/{id}
Delete template.

---

## Views (Saved Filters)

### GET /views
List saved views.

### POST /views
Create: `{ "name": "My urgent bugs", "filters": { "priority": "urgent", "type": "bug" } }`

### GET /views/{id}/issues
Get issues matching a saved view.

### PATCH /views/{id}
Update view.

### DELETE /views/{id}
Delete view.

---

## Issue Relations

### GET /issues/{id}/relations
List related issues.

### POST /issues/{id}/relations
Create: `{ "target_issue_id": "...", "relation_type": "blocks" }`

### DELETE /issues/{id}/relations/{relation_id}
Remove relation.

---

## Issue Children (Sub-issues)

### GET /issues/{id}/children
List sub-issues of a parent.

---

## Attachments

### GET /issues/{id}/attachments
List attachments.

### POST /issues/{id}/attachments
Add attachment: `{ "url": "...", "name": "screenshot.png", "size": 1024, "mime_type": "image/png" }`

### DELETE /issues/{id}/attachments/{att_id}
Remove attachment.

---

## Activity Log

### GET /issues/{id}/activity
Get activity history for an issue.

### GET /activity
Get org-wide activity feed.

---

## Notifications

### GET /notifications
List user notifications.

### GET /notifications/count
Get unread count.

### POST /notifications/{id}/read
Mark as read.

### POST /notifications/read-all
Mark all as read.

### GET /notifications/preferences
Get notification preferences.

### PATCH /notifications/preferences
Update preferences.

---

## Search

### GET /search?q={query}
Full-text search within current org. Supports prefix matching (e.g. "HLM" → HLM-* issues).

### GET /search/global?q={query}
Cross-org search across all user organizations.

---

## AI

### POST /ai/chat
AI chat. Requires `ai:chat` permission.
```json
{
  "messages": [{"role": "user", "content": "List urgent bugs"}],
  "model": "gemini-3-flash-preview",
  "system_instruction": "You are a PM assistant",
  "tools": []
}
```
**Quota:** Free=50/mo, Pro=2000/mo, Enterprise=unlimited. Returns 429 when exceeded.

### GET /ai/key
Get Gemini API key (for frontend use).

### POST /ai/pm-full-review
AI-powered full project review.

### POST /issues/{id}/triage
AI triage: auto-assign priority, labels, assignee.

---

## Billing

### GET /billing
Get plan, usage across all orgs, limits.

### GET /billing/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD
Detailed AI usage: messages, tokens_in/out, by_type, daily breakdown, estimated cost.

---

## API Keys

### GET /api-keys
List org API keys. Requires Clerk JWT (not API key auth).

### POST /api-keys
Create key: `{ "name": "...", "permissions": ["issues:read","issues:write"], "project_ids": [], "expires_at": null }`
**Returns plaintext key once.** Store it immediately.

### PATCH /api-keys/{id}
Update key (name, permissions, project_ids, expires_at).

### POST /api-keys/{id}/regenerate
Regenerate key. Old key immediately revoked.

### DELETE /api-keys/{id}
Revoke key.

---

## Members & Invites

### GET /invites
List pending invites.

### POST /invites
Invite member: `{ "email": "...", "role": "member" }`

### GET /invite/{code}
Accept invite (public endpoint).

---

## Metrics

### GET /metrics?days=30
Project metrics: issues created/closed, velocity, burndown data.

---

## Agent Config

### GET /agent-config
Get autonomous agent settings (Pro plan only).

### PUT /agent-config
Update agent settings: `{ "enabled": true, "auto_triage": true, "auto_assign": true, ... }`

---

## Import / Export

### POST /projects/{id}/import
Import issues from CSV/JSON.

### GET /projects/{id}/export
Export project data.

---

## Public Endpoints (No Auth)

### GET /public/docs
API documentation in Markdown.

### GET /public/skill
Agent skill file (SKILL.md format).

### POST /public/{slug}/submit
Public issue submission form.

### POST /public/{slug}/email-intake
Email-to-issue intake.

### GET /public/resolve/{token}
Resolve a public action token.

---

## GitHub Integration

### POST /github/install
Start GitHub App installation.

### GET /github/callback
OAuth callback.

### GET /github/installation
Get installation status.

### GET /github/repos
List connected repositories.

### GET /github/mappings
List project-repo mappings.

### POST /github/mappings
Create mapping: `{ "project_id": "...", "repo_full_name": "owner/repo" }`

### DELETE /github/mappings/{id}
Remove mapping.

### GET /issues/{id}/github
Get GitHub PR/branch info for an issue.

### POST /projects/{id}/refresh-github
Sync GitHub issues.

---

## Slack Integration

### POST /integrations/slack
Connect Slack workspace.

### GET /integrations/slack/{id}
Get Slack integration.

### GET /integrations/slack/{id}/channels
List Slack channels.

### DELETE /integrations/slack/{id}
Disconnect.

---

## Admin

### PATCH /admin/orgs/{id}/plan
Set org plan (free/pro/enterprise). Admin only.

---

## Pricing

| | Free | Pro | Enterprise |
|---|---|---|---|
| Price | $0/mo | $19/mo (3 users incl.) | On demand |
| Extra users | — | +$19/user/mo | Included |
| Users | 2 | 20+ | Unlimited |
| Orgs | 1 | 5 | Unlimited |
| Projects | 3 | 25 | Unlimited |
| Issues | 500 | Unlimited | Unlimited |
| API/mo | 1,000 | 100,000 | Unlimited |
| AI msgs/mo | 50 | 2,000 | Unlimited |
| API keys | 3 | Unlimited | Unlimited |
| Automations | 3 | Unlimited | Unlimited |
| Webhooks | ❌ | ✅ | ✅ |
| BYOK | ❌ | ✅ | ✅ |
| SAML | ❌ | ❌ | ✅ |

## Agent Workflow

1. `GET /projects` → find your project
2. `POST /issues` → create issue (response includes `_hints` for next steps)
3. `PATCH /issues/{id}` → update status to `in_progress`
4. `POST /issues/{id}/comments` → post progress updates
5. `POST /issues/{id}/tldr` → post completion summary
6. `PATCH /issues/{id}` → set status to `done`
