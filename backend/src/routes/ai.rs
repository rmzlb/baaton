use axum::{
    extract::Extension,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::middleware::AuthUser;

// ─── Key Endpoint (returns Gemini API key to authenticated users) ──

pub async fn get_key(
    Extension(_auth): Extension<AuthUser>,
) -> Response {
    match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => {
            Json(serde_json::json!({"key": k})).into_response()
        }
        _ => {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"error": "AI service not configured"})),
            )
                .into_response()
        }
    }
}

// ─── Request Types (from frontend) ───────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub tools: Option<Vec<Value>>,
    #[serde(default)]
    pub system_instruction: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// ─── Gemini API Types ─────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

// ─── Handler ──────────────────────────────────────────

pub async fn chat(
    Extension(_auth): Extension<AuthUser>, // Ensures user is authenticated
    Json(body): Json<ChatRequest>,
) -> Response {
    // Validate input
    if body.messages.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "messages must not be empty"})),
        )
            .into_response();
    }
    if body.messages.len() > 100 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "too many messages (max 100)"})),
        )
            .into_response();
    }
    for msg in &body.messages {
        if msg.content.len() > 50_000 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "message content too long (max 50000 chars)"})),
            )
                .into_response();
        }
    }

    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::error!("GEMINI_API_KEY not set");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"error": "AI service not configured"})),
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
            role: Some(match m.role.as_str() {
                "assistant" => "model".to_string(),
                other => other.to_string(),
            }),
            parts: vec![GeminiPart {
                text: m.content.clone(),
            }],
        })
        .collect();

    // Build system instruction if provided
    let system_instruction = body.system_instruction.map(|text| GeminiContent {
        role: None,
        parts: vec![GeminiPart { text }],
    });

    let gemini_body = GeminiRequest {
        contents,
        tools: body.tools,
        system_instruction,
    };

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
                Json(serde_json::json!({"error": "Failed to reach AI service"})),
            )
                .into_response();
        }
    };

    let status = resp.status();
    let resp_bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("Failed to read Gemini response body: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid AI service response"})),
            )
                .into_response();
        }
    };

    if !status.is_success() {
        tracing::error!(
            "Gemini API error {}: {}",
            status.as_u16(),
            String::from_utf8_lossy(&resp_bytes)
        );
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("AI service returned status {}", status.as_u16())})),
        )
            .into_response();
    }

    // Return the Gemini response as-is (preserving function calls, candidates, etc.)
    let gemini_json: Value = match serde_json::from_slice(&resp_bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("Failed to parse Gemini response as JSON: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid AI service response"})),
            )
                .into_response();
        }
    };

    Json(gemini_json).into_response()
}
