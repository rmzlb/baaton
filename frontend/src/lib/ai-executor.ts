/**
 * Baaton AI Skill Executor — executes function calls from Gemini via the Baaton API.
 */

import type { Issue, Project, Milestone } from './types';
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
  milestones: {
    listByProject: (projectId: string) => Promise<Milestone[]>;
    create: (projectId: string, body: { name: string; description?: string; target_date?: string; status?: string }) => Promise<Milestone>;
    update: (id: string, body: Partial<Pick<Milestone, 'name' | 'description' | 'target_date' | 'status'>>) => Promise<Milestone>;
    delete: (id: string) => Promise<void>;
  };
};

// ─── Result Validation (lightweight Zod alternative) ──────
function validateSkillResult(result: SkillResult): SkillResult {
  // Ensure required fields exist
  if (!result.skill || typeof result.skill !== 'string') {
    return { skill: 'unknown', success: false, error: 'Invalid skill result: missing skill name', summary: 'Validation error' };
  }
  if (typeof result.success !== 'boolean') {
    result.success = false;
  }
  if (!result.summary || typeof result.summary !== 'string') {
    result.summary = result.success ? `${result.skill} completed` : `${result.skill} failed`;
  }
  // Sanitize data — prevent circular references
  if (result.data !== undefined) {
    try {
      JSON.stringify(result.data);
    } catch {
      result.data = { error: 'Data too complex to serialize' };
    }
  }
  return result;
}

// ─── Executors ────────────────────────────────
function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((v) => v.trim().length > 0);
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  const arr = normalizeStringArray(value);
  return arr.length > 0 ? arr : undefined;
}

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
    const rawProjectId = (args.project_id as string | undefined)?.trim();
    const hintText = `${String(args.title || '')} ${String(args.description || '')}`.toLowerCase();

    const inferredProject = projects.find((p) =>
      hintText.includes((p.prefix || '').toLowerCase()) ||
      hintText.includes((p.name || '').toLowerCase()) ||
      hintText.includes((p.slug || '').toLowerCase()),
    );

    const projectId = rawProjectId || inferredProject?.id;
    if (!projectId) {
      const choices = projects.slice(0, 8).map((p) => `${p.prefix} (${p.name})`).join(', ');
      return {
        skill: 'create_issue',
        success: false,
        error: 'Missing project_id',
        summary: `Project manquant. Précise le projet (ex: ${choices}).`,
      };
    }

    const project = projects.find((p) => p.id === projectId || p.prefix === projectId || p.name === projectId || p.slug === projectId);
    const targetProjectId = project?.id || projectId;

    const issue = await api.issues.create({
      project_id: targetProjectId,
      title: args.title as string,
      description: args.description as string || '',
      type: args.type as string || 'feature',
      priority: args.priority as string || 'medium',
      status: args.status as string || 'todo',
      tags: normalizeStringArray(args.tags),
      category: normalizeStringArray(args.category),
    });

    return {
      skill: 'create_issue',
      success: true,
      data: { id: issue.id, display_id: issue.display_id, title: issue.title },
      summary: `Created **${issue.display_id}** — ${issue.title}`,
    };
  } catch (err) {
    const raw = String(err);
    const match = raw.match(/\{.*\}/s);
    let apiMessage = raw;
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        apiMessage = parsed?.error?.message || parsed?.error || raw;
      } catch {
        apiMessage = raw;
      }
    }

    return {
      skill: 'create_issue',
      success: false,
      error: apiMessage,
      summary: `Failed to create issue: ${apiMessage}`,
    };
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
    if (args.tags !== undefined) body.tags = normalizeStringArray(args.tags);
    if (args.category !== undefined) body.category = normalizeStringArray(args.category);

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
        if ((body as any).tags !== undefined) {
          (body as any).tags = normalizeStringArray((body as any).tags);
        }
        if ((body as any).category !== undefined) {
          (body as any).category = normalizeStringArray((body as any).category);
        }
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

// ─── Weekly Recap ─────────────────────────────

