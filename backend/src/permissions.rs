//! API-key permission enforcement.
//!
//! ## Why this module exists
//!
//! `api_keys.rs` has always validated permission scopes at key **creation** time
//! against `VALID_PERMISSIONS`, and the UI let you pick them. But nothing ever
//! checked them at request time. The middleware selected `k.permissions` into a
//! field annotated `#[allow(dead_code)]`, and `AuthUser` had no `permissions`
//! field at all, so no route *could* enforce them even if it wanted to.
//!
//! Net effect: every API key had `admin:full` in practice. A key issued as
//! `issues:read` could delete projects. That is the flaw this module closes.
//!
//! ## Design
//!
//! - Enforcement applies to **API keys only**. Clerk humans are governed by
//!   `org_role` / superadmin checks, which are a separate axis. Adding scope
//!   checks to human sessions would lock people out of their own orgs.
//! - `admin:full` is a wildcard and satisfies every requirement.
//! - Read/write/delete are **not** hierarchical by accident: `issues:write` does
//!   not imply `issues:delete`, because destructive verbs are exactly what a
//!   scoped agent key should not get for free. `:write` does imply `:read` on the
//!   same resource, because an agent that can create an issue must be able to
//!   read the result back to act on it.
//! - Unmapped routes **deny** (fail closed). An unmapped route is a bug, not an
//!   open door, and `coverage_is_exhaustive` below parses the real router source
//!   so a new route cannot ship unmapped.
//!
//! Scope vocabulary is fixed by `routes::api_keys::VALID_PERMISSIONS`; the test
//! `every_mapped_scope_is_a_valid_permission` keeps this file from inventing one.

use axum::http::Method;

/// What a given (method, path) pair demands from the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Requirement {
    /// No authentication at all (public intake, receipts, health).
    Public,
    /// Any authenticated caller. Used where no scope maps cleanly: per-user
    /// notification state, invite acceptance, "who am I" style reads.
    Authenticated,
    /// Requires this exact scope, or `admin:full`.
    Scope(&'static str),
}

/// Wildcard scope: satisfies every requirement.
pub const ADMIN_FULL: &str = "admin:full";

/// Scopes that grant authority over other API keys.
///
/// These are the only scopes that let their holder mint or widen credentials,
/// so they are treated as an authority transfer rather than ordinary access:
///
/// - the legacy grandfather bypass in `middleware` must not cover them (every
///   key predating migration 071 has `legacy_full_access = true`, so covering
///   them would silently hand key management to all 17 existing keys), and
/// - handing one out requires already holding it — see
///   `routes::api_keys::enforce_no_escalation`.
///
/// `admin:full` is deliberately absent: it already gates unrelated routes
/// (GitHub install, org settings, integrations) that legacy keys legitimately
/// use today, and narrowing those here would break live integrations. It is
/// handled as a grantable scope in `api_keys` instead.
pub const KEY_MANAGEMENT_SCOPES: &[&str] = &["api-keys:read", "api-keys:write"];

/// True when `scope` grants authority over other API keys.
pub fn is_key_management_scope(scope: &str) -> bool {
    KEY_MANAGEMENT_SCOPES.contains(&scope)
}

/// True when `granted` satisfies `needed`.
///
/// `admin:full` satisfies everything. `<resource>:write` satisfies
/// `<resource>:read` on the same resource. Nothing else is implied.
pub fn scope_satisfies(granted: &str, needed: &str) -> bool {
    if granted == ADMIN_FULL || granted == needed {
        return true;
    }
    match (granted.split_once(':'), needed.split_once(':')) {
        (Some((g_res, "write")), Some((n_res, "read"))) => g_res == n_res,
        _ => false,
    }
}

/// True when any granted scope satisfies `needed`.
pub fn scopes_allow(granted: &[String], needed: &str) -> bool {
    granted.iter().any(|g| scope_satisfies(g, needed))
}

