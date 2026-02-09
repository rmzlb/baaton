use lazy_static::lazy_static;
use regex::Regex;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::github::GitHubRepoMapping;

lazy_static! {
    /// Match patterns like "BAA-42", "PROJ-123", etc.
    static ref ISSUE_ID_REGEX: Regex = Regex::new(
        r"(?i)([A-Z]{2,10})-(\d+)"
    ).unwrap();

    /// Match "fixes #123", "closes #456", "resolves #789"
    static ref GITHUB_CLOSE_REGEX: Regex = Regex::new(
        r"(?i)(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)"
    ).unwrap();

    /// Match branch name patterns: "feature/BAA-42-description" or "BAA-42/description"
    static ref BRANCH_ISSUE_REGEX: Regex = Regex::new(
        r"(?i)(?:^|/)([A-Z]{2,10}-\d+)"
    ).unwrap();
}

/// Try to find the linked Baaton issue from various sources.
///
/// Priority order:
/// 1. Branch name (most reliable for AI agent workflows)
/// 2. PR title
/// 3. PR body (issue IDs)
/// 4. PR body ("fixes #N" referencing a linked GitHub issue)
pub async fn find_linked_issue(
    pool: &PgPool,
    mapping: &GitHubRepoMapping,
    branch_name: &str,
    pr_title: &str,
    pr_body: &str,
) -> Result<Option<Uuid>, anyhow::Error> {
    // 1. Check branch name
    if let Some(cap) = BRANCH_ISSUE_REGEX.captures(branch_name) {
        let display_id = cap.get(1).unwrap().as_str().to_uppercase();
        if let Some(issue) =
            find_issue_by_display_id(pool, mapping.project_id, &display_id).await?
        {
            return Ok(Some(issue));
        }
    }

    // 2. Check PR title
    for cap in ISSUE_ID_REGEX.captures_iter(pr_title) {
        let display_id = format!(
            "{}-{}",
            cap.get(1).unwrap().as_str().to_uppercase(),
            cap.get(2).unwrap().as_str()
        );
        if let Some(issue) =
            find_issue_by_display_id(pool, mapping.project_id, &display_id).await?
        {
            return Ok(Some(issue));
        }
    }

    // 3. Check PR body for issue IDs
    for cap in ISSUE_ID_REGEX.captures_iter(pr_body) {
        let display_id = format!(
            "{}-{}",
            cap.get(1).unwrap().as_str().to_uppercase(),
            cap.get(2).unwrap().as_str()
        );
        if let Some(issue) =
            find_issue_by_display_id(pool, mapping.project_id, &display_id).await?
        {
            return Ok(Some(issue));
        }
    }

    // 4. Check for GitHub issue number references ("fixes #42")
    for cap in GITHUB_CLOSE_REGEX.captures_iter(pr_body) {
        let gh_issue_number: i32 = cap.get(1).unwrap().as_str().parse().unwrap_or(0);
        if gh_issue_number > 0 {
            if let Some(issue) =
                find_issue_by_github_number(pool, mapping.github_repo_id, gh_issue_number).await?
            {
                return Ok(Some(issue));
            }
        }
    }

    Ok(None)
}

/// Look up a Baaton issue by its display_id within a project.
async fn find_issue_by_display_id(
    pool: &PgPool,
    project_id: Uuid,
    display_id: &str,
) -> Result<Option<Uuid>, anyhow::Error> {
    let result: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM issues WHERE project_id = $1 AND display_id = $2",
    )
    .bind(project_id)
    .bind(display_id)
    .fetch_optional(pool)
    .await?;

    Ok(result.map(|r| r.0))
}

/// Look up a Baaton issue by a linked GitHub issue number.
async fn find_issue_by_github_number(
    pool: &PgPool,
    github_repo_id: i64,
    github_issue_number: i32,
) -> Result<Option<Uuid>, anyhow::Error> {
    let result: Option<(Uuid,)> = sqlx::query_as(
        "SELECT issue_id FROM github_issue_links WHERE github_repo_id = $1 AND github_issue_number = $2",
    )
    .bind(github_repo_id)
    .bind(github_issue_number)
    .fetch_optional(pool)
    .await?;

    Ok(result.map(|r| r.0))
}

/// Generate a suggested branch name for a Baaton issue.
///
/// Example: display_id="BAA-42", title="Fix login bug" → "baa-42-fix-login-bug"
pub fn generate_branch_name(display_id: &str, title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();

    // Collapse multiple dashes and trim
    let slug: String = slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // Truncate to reasonable length
    let slug = if slug.len() > 50 {
        &slug[..50]
    } else {
        &slug
    };
    let slug = slug.trim_end_matches('-');

    format!("{}-{}", display_id.to_lowercase(), slug)
}
