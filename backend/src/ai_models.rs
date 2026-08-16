//! Centralised Gemini model + thinking configuration.
//!
//! Single source of truth for which Gemini model each code path uses and how
//! much internal reasoning it is allowed to spend, so a model bump or a cost
//! adjustment is one edit instead of a grep across routes.
//!
//! # Tiers
//!
//! Verified live against `generativelanguage.googleapis.com/v1beta/models`
//! on 2026-08-16:
//!
//! - `gemini-3.7-flash` — agentic tier. Built for tool use, 1M input /
//!   65k output, `thinking: true`. Used by every path that sends
//!   `functionDeclarations`.
//! - `gemini-3.5-flash-lite` — utility tier. Cheap, high volume, no tools.
//!   Used for classification-style calls (triage) where the output is a small
//!   fixed JSON object.
//!
//! Both are overridable via env so prod can be pinned or rolled back without a
//! rebuild.
//!
//! # Thinking (Gemini 3.x)
//!
//! Gemini 3.x replaces the 2.5-era `thinkingBudget` with `thinkingLevel`
//! (`minimal` | `low` | `medium` | `high`). Mixing both parameters is an API
//! error, so this module only ever emits `thinkingLevel`.
//!
//! Two things make an explicit level mandatory rather than cosmetic:
//!
//! 1. **Default is expensive.** With no `thinkingConfig`, 3.x uses dynamic
//!    thinking and defaults high. Measured: the prompt `"2+2?"` burned
//!    `thoughtsTokenCount: 79` for a 3-token answer. At tool-call scale that
//!    is the dominant cost.
//! 2. **`minimal` is not universal.** `gemini-3.7-flash` rejects it with
//!    `400 "Thinking level MINIMAL is not supported for this model"`, while
//!    `gemini-3.5-flash-lite` accepts it. So the level is per tier, not global.
//!
//! Thinking tokens are billed at the output rate and are reported *separately*
//! from `candidatesTokenCount` in `usageMetadata.thoughtsTokenCount`. Any
//! metering that sums only `candidatesTokenCount` under-reports real spend —
//! see [`billed_output_tokens`].

use serde_json::{json, Value};

pub const DEFAULT_AGENTIC: &str = "gemini-3.7-flash";
pub const DEFAULT_UTILITY: &str = "gemini-3.5-flash-lite";

/// Default reasoning depth for agentic paths.
///
/// `low` is deliberate: Baaton's agent turns are short, tool-shaped decisions
/// ("which tool, which args"), not multi-step analysis. `low` still produces
/// correct parallel tool calls in practice while cutting the default thinking
/// spend. Raise to `medium` via env if tool selection quality regresses.
pub const DEFAULT_AGENTIC_THINKING: &str = "low";

/// Default reasoning depth for utility paths.
///
/// `minimal` is supported on `gemini-3.5-flash-lite` and is the right setting
/// for "return this small JSON object" work.
pub const DEFAULT_UTILITY_THINKING: &str = "minimal";

/// Model for agentic paths: function calling + multi-step loops.
///
/// Override with `GEMINI_CHAT_MODEL`.
pub fn agentic() -> String {
    env_or("GEMINI_CHAT_MODEL", DEFAULT_AGENTIC)
}

/// Model for cheap single-shot classification (triage, labelling).
///
/// Override with `GEMINI_UTILITY_MODEL`.
pub fn utility() -> String {
    env_or("GEMINI_UTILITY_MODEL", DEFAULT_UTILITY)
}

/// `thinkingConfig` for agentic paths. Override with `GEMINI_THINKING_LEVEL`.
///
/// Set the env var to `default` to omit `thinkingConfig` entirely and let the
/// model pick dynamically — useful as an escape hatch if a future model
/// rejects the configured level.
pub fn agentic_thinking_config() -> Option<Value> {
    thinking_config(env_or("GEMINI_THINKING_LEVEL", DEFAULT_AGENTIC_THINKING))
}

/// `thinkingConfig` for utility paths. Override with `GEMINI_UTILITY_THINKING_LEVEL`.
pub fn utility_thinking_config() -> Option<Value> {
    thinking_config(env_or(
        "GEMINI_UTILITY_THINKING_LEVEL",
        DEFAULT_UTILITY_THINKING,
    ))
}

/// Build a `thinkingConfig` object, or `None` for "let the model decide".
///
/// Only `thinkingLevel` is emitted. `thinkingBudget` is the Gemini 2.5 form and
/// must never be mixed in.
fn thinking_config(level: String) -> Option<Value> {
    let level = level.trim().to_ascii_lowercase();
    if level.is_empty() || level == "default" || level == "dynamic" || level == "auto" {
        return None;
    }
    Some(json!({ "thinkingLevel": level }))
}

