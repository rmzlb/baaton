use sqlx::PgPool;
use uuid::Uuid;

/// Apply a status mapping for a GitHub event.
///
/// Looks up `mapping_key` (e.g. "pr_opened", "pr_merged") in the mapping's
/// `status_mapping` JSON. If a non-null value is found, updates the Baaton
/// issue's status — but only if the sync lock has expired (anti-echo).
///
/// The `actor_name` is used for the activity log.
pub async fn apply_status_mapping(
    pool: &PgPool,
    issue_id: Uuid,
    status_mapping: &serde_json::Value,
    mapping_key: &str,
    _actor_name: &str,
) -> Result<(), anyhow::Error> {
    let new_status = match status_mapping.get(mapping_key) {
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => return Ok(()), // null or missing → don't change status
    };

    // Update issue status with sync lock to prevent echo loops.
    // Only update if there is no active sync lock (lock expired or never set).
    let result = sqlx::query(
        r#"UPDATE issues SET
            status = $2,
            sync_source = 'github',
            sync_lock_until = now() + interval '5 seconds',
            updated_at = now()
           WHERE id = $1
             AND (sync_lock_until IS NULL OR sync_lock_until < now())"#,
    )
    .bind(issue_id)
    .bind(&new_status)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        tracing::info!(
            issue_id = %issue_id,
            new_status = %new_status,
            mapping_key = %mapping_key,
            "Applied GitHub status mapping"
        );
    } else {
        tracing::debug!(
            issue_id = %issue_id,
            "Skipped status mapping (sync locked)"
        );
    }

    Ok(())
}