async function executeWeeklyRecap(
  args: Record<string, unknown>,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string | undefined;
    const days = (args.days as number) || 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const targetProjects = projectId ? projects.filter((p) => p.id === projectId) : projects;

    const recap: Record<string, unknown>[] = [];

    for (const project of targetProjects) {
      const issues = allIssues[project.id] || [];
      const recentlyDone = issues.filter((i) => i.status === 'done' && new Date(i.updated_at) > cutoff);
      const inProgress = issues.filter((i) => i.status === 'in_progress');
      const inReview = issues.filter((i) => i.status === 'in_review');
      const recentlyCreated = issues.filter((i) => new Date(i.created_at) > cutoff);
      const blocked = issues.filter((i) => i.priority === 'urgent' && i.status !== 'done' && i.status !== 'cancelled');
      const stale = issues.filter((i) => {
        const daysSinceUpdate = (Date.now() - new Date(i.updated_at).getTime()) / (24 * 60 * 60 * 1000);
        return daysSinceUpdate > 7 && i.status !== 'done' && i.status !== 'cancelled' && i.status !== 'backlog';
      });

      recap.push({
        project: project.name,
        prefix: project.prefix,
        period: `${days} days`,
        completed: recentlyDone.map((i) => ({ display_id: i.display_id, title: i.title })),
        completed_count: recentlyDone.length,
        in_progress: inProgress.map((i) => ({ display_id: i.display_id, title: i.title, priority: i.priority })),
        in_review: inReview.map((i) => ({ display_id: i.display_id, title: i.title })),
        newly_created: recentlyCreated.length,
        urgent_open: blocked.map((i) => ({ display_id: i.display_id, title: i.title, status: i.status })),
        stale_issues: stale.map((i) => ({ display_id: i.display_id, title: i.title, status: i.status, updated_at: i.updated_at })),
        total_issues: issues.length,
        done_total: issues.filter((i) => i.status === 'done').length,
        velocity: recentlyDone.length,
      });
    }

    return {
      skill: 'weekly_recap',
      success: true,
      data: recap,
      summary: `Recap for ${targetProjects.length} project(s) over ${days} days`,
    };
  } catch (err) {
    return { skill: 'weekly_recap', success: false, error: String(err), summary: 'Recap failed' };
  }
}

// ─── Priority Suggestions ─────────────────────

async function executeSuggestPriorities(
  args: Record<string, unknown>,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string | undefined;
    const targetProjects = projectId ? projects.filter((p) => p.id === projectId) : projects;

    const suggestions: Record<string, unknown>[] = [];

    for (const project of targetProjects) {
      const issues = allIssues[project.id] || [];
      const open = issues.filter((i) => i.status !== 'done' && i.status !== 'cancelled');

      // Urgent issues not making progress
      const urgentStuck = open.filter((i) => {
        const daysSinceUpdate = (Date.now() - new Date(i.updated_at).getTime()) / (24 * 60 * 60 * 1000);
        return i.priority === 'urgent' && daysSinceUpdate > 2;
      });

      // High priority in backlog (should be moved to todo)
      const highInBacklog = open.filter((i) => i.priority === 'high' && i.status === 'backlog');

      // Stale issues (no update in 14+ days, not in backlog)
      const stale = open.filter((i) => {
        const daysSinceUpdate = (Date.now() - new Date(i.updated_at).getTime()) / (24 * 60 * 60 * 1000);
        return daysSinceUpdate > 14 && i.status !== 'backlog';
      });

      // Priority distribution analysis
      const priorityCounts: Record<string, number> = {};
      for (const i of open) {
        const p = i.priority || 'none';
        priorityCounts[p] = (priorityCounts[p] || 0) + 1;
      }

      suggestions.push({
        project: project.name,
        prefix: project.prefix,
        urgent_stuck: urgentStuck.map((i) => ({ id: i.id, display_id: i.display_id, title: i.title, days_since_update: Math.floor((Date.now() - new Date(i.updated_at).getTime()) / 86400000) })),
        high_in_backlog: highInBacklog.map((i) => ({ id: i.id, display_id: i.display_id, title: i.title })),
        stale: stale.map((i) => ({ id: i.id, display_id: i.display_id, title: i.title, status: i.status, days_since_update: Math.floor((Date.now() - new Date(i.updated_at).getTime()) / 86400000) })),
        priority_distribution: priorityCounts,
        total_open: open.length,
      });
    }

    return {
      skill: 'suggest_priorities',
      success: true,
      data: suggestions,
      summary: `Priority analysis for ${targetProjects.length} project(s)`,
    };
  } catch (err) {
    return { skill: 'suggest_priorities', success: false, error: String(err), summary: 'Priority analysis failed' };
  }
}

