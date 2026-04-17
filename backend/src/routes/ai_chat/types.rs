use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── INPUT: what the frontend sends ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<UIMessage>,
    #[serde(default)]
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UIMessage {
    #[allow(dead_code)]
    pub id: String,
    pub role: String,
    /// Parts are kept as raw JSON Values so we can handle dynamic
    /// `type` discriminators like `"tool-propose_issue"` without
    /// fighting serde's tagged enum limitations.
    pub parts: Vec<Value>,
}

// ─── OUTPUT: what we stream back (AI SDK v5 UIMessage protocol) ─────────────

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum UIMessageChunk {
    Start {
        #[serde(rename = "messageId")]
        message_id: String,
    },
    StartStep,

    TextStart {
        id: String,
    },
    TextDelta {
        id: String,
        delta: String,
    },
    TextEnd {
        id: String,
    },

    ToolInputStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
    },
    ToolInputAvailable {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: Value,
    },
    ToolOutputAvailable {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        output: Value,
    },

    FinishStep,
    Finish,

    Error {
        #[serde(rename = "errorText")]
        error_text: String,
    },
}
