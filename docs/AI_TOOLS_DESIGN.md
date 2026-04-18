# AI Tools Design — Baaton Agent Tooling

> Design document for the 27 tools available to the Baaton AI agent (Gemini 2.0 Flash).
> Applies [Anthropic's "Writing effective tools for agents"](https://www.anthropic.com/engineering/writing-tools-for-agents) best practices.

## Design Principles

### 1. Descriptive Disambiguation
Every tool description follows a 4-part structure:
- **What it does** — one-sentence summary with context
- **When to use it** — concrete use-case scenarios with example user phrases
- **When NOT to use it** — disambiguates from similar tools, prevents misrouting
- **Return shape hint** — what the model gets back, enabling it to plan follow-up actions

### 2. Human-Friendly Identifiers
All `project_id` and `issue_id` parameters accept both UUIDs and human-readable identifiers:
- `project_id`: UUID, prefix (`HLM`), or partial name
- `issue_id`: UUID or display_id (`HLM-42`)
- Bulk arrays (`updates[].issue_id`, `milestones[].issue_ids[]`) are resolved recursively

### 3. Proposal → Confirmation → Execution
Write operations follow a strict 3-step flow to prevent unintended mutations:
1. **Propose** — `propose_issue`, `propose_update_issue`, `propose_bulk_update`, `propose_comment`
2. **User reviews** — frontend renders an editable approval form
3. **Execute** — `create_issue`, `update_issue`, `bulk_update_issues`, `add_comment` (only after approval)

### 4. Actionable Error Messages
Every validation failure returns a message that tells the model:
- What was wrong
- What was expected
- How to fix it (e.g., "Use search_issues to find the right issue")

### 5. Response Format Control
Heavy-read tools support `response_format` parameter:
- `"concise"` (default) — minimal fields for quick summaries
- `"detailed"` — full data for deep analysis

### 6. Gemini-Specific Optimizations
- All enum values are explicitly listed in `"enum"` arrays (Gemini performs better with constrained values)
- Required fields are marked in `"required"` arrays
- Descriptions include concrete examples (Gemini generalizes better from examples)
- `"type": "OBJECT"` / `"STRING"` / `"NUMBER"` / `"ARRAY"` use Gemini's JSON schema format

---

## Tool Catalog (27 tools)

### Search & Read Tools

| # | Tool | Purpose | Returns |
|---|------|---------|---------|
| 1 | `search_issues` | Find/filter/count issues across projects | `{ count, issues[], response_format }` |
| 2 | `get_project_metrics` | Aggregate health dashboard (velocity, bug ratio, cycle time) | `{ total, open, in_progress, done, velocity, bug_ratio, avg_cycle_time_hours }` |
| 3 | `analyze_sprint` | Active sprint analysis (completion %, stuck issues, trend) | `{ sprint_name, planned, completed, pct, carried_over, blocked, velocity_trend }` |
| 4 | `weekly_recap` | Activity recap for last N days (completed, new, blocked) | `{ completed_count, new_created_count, blocker_count, top_contributor, completed_issues[], blocked_issues[] }` |
| 5 | `suggest_priorities` | AI reprioritization recommendations (staleness × priority) | `[{ display_id, title, priority, score, reason }]` |
| 6 | `export_project` | Full JSON dump of all issues, milestones, sprints | `{ issues[], milestones[], sprints[], exported_at }` |
| 25 | `find_similar_issues` | Detect duplicate/similar issues by title word overlap | `{ reference_title, candidates[{ display_id, title, status, similarity_score }] }` |
| 26 | `workload_by_assignee` | Aggregate open issues per assignee with status breakdown | `{ assignees[{ assignee_id, total, by_status }], scope }` |
| 27 | `compare_projects` | Side-by-side metrics comparison for 2-5 projects | `{ projects[{ prefix, total, open, done, velocity_14d, bug_ratio, completion_ratio }] }` |

### Proposal Tools (User Approval Required)

| # | Tool | Purpose | Returns |
|---|------|---------|---------|
| 7 | `propose_issue` | Propose creating a new issue | `{ project_id, title, description, type, priority, tags[], category[] }` |
| 8 | `propose_update_issue` | Propose updating an existing issue (shows diff) | `{ issue_id, display_id, title, diff[] }` |
| 9 | `propose_bulk_update` | Propose bulk updating N issues | `{ updates[] }` with current vs proposed |
| 10 | `propose_comment` | Propose adding a comment | `{ issue_id, display_id, title, content }` |

### Write Tools (Only After Approval)

| # | Tool | Purpose | Returns |
|---|------|---------|---------|
| 11 | `create_issue` | Persist a new issue (after propose_issue approval) | `{ id, display_id, title, status, priority, type }` |
| 12 | `update_issue` | Update issue fields (after propose_update_issue approval) | `{ issue_id, display_id, changes[], status, priority }` |
| 13 | `bulk_update_issues` | Bulk update (after propose_bulk_update approval) | `{ updated_count, issues[] }` |
| 14 | `add_comment` | Add comment (after propose_comment approval) | `{ id, issue_id, author_name, body, created_at }` |
| 15 | `triage_issue` | Qualify an issue (backlog→todo, set qualified_at) | `{ issue_id, display_id, status, qualified_by }` |

### Planning Tools

| # | Tool | Purpose | Returns |
|---|------|---------|---------|
| 16 | `plan_milestones` | Auto-group open issues into milestone plan | `{ proposed_milestones[] }` |
| 17 | `create_milestones_batch` | Persist milestones (after plan approval) | `{ created_count, milestones[] }` |
| 18 | `adjust_timeline` | Rescale milestone dates for new constraint | `{ milestones[], constraint, new_deadline }` |
| 19 | `generate_prd` | Generate PRD from brief + project data | `{ title, sections[] }` |

### Configuration Tools

| # | Tool | Purpose | Returns |
|---|------|---------|---------|
| 20 | `manage_initiatives` | CRUD for strategic initiatives (cross-project goals) | Varies by action |
| 21 | `manage_automations` | Event-driven workflow rules (triggers → actions) | Varies by action |
| 22 | `manage_sla` | SLA rules and compliance monitoring | Varies by action |
| 23 | `manage_templates` | Reusable issue templates | Varies by action |
| 24 | `manage_recurring` | Cron-scheduled recurring issues | Varies by action |

---

## User Story → Tool Mapping

| User says... | Model calls | With args |
|---|---|---|
| "Show me all bugs in HLM" | `search_issues` | `{ project_id: "HLM", query: "bug" }` |
| "How many in_progress tickets?" | `search_issues` | `{ status: "in_progress" }` |
| "How is the project doing?" | `get_project_metrics` | `{ project_id: "HLM" }` |
| "Sprint status" | `analyze_sprint` | `{ project_id: "HLM" }` |
| "Weekly recap" | `weekly_recap` | `{ days: 7 }` |
| "What should I work on next?" | `suggest_priorities` | `{ project_id: "HLM" }` |
| "Create a bug for auth failing" | `propose_issue` | `{ project_id: "HLM", title: "Auth token refresh fails", type: "bug", priority: "high" }` |
| "Mark HLM-42 as done" | `propose_update_issue` | `{ issue_id: "HLM-42", status: "done" }` |
| "Move all in_progress to in_review" | `propose_bulk_update` | `{ updates: [{ issue_id: "HLM-10", status: "in_review" }, ...] }` |
| "Add a comment to HLM-42" | `propose_comment` | `{ issue_id: "HLM-42", content: "..." }` |
| "Plan milestones for HLM" | `plan_milestones` | `{ project_id: "HLM" }` |
| "We need to ship by March 15" | `adjust_timeline` | `{ project_id: "HLM", constraint: "finish by 2026-03-15" }` |
| "Write a PRD for user auth" | `generate_prd` | `{ brief: "User authentication with OAuth2", project_id: "HLM" }` |
| "Triage HLM-42" | `triage_issue` | `{ issue_id: "HLM-42" }` |
| "Export HLM data" | `export_project` | `{ project_id: "HLM" }` |
| "Set SLA for urgent to 4 hours" | `manage_sla` | `{ action: "create_rule", project_id: "HLM", priority: "urgent", deadline_hours: 4 }` |
| "Create a weekly security review" | `manage_recurring` | `{ action: "create", project_id: "HLM", title: "Weekly Security Review", cron_expression: "0 9 * * 1" }` |
| "Create a Q3 launch initiative" | `manage_initiatives` | `{ action: "create", name: "Q3 Launch" }` |
| "Auto-escalate stale urgents" | `manage_automations` | `{ action: "create", project_id: "HLM", name: "Auto-escalate", trigger_type: "due_date_passed", action_type: "set_priority" }` |
| "Is this a duplicate?" | `find_similar_issues` | `{ reference_issue_id: "HLM-42" }` |
| "Find similar issues to auth bug" | `find_similar_issues` | `{ query: "auth token refresh bug" }` |
| "Who has most work on HLM?" | `workload_by_assignee` | `{ project_id: "HLM" }` |
| "Workload distribution" | `workload_by_assignee` | `{}` |
| "Compare HLM and SQX" | `compare_projects` | `{ project_ids: ["HLM", "SQX"] }` |
| "Which project is fastest?" | `compare_projects` | `{}` |

---

## ID Resolution

The `resolve_args_ids()` function runs before every tool execution and resolves:

| Field | Accepts | Resolution |
|---|---|---|
| `project_id` | UUID, prefix (`HLM`), partial name | `resolve_project_id()` — tries UUID parse → prefix match → name ILIKE |
| `issue_id` | UUID, display_id (`HLM-42`) | `resolve_issue_id()` — tries UUID parse → display_id match (case-insensitive) |
| `updates[].issue_id` | UUID, display_id | Iterated and resolved individually |
| `milestones[].issue_ids[]` | UUID, display_id | Iterated and resolved individually |

---

## Error Message Design

All validation errors follow this pattern:
```
"<tool_name> requires '<field>'. <what_to_provide>. <example_or_hint>."
```

Examples:
- `"create_issue requires 'title'. Provide a short plain-text title (no brackets, no prefix). Good: 'Fix auth token refresh'. Bad: '[HLM][BUG] Fix auth'."`
- `"Issue 'HLM-999' could not be resolved. Check that the display_id or UUID is correct. Use search_issues to find the right issue."`
- `"Project 'XYZ' not found or you don't have access. Double-check the project UUID or prefix."`

---

## Response Format Control

### `search_issues`
- `response_format: "concise"` (default) → `{ display_id, title, status }` per issue
- `response_format: "detailed"` → adds `id, priority, category[], project_name, updated_at`

### `weekly_recap`
- `limit` param (default 20, max 50) controls how many issues are listed per category
- Returns both counts and issue lists for completed and blocked categories

---

## File Location

All tool definitions and executors live in a single file:
```
backend/src/routes/ai_tools/mod.rs
```

Structure:
1. **Type definitions** (`ToolResult`, `ToolDefinition`)
2. **Client-interactive detection** (`is_client_interactive`)
3. **Tool definitions** (`get_tool_definitions`) — 27 tools
4. **SQL row structs** (`SearchIssueRow`, etc.)
5. **Real executors** (`exec_search_issues`, `create_issue_real`, etc.)
6. **ID resolvers** (`resolve_project_id`, `resolve_issue_id`, `resolve_args_ids`)
7. **Proposal executors** (`exec_propose_issue`, etc.)
8. **Dispatcher** (`execute_tool`) — routes tool name to executor
9. **Stub executors** (legacy fallbacks from Phase 1)
10. **Complex executors** (`ai_plan_milestones`, `ai_manage_initiatives`, etc.)
