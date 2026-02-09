use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ─── GitHub Installation ──────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubInstallation {
    pub id: Uuid,
    pub org_id: String,
    pub installation_id: i64,
    pub github_account_id: i64,
    pub github_account_login: String,
    pub github_account_type: String,
    pub permissions: serde_json::Value,
    pub status: String,
    pub installed_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── GitHub Repository ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubRepository {
    pub id: Uuid,
    pub installation_id: i64,
    pub github_repo_id: i64,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: String,
    pub is_private: bool,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── GitHub Repo ↔ Project Mapping ────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubRepoMapping {
    pub id: Uuid,
    pub project_id: Uuid,
    pub github_repo_id: i64,
    pub sync_direction: String,
    pub sync_issues: bool,
    pub sync_prs: bool,
    pub sync_comments: bool,
    pub auto_create_issues: bool,
    pub status_mapping: serde_json::Value,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── GitHub Issue Link ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubIssueLink {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub github_repo_id: i64,
    pub github_issue_number: i32,
    pub github_issue_id: i64,
    pub sync_status: String,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_github_updated_at: Option<DateTime<Utc>>,
    pub last_baaton_updated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ─── GitHub PR Link ───────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubPrLink {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub github_repo_id: i64,
    pub pr_number: i32,
    pub pr_id: i64,
    pub pr_title: String,
    pub pr_url: String,
    pub pr_state: String,
    pub head_branch: String,
    pub base_branch: String,
    pub author_login: String,
    pub author_id: Option<i64>,
    pub additions: Option<i32>,
    pub deletions: Option<i32>,
    pub changed_files: Option<i32>,
    pub review_status: Option<String>,
    pub merged_at: Option<DateTime<Utc>>,
    pub merged_by: Option<String>,
    pub link_method: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── GitHub Commit Link ───────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubCommitLink {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub github_repo_id: i64,
    pub sha: String,
    pub message: String,
    pub author_login: Option<String>,
    pub author_email: Option<String>,
    pub committed_at: DateTime<Utc>,
    pub url: String,
    pub created_at: DateTime<Utc>,
}

// ─── GitHub Webhook Event ─────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubWebhookEvent {
    pub id: Uuid,
    pub delivery_id: String,
    pub event_type: String,
    pub action: Option<String>,
    pub installation_id: Option<i64>,
    pub repository_full_name: Option<String>,
    pub sender_login: Option<String>,
    pub payload: serde_json::Value,
    pub status: String,
    pub error_message: Option<String>,
    pub processed_at: Option<DateTime<Utc>>,
    pub retry_count: i32,
    pub created_at: DateTime<Utc>,
}

// ─── GitHub Sync Job ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct GitHubSyncJob {
    pub id: Uuid,
    pub job_type: String,
    pub issue_id: Option<Uuid>,
    pub github_repo_id: Option<i64>,
    pub payload: serde_json::Value,
    pub status: String,
    pub priority: i32,
    pub max_retries: i32,
    pub retry_count: i32,
    pub last_error: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ─── Composite Response Types ─────────────────────────

/// Data returned for an issue's GitHub sidebar
#[derive(Debug, Serialize)]
pub struct IssueGitHubData {
    pub github_issue: Option<GitHubIssueLink>,
    pub pull_requests: Vec<GitHubPrLink>,
    pub commits: Vec<GitHubCommitLink>,
    pub branch_name: String,
}

// ─── Request DTOs ─────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateRepoMapping {
    pub project_id: Uuid,
    pub github_repo_id: i64,
    pub sync_direction: Option<String>,
    pub sync_issues: Option<bool>,
    pub sync_prs: Option<bool>,
    pub sync_comments: Option<bool>,
    pub auto_create_issues: Option<bool>,
    pub status_mapping: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRepoMapping {
    pub sync_direction: Option<String>,
    pub sync_issues: Option<bool>,
    pub sync_prs: Option<bool>,
    pub sync_comments: Option<bool>,
    pub auto_create_issues: Option<bool>,
    pub status_mapping: Option<serde_json::Value>,
    pub is_active: Option<bool>,
}