// ─── Milestone Planning ───────────────────────

/**
 * Extract meaningful tokens from text for similarity comparison.
 * Strips common stop words and returns lowercased tokens.
 */
function extractTokens(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'and',
    'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'we', 'you',
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou',
    'en', 'dans', 'pour', 'sur', 'avec', 'par', 'est', 'sont', 'être',
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9àâäéèêëïîôùûüÿç_-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopWords.has(t)),
  );
}

/**
 * Jaccard similarity between two token sets (0..1).
 */
function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface DetectedDependency {
  from_id: string;
  from_display_id: string;
  to_id: string;
  to_display_id: string;
  reason: string;
  confidence: number;
}

/**
 * Detect potential dependencies between issues by analyzing:
 * 1. Title/description text similarity (shared domain tokens)
 * 2. Explicit references (one issue mentions another's display_id)
 * 3. Category overlap with priority ordering (higher-priority likely blocks lower)
 * 4. Type-based inference (e.g. "bug" in area X likely depends on "feature" in area X)
 */
function detectDependencies(issues: Issue[]): DetectedDependency[] {
  const deps: DetectedDependency[] = [];
  const priorityRank: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

  // Pre-compute tokens for each issue
  const issueTokens = issues.map((i) =>
    extractTokens(`${i.title} ${i.description || ''}`),
  );

  for (let i = 0; i < issues.length; i++) {
    const issueA = issues[i];
    const textA = `${issueA.title} ${issueA.description || ''}`.toLowerCase();

    for (let j = i + 1; j < issues.length; j++) {
      const issueB = issues[j];
      const textB = `${issueB.title} ${issueB.description || ''}`.toLowerCase();

      // 1. Explicit reference: one issue mentions the other's display_id
      if (textA.includes(issueB.display_id.toLowerCase())) {
        deps.push({
          from_id: issueA.id, from_display_id: issueA.display_id,
          to_id: issueB.id, to_display_id: issueB.display_id,
          reason: `${issueA.display_id} explicitly references ${issueB.display_id}`,
          confidence: 0.95,
        });
        continue;
      }
      if (textB.includes(issueA.display_id.toLowerCase())) {
        deps.push({
          from_id: issueB.id, from_display_id: issueB.display_id,
          to_id: issueA.id, to_display_id: issueA.display_id,
          reason: `${issueB.display_id} explicitly references ${issueA.display_id}`,
          confidence: 0.95,
        });
        continue;
      }

      // 2. Text similarity — high overlap suggests related work
      const sim = tokenSimilarity(issueTokens[i], issueTokens[j]);
      if (sim < 0.25) continue; // Not similar enough

      // 3. Same category + similar text → likely dependency chain
      const sharedCats = (issueA.category || []).filter((c) =>
        (issueB.category || []).includes(c),
      );

      if (sharedCats.length > 0 && sim >= 0.25) {
        const rankA = priorityRank[issueA.priority || 'medium'] || 2;
        const rankB = priorityRank[issueB.priority || 'medium'] || 2;

        // Higher priority / foundational type (feature/improvement) likely comes first
        const typeOrder: Record<string, number> = { feature: 1, improvement: 2, bug: 3, question: 4 };
        const typeA = typeOrder[issueA.type || 'feature'] || 2;
        const typeB = typeOrder[issueB.type || 'feature'] || 2;

        let from: Issue, to: Issue;
        if (rankA > rankB || (rankA === rankB && typeA <= typeB)) {
          from = issueA; to = issueB;
        } else {
          from = issueB; to = issueA;
        }

        deps.push({
          from_id: from.id, from_display_id: from.display_id,
          to_id: to.id, to_display_id: to.display_id,
          reason: `Related work in {${sharedCats.join(',')}} (similarity: ${Math.round(sim * 100)}%)`,
          confidence: Math.min(0.9, sim + 0.2),
        });
      } else if (sim >= 0.4) {
        // High text similarity even without shared category
        const rankA = priorityRank[issueA.priority || 'medium'] || 2;
        const rankB = priorityRank[issueB.priority || 'medium'] || 2;
        const [from, to] = rankA >= rankB ? [issueA, issueB] : [issueB, issueA];

        deps.push({
          from_id: from.id, from_display_id: from.display_id,
          to_id: to.id, to_display_id: to.display_id,
          reason: `High text similarity (${Math.round(sim * 100)}%) — likely related`,
          confidence: Math.min(0.8, sim),
        });
      }
    }
  }

  // Sort by confidence descending, keep top results to avoid noise
  return deps
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(20, Math.floor(issues.length * 1.5)));
}

