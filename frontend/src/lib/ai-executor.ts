/**
 * Baaton AI Skill Executor — executes function calls from Gemini via the Baaton API.
 */

import type { Issue, Project } from './types';
import type { SkillResult } from './ai-skills';

type ApiClient = {
  issues: {
    listByProject: (projectId: string, params?: Record<string, unknown>) => Promise<Issue[]>;
    create: (body: Record<string, unknown>) => Promise<Issue>;
    update: (id: string, body: Record<string, unknown>) => Promise<Issue>;
    delete: (id: string) => Promise<void>;
  };
  comments: {
    create: (issueId: string, body: { content: string; author_name: string }) => Promise<unknown>;
  };
  projects: {
    list: () => Promise<Project[]>;
  };
};

// ─── Executors ────────────────────────────────

async function executeSearchIssues(
  args: Record<string, unknown>,
  _api: ApiClient,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const query = (args.query as string || '').toLowerCase();
    const statusFilter = args.status as string | undefined;
    const priorityFilter = args.priority as string | undefined;
    const categoryFilter = args.category as string | undefined;
    const projectId = args.project_id as string | undefined;
    const limit = (args.limit as number) || 20;

    let results: (Issue & { project_name?: string })[] = [];

    // If project_id specified, filter from that project only
    if (projectId && allIssues[projectId]) {
      results = allIssues[projectId].map((i) => ({
        ...i,
        project_name: projects.find((p) => p.id === projectId)?.name,
      }));
    } else {
      // All projects
      for (const project of projects) {
        const issues = allIssues[project.id] || [];
        results.push(...issues.map((i) => ({ ...i, project_name: project.name })));
      }
    }

    // Apply filters
    if (query) {
      results = results.filter(
        (i) =>
          i.title.toLowerCase().includes(query) ||
          (i.description || '').toLowerCase().includes(query) ||
          i.display_id.toLowerCase().includes(query),
      );
    }
    if (statusFilter) results = results.filter((i) => i.status === statusFilter);
    if (priorityFilter) results = results.filter((i) => i.priority === priorityFilter);
    if (categoryFilter) results = results.filter((i) => (i.category || []).includes(categoryFilter));

    results = results.slice(0, limit);

    return {
      skill: 'search_issues',
      success: true,
      data: results.map((i) => ({
        id: i.id,
        display_id: i.display_id,
        title: i.title,
        status: i.status,
        priority: i.priority,
        type: i.type,
        tags: i.tags,
        category: i.category,
        project_name: i.project_name,
        updated_at: i.updated_at,
      })),
      summary: `Found ${results.length} issue${results.length !== 1 ? 's' : ''}`,
    };
  } catch (err) {
    return { skill: 'search_issues', success: false, error: String(err), summary: 'Search failed' };
  }
}

async function executeCreateIssue(
  args: Record<string, unknown>,
  api: ApiClient,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string;
    if (!projectId) return { skill: 'create_issue', success: false, error: 'Missing project_id', summary: 'No project specified' };

    const project = projects.find((p) => p.id === projectId || p.prefix === projectId || p.name === projectId);
    const targetProjectId = project?.id || projectId;

    const issue = await api.issues.create({
      project_id: targetProjectId,
      title: args.title as string,
      description: args.description as string || '',
      type: args.type as string || 'feature',
      priority: args.priority as string || 'medium',
      status: args.status as string || 'todo',
      tags: args.tags as string[] || [],
      category: args.category as string[] || [],
    });

    return {
      skill: 'create_issue',
      success: true,
      data: { id: issue.id, display_id: issue.display_id, title: issue.title },
      summary: `Created **${issue.display_id}** — ${issue.title}`,
    };
  } catch (err) {
    return { skill: 'create_issue', success: false, error: String(err), summary: 'Failed to create issue' };
  }
}

async function executeUpdateIssue(
  args: Record<string, unknown>,
  api: ApiClient,
): Promise<SkillResult> {
  try {
    const issueId = args.issue_id as string;
    if (!issueId) return { skill: 'update_issue', success: false, error: 'Missing issue_id', summary: 'No issue specified' };

    const body: Record<string, unknown> = {};
    if (args.title) body.title = args.title;
    if (args.description) body.description = args.description;
    if (args.status) body.status = args.status;
    if (args.priority) body.priority = args.priority;
    if (args.type) body.type = args.type;
    if (args.tags) body.tags = args.tags;
    if (args.category) body.category = args.category;

    const updated = await api.issues.update(issueId, body);

    const changes = Object.keys(body).join(', ');
    return {
      skill: 'update_issue',
      success: true,
      data: { id: updated.id, display_id: updated.display_id },
      summary: `Updated **${updated.display_id}** (${changes})`,
    };
  } catch (err) {
    return { skill: 'update_issue', success: false, error: String(err), summary: 'Failed to update issue' };
  }
}

