/**
 * Baaton AI Skills — Function calling definitions for Gemini.
 * Each skill maps to a Gemini tool and an executor that calls the Baaton API.
 *
 * TOOL MASKING (Manus pattern):
 * Not all tools are relevant at all times. Use getToolsForContext()
 * to get context-appropriate tools instead of exposing all 13.
 */

// ─── Skill Groups (for tool masking) ──────────
export type SkillContext = 'default' | 'milestone_planning' | 'milestone_confirm' | 'read_only' | 'creation';

const SKILL_GROUPS: Record<SkillContext, string[]> = {
  // Default: core skills for general chat
  default: [
    'search_issues', 'create_issue', 'update_issue', 'bulk_update_issues',
    'add_comment', 'get_project_metrics', 'analyze_sprint', 'generate_prd',
    'weekly_recap', 'suggest_priorities', 'plan_milestones',
    'triage_issue', 'manage_initiatives', 'manage_automations', 'manage_sla',
    'manage_templates', 'manage_recurring', 'export_project',
  ],
  // Milestone planning: after user asks to plan milestones
  milestone_planning: [
    'plan_milestones', 'search_issues', 'get_project_metrics',
  ],
  // Milestone confirm: after plan proposed, waiting for confirm/adjust
  milestone_confirm: [
    'create_milestones_batch', 'adjust_timeline', 'plan_milestones',
  ],
  // Read-only: for analytics/reporting queries
  read_only: [
    'search_issues', 'get_project_metrics', 'analyze_sprint', 'weekly_recap', 'suggest_priorities',
  ],
  // Creation: when user wants to create things
  creation: [
    'create_issue', 'add_comment', 'generate_prd', 'plan_milestones',
    'create_milestones_batch', 'search_issues',
  ],
};

