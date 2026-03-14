# Baaton — Complete API Reference for AI Agents

> Project management for AI agents and engineering teams. API-first. Every endpoint. Every field. Every enum.

**Base URL:** `https://api.baaton.dev/api/v1`
**Auth:** `Authorization: Bearer baa_your_api_key_here`
**Response format:** `{ "data": ... }` — errors: `{ "error": "...", "field": "...", "accepted_values": [...] }`
**AI responses include `_hints`:** contextual next-action suggestions for agents.

---

## Quick Start

```bash
# Set your credentials
export BAATON=https://api.baaton.dev/api/v1
export KEY=baa_your_api_key_here

# List projects
curl -s $BAATON/projects -H "Authorization: Bearer $KEY"

# Create an issue
curl -s -X POST $BAATON/issues -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"UUID","title":"Fix login bug","priority":"high","status":"todo"}'

# Update status
curl -s -X PATCH $BAATON/issues/ISSUE_ID -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"status":"in_progress"}'

# Post agent summary
curl -s -X POST $BAATON/issues/ISSUE_ID/tldr -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"my-agent","summary":"Fixed by refactoring auth module","files_changed":["src/auth.rs"],"tests_status":"passed"}'
```

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

```bash
curl -s $BAATON/projects -H "Authorization: Bearer $KEY"
```

Response: `{ "data": [{ "id": "uuid", "name": "My Project", "slug": "my-project", "prefix": "MP", "description": "...", "statuses": [...], "created_at": "2026-01-01T00:00:00Z" }] }`

### GET /projects/{id}
Get a single project with its statuses configuration.

### POST /projects
Create a project: `{ "name": "My Project", "slug": "my-project", "prefix": "MP", "description": "..." }`

### PATCH /projects/{id}
Update project name, description, statuses, etc.

### DELETE /projects/{id}
Delete a project and all its issues.

### GET /projects/{id}/auto-assign
Get auto-assign settings: `{ "mode": "round_robin", "default_assignee_id": "..." }`

### PATCH /projects/{id}/auto-assign
Update: `{ "mode": "off" | "default_assignee" | "round_robin", "default_assignee_id": "..." }`

### GET /projects/{id}/public-submit
Get public issue submission settings.

### PATCH /projects/{id}/public-submit
Update public submit settings.

### GET /projects/by-slug/{slug}/board
Get project board view by slug (kanban columns with issues).

### GET /projects/{id}/burndown
Burndown chart data. Params: `sprint_id`, `days` (default 14).

---

## Issues

### GET /issues
List all issues across all projects.

```bash
# With filters
curl -s "$BAATON/issues?status=todo&priority=urgent&limit=50" -H "Authorization: Bearer $KEY"
```

Params: `status`, `priority`, `type`, `search`, `assignee_id`, `label`, `limit` (default 1000), `offset`

### GET /projects/{id}/issues
List issues for a specific project.
Params: `status`, `priority`, `type`, `category`, `search`, `limit`, `offset`

### GET /issues/{id}
Get a single issue with TLDRs, comments, and relations.

### GET /issues/mine
Get issues assigned to the authenticated user.

### POST /issues
Create an issue.

```bash
curl -s -X POST $BAATON/issues -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "uuid-here",
    "title": "Fix login timeout",
    "description": "Users report timeout after 30s on slow connections",
    "issue_type": "bug",
    "priority": "high",
    "status": "todo",
    "tags": ["backend", "auth"],
    "due_date": "2026-04-01"
  }'
```

Response includes `_hints` with recommended next actions.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| project_id | UUID | yes | — |
| title | string | yes | — |
| description | string | no | null |
| issue_type | string | no | feature |
| status | string | no | backlog |
| priority | string | no | null |
| assignee_ids | string[] | no | auto-assign |
| milestone_id | UUID | no | null |
| sprint_id | UUID | no | null |
| parent_id | UUID | no | null |
| tags | string[] | no | [] |
| category | string[] | no | [] |
| due_date | date | no | null |
| estimate | integer | no | null |
| attachments | JSON[] | no | [] |

### PATCH /issues/{id}
Update an issue. Only provided fields are changed.

```bash
curl -s -X PATCH $BAATON/issues/ISSUE_ID -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"status":"done","priority":"low"}'
```

### DELETE /issues/{id}
Delete an issue permanently.

### PATCH /issues/batch
Bulk update: `{ "ids": ["uuid1","uuid2"], "updates": { "status": "done", "priority": "low" } }`

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
List comments on an issue, ordered by creation date.

### POST /issues/{id}/comments
Add a comment (Markdown supported, max 50,000 chars).

```bash
curl -s -X POST $BAATON/issues/ISSUE_ID/comments -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"## Analysis\nThe root cause is in `auth.rs` line 42.\n\n```rust\nlet timeout = Duration::from_secs(30);\n```"}'
```

