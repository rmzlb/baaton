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
        },
      },
      {
        name: 'create_issue',
        description:
          'Create a new issue/ticket in a project. Use when the user asks to create, add, or log a new task, bug, feature request, etc.',
        parameters: {
          type: 'OBJECT',
          properties: {
            project_id: { type: 'STRING', description: 'Project ID to create the issue in' },
            title: { type: 'STRING', description: 'Issue title — clear and concise' },
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
              description: 'Initial status (default: todo)',
            },
            tags: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Tags to apply',
            },
            category: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Categories: FRONT, BACK, API, DB',
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
        },
      },
      {
        name: 'plan_milestones',
        description:
          'Analyze all open tickets in a project and propose a milestone plan with groupings, timing estimates, and priority ordering. Auto-detects dependencies between issues (by title/description similarity and explicit references). Returns velocity data (issues/week) for realistic timeline estimates. The AI will group related tickets into logical milestones, identify the critical path (longest dependency chain), and suggest a sequenced delivery plan.',
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
];

// ─── Tool Masking (Manus Pattern) ─────────────
// Returns ONLY context-relevant tools, reducing confusion and improving accuracy.
// HelmAI: state-aware masking via XState meta. Baaton: intent-based masking.

export function getToolsForContext(context: SkillContext = 'default') {
  const allowedNames = SKILL_GROUPS[context] || SKILL_GROUPS.default;
  const filtered = ALL_SKILL_DECLARATIONS.filter((d) => allowedNames.includes(d.name));
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
export const SKILL_TOOLS = [{ functionDeclarations: ALL_SKILL_DECLARATIONS }];

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
