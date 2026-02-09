use sqlx::PgPool;

use crate::models::github::{GitHubRepoMapping, GitHubWebhookEvent};

/// Process a webhook event that was previously stored in github_webhook_events.
///
/// Called from the webhook handler's spawned task AND from the job runner
/// (for retries of failed events).
pub async fn process_webhook_event(
    pool: &PgPool,
    delivery_id: &str,
) -> Result<(), anyhow::Error> {
    // Mark as processing
    sqlx::query(
        "UPDATE github_webhook_events SET status = 'processing' WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .execute(pool)
    .await?;

    // Fetch the event
    let event = sqlx::query_as::<_, GitHubWebhookEvent>(
        "SELECT * FROM github_webhook_events WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .fetch_one(pool)
    .await?;

    let result = match event.event_type.as_str() {
        "installation" => handle_installation_event(pool, &event).await,
        "installation_repositories" => handle_installation_repos_event(pool, &event).await,
        "pull_request" => handle_pull_request_event(pool, &event).await,
        "pull_request_review" => handle_pr_review_event(pool, &event).await,
        "push" => handle_push_event(pool, &event).await,
        "issues" => handle_issues_event(pool, &event).await,
        _ => {
            tracing::debug!("Ignoring unhandled event type: {}", event.event_type);
            Ok(())
        }
    };

    match result {
        Ok(()) => {
            sqlx::query(
                "UPDATE github_webhook_events SET status = 'completed', processed_at = now() WHERE delivery_id = $1",
            )
            .bind(delivery_id)
            .execute(pool)
            .await?;
        }
        Err(ref e) => {
            let retry_count = event.retry_count + 1;
            let new_status = if retry_count >= 3 { "failed" } else { "pending" };

            sqlx::query(
                r#"UPDATE github_webhook_events
                   SET status = $2, error_message = $3, retry_count = $4
                   WHERE delivery_id = $1"#,
            )
            .bind(delivery_id)
            .bind(new_status)
            .bind(e.to_string())
            .bind(retry_count)
            .execute(pool)
            .await?;
        }
    }

    result
}

// ─── Installation Events ──────────────────────────────

async fn handle_installation_event(
    pool: &PgPool,
    event: &GitHubWebhookEvent,
) -> Result<(), anyhow::Error> {
    let action = event.action.as_deref().unwrap_or("");
    let payload = &event.payload;

    match action {
        "deleted" => {
            let installation_id = payload["installation"]["id"]
                .as_i64()
                .ok_or_else(|| anyhow::anyhow!("Missing installation.id"))?;

            sqlx::query(
                "UPDATE github_installations SET status = 'removed', updated_at = now() WHERE installation_id = $1",
            )
            .bind(installation_id)
            .execute(pool)
            .await?;

            // Deactivate all mappings for repos under this installation
            sqlx::query(
                r#"UPDATE github_repo_mappings SET is_active = false, updated_at = now()
                   WHERE github_repo_id IN (
                       SELECT github_repo_id FROM github_repositories WHERE installation_id = $1
                   )"#,
            )
            .bind(installation_id)
            .execute(pool)
            .await?;

            tracing::info!("GitHub installation {} removed", installation_id);
        }
        "suspend" => {
            let installation_id = payload["installation"]["id"].as_i64().unwrap_or(0);
            sqlx::query(
                "UPDATE github_installations SET status = 'suspended', updated_at = now() WHERE installation_id = $1",
            )
            .bind(installation_id)
            .execute(pool)
            .await?;
        }
        "unsuspend" => {
            let installation_id = payload["installation"]["id"].as_i64().unwrap_or(0);
            sqlx::query(
                "UPDATE github_installations SET status = 'active', updated_at = now() WHERE installation_id = $1",
            )
            .bind(installation_id)
            .execute(pool)
            .await?;
        }
        _ => {
            tracing::debug!("Ignoring installation action: {}", action);
        }
    }

    Ok(())
}

// ─── Installation Repositories Events ─────────────────

async fn handle_installation_repos_event(
    pool: &PgPool,
    event: &GitHubWebhookEvent,
) -> Result<(), anyhow::Error> {
    let payload = &event.payload;
    let installation_id = event.installation_id.unwrap_or(0);

    // Handle added repos
    if let Some(added) = payload["repositories_added"].as_array() {
        for repo in added {
            let github_repo_id = repo["id"].as_i64().unwrap_or(0);
            let full_name = repo["full_name"].as_str().unwrap_or("");
            let name = repo["name"].as_str().unwrap_or("");
            let is_private = repo["private"].as_bool().unwrap_or(false);

            // Extract owner from full_name (e.g. "org/repo" → "org")
            let owner = full_name.split('/').next().unwrap_or("");

            sqlx::query(
                r#"INSERT INTO github_repositories
                   (installation_id, github_repo_id, owner, name, full_name, is_private)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (github_repo_id) DO UPDATE SET
                    full_name = $5, is_private = $6, updated_at = now()"#,
            )
            .bind(installation_id)
            .bind(github_repo_id)
            .bind(owner)
            .bind(name)
            .bind(full_name)
            .bind(is_private)
            .execute(pool)
            .await?;
        }
    }

    // Handle removed repos
    if let Some(removed) = payload["repositories_removed"].as_array() {
        for repo in removed {
            let github_repo_id = repo["id"].as_i64().unwrap_or(0);

            // Deactivate mappings
            sqlx::query(
                "UPDATE github_repo_mappings SET is_active = false, updated_at = now() WHERE github_repo_id = $1",
            )
            .bind(github_repo_id)
            .execute(pool)
            .await?;

            sqlx::query("DELETE FROM github_repositories WHERE github_repo_id = $1")
                .bind(github_repo_id)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

// ─── Pull Request Events ─────────────────────────────

async fn handle_pull_request_event(
    pool: &PgPool,
    event: &GitHubWebhookEvent,
) -> Result<(), anyhow::Error> {
    let action = event.action.as_deref().unwrap_or("");
    let payload = &event.payload;
    let pr = &payload["pull_request"];
    let repo = &payload["repository"];

    let github_repo_id = repo["id"]
        .as_i64()
        .ok_or_else(|| anyhow::anyhow!("Missing repository.id"))?;
    let pr_number = pr["number"].as_i64().unwrap_or(0) as i32;

    // Find active mapping for this repo
    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        "SELECT * FROM github_repo_mappings WHERE github_repo_id = $1 AND is_active = true",
    )
    .bind(github_repo_id)
    .fetch_optional(pool)
    .await?;

    let mapping = match mapping {
        Some(m) if m.sync_prs => m,
        _ => return Ok(()), // No active mapping or PR sync disabled
    };

    // Extract branch name and try to find linked issue
    let head_branch = pr["head"]["ref"].as_str().unwrap_or("");
    let pr_body = pr["body"].as_str().unwrap_or("");
    let pr_title = pr["title"].as_str().unwrap_or("");

    let issue_id = crate::github::issue_linker::find_linked_issue(
        pool,
        &mapping,
        head_branch,
        pr_title,
        pr_body,
    )
    .await?;

    let issue_id = match issue_id {
        Some(id) => id,
        None => {
            tracing::debug!(
                "PR #{} in {} has no linked Baaton issue",
                pr_number,
                repo["full_name"].as_str().unwrap_or("?")
            );
            return Ok(());
        }
    };

    let pr_state = match (action, pr["merged"].as_bool()) {
        ("closed", Some(true)) => "merged",
        ("closed", _) => "closed",
        (_, _) if pr["draft"].as_bool().unwrap_or(false) => "draft",
        _ => "open",
    };

    // Upsert PR link
    sqlx::query(
        r#"INSERT INTO github_pr_links
           (issue_id, github_repo_id, pr_number, pr_id, pr_title, pr_url,
            pr_state, head_branch, base_branch, author_login, author_id,
            additions, deletions, changed_files, link_method)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (github_repo_id, pr_number) DO UPDATE SET
            pr_title = $5, pr_state = $7,
            additions = $12, deletions = $13, changed_files = $14,
            updated_at = now()"#,
    )
    .bind(issue_id)
    .bind(github_repo_id)
    .bind(pr_number)
    .bind(pr["id"].as_i64().unwrap_or(0))
    .bind(pr_title)
    .bind(pr["html_url"].as_str().unwrap_or(""))
    .bind(pr_state)
    .bind(head_branch)
    .bind(pr["base"]["ref"].as_str().unwrap_or("main"))
    .bind(pr["user"]["login"].as_str().unwrap_or("unknown"))
    .bind(pr["user"]["id"].as_i64())
    .bind(pr["additions"].as_i64().map(|v| v as i32))
    .bind(pr["deletions"].as_i64().map(|v| v as i32))
    .bind(pr["changed_files"].as_i64().map(|v| v as i32))
    .bind("branch_name")
    .execute(pool)
    .await?;

    // Apply status mapping
    let mapping_key = match pr_state {
        "open" | "draft" => "pr_opened",
        "merged" => "pr_merged",
        "closed" => "pr_closed",
        _ => return Ok(()),
    };

    crate::github::status_mapper::apply_status_mapping(
        pool,
        issue_id,
        &mapping.status_mapping,
        mapping_key,
        &format!("GitHub PR #{}", pr_number),
    )
    .await?;

    // Update merged metadata
    if action == "closed" && pr["merged"].as_bool() == Some(true) {
        sqlx::query(
            r#"UPDATE github_pr_links SET
                merged_at = $1::text::timestamptz,
                merged_by = $2
               WHERE github_repo_id = $3 AND pr_number = $4"#,
        )
        .bind(pr["merged_at"].as_str())
        .bind(pr["merged_by"]["login"].as_str())
        .bind(github_repo_id)
        .bind(pr_number)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ─── Pull Request Review Events ───────────────────────

async fn handle_pr_review_event(
    pool: &PgPool,
    event: &GitHubWebhookEvent,
) -> Result<(), anyhow::Error> {
    let payload = &event.payload;
    let review = &payload["review"];
    let pr = &payload["pull_request"];
    let repo = &payload["repository"];

    let github_repo_id = repo["id"].as_i64().unwrap_or(0);
    let pr_number = pr["number"].as_i64().unwrap_or(0) as i32;

    let review_state = review["state"].as_str().unwrap_or("");

    let review_status = match review_state {
        "approved" => "approved",
        "changes_requested" => "changes_requested",
        "commented" => "commented",
        _ => return Ok(()),
    };

    sqlx::query(
        "UPDATE github_pr_links SET review_status = $1, updated_at = now() WHERE github_repo_id = $2 AND pr_number = $3",
    )
    .bind(review_status)
    .bind(github_repo_id)
    .bind(pr_number)
    .execute(pool)
    .await?;

    Ok(())
}

// ─── Push Events (Commits) ────────────────────────────

async fn handle_push_event(
    pool: &PgPool,
    event: &GitHubWebhookEvent,
) -> Result<(), anyhow::Error> {
    let payload = &event.payload;
    let repo = &payload["repository"];
    let github_repo_id = repo["id"].as_i64().unwrap_or(0);

    // Find mapping
    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        "SELECT * FROM github_repo_mappings WHERE github_repo_id = $1 AND is_active = true",
    )
    .bind(github_repo_id)
    .fetch_optional(pool)
    .await?;

    let mapping = match mapping {
        Some(m) => m,
        None => return Ok(()),
    };

    // Extract branch name from ref (e.g. "refs/heads/baa-42-fix-login")
    let git_ref = payload["ref"].as_str().unwrap_or("");
    let branch = git_ref.strip_prefix("refs/heads/").unwrap_or(git_ref);

    let commits = payload["commits"].as_array().cloned().unwrap_or_default();

    for commit in &commits {
        let sha = commit["id"].as_str().unwrap_or("");
        let message = commit["message"].as_str().unwrap_or("");
        let author_login = commit["author"]["username"].as_str();
        let author_email = commit["author"]["email"].as_str();
        let url = commit["url"].as_str().unwrap_or("");
        let timestamp = commit["timestamp"].as_str().unwrap_or("");

        // Try to find linked issue from branch name or commit message
        let issue_id = crate::github::issue_linker::find_linked_issue(
            pool, &mapping, branch, message, "",
        )
        .await?;

        let issue_id = match issue_id {
            Some(id) => id,
            None => continue, // No linked issue for this commit
        };

        sqlx::query(
            r#"INSERT INTO github_commit_links
               (issue_id, github_repo_id, sha, message, author_login, author_email,
                committed_at, url)
               VALUES ($1, $2, $3, $4, $5, $6, $7::text::timestamptz, $8)
               ON CONFLICT (github_repo_id, sha) DO NOTHING"#,
        )
        .bind(issue_id)
        .bind(github_repo_id)
        .bind(sha)
        .bind(message)
        .bind(author_login)
        .bind(author_email)
        .bind(timestamp)
        .bind(url)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ─── Issues Events (GitHub → Baaton) ──────────────────

async fn handle_issues_event(
    pool: &PgPool,
    event: &GitHubWebhookEvent,
) -> Result<(), anyhow::Error> {
    let action = event.action.as_deref().unwrap_or("");
    let payload = &event.payload;
    let repo = &payload["repository"];
    let github_repo_id = repo["id"].as_i64().unwrap_or(0);

    let mapping = sqlx::query_as::<_, GitHubRepoMapping>(
        "SELECT * FROM github_repo_mappings WHERE github_repo_id = $1 AND is_active = true",
    )
    .bind(github_repo_id)
    .fetch_optional(pool)
    .await?;

    let mapping = match mapping {
        Some(m) if m.sync_issues => m,
        _ => return Ok(()),
    };

    // Only process if sync direction allows GitHub → Baaton
    if mapping.sync_direction == "baaton_to_github" {
        return Ok(());
    }

    let issue = &payload["issue"];
    let github_issue_number = issue["number"].as_i64().unwrap_or(0) as i32;
    let github_issue_id = issue["id"].as_i64().unwrap_or(0);

    // Check if we already have a link for this GitHub issue
    let existing: Option<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT issue_id FROM github_issue_links WHERE github_repo_id = $1 AND github_issue_number = $2",
    )
    .bind(github_repo_id)
    .bind(github_issue_number)
    .fetch_optional(pool)
    .await?;

    match action {
        "closed" | "reopened" => {
            // Apply status mapping if we have a linked issue
            if let Some((issue_id,)) = existing {
                let mapping_key = match action {
                    "closed" => "issue_closed",
                    "reopened" => "issue_opened", // reopened → same as opened
                    _ => return Ok(()),
                };

                crate::github::status_mapper::apply_status_mapping(
                    pool,
                    issue_id,
                    &mapping.status_mapping,
                    mapping_key,
                    &format!("GitHub issue #{}", github_issue_number),
                )
                .await?;
            }
        }
        _ => {
            tracing::debug!(
                "Ignoring issues.{} for GH issue #{}",
                action,
                github_issue_number
            );
        }
    }

    Ok(())
}
