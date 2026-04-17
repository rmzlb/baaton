use serde_json::{json, Value};

use super::types::UIMessage;

/// Convert AI SDK v5 UIMessage[] into Gemini's `contents[]` format.
///
/// Each UIMessage maps to one or two Gemini content entries:
/// - Text parts → single content entry with the UIMessage's role
/// - Tool parts → the model's functionCall (model role) is already in the
///   assistant message, and if state == "output-available" we also emit a
///   separate functionResponse entry (user role in Gemini).
pub fn ui_messages_to_gemini_contents(messages: &[UIMessage]) -> Vec<Value> {
    let mut contents = Vec::new();

    for msg in messages {
        let gemini_role = match msg.role.as_str() {
            "assistant" => "model",
            "system" => continue,
            _ => "user",
        };

        let mut model_parts: Vec<Value> = Vec::new();
        let mut function_responses: Vec<Value> = Vec::new();

        for part in &msg.parts {
            let part_type = part
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("");

            if part_type == "text" {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        model_parts.push(json!({ "text": text }));
                    }
                }
            } else if part_type.starts_with("tool-") {
                let tool_name = part_type.trim_start_matches("tool-");
                let input = part.get("input").cloned().unwrap_or(json!({}));
                let state = part
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                model_parts.push(json!({
                    "functionCall": {
                        "name": tool_name,
                        "args": input,
                    }
                }));

                if state == "output-available" {
                    let output = part.get("output").cloned().unwrap_or(json!({}));
                    let output_str =
                        serde_json::to_string(&output).unwrap_or_default();
                    function_responses.push(json!({
                        "functionResponse": {
                            "name": tool_name,
                            "response": { "result": output_str }
                        }
                    }));
                }
            }
        }

        if !model_parts.is_empty() {
            contents.push(json!({
                "role": gemini_role,
                "parts": model_parts,
            }));
        }

        if !function_responses.is_empty() {
            contents.push(json!({
                "role": "user",
                "parts": function_responses,
            }));
        }
    }

    contents
}
