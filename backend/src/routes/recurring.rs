use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, RecurrenceRule};
use crate::routes::activity::log_activity;

// ─── Request types ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateRecurrenceRule {
    pub title_template: String,
    pub description: Option<String>,
    pub assignee_ids: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub priority: Option<String>,
    pub issue_type: Option<String>,
    pub rrule: String,
    pub next_run_at: DateTime<Utc>,
    pub end_date: Option<chrono::NaiveDate>,
    pub max_occurrences: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRecurrenceRule {
    pub title_template: Option<String>,
    pub description: Option<String>,
    pub assignee_ids: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub priority: Option<String>,
    pub issue_type: Option<String>,
    pub rrule: Option<String>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub paused: Option<bool>,
    pub end_date: Option<chrono::NaiveDate>,
    pub max_occurrences: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct TriggerResult {
    pub issue_id: Uuid,
    pub display_id: String,
    pub title: String,
    pub next_run_at: DateTime<Utc>,
}

// ─── rrule helpers ────────────────────────────────────

/// Parse FREQ and INTERVAL from a simple rrule string.
/// E.g. "FREQ=WEEKLY;INTERVAL=2" → (weekly, 2)
/// Falls back to weekly/1 for unknown formats.
fn next_run_from_rrule(rrule: &str, from: DateTime<Utc>) -> DateTime<Utc> {
    let upper = rrule.to_uppercase();
    let interval: i64 = upper
        .split(';')
        .find_map(|part| {
            let part = part.trim();
            if part.starts_with("INTERVAL=") {
                part["INTERVAL=".len()..].parse().ok()
            } else {
                None
            }
        })
        .unwrap_or(1)
        .max(1);

    let freq = upper
        .split(';')
        .find_map(|part| {
            let part = part.trim();
            if part.starts_with("FREQ=") {
                Some(part["FREQ=".len()..].to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "WEEKLY".to_string());

    match freq.as_str() {
        "DAILY" => from + chrono::Duration::days(interval),
        "WEEKLY" => from + chrono::Duration::weeks(interval),
        "MONTHLY" => {
            // Advance by N months (roughly 30 days each)
            from + chrono::Duration::days(30 * interval)
        }
        "YEARLY" => from + chrono::Duration::days(365 * interval),
        _ => from + chrono::Duration::weeks(interval),
    }
}

/// Expand title template: {date} → YYYY-MM-DD, {week} → ISO week number, {count} → occurrence_count+1
fn expand_title(template: &str, occurrence_count: i32) -> String {
    let now = Utc::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let week_str = now.iso_week().week().to_string();
    let count_str = (occurrence_count + 1).to_string();

    template
        .replace("{date}", &date_str)
        .replace("{week}", &week_str)
        .replace("{count}", &count_str)
}

// ─── GET /projects/{id}/recurring ────────────────────

pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<RecurrenceRule>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let rules = sqlx::query_as::<_, RecurrenceRule>(
        "SELECT * FROM recurrence_rules WHERE project_id = $1 AND org_id = $2 ORDER BY created_at DESC"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(rules)))
}

// ─── POST /projects/{id}/recurring ───────────────────

pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateRecurrenceRule>,
) -> Result<Json<ApiResponse<RecurrenceRule>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.title_template.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "title_template is required"}))));
    }
    if body.rrule.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "rrule is required"}))));
    }

    let project_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !project_exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    let rule = sqlx::query_as::<_, RecurrenceRule>(
        r#"
        INSERT INTO recurrence_rules (
            project_id, org_id, title_template, description,
            assignee_ids, tags, priority, issue_type,
            rrule, next_run_at, end_date, max_occurrences, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.title_template)
    .bind(&body.description)
    .bind(&body.assignee_ids.unwrap_or_default())
    .bind(&body.tags.unwrap_or_default())
    .bind(body.priority.as_deref().unwrap_or("medium"))
    .bind(body.issue_type.as_deref().unwrap_or("feature"))
    .bind(&body.rrule)
    .bind(body.next_run_at)
    .bind(body.end_date)
    .bind(body.max_occurrences)
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(rule)))
}

// ─── PATCH /recurring/{id} ───────────────────────────

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(rule_id): Path<Uuid>,
    Json(body): Json<UpdateRecurrenceRule>,
) -> Result<Json<ApiResponse<RecurrenceRule>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let rule = sqlx::query_as::<_, RecurrenceRule>(
        r#"
        UPDATE recurrence_rules SET
            title_template  = COALESCE($2, title_template),
            description     = COALESCE($3, description),
            assignee_ids    = COALESCE($4, assignee_ids),
            tags            = COALESCE($5, tags),
            priority        = COALESCE($6, priority),
            issue_type      = COALESCE($7, issue_type),
            rrule           = COALESCE($8, rrule),
            next_run_at     = COALESCE($9, next_run_at),
            paused          = COALESCE($10, paused),
            end_date        = COALESCE($11, end_date),
            max_occurrences = COALESCE($12, max_occurrences)
        WHERE id = $1 AND org_id = $13
        RETURNING *
        "#,
    )
    .bind(rule_id)
    .bind(&body.title_template)
    .bind(&body.description)
    .bind(&body.assignee_ids)
    .bind(&body.tags)
    .bind(&body.priority)
    .bind(&body.issue_type)
    .bind(&body.rrule)
    .bind(body.next_run_at)
    .bind(body.paused)
    .bind(body.end_date)
    .bind(body.max_occurrences)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Recurrence rule not found"}))))?;

    Ok(Json(ApiResponse::new(rule)))
}

