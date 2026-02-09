use std::time::Duration;
use sqlx::PgPool;

/// Start the background job processor.
///
/// Polls `github_sync_jobs` for pending jobs and `github_webhook_events`
/// for events that need retry. Runs forever as a tokio task.
pub async fn start_job_runner(pool: PgPool) {
    tracing::info!("GitHub sync job runner started");

    loop {
        // 1. Retry failed webhook events
        match retry_failed_events(&pool).await {
            Ok(count) if count > 0 => {
                tracing::debug!("Retried {} webhook events", count);
                continue; // Check for more immediately
            }
            Err(e) => {
                tracing::error!("Webhook retry error: {}", e);
            }
            _ => {}
        }

        // 2. Process sync jobs
        match process_next_job(&pool).await {
            Ok(true) => continue,
            Ok(false) => {
                // Nothing to do — sleep before next poll
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(e) => {
                tracing::error!("Job runner error: {}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// Retry webhook events that failed processing (status='pending', retry_count > 0).
async fn retry_failed_events(pool: &PgPool) -> Result<i64, anyhow::Error> {
    // Find events eligible for retry (pending with retry_count > 0, oldest first)
    let events: Vec<(String,)> = sqlx::query_as(
        r#"SELECT delivery_id FROM github_webhook_events
           WHERE status = 'pending' AND retry_count > 0
           ORDER BY created_at ASC
           LIMIT 5"#,
    )
    .fetch_all(pool)
    .await?;

    let count = events.len() as i64;

    for (delivery_id,) in events {
        if let Err(e) =
            crate::github::webhook_processor::process_webhook_event(pool, &delivery_id).await
        {
            tracing::warn!("Retry failed for event {}: {}", delivery_id, e);
        }
    }

    Ok(count)
}

/// Claim and process the next pending sync job.
///
/// Uses SELECT FOR UPDATE SKIP LOCKED for safe multi-instance operation.
async fn process_next_job(pool: &PgPool) -> Result<bool, anyhow::Error> {
    // Atomic claim
    let job: Option<(uuid::Uuid, String, serde_json::Value)> = sqlx::query_as(
        r#"UPDATE github_sync_jobs SET
            status = 'processing', started_at = now()
           WHERE id = (
               SELECT id FROM github_sync_jobs
               WHERE status = 'pending' AND scheduled_at <= now()
               ORDER BY priority DESC, scheduled_at ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
           )
           RETURNING id, job_type, payload"#,
    )
    .fetch_optional(pool)
    .await?;

    let (job_id, job_type, _payload) = match job {
        Some(j) => j,
        None => return Ok(false),
    };

    tracing::debug!(job_id = %job_id, job_type = %job_type, "Processing sync job");

    // For now, just mark as completed.
    // Full sync logic (sync_issue_to_github, etc.) will be implemented in Phase 6.
    let result: Result<(), anyhow::Error> = match job_type.as_str() {
        "sync_issue_to_github"
        | "sync_issue_from_github"
        | "sync_pr"
        | "sync_comment_to_github"
        | "sync_comment_from_github"
        | "sync_status"
        | "initial_import"
        | "full_resync" => {
            tracing::info!(
                "Sync job type '{}' queued but full sync engine not yet implemented",
                job_type
            );
            Ok(())
        }
        other => {
            tracing::warn!("Unknown job type: {}", other);
            Ok(())
        }
    };

    match result {
        Ok(()) => {
            sqlx::query(
                "UPDATE github_sync_jobs SET status = 'completed', completed_at = now() WHERE id = $1",
            )
            .bind(job_id)
            .execute(pool)
            .await?;
        }
        Err(e) => {
            // Increment retry, apply exponential backoff
            sqlx::query(
                r#"UPDATE github_sync_jobs SET
                    status = CASE WHEN retry_count + 1 >= max_retries THEN 'dead' ELSE 'pending' END,
                    last_error = $2,
                    retry_count = retry_count + 1,
                    scheduled_at = now() + (power(5, retry_count + 1) || ' seconds')::interval
                   WHERE id = $1"#,
            )
            .bind(job_id)
            .bind(e.to_string())
            .execute(pool)
            .await?;
        }
    }

    Ok(true)
}