Fields: `body` (required), `author_id` (optional, auto-filled), `author_name` (optional, auto-filled from API key name)

### DELETE /issues/{issue_id}/comments/{comment_id}
Delete a comment.

---

## TLDRs (Agent Summaries)

### POST /issues/{id}/tldr
Post an agent work summary. Designed for CI/CD and coding agents.

```bash
curl -s -X POST $BAATON/issues/ISSUE_ID/tldr -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "codex",
    "summary": "Refactored auth module to use async timeouts. Added retry logic for slow connections. All tests pass.",
    "files_changed": ["src/auth.rs", "src/config.rs", "tests/auth_test.rs"],
    "tests_status": "passed",
    "pr_url": "https://github.com/org/repo/pull/42"
  }'
```

| Field | Type | Required |
|-------|------|----------|
| agent_name | string | yes |
| summary | string | yes |
| files_changed | string[] | no |
| tests_status | string | no |
| pr_url | string | no |

---

## Labels / Tags

### GET /projects/{id}/tags
List project labels.

### POST /projects/{id}/tags
Create: `{ "name": "critical", "color": "#ef4444" }`

### DELETE /tags/{id}
Delete label.

---

## Milestones

### GET /projects/{id}/milestones
List milestones.

### POST /projects/{id}/milestones
Create: `{ "name": "v1.0", "due_date": "2026-04-01", "description": "First public release" }`

### GET /milestones/{id}
Get a single milestone.

### PUT /milestones/{id}
Update milestone (full replace).

### DELETE /milestones/{id}
Delete milestone.

---

## Sprints

### GET /projects/{id}/sprints
List sprints.

### POST /projects/{id}/sprints
Create: `{ "name": "Sprint 1", "start_date": "2026-03-01", "end_date": "2026-03-14", "goal": "Ship auth module" }`

### PUT /sprints/{id}
Update sprint (full replace).

### DELETE /sprints/{id}
Delete sprint.

---

## Cycles

### GET /projects/{id}/cycles
List cycles.

### POST /projects/{id}/cycles
Create a cycle: `{ "name": "Cycle 1", "start_date": "2026-03-01", "end_date": "2026-03-28" }`

### GET /cycles/{id}
Get a single cycle.

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
Link project: `{ "project_id": "..." }`

### DELETE /initiatives/{id}/projects/{project_id}
Unlink project.

---

## Automations

### GET /projects/{id}/automations
List automations for a project.

### POST /projects/{id}/automations
Create an automation rule.

```bash
curl -s -X POST $BAATON/projects/PROJECT_ID/automations -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Auto-close stale issues",
    "trigger": "due_date_passed",
    "conditions": [{"field": "status", "operator": "equals", "value": "todo"}],
    "actions": [{"type": "set_status", "value": "cancelled"}],
    "enabled": true
  }'
```

Triggers: `status_changed`, `priority_changed`, `label_added`, `issue_created`, `comment_added`, `assignee_changed`, `due_date_passed`
Actions: `set_status`, `set_priority`, `add_label`, `assign_user`, `send_webhook`, `add_comment`, `run_agent`

### PATCH /automations/{id}
Update automation (name, trigger, conditions, actions, enabled).

### DELETE /automations/{id}
Delete automation.

---

## Webhooks

### GET /webhooks
List webhook subscriptions.

### POST /webhooks
Create a webhook.

```bash
curl -s -X POST $BAATON/webhooks -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-server.com/webhook","events":["issue.created","status.changed"],"secret":"optional-hmac-secret"}'
```

Payload sent to your URL: `{ "event": "issue.created", "data": { "issue": {...} }, "timestamp": "2026-03-12T..." }`

### GET /webhooks/{id}
Get webhook details.

### PATCH /webhooks/{id}
Update webhook.

### DELETE /webhooks/{id}
Delete webhook.

---

## Recurring Issues

### GET /projects/{id}/recurring
List recurring issue templates.

### POST /projects/{id}/recurring
Create: `{ "title": "Weekly review", "cron": "0 9 * * 1", "template": { "priority": "medium", "status": "todo" } }`

### PATCH /recurring/{id}
Update template.

### DELETE /recurring/{id}
Delete template.

### POST /recurring/{id}/trigger
Manually trigger a recurring issue now.

---

## SLA Rules

### GET /projects/{id}/sla-rules
List SLA rules.

### POST /projects/{id}/sla-rules
Create: `{ "name": "Urgent 4h", "priority": "urgent", "response_hours": 4, "resolution_hours": 24 }`

### DELETE /sla-rules/{id}
Delete rule.

### GET /projects/{id}/sla-stats
Get SLA compliance statistics.

---

## Templates

### GET /projects/{id}/templates
List issue templates.

