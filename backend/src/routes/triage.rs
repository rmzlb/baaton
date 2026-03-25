use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(Debug, Serialize, Deserialize)]
pub struct TriageSuggestion {
    pub suggested_priority: Option<String>,
    pub suggested_tags: Vec<String>,
    pub suggested_assignee: Option<String>,
    pub similar_issues: Vec<SimilarIssue>,
    pub reasoning: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimilarIssue {
    pub id: String,
    pub display_id: String,
    pub title: String,
    pub similarity: String,
}

/// Internal helper: run triage analysis for a given issue. Returns TriageSuggestion.
pub async fn run_triage_analysis(
    pool: &PgPool,
    issue_id: Uuid,
    org_id: &str,
) -> Result<TriageSuggestion, String> {
    let issue = sqlx::query_as::<_, (String, Option<String>, Uuid)>(
        "SELECT title, description, project_id FROM issues WHERE id = $1 AND org_id = $2"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Issue not found".to_string())?;

    let (title, description, project_id) = issue;

    let recent_issues = sqlx::query_as::<_, (Uuid, String, String, String, String)>(
        "SELECT id, display_id, title, status, priority FROM issues WHERE project_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 30"
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let tags = sqlx::query_as::<_, (String,)>(
        "SELECT name FROM project_tags WHERE project_id = $1"
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let assignees = sqlx::query_as::<_, (String,)>(
        "SELECT DISTINCT unnest(assignee_ids) as uid FROM issues WHERE project_id = $1 AND assignee_ids != '{}' LIMIT 10"
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let recent_list = recent_issues.iter()
        .map(|(_, did, t, s, p)| format!("- {} [{}] (priority:{}) {}", did, s, p, t))
        .collect::<Vec<_>>()
        .join("\n");
    let tag_list = tags.iter().map(|(t,)| t.as_str()).collect::<Vec<_>>().join(", ");
    let assignee_list = assignees.iter().map(|(a,)| a.as_str()).collect::<Vec<_>>().join(", ");

    let prompt = format!(
        r#"You are a triage assistant. Analyze this issue and suggest priority, tags, and assignee.

ISSUE:
Title: {}
Description: {}

AVAILABLE TAGS: {}
AVAILABLE ASSIGNEES: {}

RECENT ISSUES:
{}

Respond ONLY with valid JSON:
{{
  "suggested_priority": "urgent|high|medium|low",
  "suggested_tags": ["tag1"],
  "suggested_assignee": null,
  "similar_issues": [],
  "reasoning": "Brief explanation"
}}"#,
        title,
        description.as_deref().unwrap_or("No description"),
        if tag_list.is_empty() { "none" } else { &tag_list },
        if assignee_list.is_empty() { "none" } else { &assignee_list },
        if recent_list.is_empty() { "none".to_string() } else { recent_list },
    );

    let api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err("GEMINI_API_KEY not set".to_string());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}", api_key))
        .json(&serde_json::json!({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500}
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = body["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("{}");
    let clean = text.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let mut suggestion: TriageSuggestion = serde_json::from_str(clean)
        .unwrap_or(TriageSuggestion {
            suggested_priority: Some("medium".into()),
            suggested_tags: vec![],
            suggested_assignee: None,
            similar_issues: vec![],
            reasoning: "AI parse failed".to_string(),
        });

    // Enrich similar issues with IDs
    suggestion.similar_issues = suggestion.similar_issues.iter()
        .filter_map(|sim| {
            recent_issues.iter().find(|(_, did, _, _, _)| did == &sim.display_id)
                .map(|found| SimilarIssue {
                    id: found.0.to_string(),
                    display_id: found.1.clone(),
                    title: found.2.clone(),
                    similarity: sim.similarity.clone(),
                })
        })
        .collect();

    Ok(suggestion)
}

/// POST /api/v1/issues/{id}/triage — AI-powered triage suggestions
pub async fn analyze(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<TriageSuggestion>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = run_triage_analysis(&pool, issue_id, org_id).await
        .map_err(|e| {
            if e == "Issue not found" {
                (StatusCode::NOT_FOUND, Json(json!({"error": e})))
            } else if e == "GEMINI_API_KEY not set" {
                (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "AI service not configured"})))
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e})))
            }
        })?;

    Ok(Json(ApiResponse::new(result)))
}