/// Merge a `thinkingConfig` into an existing `generationConfig` object.
///
/// Respects a caller-supplied `thinkingConfig` (or a legacy `thinkingBudget`)
/// and leaves it untouched, since overwriting it would either fight the caller
/// or trip the "cannot mix budget and level" API error.
pub fn apply_thinking(generation_config: &mut Value, thinking: Option<Value>) {
    let Some(thinking) = thinking else {
        return;
    };
    let Some(obj) = generation_config.as_object_mut() else {
        return;
    };
    if obj.contains_key("thinkingConfig") || obj.contains_key("thinking_config") {
        return;
    }
    if obj.contains_key("thinkingBudget") || obj.contains_key("thinking_budget") {
        return;
    }
    obj.insert("thinkingConfig".to_string(), thinking);
}

/// Output tokens actually billed for one Gemini response.
///
/// `usageMetadata.candidatesTokenCount` covers only the visible answer.
/// Internal reasoning is reported separately as `thoughtsTokenCount` and is
/// billed at the same output rate, so metering must add both. Missing this is
/// silent under-reporting: a turn can bill 3x what `candidatesTokenCount`
/// suggests.
///
/// Returns `(billed_output, thoughts)` so callers can log the split.
pub fn billed_output_tokens(usage: Option<&Value>) -> (i32, i32) {
    let get = |key: &str| -> i32 {
        usage
            .and_then(|u| u.get(key))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32
    };
    let candidates = get("candidatesTokenCount");
    let thoughts = get("thoughtsTokenCount");
    (candidates + thoughts, thoughts)
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_current_models() {
        assert_eq!(DEFAULT_AGENTIC, "gemini-3.7-flash");
        assert_eq!(DEFAULT_UTILITY, "gemini-3.5-flash-lite");
    }

    #[test]
    fn agentic_never_uses_minimal() {
        // gemini-3.7-flash returns 400 for MINIMAL. Guard the default so a
        // careless edit cannot break every agent turn in prod.
        assert_ne!(DEFAULT_AGENTIC_THINKING, "minimal");
    }

    #[test]
    fn thinking_config_emits_level_only() {
        let cfg = thinking_config("low".into()).expect("level should be emitted");
        assert_eq!(cfg["thinkingLevel"], "low");
        assert!(cfg.get("thinkingBudget").is_none());
    }

    #[test]
    fn thinking_config_normalises_case_and_whitespace() {
        let cfg = thinking_config("  HIGH ".into()).expect("level should be emitted");
        assert_eq!(cfg["thinkingLevel"], "high");
    }

    #[test]
    fn thinking_config_opt_out_values() {
        for v in ["default", "dynamic", "auto", "", "   "] {
            assert!(
                thinking_config(v.into()).is_none(),
                "{v:?} should disable thinkingConfig"
            );
        }
    }

    #[test]
    fn apply_thinking_inserts_when_absent() {
        let mut gc = json!({ "temperature": 0.4 });
        apply_thinking(&mut gc, Some(json!({ "thinkingLevel": "low" })));
        assert_eq!(gc["thinkingConfig"]["thinkingLevel"], "low");
        assert_eq!(gc["temperature"], 0.4);
    }

    #[test]
    fn apply_thinking_respects_caller_config() {
        let mut gc = json!({ "thinkingConfig": { "thinkingLevel": "high" } });
        apply_thinking(&mut gc, Some(json!({ "thinkingLevel": "low" })));
        assert_eq!(gc["thinkingConfig"]["thinkingLevel"], "high");
    }

    #[test]
    fn apply_thinking_never_mixes_with_legacy_budget() {
        // Sending thinkingLevel alongside thinkingBudget is an API error.
        let mut gc = json!({ "thinkingBudget": 128 });
        apply_thinking(&mut gc, Some(json!({ "thinkingLevel": "low" })));
        assert!(gc.get("thinkingConfig").is_none());
    }

    #[test]
    fn apply_thinking_noop_when_none() {
        let mut gc = json!({ "temperature": 0.4 });
        apply_thinking(&mut gc, None);
        assert!(gc.get("thinkingConfig").is_none());
    }

    #[test]
    fn billed_output_includes_thoughts() {
        let usage = json!({ "candidatesTokenCount": 24, "thoughtsTokenCount": 105 });
        assert_eq!(billed_output_tokens(Some(&usage)), (129, 105));
    }

    #[test]
    fn billed_output_handles_missing_fields() {
        assert_eq!(billed_output_tokens(None), (0, 0));
        let usage = json!({ "candidatesTokenCount": 7 });
        assert_eq!(billed_output_tokens(Some(&usage)), (7, 0));
    }

    #[test]
    fn blank_env_falls_back_to_default() {
        // SAFETY: single-threaded test, no concurrent env readers.
        unsafe { std::env::set_var("GEMINI_CHAT_MODEL", "   ") };
        assert_eq!(agentic(), DEFAULT_AGENTIC);
        unsafe { std::env::remove_var("GEMINI_CHAT_MODEL") };
    }

    #[test]
    fn env_override_wins() {
        unsafe { std::env::set_var("GEMINI_UTILITY_MODEL", "gemini-3.6-flash") };
        assert_eq!(utility(), "gemini-3.6-flash");
        unsafe { std::env::remove_var("GEMINI_UTILITY_MODEL") };
    }
}
