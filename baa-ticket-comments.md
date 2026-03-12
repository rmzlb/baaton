# BAA Ticket Implementation Comments

## BAA-1: Pricing Tier Enforcement
**Status: Done**
Implementation: GET /billing endpoint returns multi-org usage (orgs, projects, issues, API requests) with per-plan limits. Frontend Billing.tsx page shows usage bars, per-org breakdown, and plan comparison cards (Free/Pro/Enterprise). Issue creation returns 402 when org exceeds issue limit. Project creation limit was already enforced. Plan limits: Free (2 orgs, 3 projects, 500 issues, 1k API/mo), Pro (10/25/10k/50k), Enterprise (unlimited).
Commits: 64d60e7, 4633bc3

## BAA-2: Cycles/Sprints
**Status: Done**
Backend: Full CRUD for cycles (migration 027_cycles.sql). GET /projects/:id/cycles, GET /cycles/:id, POST /cycles/:id/complete. Frontend: Sprints page pre-existed at /sprints with create/edit/delete, issue assignment, and status management (planned/active/completed).
Commits: 142ae2b, 5cf7101

## BAA-3: Issue Relations
**Status: Done**
Backend: Relations table (migration 005) with types: blocks, blocked_by, relates_to, duplicates. CRUD endpoints: GET/POST /issues/:id/relations, DELETE /issues/:id/relations/:rid. Frontend: IssueRelations component rendered in IssueDrawer — search issues, add relation with type selector, display grouped relations with remove button.
Commits: e173bfd

## BAA-4: Sub-issues
**Status: Done**
Backend: parent_id column on issues with max depth 2 validation. GET /issues/:id/children. Frontend: SubIssuesSection in IssueDrawer — collapsible list with inline create, status badges, click to navigate. Depth guard prevents creating sub-sub-sub-issues.
Commits: e173bfd

## BAA-5: Custom Views / Saved Filters
**Status: Done**
Backend: views table with filter JSON column. GET /views, POST /views, PATCH /views/:id, DELETE /views/:id, GET /views/:id/issues. Frontend: AllIssues page has Save View button — saves current filter state (status, priority, type, search, category). Saved views appear in dropdown, click to apply. URL sync via ?view= param.
Commits: e173bfd

## BAA-6: Keyboard Shortcuts
**Status: Done**
Frontend-only: Global keyboard shortcut system. G+P → projects, G+D → dashboard, G+I → initiatives, G+A → automations. J/K → navigate issues, E → edit, N → new issue, ? → help overlay, ⌘K → command palette. ShortcutHelp component shows all bindings.
Commits: e173bfd

## BAA-7: Notifications (Novu)
**Status: Done**
Backend: Novu integration for real-time notifications. Types: assigned, mentioned, status_changed, comment_added. Endpoints: GET /notifications, GET /notifications/count, POST /notifications/read-all, PATCH /notifications/:id/read, GET/PUT /notifications/preferences. Frontend: NovuNotificationProvider with bell icon dropdown, unread count badge, mark-read-on-click, preference toggles.
Commits: e173bfd

## BAA-8: SLA Rules & Stats
**Status: Done**
Backend: sla_rules table (migration 028). CRUD: GET/POST /projects/:id/sla-rules, DELETE /sla-rules/:id, GET /projects/:id/sla-stats. Stats calculate: achievement %, on-time count, breached count per priority. Frontend: SlaSection in project settings — create rules per priority (response/resolution hours), stats display with achievement percentages.
Commits: 5cf7101

## BAA-9: Initiatives (Strategic Goals)
**Status: Done**
Backend: initiatives table (migration 034) + initiative_projects junction. CRUD: GET/POST /initiatives, GET /initiatives/:id, PATCH /initiatives/:id, POST /initiatives/:id/projects, DELETE /initiatives/:id/projects/:pid. Frontend: Initiatives.tsx page at /initiatives — create with name/description, link projects, progress bars based on linked project issue completion, status filter (active/completed/archived).
Commits: 5cf7101

## BAA-10: AI Triage
**Status: Done**
Backend: POST /issues/:id/triage — calls Gemini to analyze issue and suggest priority, tags, assignee, plus find similar issues. Returns TriageSuggestion with confidence scores. Frontend: Triage page has AI Triage button per issue — shows suggestion card with accept/dismiss actions.
Commits: 5cf7101

## BAA-11: Label Colors
**Status: Done**
Backend: color column on tags table. Frontend: Tag color picker in tag management — predefined palette + custom hex. Colors display inline on issue cards in kanban/list views. 13 files modified.
Commits: becf760

## BAA-12: Story Points / Estimates
**Status: Done**
Backend: estimate column on issues (integer). Frontend: Estimate selector in issue drawer and creation form. Sprint/cycle views show total estimate and per-status breakdown. Fibonacci-style options (1,2,3,5,8,13,21). 15 files modified.
Commits: becf760

## BAA-13: Issue Templates
**Status: Done**
Backend: templates table (migration 030). CRUD: GET/POST /projects/:id/templates, GET /templates/:id, DELETE /templates/:id. Frontend: TemplatesSection in project settings — create templates with name, default values (title, description, priority, type, tags). Apply template when creating new issue.
Commits: 5cf7101

## BAA-14: Rich Markdown Editor
**Status: Done**
Frontend: TipTap-based rich text editor for issue descriptions and comments. Supports: headings, bold/italic, code blocks, lists, links, images, task lists. Renders HTML with syntax highlighting. 6 files modified.
Commits: becf760

