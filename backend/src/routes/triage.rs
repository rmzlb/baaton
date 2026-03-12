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

/// POST /api/v1/issues/{id}/triage — AI-powered triage suggestions
pub async fn analyze(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> Result<Json<ApiResponse<TriageSuggestion>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Get the issue to analyze
    let issue = sqlx::query_as::<_, (String, Option<String>, Uuid)>(
        "SELECT title, description, project_id FROM issues WHERE id = $1 AND org_id = $2"
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, Json(json!({"error": "Issue not found"}))))?;

    let (title, description, project_id) = issue;

    // Get recent issues for similarity context
    let recent_issues = sqlx::query_as::<_, (Uuid, String, String, String, String)>(
        "SELECT id, display_id, title, status, priority FROM issues WHERE project_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 30"
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Get available tags
    let tags = sqlx::query_as::<_, (String,)>(
        "SELECT name FROM project_tags WHERE project_id = $1"
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Get available assignees (unique from recent issues)
    let assignees = sqlx::query_as::<_, (String,)>(
        "SELECT DISTINCT unnest(assignee_ids) as uid FROM issues WHERE project_id = $1 AND assignee_ids != '{}' LIMIT 10"
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Build prompt
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

RECENT ISSUES (for similarity detection):
{}

Respond ONLY with valid JSON (no markdown, no code blocks):
{{
  "suggested_priority": "urgent|high|medium|low",
  "suggested_tags": ["tag1"],
  "suggested_assignee": "user_id or null",
  "similar_issues": [{{ "display_id": "XXX-1", "similarity": "high|medium|low" }}],
  "reasoning": "Brief explanation"
}}"#,
        title,
        description.as_deref().unwrap_or("No description"),
        if tag_list.is_empty() { "none" } else { &tag_list },
        if assignee_list.is_empty() { "none" } else { &assignee_list },
        if recent_list.is_empty() { "none".to_string() } else { recent_list },
    );

    // Call Gemini API
    let api_key = std::env::var("GEMINI_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "AI service not configured"}))));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}", api_key))
        .json(&json!({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500}
        }))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, Json(json!({"error": format!("AI request failed: {}", e)}))))?;

    let body: serde_json::Value = resp.json().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, Json(json!({"error": format!("AI response parse failed: {}", e)}))))?;

    // Extract text from Gemini response
    let text = body["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("{}");

    // Clean JSON (remove markdown code blocks if present)
    let clean = text.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let suggestion: TriageSuggestion = serde_json::from_str(clean)
        .unwrap_or(TriageSuggestion {
            suggested_priority: Some("medium".into()),
            suggested_tags: vec![],
            suggested_assignee: None,
            similar_issues: vec![],
            reasoning: format!("AI parsing failed. Raw: {}", &clean[..clean.len().min(200)]),
        });

    // Map similar_issues to include actual IDs
    let mut enriched_similar = Vec::new();
    for sim in &suggestion.similar_issues {
        if let Some(found) = recent_issues.iter().find(|(_, did, _, _, _)| did == &sim.display_id) {
            enriched_similar.push(SimilarIssue {
                id: found.0.to_string(),
                display_id: found.1.clone(),
                title: found.2.clone(),
                similarity: sim.similarity.clone(),
            });
        }
    }

    let result = TriageSuggestion {
        similar_issues: enriched_similar,
        ..suggestion
    };

    Ok(Json(ApiResponse::new(result)))
}
