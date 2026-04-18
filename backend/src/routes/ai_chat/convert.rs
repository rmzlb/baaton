use serde_json::{json, Value};

use super::types::UIMessage;

/// Number of most-recent UIMessages whose tool outputs are kept verbatim.
/// Older tool outputs are replaced with a compact elision marker to keep
/// prompt tokens bounded on long threads (inspired by Anthropic's
/// "context editing" pattern from late 2025).
const KEEP_RECENT_TOOL_OUTPUTS: usize = 3;

/// Per-output truncation cap for the elided tail (safety net; the recent
/// outputs aren't touched here — `stream.rs` also caps live tool results
/// at 4000 chars before they ever enter history).
const ELIDED_OUTPUT_MAX_CHARS: usize = 400;

fn elide_output(tool_name: &str, raw: &Value) -> Value {
    // Prefer a short, deterministic summary so the KV-cache prefix stays stable
    // across turns. Full payload lives in the UI / DB, not in-context.
    let payload = raw.get("result").unwrap_or(raw);
    let as_str = match payload {
        Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    };

    let preview: String = as_str.chars().take(160).collect();
    let bytes = as_str.len();
    let msg = format!(
        "[elided older {} output — {} bytes; preview: {}]",
        tool_name, bytes, preview
    );
    let capped = if msg.len() > ELIDED_OUTPUT_MAX_CHARS {
        msg.chars().take(ELIDED_OUTPUT_MAX_CHARS).collect::<String>()
    } else {
        msg
    };
    json!({ "result": capped })
}

/// Convert AI SDK v5 UIMessage[] into Gemini's `contents[]` format.
///
/// Each UIMessage maps to one or two Gemini content entries:
/// - Text parts → single content entry with the UIMessage's role
/// - Tool parts → the model's functionCall (model role) is already in the
///   assistant message, and if state == "output-available" we also emit a
///   separate functionResponse entry (user role in Gemini).
///
/// Tool outputs from messages older than `KEEP_RECENT_TOOL_OUTPUTS` are
/// summarized to shrink the context window without breaking the
/// functionCall/functionResponse pairing that Gemini requires.
pub fn ui_messages_to_gemini_contents(messages: &[UIMessage]) -> Vec<Value> {
    let mut contents = Vec::new();

    let total = messages.len();
    let keep_from = total.saturating_sub(KEEP_RECENT_TOOL_OUTPUTS);

    for (idx, msg) in messages.iter().enumerate() {
        let gemini_role = match msg.role.as_str() {
            "assistant" => "model",
            "system" => continue,
            _ => "user",
        };
        let should_elide_tool_output = idx < keep_from;

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

                // AI SDK v5 stores provider metadata from the original model
                // response under `callProviderMetadata`. Gemini 2.5+ / 3.x
                // requires the opaque `thoughtSignature` to round-trip with
                // each functionCall or the API returns 400. Re-attach it here
                // as a sibling key on the part.
                let thought_signature = part
                    .pointer("/callProviderMetadata/google/thoughtSignature")
                    .cloned();

                let mut fc_part = json!({
                    "functionCall": {
                        "name": tool_name,
                        "args": input,
                    }
                });
                if let Some(sig) = thought_signature {
                    if let Some(obj) = fc_part.as_object_mut() {
                        obj.insert("thoughtSignature".to_string(), sig);
                    }
                }
                model_parts.push(fc_part);

                if state == "output-available" {
                    let output = part.get("output").cloned().unwrap_or(json!({}));
                    let response_payload = if should_elide_tool_output {
                        elide_output(tool_name, &output)
                    } else {
                        let output_str =
                            serde_json::to_string(&output).unwrap_or_default();
                        json!({ "result": output_str })
                    };
                    function_responses.push(json!({
                        "functionResponse": {
                            "name": tool_name,
                            "response": response_payload
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
