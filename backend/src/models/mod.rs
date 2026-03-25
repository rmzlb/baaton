pub mod github;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ─── Organization ─────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: DateTime<Utc>,
}

// ─── Project ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: Uuid,
    pub org_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub prefix: String,
    pub statuses: serde_json::Value,
    pub auto_assign_mode: String,
    pub default_assignee_id: Option<String>,
    pub public_submit_enabled: bool,
    pub public_submit_token: Option<String>,
    pub github_repo_url: Option<String>,
    pub github_metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProject {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub prefix: String,
    pub auto_assign_mode: Option<String>,
    pub default_assignee_id: Option<String>,
    pub github_repo_url: Option<String>,
    pub template_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ProjectAutoAssignSettings {
    pub project_id: Uuid,
    pub auto_assign_mode: String,
    pub default_assignee_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectAutoAssignSettings {
    pub auto_assign_mode: String,
    pub default_assignee_id: Option<String>,
}

// ─── Milestone ────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Milestone {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

// ─── Issue ────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Issue {
    pub id: Uuid,
    pub project_id: Uuid,
    /// Populated via JOIN on projects.org_id in list endpoints; not stored on issues table.
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    pub milestone_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub display_id: String,
    pub title: String,
    pub description: Option<String>,
    #[sqlx(rename = "type")]
    pub issue_type: String,
    pub status: String,
    pub priority: Option<String>,
    pub source: String,
    pub reporter_name: Option<String>,
    pub reporter_email: Option<String>,
    pub assignee_ids: Vec<String>,
    pub tags: Vec<String>,
    pub attachments: serde_json::Value,
    pub category: Vec<String>,
    pub position: f64,
    pub created_by_id: Option<String>,
    pub created_by_name: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub qualified_at: Option<DateTime<Utc>>,
    pub qualified_by: Option<String>,
    pub estimate: Option<i32>,
    pub sprint_id: Option<Uuid>,
    pub status_changed_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub snoozed_until: Option<NaiveDate>,
    pub archived: bool,
    pub archived_at: Option<DateTime<Utc>>,
    pub sla_deadline: Option<DateTime<Utc>>,
    pub sla_breached: Option<bool>,
    pub agent_status: Option<String>,
    pub agent_session_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateIssue {
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub issue_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub milestone_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub tags: Option<Vec<String>>,
    pub category: Option<Vec<String>>,
    pub assignee_ids: Option<Vec<String>>,
    pub due_date: Option<NaiveDate>,
    pub estimate: Option<i32>,
    pub sprint_id: Option<Uuid>,
    pub attachments: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct UpdateIssue {
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub issue_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<Option<String>>,
    pub milestone_id: Option<Option<Uuid>>,
    pub parent_id: Option<Option<Uuid>>,
    pub assignee_ids: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub category: Option<Vec<String>>,
    pub position: Option<f64>,
    pub due_date: Option<Option<NaiveDate>>,
    pub attachments: Option<serde_json::Value>,
    pub estimate: Option<Option<i32>>,
    pub sprint_id: Option<Option<Uuid>>,
    pub snoozed_until: Option<Option<NaiveDate>>,
    /// When true, skip workflow transition warnings (agent confirmed the move).
    #[serde(default)]
    pub force: bool,
}

// ─── Agent Session ────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AgentSession {
    pub id: Uuid,
    pub org_id: String,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub agent_name: String,
    pub agent_id: Option<String>,
    pub status: String,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub summary: Option<String>,
    pub files_changed: Vec<String>,
    pub tests_status: String,
    pub pr_url: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentSession {
    pub issue_id: Uuid,
    pub agent_name: String,
    pub agent_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentSession {
    pub status: Option<String>,
    pub summary: Option<String>,
    pub files_changed: Option<Vec<String>>,
    pub tests_status: Option<String>,
    pub pr_url: Option<String>,
    pub error_message: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

// ─── Agent Step ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AgentStep {
    pub id: Uuid,
    pub session_id: Uuid,
    pub issue_id: Uuid,
    pub step_type: String,
    pub message: String,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentStep {
    pub step_type: Option<String>,
    pub message: String,
    pub metadata: Option<serde_json::Value>,
}

// ─── Agent Session Detail (with steps) ────────────────

#[derive(Debug, Serialize)]
pub struct AgentSessionDetail {
    #[serde(flatten)]
    pub session: AgentSession,
    pub steps: Vec<AgentStep>,
}

// ─── Issue Relation ───────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct IssueRelation {
    pub id: Uuid,
    pub source_issue_id: Uuid,
    pub target_issue_id: Uuid,
    pub relation_type: String,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ─── Recurrence Rule ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct RecurrenceRule {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub title_template: String,
    pub description: Option<String>,
    pub assignee_ids: Vec<String>,
    pub tags: Vec<String>,
    pub priority: String,
    pub issue_type: String,
    pub rrule: String,
    pub next_run_at: DateTime<Utc>,
    pub paused: bool,
    pub end_date: Option<chrono::NaiveDate>,
    pub max_occurrences: Option<i32>,
    pub occurrence_count: i32,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ─── TLDR ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Tldr {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub agent_name: String,
    pub summary: String,
    pub files_changed: Vec<String>,
    pub tests_status: String,
    pub pr_url: Option<String>,
    pub decisions_made: Vec<String>,
    pub edge_cases: Vec<String>,
    pub context_updates: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTldr {
    pub agent_name: String,
    pub summary: String,
    pub files_changed: Option<Vec<String>>,
    pub tests_status: Option<String>,
    pub pr_url: Option<String>,
    pub decisions_made: Option<Vec<String>>,
    pub edge_cases: Option<Vec<String>>,
    pub context_updates: Option<Vec<String>>,
}

// ─── Project Context ───────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ProjectContext {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub stack: Option<String>,
    pub conventions: Option<String>,
    pub architecture: Option<String>,
    pub constraints: Option<String>,
    pub current_focus: Option<String>,
    pub learnings: Option<String>,
    pub custom_context: serde_json::Value,
    pub updated_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectContext {
    pub stack: Option<String>,
    pub conventions: Option<String>,
    pub architecture: Option<String>,
    pub constraints: Option<String>,
    pub current_focus: Option<String>,
    pub learnings: Option<String>,
    pub custom_context: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct AppendContextField {
    pub field_name: String,
    pub content: String,
}

// ─── Project Template ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ProjectTemplate {
    pub id: Uuid,
    pub org_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub default_context: serde_json::Value,
    pub default_statuses: Option<serde_json::Value>,
    pub default_tags: Vec<String>,
    pub is_system: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectTemplate {
    pub name: String,
    pub description: Option<String>,
    pub default_context: Option<serde_json::Value>,
    pub default_statuses: Option<serde_json::Value>,
    pub default_tags: Option<Vec<String>>,
}

// ─── Comment ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub author_id: String,
    pub author_name: String,
    pub body: String,
    pub comment_type: String,
    pub approval_status: Option<String>,
    pub approval_metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Issue Detail (with relations) ────────────────────

#[derive(Debug, Serialize)]
pub struct IssueDetail {
    #[serde(flatten)]
    pub issue: Issue,
    pub tldrs: Vec<Tldr>,
    pub comments: Vec<Comment>,
    pub agent_session: Option<AgentSession>,
    /// Compact one-line summary for LLM context efficiency
    #[serde(rename = "_context")]
    pub context_summary: String,
}

// ─── Project Tag ──────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ProjectTag {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub group_name: Option<String>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectTag {
    pub name: String,
    pub color: Option<String>,
    pub group_name: Option<String>,
    pub description: Option<String>,
}

// ─── API Key ──────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ApiKey {
    pub id: Uuid,
    pub org_id: String,
    pub name: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub permissions: Vec<String>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ─── Activity Log ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ActivityEntry {
    pub id: Uuid,
    pub org_id: String,
    pub project_id: Option<Uuid>,
    pub issue_id: Option<Uuid>,
    pub user_id: String,
    pub user_name: Option<String>,
    pub action: String,
    pub field: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    /// Enriched fields — populated by JOIN in list_recent / list_by_issue.
    /// Absent in simple SELECT * queries; defaults to None via #[sqlx(default)].
    #[sqlx(default)]
    pub issue_title: Option<String>,
    #[sqlx(default)]
    pub issue_display_id: Option<String>,
}

// ─── API Response Wrapper ─────────────────────────────

/// AI-first action hint: tells agents what to do next after this response.
/// Inspired by HATEOAS but designed for LLM agents, not browsers.
#[derive(Debug, Serialize, Clone)]
pub struct ActionHint {
    /// What the agent should do next (e.g. "add_tldr", "verify_status", "add_comment")
    pub action: String,
    /// Why this action is recommended
    pub reason: String,
    /// API endpoint to call (e.g. "POST /issues/{id}/tldr")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    /// Priority: "required", "recommended", "optional"
    pub priority: String,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub data: T,
    /// AI-first action hints: contextual next steps for agents
    #[serde(rename = "_hints", skip_serializing_if = "Vec::is_empty")]
    pub hints: Vec<ActionHint>,
    /// Warnings about non-standard operations (e.g. skipped workflow steps)
    #[serde(rename = "_warnings", skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: ApiErrorBody,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    /// Remediation steps for AI agents
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation: Option<String>,
    /// Accepted values if the error is about invalid enum
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_values: Option<Vec<String>>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn new(data: T) -> Self {
        Self { data, hints: vec![], warnings: vec![] }
    }

    /// Add AI-first action hints to the response
    pub fn with_hints(data: T, hints: Vec<ActionHint>) -> Self {
        Self { data, hints, warnings: vec![] }
    }

    /// Add hints + warnings (for workflow transitions)
    pub fn with_hints_and_warnings(data: T, hints: Vec<ActionHint>, warnings: Vec<serde_json::Value>) -> Self {
        Self { data, hints, warnings }
    }
}

impl ActionHint {
    #[allow(dead_code)]
    pub fn required(action: &str, reason: &str, endpoint: Option<&str>) -> Self {
        Self {
            action: action.to_string(),
            reason: reason.to_string(),
            endpoint: endpoint.map(|s| s.to_string()),
            priority: "required".to_string(),
        }
    }
    pub fn recommended(action: &str, reason: &str, endpoint: Option<&str>) -> Self {
        Self {
            action: action.to_string(),
            reason: reason.to_string(),
            endpoint: endpoint.map(|s| s.to_string()),
            priority: "recommended".to_string(),
        }
    }
    #[allow(dead_code)]
    pub fn optional(action: &str, reason: &str, endpoint: Option<&str>) -> Self {
        Self {
            action: action.to_string(),
            reason: reason.to_string(),
            endpoint: endpoint.map(|s| s.to_string()),
            priority: "optional".to_string(),
        }
    }
}
