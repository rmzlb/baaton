use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

/// POST /api/v1/public/{slug}/email-intake — Create issue from email
/// Public endpoint but requires matching project with email_intake_enabled
#[derive(Debug, Deserialize)]
pub struct EmailPayload {
    pub from_name: Option<String>,
    pub from_email: Option<String>,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub html: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EmailIntakeResponse {
    pub issue_id: String,
    pub display_id: String,
    pub title: String,
}

pub async fn intake(
    State(pool): State<PgPool>,
    Path(slug): Path<String>,
    Json(body): Json<EmailPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Find project by slug
    let project = sqlx::query_as::<_, (Uuid, String, String, i64)>(
        r#"SELECT id, org_id, prefix, 
           (SELECT COALESCE(MAX(issue_number), 0) FROM issues WHERE project_id = projects.id)
           FROM projects WHERE slug = $1"#,
    )
    .bind(&slug)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))))?;

    let (project_id, org_id, prefix, max_num) = project;

    // Generate title from subject or body
    let title = body.subject
        .as_deref()
        .filter(|s| !s.is_empty() && !s.starts_with("Re:") && !s.starts_with("Fwd:"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let text = body.body.as_deref().unwrap_or("No content");
            let first_line = text.lines().next().unwrap_or("Email issue");
            if first_line.len() > 100 {
                format!("{}...", &first_line[..97])
            } else {
                first_line.to_string()
            }
        });

    // Use body text for description, append sender info
    let mut desc = body.body.clone().unwrap_or_default();
    if let Some(name) = &body.from_name {
        desc = format!("**From:** {} {}\n\n{}", name, body.from_email.as_deref().unwrap_or(""), desc);
    }

    let issue_number = max_num + 1;
    let display_id = format!("{}-{}", prefix, issue_number);

    // Create issue
    let issue_id: (Uuid,) = sqlx::query_as(
        r#"INSERT INTO issues (project_id, org_id, title, description, status, priority, issue_type, issue_number, display_id, source)
           VALUES ($1, $2, $3, $4, 'backlog', 'medium', 'question', $5, $6, 'email')
           RETURNING id"#,
    )
    .bind(project_id)
    .bind(&org_id)
    .bind(&title)
    .bind(&desc)
    .bind(issue_number as i32)
    .bind(&display_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(json!({
        "data": {
            "issue_id": issue_id.0.to_string(),
            "display_id": display_id,
            "title": title,
        }
    })))
}
