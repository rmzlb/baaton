use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Issue};

// ─── Structs ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AutomationRule {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub name: String,
    pub trigger: String,
    pub conditions: serde_json::Value,
    pub actions: serde_json::Value,
    pub enabled: bool,
    pub priority: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAutomationRule {
    pub name: String,
    pub trigger: String,
    pub conditions: Option<serde_json::Value>,
    pub actions: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    pub priority: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAutomationRule {
    pub name: Option<String>,
    pub trigger: Option<String>,
    pub conditions: Option<serde_json::Value>,
    pub actions: Option<serde_json::Value>,
    pub enabled: Option<bool>,
    pub priority: Option<i32>,
}

const VALID_TRIGGERS: &[&str] = &[
    "issue_created",
    "status_changed",
    "priority_changed",
    "assignee_changed",
    "label_added",
    "comment_added",
    "due_date_passed",
];

// ─── Routes ──────────────────────────────────────────

/// GET /projects/{id}/automations
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<AutomationRule>>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let rules = sqlx::query_as::<_, AutomationRule>(
        r#"
        SELECT * FROM automation_rules
        WHERE project_id = $1 AND org_id = $2
        ORDER BY priority ASC, created_at ASC
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Ok(Json(ApiResponse::new(rules)))
}

/// POST /projects/{id}/automations
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateAutomationRule>,
) -> Result<Json<ApiResponse<AutomationRule>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if !VALID_TRIGGERS.contains(&body.trigger.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Invalid trigger '{}'. Accepted: {}", body.trigger, VALID_TRIGGERS.join(", ")),
            "accepted_values": VALID_TRIGGERS,
        }))));
    }

    // Plan quota check
    crate::middleware::plan_guard::enforce_quota(
        &pool, org_id, &auth.user_id, crate::middleware::plan_guard::QuotaKind::Automations
    ).await?;

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

    let rule = sqlx::query_as::<_, AutomationRule>(
        r#"
        INSERT INTO automation_rules (project_id, org_id, name, trigger, conditions, actions, enabled, priority)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.name)
    .bind(&body.trigger)
    .bind(body.conditions.unwrap_or_else(|| json!([])))
    .bind(body.actions.unwrap_or_else(|| json!([])))
    .bind(body.enabled.unwrap_or(true))
    .bind(body.priority.unwrap_or(0))
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(rule)))
}

/// PATCH /automations/{id}
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateAutomationRule>,
) -> Result<Json<ApiResponse<AutomationRule>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if let Some(ref trigger) = body.trigger {
        if !VALID_TRIGGERS.contains(&trigger.as_str()) {
            return Err((StatusCode::BAD_REQUEST, Json(json!({
                "error": format!("Invalid trigger '{}'", trigger),
                "accepted_values": VALID_TRIGGERS,
            }))));
        }
    }

    let rule = sqlx::query_as::<_, AutomationRule>(
        r#"
        UPDATE automation_rules SET
            name       = COALESCE($2, name),
            trigger    = COALESCE($3, trigger),
            conditions = COALESCE($4, conditions),
            actions    = COALESCE($5, actions),
            enabled    = COALESCE($6, enabled),
            priority   = COALESCE($7, priority)
        WHERE id = $1 AND org_id = $8
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.trigger)
    .bind(&body.conditions)
    .bind(&body.actions)
    .bind(body.enabled)
    .bind(body.priority)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Automation rule not found"}))))?;

    Ok(Json(ApiResponse::new(rule)))
}

/// DELETE /automations/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM automation_rules WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Automation rule not found"}))))
    }
}

// ─── Internal: Evaluate Automations ──────────────────

fn check_condition(condition: &serde_json::Value, issue: &Issue) -> bool {
    let field = condition.get("field").and_then(|v| v.as_str()).unwrap_or("");
    let op = condition.get("op").and_then(|v| v.as_str()).unwrap_or("eq");
    let value = condition.get("value").and_then(|v| v.as_str()).unwrap_or("");

    let issue_value: String = match field {
        "priority" => issue.priority.clone().unwrap_or_default(),
        "status"   => issue.status.clone(),
        "type"     => issue.issue_type.clone(),
        "assignee" => issue.assignee_ids.join(","),
        _          => String::new(),
    };

    match op {
        "eq"       => issue_value == value,
        "neq"      => issue_value != value,
        "contains" => issue_value.contains(value),
        _          => false,
    }
}

/// Evaluate automation rules for a given trigger event and apply matching actions.
/// max_depth controls recursion depth to prevent infinite loops (default: 3).
pub async fn evaluate_automations(
    pool: &PgPool,
    org_id: &str,
    project_id: Uuid,
    trigger: &str,
    issue: &Issue,
    max_depth: u8,
) {
    if max_depth == 0 {
        return;
    }

    let rules = sqlx::query_as::<_, AutomationRule>(
        r#"
        SELECT * FROM automation_rules
        WHERE project_id = $1 AND org_id = $2 AND enabled = true AND trigger = $3
        ORDER BY priority ASC
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(trigger)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for rule in rules {
        let conditions = rule.conditions.as_array().cloned().unwrap_or_default();
        // All conditions must match (AND logic)
        let all_match = conditions.is_empty() || conditions.iter().all(|c| check_condition(c, issue));

        if !all_match {
            continue;
        }

        let actions = rule.actions.as_array().cloned().unwrap_or_default();
        for action in &actions {
            let action_type  = action.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let action_value = action.get("value").and_then(|v| v.as_str()).unwrap_or("");

            match action_type {
                "set_status" => {
                    let _ = sqlx::query(
                        "UPDATE issues SET status = $1, updated_at = now() WHERE id = $2"
                    )
                    .bind(action_value)
                    .bind(issue.id)
                    .execute(pool)
                    .await;
                }
                "set_priority" => {
                    let _ = sqlx::query(
                        "UPDATE issues SET priority = $1, updated_at = now() WHERE id = $2"
                    )
                    .bind(action_value)
                    .bind(issue.id)
                    .execute(pool)
                    .await;
                }
                "assign" => {
                    let _ = sqlx::query(
                        r#"
                        UPDATE issues
                        SET assignee_ids = array_append(assignee_ids, $1), updated_at = now()
                        WHERE id = $2 AND NOT ($1 = ANY(assignee_ids))
                        "#,
                    )
                    .bind(action_value)
                    .bind(issue.id)
                    .execute(pool)
                    .await;
                }
                "add_tag" => {
                    let _ = sqlx::query(
                        r#"
                        UPDATE issues
                        SET tags = array_append(tags, $1), updated_at = now()
                        WHERE id = $2 AND NOT ($1 = ANY(tags))
                        "#,
                    )
                    .bind(action_value)
                    .bind(issue.id)
                    .execute(pool)
                    .await;
                }
                _ => {
                    tracing::warn!(
                        rule_id = %rule.id,
                        action_type = %action_type,
                        "automations: unknown action type, skipping"
                    );
                }
            }
        }
    }
}