// ─── All Skill Declarations ───────────────────
const ALL_SKILL_DECLARATIONS = [
      {
        name: 'search_issues',
        description:
          'Search and filter issues across all projects. Use this to find specific issues, list blockers, get issues by status/priority/category, or answer questions about what exists.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Text search in title/description' },
            project_id: { type: 'STRING', description: 'Filter by project ID' },
            status: {
              type: 'STRING',
              description: 'Filter by status: backlog, todo, in_progress, in_review, done, cancelled',
            },
            priority: {
              type: 'STRING',
              description: 'Filter by priority: urgent, high, medium, low',
            },
            category: {
              type: 'STRING',
              description: 'Filter by category: FRONT, BACK, API, DB',
            },
            limit: { type: 'NUMBER', description: 'Max results (default 20)' },
          },
          required: [],
        },
      },
      {
        name: 'create_issue',
        description:
          'Create a new issue/ticket in a project. Auto-detect type (bug/feature/improvement), priority from urgency, and category from technical domain (FRONT/BACK/API/DB/INFRA). Fill as many fields as possible.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID to create the issue in' },
            title: { type: 'STRING', description: 'Issue title — clear, concise, action-oriented. ABSOLUTE RULE: ZERO brackets, ZERO project prefix, ZERO type tags in the title. BAD: "[SQX][BUG] Fix auth", "[HLM][TECH] Refactor", "SQX: Fix auth". GOOD: "Fix auth token refresh". The project, type, and category are separate fields.' },
            description: {
              type: 'STRING',
              description: 'Detailed description in Markdown format',
            },
            type: {
              type: 'STRING',
              description: 'Issue type: bug, feature, improvement, question',
            },
            priority: {
              type: 'STRING',
              description: 'Priority: urgent, high, medium, low',
            },
            status: {
              type: 'STRING',
              description: 'Initial status (default: backlog). Use backlog unless user explicitly requests todo/in_progress.',
            },
            tags: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Tags to apply',
            },
            category: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Technical domains: FRONT, BACK, API, DB, INFRA, UX, DEVOPS. Auto-detect from context.',
            },
          },
          required: ['project_id', 'title'],
        },
      },
      {
        name: 'update_issue',
        description:
          'Update an existing issue. Use when the user asks to change status, priority, title, description, tags, or category of an issue. Identify the issue by its display_id (e.g. HLM-42).',
        parameters: {
          type: 'OBJECT',
          properties: {
            issue_id: { type: 'STRING', description: 'Issue UUID' },
            title: { type: 'STRING', description: 'New title' },
            description: { type: 'STRING', description: 'New description' },
            status: { type: 'STRING', description: 'New status' },
            priority: { type: 'STRING', description: 'New priority' },
            type: { type: 'STRING', description: 'New type' },
            tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'New tags' },
            category: { type: 'ARRAY', items: { type: 'STRING' }, description: 'New categories' },
          },
          required: ['issue_id'],
        },
      },
      {
        name: 'bulk_update_issues',
        description:
          'Bulk update multiple issues at once. Use for reprioritization, bulk status changes, or batch operations. Returns the list of updated issues.',
        parameters: {
          type: 'OBJECT',
          properties: {
            updates: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  issue_id: { type: 'STRING', description: 'Issue UUID' },
                  status: { type: 'STRING' },
                  priority: { type: 'STRING' },
                  tags: { type: 'ARRAY', items: { type: 'STRING' } },
                  category: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['issue_id'],
              },
              description: 'Array of issue updates to apply',
            },
          },
          required: ['updates'],
        },
      },
      {
        name: 'add_comment',
        description:
          'Add a comment to an issue. Use when the user asks to note, comment, or annotate an issue.',
        parameters: {
          type: 'OBJECT',
          properties: {
            issue_id: { type: 'STRING', description: 'Issue UUID' },
            content: { type: 'STRING', description: 'Comment text in Markdown' },
            author_name: { type: 'STRING', description: 'Comment author name' },
          },
          required: ['issue_id', 'content'],
        },
      },
      {
        name: 'generate_prd',
        description:
          'Generate a Product Requirements Document (PRD) from a brief description. Returns structured Markdown PRD with objectives, user stories, acceptance criteria, and technical notes. Use when the user asks to write a spec, PRD, or detailed requirements.',
        parameters: {
          type: 'OBJECT',
          properties: {
            brief: {
              type: 'STRING',
              description: 'Brief description of what needs to be built',
            },
            project_id: { type: 'STRING', description: 'Project context for the PRD' },
          },
          required: ['brief'],
        },
      },
      {
        name: 'analyze_sprint',
        description:
          'Analyze sprint velocity and suggest a sprint plan. Looks at done vs in-progress vs todo ratios, identifies bottlenecks, and recommends next sprint scope.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project to analyze (or all if omitted)' },
          },
          required: [],
        },
      },
      {
        name: 'get_project_metrics',
        description:
          'Get detailed metrics for a project or all projects: status breakdown, priority distribution, category split, completion rate, recent activity.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID (omit for all projects)' },
          },
          required: [],
        },
      },
      {
        name: 'weekly_recap',
        description:
          'Generate a weekly recap of activity across all projects. Shows issues completed, in progress, newly created, and blocked. Use when the user asks "what happened this week", "recap", "résumé", "avancement", or "status update".',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID (omit for all projects)' },
            days: { type: 'NUMBER', description: 'Number of days to look back (default 7)' },
          },
          required: [],
        },
      },
      {
        name: 'suggest_priorities',
        description:
          'Analyze open issues and suggest priority changes. Identifies: urgents without progress, low-priority blockers, stale issues (no update in 7+ days), and priority imbalances. Use when user asks to "reprioritize", "what should I focus on", or "suggest priorities".',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID (omit for all projects)' },
          },
          required: [],
        },
      },
      {
        name: 'plan_milestones',
        description:
          'Analyze all open tickets and auto-group into dev-ready milestones. Groups by: 1) Ship It (in_review/in_progress), 2) Critical Hotfixes (urgent bugs), 3) Technical domain (FRONT/BACK/API/DB), 4) Feature tags, 5) Tech Debt. Returns proposed milestones with target dates based on team velocity. Detects cross-issue dependencies by title similarity.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID to plan milestones for' },
            target_date: {
              type: 'STRING',
              description:
                'Optional: target completion date (YYYY-MM-DD). If provided, the plan will be optimized to meet this deadline.',
            },
            team_size: {
              type: 'NUMBER',
              description:
                'Optional: number of developers/agents working (default 1). Affects timing estimates.',
            },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'create_milestones_batch',
        description:
          'Create multiple milestones and assign issues to them. Use after plan_milestones when the user confirms the proposed plan.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID' },
            milestones: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  description: { type: 'STRING' },
                  target_date: { type: 'STRING', description: 'YYYY-MM-DD' },
                  order: { type: 'NUMBER' },
                  issue_ids: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                    description: 'Issue IDs to assign to this milestone',
                  },
                },
                required: ['name', 'issue_ids'],
              },
            },
          },
          required: ['project_id', 'milestones'],
        },
      },
      {
        name: 'adjust_timeline',
        description:
          'Adjust the milestone timeline based on a new deadline or constraint. Fetches milestones, open issues, detected dependencies, and velocity data. Uses this to propose rescheduling that respects the dependency chain and team capacity. Example: "I want to finish milestone X by March 15" — recalculates the entire plan.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID' },
            constraint: {
              type: 'STRING',
              description:
                'The constraint or deadline change. E.g., "finish by 2026-03-15" or "move milestone Alpha to next week"',
            },
          },
          required: ['project_id', 'constraint'],
        },
      },
      // ─── New skills (BAA features) ──────────────
      {
        name: 'triage_issue',
        description: 'Use AI to analyze an issue and suggest priority, tags, assignee, and find similar issues. Returns structured suggestions that the user can accept or modify.',
        parameters: {
          type: 'OBJECT',
          properties: {
            issue_id: { type: 'STRING', description: 'Issue ID to triage' },
          },
          required: ['issue_id'],
        },
      },
      {
        name: 'manage_initiatives',
        description: 'List, create, or update initiatives (high-level strategic goals that group multiple projects). Use "list" to see all, "create" to make one, "update" to change status/name.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action: list, create, update, add_project, remove_project' },
            initiative_id: { type: 'STRING', description: 'Initiative ID (for update/add_project/remove_project)' },
            name: { type: 'STRING', description: 'Name (for create/update)' },
            description: { type: 'STRING', description: 'Description (for create/update)' },
            status: { type: 'STRING', description: 'Status: active, completed, archived (for update)' },
            project_id: { type: 'STRING', description: 'Project ID (for add_project/remove_project)' },
          },
          required: ['action'],
        },
      },
      {
        name: 'manage_automations',
        description: 'List, create, toggle, or delete workflow automations for a project. Automations run when triggers fire (status change, priority change, etc.) and execute actions (set status, assign, add label, etc.).',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action: list, create, toggle, delete' },
            project_id: { type: 'STRING', description: 'Project ID' },
            automation_id: { type: 'STRING', description: 'Automation ID (for toggle/delete)' },
            name: { type: 'STRING', description: 'Name (for create)' },
            trigger_type: { type: 'STRING', description: 'Trigger: status_changed, priority_changed, assignee_changed, label_added, due_date_passed' },
            trigger_config: { type: 'STRING', description: 'JSON trigger config (e.g. {"from_status":"todo","to_status":"in_progress"})' },
            action_type: { type: 'STRING', description: 'Action: set_status, set_priority, add_label, assign_user, send_webhook, add_comment' },
            action_config: { type: 'STRING', description: 'JSON action config (e.g. {"status":"in_review"})' },
          },
          required: ['action', 'project_id'],
        },
      },
      {
        name: 'manage_sla',
        description: 'List SLA rules for a project, get SLA stats (achievement rate, breached count), or create/delete rules. SLA rules set deadline hours per priority level.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action: list_rules, stats, create_rule, delete_rule' },
            project_id: { type: 'STRING', description: 'Project ID' },
            rule_id: { type: 'STRING', description: 'Rule ID (for delete)' },
            priority: { type: 'STRING', description: 'Priority level (for create): urgent, high, medium, low' },
            deadline_hours: { type: 'NUMBER', description: 'Deadline in hours (for create)' },
          },
          required: ['action', 'project_id'],
        },
      },
      {
        name: 'manage_templates',
        description: 'List, create, or delete issue templates for a project. Templates pre-fill issue fields for common issue types.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action: list, create, delete' },
            project_id: { type: 'STRING', description: 'Project ID' },
            template_id: { type: 'STRING', description: 'Template ID (for delete)' },
            name: { type: 'STRING', description: 'Template name (for create)' },
            description: { type: 'STRING', description: 'Template description body (for create)' },
            default_priority: { type: 'STRING', description: 'Default priority (for create)' },
            default_type: { type: 'STRING', description: 'Default issue type (for create)' },
          },
          required: ['action', 'project_id'],
        },
      },
      {
        name: 'manage_recurring',
        description: 'List, create, toggle, trigger, or delete recurring issue configurations. Recurring issues auto-create on a cron schedule.',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', description: 'Action: list, create, toggle, trigger, delete' },
            project_id: { type: 'STRING', description: 'Project ID' },
            recurring_id: { type: 'STRING', description: 'Recurring ID (for toggle/trigger/delete)' },
            title: { type: 'STRING', description: 'Issue title (for create)' },
            description: { type: 'STRING', description: 'Issue description (for create)' },
            priority: { type: 'STRING', description: 'Priority (for create)' },
            issue_type: { type: 'STRING', description: 'Type: bug, feature, improvement, question (for create)' },
            cron_expression: { type: 'STRING', description: 'Cron expression, e.g. "0 9 * * 1" for every Monday 9am (for create)' },
          },
          required: ['action', 'project_id'],
        },
      },
      {
        name: 'export_project',
        description: 'Export all issues from a project as JSON. Returns the full export data.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID to export' },
          },
          required: ['project_id'],
        },
      },
];

