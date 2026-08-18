use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SlaRule {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub priority: String,
    pub deadline_hours: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSlaRule {
    pub priority: String,
    pub deadline_hours: i32,
}

#[derive(Debug, Serialize)]
pub struct SlaStats {
    pub total: i64,
    pub on_time: i64,
    pub breached: i64,
    pub achievement_pct: f64,
}

// ─── SLA clock ────────────────────────────────────────
//
// The SLA measures time where the ball is in OUR court, not wall-clock since
// creation. Same semantics as Zendesk "requester wait time" (pauses while
// waiting on the requester and, on reopen, resumes the same target with the
// elapsed time preserved) and Linear's behaviour on "needs info" states.
//
// See migration 069 for the storage rationale.

/// Default budget when the project has no `sla_rules` row for that priority.
/// Mirrors the values the UI has been displaying all along.
fn default_budget_hours(priority: &str) -> i32 {
    match priority {
        "urgent" => 24,
        "high" => 48,
        _ => 120,
    }
}

/// Whether the SLA clock ticks in this status.
///
/// `in_review` pauses: the work is done and the requester has to validate it,
/// so burning budget there penalises us for someone else's latency. Terminal
/// states stop it. `status_category` is checked first, so projects with custom
/// status labels behave correctly without hardcoding their names.
pub fn clock_runs(status: &str, status_category: Option<&str>) -> bool {
    if matches!(status_category, Some("completed") | Some("canceled")) {
        return false;
    }
    let normalized = status.trim().to_lowercase().replace(' ', "_");
    !matches!(
        normalized.as_str(),
        "in_review" | "done" | "cancelled" | "canceled"
    )
}

/// Remaining budget and breach state for a clock, in milliseconds.
///
/// Split out from the DB round-trip so the arithmetic is unit-testable.
pub fn settle_clock(
    elapsed_ms: i64,
    open_segment_ms: i64,
    budget_ms: i64,
) -> (i64, i64, bool) {
    let total = elapsed_ms + open_segment_ms.max(0);
    let remaining = (budget_ms - total).max(0);
    (total, remaining, total > budget_ms)
}

/// Recompute the SLA clock after a create, status change or priority change.
///
/// Closes the open running segment into `sla_elapsed_ms`, then reopens it only
/// if the new status is a running one. `sla_deadline` is derived from the
/// remaining budget so it stays directly comparable to `now()`, and is NULL
/// while paused or stopped. `sla_breached` is sticky: once the budget is blown
/// it stays failed even if the issue is later completed, so achievement stats
/// cannot silently repair themselves.
pub async fn recompute_sla(pool: &PgPool, issue_id: Uuid) {
    if let Err(e) = recompute_sla_inner(pool, issue_id).await {
        tracing::error!(error = %e, issue_id = %issue_id, "sla.recompute failed");
    }
}

type ClockRow = (
    String,
    Option<String>,
    Option<String>,
    i64,
    Option<DateTime<Utc>>,
    Option<i32>,
);

async fn recompute_sla_inner(pool: &PgPool, issue_id: Uuid) -> Result<(), sqlx::Error> {
    let row: Option<ClockRow> = sqlx::query_as(
        r#"
        SELECT i.status,
               i.status_category,
               i.priority,
               i.sla_elapsed_ms,
               i.sla_clock_started_at,
               r.deadline_hours
        FROM issues i
        LEFT JOIN sla_rules r
               ON r.project_id = i.project_id
              AND r.priority = i.priority
        WHERE i.id = $1
        "#,
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await?;

    let Some((status, status_category, priority, elapsed_ms, clock_started_at, rule_hours)) = row
    else {
        return Ok(());
    };

    let now = Utc::now();
    let open_segment_ms = clock_started_at
        .map(|started| (now - started).num_milliseconds())
        .unwrap_or(0);

    // No priority means no commitment: clear the deadline but keep accumulating,
    // so setting a priority later does not forget the time already spent.
    let Some(priority) = priority else {
        let total = elapsed_ms + open_segment_ms.max(0);
        let running = clock_runs(&status, status_category.as_deref());
        sqlx::query(
            r#"
            UPDATE issues SET
                sla_elapsed_ms       = $2,
                sla_clock_started_at = CASE WHEN $3::boolean THEN $4 ELSE NULL END,
                sla_deadline         = NULL,
                sla_breached         = false
            WHERE id = $1
            "#,
        )
        .bind(issue_id)
        .bind(total)
        .bind(running)
        .bind(now)
        .execute(pool)
        .await?;
        return Ok(());
    };

    let budget_ms =
        rule_hours.unwrap_or_else(|| default_budget_hours(&priority)) as i64 * 3_600_000;
    let (total_elapsed_ms, remaining_ms, breached) =
        settle_clock(elapsed_ms, open_segment_ms, budget_ms);

    let running = clock_runs(&status, status_category.as_deref());
    let new_clock_started_at = if running { Some(now) } else { None };
    let new_deadline = if running {
        Some(now + chrono::Duration::milliseconds(remaining_ms))
    } else {
        None
    };

    sqlx::query(
        r#"
        UPDATE issues SET
            sla_elapsed_ms       = $2,
            sla_clock_started_at = $3,
            sla_deadline         = $4,
            sla_breached         = (COALESCE(sla_breached, false) OR $5::boolean)
        WHERE id = $1
        "#,
    )
    .bind(issue_id)
    .bind(total_elapsed_ms)
    .bind(new_clock_started_at)
    .bind(new_deadline)
    .bind(breached)
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 3_600_000;

    #[test]
    fn in_review_pauses_the_clock() {
        assert!(!clock_runs("in_review", Some("started")));
        // Legacy label casing from before migrations 066/067.
        assert!(!clock_runs("In Review", Some("started")));
    }

    #[test]
    fn active_and_reopened_statuses_run() {
        assert!(clock_runs("in_progress", Some("started")));
        assert!(clock_runs("not_ok", Some("started")));
        assert!(clock_runs("backlog", Some("backlog")));
        assert!(clock_runs("todo", Some("unstarted")));
    }

    #[test]
    fn terminal_statuses_stop_the_clock() {
        assert!(!clock_runs("done", Some("completed")));
        assert!(!clock_runs("cancelled", Some("canceled")));
        // Custom project statuses are honoured via status_category.
        assert!(!clock_runs("shipped_to_client", Some("completed")));
        assert!(!clock_runs("wont_fix", Some("canceled")));
    }

    #[test]
    fn reopen_resumes_instead_of_resetting() {
        // 20h burned before review, then 50h of review time that must not count.
        let (total, remaining, breached) = settle_clock(20 * HOUR, 0, 24 * HOUR);
        assert_eq!(total, 20 * HOUR);
        assert_eq!(remaining, 4 * HOUR, "resumes with the leftover budget");
        assert!(!breached);
    }

    #[test]
    fn open_segment_is_folded_into_elapsed() {
        let (total, remaining, breached) = settle_clock(10 * HOUR, 5 * HOUR, 24 * HOUR);
        assert_eq!(total, 15 * HOUR);
        assert_eq!(remaining, 9 * HOUR);
        assert!(!breached);
    }

    #[test]
    fn breach_is_detected_and_remaining_floors_at_zero() {
        let (total, remaining, breached) = settle_clock(30 * HOUR, 0, 24 * HOUR);
        assert_eq!(total, 30 * HOUR);
        assert_eq!(remaining, 0, "never yields a deadline in the past");
        assert!(breached);
    }

    #[test]
    fn negative_clock_skew_does_not_credit_budget() {
        let (total, _, _) = settle_clock(10 * HOUR, -3 * HOUR, 24 * HOUR);
        assert_eq!(total, 10 * HOUR);
    }

    #[test]
    fn default_budgets_match_the_ui() {
        assert_eq!(default_budget_hours("urgent"), 24);
        assert_eq!(default_budget_hours("high"), 48);
        assert_eq!(default_budget_hours("medium"), 120);
        assert_eq!(default_budget_hours("low"), 120);
    }
}

// ─── Routes ──────────────────────────────────────────

/// GET /projects/{id}/sla-rules
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<SlaRule>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let rules = sqlx::query_as::<_, SlaRule>(
        "SELECT * FROM sla_rules WHERE project_id = $1 AND org_id = $2 ORDER BY created_at ASC"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(rules)))
}

/// POST /projects/{id}/sla-rules
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateSlaRule>,
) -> Result<Json<ApiResponse<SlaRule>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let rule = sqlx::query_as::<_, SlaRule>(
        r#"
        INSERT INTO sla_rules (project_id, org_id, priority, deadline_hours)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, priority) DO UPDATE
            SET deadline_hours = EXCLUDED.deadline_hours
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.priority)
    .bind(body.deadline_hours)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(rule)))
}

/// DELETE /sla-rules/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM sla_rules WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "SLA rule not found"}))))
    }
}

/// GET /projects/{id}/sla-stats
pub async fn stats(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<SlaStats>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let row: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            count(*) as total,
            count(*) FILTER (WHERE sla_breached = false AND sla_deadline IS NOT NULL) as on_time,
            count(*) FILTER (WHERE sla_breached = true) as breached
        FROM issues
        WHERE project_id = $1 AND sla_deadline IS NOT NULL
        "#,
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let (total, on_time, breached) = row;
    let achievement_pct = if total > 0 {
        (on_time as f64 / total as f64) * 100.0
    } else {
        100.0
    };

    Ok(Json(ApiResponse::new(SlaStats {
        total,
        on_time,
        breached,
        achievement_pct,
    })))
}
