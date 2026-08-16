//! Centralised Gemini model selection.
//!
//! Single source of truth for which Gemini model each code path uses, so a
//! model bump is one edit instead of a grep across routes.
//!
//! Tiers (verified live against `generativelanguage.googleapis.com/v1beta/models`
//! on 2026-08-16):
//! - `gemini-3.7-flash` — agentic tier. Built for tool use, 1M input / 65k output,
//!   thinking enabled. Used by every path that sends `functionDeclarations`.
//! - `gemini-3.5-flash-lite` — utility tier. Cheap, high volume, no tools.
//!   Used for classification-style calls (triage) where the output is a small
//!   fixed JSON object.
//!
//! Both are overridable via env so prod can be pinned or rolled back without a
//! rebuild.

/// Model for agentic paths: function calling + multi-step loops.
///
/// Override with `GEMINI_CHAT_MODEL`.
pub fn agentic() -> String {
    std::env::var("GEMINI_CHAT_MODEL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AGENTIC.to_string())
}

/// Model for cheap single-shot classification (triage, labelling).
///
/// Override with `GEMINI_UTILITY_MODEL`.
pub fn utility() -> String {
    std::env::var("GEMINI_UTILITY_MODEL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_UTILITY.to_string())
}

pub const DEFAULT_AGENTIC: &str = "gemini-3.7-flash";
pub const DEFAULT_UTILITY: &str = "gemini-3.5-flash-lite";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_current_models() {
        assert_eq!(DEFAULT_AGENTIC, "gemini-3.7-flash");
        assert_eq!(DEFAULT_UTILITY, "gemini-3.5-flash-lite");
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