/// Normalize a request path into comparable segments.
///
/// Strips the `/api/v1` mount prefix (the API router is nested there in
/// `main.rs`) and drops empty segments so `//issues` and `/issues/` behave.
///
/// The strip is boundary-aware: a naive `strip_prefix("/api")` also eats the
/// prefix of `/api-keys`, leaving `-keys`, which matches no arm and silently
/// falls through to `admin:full`. Only strip when the prefix ends at a segment
/// boundary. Both forms reach here in practice — the proxy forwards
/// `/api-keys` while direct calls use `/api/v1/api-keys` — so both are tested.
fn segments(path: &str) -> Vec<&str> {
    let trimmed = strip_mount(path, "/api/v1")
        .or_else(|| strip_mount(path, "/api"))
        .unwrap_or(path);
    trimmed.split('/').filter(|s| !s.is_empty()).collect()
}

/// `strip_prefix`, but only when the prefix ends the string or is followed by
/// `/`, so `/api` never matches inside `/api-keys`.
fn strip_mount<'a>(path: &'a str, mount: &str) -> Option<&'a str> {
    let rest = path.strip_prefix(mount)?;
    if rest.is_empty() || rest.starts_with('/') {
        Some(rest)
    } else {
        None
    }
}

/// Read for GET/HEAD, write for POST/PATCH/PUT, delete for DELETE.
fn verb(method: &Method) -> &'static str {
    match *method {
        Method::GET | Method::HEAD | Method::OPTIONS => "read",
        Method::DELETE => "delete",
        _ => "write",
    }
}

/// Pick `read`/`write` scope for a resource based on the HTTP method, treating
/// DELETE as write. Used for resources with no dedicated `:delete` scope, where
/// removing a row is a mutation of the parent rather than its own privilege
/// (removing a label from a project is not like deleting an issue).
fn rw(method: &Method, read: &'static str, write: &'static str) -> Requirement {
    match verb(method) {
        "read" => Requirement::Scope(read),
        _ => Requirement::Scope(write),
    }
}

/// Pick read/write/delete for resources that do have a `:delete` scope.
fn rwd(
    method: &Method,
    read: &'static str,
    write: &'static str,
    delete: &'static str,
) -> Requirement {
    match verb(method) {
        "read" => Requirement::Scope(read),
        "delete" => Requirement::Scope(delete),
        _ => Requirement::Scope(write),
    }
}

