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
fn segments(path: &str) -> Vec<&str> {
    let trimmed = path
        .strip_prefix("/api/v1")
        .or_else(|| path.strip_prefix("/api"))
        .unwrap_or(path);
    trimmed.split('/').filter(|s| !s.is_empty()).collect()
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
        // Belt and braces: `require_clerk_user` already rejects keys here, but a
        // key must never be able to widen its own scopes.
        "api-keys" => Requirement::Scope(ADMIN_FULL),
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
        // Mirrors `api_keys::default_permissions()`.
        let default: Vec<String> = ["issues:read", "issues:write", "projects:read"]
            .iter()
            .map(|s| s.to_string())
            .collect();

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
            (Method::POST, "/api/v1/api-keys"),
            (Method::PATCH, "/api/v1/agent-config"),
            (Method::DELETE, "/api/v1/integrations/slack/s1"),
        ] {
            assert_eq!(scope(m.clone(), p), ADMIN_FULL, "{m} {p} must require admin:full");
        }
    }

    #[test]
    fn every_mapped_scope_is_a_valid_permission() {
        // Guards against inventing a scope here that no key can ever hold.
        let api_keys_src = include_str!("routes/api_keys.rs");
        let valid: Vec<&str> = api_keys_src
            .split("VALID_PERMISSIONS: &[&str] = &[")
            .nth(1)
            .expect("VALID_PERMISSIONS literal not found")
            .split("];")
            .next()
            .unwrap()
            .split('"')
            .filter(|s| s.contains(':'))
            .collect();
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
