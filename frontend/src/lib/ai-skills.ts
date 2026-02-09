/**
 * Baaton AI Skills — Function calling definitions for Gemini.
 * Each skill maps to a Gemini tool and an executor that calls the Baaton API.
 */

// ─── Gemini Tool Definitions ──────────────────
export const SKILL_TOOLS = [
  {
    functionDeclarations: [
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
    ],
  },
];

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
