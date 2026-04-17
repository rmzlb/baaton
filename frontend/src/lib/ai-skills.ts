/**
 * Baaton AI Skills — Function calling definitions for Gemini + AI SDK.
 * Each skill maps to a tool and an executor that calls the Baaton API.
 *
 * TOOL MASKING (Manus pattern):
 * Not all tools are relevant at all times. Use getZodToolsForContext()
 * to get context-appropriate tools instead of exposing all 20.
 */

import { z } from 'zod';

// ─── Skill Groups (for tool masking) ──────────
export type SkillContext = 'default' | 'milestone_planning' | 'milestone_confirm' | 'read_only' | 'creation' | 'management';

const SKILL_GROUPS: Record<SkillContext, string[]> = {
  // Default: core skills for general-purpose chat (~10 tools max).
  // Covers the 80% use case: browse, create, update, comment, and basic analytics.
  default: [
    'search_issues', 'create_issue', 'update_issue', 'bulk_update_issues',
    'add_comment', 'triage_issue', 'get_project_metrics', 'weekly_recap',
    'suggest_priorities', 'plan_milestones',
  ],
  // Management: project configuration tools — automations, SLA, templates,
  // recurring issues, initiatives, and data export. Activate when the user
  // asks about workflows, rules, templates, or project settings.
  management: [
    'manage_initiatives', 'manage_automations', 'manage_sla',
    'manage_templates', 'manage_recurring', 'export_project',
    'search_issues', 'get_project_metrics',
  ],
  // Milestone planning: after user asks to plan milestones or a roadmap.
  milestone_planning: [
    'plan_milestones', 'search_issues', 'get_project_metrics',
  ],
  // Milestone confirm: after plan is proposed, waiting for confirm/adjust.
  milestone_confirm: [
    'create_milestones_batch', 'adjust_timeline', 'plan_milestones',
  ],
  // Read-only: analytics, reporting, and status queries only — no writes.
  read_only: [
    'search_issues', 'get_project_metrics', 'analyze_sprint', 'weekly_recap', 'suggest_priorities',
  ],
  // Creation: when user intent is to create issues, PRDs, or milestones.
  creation: [
    'create_issue', 'add_comment', 'generate_prd', 'plan_milestones',
    'create_milestones_batch', 'search_issues',
  ],
};

