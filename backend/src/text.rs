//! Char-boundary-safe string helpers.
//!
//! Rust's `&s[..n]` slices by **byte** offset and panics when `n` lands inside a
//! multibyte UTF-8 scalar. Every user-facing string in Baaton can contain
//! accents (French projects), CJK, or emoji, so raw byte slicing is a latent
//! panic on real data. The 2026-08-24 prod incident was exactly this:
//! `generate_branch_name` did `&slug[..50]` and a French title
//! ("…sur-la-page-tête-de-lit") put `ê` across bytes 49..51, panicking the
//! tokio worker 20 times in one morning.
//!
//! Use these helpers instead of byte slicing. `clippy::string_slice` is denied
//! at the crate root to keep new byte slices from creeping back in; the few
//! provably-safe sites carry a local `#[allow]` with a justification.

/// Char-boundary-safe prefix: at most `max_chars` Unicode scalars, no suffix.
///
/// Returns a borrowed slice, so this allocates nothing. Never panics.
///
/// ```ignore
/// assert_eq!(take_chars("tête", 2), "tê");
/// ```
#[allow(
    clippy::string_slice,
    reason = "byte_idx comes from char_indices(), which only yields char boundaries"
)]
pub fn take_chars(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((byte_idx, _)) => &s[..byte_idx],
        // Fewer than `max_chars` chars — the whole string fits.
        None => s,
    }
}

/// Truncate to `max_chars` scalars, appending `suffix` only when truncation happened.
///
/// Note `max_chars` bounds the *content*, not the suffix, so the result can be
/// `max_chars + suffix.chars().count()` long. Callers that render into a fixed
/// box should budget for that.
#[allow(
    clippy::string_slice,
    reason = "byte_idx comes from char_indices(), which only yields char boundaries"
)]
pub fn truncate_with_suffix(s: &str, max_chars: usize, suffix: &str) -> String {
    match s.char_indices().nth(max_chars) {
        Some((byte_idx, _)) => {
            let mut out = String::with_capacity(byte_idx + suffix.len());
            out.push_str(&s[..byte_idx]);
            out.push_str(suffix);
            out
        }
        None => s.to_string(),
    }
}

/// Truncate to `max_chars` scalars, appending `…` (U+2026) when truncated.
pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    truncate_with_suffix(s, max_chars, "…")
}

/// Truncate to `max_chars` scalars, appending ASCII `...` when truncated.
///
/// Kept separate from [`truncate_chars`] because some payloads (webhooks, plain
/// email subjects) are consumed by clients that mangle U+2026.
pub fn truncate_ascii_ellipsis(s: &str, max_chars: usize) -> String {
    truncate_with_suffix(s, max_chars, "...")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── take_chars ────────────────────────────────────────────────────────────

    #[test]
    fn take_chars_passthrough_when_short() {
        assert_eq!(take_chars("abc", 10), "abc");
        assert_eq!(take_chars("", 10), "");
    }

    #[test]
    fn take_chars_exact_length_is_passthrough() {
        assert_eq!(take_chars("abc", 3), "abc");
        assert_eq!(take_chars("éàê", 3), "éàê");
    }

    #[test]
    fn take_chars_zero_is_empty() {
        assert_eq!(take_chars("abc", 0), "");
        assert_eq!(take_chars("é", 0), "");
    }

    #[test]
    fn take_chars_counts_scalars_not_bytes() {
        // Each "é" is 2 bytes: 5 chars = 10 bytes.
        let s = "é".repeat(5);
        let out = take_chars(&s, 3);
        assert_eq!(out.chars().count(), 3);
        assert_eq!(out.len(), 6, "3 × 2-byte scalars");
    }

    #[test]
    fn take_chars_never_splits_multibyte() {
        // The exact prod case: cutting at 50 would land inside `ê` (bytes 49..51).
        let s = "retrait-temporaire-du-visualisateur-sur-la-page-tête-de-lit";
        let out = take_chars(s, 50);
        assert_eq!(out.chars().count(), 50);
        assert!(s.starts_with(out));
    }

    #[test]
    fn take_chars_handles_emoji_and_cjk() {
        // 4-byte scalars.
        let s = "🦞".repeat(4);
        assert_eq!(take_chars(&s, 2), "🦞🦞");
        // 3-byte scalars.
        let s = "日本語テスト";
        assert_eq!(take_chars(s, 3), "日本語");
    }

    #[test]
    fn take_chars_every_cut_point_is_safe() {
        // Brute force: no cut index on a mixed-width string may panic.
        let s = "aé日🦞bê-ç_日本🦞xyzàùî";
        for n in 0..=s.chars().count() + 5 {
            let out = take_chars(s, n);
            assert!(s.starts_with(out));
            assert_eq!(out.chars().count(), n.min(s.chars().count()));
        }
    }

    // ── truncate_chars / suffixes ─────────────────────────────────────────────

    #[test]
    fn truncate_chars_appends_only_when_truncated() {
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("abc", 3), "abc", "exact fit must not add …");
        assert_eq!(truncate_chars("abcd", 3), "abc…");
    }

    #[test]
    fn truncate_chars_handles_multibyte() {
        let s = "é".repeat(300);
        let out = truncate_chars(&s, 240);
        // 240 content chars + the ellipsis.
        assert_eq!(out.chars().count(), 241);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn truncate_ascii_ellipsis_uses_three_dots() {
        assert_eq!(truncate_ascii_ellipsis("abcd", 3), "abc...");
        assert_eq!(truncate_ascii_ellipsis("abc", 3), "abc");
        let s = "ê".repeat(200);
        let out = truncate_ascii_ellipsis(&s, 97);
        assert!(out.ends_with("..."));
        assert_eq!(out.chars().count(), 100);
    }

    #[test]
    fn truncate_with_suffix_custom() {
        assert_eq!(truncate_with_suffix("abcdef", 2, " [cut]"), "ab [cut]");
        assert_eq!(truncate_with_suffix("ab", 2, " [cut]"), "ab");
    }

    #[test]
    fn truncate_never_panics_on_any_boundary() {
        let s = "aé日🦞bê-ç_日本🦞xyzàùî";
        for n in 0..=s.chars().count() + 5 {
            let _ = truncate_chars(s, n);
            let _ = truncate_ascii_ellipsis(s, n);
        }
    }
}
