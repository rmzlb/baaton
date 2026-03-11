use axum::{
    extract::{Extension, Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::Issue;

const MAX_IMPORT: usize = 500;

// ─── Export ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExportParams {
    pub format: Option<String>, // "csv" | "json"
}

/// Escape a CSV field: wrap in quotes if it contains comma, quote, or newline
fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn issue_to_csv_row(issue: &Issue) -> String {
    let assignees = issue.assignee_ids.join(";");
    let tags = issue.tags.join(";");
    let due_date = issue.due_date.map(|d| d.to_string()).unwrap_or_default();
    let estimate = issue.estimate.map(|e| e.to_string()).unwrap_or_default();
    let desc = issue.description.as_deref().unwrap_or("");

    [
        csv_escape(&issue.display_id),
        csv_escape(&issue.title),
        csv_escape(desc),
        csv_escape(&issue.status),
        csv_escape(issue.priority.as_deref().unwrap_or("")),
        csv_escape(&issue.issue_type),
        csv_escape(&assignees),
        csv_escape(&tags),
        csv_escape(&due_date),
        csv_escape(&estimate),
        csv_escape(&issue.created_at.to_rfc3339()),
    ]
    .join(",")
}

const CSV_HEADER: &str =
    "display_id,title,description,status,priority,issue_type,assignee_ids,tags,due_date,estimate,created_at";

/// GET /projects/{id}/export?format=csv|json
pub async fn export(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<ExportParams>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
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

    let issues = sqlx::query_as::<_, Issue>(
        "SELECT * FROM issues WHERE project_id = $1 ORDER BY created_at ASC"
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let format = params.format.as_deref().unwrap_or("json");

    match format {
        "csv" => {
            let mut lines = vec![CSV_HEADER.to_string()];
            for issue in &issues {
                lines.push(issue_to_csv_row(issue));
            }
            let body = lines.join("\n");
            let filename = format!("issues-{}.csv", project_id);

            Ok((
                [
                    (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
                    (header::CONTENT_DISPOSITION, Box::leak(
                        format!("attachment; filename=\"{}\"", filename).into_boxed_str()
                    )),
                ],
                body,
            ).into_response())
        }
        "json" => {
            Ok(Json(json!({ "data": issues })).into_response())
        }
        _ => {
            Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid format. Use csv or json"}))))
        }
    }
}

// ─── Import ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ImportBody {
    pub issues: Vec<ImportIssue>,
}

#[derive(Debug, Deserialize)]
pub struct ImportIssue {
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct ImportError {
    pub index: usize,
    pub error: String,
}

/// POST /projects/{id}/import — bulk import issues from JSON
pub async fn import(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<ImportBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.issues.len() > MAX_IMPORT {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Too many issues. Maximum is {}", MAX_IMPORT) })),
        ));
    }

    // Verify project + get prefix and valid statuses
    #[derive(sqlx::FromRow)]
    struct ProjectMeta {
        prefix: String,
        statuses: serde_json::Value,
    }

    let project = sqlx::query_as::<_, ProjectMeta>(
        "SELECT prefix, statuses FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    let valid_statuses: Vec<String> = project.statuses
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|s| s.get("key").and_then(|k| k.as_str()).map(|k| k.to_string()))
        .collect();

    const VALID_PRIORITIES: &[&str] = &["urgent", "high", "medium", "low"];
    let default_status = valid_statuses.first().cloned().unwrap_or_else(|| "backlog".to_string());
    let created_by_name = auth.created_by_label();
    let created_by_id = auth.user_id.clone();

    let mut imported = 0usize;
    let mut errors: Vec<ImportError> = vec![];

    for (i, issue) in body.issues.iter().enumerate() {
        // Validate
        if issue.title.trim().is_empty() {
            errors.push(ImportError { index: i, error: "title is required".to_string() });
            continue;
        }

        let status = issue.status.as_deref().unwrap_or(&default_status);
        if !valid_statuses.iter().any(|s| s == status) {
            errors.push(ImportError {
                index: i,
                error: format!("invalid status '{}'. Valid: {}", status, valid_statuses.join(", ")),
            });
            continue;
        }

        if let Some(ref p) = issue.priority {
            if !VALID_PRIORITIES.contains(&p.as_str()) {
                errors.push(ImportError {
                    index: i,
                    error: format!("invalid priority '{}'. Valid: urgent, high, medium, low", p),
                });
                continue;
            }
        }

        // Generate display_id
        let next_number: (i64,) = sqlx::query_as(
            r#"
            SELECT COALESCE(MAX((SPLIT_PART(display_id, '-', 2))::bigint), 0) + 1
            FROM issues
            WHERE project_id = $1
              AND display_id ~ ('^' || $2 || '-[0-9]+$')
            "#,
        )
        .bind(project_id)
        .bind(&project.prefix)
        .fetch_one(&pool)
        .await
        .unwrap_or((1i64,));

        let display_id = format!("{}-{}", project.prefix, next_number.0);

        // Max position for this status
        let max_pos: Option<f64> = sqlx::query_scalar(
            "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = $2"
        )
        .bind(project_id)
        .bind(status)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
        let position = max_pos.map(|p| p + 1000.0).unwrap_or(1000.0);

        let tags: Vec<String> = issue.tags.clone().unwrap_or_default();

        let result = sqlx::query(
            r#"
            INSERT INTO issues (
                project_id, display_id, title, description, status, priority,
                type, source, assignee_ids, tags, attachments, category,
                position, created_by_id, created_by_name
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'feature', 'api', '{}', $7, '[]', '{}',
                $8, $9, $10
            )
            "#,
        )
        .bind(project_id)
        .bind(&display_id)
        .bind(issue.title.trim())
        .bind(&issue.description)
        .bind(status)
        .bind(issue.priority.as_deref())
        .bind(&tags)
        .bind(position)
        .bind(&created_by_id)
        .bind(&created_by_name)
        .execute(&pool)
        .await;

        match result {
            Ok(_) => imported += 1,
            Err(e) => {
                errors.push(ImportError { index: i, error: e.to_string() });
            }
        }
    }

    Ok(Json(json!({
        "data": {
            "imported": imported,
            "errors": errors
        }
    })))
}