/**
 * Compute velocity stats from historical issue data.
 * Returns issues completed per week (rolling averages).
 */
function computeVelocity(allIssues: Issue[]): {
  issues_per_week_4w: number;
  issues_per_week_8w: number;
  avg_days_to_close: number | null;
  recent_completed: number;
  data_points: number;
} {
  const now = Date.now();
  const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000;
  const eightWeeksAgo = now - 56 * 24 * 60 * 60 * 1000;

  const doneIssues = allIssues.filter((i) => i.status === 'done');

  const done4w = doneIssues.filter((i) => new Date(i.updated_at).getTime() > fourWeeksAgo);
  const done8w = doneIssues.filter((i) => new Date(i.updated_at).getTime() > eightWeeksAgo);

  // Average days from created_at → updated_at (proxy for time-to-close)
  const closeTimes = doneIssues
    .map((i) => (new Date(i.updated_at).getTime() - new Date(i.created_at).getTime()) / (24 * 60 * 60 * 1000))
    .filter((d) => d > 0 && d < 365); // sanity filter

  const avgDaysToClose = closeTimes.length > 0
    ? Math.round((closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length) * 10) / 10
    : null;

  return {
    issues_per_week_4w: done4w.length > 0 ? Math.round((done4w.length / 4) * 10) / 10 : 0,
    issues_per_week_8w: done8w.length > 0 ? Math.round((done8w.length / 8) * 10) / 10 : 0,
    avg_days_to_close: avgDaysToClose,
    recent_completed: done4w.length,
    data_points: doneIssues.length,
  };
}

