/**
 * Tests for ai-executor.ts — all 10 skill executors.
 * Target: 100% coverage on ai-executor.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executeSkill } from '@/lib/ai-executor';
import { createProject, createIssue, createMockApi, createIssueSet, resetCounters } from '@/test/factories';
import type { Issue, Project } from '@/lib/types';

let api: ReturnType<typeof createMockApi>;
let projects: Project[];
let allIssues: Record<string, Issue[]>;

beforeEach(() => {
  resetCounters();
  api = createMockApi();
  projects = [
    createProject({ id: 'p1', name: 'Alpha', prefix: 'ALP' }),
    createProject({ id: 'p2', name: 'Beta', prefix: 'BET' }),
  ];
  allIssues = {
    p1: createIssueSet('p1', 'ALP'),
    p2: [
      createIssue({ project_id: 'p2', display_id: 'BET-1', title: 'Beta task', status: 'todo', priority: 'high' }),
    ],
  };
});

// ─── search_issues ────────────────────────────────

describe('search_issues', () => {
  it('returns all issues when no filters', async () => {
    const result = await executeSkill('search_issues', {}, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect(result.skill).toBe('search_issues');
    expect((result.data as any[]).length).toBe(12); // 11 from p1 + 1 from p2
  });

  it('filters by status', async () => {
    const result = await executeSkill('search_issues', { status: 'done' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.every((i: any) => i.status === 'done')).toBe(true);
    expect(data.length).toBe(2); // 2 done in p1
  });

  it('filters by priority', async () => {
    const result = await executeSkill('search_issues', { priority: 'urgent' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.every((i: any) => i.priority === 'urgent')).toBe(true);
    expect(data.length).toBe(1);
  });

  it('filters by query text', async () => {
    const result = await executeSkill('search_issues', { query: 'stuck' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].title).toContain('stuck');
  });

  it('filters by project_id', async () => {
    const result = await executeSkill('search_issues', { project_id: 'p2' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].project_name).toBe('Beta');
  });

  it('filters by category', async () => {
    const result = await executeSkill('search_issues', { category: 'FRONT' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].category).toContain('FRONT');
  });

  it('respects limit', async () => {
    const result = await executeSkill('search_issues', { limit: 3 }, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect((result.data as any[]).length).toBe(3);
  });

  it('combines multiple filters', async () => {
    const result = await executeSkill(
      'search_issues',
      { status: 'todo', priority: 'high' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.every((i: any) => i.status === 'todo' && i.priority === 'high')).toBe(true);
  });

  it('searches by display_id', async () => {
    const result = await executeSkill('search_issues', { query: 'ALP-5' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect((result.data as any[]).length).toBe(1);
  });

  it('returns empty for unmatched query', async () => {
    const result = await executeSkill('search_issues', { query: 'nonexistent_xyz' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect((result.data as any[]).length).toBe(0);
    expect(result.summary).toContain('0');
  });

  it('maps project_name correctly', async () => {
    const result = await executeSkill('search_issues', { project_id: 'p1', limit: 1 }, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect((result.data as any[])[0].project_name).toBe('Alpha');
  });

  it('handles project with no issues', async () => {
    const result = await executeSkill('search_issues', { project_id: 'nonexistent' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    // Falls through to all projects since the projectId doesn't match allIssues
    expect((result.data as any[]).length).toBe(12);
  });
});

// ─── create_issue ─────────────────────────────────

describe('create_issue', () => {
  it('creates an issue successfully', async () => {
    const result = await executeSkill(
      'create_issue',
      { project_id: 'p1', title: 'New feature', description: 'Details', priority: 'high' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(result.skill).toBe('create_issue');
    expect(result.summary).toContain('Created');
    expect(api.issues.create).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1',
      title: 'New feature',
      priority: 'high',
    }));
  });

  it('fails when project_id is missing', async () => {
    const result = await executeSkill('create_issue', { title: 'No project' }, api, allIssues, projects);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing project_id');
  });

  it('resolves project by prefix', async () => {
    const result = await executeSkill(
      'create_issue',
      { project_id: 'ALP', title: 'By prefix' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(api.issues.create).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1', // resolved from prefix
    }));
  });

  it('resolves project by name', async () => {
    const result = await executeSkill(
      'create_issue',
      { project_id: 'Alpha', title: 'By name' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(api.issues.create).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1',
    }));
  });

  it('applies defaults for optional fields', async () => {
    await executeSkill(
      'create_issue',
      { project_id: 'p1', title: 'Minimal' },
      api, allIssues, projects,
    );
    expect(api.issues.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feature',
      priority: 'medium',
      status: 'todo',
      tags: [],
      category: [],
    }));
  });

  it('handles API error gracefully', async () => {
    api.issues.create.mockRejectedValue(new Error('Network error'));
    const result = await executeSkill(
      'create_issue',
      { project_id: 'p1', title: 'Will fail' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Failed to create');
  });
});

// ─── update_issue ─────────────────────────────────

describe('update_issue', () => {
  it('updates an issue successfully', async () => {
    const result = await executeSkill(
      'update_issue',
      { issue_id: 'issue-1', status: 'done', priority: 'high' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(result.skill).toBe('update_issue');
    expect(result.summary).toContain('Updated');
    expect(result.summary).toContain('status, priority');
    expect(api.issues.update).toHaveBeenCalledWith('issue-1', { status: 'done', priority: 'high' });
  });

  it('fails when issue_id is missing', async () => {
    const result = await executeSkill('update_issue', { status: 'done' }, api, allIssues, projects);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing issue_id');
  });

  it('handles partial updates', async () => {
    await executeSkill('update_issue', { issue_id: 'issue-1', title: 'New title' }, api, allIssues, projects);
    expect(api.issues.update).toHaveBeenCalledWith('issue-1', { title: 'New title' });
  });

  it('handles API error gracefully', async () => {
    api.issues.update.mockRejectedValue(new Error('Not found'));
    const result = await executeSkill(
      'update_issue',
      { issue_id: 'bad-id', status: 'done' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Failed to update');
  });

  it('updates tags and category', async () => {
    await executeSkill(
      'update_issue',
      { issue_id: 'issue-1', tags: ['bug', 'urgent'], category: ['FRONT'] },
      api, allIssues, projects,
    );
    expect(api.issues.update).toHaveBeenCalledWith('issue-1', {
      tags: ['bug', 'urgent'],
      category: ['FRONT'],
    });
  });
});

// ─── bulk_update_issues ───────────────────────────

describe('bulk_update_issues', () => {
  it('updates multiple issues', async () => {
    const result = await executeSkill(
      'bulk_update_issues',
      {
        updates: [
          { issue_id: 'issue-1', status: 'done' },
          { issue_id: 'issue-2', status: 'done' },
        ],
      },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(result.skill).toBe('bulk_update_issues');
    expect((result.data as any).updated).toBe(2);
    expect((result.data as any).total).toBe(2);
    expect(result.summary).toContain('2/2');
  });

  it('handles partial success', async () => {
    api.issues.update
      .mockResolvedValueOnce(createIssue({ display_id: 'OK-1' }))
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce(createIssue({ display_id: 'OK-3' }));

    const result = await executeSkill(
      'bulk_update_issues',
      {
        updates: [
          { issue_id: 'i1', status: 'done' },
          { issue_id: 'i2', status: 'done' },
          { issue_id: 'i3', status: 'done' },
        ],
      },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).updated).toBe(2);
    expect((result.data as any).total).toBe(3);
    expect((result.data as any).details).toContain('❌ i2');
    expect(result.summary).toContain('2/3');
  });

  it('fails with empty updates', async () => {
    const result = await executeSkill(
      'bulk_update_issues',
      { updates: [] },
      api, allIssues, projects,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('No updates');
  });

  it('fails with no updates arg', async () => {
    const result = await executeSkill('bulk_update_issues', {}, api, allIssues, projects);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No updates');
  });
});

// ─── add_comment ──────────────────────────────────

describe('add_comment', () => {
  it('adds a comment successfully', async () => {
    const result = await executeSkill(
      'add_comment',
      { issue_id: 'issue-1', content: 'Great progress!', author_name: 'TestUser' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(result.skill).toBe('add_comment');
    expect(api.comments.create).toHaveBeenCalledWith('issue-1', {
      content: 'Great progress!',
      author_name: 'TestUser',
    });
  });

  it('uses default author name', async () => {
    await executeSkill(
      'add_comment',
      { issue_id: 'issue-1', content: 'Hello' },
      api, allIssues, projects,
    );
    expect(api.comments.create).toHaveBeenCalledWith('issue-1', {
      content: 'Hello',
      author_name: 'Baaton AI',
    });
  });

  it('fails when issue_id is missing', async () => {
    const result = await executeSkill(
      'add_comment',
      { content: 'No issue' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing issue_id');
  });

  it('handles API error', async () => {
    api.comments.create.mockRejectedValue(new Error('Forbidden'));
    const result = await executeSkill(
      'add_comment',
      { issue_id: 'issue-1', content: 'test' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Failed to add comment');
  });
});

// ─── get_project_metrics ──────────────────────────

describe('get_project_metrics', () => {
  it('returns metrics for all projects', async () => {
    const result = await executeSkill('get_project_metrics', {}, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect(result.skill).toBe('get_project_metrics');
    const data = result.data as any[];
    expect(data.length).toBe(2);
    expect(result.summary).toContain('2 projects');
  });

  it('returns metrics for a specific project', async () => {
    const result = await executeSkill('get_project_metrics', { project_id: 'p1' }, api, allIssues, projects);
    expect(result.success).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].project).toBe('Alpha');
    expect(result.summary).toContain('1 project');
  });

  it('calculates completion rate correctly', async () => {
    const result = await executeSkill('get_project_metrics', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // p1 has 11 issues, 2 done → ~18%
    expect(data.completion_rate).toBe('18%');
    expect(data.total_issues).toBe(11);
  });

  it('counts statuses correctly', async () => {
    const result = await executeSkill('get_project_metrics', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.status.done).toBe(2);
    expect(data.status.todo).toBe(3);
    expect(data.status.in_progress).toBe(2);
    expect(data.status.backlog).toBe(2);
    expect(data.status.in_review).toBe(1);
    expect(data.status.cancelled).toBe(1);
  });

  it('counts priorities correctly', async () => {
    const result = await executeSkill('get_project_metrics', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.priority.high).toBe(4);
    expect(data.priority.medium).toBe(3);
    expect(data.priority.urgent).toBe(1);
    expect(data.priority.low).toBe(3);
  });

  it('counts categories', async () => {
    const result = await executeSkill('get_project_metrics', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.category.FRONT).toBe(1);
  });

  it('handles project with 0 issues', async () => {
    const emptyProject = createProject({ id: 'p3', name: 'Empty' });
    const result = await executeSkill(
      'get_project_metrics',
      { project_id: 'p3' },
      api,
      { ...allIssues, p3: [] },
      [...projects, emptyProject],
    );
    const data = (result.data as any[])[0];
    expect(data.completion_rate).toBe('0%');
    expect(data.total_issues).toBe(0);
  });
});

// ─── analyze_sprint (uses same executor as get_project_metrics) ─

describe('analyze_sprint', () => {
  it('maps to get_project_metrics executor', async () => {
    const result = await executeSkill('analyze_sprint', {}, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect((result.data as any[]).length).toBe(2);
  });
});

// ─── weekly_recap ─────────────────────────────────

describe('weekly_recap', () => {
  it('returns recap for all projects', async () => {
    const result = await executeSkill('weekly_recap', {}, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect(result.skill).toBe('weekly_recap');
    const data = result.data as any[];
    expect(data.length).toBe(2);
  });

  it('filters by project_id', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = result.data as any[];
    expect(data.length).toBe(1);
    expect(data[0].project).toBe('Alpha');
  });

  it('calculates velocity (done in period)', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1', days: 7 }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // Only ALP-1 was done recently (2 days ago)
    expect(data.velocity).toBe(1);
    expect(data.completed_count).toBe(1);
  });

  it('detects stale issues', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // ALP-8 is stale (todo, updated 20 days ago)
    expect(data.stale_issues.length).toBeGreaterThan(0);
    expect(data.stale_issues.some((i: any) => i.display_id === 'ALP-8')).toBe(true);
  });

  it('counts in_progress issues', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.in_progress.length).toBe(2);
  });

  it('counts in_review issues', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.in_review.length).toBe(1);
  });

  it('uses custom days parameter', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1', days: 30 }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // With 30 days, ALP-2 (done 15 days ago) should also appear in completed
    expect(data.completed_count).toBe(2);
  });

  it('identifies urgent open issues', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.urgent_open.length).toBe(1);
    expect(data.urgent_open[0].display_id).toBe('ALP-5');
  });

  it('includes total and done counts', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.total_issues).toBe(11);
    expect(data.done_total).toBe(2);
  });

  it('uses default days=7', async () => {
    const result = await executeSkill('weekly_recap', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.period).toBe('7 days');
  });
});

// ─── suggest_priorities ───────────────────────────

describe('suggest_priorities', () => {
  it('returns suggestions for all projects', async () => {
    const result = await executeSkill('suggest_priorities', {}, api, allIssues, projects);
    expect(result.success).toBe(true);
    expect(result.skill).toBe('suggest_priorities');
    const data = result.data as any[];
    expect(data.length).toBe(2);
  });

  it('detects urgent stuck issues (urgent, no update >2 days)', async () => {
    const result = await executeSkill('suggest_priorities', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // ALP-5 is urgent, updated 5 days ago
    expect(data.urgent_stuck.length).toBe(1);
    expect(data.urgent_stuck[0].display_id).toBe('ALP-5');
    expect(data.urgent_stuck[0].days_since_update).toBeGreaterThanOrEqual(4);
  });

  it('detects high priority issues in backlog', async () => {
    const result = await executeSkill('suggest_priorities', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // ALP-11 is high priority in backlog
    expect(data.high_in_backlog.length).toBe(1);
    expect(data.high_in_backlog[0].display_id).toBe('ALP-11');
  });

  it('detects stale issues (>14 days, not in backlog)', async () => {
    const result = await executeSkill('suggest_priorities', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // ALP-8 is stale (todo, updated 20 days ago)
    expect(data.stale.length).toBe(1);
    expect(data.stale[0].display_id).toBe('ALP-8');
    expect(data.stale[0].days_since_update).toBeGreaterThanOrEqual(19);
  });

  it('provides priority distribution', async () => {
    const result = await executeSkill('suggest_priorities', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    expect(data.priority_distribution).toBeDefined();
    expect(data.priority_distribution.high).toBeGreaterThan(0);
    expect(data.total_open).toBeGreaterThan(0);
  });

  it('excludes done/cancelled from analysis', async () => {
    const result = await executeSkill('suggest_priorities', { project_id: 'p1' }, api, allIssues, projects);
    const data = (result.data as any[])[0];
    // 11 issues, 2 done + 1 cancelled = 8 open
    expect(data.total_open).toBe(8);
  });
});

// ─── generate_prd ─────────────────────────────────

describe('generate_prd', () => {
  it('returns success with context data', async () => {
    const result = await executeSkill(
      'generate_prd',
      { brief: 'Build a dashboard', project_id: 'p1' },
      api, allIssues, projects,
    );
    expect(result.success).toBe(true);
    expect(result.skill).toBe('generate_prd');
    expect((result.data as any).brief).toBe('Build a dashboard');
    expect((result.data as any).project_id).toBe('p1');
  });
});

// ─── Unknown skill ────────────────────────────────

describe('unknown skill', () => {
  it('returns error for unknown skill', async () => {
    const result = await executeSkill('nonexistent_skill', {}, api, allIssues, projects);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown skill');
    expect(result.summary).toContain('Unknown skill');
  });
});