async function executeBulkUpdateIssues(
  args: Record<string, unknown>,
  api: ApiClient,
): Promise<SkillResult> {
  try {
    const updates = args.updates as Array<{ issue_id: string; [key: string]: unknown }>;
    if (!updates?.length) return { skill: 'bulk_update_issues', success: false, error: 'No updates', summary: 'Empty update list' };

    const results: string[] = [];
    let successCount = 0;

    for (const update of updates) {
      try {
        const { issue_id, ...body } = update;
        const updated = await api.issues.update(issue_id, body);
        results.push(`✅ ${updated.display_id}`);
        successCount++;
      } catch {
        results.push(`❌ ${update.issue_id}`);
      }
    }

    return {
      skill: 'bulk_update_issues',
      success: true,
      data: { updated: successCount, total: updates.length, details: results },
      summary: `Bulk updated ${successCount}/${updates.length} issues`,
    };
  } catch (err) {
    return { skill: 'bulk_update_issues', success: false, error: String(err), summary: 'Bulk update failed' };
  }
}

async function executeAddComment(
  args: Record<string, unknown>,
  api: ApiClient,
): Promise<SkillResult> {
  try {
    const issueId = args.issue_id as string;
    if (!issueId) return { skill: 'add_comment', success: false, error: 'Missing issue_id', summary: 'No issue specified' };

    await api.comments.create(issueId, {
      content: args.content as string,
      author_name: (args.author_name as string) || 'Baaton AI',
    });

    return {
      skill: 'add_comment',
      success: true,
      summary: `Comment added to issue`,
    };
  } catch (err) {
    return { skill: 'add_comment', success: false, error: String(err), summary: 'Failed to add comment' };
  }
}

async function executeGetMetrics(
  args: Record<string, unknown>,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string | undefined;
    const targetProjects = projectId
      ? projects.filter((p) => p.id === projectId)
      : projects;

    const metrics: Record<string, unknown>[] = [];

    for (const project of targetProjects) {
      const issues = allIssues[project.id] || [];
      const statusCounts: Record<string, number> = {};
      const priorityCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};

      for (const issue of issues) {
        statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
        if (issue.priority) priorityCounts[issue.priority] = (priorityCounts[issue.priority] || 0) + 1;
        for (const cat of issue.category || []) {
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
      }

      const done = statusCounts['done'] || 0;
      const total = issues.length;

      metrics.push({
        project: project.name,
        prefix: project.prefix,
        total_issues: total,
        completion_rate: total > 0 ? `${Math.round((done / total) * 100)}%` : '0%',
        status: statusCounts,
        priority: priorityCounts,
        category: categoryCounts,
      });
    }

    return {
      skill: 'get_project_metrics',
      success: true,
      data: metrics,
      summary: `Metrics for ${targetProjects.length} project${targetProjects.length !== 1 ? 's' : ''}`,
    };
  } catch (err) {
    return { skill: 'get_project_metrics', success: false, error: String(err), summary: 'Failed to get metrics' };
  }
}

// ─── Main Executor ────────────────────────────

export async function executeSkill(
  skillName: string,
  args: Record<string, unknown>,
  api: ApiClient,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  switch (skillName) {
    case 'search_issues':
      return executeSearchIssues(args, api, allIssues, projects);
    case 'create_issue':
      return executeCreateIssue(args, api, projects);
    case 'update_issue':
      return executeUpdateIssue(args, api);
    case 'bulk_update_issues':
      return executeBulkUpdateIssues(args, api);
    case 'add_comment':
      return executeAddComment(args, api);
    case 'get_project_metrics':
      return executeGetMetrics(args, allIssues, projects);
    case 'analyze_sprint':
      return executeGetMetrics(args, allIssues, projects); // reuse metrics for sprint analysis
    case 'generate_prd':
      // PRD generation is handled by the LLM itself — return the brief as context
      return {
        skill: 'generate_prd',
        success: true,
        data: { brief: args.brief, project_id: args.project_id },
        summary: 'PRD context ready — generating document',
      };
    default:
      return { skill: skillName, success: false, error: `Unknown skill: ${skillName}`, summary: `Unknown skill: ${skillName}` };
  }
}