## BAA-15: Bulk Actions
**Status: Done**
Backend: PATCH /issues/batch — update status, priority, assignee for multiple issues at once. Frontend: Multi-select checkboxes on issue lists. Bulk action toolbar appears with: change status, change priority, assign, delete. 5 files modified.
Commits: becf760

## BAA-16: Due Dates & Overdue Tracking
**Status: Done**
Backend: due_date column on issues with overdue filter in queries. Frontend: Date picker in issue drawer. Overdue issues show red badge. All Issues page has "Overdue" filter option. Search global supports is_overdue param. 4 files modified.
Commits: becf760

## BAA-17: Recurring Issues
**Status: Done**
Backend: recurring_issues table (migration 031). Cron-based scheduling. CRUD: GET/POST /projects/:id/recurring, PATCH /recurring/:id, POST /recurring/:id/trigger. Auto-creates issues on schedule. Frontend: RecurringSection in project settings — create with template (title, description, priority), cron expression, toggle enabled/disabled, manual trigger button.
Commits: 5cf7101

## BAA-18: Command Palette (⌘K)
**Status: Done**
Frontend-only: CommandPalette component triggered by ⌘K / Ctrl+K. Fuzzy search across: navigation (pages), recent issues, projects, actions (create issue, toggle theme). Results grouped by category with keyboard navigation (arrow keys + enter). 3 files modified.
Commits: e173bfd

## BAA-19: Activity Feed
**Status: Done**
Backend: activity_log table. Automatic logging on: status_changed, priority_changed, assigned, comment_added, issue_created, issue_updated. GET /activity (recent across projects), GET /issues/:id/activity. Frontend: ActivityFeed component in IssueDrawer — chronological timeline with icons, timestamps, and change details. Dashboard shows recent activity.
Commits: becf760

## BAA-20: Email Intake
**Status: Done**
Backend: POST /public/:slug/email-intake — accepts email payloads, creates issues from subject/body. Supports: sender extraction, priority inference from keywords, tag matching. Frontend: EmailIntakeSection in project settings — displays the intake endpoint URL for the project, copy button.
Commits: 5cf7101

## BAA-21: PWA
**Status: Done**
Frontend: manifest.json with app metadata (name, icons, theme_color, start_url). Service worker (sw.js) with cache-first strategy. SW registration in main.tsx for production builds. Icons: SVG format (icon-192.svg, icon-512.svg). Standalone display mode.
Commits: c0a23db

## BAA-22: Auto-Archive
**Status: Done**
Backend: POST /issues/:id/archive and /unarchive endpoints. Issues with status 'done' or 'cancelled' auto-archive after configurable days. List queries filter archived=false by default. Frontend: Archive/unarchive toggle in issue drawer. All Issues has "Include archived" filter option.
Commits: 142ae2b

## BAA-23: Import/Export
**Status: Done**
Backend: GET /projects/:id/export (JSON with all issues + comments), POST /projects/:id/import (accepts JSON array). Frontend: ImportExportModal in ProjectBoard header — Export downloads JSON file, Import accepts file upload with validation.
Commits: 5cf7101

## BAA-24: Attachments
**Status: Done**
Backend: attachments table. GET /issues/:id/attachments, POST (upload), DELETE /issues/:id/attachments/:att_id. Supports: images, PDFs, documents. Frontend: Attachments panel in IssueDrawer with file upload, preview (images), download, and delete.
Commits: 142ae2b

## BAA-25: Slack Integration
**Status: Done**
Backend: slack_integrations table (migration 036). GET/POST /integrations/slack, DELETE /integrations/slack/:id, PATCH /integrations/slack/:id/channels, POST /public/slack/command. Frontend: SlackSettings component in Integrations tab — connect workspace (team_id/webhook_url), channel-to-project mapping, disconnect. Slash command: /baaton create [title].
Commits: c0a23db

## BAA-26: Global Search (Cross-Org)
**Status: Done**
Backend: GET /search/global?q= — fetches user's org memberships from Clerk API, searches across ALL organizations. Combines: full-text search (prefix tsquery), ILIKE fallback on title, display_id prefix matching, project prefix matching. Returns: issue details + org_name + project_name. Frontend: SearchPage.tsx — results grouped by org > project, full i18n (EN/FR), filter by status, real-time search.
Commits: 86c7b6b, 4633bc3

## BAA-27: Automations
**Status: Done**
Backend: automations table (migration 032). CRUD: GET/POST /projects/:id/automations, PATCH /automations/:id. Triggers: issue_created, status_changed, priority_changed. Actions: set_status, set_priority, add_comment, assign. evaluate_automations() runs on issue events. Frontend: Automations.tsx page at /projects/:slug/automations — create trigger→action workflows, toggle enabled, test execution.
Commits: 5cf7101

---

## Cross-cutting: AI-First Action Hints
Added to API responses as `_hints` field:
- Issue creation → hints to add description + TLDR
- Status change → hints to add comment explaining why
- Issue closed → hints to add closing TLDR summary
- Priority change → hints to add reprioritization rationale
Commit: 6f660e3

## Cross-cutting: AI Skills Audit
All 20 in-app AI skills rewritten with Anthropic best practices:
- 3-5 sentence descriptions with purpose, usage, returns, caveats
- Cross-references between tools
- SKILL_GROUPS restructured: default 10 tools, management 8 tools
Commit: 64d60e7
