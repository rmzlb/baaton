// ─── Enums ────────────────────────────────────────────

export type IssueType = 'bug' | 'feature' | 'improvement' | 'question';
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low';
export type IssueSource = 'web' | 'api' | 'form' | 'email';
export type TestsStatus = 'passed' | 'failed' | 'skipped' | 'none';
export type MilestoneStatus = 'active' | 'completed' | 'cancelled';
export type SprintStatus = 'planning' | 'active' | 'completed';

// ─── Models ───────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface ProjectStatus {
  key: string;
  label: string;
  color: string;
  hidden: boolean;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  prefix: string;
  statuses: ProjectStatus[];
  created_at: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  status: MilestoneStatus;
  created_at: string;
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  status: SprintStatus;
  created_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  milestone_id: string | null;
  sprint_id: string | null;
  parent_id: string | null;
  display_id: string;
  title: string;
  description: string | null;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority | null;
  source: IssueSource;
  reporter_name: string | null;
  reporter_email: string | null;
  assignee_ids: string[];
  tags: string[];
  category: string[];
  attachments: Attachment[];
  position: number;
  qualified_at: string | null;
  qualified_by: string | null;
  created_at: string;
  updated_at: string;
  // Relations (optional, loaded on detail)
  tldrs?: TLDR[];
  comments?: Comment[];
  children?: Issue[];
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  mime_type: string;
}

export interface TLDR {
  id: string;
  issue_id: string;
  agent_name: string;
  summary: string;
  files_changed: string[];
  tests_status: TestsStatus;
  pr_url: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  issue_id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ─── API Request Types ────────────────────────────────

export interface CreateIssueRequest {
  project_id: string;
  title: string;
  description?: string;
  type?: IssueType;
  priority?: IssuePriority;
  milestone_id?: string;
  parent_id?: string;
  tags?: string[];
  category?: string[];
  assignee_ids?: string[];
}

export interface UpdateIssueRequest {
  title?: string;
  description?: string;
  type?: IssueType;
  status?: IssueStatus;
  priority?: IssuePriority | null;
  milestone_id?: string | null;
  assignee_ids?: string[];
  tags?: string[];
  category?: string[];
}

export interface CreateTLDRRequest {
  agent_name: string;
  summary: string;
  files_changed?: string[];
  tests_status?: TestsStatus;
  pr_url?: string;
}

export interface ProjectTag {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface CreateCommentRequest {
  author_id: string;
  author_name: string;
  body: string;
}

export interface IssueDetail extends Issue {
  tldrs: TLDR[];
  comments: Comment[];
}

export interface PublicSubmission {
  title: string;
  description?: string;
  type?: IssueType;
  reporter_name?: string;
  reporter_email?: string;
  attachments?: File[];
}
