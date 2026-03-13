// ─── Enums ────────────────────────────────────────────

export type IssueType = 'bug' | 'feature' | 'improvement' | 'question';
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low';
export type IssueSource = 'web' | 'api' | 'form' | 'email' | 'github';
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

export type AutoAssignMode = 'off' | 'default_assignee' | 'round_robin';

export interface Project {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  prefix: string;
  statuses: ProjectStatus[];
  auto_assign_mode: AutoAssignMode;
  default_assignee_id: string | null;
  github_repo_url?: string;
  github_metadata?: {
    full_name?: string;
    description?: string;
    language?: string;
    stars?: number;
    forks?: number;
    open_issues?: number;
    default_branch?: string;
    is_private?: boolean;
    topics?: string[];
    updated_at?: string;
    fetched_at?: string;
  };
  created_at: string;
}

export interface ProjectAutoAssignSettings {
  project_id: string;
  auto_assign_mode: AutoAssignMode;
  default_assignee_id: string | null;
}

export interface PublicSubmitSettings {
  enabled: boolean;
  token: string | null;
  slug: string;
}

export interface OpenClawConnection {
  id: string;
  user_id: string;
  org_id?: string;
  name: string;
  api_url: string;
  status: 'pending' | 'connected' | 'error';
  last_ping_at?: string;
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
  created_by_id: string | null;
  created_by_name: string | null;
  due_date: string | null;
  qualified_at: string | null;
  qualified_by: string | null;
  estimate: number | null;
  status_changed_at: string | null;
  closed_at: string | null;
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
  project_ids: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  org_id: string;
  project_id: string | null;
  issue_id: string | null;
  user_id: string;
  user_name: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  /** Enriched by backend JOIN — present in list_recent / list_by_issue responses */
  issue_title: string | null;
  issue_display_id: string | null;
}

export interface ProjectGamificationStats {
  velocity_7d: number;
  completion_rate: number;
  contributor_count: number;
  issues_created_7d: number;
  issues_closed_7d: number;
  top_contributors: Array<{
    user_id: string;
    user_name: string | null;
    action_count: number;
  }>;
  heatmap_30d: Array<{ date: string; count: number }>;
}

export type SSEEventType = 'issue_created' | 'issue_updated' | 'comment_created';

export interface SSEEvent {
  type: SSEEventType;
  issue_id?: string;
  project_id?: string;
  title?: string;
  comment_id?: string;
  author_name?: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: {
    projects?: string[];
    statuses?: string[];
    priorities?: string[];
    assignees?: string[];
    tags?: string[];
    search?: string;
  };
  sort?: string;
  is_shared: boolean;
  created_at: string;
}

