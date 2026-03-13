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
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTldr {
    pub agent_name: String,
    pub summary: String,
    pub files_changed: Option<Vec<String>>,
    pub tests_status: Option<String>,
    pub pr_url: Option<String>,
}

// ─── Comment ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub author_id: String,
    pub author_name: String,
    pub body: String,
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
        Self { data, hints: vec![] }
    }

    /// Add AI-first action hints to the response
    pub fn with_hints(data: T, hints: Vec<ActionHint>) -> Self {
        Self { data, hints }
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
