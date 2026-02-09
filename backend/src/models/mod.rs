pub mod github;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ─── Organization ─────────────────────────────────────

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
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProject {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub prefix: String,
}

// ─── Milestone ────────────────────────────────────────

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

#[derive(Debug, Serialize, Deserialize, FromRow)]
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
}

#[derive(Debug, Deserialize)]
pub struct UpdateIssue {
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub issue_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<Option<String>>,
    pub milestone_id: Option<Option<Uuid>>,
    pub assignee_ids: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub category: Option<Vec<String>>,
    pub position: Option<f64>,
    pub due_date: Option<Option<NaiveDate>>,
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
    pub color: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectTag {
    pub name: String,
    pub color: Option<String>,
}

// ─── API Key ──────────────────────────────────────────

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
}

// ─── API Response Wrapper ─────────────────────────────

#[derive(Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub data: T,
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: ApiErrorBody,
}

#[derive(Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn new(data: T) -> Self {
        Self { data }
    }
}