### POST /projects/{id}/templates
Create: `{ "name": "Bug Report", "template": { "title": "[BUG] ", "description": "## Steps\\n1.\\n\\n## Expected\\n\\n## Actual", "priority": "high", "issue_type": "bug" } }`

### GET /templates/{id}
Get a single template.

### PATCH /templates/{id}
Update template.

### DELETE /templates/{id}
Delete template.

---

## Custom Fields

### GET /projects/{id}/custom-fields
List custom field definitions for a project.

### POST /projects/{id}/custom-fields
Create: `{ "name": "Environment", "field_type": "select", "options": ["staging", "production"] }`

### PATCH /custom-fields/{id}
Update custom field definition.

### DELETE /custom-fields/{id}
Delete custom field.

### GET /issues/{id}/custom-values
Get custom field values for an issue.

### PUT /issues/{id}/custom-values
Set custom field values: `{ "fields": { "field_id": "value" } }`

---

## Gamification

### GET /gamification/me
Get current user's XP, level, streak, and badges.

### GET /gamification/stats
Leaderboard: top contributors by XP.

### GET /gamification/heatmap
Activity heatmap (GitHub-style contribution grid).

### GET /gamification/dashboard
Full gamification dashboard: leaderboard, recent activity, achievements.

### GET /projects/{id}/gamification
Project-level gamification stats.

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
Add: `{ "url": "https://...", "name": "screenshot.png", "size": 1024, "mime_type": "image/png" }`

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
Get unread count: `{ "data": { "count": 5 } }`

### PATCH /notifications/{id}/read
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
Full-text search within current org. Supports prefix matching (e.g. "HLM" finds HLM-* issues).

```bash
curl -s "$BAATON/search?q=login+bug" -H "Authorization: Bearer $KEY"
```

### GET /search/global?q={query}
Cross-org search across all user organizations.

---

## AI

### POST /ai/chat
AI chat with project context. Requires `ai:chat` permission.

```bash
curl -s -X POST $BAATON/ai/chat -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"List all urgent bugs in HLM project"}]}'
```

Quota: Free=50 messages/month, Pro=2000, Enterprise=unlimited. Returns HTTP 429 when exceeded with `{ "error": "AI quota exceeded", "upgrade_url": "/billing" }`.

### GET /ai/key
Get Gemini API key (for frontend use).

### POST /ai/pm-full-review
AI-powered full project review.

### POST /issues/{id}/triage
AI triage: auto-assign priority, labels, and assignee.

---

## Billing

### GET /billing
Get current plan, usage across all orgs, and limits.

```bash
curl -s $BAATON/billing -H "Authorization: Bearer $KEY"
```

Response: `{ "data": { "plan": "pro", "usage": { "orgs": { "current": 2, "limit": 5 }, "projects": { "current": 8, "limit": 25 }, "issues": { "current": 342, "limit": -1 }, "ai_messages": { "current": 45, "limit": 2000 } } } }`

Note: `-1` means unlimited.

### GET /billing/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD
Detailed AI usage: messages, tokens in/out, by type, daily breakdown, estimated cost.

---

## API Keys

API keys require Clerk JWT authentication (not API key auth). Keys cannot manage other keys.

### GET /api-keys
List org API keys.

### POST /api-keys
Create key.

```bash
# Requires Clerk JWT, not API key
curl -s -X POST $BAATON/api-keys -H "Authorization: Bearer CLERK_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"CI Agent","permissions":["issues:read","issues:write","comments:write"],"expires_at":"2027-01-01"}'
```

Returns the plaintext key once. Store it immediately.

### PATCH /api-keys/{id}
Update key (name, permissions, project_ids, expires_at).

### POST /api-keys/{id}/regenerate
Regenerate key. Old key is immediately revoked.

### DELETE /api-keys/{id}
Revoke key.

---

## Members & Invites

### GET /invites
List pending invites.

### POST /invites
Invite member: `{ "email": "dev@company.com", "role": "member" }`

### GET /invite/{code}
Accept invite (public endpoint).

---

## Metrics

### GET /metrics?days=30
Project metrics: issues created/closed, velocity, burndown, by-status, by-priority breakdowns.

---

## Agent Config

### GET /agent-config
Get autonomous agent settings (Pro plan only).

### PATCH /agent-config
Update: `{ "enabled": true, "auto_triage": true, "auto_assign": true, "auto_label": true }`

---

## Approval Workflow

### POST /issues/{id}/approval-request
Create an approval request on an issue. Used by agents to ask for human review before proceeding.

**Body:**
```json
{
  "action": "deploy_to_production",
  "description": "PR #42 merged, all tests pass. Ready to deploy.",
  "confidence": 0.85,
  "options": ["approve", "reject", "request_changes"]
}
```

**Response:** The created comment with `comment_type: "approval_request"` and `approval_status: "pending"`.