function normalizeGeminiSchemaNode(node: any): any {
  if (!node || typeof node !== 'object') {
    return { type: 'STRING' };
  }

  const normalized = { ...node };

  if (!normalized.type) normalized.type = 'STRING';

  if (normalized.type === 'OBJECT') {
    normalized.properties = normalized.properties && typeof normalized.properties === 'object'
      ? { ...normalized.properties }
      : {};

    for (const [key, value] of Object.entries(normalized.properties)) {
      normalized.properties[key] = normalizeGeminiSchemaNode(value);
    }

    if (Array.isArray(normalized.required) && normalized.required.length === 0) {
      delete normalized.required;
    }
  }

  if (normalized.type === 'ARRAY') {
    normalized.items = normalizeGeminiSchemaNode(normalized.items || { type: 'STRING' });
  }

  return normalized;
}

function normalizeDeclaration<T extends { parameters?: any }>(decl: T): T {
  const copy = { ...decl };
  copy.parameters = normalizeGeminiSchemaNode(copy.parameters || { type: 'OBJECT', properties: {} });
  return copy;
}

// ─── Tool Masking (Manus Pattern) ─────────────
// Returns ONLY context-relevant tools, reducing confusion and improving accuracy.
// HelmAI: state-aware masking via XState meta. Baaton: intent-based masking.

export function getToolsForContext(context: SkillContext = 'default') {
  const allowedNames = SKILL_GROUPS[context] || SKILL_GROUPS.default;
  const filtered = ALL_SKILL_DECLARATIONS
    .filter((d) => allowedNames.includes(d.name))
    .map((d) => normalizeDeclaration(d));
  return [{ functionDeclarations: filtered }];
}

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

  return 'default';
}

// Legacy: full tool set (for backwards compat)
export const SKILL_TOOLS = [{ functionDeclarations: ALL_SKILL_DECLARATIONS.map((d) => normalizeDeclaration(d)) }];

// ─── Skill Result Types ───────────────────────
export interface SkillResult {
  skill: string;
  success: boolean;
  data?: unknown;
  error?: string;
  /** Human-readable summary of what was done */
  summary: string;
}

export interface SkillExecution {
  name: string;
  args: Record<string, unknown>;
  result?: SkillResult;
  status: 'pending' | 'executing' | 'done' | 'error';
}