async function executePlanMilestones(
  args: Record<string, unknown>,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string;
    if (!projectId) return { skill: 'plan_milestones', success: false, error: 'Missing project_id', summary: 'No project specified' };

    const project = projects.find((p) => p.id === projectId || p.prefix === projectId || p.name === projectId);
    const targetProjectId = project?.id || projectId;
    const issues = allIssues[targetProjectId] || [];

    // Filter out done and cancelled issues
    const openIssues = issues.filter((i) => i.status !== 'done' && i.status !== 'cancelled');

    if (openIssues.length === 0) {
      return {
        skill: 'plan_milestones',
        success: true,
        data: { project: project?.name || projectId, open_issues: [], dependencies: [], velocity: null, message: 'No open issues to plan milestones for.' },
        summary: `No open issues in ${project?.name || projectId}`,
      };
    }

    const targetDate = args.target_date as string | undefined;
    const teamSize = (args.team_size as number) || 1;

    // Detect potential dependencies between open issues
    const dependencies = detectDependencies(openIssues);

    // Compute velocity from all project issues (including done)
    const velocity = computeVelocity(issues);

    // Estimate weeks to complete based on velocity and team size
    const effectiveVelocity = velocity.issues_per_week_4w > 0
      ? velocity.issues_per_week_4w * teamSize
      : velocity.issues_per_week_8w > 0
        ? velocity.issues_per_week_8w * teamSize
        : null;

    const estimatedWeeks = effectiveVelocity
      ? Math.round((openIssues.length / effectiveVelocity) * 10) / 10
      : null;

    // ── Smart auto-grouping for dev teams (Baaton-specific) ──
    // Strategy: dev-first grouping optimized for software projects
    //  1. "Ship It" — issues in_review (nearly complete, ship first)
    //  2. "Critical Hotfixes" — urgent bugs and blockers
    //  3. By technical domain — FRONT/BACK/API/DB/INFRA categories
    //  4. By feature tag — grouped by first tag (e.g., "Auth", "ElevenLabs")
    //  5. "Tech Debt & Backlog" — low priority, improvements, questions

    // Dev-friendly milestone name mapping for categories
    const CATEGORY_NAMES: Record<string, string> = {
      FRONT: 'Frontend',
      BACK: 'Backend',
      API: 'API & Integrations',
      DB: 'Database & Migrations',
      INFRA: 'Infrastructure & DevOps',
      UX: 'UX & Design',
      DEVOPS: 'Infrastructure & DevOps',
    };
    
    const shipIt: typeof openIssues = [];
    const critical: typeof openIssues = [];
    const byDomain: Record<string, typeof openIssues> = {};
    const byTag: Record<string, typeof openIssues> = {};
    const backlog: typeof openIssues = [];

    for (const issue of openIssues) {
      // Tier 1: Ship it — almost done (in_review, in_progress with high priority)
      if (issue.status === 'in_review' || (issue.status === 'in_progress' && issue.priority === 'high')) {
        shipIt.push(issue);
      }
      // Tier 2: Critical hotfixes — urgent priority or high-priority bugs
      else if (issue.priority === 'urgent' || (issue.priority === 'high' && issue.type === 'bug')) {
        critical.push(issue);
      }
      // Tier 5: Low priority backlog
      else if (issue.priority === 'low' || issue.type === 'question') {
        backlog.push(issue);
      }
      // Tier 3: Group by technical domain (category)
      else if (issue.category && issue.category.length > 0) {
        const cat = issue.category[0];
        const domainName = CATEGORY_NAMES[cat.toUpperCase()] || cat;
        if (!byDomain[domainName]) byDomain[domainName] = [];
        byDomain[domainName].push(issue);
      }
      // Tier 4: Group by tag (feature context)
      else if (issue.tags.length > 0) {
        const tag = issue.tags[0];
        if (!byTag[tag]) byTag[tag] = [];
        byTag[tag].push(issue);
      }
      // Fallback: type-based
      else {
        const typeGroup = issue.type === 'bug' ? 'Bug Fixes' : issue.type === 'feature' ? 'New Features' : 'Improvements';
        if (!byTag[typeGroup]) byTag[typeGroup] = [];
        byTag[typeGroup].push(issue);
      }
    }

    // Merge domain + tag groups, collapse small ones
    const allGroups = { ...byDomain, ...byTag };
    const MIN_GROUP_SIZE = 2;
    const validTagGroups: Record<string, typeof openIssues> = {};
    for (const [key, items] of Object.entries(allGroups)) {
      if (items.length < MIN_GROUP_SIZE) {
        // Put in critical if high priority, otherwise backlog
        for (const item of items) {
          if (item.priority === 'high') critical.push(item);
          else backlog.push(item);
        }
      } else {
        validTagGroups[key] = items;
      }
    }

    // Build ordered milestone list (dev-optimized naming)
    const milestoneEntries: Array<[string, typeof openIssues]> = [];
    if (shipIt.length > 0) milestoneEntries.push(['Ship It — Ready to Merge', shipIt]);
    if (critical.length > 0) milestoneEntries.push(['Critical Hotfixes', critical]);
    for (const [tag, items] of Object.entries(validTagGroups)) {
      milestoneEntries.push([tag, items]);
    }
    if (backlog.length > 0) milestoneEntries.push(['Tech Debt & Backlog', backlog]);

    // If no entries (shouldn't happen), fallback
    if (milestoneEntries.length === 0) {
      milestoneEntries.push(['All Issues', openIssues]);
    }

    // Estimate realistic weeks: ~3-5 issues per week for a solo dev (not raw velocity which includes batch imports)
    const realisticVelocity = Math.min(effectiveVelocity || 5, 8) * teamSize; // Cap at 8/week/person
    const now = new Date();

    let cumulativeWeeks = 0;
    const proposedMilestones = milestoneEntries.map(([name, issues], idx) => {
      // Ship It / already in progress should be 1 week
      const weeks = name.includes('Ship It')
        ? 1
        : Math.max(1, Math.ceil(issues.length / realisticVelocity));
      cumulativeWeeks += weeks;
      const target = new Date(now);
      target.setDate(target.getDate() + cumulativeWeeks * 7);
      const targetStr = target.toISOString().split('T')[0];

      // Sort: urgent/high first, then bugs, then features
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      issues.sort((a, b) => {
        const pa = priorityOrder[a.priority || 'medium'] ?? 2;
        const pb = priorityOrder[b.priority || 'medium'] ?? 2;
        if (pa !== pb) return pa - pb;
        if (a.type === 'bug' && b.type !== 'bug') return -1;
        if (b.type === 'bug' && a.type !== 'bug') return 1;
        return 0;
      });

      return {
        name,
        description: `${issues.length} issues — ${issues.filter(i => i.type === 'bug').length} bugs, ${issues.filter(i => i.type === 'feature').length} features, ${issues.filter(i => i.type === 'improvement').length} improvements`,
        target_date: targetStr,
        order: idx,
        estimated_weeks: weeks,
        issue_ids: issues.map(i => i.id),
        issues_summary: issues.map(i => ({
          id: i.id,
          display_id: i.display_id,
          title: i.title,
          type: i.type,
          priority: i.priority,
          tags: i.tags,
        })),
      };
    });

    return {
      skill: 'plan_milestones',
      success: true,
      data: {
        project: project?.name || projectId,
        project_id: targetProjectId,
        target_date: targetDate || null,
        team_size: teamSize,
        total_open: openIssues.length,
        proposed_milestones: proposedMilestones,
        dependencies: dependencies.map((d) => ({
          from: d.from_display_id,
          to: d.to_display_id,
          reason: d.reason,
          confidence: d.confidence,
        })),
        velocity: {
          raw_velocity: effectiveVelocity,
          realistic_velocity: realisticVelocity,
          estimated_weeks_total: cumulativeWeeks,
          team_size: teamSize,
        },
        instructions: 'IMPORTANT: Present this plan to the user. Show each milestone with its issues (display_id + title + type + priority). Show velocity and total estimated weeks. Ask if they want to apply. When they confirm, call create_milestones_batch with project_id and the milestones array (name, description, target_date, order, issue_ids).',
      },
      summary: `Analyzed ${openIssues.length} issues → proposed ${proposedMilestones.length} milestones over ~${cumulativeWeeks} weeks (${realisticVelocity} issues/week realistic)`,
    };
  } catch (err) {
    return { skill: 'plan_milestones', success: false, error: String(err), summary: 'Failed to fetch issues for planning' };
  }
}

