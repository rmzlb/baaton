//! Background job: post (or update) a PR comment summarizing a public agent run.
//!
//! Triggered by `agent_sessions::update` and `agent_sessions::publish` when a
//! session reaches a terminal state (`completed` / `error`) AND `is_public=true`
//! AND `pr_url` is set. Idempotent via `agent_sessions.pr_comment_id`: re-runs
//! update the existing comment instead of creating duplicates.
//!
//! Failures propagate as `anyhow::Error`; the job runner handles retry with
//! exponential backoff and marks dead after `max_retries`.

use anyhow::{anyhow, Context};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::github::client::{self, GitHubClient};

#[derive(sqlx::FromRow)]
struct SessionRow {
    #[allow(dead_code)]
    id: Uuid,
    is_public: bool,
    public_token: Option<String>,
    pr_url: Option<String>,
    pr_comment_id: Option<i64>,
    status: String,
    summary: Option<String>,
    files_changed: Vec<String>,
    tests_status: String,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    agent_name: String,
    issue_id: Uuid,
}

/// Job runner entry point. `payload` is the JSONB stored on the row, expected
/// shape: `{"session_id": "<uuid>"}`.
pub async fn execute_post_run_comment(pool: &PgPool, payload: Value) -> anyhow::Result<()> {
    let session_id_str = payload
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("payload missing session_id"))?;
    let session_id = Uuid::parse_str(session_id_str)
        .with_context(|| format!("invalid session_id uuid: {}", session_id_str))?;

    let row: SessionRow = sqlx::query_as::<_, SessionRow>(
        r#"
        SELECT id, is_public, public_token, pr_url, pr_comment_id, status,
               summary, files_changed, tests_status,
               started_at, completed_at, agent_name, issue_id
        FROM agent_sessions
        WHERE id = $1
        "#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("session not found: {}", session_id))?;

    // Guard rails — these are non-retryable no-ops, not errors. The job runner
    // marks the row 'completed' once we return Ok.
    if !row.is_public {
        tracing::info!(session_id = %session_id, "skip pr comment: session not public");
        return Ok(());
    }
    let token = match row.public_token.as_deref() {
        Some(t) => t,
        None => {
            tracing::warn!(
                session_id = %session_id,
                "skip pr comment: is_public=true but no public_token (CHECK constraint should prevent this)"
            );
            return Ok(());
        }
    };
    let pr_url = match row.pr_url.as_deref() {
        Some(u) => u,
        None => {
            tracing::info!(session_id = %session_id, "skip pr comment: no pr_url");
            return Ok(());
        }
    };

    let (owner, repo, pr_number) =
        client::parse_pr_url(pr_url).ok_or_else(|| anyhow!("malformed pr_url: {}", pr_url))?;

    // Find the installation. Prefer matching by the actual repo (owner+name) via
    // github_repositories, falling back to the org/user account_login. Repos can
    // be transferred between accounts; the repo-level match is more reliable.
    let installation_id: i64 = match sqlx::query_scalar::<_, i64>(
        r#"
        SELECT installation_id FROM github_repositories
        WHERE owner = $1 AND name = $2
        LIMIT 1
        "#,
    )
    .bind(&owner)
    .bind(&repo)
    .fetch_optional(pool)
    .await?
    {
        Some(id) => id,
        None => sqlx::query_scalar::<_, i64>(
            r#"
            SELECT installation_id FROM github_installations
            WHERE github_account_login = $1 AND status = 'active'
            LIMIT 1
            "#,
        )
        .bind(&owner)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("no installation for owner: {}", owner))?,
    };

    // Fetch issue display_id and project name for the comment body.
    let (display_id, project_name): (String, String) = sqlx::query_as(
        r#"
        SELECT i.display_id, p.name
        FROM issues i JOIN projects p ON p.id = i.project_id
        WHERE i.id = $1
        "#,
    )
    .bind(row.issue_id)
    .fetch_one(pool)
    .await?;

    let body = render_comment_body(&display_id, &project_name, &row, token);

    let gh = GitHubClient::from_env().context("github client init failed")?;
    let new_comment_id = gh
        .upsert_pr_comment(
            installation_id as u64,
            &owner,
            &repo,
            pr_number,
            row.pr_comment_id,
            &body,
        )
        .await
        .context("upsert_pr_comment failed")?;

    if Some(new_comment_id) != row.pr_comment_id {
        sqlx::query("UPDATE agent_sessions SET pr_comment_id = $1 WHERE id = $2")
            .bind(new_comment_id)
            .bind(session_id)
            .execute(pool)
            .await?;
    }

    tracing::info!(
        session_id = %session_id,
        comment_id = new_comment_id,
        owner = %owner,
        repo = %repo,
        pr = pr_number,
        "pr comment upserted"
    );

    Ok(())
}