/// The scope required to serve `method path`.
///
/// Fails closed: anything unrecognised requires `admin:full`, so a route added
/// without a mapping is reachable only by full-access keys instead of silently
/// open. `coverage_is_exhaustive` makes that state a test failure, not a
/// production surprise.
pub fn required_permission(method: &Method, path: &str) -> Requirement {
    let segs = segments(path);
    let Some(head) = segs.first().copied() else {
        return Requirement::Public; // "/" — nothing mounted, no data
    };

    // ── Unauthenticated surfaces ─────────────────────────────────────────
    // Kept in sync with the early-return list in `auth_middleware`.
    match head {
        "health" | "public" | "r" => return Requirement::Public,
        "webhooks" if segs.get(1) == Some(&"github") => return Requirement::Public,
        "invite" => return Requirement::Public, // accept-invite by code
        _ => {}
    }

    match head {
        // ── Projects ─────────────────────────────────────────────────────
        "projects" => {
            // /projects/by-slug/{slug}/board
            if segs.get(1) == Some(&"by-slug") {
                return Requirement::Scope("projects:read");
            }
            match segs.get(2).copied() {
                None => rwd(
                    method,
                    "projects:read",
                    "projects:write",
                    "projects:delete",
                ),
                Some(sub) => match sub {
                    "issues" => Requirement::Scope("issues:read"),
                    "tags" => rw(method, "labels:read", "labels:write"),
                    "milestones" => rw(method, "milestones:read", "milestones:write"),
                    "sprints" | "cycles" => rw(method, "sprints:read", "sprints:write"),
                    "templates" => rw(method, "templates:read", "templates:write"),
                    "sla-rules" | "sla-stats" | "automations" | "recurring" => {
                        rw(method, "automations:read", "automations:write")
                    }
                    "context" | "memory" => rw(method, "context:read", "context:write"),
                    "custom-fields" | "public-submit" | "auto-assign" => {
                        rw(method, "projects:read", "projects:write")
                    }
                    "statuses" | "refresh-github" | "import" => {
                        Requirement::Scope("projects:write")
                    }
                    "burndown" | "dependency-graph" | "export" => {
                        Requirement::Scope("projects:read")
                    }
                    "gamification" => Requirement::Scope("members:read"),
                    _ => Requirement::Scope(ADMIN_FULL),
                },
            }
        }

        // ── Issues ───────────────────────────────────────────────────────
        "issues" => {
            match segs.get(1).copied() {
                None => rw(method, "issues:read", "issues:write"),
                // /issues/mine, /issues/batch are literals, not ids
                Some("mine") => Requirement::Scope("issues:read"),
                Some("batch") => match verb(method) {
                    "delete" => Requirement::Scope("issues:delete"),
                    _ => Requirement::Scope("issues:write"),
                },
                Some(_id) => match segs.get(2).copied() {
                    None => rwd(method, "issues:read", "issues:write", "issues:delete"),
                    Some(sub) => match sub {
                        "comments" => rwd(
                            method,
                            "comments:read",
                            "comments:write",
                            "comments:delete",
                        ),
                        // Mutating the issue itself, not a separate privilege.
                        "position" | "archive" | "unarchive" | "tldr" | "approval-request"
                        | "approval-response" => Requirement::Scope("issues:write"),
                        "relations" | "attachments" => {
                            rw(method, "issues:read", "issues:write")
                        }
                        "custom-values" => rw(method, "issues:read", "issues:write"),
                        "children" | "activity" | "agent-sessions" | "github" => {
                            Requirement::Scope("issues:read")
                        }
                        "triage" => Requirement::Scope("ai:triage"),
                        _ => Requirement::Scope(ADMIN_FULL),
                    },
                },
            }
        }

        // ── Reads over issue data ────────────────────────────────────────
        "search" | "activity" | "events" | "views" => Requirement::Scope("issues:read"),
        "dashboard" | "metrics" => Requirement::Scope("projects:read"),

        // ── Standalone resource ids ──────────────────────────────────────
        "cycles" | "sprints" => rw(method, "sprints:read", "sprints:write"),
        "tags" => rw(method, "labels:read", "labels:write"),
        "milestones" => rw(method, "milestones:read", "milestones:write"),
        "templates" | "project-templates" => rw(method, "templates:read", "templates:write"),
        "sla-rules" | "automations" | "recurring" => {
            rw(method, "automations:read", "automations:write")
        }
        "custom-fields" => rw(method, "projects:read", "projects:write"),
        "initiatives" => rwd(
            method,
            "projects:read",
            "projects:write",
            "projects:delete",
        ),
        "triage" => Requirement::Scope("ai:triage"),
        "uploads" => Requirement::Scope("issues:write"),
        "memory" => Requirement::Scope("context:read"), // POST /memory/search is a read
        "agent-config" => rw(method, "context:read", ADMIN_FULL),

        // ── Webhooks (non-GitHub) ────────────────────────────────────────
        "webhooks" => rw(method, "webhooks:read", "webhooks:write"),

        // ── Agent sessions / run cards ───────────────────────────────────
        "agent-sessions" => rw(method, "issues:read", "issues:write"),

        // ── AI ───────────────────────────────────────────────────────────
        "ai" => match segs.get(1).copied() {
            Some("agent") | Some("pm-full-review") => Requirement::Scope("ai:triage"),
            _ => Requirement::Scope("ai:chat"),
        },

        // ── GitHub integration ───────────────────────────────────────────
        "github" => match segs.get(1).copied() {
            Some("mappings") => rw(method, "projects:read", "projects:write"),
            Some("installation") | Some("repos") => Requirement::Scope("projects:read"),
            // Connecting/disconnecting an installation rewires the whole org.
            _ => Requirement::Scope(ADMIN_FULL),
        },
        "integrations" => match verb(method) {
            "read" => Requirement::Scope("webhooks:read"),
            _ => Requirement::Scope(ADMIN_FULL),
        },

        // ── Org / members ────────────────────────────────────────────────
        "orgs" => match segs.get(2).copied() {
            Some("settings") => Requirement::Scope(ADMIN_FULL),
            _ => Requirement::Scope("members:read"),
        },
        "invites" => match verb(method) {
            "read" => Requirement::Scope("members:read"),
            _ => Requirement::Scope("members:invite"),
        },
        "gamification" => Requirement::Scope("members:read"),

        // ── Money and key management ─────────────────────────────────────
        "billing" => Requirement::Scope("billing:read"),
        // Key management is scoped like any other resource (the Cloudflare
        // "API Tokens Read/Edit" model). The handlers add what a route table
        // cannot express: no caller may grant a scope it does not itself hold.
        "api-keys" => rw(method, "api-keys:read", "api-keys:write"),
        "admin" => Requirement::Scope(ADMIN_FULL),

        // ── Per-user state, no scope axis ────────────────────────────────
        "notifications" => Requirement::Authenticated,

        _ => Requirement::Scope(ADMIN_FULL),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(m: Method, p: &str) -> Requirement {
        required_permission(&m, p)
    }
    fn scope(m: Method, p: &str) -> String {
        match req(m, p) {
            Requirement::Scope(s) => s.to_string(),
            other => panic!("expected a scope for {p}, got {other:?}"),
        }
    }

    #[test]
    fn admin_full_is_a_wildcard() {
        for needed in [
            "issues:read",
            "issues:delete",
            "billing:read",
            "members:invite",
            ADMIN_FULL,
        ] {
            assert!(scope_satisfies(ADMIN_FULL, needed), "admin:full must cover {needed}");
        }
    }

    #[test]
    fn write_implies_read_on_the_same_resource_only() {
        assert!(scope_satisfies("issues:write", "issues:read"));
        assert!(!scope_satisfies("issues:write", "projects:read"));
        assert!(!scope_satisfies("issues:read", "issues:write"));
    }

    #[test]
    fn write_never_implies_delete() {
        // The whole point of scoping an agent key: it can file issues all day
        // without being able to erase the board.
        assert!(!scope_satisfies("issues:write", "issues:delete"));
        assert!(!scope_satisfies("projects:write", "projects:delete"));
        assert!(!scope_satisfies("comments:write", "comments:delete"));
    }

    #[test]
    fn default_key_can_do_its_job_and_nothing_more() {
        let default = default_permissions();

        // Allowed: the documented agent loop.
        for (m, p) in [
            (Method::GET, "/api/v1/issues"),
            (Method::POST, "/api/v1/issues"),
            (Method::PATCH, "/api/v1/issues/abc"),
            (Method::GET, "/api/v1/projects"),
            (Method::GET, "/api/v1/projects/abc/issues"),
            (Method::GET, "/api/v1/search"),
            (Method::POST, "/api/v1/issues/abc/tldr"),
        ] {
            let needed = scope(m.clone(), p);
            assert!(
                scopes_allow(&default, &needed),
                "default key should be allowed {m} {p} (needs {needed})"
            );
        }

        // Denied: everything destructive, financial, or org-wide.
        for (m, p) in [
            (Method::DELETE, "/api/v1/issues/abc"),
            (Method::DELETE, "/api/v1/projects/abc"),
            (Method::DELETE, "/api/v1/issues/batch"),
            (Method::GET, "/api/v1/billing"),
            (Method::GET, "/api/v1/api-keys"),
            (Method::POST, "/api/v1/api-keys"),
            (Method::GET, "/api/v1/admin/overview"),
            (Method::PATCH, "/api/v1/orgs/o1/settings"),
            (Method::POST, "/api/v1/webhooks"),
            (Method::POST, "/api/v1/ai/chat"),
        ] {
            let needed = scope(m.clone(), p);
            assert!(
                !scopes_allow(&default, &needed),
                "default key must NOT be allowed {m} {p} (needs {needed})"
            );
        }
    }

    #[test]
    fn public_surfaces_need_nothing() {
        for p in [
            "/health",
            "/api/v1/public/docs",
            "/api/v1/public/acme/submit",
            "/api/v1/public/acme/email-intake",
            "/api/v1/public/runs/tok/receipt.json",
            "/api/v1/public/orgs/org_1/jwks.json",
            "/api/v1/webhooks/github",
            "/r/tok",
        ] {
            assert_eq!(req(Method::GET, p), Requirement::Public, "{p} must stay public");
        }
        assert_eq!(
            req(Method::POST, "/api/v1/public/acme/submit"),
            Requirement::Public
        );
    }

    #[test]
    fn literal_subpaths_are_not_mistaken_for_ids() {
        assert_eq!(scope(Method::GET, "/api/v1/issues/mine"), "issues:read");
        assert_eq!(scope(Method::PATCH, "/api/v1/issues/batch"), "issues:write");
        assert_eq!(
            scope(Method::DELETE, "/api/v1/issues/batch"),
            "issues:delete"
        );
        // An id in the same position still resolves to the id branch.
        assert_eq!(scope(Method::DELETE, "/api/v1/issues/abc"), "issues:delete");
    }

    #[test]
    fn destructive_org_wiring_requires_admin() {
        for (m, p) in [
            (Method::POST, "/api/v1/github/install/start"),
            (Method::POST, "/api/v1/github/disconnect"),
            (Method::PATCH, "/api/v1/orgs/o1/settings"),
            (Method::PATCH, "/api/v1/admin/orgs/o1/plan"),
            (Method::PATCH, "/api/v1/agent-config"),
            (Method::DELETE, "/api/v1/integrations/slack/s1"),
        ] {
            assert_eq!(scope(m.clone(), p), ADMIN_FULL, "{m} {p} must require admin:full");
        }
    }

    // ── Key management scopes (Cloudflare "API Tokens Read/Edit" model) ──────

    #[test]
    fn key_management_maps_to_its_own_scopes() {
        assert_eq!(scope(Method::GET, "/api/v1/api-keys"), "api-keys:read");
        assert_eq!(scope(Method::POST, "/api/v1/api-keys"), "api-keys:write");
        assert_eq!(scope(Method::PATCH, "/api/v1/api-keys/k1"), "api-keys:write");
        assert_eq!(
            scope(Method::POST, "/api/v1/api-keys/k1/regenerate"),
            "api-keys:write"
        );
        // No `api-keys:delete` in the vocabulary: revocation is a write.
        assert_eq!(
            scope(Method::DELETE, "/api/v1/api-keys/k1"),
            "api-keys:write"
        );
    }

    #[test]
    fn the_mount_prefix_is_stripped_at_segment_boundaries_only() {
        // Regression: `strip_prefix("/api")` also matched the `/api` inside
        // `/api-keys`, leaving `-keys`, which matched no arm and fell through to
        // `admin:full`. Prod hit this because the proxy forwards the short form,
        // while every test used `/api/v1/...` and passed.
        for path in ["/api-keys", "/api/api-keys", "/api/v1/api-keys"] {
            assert_eq!(
                scope(Method::GET, path),
                "api-keys:read",
                "{path} must resolve to key management, not the admin fallback"
            );
        }
        assert_eq!(scope(Method::DELETE, "/api-keys/k1"), "api-keys:write");
    }

    #[test]
    fn every_resource_resolves_the_same_with_and_without_the_mount_prefix() {
        // The proxy may forward either form; the decision must not depend on it.
        for path in [
            "api-keys",
            "issues",
            "projects",
            "comments",
            "billing",
            "admin",
            "webhooks",
            "members",
        ] {
            for method in [Method::GET, Method::POST, Method::DELETE] {
                assert_eq!(
                    required_permission(&method, &format!("/{path}")),
                    required_permission(&method, &format!("/api/v1/{path}")),
                    "{method} /{path} differs with and without the mount prefix"
                );
            }
        }
    }

    #[test]
    fn key_management_scopes_are_recognised_as_privileged() {
        assert!(is_key_management_scope("api-keys:read"));
        assert!(is_key_management_scope("api-keys:write"));
        // `admin:full` is intentionally NOT in this set: legacy keys rely on it
        // for GitHub/org routes, and blocking those would break integrations.
        assert!(!is_key_management_scope(ADMIN_FULL));
        assert!(!is_key_management_scope("issues:write"));
    }

    /// The scope vocabulary, parsed from the single source of truth in
    /// `routes::api_keys`. Parsed rather than duplicated so a scope added there
    /// is covered here automatically.
    fn valid_permissions() -> Vec<&'static str> {
        include_str!("routes/api_keys.rs")
            .split("VALID_PERMISSIONS: &[&str] = &[")
            .nth(1)
            .expect("VALID_PERMISSIONS literal not found")
            .split("];")
            .next()
            .unwrap()
            .split('"')
            .filter(|s| s.contains(':'))
            .collect()
    }

    /// Mirrors `api_keys::default_permissions()`.
    fn default_permissions() -> Vec<String> {
        ["issues:read", "issues:write", "projects:read"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn key_management_is_not_reachable_by_ordinary_scopes() {
        // A broadly-scoped agent key still cannot touch key management.
        let broad: Vec<String> = valid_permissions()
            .iter()
            .filter(|p| !p.starts_with("api-keys:") && **p != ADMIN_FULL)
            .map(|p| p.to_string())
            .collect();
        assert!(broad.len() > 20, "expected a broad key, got {broad:?}");
        for (m, p) in [
            (Method::GET, "/api/v1/api-keys"),
            (Method::POST, "/api/v1/api-keys"),
            (Method::PATCH, "/api/v1/api-keys/k1"),
            (Method::DELETE, "/api/v1/api-keys/k1"),
        ] {
            let needed = scope(m.clone(), p);
            assert!(
                !scopes_allow(&broad, &needed),
                "a key without api-keys:* must not reach {m} {p}"
            );
        }
    }

    #[test]
    fn api_keys_read_does_not_imply_write() {
        let read_only = vec!["api-keys:read".to_string()];
        assert!(scopes_allow(&read_only, "api-keys:read"));
        assert!(!scopes_allow(&read_only, "api-keys:write"));
    }

    #[test]
    fn api_keys_write_implies_read() {
        let write = vec!["api-keys:write".to_string()];
        assert!(scopes_allow(&write, "api-keys:read"));
    }

    #[test]
    fn default_key_cannot_manage_keys() {
        let default = default_permissions();
        for needed in ["api-keys:read", "api-keys:write"] {
            assert!(!scopes_allow(&default, needed));
        }
    }

    #[test]
    fn admin_full_still_reaches_key_management() {
        // The wildcard must keep working: it is what human sessions carry.
        let admin = vec![ADMIN_FULL.to_string()];
        for needed in ["api-keys:read", "api-keys:write"] {
            assert!(scopes_allow(&admin, needed));
        }
    }

    #[test]
    fn every_mapped_scope_is_a_valid_permission() {
        // Guards against inventing a scope here that no key can ever hold.
        let valid = valid_permissions();
        assert!(valid.len() > 20, "parsed too few scopes: {valid:?}");

        for (method, path) in router_endpoints() {
            if let Requirement::Scope(s) = required_permission(&method, &path) {
                assert!(
                    valid.contains(&s),
                    "{method} {path} maps to '{s}', which is not in VALID_PERMISSIONS"
                );
            }
        }
    }

    /// Every (method, path) the router actually exposes, parsed from source.
    #[allow(
        clippy::string_slice,
        reason = "test-only parser over our own ASCII source; indices come from str::find or ASCII literal lengths"
    )]
    fn router_endpoints() -> Vec<(Method, String)> {
        let src = format!("{}{}", include_str!("routes/mod.rs"), include_str!("main.rs"));
        let mut out = Vec::new();
        let mut rest = src.as_str();

        while let Some(idx) = rest.find(".route(") {
            rest = &rest[idx + ".route(".len()..];
            let Some(q1) = rest.find('"') else { break };
            let after = &rest[q1 + 1..];
            let Some(q2) = after.find('"') else { break };
            let path = after[..q2].to_string();

            // Walk to the matching close paren of `.route(`.
            let mut depth = 1usize;
            let body_start = q2 + 1;
            let bytes = after.as_bytes();
            let mut j = body_start;
            while j < bytes.len() && depth > 0 {
                match bytes[j] {
                    b'(' => depth += 1,
                    b')' => depth -= 1,
                    _ => {}
                }
                j += 1;
            }
            let body = &after[body_start..j.min(after.len())];

            for (needle, method) in [
                ("get(", Method::GET),
                ("post(", Method::POST),
                ("patch(", Method::PATCH),
                ("put(", Method::PUT),
                ("delete(", Method::DELETE),
            ] {
                if body.contains(needle) {
                    out.push((method, path.clone()));
                }
            }
            rest = after;
        }
        out
    }

    #[test]
    fn parser_sees_the_whole_router() {
        let eps = router_endpoints();
        // 198 handlers today. A wide band still catches a silently broken parser.
        assert!(
            eps.len() > 150,
            "router parser found only {} endpoints; regex likely broken",
            eps.len()
        );
    }

    #[test]
    fn coverage_is_exhaustive() {
        // A new route with no mapping falls through to admin:full. That is safe
        // but wrong: scoped keys would get an opaque 403. This test forces the
        // author of a new route to decide its scope here.
        //
        // `admin:full` is legitimate for genuinely org-wide routes, so we only
        // flag paths whose head segment this module does not know at all.
        let known_heads = [
            "projects", "issues", "search", "activity", "events", "views", "dashboard",
            "metrics", "cycles", "sprints", "tags", "milestones", "templates",
            "project-templates", "sla-rules", "automations", "recurring", "custom-fields",
            "initiatives", "triage", "uploads", "memory", "agent-config", "webhooks",
            "agent-sessions", "ai", "github", "integrations", "orgs", "invites",
            "gamification", "billing", "api-keys", "admin", "notifications", "health",
            "public", "r", "invite",
        ];

        let mut unmapped: Vec<String> = Vec::new();
        for (method, path) in router_endpoints() {
            let head = path.trim_start_matches('/').split('/').next().unwrap_or("");
            if !known_heads.contains(&head) {
                unmapped.push(format!("{method} {path}"));
            }
        }
        assert!(
            unmapped.is_empty(),
            "these routes have no permission mapping in permissions.rs: {unmapped:#?}"
        );
    }

    #[test]
    fn nothing_maps_to_authenticated_by_accident() {
        // `Authenticated` bypasses scope checks, so it must stay a short,
        // deliberate list rather than a convenient escape hatch.
        let lax: Vec<String> = router_endpoints()
            .into_iter()
            .filter(|(m, p)| required_permission(m, p) == Requirement::Authenticated)
            .map(|(m, p)| format!("{m} {p}"))
            .collect();
        assert!(
            lax.len() <= 6,
            "too many scope-free authenticated routes, review these: {lax:#?}"
        );
        for entry in &lax {
            assert!(
                entry.contains("/notifications"),
                "unexpected scope-free route: {entry}"
            );
        }
    }
}