// ─── DELETE /recurring/{id} ──────────────────────────

pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(rule_id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM recurrence_rules WHERE id = $1 AND org_id = $2"
    )
    .bind(rule_id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Recurrence rule not found"}))));
    }

    Ok(Json(ApiResponse::new(())))
}

// ─── POST /recurring/{id}/trigger ────────────────────

pub async fn trigger(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(rule_id): Path<Uuid>,
) -> Result<Json<ApiResponse<TriggerResult>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Fetch the recurrence rule
    let rule = sqlx::query_as::<_, RecurrenceRule>(
        "SELECT * FROM recurrence_rules WHERE id = $1 AND org_id = $2"
    )
    .bind(rule_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Recurrence rule not found"}))))?;

    // Check if max_occurrences reached
    if let Some(max) = rule.max_occurrences {
        if rule.occurrence_count >= max {
            return Err((StatusCode::CONFLICT, Json(json!({"error": "Max occurrences reached"}))));
        }
    }

    // Get project prefix for display_id generation
    let project_prefix: Option<String> = sqlx::query_scalar(
        "SELECT prefix FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(rule.project_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let prefix = project_prefix
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    let title = expand_title(&rule.title_template, rule.occurrence_count);
    let next_run_at = next_run_from_rrule(&rule.rrule, rule.next_run_at);

    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Generate display_id
    let next_number: (i64,) = sqlx::query_as(
        r#"
        SELECT COALESCE(MAX((SPLIT_PART(display_id, '-', 2))::bigint), 0) + 1
        FROM issues
        WHERE project_id = $1
          AND display_id ~ ('^' || $2 || '-[0-9]+$')
        "#,
    )
    .bind(rule.project_id)
    .bind(&prefix)
    .fetch_one(tx.as_mut())
    .await
    .unwrap_or((1i64,));

    let display_id = format!("{}-{}", prefix, next_number.0);

    // Get max position for backlog
    let max_pos: Option<(Option<f64>,)> = sqlx::query_as(
        "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = 'backlog'"
    )
    .bind(rule.project_id)
    .fetch_optional(tx.as_mut())
    .await
    .unwrap_or(None);

    let position = max_pos.and_then(|p| p.0).map(|p| p + 1000.0).unwrap_or(1000.0);

    // Create the issue
    #[derive(sqlx::FromRow)]
    struct CreatedIssue {
        id: Uuid,
        display_id: String,
        title: String,
    }

    let created = sqlx::query_as::<_, CreatedIssue>(
        r#"
        INSERT INTO issues (
            project_id, display_id, title, description, type, status,
            priority, assignee_ids, tags, position, source, created_by_id
        )
        VALUES ($1, $2, $3, $4, $5, 'backlog', $6, $7, $8, $9, 'recurring', $10)
        RETURNING id, display_id, title
        "#,
    )
    .bind(rule.project_id)
    .bind(&display_id)
    .bind(&title)
    .bind(&rule.description)
    .bind(&rule.issue_type)
    .bind(&rule.priority)
    .bind(&rule.assignee_ids)
    .bind(&rule.tags)
    .bind(position)
    .bind(&auth.user_id)
    .fetch_one(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Update recurrence rule: increment count + advance next_run_at
    sqlx::query(
        "UPDATE recurrence_rules SET occurrence_count = occurrence_count + 1, next_run_at = $2 WHERE id = $1"
    )
    .bind(rule_id)
    .bind(next_run_at)
    .execute(tx.as_mut())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Activity log (fire-and-forget)
    {
        let pool2 = pool.clone();
        let uid = auth.user_id.clone();
        let uname = auth.display_name.clone();
        let oid = org_id.to_string();
        let pid = rule.project_id;
        let iid = created.id;
        tokio::spawn(async move {
            log_activity(
                &pool2, &oid, Some(pid), Some(iid),
                &uid, uname.as_deref(),
                "issue_created", None, None, None,
                Some(json!({"source": "recurring", "rule_id": rule_id.to_string()})),
            ).await;
        });
    }

    Ok(Json(ApiResponse::new(TriggerResult {
        issue_id: created.id,
        display_id: created.display_id,
        title: created.title,
        next_run_at,
    })))
}