async function executeCreateMilestonesBatch(
  args: Record<string, unknown>,
  api: ApiClient,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string;
    if (!projectId) return { skill: 'create_milestones_batch', success: false, error: 'Missing project_id', summary: 'No project specified' };

    const project = projects.find((p) => p.id === projectId || p.prefix === projectId || p.name === projectId);
    const targetProjectId = project?.id || projectId;

    const milestones = args.milestones as Array<{
      name: string;
      description?: string;
      target_date?: string;
      order?: number;
      issue_ids: string[];
    }>;

    if (!milestones?.length) {
      return { skill: 'create_milestones_batch', success: false, error: 'No milestones provided', summary: 'Empty milestones list' };
    }

    const results: string[] = [];
    let milestonesCreated = 0;
    let issuesAssigned = 0;

    for (const ms of milestones) {
      try {
        // Create the milestone
        const created = await api.milestones.create(targetProjectId, {
          name: ms.name,
          description: ms.description,
          target_date: ms.target_date,
        });
        milestonesCreated++;

        // Assign issues to this milestone
        let assignedCount = 0;
        for (const issueId of ms.issue_ids) {
          try {
            await api.issues.update(issueId, { milestone_id: created.id } as Record<string, unknown>);
            assignedCount++;
            issuesAssigned++;
          } catch {
            results.push(`  ❌ Failed to assign issue ${issueId} to ${ms.name}`);
          }
        }

        results.push(`✅ **${ms.name}** — ${assignedCount} issue${assignedCount !== 1 ? 's' : ''} assigned${ms.target_date ? ` (target: ${ms.target_date})` : ''}`);
      } catch (err) {
        results.push(`❌ Failed to create milestone "${ms.name}": ${String(err)}`);
      }
    }

    return {
      skill: 'create_milestones_batch',
      success: true,
      data: {
        milestones_created: milestonesCreated,
        issues_assigned: issuesAssigned,
        details: results,
      },
      summary: `Created ${milestonesCreated} milestone${milestonesCreated !== 1 ? 's' : ''}, assigned ${issuesAssigned} issue${issuesAssigned !== 1 ? 's' : ''}`,
    };
  } catch (err) {
    return { skill: 'create_milestones_batch', success: false, error: String(err), summary: 'Batch milestone creation failed' };
  }
}

