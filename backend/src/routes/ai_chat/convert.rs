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
    normalize_contents(build_raw_contents(messages))
}

fn build_raw_contents(messages: &[UIMessage]) -> Vec<Value> {
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

                // Gemini requires every functionCall to be paired with a
                // functionResponse before the next user turn. If the tool
                // never produced an output (e.g. the user closed the chat
                // on a `propose_*` form without approving / cancelling, or
                // a tool stayed in `input-available` after a stream stop),
                // we MUST still emit a synthetic response. Otherwise the
                // next request fails with:
                //   400 "Please ensure that function call turn comes
                //        immediately after a user turn or after a function
                //        response turn."
                let response_payload = if state == "output-available" {
                    let output = part.get("output").cloned().unwrap_or(json!({}));
                    if should_elide_tool_output {
                        elide_output(tool_name, &output)
                    } else {
                        let output_str =
                            serde_json::to_string(&output).unwrap_or_default();
                        json!({ "result": output_str })
                    }
                } else {
                    // Orphan tool call — synthesize a benign placeholder so
                    // the conversation stays valid for Gemini. We use a
                    // descriptive marker so the model knows the action was
                    // never carried out and won't pretend it succeeded.
                    json!({
                        "result": format!(
                            "[no result — {} was never completed (user did not approve, or the previous turn was interrupted). Treat as if it did not run.]",
                            tool_name
                        )
                    })
                };
                function_responses.push(json!({
                    "functionResponse": {
                        "name": tool_name,
                        "response": response_payload
                    }
                }));
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

/// Enforce the two structural invariants Gemini validates on `contents[]`.
///
/// Gemini rejects the whole request with
/// `400 INVALID_ARGUMENT: "Please ensure that function call turn comes
/// immediately after a user turn or after a function response turn."`
/// when either invariant is broken:
///
/// 1. **The conversation must open on a `user` turn.** Capping history to the
///    last N UIMessages can slice the list so it starts on an assistant
///    message; that message's `functionCall` then has nothing before it.
/// 2. **Roles must alternate.** One UIMessage can expand into two `contents`
///    entries (`model` for the `functionCall`, `user` for the
///    `functionResponse`), so the very next UIMessage — a `user` turn, or
///    another assistant turn — lands next to an entry of the same role.
///
/// Merging adjacent same-role entries is safe for Gemini: a `model` turn may
/// hold `text` and `functionCall` parts together, and a `user` turn may hold
/// `functionResponse` and `text` parts together. Parts keep their original
/// order, so each `functionCall` keeps its `thoughtSignature` sibling.
fn normalize_contents(contents: Vec<Value>) -> Vec<Value> {
    // Invariant 1: drop leading model turns so the first turn is `user`.
    let first_user = contents
        .iter()
        .position(|c| c.get("role").and_then(|r| r.as_str()) != Some("model"));
    let mut iter = match first_user {
        Some(idx) => contents.into_iter().skip(idx),
        // No user turn at all — nothing valid to send.
        None => return Vec::new(),
    };

    // Invariant 2: fold adjacent same-role entries into one.
    let mut out: Vec<Value> = Vec::new();
    for entry in iter.by_ref() {
        let role = entry
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("user")
            .to_string();

        let merged = out
            .last_mut()
            .filter(|prev| prev.get("role").and_then(|r| r.as_str()) == Some(role.as_str()))
            .and_then(|prev| {
                let incoming = entry.get("parts").and_then(|p| p.as_array()).cloned()?;
                let prev_parts = prev.get_mut("parts")?.as_array_mut()?;
                prev_parts.extend(incoming);
                Some(())
            })
            .is_some();

        if !merged {
            out.push(entry);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, parts: Vec<Value>) -> UIMessage {
        UIMessage {
            id: format!("m_{role}_{}", parts.len()),
            role: role.to_string(),
            parts,
        }
    }

    fn text(t: &str) -> Value {
        json!({ "type": "text", "text": t })
    }

    fn tool(name: &str, state: &str) -> Value {
        json!({
            "type": format!("tool-{name}"),
            "toolCallId": format!("call_{name}"),
            "state": state,
            "input": { "title": "tête de lit" },
            "output": { "ok": true },
        })
    }

    fn roles(contents: &[Value]) -> Vec<&str> {
        contents
            .iter()
            .map(|c| c["role"].as_str().unwrap())
            .collect()
    }

    /// The invariant Gemini actually enforces, asserted directly.
    fn assert_gemini_valid(contents: &[Value]) {
        if contents.is_empty() {
            return;
        }
        assert_eq!(
            contents[0]["role"].as_str(),
            Some("user"),
            "conversation must open on a user turn, got {:?}",
            roles(contents)
        );
        for pair in contents.windows(2) {
            assert_ne!(
                pair[0]["role"], pair[1]["role"],
                "roles must alternate, got {:?}",
                roles(contents)
            );
        }
        for (i, c) in contents.iter().enumerate() {
            let has_fc = c["parts"]
                .as_array()
                .map(|ps| ps.iter().any(|p| p.get("functionCall").is_some()))
                .unwrap_or(false);
            if has_fc {
                assert!(i > 0, "a functionCall turn cannot be first");
                assert_eq!(
                    contents[i - 1]["role"].as_str(),
                    Some("user"),
                    "a functionCall turn must follow a user turn"
                );
            }
        }
    }

    // ── Invariant 2: the consecutive-user-turn regression ─────────────────────

    #[test]
    fn tool_turn_followed_by_user_message_alternates() {
        // The prod repro: ask something (tool runs), then ask for a ticket.
        // Raw conversion emitted user(functionResponse) then user(text).
        let out = ui_messages_to_gemini_contents(&[
            msg("user", vec![text("état des lieux")]),
            msg(
                "assistant",
                vec![tool("org_overview", "output-available"), text("voici")],
            ),
            msg("user", vec![text("crée un ticket correspondance")]),
            msg("assistant", vec![tool("propose_issue", "output-available")]),
        ]);
        assert_eq!(roles(&out), vec!["user", "model", "user", "model", "user"]);
        assert_gemini_valid(&out);
    }

    #[test]
    fn merged_user_turn_keeps_response_then_text_order() {
        let out = ui_messages_to_gemini_contents(&[
            msg("user", vec![text("q")]),
            msg("assistant", vec![tool("search", "output-available")]),
            msg("user", vec![text("suite")]),
        ]);
        let merged = out[2]["parts"].as_array().unwrap();
        assert!(merged[0].get("functionResponse").is_some());
        assert_eq!(merged[1]["text"], "suite");
        assert_gemini_valid(&out);
    }

    #[test]
    fn two_assistant_messages_in_a_row_are_merged() {
        // Text-only assistant turn followed by a tool turn used to yield
        // model(text) then model(functionCall): a functionCall after a model turn.
        let out = ui_messages_to_gemini_contents(&[
            msg("user", vec![text("q")]),
            msg("assistant", vec![text("je regarde")]),
            msg("assistant", vec![tool("search", "output-available")]),
        ]);
        assert_eq!(roles(&out), vec!["user", "model", "user"]);
        let model_parts = out[1]["parts"].as_array().unwrap();
        assert_eq!(model_parts[0]["text"], "je regarde");
        assert!(model_parts[1].get("functionCall").is_some());
        assert_gemini_valid(&out);
    }

    // ── Invariant 1: history capped mid-conversation ─────────────────────────

    #[test]
    fn leading_assistant_tool_turn_is_dropped() {
        // What a 40-message cap can produce: the window opens on an assistant
        // message whose functionCall has nothing before it.
        let out = ui_messages_to_gemini_contents(&[
            msg("assistant", vec![tool("search", "output-available")]),
            msg("user", vec![text("et maintenant ?")]),
        ]);
        assert_eq!(out[0]["role"], "user");
        assert_gemini_valid(&out);
    }

    #[test]
    fn assistant_only_history_yields_nothing_sendable() {
        let out = ui_messages_to_gemini_contents(&[msg("assistant", vec![text("seul")])]);
        assert!(out.is_empty());
    }

    // ── Orphan tool calls (the pre-existing guard) ───────────────────────────

    #[test]
    fn every_function_call_is_paired_whatever_the_state() {
        for state in [
            "input-streaming",
            "input-available",
            "output-available",
            "output-error",
            "",
        ] {
            let out = ui_messages_to_gemini_contents(&[
                msg("user", vec![text("q")]),
                msg("assistant", vec![tool("propose_issue", state)]),
            ]);
            let calls: usize = out
                .iter()
                .flat_map(|c| c["parts"].as_array().unwrap())
                .filter(|p| p.get("functionCall").is_some())
                .count();
            let responses: usize = out
                .iter()
                .flat_map(|c| c["parts"].as_array().unwrap())
                .filter(|p| p.get("functionResponse").is_some())
                .count();
            assert_eq!(calls, responses, "state {state:?} left an orphan call");
            assert_gemini_valid(&out);
        }
    }

    #[test]
    fn parallel_proposals_pair_one_to_one() {
        // The double "Approuvé" case: two propose_* parts in one message.
        let out = ui_messages_to_gemini_contents(&[
            msg("user", vec![text("q")]),
            msg(
                "assistant",
                vec![
                    tool("propose_issue", "output-available"),
                    tool("propose_issue", "input-available"),
                ],
            ),
        ]);
        let calls: usize = out
            .iter()
            .flat_map(|c| c["parts"].as_array().unwrap())
            .filter(|p| p.get("functionCall").is_some())
            .count();
        assert_eq!(calls, 2);
        assert_gemini_valid(&out);
    }

    #[test]
    fn thought_signature_round_trips() {
        let mut part = tool("search", "output-available");
        part["callProviderMetadata"] = json!({ "google": { "thoughtSignature": "sig-abc" } });
        let out = ui_messages_to_gemini_contents(&[
            msg("user", vec![text("q")]),
            msg("assistant", vec![part]),
        ]);
        let fc = out[1]["parts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p.get("functionCall").is_some())
            .unwrap();
        assert_eq!(fc["thoughtSignature"], "sig-abc");
        assert_gemini_valid(&out);
    }

    // ── Misc ─────────────────────────────────────────────────────────────────

    #[test]
    fn system_messages_are_skipped_without_breaking_alternation() {
        let out = ui_messages_to_gemini_contents(&[
            msg("user", vec![text("q")]),
            msg("system", vec![text("ignore")]),
            msg("assistant", vec![text("r")]),
        ]);
        assert_eq!(roles(&out), vec!["user", "model"]);
        assert_gemini_valid(&out);
    }

    #[test]
    fn long_alternating_thread_stays_valid() {
        let mut messages = Vec::new();
        for i in 0..30 {
            messages.push(msg("user", vec![text(&format!("q{i}"))]));
            if i % 3 == 0 {
                messages.push(msg(
                    "assistant",
                    vec![tool("search", "output-available"), text("ok")],
                ));
            } else {
                messages.push(msg("assistant", vec![text("ok")]));
            }
        }
        assert_gemini_valid(&ui_messages_to_gemini_contents(&messages));
    }

    #[test]
    fn empty_input_yields_empty_output() {
        assert!(ui_messages_to_gemini_contents(&[]).is_empty());
    }
}
