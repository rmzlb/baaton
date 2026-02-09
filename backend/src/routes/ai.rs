use axum::{
    extract::Extension,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::middleware::AuthUser;

// ─── Request / Response Types ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub model: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContentResp>,
}

#[derive(Debug, Deserialize)]
struct GeminiContentResp {
    parts: Option<Vec<GeminiPartResp>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPartResp {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiError {
    message: String,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
}

// ─── Handler ──────────────────────────────────────────

pub async fn chat(
    Extension(_auth): Extension<AuthUser>, // Ensures user is authenticated
    Json(body): Json<ChatRequest>,
) -> Response {
    // Validate input
    if body.messages.is_empty() {
        return (StatusCode::BAD_REQUEST, r#"{"error":"messages must not be empty"}"#).into_response();
    }
    if body.messages.len() > 100 {
        return (StatusCode::BAD_REQUEST, r#"{"error":"too many messages (max 100)"}"#).into_response();
    }
    for msg in &body.messages {
        if msg.content.len() > 50_000 {
            return (StatusCode::BAD_REQUEST, r#"{"error":"message content too long (max 50000 chars)"}"#).into_response();
        }
    }

    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::error!("GEMINI_API_KEY not set");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                r#"{"error":"AI service not configured"}"#,
            )
                .into_response();
        }
    };

    let model = body.model.as_deref().unwrap_or("gemini-2.0-flash");

    // Convert messages to Gemini format
    let contents: Vec<GeminiContent> = body
        .messages
        .iter()
        .map(|m| GeminiContent {
            role: match m.role.as_str() {
                "assistant" => "model".to_string(),
                other => other.to_string(), // "user" stays "user"
            },
            parts: vec![GeminiPart {
                text: m.content.clone(),
            }],
        })
        .collect();

    let gemini_body = GeminiRequest { contents };

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let client = reqwest::Client::new();
    let resp = match client.post(&url).json(&gemini_body).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Gemini API request failed: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                r#"{"error":"Failed to reach AI service"}"#,
            )
                .into_response();
        }
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();
        tracing::error!("Gemini API error {}: {}", status, body_text);
        return (
            StatusCode::BAD_GATEWAY,
            format!(r#"{{"error":"AI service returned status {}"}}"#, status),
        )
            .into_response();
    }

    let gemini_resp: GeminiResponse = match resp.json().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to parse Gemini response: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                r#"{"error":"Invalid AI service response"}"#,
            )
                .into_response();
        }
    };

    if let Some(err) = gemini_resp.error {
        tracing::error!("Gemini API error: {}", err.message);
        return (
            StatusCode::BAD_GATEWAY,
            format!(r#"{{"error":"AI error: {}"}}"#, err.message),
        )
            .into_response();
    }

    let content = gemini_resp
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .unwrap_or_default();

    Json(ChatResponse {
        content,
        model: model.to_string(),
    })
    .into_response()
}