fn render_comment_body(
    display_id: &str,
    project_name: &str,
    s: &SessionRow,
    token: &str,
) -> String {
    let public_origin = std::env::var("PUBLIC_RUN_ORIGIN")
        .unwrap_or_else(|_| "https://r.baaton.dev".to_string());

    let duration = match (s.started_at, s.completed_at) {
        (Some(a), Some(b)) => format_duration_secs((b - a).num_seconds().max(0)),
        _ => "—".into(),
    };

    let summary = s
        .summary
        .as_deref()
        .map(|t| truncate_chars(t, 240))
        .unwrap_or_else(|| "_(no summary)_".to_string());

    // S6: when the run failed, prefix the heading so the failure is visually
    // obvious in the PR thread. Successful and other states use the neutral title.
    let heading = if s.status == "error" {
        format!("### ❌ Agent Run failed · `{display_id}`")
    } else {
        format!("### Agent Run · `{display_id}`")
    };

    let tests = match s.tests_status.as_str() {
        "passed" => "passed ✓",
        "failed" => "failed ✗",
        "skipped" => "skipped",
        _ => "—",
    };

    format!(
        "{heading}\n\
         \n\
         **Agent:** `{agent}` · **Status:** `{status}` · **Duration:** {duration}\n\
         \n\
         **Project:** {project}\n\
         \n\
         **Summary:** {summary}\n\
         \n\
         **Files changed:** {files} · **Tests:** {tests}\n\
         \n\
         [View full run →]({origin}/{token})\n\
         \n\
         <sub>Posted by [Baaton](https://baaton.dev) — receipts for AI agent work.</sub>",
        heading = heading,
        agent = s.agent_name,
        status = s.status,
        duration = duration,
        project = project_name,
        summary = summary,
        files = s.files_changed.len(),
        tests = tests,
        origin = public_origin.trim_end_matches('/'),
        token = token,
    )
}

fn format_duration_secs(s: i64) -> String {
    if s < 60 {
        return format!("{s}s");
    }
    let m = s / 60;
    let rem_s = s % 60;
    if m < 60 {
        return if rem_s > 0 {
            format!("{m}m {rem_s}s")
        } else {
            format!("{m}m")
        };
    }
    let h = m / 60;
    let rem_m = m % 60;
    if rem_m > 0 {
        format!("{h}h {rem_m}m")
    } else {
        format!("{h}h")
    }
}

/// C2: Truncate `s` to at most `max_chars` Unicode scalars, appending `…` if truncated.
/// Char-boundary safe (won't panic on multibyte input).
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut count = 0usize;
    let mut end = s.len();
    for (i, _) in s.char_indices() {
        if count == max_chars {
            end = i;
            break;
        }
        count += 1;
    }
    if end == s.len() {
        s.to_string()
    } else {
        format!("{}…", &s[..end])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> SessionRow {
        SessionRow {
            id: Uuid::nil(),
            is_public: true,
            public_token: Some("01HX0Z9ABC".into()),
            pr_url: Some("https://github.com/foo/bar/pull/42".into()),
            pr_comment_id: None,
            status: "completed".into(),
            summary: Some("Refactored auth middleware to use Clerk session tokens.".into()),
            files_changed: vec![
                "src/middleware/auth.rs".into(),
                "src/routes/login.rs".into(),
                "tests/auth_test.rs".into(),
            ],
            tests_status: "passed".into(),
            started_at: Some(
                "2026-05-18T20:00:00Z".parse::<DateTime<Utc>>().unwrap(),
            ),
            completed_at: Some(
                "2026-05-18T20:04:23Z".parse::<DateTime<Utc>>().unwrap(),
            ),
            agent_name: "openclaw:haroz".into(),
            issue_id: Uuid::nil(),
        }
    }

    #[test]
    fn render_includes_run_link_and_token() {
        let body = render_comment_body("BAA-128", "Baaton", &sample_row(), "01HX0Z9ABC");
        assert!(body.contains("BAA-128"));
        assert!(body.contains("openclaw:haroz"));
        assert!(body.contains("https://r.baaton.dev/01HX0Z9ABC"));
        assert!(body.contains("3 · **Tests:** passed ✓"));
    }

    #[test]
    fn duration_formatting() {
        assert_eq!(format_duration_secs(0), "0s");
        assert_eq!(format_duration_secs(45), "45s");
        assert_eq!(format_duration_secs(60), "1m");
        assert_eq!(format_duration_secs(125), "2m 5s");
        assert_eq!(format_duration_secs(3600), "1h");
        assert_eq!(format_duration_secs(3725), "1h 2m");
    }

    #[test]
    fn summary_truncated_at_240() {
        let mut s = sample_row();
        s.summary = Some("x".repeat(500));
        let body = render_comment_body("BAA-1", "P", &s, "tok");
        assert!(body.contains(&"…".to_string()));
    }

    #[test]
    fn missing_summary_renders_placeholder() {
        let mut s = sample_row();
        s.summary = None;
        let body = render_comment_body("BAA-1", "P", &s, "tok");
        assert!(body.contains("_(no summary)_"));
    }

    #[test]
    fn render_with_multibyte_summary_does_not_panic() {
        // C2 regression: 300 × "é" = 600 bytes / 300 chars (> 240 char threshold).
        // With the old `&t[..240]` byte-slice this panicked because byte 240 fell
        // mid-codepoint. truncate_chars uses char_indices so it's safe.
        let mut s = sample_row();
        s.summary = Some("é".repeat(300));
        let body = render_comment_body("BAA-1", "P", &s, "tok");
        assert!(body.contains("…"));
    }

    #[test]
    fn error_status_uses_failure_heading() {
        // S6: the comment for a failed run must visually flag the failure
        // so reviewers don't mistake it for a successful receipt.
        let mut s = sample_row();
        s.status = "error".into();
        let body = render_comment_body("BAA-9", "P", &s, "tok");
        assert!(body.contains("❌ Agent Run failed"));
        assert!(body.contains("BAA-9"));
    }
}