### POST /issues/{id}/approval-response
Respond to a pending approval request.

**Body:**
```json
{
  "approval_comment_id": "uuid-of-the-approval-comment",
  "decision": "approved",
  "comment": "LGTM, ship it"
}
```

Valid decisions: `approved`, `rejected`, `request_changes`.

**Side effects:**
- Updates the original approval comment with decision metadata
- Dispatches `issue.approval_decision` webhook event
- Logs activity

---

## Import / Export

### POST /projects/{id}/import
Import issues from CSV/JSON.

### GET /projects/{id}/export
Export project data.

---

## Public Endpoints (No Auth Required)

### GET /public/docs
This document. Full API reference in Markdown.

### GET /public/skill
Agent skill file (SKILL.md format for OpenClaw, Codex, etc.)

### POST /public/{slug}/submit
Public issue submission form.

### POST /public/{slug}/email-intake
Email-to-issue intake.

### GET /public/resolve/{token}
Resolve a public action token.

---

## GitHub Integration

### GET /github/install
Start GitHub App installation (redirects to GitHub).

### GET /github/callback
OAuth callback.

### GET /github/installation
Get installation status.

### GET /github/repos
List connected repositories.

### POST /github/disconnect
Disconnect GitHub integration.

### GET /github/mappings
List project-repo mappings.

### POST /github/mappings
Create mapping: `{ "project_id": "...", "repo_full_name": "owner/repo" }`

### PATCH /github/mappings/{id}
Update mapping.

### DELETE /github/mappings/{id}
Remove mapping.

### GET /issues/{id}/github
Get GitHub PR/branch info for an issue.

### POST /projects/{id}/refresh-github
Sync GitHub issues.

---

## Slack Integration

### GET /integrations/slack
List Slack integrations.

### POST /integrations/slack
Connect Slack workspace.

### PATCH /integrations/slack/{id}/channels
Update Slack channel mappings.

### DELETE /integrations/slack/{id}
Disconnect.

---

## Admin (Superadmin Only)

### PATCH /admin/orgs/{id}/plan
Set org plan (also updates all member user plans).

### PATCH /admin/users/{user_id}/plan
Set user plan directly: `{ "plan": "pro" }`
Valid plans: `free`, `pro`, `enterprise`, `partner`, `tester`, `unlimited`

### GET /admin/overview
Platform-wide analytics: totals, AI cost, plan distribution, daily issues, top orgs.

### GET /admin/users
List all orgs with plans, usage, members.

### GET /admin/superadmin/check
Check if current user is superadmin.

### GET /admin/superadmins
List super admins.

### POST /admin/superadmins
Add super admin: `{ "email": "admin@company.com" }`

### DELETE /admin/superadmins/{email}
Remove super admin (cannot remove yourself).

### GET /admin/audit-log
Paginated admin action log.

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
| Webhooks | No | Yes | Yes |
| BYOK | No | Yes | Yes |
| SAML | No | No | Yes |

---

## Common Errors & Troubleshooting

### Authentication Failed (401)
```json
{"error": "Unauthorized"}
```
Check: Is your API key valid? Does the header use `Bearer` prefix? Is the key revoked or expired?

### Invalid Enum Value (400)
```json
{"error": "Invalid status 'open'. Accepted values: backlog, todo, in_progress, in_review, done, cancelled", "accepted_values": ["backlog","todo","in_progress","in_review","done","cancelled"], "field": "status"}
```
Fix: Use the exact values from `accepted_values`. Statuses are per-project — fetch them via `GET /projects`.

### Plan Limit Exceeded (402)
```json
{"error": "Issue limit reached (500). Upgrade to Pro for unlimited issues.", "upgrade_url": "/billing"}
```
Fix: Upgrade plan or delete unused issues.

### AI Quota Exceeded (429)
```json
{"error": "AI quota exceeded (50/50 this month)", "upgrade_url": "/billing"}
```
Fix: Wait for next month, upgrade to Pro (2000/mo), or use BYOK (Pro feature).

### Organization Required (400)
```json
{"error": "Organization required"}
```
Fix: Ensure your Clerk JWT includes an active organization. API keys are always org-scoped.

### Permission Denied (403)
```json
{"error": "Insufficient permissions. Required: issues:write"}
```
Fix: Update your API key permissions via the web UI or `PATCH /api-keys/{id}`.

---

## Agent Workflow (Recommended)

```
1. GET /projects                        → find your project
2. POST /issues                         → create issue (check _hints in response)
3. PATCH /issues/{id} status=in_progress → signal you're working on it
4. POST /issues/{id}/comments           → post progress updates
5. POST /issues/{id}/tldr               → post completion summary with files_changed
6. PATCH /issues/{id} status=done       → mark complete
```

For bulk operations: `PATCH /issues/batch` with `{ "ids": [...], "updates": { "status": "done" } }`
