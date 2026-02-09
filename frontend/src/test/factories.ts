/**
 * Mock data factories for Baaton tests.
 * Use these to generate consistent test data across all test suites.
 */

import type { Issue, Project, IssuePriority, IssueStatus, IssueType } from '@/lib/types';

let issueCounter = 0;
let projectCounter = 0;

export function resetCounters() {
  issueCounter = 0;
  projectCounter = 0;
}

export function createProject(overrides: Partial<Project> = {}): Project {
  projectCounter++;
  return {
    id: `proj-${projectCounter}`,
    org_id: 'org-1',
    name: `Project ${projectCounter}`,
    slug: `project-${projectCounter}`,
    description: null,
    prefix: `PRJ${projectCounter}`,
    statuses: [
      { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: false },
      { key: 'todo', label: 'Todo', color: '#3b82f6', hidden: false },
      { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
      { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
      { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
      { key: 'cancelled', label: 'Cancelled', color: '#ef4444', hidden: false },
    ],
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

export function createIssue(overrides: Partial<Issue> = {}): Issue {
  issueCounter++;
  return {
    id: `issue-${issueCounter}`,
    project_id: 'proj-1',
    milestone_id: null,
    sprint_id: null,
    parent_id: null,
    display_id: `PRJ-${issueCounter}`,
    title: `Test Issue ${issueCounter}`,
    description: `Description for issue ${issueCounter}`,
    type: 'feature' as IssueType,
    status: 'todo' as IssueStatus,
    priority: 'medium' as IssuePriority,
    source: 'web',
    reporter_name: null,
    reporter_email: null,
    assignee_ids: [],
    tags: [],
    category: [],
    attachments: [],
    position: issueCounter * 1000,
    created_by_id: null,
    created_by_name: null,
    due_date: null,
    qualified_at: null,
    qualified_by: null,
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

export function createMockApi() {
  return {
    issues: {
      listByProject: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((body: Record<string, unknown>) =>
        Promise.resolve(createIssue({
          title: body.title as string,
          project_id: body.project_id as string,
          display_id: 'NEW-1',
        })),
      ),
      update: vi.fn().mockImplementation((id: string, body: Record<string, unknown>) =>
        Promise.resolve(createIssue({ id, display_id: 'UPD-1', ...body as any })),
      ),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    comments: {
      create: vi.fn().mockResolvedValue({ id: 'comment-1' }),
    },
    projects: {
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

/**
 * Create a batch of issues with different statuses for metric/recap tests
 */
export function createIssueSet(projectId: string, prefix: string): Issue[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return [
    createIssue({ project_id: projectId, display_id: `${prefix}-1`, title: 'Done recently', status: 'done', priority: 'high', updated_at: new Date(now - 2 * day).toISOString(), created_at: new Date(now - 10 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-2`, title: 'Done old', status: 'done', priority: 'medium', updated_at: new Date(now - 15 * day).toISOString(), created_at: new Date(now - 30 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-3`, title: 'In progress task', status: 'in_progress', priority: 'high', updated_at: new Date(now - 1 * day).toISOString(), created_at: new Date(now - 5 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-4`, title: 'Todo task', status: 'todo', priority: 'medium', updated_at: new Date(now - 3 * day).toISOString(), created_at: new Date(now - 5 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-5`, title: 'Urgent stuck', status: 'in_progress', priority: 'urgent', updated_at: new Date(now - 5 * day).toISOString(), created_at: new Date(now - 10 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-6`, title: 'Backlog item', status: 'backlog', priority: 'low', updated_at: new Date(now - 20 * day).toISOString(), created_at: new Date(now - 30 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-7`, title: 'In review', status: 'in_review', priority: 'high', updated_at: new Date(now - 1 * day).toISOString(), created_at: new Date(now - 4 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-8`, title: 'Stale issue', status: 'todo', priority: 'medium', updated_at: new Date(now - 20 * day).toISOString(), created_at: new Date(now - 30 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-9`, title: 'Cancelled task', status: 'cancelled', priority: 'low', updated_at: new Date(now - 10 * day).toISOString(), created_at: new Date(now - 20 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-10`, title: 'New issue', status: 'todo', priority: 'high', category: ['FRONT'], tags: ['ui'], updated_at: new Date(now - 1 * day).toISOString(), created_at: new Date(now - 2 * day).toISOString() }),
    createIssue({ project_id: projectId, display_id: `${prefix}-11`, title: 'High backlog', status: 'backlog', priority: 'high', updated_at: new Date(now - 5 * day).toISOString(), created_at: new Date(now - 10 * day).toISOString() }),
  ];
}