export interface IssueTemplate {
  id: string;
  project_id: string;
  name: string;
  title_template: string | null;
  description_template: string | null;
  type: IssueType;
  priority: IssuePriority | null;
  tags: string[];
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
  due_date?: string;
  estimate?: number;
  sprint_id?: string;
  attachments?: Attachment[];
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
  due_date?: string | null;
  position?: number;
  estimate?: number | null;
  sprint_id?: string | null;
  attachments?: Attachment[];
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

// ─── GitHub Integration ───────────────────────────────

export type GitHubPrState = 'open' | 'closed' | 'merged' | 'draft';
export type GitHubReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'commented';
export type GitHubSyncDirection = 'github_to_baaton' | 'baaton_to_github' | 'bidirectional';
export type GitHubInstallationStatus = 'active' | 'suspended' | 'removed';

export interface GitHubInstallation {
  id: string;
  org_id: string;
  installation_id: number;
  github_account_id: number;
  github_account_login: string;
  github_account_type: string;
  permissions: Record<string, string>;
  status: GitHubInstallationStatus;
  installed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubRepository {
  id: string;
  installation_id: number;
  github_repo_id: number;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  is_private: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubRepoMapping {
  id: string;
  project_id: string;
  github_repo_id: number;
  sync_direction: GitHubSyncDirection;
  sync_issues: boolean;
  sync_prs: boolean;
  sync_comments: boolean;
  auto_create_issues: boolean;
  status_mapping: Record<string, string | null>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined data (optional, enriched by backend)
  repo?: GitHubRepository;
  project?: Project;
}

export interface GitHubPrLink {
  id: string;
  issue_id: string;
  github_repo_id: number;
  pr_number: number;
  pr_id: number;
  pr_title: string;
  pr_url: string;
  pr_state: GitHubPrState;
  head_branch: string;
  base_branch: string;
  author_login: string;
  author_id: number | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  review_status: GitHubReviewStatus | null;
  merged_at: string | null;
  merged_by: string | null;
  link_method: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubCommitLink {
  id: string;
  issue_id: string;
  github_repo_id: number;
  sha: string;
  message: string;
  author_login: string | null;
  author_email: string | null;
  committed_at: string;
  url: string;
  created_at: string;
}

export interface GitHubIssueLink {
  id: string;
  issue_id: string;
  github_repo_id: number;
  github_issue_number: number;
  github_issue_id: number;
  sync_status: string;
  last_synced_at: string | null;
  last_github_updated_at: string | null;
  last_baaton_updated_at: string | null;
  created_at: string;
}

export interface IssueGitHubData {
  github_issue: GitHubIssueLink | null;
  pull_requests: GitHubPrLink[];
  commits: GitHubCommitLink[];
  branch_name: string;
}

export interface CreateRepoMappingRequest {
  project_id: string;
  github_repo_id: number;
  sync_direction?: GitHubSyncDirection;
  sync_issues?: boolean;
  sync_prs?: boolean;
  sync_comments?: boolean;
  auto_create_issues?: boolean;
  status_mapping?: Record<string, string | null>;
}

export interface UpdateRepoMappingRequest {
  sync_direction?: GitHubSyncDirection;
  sync_issues?: boolean;
  sync_prs?: boolean;
  sync_comments?: boolean;
  auto_create_issues?: boolean;
  status_mapping?: Record<string, string | null>;
  is_active?: boolean;
}

// ─── Initiatives (BAA-9) ──────────────────────
export interface Initiative {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'completed' | 'archived';
  progress: number;
  created_at: string;
  updated_at: string;
  projects?: { project_id: string; project_name?: string }[];
}

// ─── Automations (BAA-27) ─────────────────────
export interface Automation {
  id: string;
  project_id: string;
  name: string;
  trigger: string;
  conditions: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  enabled: boolean;
  priority: number;
  created_at: string;
  // Computed helpers for UI
  trigger_type?: string;
  action_type?: string;
  trigger_config?: Record<string, unknown> | null;
  action_config?: Record<string, unknown> | null;
}

// ─── SLA Rules (BAA-8) ───────────────────────
export interface SlaRule {
  id: string;
  project_id: string;
  priority: string;
  deadline_hours: number;
  created_at: string;
}

export interface SlaStats {
  achievement_pct: number;
  on_time: number;
  breached: number;
  total: number;
}

// ─── Recurring Issues (BAA-17) ────────────────
export interface RecurringIssue {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: string | null;
  issue_type: string | null;
  cron_expression: string;
  next_run_at: string | null;
  last_run_at: string | null;
  enabled: boolean;
  created_at: string;
}

// ─── Cycles (BAA-2) ──────────────────────────
export interface Cycle {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: 'active' | 'completed' | 'planned';
  total_issues: number;
  completed_issues: number;
  total_points: number;
  completed_points: number;
  created_at: string;
}

// ─── Activity & Gamification ──────────────────────────

export interface UserActivityStats {
  scope: 'personal' | 'org';
  current_streak: number;
  longest_streak: number;
  velocity_7d: number;
  velocity_30d: number;
  velocity_trend: 'up' | 'down' | 'stable';
  personal_bests: {
    best_day: number;
    best_week: number;
  };
  today: { actions: number };
  this_week: { actions: number };
  completion_rate: number;
  goal: number | null;
  breakdown: {
    issues_created: number;
    issues_closed: number;
    comments: number;
    tldrs: number;
    status_changes: number;
    updates: number;
    github: number;
  };
  contributors: Array<{
    user_id: string;
    name: string;
    actions: number;
    is_agent: boolean;
  }>;
}

export interface HeatmapCell {
  date: string;
  count: number;
}

export interface HeatmapData {
  cells: HeatmapCell[];
  days: number;
}