// ─── Zod Tool Schemas ─────────────────────────
export const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: z.ZodType }> = {
  search_issues: {
    description:
      'Search and filter issues across all projects using full-text search on titles and descriptions, combined with structured filters for status, priority, and technical category. Use this when the user asks to find specific tickets, list what\'s in progress, identify blockers, or check whether something already exists before creating a duplicate. Returns an array of matching issues including their id, display_id (e.g. HLM-42), title, status, priority, category, and a short description snippet. Does NOT return full descriptions or comments — call update_issue or add_comment after identifying the target issue.',
    inputSchema: z.object({
      query: z.string().optional().describe('Free-text search string matched against issue title and description. Leave empty to list all issues with only filter-based criteria. Example: "auth token refresh" or "onboarding bug".'),
      project_id: z.string().optional().describe('UUID of the project to search within. Omit to search across all projects the user has access to.'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().describe('Filter to issues in a specific workflow status. Omit to include all statuses.'),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('Filter to issues of a specific priority level. Omit to include all priorities.'),
      category: z.enum(['FRONT', 'BACK', 'API', 'DB', 'INFRA', 'UX', 'DEVOPS']).optional().describe('Filter to issues tagged with a specific technical domain. Omit to include all categories.'),
      limit: z.number().optional().describe('Maximum number of results to return. Defaults to 20. Increase up to 100 for broader scans; decrease to 5 for quick lookups.'),
    }),
  },

  create_issue: {
    description:
      'Create a new issue or ticket inside a specific project with full metadata. Use this when the user explicitly asks to create, add, or file a ticket, bug, feature request, or task. Infer type from context (user reports a crash → bug; user requests a new feature → feature; code quality concern → improvement). Auto-detect the technical category (FRONT/BACK/API/DB/INFRA) from keywords in the description. ABSOLUTE RULE: the title must NEVER contain brackets, project prefixes, or type tags — those are separate fields. BAD: "[SQX][BUG] Fix auth" or "HLM: Refactor session". GOOD: "Fix auth token refresh on session expiry". Returns the newly created issue with its display_id (e.g. HLM-43).',
    inputSchema: z.object({
      project_id: z.string().describe('UUID of the project to create the issue in. Required — never omit.'),
      title: z.string().describe('Short, action-oriented issue title. Must be plain text with no brackets, prefixes, or type tags. Examples: "Fix auth token refresh on expiry", "Add CSV export to billing page", "Migrate users table to new schema".'),
      description: z.string().optional().describe('Detailed issue description in Markdown format. Include: reproduction steps for bugs, acceptance criteria for features, technical context, and any relevant links. Leave empty only if no additional context exists.'),
      type: z.enum(['bug', 'feature', 'improvement', 'question']).optional().describe('Issue classification. Infer from context when not explicitly stated.'),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('Urgency level. Infer from language cues like "critical", "blocking", "when possible".'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().describe('Initial workflow status. Default to backlog unless the user explicitly says the work has started (→ in_progress) or is already queued (→ todo).'),
      tags: z.array(z.string()).optional().describe('Free-form labels to aid filtering and grouping. Examples: ["auth", "mobile", "regression"]. Use lowercase, hyphenated strings.'),
      category: z.array(z.string()).optional().describe('Technical domain(s) the issue belongs to. Valid values: FRONT (React/UI), BACK (server logic), API (REST/GraphQL endpoints), DB (database/migrations), INFRA (Docker/CI/CD), UX (design/accessibility), DEVOPS (deployment/monitoring). Auto-detect from description keywords; multiple values allowed.'),
    }),
  },

  update_issue: {
    description:
      'Update one or more fields of an existing issue identified by its internal UUID. Use this when the user wants to change the status, priority, title, description, tags, category, or type of a single ticket. First use search_issues to resolve the display_id (e.g. HLM-42) to its UUID if you don\'t already have it. Only include fields you want to change — omitted fields remain unchanged. Returns the updated issue with all current field values. Do NOT use this for batch updates across multiple issues — use bulk_update_issues instead.',
    inputSchema: z.object({
      issue_id: z.string().describe('Internal UUID of the issue to update (not the display_id like HLM-42). Resolve via search_issues first if you only have the display_id.'),
      title: z.string().optional().describe('New plain-text title, following the same no-brackets rule as create_issue. Omit if not changing.'),
      description: z.string().optional().describe('New description in Markdown format. Omit if not changing. This replaces the full existing description.'),
      status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().describe('New workflow status.'),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('New priority level.'),
      type: z.enum(['bug', 'feature', 'improvement', 'question']).optional().describe('New issue classification.'),
      tags: z.array(z.string()).optional().describe('New complete set of tags. This REPLACES existing tags, not appends. Pass the full desired tag list.'),
      category: z.array(z.string()).optional().describe('New complete set of technical domains. Valid values: FRONT, BACK, API, DB, INFRA, UX, DEVOPS. Replaces existing categories.'),
    }),
  },

  bulk_update_issues: {
    description:
      'Apply field updates to multiple issues in a single atomic call. Use this for batch operations like reprioritizing a sprint, bulk-closing resolved tickets, mass-tagging issues by domain, or status transitions on a set of related issues. Prefer this over calling update_issue in a loop — it is significantly faster and reduces API round-trips. Returns the list of successfully updated issues with their new field values. Issues that fail to update are reported individually in the error list.',
    inputSchema: z.object({
      updates: z.array(z.object({
        issue_id: z.string().describe('Internal UUID of the issue to update.'),
        status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().describe('New workflow status: backlog, todo, in_progress, in_review, done, cancelled.'),
        priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('New priority: urgent, high, medium, low.'),
        tags: z.array(z.string()).optional().describe('New complete tag set (replaces existing).'),
        category: z.array(z.string()).optional().describe('New technical domains: FRONT, BACK, API, DB, INFRA, UX, DEVOPS (replaces existing).'),
      })).describe('Array of per-issue update objects. Each entry must include issue_id; all other fields are optional and only specified ones will be changed.'),
    }),
  },

  add_comment: {
    description:
      'Append a threaded comment to an existing issue. Use this when the user wants to annotate an issue, log a decision, share context, report a finding, or record a progress update on a ticket. Comments are visible to all project members and are displayed in chronological order on the issue timeline. Returns the newly created comment with its ID and timestamp. Does NOT update the issue\'s own fields — use update_issue for that.',
    inputSchema: z.object({
      issue_id: z.string().describe('Internal UUID of the issue to comment on. Resolve via search_issues if you only have the display_id.'),
      content: z.string().describe('Comment body in Markdown format. Supports headers, code blocks, bullet lists, and bold/italic. Example: "Investigated the 500 error — root cause is a missing null check in the session middleware."'),
      author_name: z.string().optional().describe('Display name of the comment author shown in the UI. Defaults to the authenticated user if omitted. Use when posting on behalf of someone else.'),
    }),
  },

  generate_prd: {
    description:
      'Generate a complete Product Requirements Document (PRD) from a brief feature description. Use this when the user asks to write a spec, draft requirements, produce a PRD, or flesh out a feature idea into structured documentation. Returns a Markdown document with: executive summary, problem statement, user stories with acceptance criteria, scope boundaries (in/out), technical considerations, open questions, and success metrics. Does NOT create any issues or store the PRD — use create_issue with the PRD as the description if you want to persist it.',
    inputSchema: z.object({
      brief: z.string().describe('Short description of the feature or problem to document. Can be a sentence to a paragraph. Example: "Add a CSV export button on the billing page so admins can download invoice history."'),
      project_id: z.string().optional().describe('UUID of the project this PRD belongs to. Used to pull existing issue context (tech stack, naming conventions) that will make the PRD more specific. Omit for generic PRDs.'),
    }),
  },

  analyze_sprint: {
    description:
      'Analyze the current sprint\'s velocity, throughput, and completion dynamics for a project. Computes done vs. in-progress vs. backlog ratios, identifies issues that are stuck (no status change in 3+ days), surfaces over-loaded categories, and recommends a scope for the next sprint based on observed capacity. Use this when the user asks "how is the sprint going", "what\'s our velocity", or "help me plan the next sprint". Returns a structured analysis with a recommended next-sprint issue list and team capacity estimate.',
    inputSchema: z.object({
      project_id: z.string().optional().describe('UUID of the project to analyze. Omit to analyze all active projects together and surface cross-project velocity patterns.'),
    }),
  },

  get_project_metrics: {
    description:
      'Fetch a comprehensive metrics dashboard for one project or all projects. Returns: total issue count, status breakdown (backlog/todo/in_progress/in_review/done/cancelled), priority distribution (urgent/high/medium/low), category split (FRONT/BACK/API/DB/INFRA), completion rate (%), and recent activity (issues created/closed in the last 7 days). Use when the user asks about project health, "show me stats", "how many open bugs", or wants a data overview. Does NOT return individual issue lists — use search_issues for that.',
    inputSchema: z.object({
      project_id: z.string().optional().describe('UUID of the project to fetch metrics for. Omit to aggregate metrics across all projects the user has access to.'),
    }),
  },

  weekly_recap: {
    description:
      'Generate a human-readable weekly activity recap for one or all projects. Shows: issues completed in the period, issues currently in progress, newly created issues, and blocked or stale issues (no movement in 3+ days). Designed for async standups, stakeholder updates, or end-of-week reviews. Use when the user asks "what happened this week", "recap", "résumé", "avancement", "bilan", or "status update". Returns a structured Markdown summary grouped by project and status.',
    inputSchema: z.object({
      project_id: z.string().optional().describe('UUID of the project to recap. Omit to generate a cross-project recap covering all active projects.'),
      days: z.number().optional().describe('Number of calendar days to look back. Defaults to 7 (one week). Use 1 for a daily standup, 14 for a bi-weekly review, or 30 for a monthly summary.'),
    }),
  },

  suggest_priorities: {
    description:
      'Analyze all open issues and generate AI-powered reprioritization recommendations. Detects: urgent issues with no recent progress, low-priority tickets that are blocking higher-priority ones, stale issues (no update in 7+ days that should be closed or escalated), and priority distribution imbalances (e.g. too many urgents diluting actual urgency). Returns a ranked list of suggested priority changes with reasoning for each. Use when the user asks "what should I focus on", "reprioritize my backlog", "what\'s most important", or "triage suggestions". Does NOT apply changes automatically — present the suggestions and ask for confirmation, then use bulk_update_issues.',
    inputSchema: z.object({
      project_id: z.string().optional().describe('UUID of the project to analyze. Omit to generate cross-project priority recommendations.'),
    }),
  },

  plan_milestones: {
    description:
      'Analyze all open issues in a project and auto-group them into a sequenced, dev-ready milestone plan. Groups issues by: (1) Ship It — currently in_review or in_progress, (2) Critical Hotfixes — urgent/high bugs, (3) Technical domain clusters (FRONT/BACK/API/DB), (4) Feature tag groups, (5) Tech Debt. Estimates target dates for each milestone based on observed team velocity and the specified team size. Detects cross-issue dependencies through title and tag similarity. Returns a proposed milestone plan — do NOT create anything yet; wait for user confirmation, then call create_milestones_batch. Use when user asks for a roadmap, milestone plan, sprint plan, or Gantt breakdown.',
    inputSchema: z.object({
      project_id: z.string().describe('UUID of the project to plan milestones for. Required.'),
      target_date: z.string().optional().describe('Hard deadline in ISO 8601 format (YYYY-MM-DD). When provided, the milestone plan is compressed or reordered to ensure all milestones land before this date. Example: "2026-04-30".'),
      team_size: z.number().optional().describe('Number of developers actively working on this project. Defaults to 1. Increasing this value shortens estimated milestone durations proportionally. Example: 3 for a three-person team.'),
    }),
  },

  create_milestones_batch: {
    description:
      'Atomically create multiple milestones and assign the specified issues to each one. This is the execution step after plan_milestones: call this only after the user has reviewed and confirmed (or adjusted) the proposed plan. Each milestone entry requires a name and a list of issue UUIDs to assign. Optionally accepts a target_date and display order. Returns the list of created milestones with their IDs and assigned issue counts. If an issue_id does not exist, that assignment is skipped and reported in the errors list without failing the whole batch.',
    inputSchema: z.object({
      project_id: z.string().describe('UUID of the project to create milestones in.'),
      milestones: z.array(z.object({
        name: z.string().describe('Milestone name shown in the UI. Should be short and meaningful. Example: "Alpha Release", "Auth Hardening", "Tech Debt Q1".'),
        description: z.string().optional().describe('Optional markdown description of what this milestone represents and its goal.'),
        target_date: z.string().optional().describe('Target completion date in YYYY-MM-DD format. Example: "2026-04-15".'),
        order: z.number().optional().describe('Display order (1-based integer). Milestones are shown in ascending order in the UI.'),
        issue_ids: z.array(z.string()).describe('Array of internal issue UUIDs to assign to this milestone. Use UUIDs from plan_milestones output or search_issues results.'),
      })).describe('Ordered list of milestones to create. Typically sourced directly from the plan_milestones output after user confirmation.'),
    }),
  },

  adjust_timeline: {
    description:
      'Recalculate and propose an updated milestone schedule given a new deadline constraint or scope change. Fetches current milestones, open issues, detected dependencies, and recent velocity data, then reorders or reschedules milestones to respect the new constraint while honoring the dependency chain and team capacity. Use when the user says things like "I need to finish by March 15", "move the Alpha milestone to next week", or "we lost one dev, adjust the timeline". Returns a revised milestone plan proposal — does NOT apply changes automatically. After user confirmation, call create_milestones_batch with the updated dates or use update_issue to adjust individual milestones.',
    inputSchema: z.object({
      project_id: z.string().describe('UUID of the project whose timeline to adjust.'),
      constraint: z.string().describe('Natural-language description of the new constraint or deadline change. Examples: "finish everything by 2026-03-15", "move milestone Alpha two weeks earlier", "we now have only 2 devs instead of 3", "drop the Tech Debt milestone from scope".'),
    }),
  },

  triage_issue: {
    description:
      'Use AI to perform structured triage on a single issue: analyze its title and description, then suggest the optimal priority level, relevant tags, technical category, and a responsible owner based on domain expertise patterns in the project. Also performs a similarity search to surface related or potentially duplicate issues. Use this when an issue lands in the backlog without proper metadata, when the user asks to "triage", "auto-classify", or "review" a ticket, or as a quality gate before sprint planning. Returns structured suggestions including confidence scores — the user should confirm or adjust before applying changes via update_issue.',
    inputSchema: z.object({
      issue_id: z.string().describe('Internal UUID of the issue to triage. Resolve via search_issues if you only have the display_id (e.g. HLM-42).'),
    }),
  },

  manage_initiatives: {
    description:
      'Create, list, update, and link projects to strategic initiatives — high-level goals that span multiple projects or teams (e.g. "Q2 Product Launch", "Security Hardening 2026"). Use action=list to show all initiatives with their linked projects and progress status. Use action=create to define a new initiative with a name and description. Use action=update to change an initiative\'s name, description, or lifecycle status. Use action=add_project or action=remove_project to link or unlink a project from an initiative. Returns the affected initiative(s) with current metadata and linked project list.',
    inputSchema: z.object({
      action: z.enum(['list', 'create', 'update', 'add_project', 'remove_project']).describe('Operation to perform. Valid values: list (show all initiatives), create (new initiative), update (change fields), add_project (link a project), remove_project (unlink a project).'),
      initiative_id: z.string().optional().describe('UUID of the initiative to modify. Required for update, add_project, and remove_project actions. Omit for list and create.'),
      name: z.string().optional().describe('Initiative name. Required for create; optional for update. Example: "Q2 Product Launch".'),
      description: z.string().optional().describe('Markdown description of the initiative\'s goal and scope. Used in create and update actions.'),
      status: z.enum(['active', 'completed', 'archived']).optional().describe('Lifecycle status for update action.'),
      project_id: z.string().optional().describe('UUID of the project to link or unlink. Required for add_project and remove_project actions.'),
    }),
  },

  manage_automations: {
    description:
      'Configure event-driven workflow automations for a project: list existing rules, create new trigger→action pairs, toggle (enable/disable) a rule, or delete one. Automations fire automatically when a trigger condition is met (e.g. issue moves to in_review) and execute a configured action (e.g. set priority to high). Use this when the user wants to automate repetitive workflows, set up status-based notifications, enforce process rules, or reduce manual toil. Use action=list to see all automations before creating duplicates. Returns the automation record with its trigger, action, and enabled state.',
    inputSchema: z.object({
      action: z.enum(['list', 'create', 'toggle', 'delete']).describe('Operation to perform. Valid values: list (show all automations for the project), create (new rule), toggle (enable/disable an existing rule), delete (remove a rule permanently).'),
      project_id: z.string().describe('UUID of the project to manage automations for. Required for all actions.'),
      automation_id: z.string().optional().describe('UUID of the automation rule to toggle or delete. Required for toggle and delete actions.'),
      name: z.string().optional().describe('Human-readable name for the automation. Used in create. Example: "Auto-escalate stale urgents".'),
      trigger_type: z.enum(['status_changed', 'priority_changed', 'assignee_changed', 'label_added', 'due_date_passed']).optional().describe('Event that activates this automation. Required for create.'),
      trigger_config: z.string().optional().describe('JSON string with trigger-specific parameters. For status_changed: {"from_status":"todo","to_status":"in_progress"}. For priority_changed: {"to_priority":"urgent"}. For label_added: {"label":"regression"}.'),
      action_type: z.enum(['set_status', 'set_priority', 'add_label', 'assign_user', 'send_webhook', 'add_comment']).optional().describe('What happens when the trigger fires. Required for create.'),
      action_config: z.string().optional().describe('JSON string with action-specific parameters. For set_status: {"status":"in_review"}. For set_priority: {"priority":"high"}. For add_comment: {"content":"Auto-assigned to review queue"}. For send_webhook: {"url":"https://hooks.example.com/notify"}.'),
    }),
  },

  manage_sla: {
    description:
      'Manage Service Level Agreement (SLA) rules for a project and monitor compliance. SLA rules define maximum resolution time (in hours) per priority level — e.g. urgent issues must be resolved within 4 hours. Use action=list_rules to see current rules. Use action=stats to get compliance metrics: overall SLA achievement rate, number of breached issues, and average resolution time per priority. Use action=create_rule to add a new rule. Use action=delete_rule to remove one. Returns the rule or stats depending on the action. Use this when the user asks about SLAs, response times, breach counts, or wants to define resolution targets.',
    inputSchema: z.object({
      action: z.enum(['list_rules', 'stats', 'create_rule', 'delete_rule']).describe('Operation to perform. Valid values: list_rules (show all SLA rules), stats (SLA compliance metrics), create_rule (add a new priority→deadline rule), delete_rule (remove a rule).'),
      project_id: z.string().describe('UUID of the project to manage SLA rules for. Required for all actions.'),
      rule_id: z.string().optional().describe('UUID of the SLA rule to delete. Required for delete_rule action only.'),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('Priority level this rule applies to. Required for create_rule.'),
      deadline_hours: z.number().optional().describe('Maximum allowed resolution time in hours for the specified priority. Required for create_rule. Examples: 4 (urgent), 24 (high), 72 (medium), 168 (low/one week).'),
    }),
  },

  manage_templates: {
    description:
      'Manage reusable issue templates for a project — pre-configured issue skeletons that speed up ticket creation for common, repeating issue types (e.g. "Bug Report", "Feature Request", "Hotfix"). Use action=list to see available templates. Use action=create to define a new template with a pre-filled description, default priority, and default type. Use action=delete to remove an outdated template. Templates are not issues — they are configuration artifacts that users select when creating new issues in the UI. Returns the template record or a list of templates.',
    inputSchema: z.object({
      action: z.enum(['list', 'create', 'delete']).describe('Operation to perform. Valid values: list (show all templates for the project), create (add a new template), delete (remove a template permanently).'),
      project_id: z.string().describe('UUID of the project to manage templates for. Required for all actions.'),
      template_id: z.string().optional().describe('UUID of the template to delete. Required for delete action only.'),
      name: z.string().optional().describe('Display name for the template shown in the issue creation UI. Required for create. Example: "Bug Report", "Feature Request", "Security Incident".'),
      description: z.string().optional().describe('Pre-filled Markdown body that issues created from this template will have. Should include structured sections like "## Steps to Reproduce", "## Expected Behavior", "## Acceptance Criteria". Required for create.'),
      default_priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('Default priority pre-selected when using this template. Used in create.'),
      default_type: z.enum(['bug', 'feature', 'improvement', 'question']).optional().describe('Default issue type pre-selected when using this template. Used in create.'),
    }),
  },

  manage_recurring: {
    description:
      'Manage recurring issue configurations that automatically create new tickets on a scheduled cron cadence. Useful for predictable, repeating work like weekly code reviews, monthly security audits, or daily standup tickets. Use action=list to see all recurring configs. Use action=create to define a new one with a title, description, priority, type, and cron schedule. Use action=toggle to pause or resume a recurring config without deleting it. Use action=trigger to manually fire a recurring config immediately (useful for testing). Use action=delete to permanently remove it. Returns the recurring config record with its next scheduled run time.',
    inputSchema: z.object({
      action: z.enum(['list', 'create', 'toggle', 'trigger', 'delete']).describe('Operation to perform. Valid values: list (show all recurring configs), create (define a new one), toggle (pause/resume), trigger (run immediately), delete (remove permanently).'),
      project_id: z.string().describe('UUID of the project to manage recurring issue configs for. Required for all actions.'),
      recurring_id: z.string().optional().describe('UUID of the recurring config to toggle, trigger, or delete. Required for toggle, trigger, and delete actions.'),
      title: z.string().optional().describe('Title template for the auto-created issues. Required for create. Example: "Weekly Security Review", "Daily Dependency Scan".'),
      description: z.string().optional().describe('Markdown description body for the auto-created issues. Required for create. Should include checklist or instructions for the recurring task.'),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).optional().describe('Priority assigned to each auto-created issue. Required for create.'),
      issue_type: z.enum(['bug', 'feature', 'improvement', 'question']).optional().describe('Type assigned to each auto-created issue. Required for create.'),
      cron_expression: z.string().optional().describe('Standard 5-field cron expression controlling the schedule. Required for create. Examples: "0 9 * * 1" (every Monday 9am), "0 0 1 * *" (first of every month midnight), "0 8 * * 1-5" (weekdays 8am). Uses UTC timezone.'),
    }),
  },

  export_project: {
    description:
      'Export the complete dataset of all issues in a project as a structured JSON payload. Returns every issue with all fields including id, display_id, title, description, status, priority, type, tags, category, created_at, updated_at, and comments. Use this when the user wants a full data dump, wants to back up their project, analyze data externally, or migrate to another tool. Note: for large projects (500+ issues), the response may be large — warn the user. Does NOT export milestone or automation data; those require separate API calls.',
    inputSchema: z.object({
      project_id: z.string().describe('UUID of the project to export. All issues in this project will be included in the export payload.'),
    }),
  },
};

// ─── Zod Tool Masking ─────────────────────────
export function getZodToolsForContext(context: SkillContext = 'default'): Record<string, { description: string; inputSchema: z.ZodType }> {
  const allowedNames = SKILL_GROUPS[context] || SKILL_GROUPS.default;
  const tools: Record<string, { description: string; inputSchema: z.ZodType }> = {};
  for (const name of allowedNames) {
    if (TOOL_SCHEMAS[name]) {
      tools[name] = TOOL_SCHEMAS[name];
    }
  }
  return tools;
}

// ─── Intent-based Context Detection ───────────
// Detect context from user message (simple intent classification)
export function detectSkillContext(message: string, recentSkills: string[] = []): SkillContext {
  const lower = message.toLowerCase();

  // If last skill was plan_milestones → we're in confirm mode
  if (recentSkills.includes('plan_milestones') && 
      (lower.includes('apply') || lower.includes('appliquer') || lower.includes('oui') || 
       lower.includes('yes') || lower.includes('ok') || lower.includes('go') ||
       lower.includes('adjust') || lower.includes('ajust'))) {
    return 'milestone_confirm';
  }

  // Milestone planning intent
  if (lower.includes('milestone') || lower.includes('jalon') || lower.includes('plan') || 
      lower.includes('roadmap') || lower.includes('timeline') || lower.includes('gantt')) {
    return 'milestone_planning';
  }

  // Read-only intent
  if (lower.includes('recap') || lower.includes('résumé') || lower.includes('metric') || 
      lower.includes('analyse') || lower.includes('analyze') || lower.includes('report') ||
      lower.includes('how many') || lower.includes('combien') || lower.includes('stats')) {
    return 'read_only';
  }

  // Creation intent
  if (lower.includes('create') || lower.includes('créer') || lower.includes('ajoute') ||
      lower.includes('add') || lower.includes('new issue') || lower.includes('nouveau') ||
      lower.includes('generate prd') || lower.includes('prd')) {
    return 'creation';
  }

  // Management/configuration intent
  if (lower.includes('automation') || lower.includes('automatisation') ||
      lower.includes('template') || lower.includes('modèle') ||
      lower.includes('sla') || lower.includes('recurring') || lower.includes('récurrent') ||
      lower.includes('initiative') || lower.includes('export') ||
      lower.includes('workflow') || lower.includes('règle') || lower.includes('rule')) {
    return 'management';
  }

  return 'default';
}

// ─── Skill Result Types ───────────────────────
export interface SkillResult {
  skill: string;
  success: boolean;
  data?: unknown;
  error?: string;
  /** Human-readable summary of what was done */
  summary: string;
  /** Human-readable text the model will see as tool result */
  formattedForModel?: string;
}

export interface SkillExecution {
  name: string;
  args: Record<string, unknown>;
  result?: SkillResult;
  status: 'pending' | 'executing' | 'done' | 'error';
}