async function executeAdjustTimeline(
  args: Record<string, unknown>,
  api: ApiClient,
  allIssues: Record<string, Issue[]>,
  projects: Project[],
): Promise<SkillResult> {
  try {
    const projectId = args.project_id as string;
    const constraint = args.constraint as string;
    if (!projectId) return { skill: 'adjust_timeline', success: false, error: 'Missing project_id', summary: 'No project specified' };
    if (!constraint) return { skill: 'adjust_timeline', success: false, error: 'Missing constraint', summary: 'No constraint specified' };

    const project = projects.find((p) => p.id === projectId || p.prefix === projectId || p.name === projectId);
    const targetProjectId = project?.id || projectId;

    // Fetch existing milestones
    const milestones = await api.milestones.listByProject(targetProjectId);

    // Fetch open issues
    const issues = allIssues[targetProjectId] || [];
    const openIssues = issues.filter((i) => i.status !== 'done' && i.status !== 'cancelled');

    // Detect dependencies and compute velocity for informed replanning
    const dependencies = detectDependencies(openIssues);
    const velocity = computeVelocity(issues);

    return {
      skill: 'adjust_timeline',
      success: true,
      data: {
        project: project?.name || projectId,
        project_id: targetProjectId,
        constraint,
        milestones: milestones.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          target_date: m.target_date,
          status: m.status,
        })),
        open_issues: openIssues.map((i) => ({
          id: i.id,
          display_id: i.display_id,
          title: i.title,
          status: i.status,
          priority: i.priority,
          type: i.type,
          milestone_id: i.milestone_id,
        })),
        dependencies: dependencies.map((d) => ({
          from: d.from_display_id,
          to: d.to_display_id,
          reason: d.reason,
          confidence: d.confidence,
        })),
        velocity,
        total_milestones: milestones.length,
        total_open_issues: openIssues.length,
      },
      summary: `Fetched ${milestones.length} milestones, ${openIssues.length} open issues, and ${dependencies.length} dependencies for timeline adjustment`,
    };
  } catch (err) {
    return { skill: 'adjust_timeline', success: false, error: String(err), summary: 'Failed to fetch data for timeline adjustment' };
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
  let result: SkillResult;

  switch (skillName) {
    case 'search_issues':
      result = await executeSearchIssues(args, api, allIssues, projects);
      break;
    case 'create_issue':
      result = await executeCreateIssue(args, api, projects);
      break;
    case 'update_issue':
      result = await executeUpdateIssue(args, api);
      break;
    case 'bulk_update_issues':
      result = await executeBulkUpdateIssues(args, api);
      break;
    case 'add_comment':
      result = await executeAddComment(args, api);
      break;
    case 'get_project_metrics':
      result = await executeGetMetrics(args, allIssues, projects);
      break;
    case 'analyze_sprint':
      result = await executeGetMetrics(args, allIssues, projects);
      break;
    case 'weekly_recap':
      result = await executeWeeklyRecap(args, allIssues, projects);
      break;
    case 'suggest_priorities':
      result = await executeSuggestPriorities(args, allIssues, projects);
      break;
    case 'generate_prd':
      result = {
        skill: 'generate_prd',
        success: true,
        data: { brief: args.brief, project_id: args.project_id },
        summary: 'PRD context ready — generating document',
      };
      break;
    case 'plan_milestones':
      result = await executePlanMilestones(args, allIssues, projects);
      break;
    case 'create_milestones_batch':
      result = await executeCreateMilestonesBatch(args, api, projects);
      break;
    case 'adjust_timeline':
      result = await executeAdjustTimeline(args, api, allIssues, projects);
      break;
    default:
      result = { skill: skillName, success: false, error: `Unknown skill: ${skillName}`, summary: `Unknown skill: ${skillName}` };
  }

  // Validate all results before returning to Gemini (Manus pattern)
  return validateSkillResult(result);
}
