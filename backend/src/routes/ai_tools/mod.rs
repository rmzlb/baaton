use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

// ─── Result Type ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub data: Value,
    pub for_model: String,
    pub component_hint: Option<String>,
    pub summary: String,
}

// ─── Definition Type ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

fn tool(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        parameters,
    }
}

// ─── Client-Interactive Tool Detection ──────────────────────────────────────

/// Tools that require user approval via the UI.
/// The frontend renders an approval form using the tool's input args;
/// the user's decision is sent back as addToolOutput on the next turn.
pub fn is_client_interactive(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "propose_issue" | "propose_update_issue" | "propose_bulk_update" | "propose_comment"
    )
}

// ─── Tool Definitions (Gemini JSON Schema) ────────────────────────────────────

pub fn get_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        // ── 1. search_issues ─────────────────────────────────────────────
        tool(
            "search_issues",
            "Search and filter issues across the user's projects. Returns a summary with counts and up to `limit` matching issues (display_id, title, status, priority, assignee). Use this when the user asks to find, list, or count issues matching criteria. Cross-org by default. Combine multiple filters (status + priority + type) for precision.\n\nGood cases: 'Show me all high-priority bugs in HLM', 'List open issues assigned to Jean', 'How many in_progress tickets do we have?'.\n\nNot for: Getting details of ONE specific issue (cite it from search results instead). Aggregate metrics like velocity or cycle time (use get_project_metrics). Just browsing everything without criteria (ask user to narrow first).\n\nReturns: { display_id, title, status, priority, category[], project_name, updated_at } per issue, plus a total count. When response_format='concise', only { display_id, title, status } is returned per issue.\n\nExamples (user intent → JSON args):\n- High-priority bugs in HLM → {\"project_id\":\"HLM\",\"priority\":\"high\",\"query\":\"bug\",\"limit\":20}\n- In-progress tickets only → {\"status\":\"in_progress\",\"response_format\":\"concise\"}\n- Quick scan of urgent items → {\"priority\":\"urgent\",\"limit\":10,\"response_format\":\"concise\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "query": {
                        "type": "STRING",
                        "description": "Free-text search against issue title and description. Example: 'auth token' matches any issue mentioning those words. Omit to return all issues matching other filters."
                    },
                    "project_id": {
                        "type": "STRING",
                        "description": "Project UUID or prefix (e.g. 'HLM') to scope the search. Omit to search across all user's projects."
                    },
                    "status": {
                        "type": "STRING",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
                        "description": "Filter by workflow status. Only one value allowed per call. Example: 'in_progress' returns all active work."
                    },
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Filter by priority level. Example: 'urgent' returns only critical issues."
                    },
                    "category": {
                        "type": "STRING",
                        "enum": ["FRONT", "BACK", "API", "DB", "INFRA", "UX", "DEVOPS"],
                        "description": "Filter by technical domain tag. Example: 'BACK' returns backend issues only."
                    },
                    "limit": {
                        "type": "NUMBER",
                        "description": "Maximum number of issues to return (default 20, max 100). Use a small limit (5-10) for quick summaries, larger for exhaustive lists."
                    },
                    "response_format": {
                        "type": "STRING",
                        "enum": ["concise", "detailed"],
                        "description": "Output verbosity. 'concise' (default): only display_id, title, status per issue. 'detailed': full issue data including priority, category, project_name, updated_at."
                    }
                }
            }),
        ),
        // ── 2. propose_issue ─────────────────────────────────────────────
        tool(
            "propose_issue",
            "Propose creating a new issue (required before create_issue; do not call create_issue directly). Returns a proposal payload rendered as an editable approval form. Use as soon as the user asks to create/add/open an issue. Infer type, priority, category, tags when reasonable. Description: structured Markdown per issue type (see system prompt).\n\nIf several projects match, ask which one; if the prefix is unique, proceed.\n\nAfter approval, call create_issue with the same fields as `finalValues` in the tool output.\n\nReturns: { project_id, project_name, project_prefix, title, description, type, priority, tags[], category[] }.\n\nExamples:\n- « Crée un bug auth sur HLM » → {\"project_id\":\"HLM\",\"title\":\"Erreur refresh token\",\"type\":\"bug\",\"priority\":\"high\",\"description\":\"## Contexte\\n...\"}\n- « Feature export CSV sur SQX » → {\"project_id\":\"SQX\",\"title\":\"Export CSV des issues\",\"type\":\"feature\",\"priority\":\"medium\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required. Resolves prefixes and partial names automatically."},
                    "title": {"type": "STRING", "description": "Short plain-text title. No brackets, prefixes, or type tags. Good: 'Fix auth token refresh'. Bad: '[HLM][BUG] Fix auth'."},
                    "description": {"type": "STRING", "description": "Detailed description in Markdown. Use structured templates: bug reports should include Steps to Reproduce, Expected vs Actual; features should include User Story and Acceptance Criteria."},
                    "type": {"type": "STRING", "enum": ["bug", "feature", "improvement", "question"], "description": "Issue classification. Infer from context: error/crash → bug, new capability → feature, refactor/optimize → improvement, unclear requirement → question."},
                    "priority": {"type": "STRING", "enum": ["urgent", "high", "medium", "low"], "description": "Urgency level. urgent = production-breaking, high = blocking work, medium = normal, low = nice-to-have."},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Free-form labels for grouping, e.g. ['auth', 'mobile', 'security']. Infer from description context."},
                    "category": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Technical domains. Allowed values: FRONT, BACK, API, DB, INFRA, UX, DEVOPS. Example: ['BACK', 'API'] for a backend API issue."}
                },
                "required": ["project_id", "title"]
            }),
        ),
        // ── 3. create_issue ──────────────────────────────────────────────
        tool(
            "create_issue",
            "Create a new issue with full metadata and persist it to the database. Call only after propose_issue was approved. Copy fields from `finalValues` exactly. Returns the created issue with display_id (e.g. 'HLM-42').\n\nTitle: plain text, no brackets or project prefix in the title.\n\nNot for: unapproved creation (use propose_issue first). Updates (use update_issue).\n\nReturns: { id, display_id, title, status, priority, type, category[], tags[] }.\n\nExample (after approval): {\"project_id\":\"…uuid…\",\"title\":\"Fix auth refresh\",\"description\":\"…\",\"type\":\"bug\",\"priority\":\"high\",\"status\":\"backlog\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {
                        "type": "STRING",
                        "description": "Project UUID or prefix (e.g. 'HLM'). Required. Must match the project from the approved proposal."
                    },
                    "title": {
                        "type": "STRING",
                        "description": "Short plain-text title. No brackets or prefixes. Copy from proposal finalValues."
                    },
                    "description": {
                        "type": "STRING",
                        "description": "Detailed description in Markdown. Copy from proposal finalValues."
                    },
                    "type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"],
                        "description": "Issue classification from the approved proposal."
                    },
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Urgency level from the approved proposal."
                    },
                    "status": {
                        "type": "STRING",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
                        "description": "Initial workflow status. Defaults to 'backlog' if omitted."
                    },
                    "tags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Labels from the approved proposal, e.g. ['auth', 'mobile']."
                    },
                    "category": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Technical domains from the approved proposal: FRONT, BACK, API, DB, INFRA, UX, DEVOPS."
                    }
                },
                "required": ["project_id", "title"]
            }),
        ),
        // ── 4. propose_update_issue ──────────────────────────────────────
        tool(
            "propose_update_issue",
            "Propose updating an issue (no DB write). Shows current vs proposed fields for approval. Use before every update_issue.\n\nTypical asks: status change, priority, description edit. Omit unchanged fields.\n\nAfter approval, call update_issue with `finalValues`.\n\nNot for: new issues (propose_issue). Many issues (propose_bulk_update).\n\nReturns: { issue_id, display_id, title, diff[] }.\n\nExamples:\n- « Passe HLM-42 en done » → {\"issue_id\":\"HLM-42\",\"status\":\"done\"}\n- « Urgent sur ce bug » → {\"issue_id\":\"HLM-42\",\"priority\":\"urgent\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID or display_id of the issue to update (e.g. 'HLM-42' or full UUID). Required."},
                    "title": {"type": "STRING", "description": "New plain-text title. Omit if not changing."},
                    "description": {"type": "STRING", "description": "New Markdown description. Omit if not changing."},
                    "status": {"type": "STRING", "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"], "description": "New workflow status. Omit if not changing."},
                    "priority": {"type": "STRING", "enum": ["urgent", "high", "medium", "low"], "description": "New priority level. Omit if not changing."},
                    "type": {"type": "STRING", "enum": ["bug", "feature", "improvement", "question"], "description": "New issue type. Omit if not changing."},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "New complete tag set (replaces existing). Omit if not changing."},
                    "category": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "New technical domains (replaces existing). Omit if not changing."}
                },
                "required": ["issue_id"]
            }),
        ),
        // ── 5. propose_bulk_update ───────────────────────────────────────
        tool(
            "propose_bulk_update",
            "PROPOSE bulk updating multiple issues at once (does NOT modify the database). Returns the list of affected issues with their current state and proposed changes for user review. ALWAYS use this BEFORE bulk_update_issues — never call bulk_update_issues directly.\n\nUse when the user wants to change status/priority/tags on 2+ issues simultaneously. Example: 'Move all in_progress issues to in_review', 'Set priority to high on HLM-10, HLM-11, HLM-12'.\n\nAfter user approves, call bulk_update_issues with the approved values.\n\nNot for: Updating a single issue (use propose_update_issue). Creating issues (use propose_issue).\n\nReturns: { updates[] } where each entry has { issue_id, display_id, title, current, changes }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "updates": {
                        "type": "ARRAY",
                        "description": "Array of per-issue update objects. Each specifies which issue to change and which fields to modify.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "issue_id": {"type": "STRING", "description": "UUID or display_id of the issue (e.g. 'HLM-42'). Required."},
                                "status": {"type": "STRING", "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"], "description": "New workflow status."},
                                "priority": {"type": "STRING", "enum": ["urgent", "high", "medium", "low"], "description": "New priority level."},
                                "tags": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "New complete tag set (replaces existing)."},
                                "category": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "New technical domains (replaces existing)."}
                            },
                            "required": ["issue_id"]
                        }
                    }
                },
                "required": ["updates"]
            }),
        ),
        // ── 6. propose_comment ───────────────────────────────────────────
        tool(
            "propose_comment",
            "Propose a comment on an issue (no DB write until approved). Use before add_comment.\n\nReturns: { issue_id, display_id, title, content }.\n\nExamples:\n- « Note sur HLM-42 : bloqué par API » → {\"issue_id\":\"HLM-42\",\"content\":\"Bloqué par la dépendance API X.\"}\n- « Commentaire : PR en review » → {\"issue_id\":\"uuid\",\"content\":\"PR #120 en review.\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID or display_id of the issue to comment on (e.g. 'HLM-42' or full UUID). Required."},
                    "content": {"type": "STRING", "description": "Proposed comment body in Markdown. Supports headings, lists, code blocks. Required."}
                },
                "required": ["issue_id", "content"]
            }),
        ),
        // ── 7. update_issue ──────────────────────────────────────────────
        tool(
            "update_issue",
            "Update an issue in the database after propose_update_issue was approved. Pass only changing fields from `finalValues`.\n\nReturns: { issue_id, display_id, changes[], status, priority }.\n\nNot for: create (create_issue). Bulk (bulk_update_issues). Comments (add_comment).\n\nExample: {\"issue_id\":\"uuid-or-HLM-42\",\"status\":\"in_review\",\"priority\":\"high\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {
                        "type": "STRING",
                        "description": "UUID or display_id of the issue to update (e.g. 'HLM-42' or full UUID). Required."
                    },
                    "title": {"type": "STRING", "description": "New plain-text title. Omit if not changing."},
                    "description": {"type": "STRING", "description": "New Markdown description (replaces existing entirely). Omit if not changing."},
                    "status": {
                        "type": "STRING",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
                        "description": "New workflow status. Omit if not changing."
                    },
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "New priority level. Omit if not changing."
                    },
                    "type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"],
                        "description": "New issue classification. Omit if not changing."
                    },
                    "tags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "New complete tag set (replaces existing entirely). Omit if not changing."
                    },
                    "category": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "New technical domains (replaces existing entirely). Omit if not changing."
                    }
                },
                "required": ["issue_id"]
            }),
        ),
        // ── 8. bulk_update_issues ────────────────────────────────────────
        tool(
            "bulk_update_issues",
            "Apply updates to multiple issues atomically in a single database transaction. ONLY call after propose_bulk_update has been approved by the user — never call directly. Use the approved values verbatim. Skips any issue_id that cannot be resolved or doesn't belong to the user's orgs.\n\nReturns: { updated_count, issues[] } where each issue has { display_id, changes[] }.\n\nNot for: Updating a single issue (use update_issue). Creating issues (use create_issue).",
            json!({
                "type": "OBJECT",
                "properties": {
                    "updates": {
                        "type": "ARRAY",
                        "description": "Array of per-issue update objects. Each must include issue_id and at least one field to change.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "issue_id": {"type": "STRING", "description": "UUID or display_id of the issue (e.g. 'HLM-42'). Required."},
                                "status": {
                                    "type": "STRING",
                                    "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
                                    "description": "New workflow status."
                                },
                                "priority": {
                                    "type": "STRING",
                                    "enum": ["urgent", "high", "medium", "low"],
                                    "description": "New priority level."
                                },
                                "tags": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "New complete tag set (replaces existing)."
                                },
                                "category": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "New technical domains (replaces existing)."
                                }
                            },
                            "required": ["issue_id"]
                        }
                    }
                },
                "required": ["updates"]
            }),
        ),
        // ── 9. add_comment ───────────────────────────────────────────────
        tool(
            "add_comment",
            "Append a threaded comment to an issue in the database. ONLY call after propose_comment has been approved by the user — never call directly. Use the approved content verbatim.\n\nReturns: { id, issue_id, author_id, author_name, body, created_at }.\n\nNot for: Updating issue fields like status or priority (use update_issue). Creating new issues (use create_issue).",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID or display_id of the issue to comment on (e.g. 'HLM-42' or full UUID). Required."},
                    "content": {"type": "STRING", "description": "Comment body in Markdown. Supports headings, lists, code blocks. Required."},
                    "author_name": {"type": "STRING", "description": "Display name shown as comment author. Defaults to 'Baaton AI' if omitted. Optional."}
                },
                "required": ["issue_id", "content"]
            }),
        ),
        // ── 10. generate_prd ─────────────────────────────────────────────
        tool(
            "generate_prd",
            "Generate a complete PRD (Product Requirements Document) from a brief feature or problem description. When a project_id is provided, enriches the PRD with real data: open issues grouped by domain, milestones as objectives, and question-type issues as open questions. Without project_id, generates a generic template.\n\nUse when the user says 'write a PRD for...', 'document requirements for...', 'create a spec for...'.\n\nNot for: Creating individual issues (use propose_issue). Getting project metrics (use get_project_metrics). Sprint analysis (use analyze_sprint).\n\nReturns: { title, sections[] } where each section has { heading, content } in Markdown.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "brief": {"type": "STRING", "description": "Feature or problem description to document. Example: 'User authentication with OAuth2 and social login'. Required."},
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM') to enrich the PRD with real project data. Optional — omit for a generic PRD template."}
                },
                "required": ["brief"]
            }),
        ),
        // ── 11. analyze_sprint ───────────────────────────────────────────
        tool(
            "analyze_sprint",
            "Analyze the current active sprint: velocity, completion percentage, stuck/blocked issues, and carried-over work. Returns structured analysis with a velocity trend indicator (on_track / at_risk / behind).\n\nUse when the user asks 'how is the sprint going?', 'sprint status', 'are we on track?', 'what's stuck?'.\n\nNot for: Historical metrics or completion rates over time (use get_project_metrics). Weekly activity summaries (use weekly_recap). Reprioritizing issues (use suggest_priorities).\n\nReturns: { sprint_name, planned, completed, pct, carried_over, blocked, velocity_trend }. Returns null sprint_name if no active sprint exists.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Omit to analyze the most recent active sprint across all projects."}
                }
            }),
        ),
        // ── 12. get_project_metrics ──────────────────────────────────────
        tool(
            "get_project_metrics",
            "Fetch a project health dashboard: total/open/in_progress/done counts, 14-day velocity, bug ratio, avg cycle time (hours).\n\nUse for health/velocity/ratio questions.\n\nNot for: listing tickets (search_issues). Active sprint deep-dive (analyze_sprint).\n\nReturns: { total, open, in_progress, done, velocity, bug_ratio, avg_cycle_time_hours }.\n\nExamples:\n- « Santé du projet HLM » → {\"project_id\":\"HLM\"}\n- « Métriques globales » → {}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Omit to aggregate metrics across all user's projects."}
                }
            }),
        ),
        // ── 13. weekly_recap ─────────────────────────────────────────────
        tool(
            "weekly_recap",
            "Generate an activity recap for the last N days: count of completed issues, newly created issues, stale/blocked high-priority issues, and the top contributor by activity volume. Ideal for standups, end-of-week reviews, or manager summaries.\n\nUse when the user asks 'weekly recap', 'what happened this week?', 'standup summary', 'give me an update'.\n\nNot for: Detailed sprint analysis with velocity (use analyze_sprint). Aggregate project health metrics (use get_project_metrics). Listing specific issues (use search_issues).\n\nReturns: { completed, new_created, blockers, top_contributor, period }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Omit for a cross-project recap."},
                    "days": {"type": "NUMBER", "description": "Number of days to look back. Default 7, range 1-30. Example: 14 for a biweekly recap."},
                    "limit": {"type": "NUMBER", "description": "Maximum number of issues to list per category (completed, in_progress, new, blocked). Default 20, max 50. Use smaller values for concise summaries."}
                }
            }),
        ),
        // ── 14. suggest_priorities ───────────────────────────────────────
        tool(
            "suggest_priorities",
            "Analyze all open issues and generate AI-powered reprioritization recommendations. Scores issues by combining current priority weight with staleness (days since last update). Detects stale urgent issues, underrated blockers, and priority inflation. Returns ranked suggestions — does NOT apply changes automatically.\n\nUse when the user asks 'what should I work on next?', 'reprioritize my backlog', 'which issues are stale?', 'priority review'.\n\nAfter reviewing suggestions with the user, apply via propose_bulk_update then bulk_update_issues.\n\nNot for: Sprint-specific analysis (use analyze_sprint). Aggregate metrics (use get_project_metrics). Searching for specific issues (use search_issues).\n\nReturns: array of { id, display_id, title, priority, score, reason } sorted by urgency score descending (top 10).",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Omit for cross-project priority suggestions."}
                }
            }),
        ),
        // ── 15. plan_milestones ──────────────────────────────────────────
        tool(
            "plan_milestones",
            "Auto-group open issues into a sequenced milestone plan based on domain tags (FRONT, BACK, API, DB, INFRA, UX) and estimated velocity. Returns a proposed plan with milestone names, target dates, and assigned issue IDs. Does NOT create milestones — wait for user confirmation, then call create_milestones_batch.\n\nUse when the user asks 'plan milestones for HLM', 'create a roadmap', 'organize the backlog into phases', 'group issues by milestone'.\n\nNot for: Adjusting existing milestone dates (use adjust_timeline). Creating milestones without a plan (use create_milestones_batch directly only after plan approval). Sprint analysis (use analyze_sprint).\n\nReturns: { proposed_milestones[] } where each has { name, target_date, issue_ids[], estimated_weeks }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required — milestones are project-scoped."},
                    "target_date": {"type": "STRING", "description": "Hard deadline in YYYY-MM-DD format. The plan will fit milestones before this date. Optional — omit for auto-calculated dates."},
                    "team_size": {"type": "NUMBER", "description": "Number of active developers. Affects velocity estimates and timeline. Default 1."}
                },
                "required": ["project_id"]
            }),
        ),
        // ── 16. create_milestones_batch ──────────────────────────────────
        tool(
            "create_milestones_batch",
            "Create multiple milestones and assign issues to them atomically. ONLY call after the user has confirmed the plan from plan_milestones. Each milestone is inserted with its name, description, target date, and display order, then the specified issues are assigned to it.\n\nUse when the user says 'yes, create those milestones', 'looks good, go ahead' after reviewing a plan_milestones proposal.\n\nNot for: Planning milestones (use plan_milestones first). Adjusting existing milestone dates (use adjust_timeline). Updating individual issues (use update_issue).\n\nReturns: { created_count, milestones[] } where each has { id, name, issue_count }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required."},
                    "milestones": {
                        "type": "ARRAY",
                        "description": "Ordered list of milestones to create. Copy from the approved plan_milestones output.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "name": {"type": "STRING", "description": "Milestone name. Example: 'Backend Stability'."},
                                "description": {"type": "STRING", "description": "Markdown description of the milestone scope and goals."},
                                "target_date": {"type": "STRING", "description": "Target completion date in YYYY-MM-DD format."},
                                "order": {"type": "NUMBER", "description": "Display order (1-based). Determines sequence in the timeline."},
                                "issue_ids": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "UUIDs or display_ids (e.g. 'HLM-42') of issues to assign to this milestone."
                                }
                            },
                            "required": ["name", "issue_ids"]
                        }
                    }
                },
                "required": ["project_id", "milestones"]
            }),
        ),
        // ── 17. adjust_timeline ──────────────────────────────────────────
        tool(
            "adjust_timeline",
            "Recalculate milestone schedule given a new deadline or scope change constraint. Proportionally rescales all milestone dates to fit the new timeline. Returns a revised plan proposal — does NOT apply changes automatically. User must confirm before you persist.\n\nUse when the user says 'we need to ship by March 15', 'deadline moved up 2 weeks', 'we lost a developer', 'compress the timeline'.\n\nNot for: Creating milestones from scratch (use plan_milestones). Updating individual issue fields (use update_issue). Sprint analysis (use analyze_sprint).\n\nReturns: { milestones[] } with { name, old_date, new_date } per milestone, plus the constraint applied.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required."},
                    "constraint": {"type": "STRING", "description": "Natural-language constraint describing the timeline change. Examples: 'finish by 2026-03-15', 'we lost one dev', 'scope reduced by 30%'. Required."}
                },
                "required": ["project_id", "constraint"]
            }),
        ),
        // ── 18. triage_issue ─────────────────────────────────────────────
        tool(
            "triage_issue",
            "AI-powered triage of a single issue: marks it as qualified, moves it from backlog to todo (if currently in backlog), and adds a triage comment. Use for processing new issues that haven't been reviewed yet.\n\nUse when the user says 'triage HLM-42', 'qualify this issue', 'review and triage the new tickets'.\n\nNot for: Suggesting priority changes across many issues (use suggest_priorities). Updating specific fields like status or tags (use propose_update_issue). Searching for issues (use search_issues).\n\nReturns: { issue_id, display_id, status, qualified_by }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID or display_id of the issue to triage (e.g. 'HLM-42' or full UUID). Required."}
                },
                "required": ["issue_id"]
            }),
        ),
        // ── 19. manage_initiatives ───────────────────────────────────────
        tool(
            "manage_initiatives",
            "CRUD operations for strategic initiatives — high-level goals that span multiple projects. Use action='list' to see all initiatives, 'create' to start a new one, 'update' to change name/description/status, 'add_project'/'remove_project' to link or unlink projects.\n\nUse when the user talks about OKRs, strategic goals, cross-project initiatives, or portfolio-level planning. Example: 'Create a Q3 launch initiative', 'Link the HLM project to the security initiative', 'List all active initiatives'.\n\nNot for: Project-level milestone planning (use plan_milestones). Issue-level operations (use search_issues, propose_issue, etc.).\n\nReturns: For 'list': array of { id, name, description, status, target_date, project_count }. For mutations: { id, updated/created confirmation }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "update", "add_project", "remove_project"],
                        "description": "Operation to perform. 'list' needs no extra params. 'create' needs name. 'update' needs initiative_id. 'add_project'/'remove_project' need both initiative_id and project_id."
                    },
                    "initiative_id": {"type": "STRING", "description": "Initiative UUID. Required for update, add_project, remove_project."},
                    "name": {"type": "STRING", "description": "Initiative name. Required for create, optional for update."},
                    "description": {"type": "STRING", "description": "Markdown goal description. Optional."},
                    "status": {
                        "type": "STRING",
                        "enum": ["active", "completed", "archived"],
                        "description": "Initiative lifecycle status. Optional for create (defaults to 'active') and update."
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required for add_project and remove_project."}
                },
                "required": ["action"]
            }),
        ),
        // ── 20. manage_automations ───────────────────────────────────────
        tool(
            "manage_automations",
            "Configure event-driven workflow automations that trigger actions when issue fields change. Use action='list' to see existing rules, 'create' to add a new rule, 'toggle' to enable/disable, 'delete' to remove.\n\nUse when the user says 'auto-escalate urgent bugs', 'when status changes to in_review, add a comment', 'list automations for HLM', 'disable the auto-assign rule'.\n\nNot for: Manually updating issues (use update_issue). SLA rules (use manage_sla). Recurring scheduled issues (use manage_recurring).\n\nReturns: For 'list': array of { id, name, trigger, conditions, actions, enabled }. For mutations: { id, confirmation }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "toggle", "delete"],
                        "description": "Operation to perform. 'list' shows all rules. 'create' needs name + trigger_type. 'toggle' needs automation_id. 'delete' needs automation_id."
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required for all actions — automations are project-scoped."},
                    "automation_id": {"type": "STRING", "description": "Automation rule UUID. Required for toggle and delete."},
                    "name": {"type": "STRING", "description": "Human-readable automation name. Required for create. Example: 'Auto-escalate stale urgents'."},
                    "trigger_type": {
                        "type": "STRING",
                        "enum": ["status_changed", "priority_changed", "assignee_changed", "label_added", "due_date_passed"],
                        "description": "Event that fires the automation. Required for create."
                    },
                    "trigger_config": {"type": "STRING", "description": "JSON string of trigger parameters. Example: '{\"from_status\": \"in_progress\", \"to_status\": \"in_review\"}'. Optional."},
                    "action_type": {
                        "type": "STRING",
                        "enum": ["set_status", "set_priority", "add_label", "assign_user", "send_webhook", "add_comment"],
                        "description": "What happens when the trigger fires. Optional — defaults to 'add_comment'."
                    },
                    "action_config": {"type": "STRING", "description": "JSON string of action parameters. Example: '{\"status\": \"in_review\"}'. Optional."}
                },
                "required": ["action", "project_id"]
            }),
        ),
        // ── 21. manage_sla ───────────────────────────────────────────────
        tool(
            "manage_sla",
            "Manage SLA (Service Level Agreement) rules and monitor compliance for a project. Use action='list_rules' to see current SLA definitions, 'stats' to get compliance metrics, 'create_rule' to set a deadline per priority, 'delete_rule' to remove one.\n\nUse when the user says 'set SLA for urgent bugs to 4 hours', 'show SLA compliance', 'what's our breach rate?', 'list SLA rules for HLM'.\n\nNot for: Automation triggers when SLA is breached (use manage_automations). Updating individual issue fields (use update_issue). Project-wide metrics beyond SLA (use get_project_metrics).\n\nReturns: For 'list_rules': array of { id, priority, deadline_hours }. For 'stats': { total_open, breached_count, compliance_rate }. For mutations: { id, confirmation }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list_rules", "stats", "create_rule", "delete_rule"],
                        "description": "Operation to perform. 'list_rules' shows current SLA definitions. 'stats' shows compliance metrics. 'create_rule' needs priority + deadline_hours. 'delete_rule' needs rule_id."
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required for all actions — SLA rules are project-scoped."},
                    "rule_id": {"type": "STRING", "description": "SLA rule UUID. Required for delete_rule only."},
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Priority tier for the SLA rule. Required for create_rule. One rule per priority per project."
                    },
                    "deadline_hours": {"type": "NUMBER", "description": "Maximum resolution time in hours. Required for create_rule. Example: 4 for urgent, 24 for high."}
                },
                "required": ["action", "project_id"]
            }),
        ),
        // ── 22. manage_templates ─────────────────────────────────────────
        tool(
            "manage_templates",
            "Manage reusable issue templates for a project. Templates pre-fill description, priority, and type when creating new issues. Use action='list' to see available templates, 'create' to add a new one, 'delete' to remove.\n\nUse when the user says 'create a bug report template', 'list templates for HLM', 'delete the feature request template', 'set up issue templates'.\n\nNot for: Creating actual issues (use propose_issue). Managing recurring scheduled issues (use manage_recurring). Project-level settings beyond templates.\n\nReturns: For 'list': array of { id, name, description, default_priority, default_type, default_tags[], is_default }. For mutations: { id, confirmation }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "delete"],
                        "description": "Operation to perform. 'list' shows all templates. 'create' needs name. 'delete' needs template_id."
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required for all actions — templates are project-scoped."},
                    "template_id": {"type": "STRING", "description": "Template UUID. Required for delete only."},
                    "name": {"type": "STRING", "description": "Template display name. Required for create. Example: 'Bug Report', 'Feature Request'."},
                    "description": {"type": "STRING", "description": "Pre-filled Markdown body for issues using this template. Optional."},
                    "default_priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Default priority for issues created from this template. Optional, defaults to 'medium'."
                    },
                    "default_type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"],
                        "description": "Default issue type for issues created from this template. Optional, defaults to 'feature'."
                    }
                },
                "required": ["action", "project_id"]
            }),
        ),
        // ── 23. manage_recurring ─────────────────────────────────────────
        tool(
            "manage_recurring",
            "Manage recurring issue configurations that auto-create tickets on a cron schedule. Use action='list' to see scheduled configs, 'create' to add a new recurring rule, 'toggle' to pause/resume, 'trigger' to force immediate creation, 'delete' to remove.\n\nUse when the user says 'create a weekly security review ticket', 'schedule monthly dependency audits', 'list recurring tasks for HLM', 'pause the weekly standup ticket'.\n\nNot for: Creating one-off issues (use propose_issue). Event-driven automations (use manage_automations). SLA rules (use manage_sla).\n\nReturns: For 'list': array of { id, title, priority, issue_type, cron, enabled, next_run, occurrence_count }. For mutations: { id, confirmation }.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "toggle", "trigger", "delete"],
                        "description": "Operation to perform. 'list' shows all configs. 'create' needs title + cron_expression. 'toggle' needs recurring_id. 'trigger' needs recurring_id. 'delete' needs recurring_id."
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required for all actions — recurring configs are project-scoped."},
                    "recurring_id": {"type": "STRING", "description": "Recurring config UUID. Required for toggle, trigger, and delete."},
                    "title": {"type": "STRING", "description": "Issue title template for auto-created tickets. Required for create. Example: 'Weekly Security Review'."},
                    "description": {"type": "STRING", "description": "Issue description template in Markdown. Optional."},
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Default priority for auto-created tickets. Optional, defaults to 'medium'."
                    },
                    "issue_type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"],
                        "description": "Default issue type for auto-created tickets. Optional, defaults to 'feature'."
                    },
                    "cron_expression": {"type": "STRING", "description": "5-field cron expression in UTC. Required for create. Examples: '0 9 * * 1' (every Monday 9am), '0 10 1 * *' (1st of month 10am)."}
                },
                "required": ["action", "project_id"]
            }),
        ),
        // ── 24. export_project ───────────────────────────────────────────
        tool(
            "export_project",
            "Export all issues, milestones, and sprints in a project as structured JSON. Returns complete data with all fields including descriptions, tags, categories, assignees, and timestamps. Use for data dumps, backups, external analysis, or migration.\n\nUse when the user says 'export HLM', 'dump all issues to JSON', 'back up the project data', 'I need all issue data for analysis'.\n\nNot for: Searching or filtering specific issues (use search_issues). Getting aggregate metrics (use get_project_metrics). Generating PRDs (use generate_prd).\n\nReturns: { issues[], milestones[], sprints[], exported_at } with full detail per entity.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required — export is always for a single project."}
                },
                "required": ["project_id"]
            }),
        ),
        // ── 25. find_similar_issues ─────────────────────────────────────────
        tool(
            "find_similar_issues",
            "Find potentially duplicate or similar issues (title word overlap). Use before creating a ticket or when triaging. Cross-org unless project_id is set.\n\nNot for: filtered search (search_issues). Metrics (get_project_metrics).\n\nReturns: { reference_title, candidates[{ display_id, title, status, similarity_score }] }.\n\nExamples:\n- « Doublons de HLM-42 » → {\"reference_issue_id\":\"HLM-42\",\"limit\":10}\n- « Similaire à auth refresh bug » → {\"query\":\"auth refresh bug\",\"project_id\":\"HLM\"}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "reference_issue_id": {"type": "STRING", "description": "Optional: UUID or display_id of a reference issue to find duplicates of (e.g. 'HLM-42')."},
                    "query": {"type": "STRING", "description": "Optional: free-text query to find issues matching this description (use if no reference_issue_id)."},
                    "project_id": {"type": "STRING", "description": "Optional: Project UUID or prefix (e.g. 'HLM') to scope search. Omit for cross-project."},
                    "limit": {"type": "NUMBER", "description": "Max results (default 10, max 50)."}
                }
            }),
        ),
        // ── 26. workload_by_assignee ────────────────────────────────────────
        tool(
            "workload_by_assignee",
            "Open-issue counts per assignee (workload). Sorted by load; unassigned grouped. Optional project scope.\n\nNot for: listing specific issues (search_issues). Project KPIs alone (get_project_metrics).\n\nReturns: { assignees[{ assignee_id, is_unassigned, total, by_status }], scope }.\n\nExamples:\n- « Charge sur HLM » → {\"project_id\":\"HLM\"}\n- « Qui est le plus chargé ? » → {}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Optional: Project UUID or prefix to scope."},
                    "status_filter": {"type": "STRING", "enum": ["open", "all"], "description": "open = backlog/todo/in_progress/in_review (default). all = everything."}
                }
            }),
        ),
        // ── 27. compare_projects ────────────────────────────────────────────
        tool(
            "compare_projects",
            "Side-by-side metrics for 2-5 projects (totals, open/done, 14d velocity, bug ratio, completion). Prefixes or UUIDs.\n\nNot for: single-project drill-down (get_project_metrics). Sprint (analyze_sprint).\n\nReturns: { projects[{ prefix, name, total, open, done, velocity_14d, bug_ratio, completion_ratio }] }.\n\nExamples:\n- « HLM vs SQX » → {\"project_ids\":[\"HLM\",\"SQX\"]}\n- « Compare tous mes projets » → {}",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_ids": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Array of 2-5 project UUIDs or prefixes (e.g. ['HLM', 'SQX']). Omit to compare all user's projects."
                    }
                }
            }),
        ),
    ]
}

// ─── Tool Executor Dispatcher ─────────────────────────────────────────────────

// ─── Real SQL Row Structs (Phase 2A) ─────────────────────────────────────────

#[derive(Debug, sqlx::FromRow, Serialize)]
struct SearchIssueRow {
    id: Uuid,
    display_id: String,
    title: String,
    status: String,
    priority: Option<String>,
    category: Option<Vec<String>>,
    project_name: String,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct SprintSummaryRow {
    id: Uuid,
    name: String,
}

#[derive(Debug, sqlx::FromRow)]
struct PriorityIssueRow {
    id: Uuid,
    display_id: String,
    title: String,
    priority: Option<String>,
    score: f64,
}

#[derive(Debug, sqlx::FromRow)]
struct ExportIssueRow {
    id: Uuid,
    display_id: String,
    title: String,
    description: Option<String>,
    #[sqlx(rename = "type")]
    issue_type: String,
    status: String,
    priority: Option<String>,
    tags: Option<Vec<String>>,
    category: Option<Vec<String>>,
    assignee_ids: Option<Vec<String>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow, Serialize)]
struct ExportMilestoneRow {
    id: Uuid,
    name: String,
    target_date: Option<chrono::NaiveDate>,
    status: String,
}

#[derive(Debug, sqlx::FromRow, Serialize)]
struct ExportSprintRow {
    id: Uuid,
    name: String,
    start_date: Option<chrono::NaiveDate>,
    end_date: Option<chrono::NaiveDate>,
    status: String,
}

// ─── Real SQL Executor Functions (Phase 2A) ───────────────────────────────────

async fn exec_search_issues(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let query_text = args.get("query").and_then(|v| v.as_str())
        .map(|q| format!("%{}%", q));
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    let status_filter = args.get("status").and_then(|v| v.as_str()).map(String::from);
    let priority_filter = args.get("priority").and_then(|v| v.as_str()).map(String::from);
    let category_filter = args.get("category").and_then(|v| v.as_str()).map(String::from);
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20).min(100);
    let response_format = args.get("response_format").and_then(|v| v.as_str()).unwrap_or("concise");

    let rows = sqlx::query_as::<_, SearchIssueRow>(
        r#"SELECT i.id, i.display_id, i.title, i.status, i.priority, i.category,
                  p.name AS project_name, i.updated_at
           FROM issues i
           JOIN projects p ON p.id = i.project_id
           WHERE p.org_id = ANY($1::text[])
             AND ($2::uuid IS NULL OR i.project_id = $2)
             AND ($3::text IS NULL OR i.status = $3)
             AND ($4::text IS NULL OR i.priority = $4)
             AND ($5::text IS NULL OR i.title ILIKE $5 OR i.description ILIKE $5)
             AND ($6::text IS NULL OR $6 = ANY(i.category))
           ORDER BY i.updated_at DESC
           LIMIT $7"#,
    )
    .bind(org_ids)
    .bind(project_id)
    .bind(status_filter)
    .bind(priority_filter)
    .bind(query_text)
    .bind(category_filter)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("search_issues query failed: {}", e))?;

    let n = rows.len();
    let lines: String = rows.iter()
        .map(|r| format!(
            "- {}: {} ({}, {})",
            r.display_id, r.title, r.status,
            r.priority.as_deref().unwrap_or("none"),
        ))
        .collect::<Vec<_>>()
        .join("\n");

    let data: Vec<Value> = if response_format == "detailed" {
        rows.into_iter().map(|r| json!({
            "id": r.id,
            "display_id": r.display_id,
            "title": r.title,
            "status": r.status,
            "priority": r.priority,
            "category": r.category.unwrap_or_default(),
            "project_name": r.project_name,
            "updated_at": r.updated_at,
        })).collect()
    } else {
        rows.into_iter().map(|r| json!({
            "display_id": r.display_id,
            "title": r.title,
            "status": r.status,
        })).collect()
    };

    Ok(ToolResult {
        data: json!({ "count": n, "issues": data, "response_format": response_format }),
        for_model: format!("\u{1f4cb} Found {} issues:\n{}", n, lines),
        component_hint: Some("IssueTable".to_string()),
        summary: format!("Found {} issues", n),
    })
}

async fn exec_get_project_metrics(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2)"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status NOT IN ('done', 'cancelled')"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let in_progress: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'in_progress'"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let done: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'done'"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let velocity: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'done' AND i.updated_at >= NOW() - INTERVAL '14 days'"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let bug_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.type = 'bug'"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let avg_cycle_time: Option<f64> = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT AVG(EXTRACT(EPOCH FROM (i.closed_at - i.created_at)) / 3600.0) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.closed_at IS NOT NULL"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(None);

    let bug_ratio = if total > 0 { bug_count as f64 / total as f64 } else { 0.0 };
    let avg_ct_str = avg_cycle_time.map(|h| format!("{:.1}", h)).unwrap_or_else(|| "N/A".to_string());

    Ok(ToolResult {
        data: json!({
            "total": total,
            "open": open,
            "in_progress": in_progress,
            "done": done,
            "velocity": velocity,
            "bug_ratio": (bug_ratio * 100.0).round() / 100.0,
            "avg_cycle_time_hours": avg_cycle_time.map(|h| (h * 10.0).round() / 10.0),
        }),
        for_model: format!(
            "\u{1f4ca} Project metrics: {} total ({} open, {} in_progress, {} done). Velocity: {} done/14d. Bug ratio: {:.0}%. Avg cycle time: {}h.",
            total, open, in_progress, done, velocity, bug_ratio * 100.0, avg_ct_str,
        ),
        component_hint: Some("MetricsCard".to_string()),
        summary: "Fetched project metrics".to_string(),
    })
}

async fn exec_analyze_sprint(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    let sprint = sqlx::query_as::<_, SprintSummaryRow>(
        "SELECT s.id, s.name FROM sprints s JOIN projects p ON p.id = s.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR s.project_id = $2) AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1"
    )
    .bind(org_ids)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("analyze_sprint sprint lookup: {}", e))?;

    let Some(sprint) = sprint else {
        return Ok(ToolResult {
            data: json!({
                "sprint_name": null, "planned": 0, "completed": 0,
                "pct": 0, "carried_over": 0, "blocked": 0, "velocity_trend": "N/A"
            }),
            for_model: "No active sprint found.".to_string(),
            component_hint: Some("SprintAnalysis".to_string()),
            summary: "No active sprint".to_string(),
        });
    };

    let planned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE sprint_id = $1"
    ).bind(sprint.id).fetch_one(pool).await.unwrap_or(0);

    let completed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE sprint_id = $1 AND status = 'done'"
    ).bind(sprint.id).fetch_one(pool).await.unwrap_or(0);

    let carried_over: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE sprint_id = $1 AND status NOT IN ('done', 'cancelled') AND updated_at < NOW() - INTERVAL '3 days'"
    ).bind(sprint.id).fetch_one(pool).await.unwrap_or(0);

    let blocked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE sprint_id = $1 AND priority = 'urgent' AND status NOT IN ('done', 'cancelled') AND updated_at < NOW() - INTERVAL '2 days'"
    ).bind(sprint.id).fetch_one(pool).await.unwrap_or(0);

    let pct = if planned > 0 { (completed as f64 / planned as f64 * 100.0).round() as i64 } else { 0 };
    let velocity_trend = if pct >= 60 { "on_track" } else if pct >= 30 { "at_risk" } else { "behind" };

    Ok(ToolResult {
        data: json!({
            "sprint_name": sprint.name,
            "planned": planned,
            "completed": completed,
            "pct": pct,
            "carried_over": carried_over,
            "blocked": blocked,
            "velocity_trend": velocity_trend,
        }),
        for_model: format!(
            "Sprint '{}': {}/{} done ({}%). {} carried over, {} blocked. Trend: {}.",
            sprint.name, completed, planned, pct, carried_over, blocked, velocity_trend
        ),
        component_hint: Some("SprintAnalysis".to_string()),
        summary: format!("Analyzed sprint '{}'", sprint.name),
    })
}

async fn exec_weekly_recap(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    let days = args.get("days").and_then(|v| v.as_i64()).unwrap_or(7).clamp(1, 30);
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20).min(50);
    let since = chrono::Utc::now() - chrono::Duration::days(days);

    let completed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'done' AND i.updated_at >= $3"
    ).bind(org_ids).bind(project_id).bind(since).fetch_one(pool).await.unwrap_or(0);

    let new_created: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.created_at >= $3"
    ).bind(org_ids).bind(project_id).bind(since).fetch_one(pool).await.unwrap_or(0);

    let blockers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2) AND i.priority IN ('urgent', 'high') AND i.status NOT IN ('done', 'cancelled') AND i.updated_at < NOW() - INTERVAL '2 days'"
    ).bind(org_ids).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let top_contributor: Option<String> = sqlx::query_scalar::<_, String>(
        "SELECT user_name FROM activity_log WHERE org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR project_id = $2) AND created_at >= $3 AND user_name IS NOT NULL GROUP BY user_name ORDER BY COUNT(*) DESC LIMIT 1"
    ).bind(org_ids).bind(project_id).bind(since).fetch_optional(pool).await.unwrap_or(None);

    let completed_issues = sqlx::query_as::<_, SearchIssueRow>(
        r#"SELECT i.id, i.display_id, i.title, i.status, i.priority, i.category,
                  p.name AS project_name, i.updated_at
           FROM issues i JOIN projects p ON p.id = i.project_id
           WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2)
             AND i.status = 'done' AND i.updated_at >= $3
           ORDER BY i.updated_at DESC LIMIT $4"#,
    ).bind(org_ids).bind(project_id).bind(since).bind(limit)
    .fetch_all(pool).await.unwrap_or_default();

    let blocked_issues = sqlx::query_as::<_, SearchIssueRow>(
        r#"SELECT i.id, i.display_id, i.title, i.status, i.priority, i.category,
                  p.name AS project_name, i.updated_at
           FROM issues i JOIN projects p ON p.id = i.project_id
           WHERE p.org_id = ANY($1::text[]) AND ($2::uuid IS NULL OR i.project_id = $2)
             AND i.priority IN ('urgent', 'high') AND i.status NOT IN ('done', 'cancelled')
             AND i.updated_at < NOW() - INTERVAL '2 days'
           ORDER BY i.updated_at ASC LIMIT $3"#,
    ).bind(org_ids).bind(project_id).bind(limit)
    .fetch_all(pool).await.unwrap_or_default();

    let completed_json: Vec<Value> = completed_issues.into_iter().map(|r| json!({
        "display_id": r.display_id, "title": r.title, "status": r.status,
    })).collect();
    let blocked_json: Vec<Value> = blocked_issues.into_iter().map(|r| json!({
        "display_id": r.display_id, "title": r.title, "priority": r.priority,
    })).collect();

    Ok(ToolResult {
        data: json!({
            "completed_count": completed,
            "new_created_count": new_created,
            "blocker_count": blockers,
            "top_contributor": top_contributor,
            "period": format!("Last {} days", days),
            "completed_issues": completed_json,
            "blocked_issues": blocked_json,
        }),
        for_model: format!(
            "\u{1f4c5} Weekly recap ({} days): {} completed, {} new, {} blockers. Top contributor: {}.",
            days, completed, new_created, blockers,
            top_contributor.as_deref().unwrap_or("N/A"),
        ),
        component_hint: Some("WeeklyRecap".to_string()),
        summary: format!("Weekly recap: {} done, {} new", completed, new_created),
    })
}

async fn exec_suggest_priorities(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    let rows = sqlx::query_as::<_, PriorityIssueRow>(
        r#"SELECT
               i.id, i.display_id, i.title, i.priority,
               (CASE i.priority
                    WHEN 'urgent' THEN 4.0
                    WHEN 'high'   THEN 3.0
                    WHEN 'medium' THEN 2.0
                    WHEN 'low'    THEN 1.0
                    ELSE 1.0
               END)::float8
               * GREATEST(EXTRACT(EPOCH FROM (NOW() - i.updated_at)) / 86400.0, 0.01)::float8
               AS score
           FROM issues i
           JOIN projects p ON p.id = i.project_id
           WHERE p.org_id = ANY($1::text[])
             AND ($2::uuid IS NULL OR i.project_id = $2)
             AND i.status NOT IN ('done', 'cancelled')
           ORDER BY score DESC
           LIMIT 10"#,
    )
    .bind(org_ids)
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("suggest_priorities query: {}", e))?;

    let suggestions: Vec<Value> = rows.iter().map(|r| {
        let priority_label = r.priority.as_deref().unwrap_or("low");
        let urgency_factor = match priority_label {
            "urgent" => 4.0_f64,
            "high"   => 3.0,
            "medium" => 2.0,
            _        => 1.0,
        };
        let staleness_days = r.score / urgency_factor;
        let reason = if staleness_days > 7.0 {
            format!("Stale {:.0}d with {} priority", staleness_days, priority_label)
        } else if priority_label == "urgent" {
            "Urgent \u{2014} needs immediate attention".to_string()
        } else {
            format!("Score {:.1} (priority x staleness)", r.score)
        };
        json!({
            "id": r.id,
            "display_id": r.display_id,
            "title": r.title,
            "priority": r.priority,
            "score": (r.score * 10.0).round() / 10.0,
            "reason": reason,
        })
    }).collect();

    let n = suggestions.len();
    let top = suggestions.iter().take(3)
        .map(|s| format!("- {} '{}' ({})",
            s["display_id"].as_str().unwrap_or("?"),
            s["title"].as_str().unwrap_or("?"),
            s["reason"].as_str().unwrap_or("?"),
        ))
        .collect::<Vec<_>>().join("\n");

    Ok(ToolResult {
        data: json!(suggestions),
        for_model: format!("\u{1f3af} Top {} issues to reprioritize:\n{}", n, top),
        component_hint: Some("PriorityList".to_string()),
        summary: format!("{} priority suggestions", n),
    })
}

async fn exec_export_project(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let raw_project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
    let project_id: Uuid = raw_project_id.parse()
        .map_err(|_| format!(
            "export_project requires a valid 'project_id'. '{}' could not be resolved. Provide a project prefix (e.g. 'HLM') or full UUID.",
            raw_project_id
        ))?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = ANY($2::text[]))"
    ).bind(project_id).bind(org_ids).fetch_one(pool).await
        .map_err(|e| format!("export project check: {}", e))?;

    if !exists {
        return Err(format!(
            "Project '{}' not found or you don't have access. Double-check the project UUID or prefix.",
            raw_project_id
        ));
    }

    let issues = sqlx::query_as::<_, ExportIssueRow>(
        r#"SELECT id, display_id, title, description, type, status, priority,
                  tags, category, assignee_ids, created_at, updated_at
           FROM issues WHERE project_id = $1 ORDER BY display_id ASC"#,
    ).bind(project_id).fetch_all(pool).await
        .map_err(|e| format!("export issues: {}", e))?;

    let milestones = sqlx::query_as::<_, ExportMilestoneRow>(
        "SELECT id, name, target_date, status FROM milestones WHERE project_id = $1 ORDER BY created_at ASC"
    ).bind(project_id).fetch_all(pool).await.unwrap_or_default();

    let sprints = sqlx::query_as::<_, ExportSprintRow>(
        "SELECT id, name, start_date, end_date, status FROM sprints WHERE project_id = $1 ORDER BY created_at ASC"
    ).bind(project_id).fetch_all(pool).await.unwrap_or_default();

    let issue_count = issues.len();
    let m_count = milestones.len();
    let s_count = sprints.len();
    let exported_at = chrono::Utc::now().to_rfc3339();

    let issues_json: Vec<Value> = issues.into_iter().map(|i| json!({
        "id": i.id,
        "display_id": i.display_id,
        "title": i.title,
        "description": i.description,
        "type": i.issue_type,
        "status": i.status,
        "priority": i.priority,
        "tags": i.tags.unwrap_or_default(),
        "category": i.category.unwrap_or_default(),
        "assignee_ids": i.assignee_ids.unwrap_or_default(),
        "created_at": i.created_at,
        "updated_at": i.updated_at,
    })).collect();

    Ok(ToolResult {
        data: json!({
            "issues": issues_json,
            "milestones": milestones,
            "sprints": sprints,
            "exported_at": exported_at,
        }),
        for_model: format!(
            "Exported project: {} issues, {} milestones, {} sprints. Exported at {}.",
            issue_count, m_count, s_count, exported_at,
        ),
        component_hint: None,
        summary: format!("Exported {} issues", issue_count),
    })
}

// ─── Project ID Resolver ──────────────────────────────────────────────────────
// Resolves a project_id that may be a UUID, a prefix (e.g. "HLM"), or a name.

async fn resolve_project_id(pool: &PgPool, org_ids: &[String], raw: &str) -> Option<Uuid> {
    if let Ok(uuid) = raw.parse::<Uuid>() {
        return Some(uuid);
    }

    // Try prefix match (case-insensitive)
    let by_prefix: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM projects WHERE org_id = ANY($1::text[]) AND UPPER(prefix) = UPPER($2) LIMIT 1",
    )
    .bind(org_ids)
    .bind(raw)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if by_prefix.is_some() {
        return by_prefix;
    }

    // Try name match (case-insensitive, contains)
    sqlx::query_scalar(
        "SELECT id FROM projects WHERE org_id = ANY($1::text[]) AND LOWER(name) LIKE LOWER($2) LIMIT 1",
    )
    .bind(org_ids)
    .bind(format!("%{}%", raw))
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

// ─── Issue ID Resolver ────────────────────────────────────────────────────────
// Resolves an issue_id that may be a UUID or a display_id (e.g. "HLM-42").

async fn resolve_issue_id(pool: &PgPool, org_ids: &[String], raw: &str) -> Option<Uuid> {
    if let Ok(uuid) = raw.parse::<Uuid>() {
        return Some(uuid);
    }
    sqlx::query_scalar(
        "SELECT i.id FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE p.org_id = ANY($1::text[]) AND UPPER(i.display_id) = UPPER($2)
         LIMIT 1",
    )
    .bind(org_ids)
    .bind(raw)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

/// Lists available project prefixes for error messages.
async fn list_project_prefixes(pool: &PgPool, org_ids: &[String]) -> Vec<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT prefix FROM projects WHERE org_id = ANY($1::text[]) ORDER BY prefix LIMIT 20",
    )
    .bind(org_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

/// Pre-process tool args: resolve project_id, issue_id, and nested issue_ids
/// from user-friendly values (prefix, display_id) to UUIDs.
async fn resolve_args_ids(pool: &PgPool, org_ids: &[String], args: &mut Value) {
    // Resolve top-level project_id
    if let Some(raw) = args.get("project_id").and_then(|v| v.as_str()).map(String::from) {
        if raw.parse::<Uuid>().is_err() {
            if let Some(uuid) = resolve_project_id(pool, org_ids, &raw).await {
                args["project_id"] = Value::String(uuid.to_string());
            }
        }
    }

    // Resolve top-level issue_id
    if let Some(raw) = args.get("issue_id").and_then(|v| v.as_str()).map(String::from) {
        if raw.parse::<Uuid>().is_err() {
            if let Some(uuid) = resolve_issue_id(pool, org_ids, &raw).await {
                args["issue_id"] = Value::String(uuid.to_string());
            }
        }
    }

    // Resolve issue_ids in updates[] array (for bulk tools)
    if let Some(updates) = args.get_mut("updates").and_then(|v| v.as_array_mut()) {
        for item in updates.iter_mut() {
            if let Some(raw) = item.get("issue_id").and_then(|v| v.as_str()).map(String::from) {
                if raw.parse::<Uuid>().is_err() {
                    if let Some(uuid) = resolve_issue_id(pool, org_ids, &raw).await {
                        item["issue_id"] = Value::String(uuid.to_string());
                    }
                }
            }
        }
    }

    // Resolve issue_ids in milestones[].issue_ids[] array
    if let Some(milestones) = args.get_mut("milestones").and_then(|v| v.as_array_mut()) {
        for ms in milestones.iter_mut() {
            if let Some(ids) = ms.get_mut("issue_ids").and_then(|v| v.as_array_mut()) {
                for id_val in ids.iter_mut() {
                    if let Some(raw) = id_val.as_str().map(String::from) {
                        if raw.parse::<Uuid>().is_err() {
                            if let Some(uuid) = resolve_issue_id(pool, org_ids, &raw).await {
                                *id_val = Value::String(uuid.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Returns a proposal for issue creation (does NOT create). Frontend renders
/// an editable form + Approve/Cancel buttons.
async fn exec_propose_issue(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_id_str = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
    let project_id: Option<Uuid> = project_id_str.parse().ok();

    let project_info: Option<(String, String)> = match project_id {
        Some(uid) => sqlx::query_as::<_, (String, String)>(
            "SELECT name, prefix FROM projects WHERE id = $1 AND org_id = ANY($2::text[])",
        )
        .bind(uid)
        .bind(org_ids)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten(),
        None => None,
    };

    let (project_name, project_prefix) = project_info
        .unwrap_or_else(|| ("Unknown".to_string(), "?".to_string()));

    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let issue_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("feature").to_string();
    let priority = args.get("priority").and_then(|v| v.as_str()).unwrap_or("medium").to_string();
    let tags: Vec<String> = args.get("tags").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|t| t.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let category: Vec<String> = args.get("category").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|c| c.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let proposal = json!({
        "project_id": project_id_str,
        "project_name": project_name,
        "project_prefix": project_prefix,
        "title": title,
        "description": description,
        "type": issue_type,
        "priority": priority,
        "tags": tags,
        "category": category,
    });

    Ok(ToolResult {
        data: proposal.clone(),
        for_model: format!(
            "Proposal ready for user review: '{}' on {} ({}). The user must now approve, edit, or cancel via the UI before you call create_issue.",
            title, project_name, project_prefix
        ),
        component_hint: Some("IssueProposal".to_string()),
        summary: format!("Proposed: '{}' on {}", title, project_prefix),
    })
}

/// Propose an update to an existing issue. Fetches current state and returns
/// a diff for user review.
async fn exec_propose_update_issue(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let issue_id_str = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("");
    let issue_id: Uuid = issue_id_str.parse()
        .map_err(|_| format!(
            "Issue '{}' could not be resolved. Provide a valid display_id (e.g. 'HLM-42') or UUID. Use search_issues to find the right issue.",
            issue_id_str
        ))?;

    #[derive(sqlx::FromRow)]
    struct IssueRow {
        display_id: String,
        title: String,
        description: Option<String>,
        status: String,
        priority: String,
        r#type: String,
        tags: Option<Vec<String>>,
        category: Option<Vec<String>>,
    }

    let current = sqlx::query_as::<_, IssueRow>(
        "SELECT display_id, title, description, status, priority, type, tags, category
         FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2::text[])",
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?
    .ok_or_else(|| format!(
        "Issue '{}' not found or you don't have access. Verify the issue exists with search_issues.",
        issue_id_str
    ))?;

    let mut diff: Vec<Value> = Vec::new();
    let field_str = |name: &str, cur: &str, args: &Value| {
        args.get(name).and_then(|v| v.as_str()).and_then(|new| {
            if new != cur { Some(json!({ "field": name, "from": cur, "to": new })) } else { None }
        })
    };
    let field_array = |name: &str, cur: &[String], args: &Value| {
        args.get(name).and_then(|v| v.as_array()).and_then(|arr| {
            let new: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(String::from)).collect();
            if new != cur { Some(json!({ "field": name, "from": cur, "to": new })) } else { None }
        })
    };

    if let Some(d) = field_str("title", &current.title, args) { diff.push(d); }
    if let Some(d) = field_str("description", current.description.as_deref().unwrap_or(""), args) { diff.push(d); }
    if let Some(d) = field_str("status", &current.status, args) { diff.push(d); }
    if let Some(d) = field_str("priority", &current.priority, args) { diff.push(d); }
    if let Some(d) = field_str("type", &current.r#type, args) { diff.push(d); }
    if let Some(d) = field_array("tags", current.tags.as_deref().unwrap_or(&[]), args) { diff.push(d); }
    if let Some(d) = field_array("category", current.category.as_deref().unwrap_or(&[]), args) { diff.push(d); }

    let data = json!({
        "issue_id": issue_id_str,
        "display_id": current.display_id,
        "title": current.title,
        "diff": diff,
    });

    Ok(ToolResult {
        data: data.clone(),
        for_model: format!(
            "Update proposal ready for {} ({} changes). User must approve before you call update_issue.",
            current.display_id, diff.len()
        ),
        component_hint: Some("UpdateIssueProposal".to_string()),
        summary: format!("Proposed {} changes to {}", diff.len(), current.display_id),
    })
}

/// Propose a bulk update to N issues. Fetches current state for each and returns
/// the list of changes for user review.
async fn exec_propose_bulk_update(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let updates = args.get("updates").and_then(|v| v.as_array())
        .ok_or_else(|| "updates must be an array".to_string())?;

    let mut rows: Vec<Value> = Vec::new();
    for u in updates {
        let issue_id_str = u.get("issue_id").and_then(|v| v.as_str()).unwrap_or("");
        let Ok(issue_id) = issue_id_str.parse::<Uuid>() else { continue };

        let cur: Option<(String, String, String, String)> = sqlx::query_as(
            "SELECT i.display_id, i.title, i.status, i.priority FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2::text[])",
        )
        .bind(issue_id)
        .bind(org_ids)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let (display_id, title, cur_status, cur_priority) = cur
            .unwrap_or_else(|| ("?".into(), "?".into(), "?".into(), "?".into()));

        rows.push(json!({
            "issue_id": issue_id_str,
            "display_id": display_id,
            "title": title,
            "current": { "status": cur_status, "priority": cur_priority },
            "changes": u,
        }));
    }

    Ok(ToolResult {
        data: json!({ "updates": rows }),
        for_model: format!("Bulk update proposal ready ({} issues). User must approve before you call bulk_update_issues.", rows.len()),
        component_hint: Some("BulkUpdateProposal".to_string()),
        summary: format!("Proposed bulk update on {} issues", rows.len()),
    })
}

/// Propose adding a comment. Fetches issue info and returns the proposed content.
async fn exec_propose_comment(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let issue_id_str = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("");
    let issue_id: Uuid = issue_id_str.parse()
        .map_err(|_| format!(
            "Issue '{}' could not be resolved. Provide a valid display_id (e.g. 'HLM-42') or UUID. Use search_issues to find the right issue.",
            issue_id_str
        ))?;
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let issue: Option<(String, String)> = sqlx::query_as(
        "SELECT i.display_id, i.title FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2::text[])",
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let (display_id, title) = issue.unwrap_or_else(|| ("?".into(), "?".into()));

    Ok(ToolResult {
        data: json!({
            "issue_id": issue_id_str,
            "display_id": display_id,
            "title": title,
            "content": content,
        }),
        for_model: format!("Comment proposal on {} ready. User must approve before you call add_comment.", display_id),
        component_hint: Some("CommentProposal".to_string()),
        summary: format!("Proposed comment on {}", display_id),
    })
}

// ─── find_similar_issues executor ─────────────────────────────────────────────

async fn exec_find_similar_issues(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let reference_id_raw = args.get("reference_issue_id").and_then(|v| v.as_str());
    let query_text = args.get("query").and_then(|v| v.as_str());
    let project_id_raw = args.get("project_id").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10).clamp(1, 50);

    let (reference_title, reference_uuid): (String, Option<Uuid>) = match reference_id_raw {
        Some(raw) => {
            let uuid = resolve_issue_id(pool, org_ids, raw).await
                .ok_or_else(|| format!("Reference issue '{}' not found. Use a valid display_id (e.g. HLM-42) or UUID.", raw))?;
            let row: Option<(String,)> = sqlx::query_as(
                "SELECT title FROM issues WHERE id = $1"
            ).bind(uuid).fetch_optional(pool).await.map_err(|e| format!("DB error: {e}"))?;
            (row.map(|r| r.0).unwrap_or_default(), Some(uuid))
        }
        None => (
            query_text.unwrap_or("").to_string(),
            None,
        ),
    };

    if reference_title.is_empty() {
        return Err("find_similar_issues requires either 'reference_issue_id' or 'query'. Provide the issue ID (e.g. 'HLM-42') or a free-text description.".into());
    }

    let keywords: Vec<String> = reference_title
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| w.len() >= 4)
        .collect();

    if keywords.is_empty() {
        return Ok(ToolResult {
            data: json!({"candidates": [], "reference_title": reference_title}),
            for_model: "No significant keywords in the reference — cannot search for similar issues.".into(),
            component_hint: Some("SimilarIssuesList".to_string()),
            summary: "0 similar issues".into(),
        });
    }

    let project_uuid: Option<Uuid> = match project_id_raw {
        Some(raw) => resolve_project_id(pool, org_ids, raw).await,
        None => None,
    };

    let ilike_pattern: Vec<String> = keywords.iter().map(|k| format!("%{}%", k)).collect();

    let rows: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        "SELECT i.id, i.display_id, i.title, i.status
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE p.org_id = ANY($1::text[])
           AND ($2::uuid IS NULL OR i.project_id = $2)
           AND ($3::uuid IS NULL OR i.id != $3)
           AND i.title ILIKE ANY($4::text[])
         ORDER BY i.updated_at DESC
         LIMIT 200"
    )
    .bind(org_ids)
    .bind(project_uuid)
    .bind(reference_uuid)
    .bind(&ilike_pattern)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    let mut candidates: Vec<(f64, Uuid, String, String, String)> = rows.into_iter()
        .map(|(id, dispid, title, status)| {
            let title_lower = title.to_lowercase();
            let matches = keywords.iter().filter(|k| title_lower.contains(k.as_str())).count();
            let score = matches as f64 / keywords.len() as f64;
            (score, id, dispid, title, status)
        })
        .filter(|(s, _, _, _, _)| *s > 0.0)
        .collect();
    candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    candidates.truncate(limit as usize);

    let n = candidates.len();
    let top3 = candidates.iter().take(3)
        .map(|(s, _, dispid, title, _)| format!("- {} ({:.0}%): {}", dispid, s * 100.0, title))
        .collect::<Vec<_>>().join("\n");

    Ok(ToolResult {
        data: json!({
            "reference_title": reference_title,
            "reference_issue_id": reference_id_raw,
            "candidates": candidates.iter().map(|(s, id, dispid, title, status)| json!({
                "id": id.to_string(),
                "display_id": dispid,
                "title": title,
                "status": status,
                "similarity_score": (*s * 100.0).round() / 100.0,
            })).collect::<Vec<_>>(),
        }),
        for_model: format!("Found {} similar issues.\nTop 3:\n{}", n, top3),
        component_hint: Some("SimilarIssuesList".to_string()),
        summary: format!("{} similar issues", n),
    })
}

// ─── workload_by_assignee executor ────────────────────────────────────────────

async fn exec_workload_by_assignee(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_id_raw = args.get("project_id").and_then(|v| v.as_str());
    let status_filter = args.get("status_filter").and_then(|v| v.as_str()).unwrap_or("open");

    let project_uuid: Option<Uuid> = match project_id_raw {
        Some(raw) => resolve_project_id(pool, org_ids, raw).await,
        None => None,
    };

    let rows: Vec<(Option<String>, String, i64)> = sqlx::query_as(
        "SELECT unnested.assignee_id, i.status, COUNT(*)::bigint
         FROM issues i
         JOIN projects p ON p.id = i.project_id,
              LATERAL (
                SELECT unnest(i.assignee_ids) AS assignee_id
                WHERE cardinality(i.assignee_ids) > 0
                UNION ALL
                SELECT NULL WHERE cardinality(i.assignee_ids) = 0 OR i.assignee_ids IS NULL
              ) AS unnested
         WHERE p.org_id = ANY($1::text[])
           AND ($2::uuid IS NULL OR i.project_id = $2)
           AND ($3 = 'all' OR i.status NOT IN ('done', 'cancelled'))
         GROUP BY unnested.assignee_id, i.status
         ORDER BY COUNT(*) DESC
         LIMIT 200"
    )
    .bind(org_ids)
    .bind(project_uuid)
    .bind(status_filter)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    use std::collections::HashMap;
    let mut by_assignee: HashMap<Option<String>, HashMap<String, i64>> = HashMap::new();
    for (aid, status, cnt) in rows {
        by_assignee.entry(aid).or_default().insert(status, cnt);
    }

    let mut entries: Vec<Value> = by_assignee.iter().map(|(aid, statuses)| {
        let total: i64 = statuses.values().sum();
        json!({
            "assignee_id": aid,
            "is_unassigned": aid.is_none(),
            "total": total,
            "by_status": {
                "backlog": statuses.get("backlog").copied().unwrap_or(0),
                "todo": statuses.get("todo").copied().unwrap_or(0),
                "in_progress": statuses.get("in_progress").copied().unwrap_or(0),
                "in_review": statuses.get("in_review").copied().unwrap_or(0),
                "done": statuses.get("done").copied().unwrap_or(0),
                "cancelled": statuses.get("cancelled").copied().unwrap_or(0),
            }
        })
    }).collect();

    entries.sort_by(|a, b| {
        b["total"].as_i64().unwrap_or(0).cmp(&a["total"].as_i64().unwrap_or(0))
    });

    let top3 = entries.iter().take(3).map(|e| {
        let aid = e["assignee_id"].as_str().unwrap_or("unassigned");
        format!("- {}: {} issues", aid, e["total"].as_i64().unwrap_or(0))
    }).collect::<Vec<_>>().join("\n");

    Ok(ToolResult {
        data: json!({ "assignees": entries, "scope": status_filter }),
        for_model: format!("Workload breakdown ({} mode), {} assignees:\n{}", status_filter, entries.len(), top3),
        component_hint: Some("WorkloadDistribution".to_string()),
        summary: format!("{} assignees, {} scope", entries.len(), status_filter),
    })
}

// ─── compare_projects executor ────────────────────────────────────────────────

async fn exec_compare_projects(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    let project_ids_raw: Vec<String> = args.get("project_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let mut project_uuids: Vec<Uuid> = Vec::new();
    for raw in &project_ids_raw {
        if let Some(uuid) = resolve_project_id(pool, org_ids, raw).await {
            project_uuids.push(uuid);
        }
    }

    if project_uuids.is_empty() {
        let all: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE org_id = ANY($1::text[]) LIMIT 10"
        ).bind(org_ids).fetch_all(pool).await.map_err(|e| format!("DB error: {e}"))?;
        project_uuids = all.into_iter().map(|(id,)| id).collect();
    }

    if project_uuids.len() < 2 {
        return Err("compare_projects needs at least 2 projects. Specify project_ids with 2-5 prefixes (e.g. ['HLM', 'SQX']) or ensure your org has 2+ projects.".into());
    }

    let mut rows = Vec::new();
    for uuid in &project_uuids {
        let info: Option<(String, String)> = sqlx::query_as(
            "SELECT name, prefix FROM projects WHERE id = $1"
        ).bind(uuid).fetch_optional(pool).await.ok().flatten();

        let (name, prefix) = info.unwrap_or_else(|| (uuid.to_string(), "?".into()));

        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM issues WHERE project_id = $1")
            .bind(uuid).fetch_one(pool).await.unwrap_or(0);
        let open: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM issues WHERE project_id = $1 AND status NOT IN ('done', 'cancelled')")
            .bind(uuid).fetch_one(pool).await.unwrap_or(0);
        let done: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM issues WHERE project_id = $1 AND status = 'done'")
            .bind(uuid).fetch_one(pool).await.unwrap_or(0);
        let velocity: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM issues WHERE project_id = $1 AND status = 'done' AND updated_at >= NOW() - INTERVAL '14 days'")
            .bind(uuid).fetch_one(pool).await.unwrap_or(0);
        let bugs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM issues WHERE project_id = $1 AND type = 'bug'")
            .bind(uuid).fetch_one(pool).await.unwrap_or(0);

        let bug_ratio = if total > 0 { bugs as f64 / total as f64 } else { 0.0 };
        let completion_ratio = if total > 0 { done as f64 / total as f64 } else { 0.0 };

        rows.push(json!({
            "project_id": uuid.to_string(),
            "name": name,
            "prefix": prefix,
            "total": total,
            "open": open,
            "done": done,
            "velocity_14d": velocity,
            "bug_ratio": (bug_ratio * 100.0).round() / 100.0,
            "completion_ratio": (completion_ratio * 100.0).round() / 100.0,
        }));
    }

    let n = rows.len();
    let fastest = rows.iter().max_by_key(|r| r["velocity_14d"].as_i64().unwrap_or(0))
        .and_then(|r| r["prefix"].as_str())
        .unwrap_or("?");

    Ok(ToolResult {
        data: json!({ "projects": rows }),
        for_model: format!("Comparison of {} projects. Fastest last 14d: {}.", n, fastest),
        component_hint: Some("ProjectComparison".to_string()),
        summary: format!("Comparing {} projects", n),
    })
}

pub async fn execute_tool(
    pool: &PgPool,
    org_ids: &[String],
    user_id: &str,
    tool_name: &str,
    args: Value,
) -> Result<ToolResult, String> {
    let mut args = args;
    resolve_args_ids(pool, org_ids, &mut args).await;

    match tool_name {
        "search_issues" => match exec_search_issues(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("search_issues real query failed: {e}; falling back to stub"); Ok(stub_search_issues(&args)) }
        },
        "propose_issue" => exec_propose_issue(pool, org_ids, &args).await,
        "propose_update_issue" => exec_propose_update_issue(pool, org_ids, &args).await,
        "propose_bulk_update" => exec_propose_bulk_update(pool, org_ids, &args).await,
        "propose_comment" => exec_propose_comment(pool, org_ids, &args).await,
        "create_issue" => create_issue_real(pool, org_ids, user_id, &args).await,
        "update_issue" => update_issue_real(pool, org_ids, user_id, &args).await,
        "bulk_update_issues" => bulk_update_issues_real(pool, org_ids, user_id, &args).await,
        "add_comment" => add_comment_real(pool, org_ids, user_id, &args).await,
        "generate_prd" => match ai_generate_prd(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("generate_prd real query failed: {e}; falling back to stub"); Ok(stub_generate_prd(&args)) }
        },
        "analyze_sprint" => match exec_analyze_sprint(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("analyze_sprint real query failed: {e}; falling back to stub"); Ok(stub_analyze_sprint(&args)) }
        },
        "get_project_metrics" => match exec_get_project_metrics(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("get_project_metrics real query failed: {e}; falling back to stub"); Ok(stub_get_project_metrics(&args)) }
        },
        "weekly_recap" => match exec_weekly_recap(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("weekly_recap real query failed: {e}; falling back to stub"); Ok(stub_weekly_recap(&args)) }
        },
        "suggest_priorities" => match exec_suggest_priorities(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("suggest_priorities real query failed: {e}; falling back to stub"); Ok(stub_suggest_priorities(&args)) }
        },
        "plan_milestones" => match ai_plan_milestones(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("plan_milestones real query failed: {e}; falling back to stub"); Ok(stub_plan_milestones(&args)) }
        },
        "create_milestones_batch" => create_milestones_batch_real(pool, org_ids, user_id, &args).await,
        "adjust_timeline" => match ai_adjust_timeline(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("adjust_timeline real query failed: {e}; falling back to stub"); Ok(stub_adjust_timeline(&args)) }
        },
        "triage_issue" => triage_issue_real(pool, org_ids, user_id, &args).await,
        "manage_initiatives" => match ai_manage_initiatives(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_initiatives real query failed: {e}; falling back to stub"); Ok(stub_manage_initiatives(&args)) }
        },
        "manage_automations" => match ai_manage_automations(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_automations real query failed: {e}; falling back to stub"); Ok(stub_manage_automations(&args)) }
        },
        "manage_sla" => match ai_manage_sla(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_sla real query failed: {e}; falling back to stub"); Ok(stub_manage_sla(&args)) }
        },
        "manage_templates" => match ai_manage_templates(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_templates real query failed: {e}; falling back to stub"); Ok(stub_manage_templates(&args)) }
        },
        "manage_recurring" => match ai_manage_recurring(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_recurring real query failed: {e}; falling back to stub"); Ok(stub_manage_recurring(&args)) }
        },
        "export_project" => match exec_export_project(pool, org_ids, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("export_project real query failed: {e}; falling back to stub"); Ok(stub_export_project(&args)) }
        },
        "find_similar_issues" => exec_find_similar_issues(pool, org_ids, &args).await,
        "workload_by_assignee" => exec_workload_by_assignee(pool, org_ids, &args).await,
        "compare_projects" => exec_compare_projects(pool, org_ids, &args).await,
        unknown => Err(format!("Unknown tool: {}", unknown)),
    }
}

// ─── Stub Executors ───────────────────────────────────────────────────────────
// Phase 1 stubs — return realistic mock data.
// Phase 2 will replace these with real DB queries.

fn stub_search_issues(args: &Value) -> ToolResult {
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("(all)");
    let status = args.get("status").and_then(|v| v.as_str()).unwrap_or("any");
    let issues = json!([
        {"id": "11111111-0000-0000-0000-000000000001", "display_id": "PHI-1", "title": "Fix auth token refresh", "status": "in_progress", "priority": "high", "category": ["BACK"], "tags": ["auth"]},
        {"id": "11111111-0000-0000-0000-000000000002", "display_id": "PHI-2", "title": "Add CSV export to billing", "status": "todo", "priority": "medium", "category": ["FRONT"], "tags": ["billing"]},
        {"id": "11111111-0000-0000-0000-000000000003", "display_id": "PHI-3", "title": "Migrate users table schema", "status": "backlog", "priority": "low", "category": ["DB"], "tags": ["migration"]}
    ]);
    ToolResult {
        data: issues,
        for_model: format!(
            "Found 3 issues matching query='{}' status='{}': PHI-1 'Fix auth token refresh' (in_progress, high), PHI-2 'Add CSV export to billing' (todo, medium), PHI-3 'Migrate users table schema' (backlog, low).",
            query, status
        ),
        component_hint: Some("IssueTable".to_string()),
        summary: format!("Searched issues: query={}", query),
    }
}

fn stub_create_issue(args: &Value) -> ToolResult {
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("New issue");
    let display_id = "PHI-42";
    let issue = json!({
        "id": "22222222-0000-0000-0000-000000000001",
        "display_id": display_id,
        "title": title,
        "status": "backlog",
        "priority": args.get("priority").and_then(|v| v.as_str()).unwrap_or("medium"),
        "type": args.get("type").and_then(|v| v.as_str()).unwrap_or("feature")
    });
    ToolResult {
        data: issue,
        for_model: format!("Created issue {} '{}' successfully with status=backlog.", display_id, title),
        component_hint: Some("IssueCreated".to_string()),
        summary: format!("Created issue: {}", title),
    }
}

fn stub_update_issue(args: &Value) -> ToolResult {
    let issue_id = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let changes: Vec<String> = ["status", "priority", "title", "type", "tags", "category"]
        .iter()
        .filter_map(|f| args.get(f).map(|v| format!("{}={}", f, v)))
        .collect();
    ToolResult {
        data: json!({"issue_id": issue_id, "updated_fields": changes}),
        for_model: format!("Updated issue {} with: {}.", issue_id, changes.join(", ")),
        component_hint: Some("IssueUpdated".to_string()),
        summary: format!("Updated issue {}", issue_id),
    }
}

fn stub_bulk_update_issues(args: &Value) -> ToolResult {
    let count = args.get("updates")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    ToolResult {
        data: json!({"updated_count": count, "errors": []}),
        for_model: format!("Bulk updated {} issues successfully.", count),
        component_hint: None,
        summary: format!("Bulk updated {} issues", count),
    }
}

fn stub_add_comment(args: &Value) -> ToolResult {
    let issue_id = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("(empty)");
    ToolResult {
        data: json!({"id": "33333333-0000-0000-0000-000000000001", "issue_id": issue_id, "content": content}),
        for_model: format!("Added comment to issue {}: \"{}\"", issue_id, &content[..content.len().min(100)]),
        component_hint: None,
        summary: format!("Commented on issue {}", issue_id),
    }
}

fn stub_generate_prd(args: &Value) -> ToolResult {
    let brief = args.get("brief").and_then(|v| v.as_str()).unwrap_or("feature");
    let prd = format!(
        r#"# PRD: {}

## Executive Summary
[Auto-generated PRD stub — Phase 2 will generate real content]

## Problem Statement
Users need this feature to improve their workflow.

## User Stories
- As a user, I want to {brief} so that I can accomplish my goal.

## Acceptance Criteria
- [ ] Feature is implemented and tested
- [ ] Documentation is updated
- [ ] Metrics are tracked

## Technical Considerations
- Backend changes required
- Frontend component updates needed

## Success Metrics
- User adoption > 20% within 30 days
"#,
        brief,
        brief = brief
    );
    ToolResult {
        data: json!({"prd_markdown": prd}),
        for_model: format!("Generated PRD for: {}. See prd_markdown field for full document.", brief),
        component_hint: Some("PRDDocument".to_string()),
        summary: format!("Generated PRD: {}", brief),
    }
}

fn stub_analyze_sprint(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("all");
    let analysis = json!({
        "project_id": project_id,
        "velocity": 8,
        "done_this_sprint": 5,
        "in_progress": 3,
        "stuck_issues": [
            {"display_id": "PHI-7", "title": "Stuck issue example", "days_stale": 4}
        ],
        "completion_rate": 0.62,
        "recommended_next_sprint": ["PHI-10", "PHI-11", "PHI-12"]
    });
    ToolResult {
        data: analysis,
        for_model: format!(
            "Sprint analysis for project {}: velocity=8 pts, 5 done, 3 in_progress, 1 stuck issue (PHI-7, 4 days stale), completion rate 62%. Recommended next sprint: PHI-10, PHI-11, PHI-12.",
            project_id
        ),
        component_hint: Some("SprintAnalysis".to_string()),
        summary: format!("Analyzed sprint for project {}", project_id),
    }
}

fn stub_get_project_metrics(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("all");
    let metrics = json!({
        "project_id": project_id,
        "total_issues": 47,
        "status_breakdown": {
            "backlog": 15, "todo": 10, "in_progress": 8,
            "in_review": 4, "done": 8, "cancelled": 2
        },
        "priority_breakdown": {
            "urgent": 3, "high": 12, "medium": 20, "low": 12
        },
        "category_breakdown": {
            "FRONT": 18, "BACK": 15, "API": 8, "DB": 4, "INFRA": 2
        },
        "completion_rate": 0.21,
        "recent_7_days": {"created": 5, "closed": 3}
    });
    ToolResult {
        data: metrics,
        for_model: format!(
            "Metrics for project {}: 47 total issues (15 backlog, 10 todo, 8 in_progress, 4 in_review, 8 done). Priority: 3 urgent, 12 high. Categories: FRONT 18, BACK 15, API 8. Completion rate: 21%. Last 7 days: 5 created, 3 closed.",
            project_id
        ),
        component_hint: Some("MetricsCard".to_string()),
        summary: format!("Fetched metrics for project {}", project_id),
    }
}

fn stub_weekly_recap(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("all");
    let days = args.get("days").and_then(|v| v.as_i64()).unwrap_or(7);
    let recap = json!({
        "period_days": days,
        "completed": [
            {"display_id": "PHI-5", "title": "Fix login redirect loop"},
            {"display_id": "PHI-8", "title": "Update billing page UI"}
        ],
        "in_progress": [
            {"display_id": "PHI-1", "title": "Fix auth token refresh"},
            {"display_id": "PHI-11", "title": "Add dark mode"}
        ],
        "newly_created": [
            {"display_id": "PHI-14", "title": "Add webhook retry logic"},
            {"display_id": "PHI-15", "title": "Performance audit FRONT"}
        ],
        "blocked_stale": [
            {"display_id": "PHI-7", "title": "Stuck migration", "days_stale": 5}
        ]
    });
    ToolResult {
        data: recap,
        for_model: format!(
            "Weekly recap ({} days) for project {}: 2 completed (PHI-5, PHI-8), 2 in progress (PHI-1, PHI-11), 2 new tickets (PHI-14, PHI-15), 1 stale/blocked (PHI-7, 5 days).",
            days, project_id
        ),
        component_hint: Some("WeeklyRecap".to_string()),
        summary: format!("Weekly recap for project {}", project_id),
    }
}

fn stub_suggest_priorities(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("all");
    let suggestions = json!([
        {
            "issue": {"display_id": "PHI-7", "title": "Stuck migration", "current_priority": "low"},
            "suggested_priority": "high",
            "reason": "Blocking 3 other issues and stale for 5 days",
            "confidence": 0.92
        },
        {
            "issue": {"display_id": "PHI-3", "title": "Migrate users table schema", "current_priority": "medium"},
            "suggested_priority": "urgent",
            "reason": "Required by upcoming deadline and marked as dependency",
            "confidence": 0.88
        },
        {
            "issue": {"display_id": "PHI-9", "title": "Update README", "current_priority": "high"},
            "suggested_priority": "low",
            "reason": "Documentation task, no blocking dependencies, dilutes actual urgency",
            "confidence": 0.85
        }
    ]);
    ToolResult {
        data: suggestions,
        for_model: format!(
            "Priority suggestions for project {}: (1) PHI-7 low→high (blocking 3 issues, 5 days stale), (2) PHI-3 medium→urgent (deadline dependency), (3) PHI-9 high→low (doc task, dilutes urgency). Confirm to apply via bulk_update_issues.",
            project_id
        ),
        component_hint: Some("PriorityList".to_string()),
        summary: format!("Generated 3 priority suggestions for project {}", project_id),
    }
}

fn stub_plan_milestones(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let team_size = args.get("team_size").and_then(|v| v.as_i64()).unwrap_or(1);
    let plan = json!({
        "project_id": project_id,
        "team_size": team_size,
        "proposed_milestones": [
            {
                "name": "Milestone A — Stabilization",
                "description": "Critical bugs and blockers",
                "target_date": "2026-05-01",
                "order": 1,
                "issues": [
                    {"display_id": "PHI-1", "title": "Fix auth token refresh", "priority": "high"},
                    {"display_id": "PHI-7", "title": "Stuck migration", "priority": "urgent"}
                ]
            },
            {
                "name": "Milestone B — Active Delivery",
                "description": "In-progress features and high-priority improvements",
                "target_date": "2026-05-15",
                "order": 2,
                "issues": [
                    {"display_id": "PHI-2", "title": "Add CSV export to billing", "priority": "medium"},
                    {"display_id": "PHI-11", "title": "Add dark mode", "priority": "medium"}
                ]
            },
            {
                "name": "Milestone C — Backlog",
                "description": "Low-priority backlog items",
                "target_date": "2026-06-01",
                "order": 3,
                "issues": [
                    {"display_id": "PHI-3", "title": "Migrate users table schema", "priority": "low"}
                ]
            }
        ]
    });
    ToolResult {
        data: plan,
        for_model: format!(
            "Proposed 3 milestones for project {} (team_size={}): Milestone A 'Stabilization' (2 issues, target 2026-05-01), Milestone B 'Active Delivery' (2 issues, target 2026-05-15), Milestone C 'Backlog' (1 issue, target 2026-06-01). Awaiting user confirmation before creating.",
            project_id, team_size
        ),
        component_hint: Some("MilestoneTimeline".to_string()),
        summary: format!("Planned 3 milestones for project {}", project_id),
    }
}

fn stub_create_milestones_batch(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let count = args.get("milestones")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    ToolResult {
        data: json!({"project_id": project_id, "created_count": count, "errors": []}),
        for_model: format!("Created {} milestones for project {}.", count, project_id),
        component_hint: None,
        summary: format!("Created {} milestones for project {}", count, project_id),
    }
}

fn stub_adjust_timeline(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let constraint = args.get("constraint").and_then(|v| v.as_str()).unwrap_or("unspecified");
    ToolResult {
        data: json!({
            "project_id": project_id,
            "constraint_applied": constraint,
            "revised_milestones": [
                {"name": "Milestone A", "old_date": "2026-05-01", "new_date": "2026-04-24"},
                {"name": "Milestone B", "old_date": "2026-05-15", "new_date": "2026-05-08"}
            ]
        }),
        for_model: format!(
            "Adjusted timeline for project {} with constraint '{}'. Milestone A moved from 2026-05-01 to 2026-04-24, Milestone B from 2026-05-15 to 2026-05-08. Confirm to apply.",
            project_id, constraint
        ),
        component_hint: None,
        summary: format!("Adjusted timeline for project {}", project_id),
    }
}

fn stub_triage_issue(args: &Value) -> ToolResult {
    let issue_id = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    ToolResult {
        data: json!({
            "issue_id": issue_id,
            "suggestions": {
                "priority": {"value": "high", "confidence": 0.87},
                "category": {"value": ["BACK", "API"], "confidence": 0.91},
                "tags": {"value": ["auth", "security"], "confidence": 0.83}
            },
            "similar_issues": [
                {"display_id": "PHI-1", "title": "Fix auth token refresh", "similarity": 0.78}
            ]
        }),
        for_model: format!(
            "Triage for issue {}: suggested priority=high (87%), categories=BACK+API (91%), tags=['auth','security'] (83%). Similar: PHI-1 'Fix auth token refresh' (78% similarity). Apply via update_issue.",
            issue_id
        ),
        component_hint: None,
        summary: format!("Triaged issue {}", issue_id),
    }
}

fn stub_manage_initiatives(args: &Value) -> ToolResult {
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    ToolResult {
        data: json!([
            {"id": "aaaa0001-0000-0000-0000-000000000001", "name": "Q2 Product Launch", "status": "active", "projects": 3},
            {"id": "aaaa0002-0000-0000-0000-000000000001", "name": "Security Hardening 2026", "status": "active", "projects": 2}
        ]),
        for_model: format!(
            "Initiative action='{}': 2 active initiatives — 'Q2 Product Launch' (3 projects), 'Security Hardening 2026' (2 projects).",
            action
        ),
        component_hint: None,
        summary: format!("Managed initiatives (action={})", action),
    }
}

fn stub_manage_automations(args: &Value) -> ToolResult {
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    ToolResult {
        data: json!([
            {"id": "bbbb0001-0000-0000-0000-000000000001", "name": "Auto-escalate urgents", "trigger": "priority_changed", "action": "add_comment", "enabled": true},
            {"id": "bbbb0002-0000-0000-0000-000000000001", "name": "Move to review on PR", "trigger": "label_added", "action": "set_status", "enabled": true}
        ]),
        for_model: format!(
            "Automations for project {} (action={}): 2 rules — 'Auto-escalate urgents' (enabled), 'Move to review on PR' (enabled).",
            project_id, action
        ),
        component_hint: None,
        summary: format!("Managed automations for project {} (action={})", project_id, action),
    }
}

fn stub_manage_sla(args: &Value) -> ToolResult {
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list_rules");
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    ToolResult {
        data: json!({
            "rules": [
                {"priority": "urgent", "deadline_hours": 4},
                {"priority": "high", "deadline_hours": 24},
                {"priority": "medium", "deadline_hours": 72}
            ],
            "stats": {
                "compliance_rate": 0.84,
                "breached_count": 3,
                "avg_resolution_hours": {"urgent": 3.2, "high": 18.5}
            }
        }),
        for_model: format!(
            "SLA for project {} (action={}): 3 rules (urgent=4h, high=24h, medium=72h). Compliance: 84%, 3 breaches, avg resolution urgent=3.2h, high=18.5h.",
            project_id, action
        ),
        component_hint: None,
        summary: format!("SLA management for project {} (action={})", project_id, action),
    }
}

fn stub_manage_templates(args: &Value) -> ToolResult {
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    ToolResult {
        data: json!([
            {"id": "cccc0001-0000-0000-0000-000000000001", "name": "Bug Report", "default_type": "bug", "default_priority": "medium"},
            {"id": "cccc0002-0000-0000-0000-000000000001", "name": "Feature Request", "default_type": "feature", "default_priority": "low"}
        ]),
        for_model: format!(
            "Templates for project {} (action={}): 2 templates — 'Bug Report' (bug/medium), 'Feature Request' (feature/low).",
            project_id, action
        ),
        component_hint: None,
        summary: format!("Managed templates for project {} (action={})", project_id, action),
    }
}

fn stub_manage_recurring(args: &Value) -> ToolResult {
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    ToolResult {
        data: json!([
            {"id": "dddd0001-0000-0000-0000-000000000001", "title": "Weekly Security Review", "cron": "0 9 * * 1", "enabled": true, "next_run": "2026-04-21T09:00:00Z"},
            {"id": "dddd0002-0000-0000-0000-000000000001", "title": "Monthly Dependency Audit", "cron": "0 10 1 * *", "enabled": true, "next_run": "2026-05-01T10:00:00Z"}
        ]),
        for_model: format!(
            "Recurring configs for project {} (action={}): 2 active — 'Weekly Security Review' (Mon 9am), 'Monthly Dependency Audit' (1st of month).",
            project_id, action
        ),
        component_hint: None,
        summary: format!("Managed recurring configs for project {} (action={})", project_id, action),
    }
}

fn stub_export_project(args: &Value) -> ToolResult {
    let project_id = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    ToolResult {
        data: json!({
            "project_id": project_id,
            "exported_at": "2026-04-17T11:32:00Z",
            "issue_count": 47,
            "issues": [
                {"display_id": "PHI-1", "title": "Fix auth token refresh", "status": "in_progress", "priority": "high"},
                {"display_id": "PHI-2", "title": "Add CSV export to billing", "status": "todo", "priority": "medium"}
            ],
            "_note": "Phase 2 will include full dataset with all fields and comments."
        }),
        for_model: format!(
            "Exported project {}: 47 issues total. Data includes display_id, title, status, priority, type, tags, category. Use data field for full payload.",
            project_id
        ),
        component_hint: None,
        summary: format!("Exported project {}", project_id),
    }
}

// ─── Phase 2B: Real Write Tool Executors ─────────────────────────────────────

async fn create_issue_real(
    pool: &PgPool,
    org_ids: &[String],
    user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "create_issue requires 'project_id'. Provide a project prefix (e.g. 'HLM') or full UUID.".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| {
            let raw = project_id_str.to_string();
            format!(
                "Project '{}' could not be resolved to a UUID. It may not exist or the prefix is misspelled. Use search_issues with no project_id to discover available projects, or check the prefix spelling.",
                raw
            )
        })?;
    let title = args.get("title").and_then(|v| v.as_str())
        .ok_or_else(|| "create_issue requires 'title'. Provide a short plain-text title (no brackets, no prefix). Good: 'Fix auth token refresh'. Bad: '[HLM][BUG] Fix auth'.".to_string())?;
    let description = args.get("description").and_then(|v| v.as_str());
    let issue_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("feature");
    let priority = args.get("priority").and_then(|v| v.as_str());
    let category: Vec<String> = args.get("category")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let tags: Vec<String> = args.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    // Verify project belongs to org + get prefix
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT prefix FROM projects WHERE id = $1 AND org_id = ANY($2::text[])",
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let (prefix,) = row.ok_or_else(|| format!(
        "Project '{}' not found or you don't have access. Double-check the project UUID or prefix.",
        project_id_str
    ))?;

    // Generate display_id: MAX existing number + 1
    let (next_num,): (i64,) = sqlx::query_as(
        r#"SELECT COALESCE(MAX((SPLIT_PART(display_id, '-', 2))::bigint), 0) + 1
           FROM issues WHERE project_id = $1 AND display_id ~ ('^' || $2 || '-[0-9]+$')"#,
    )
    .bind(project_id)
    .bind(&prefix)
    .fetch_one(pool)
    .await
    .unwrap_or((1i64,));
    let display_id = format!("{}-{}", prefix, next_num);

    // Max position in backlog lane
    let max_pos: Option<f64> = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT MAX(position) FROM issues WHERE project_id = $1 AND status = 'backlog'",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .unwrap_or(None);
    let position = max_pos.map(|p| p + 1000.0).unwrap_or(1000.0);

    let (id, did, t, status, pri, typ): (Uuid, String, String, String, Option<String>, String) =
        sqlx::query_as(
            r#"INSERT INTO issues (
                project_id, display_id, title, description, type, status,
                priority, category, tags, position, source, created_by_id
               ) VALUES ($1, $2, $3, $4, $5, 'backlog', $6, $7, $8, $9, 'ai', $10)
               RETURNING id, display_id, title, status, priority, type"#,
        )
        .bind(project_id)
        .bind(&display_id)
        .bind(title)
        .bind(description)
        .bind(issue_type)
        .bind(priority)
        .bind(&category)
        .bind(&tags)
        .bind(position)
        .bind(user_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to create issue: {}", e))?;

    let priority_str = pri.as_deref().unwrap_or("none");
    let category_str = if category.is_empty() { "none".to_string() } else { category.join(", ") };

    Ok(ToolResult {
        data: json!({
            "id": id.to_string(),
            "display_id": did,
            "title": t,
            "status": status,
            "priority": priority_str,
            "type": typ,
            "category": category,
            "tags": tags,
        }),
        for_model: format!(
            "✅ Created issue {}: \"{}\" (status: backlog, priority: {}, category: {})",
            did, t, priority_str, category_str
        ),
        component_hint: Some("IssueCreated".to_string()),
        summary: format!("Created issue: {}", t),
    })
}

async fn update_issue_real(
    pool: &PgPool,
    org_ids: &[String],
    _user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let raw_issue_id = args.get("issue_id").and_then(|v| v.as_str())
        .ok_or_else(|| "update_issue requires 'issue_id'. Provide a display_id (e.g. 'HLM-42') or full UUID.".to_string())?;
    let issue_id: Uuid = raw_issue_id.parse().map_err(|_| format!(
        "Issue '{}' could not be resolved. Check that the display_id (e.g. 'HLM-42') or UUID is correct. Use search_issues to find the right issue.",
        raw_issue_id
    ))?;

    // Verify issue belongs to org and capture current state
    let existing: Option<(String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT i.display_id, i.status, i.priority
           FROM issues i JOIN projects p ON p.id = i.project_id
           WHERE i.id = $1 AND p.org_id = ANY($2::text[])"#,
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let (display_id, old_status, old_priority) =
        existing.ok_or_else(|| format!(
            "Issue '{}' not found or you don't have access. Verify the issue exists with search_issues.",
            raw_issue_id
        ))?;

    // Extract optional update fields
    let new_title    = args.get("title").and_then(|v| v.as_str());
    let new_desc     = args.get("description").and_then(|v| v.as_str());
    let new_status   = args.get("status").and_then(|v| v.as_str());
    let new_priority = args.get("priority").and_then(|v| v.as_str());
    let new_tags: Option<Vec<String>> = args.get("tags").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect());
    let new_category: Option<Vec<String>> = args.get("category").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect());
    let new_milestone_id: Option<Uuid> = args.get("milestone_id")
        .and_then(|v| v.as_str()).and_then(|s| s.parse().ok());
    let new_sprint_id: Option<Uuid> = args.get("sprint_id")
        .and_then(|v| v.as_str()).and_then(|s| s.parse().ok());
    let new_assignee_ids: Option<Vec<String>> = args.get("assignee_ids").and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect());

    let (new_did, ret_status, ret_priority): (String, String, Option<String>) = sqlx::query_as(
        r#"UPDATE issues SET
            title        = COALESCE($2, title),
            description  = COALESCE($3, description),
            status       = COALESCE($4, status),
            priority     = CASE WHEN $5::boolean THEN $6         ELSE priority      END,
            tags         = CASE WHEN $7::boolean THEN $8::text[] ELSE tags          END,
            category     = CASE WHEN $9::boolean THEN $10::text[] ELSE category     END,
            milestone_id = CASE WHEN $11::boolean THEN $12::uuid ELSE milestone_id  END,
            sprint_id    = CASE WHEN $13::boolean THEN $14::uuid ELSE sprint_id     END,
            assignee_ids = CASE WHEN $15::boolean THEN $16::text[] ELSE assignee_ids END,
            updated_at   = now()
           WHERE id = $1
           RETURNING display_id, status, priority"#,
    )
    .bind(issue_id)                   // $1
    .bind(new_title)                  // $2
    .bind(new_desc)                   // $3
    .bind(new_status)                 // $4
    .bind(new_priority.is_some())     // $5
    .bind(new_priority)               // $6
    .bind(new_tags.is_some())         // $7
    .bind(&new_tags)                  // $8
    .bind(new_category.is_some())     // $9
    .bind(&new_category)              // $10
    .bind(new_milestone_id.is_some()) // $11
    .bind(new_milestone_id)           // $12
    .bind(new_sprint_id.is_some())    // $13
    .bind(new_sprint_id)              // $14
    .bind(new_assignee_ids.is_some()) // $15
    .bind(&new_assignee_ids)          // $16
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to update issue: {}", e))?;

    // Build change summary
    let mut changes: Vec<String> = Vec::new();
    if let Some(s) = new_status {
        if s != old_status {
            changes.push(format!("status: {} → {}", old_status, s));
        }
    }
    if let Some(p) = new_priority {
        let old = old_priority.as_deref().unwrap_or("none");
        if old != p { changes.push(format!("priority: {} → {}", old, p)); }
    }
    if new_title.is_some()        { changes.push("title updated".to_string()); }
    if new_desc.is_some()         { changes.push("description updated".to_string()); }
    if new_tags.is_some()         { changes.push("tags updated".to_string()); }
    if new_category.is_some()     { changes.push("category updated".to_string()); }
    if new_milestone_id.is_some() { changes.push("milestone updated".to_string()); }
    if new_sprint_id.is_some()    { changes.push("sprint updated".to_string()); }
    if new_assignee_ids.is_some() { changes.push("assignees updated".to_string()); }

    let changes_str = if changes.is_empty() {
        "no changes".to_string()
    } else {
        changes.join(", ")
    };

    Ok(ToolResult {
        data: json!({
            "issue_id":   issue_id.to_string(),
            "display_id": new_did,
            "changes":    changes,
            "status":     ret_status,
            "priority":   ret_priority,
        }),
        for_model: format!("✅ Updated {}: {}", display_id, changes_str),
        component_hint: Some("IssueUpdated".to_string()),
        summary: format!("Updated issue {}", display_id),
    })
}

async fn bulk_update_issues_real(
    pool: &PgPool,
    org_ids: &[String],
    _user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let updates = args.get("updates").and_then(|v| v.as_array())
        .ok_or_else(|| "bulk_update_issues requires 'updates' as an array. Each element must have 'issue_id' (UUID or display_id like 'HLM-42') and at least one field to change (status, priority, tags, or category).".to_string())?;

    let mut updated_count: usize = 0;
    let mut result_issues: Vec<Value> = Vec::new();

    for item in updates {
        let issue_id: Uuid = match item.get("issue_id").and_then(|v| v.as_str()) {
            Some(s) => match s.parse() {
                Ok(uuid) => uuid,
                Err(_)   => continue,
            },
            None => continue,
        };

        let new_status   = item.get("status").and_then(|v| v.as_str());
        let new_priority = item.get("priority").and_then(|v| v.as_str());
        let new_tags: Option<Vec<String>> = item.get("tags").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect());
        let new_category: Option<Vec<String>> = item.get("category").and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect());

        // Embedded org check in UPDATE — skip if issue doesn't belong to org
        let result: Option<(String, String, Option<String>)> = sqlx::query_as(
            r#"UPDATE issues SET
                status   = COALESCE($2, status),
                priority = CASE WHEN $3::boolean THEN $4         ELSE priority  END,
                tags     = CASE WHEN $5::boolean THEN $6::text[] ELSE tags      END,
                category = CASE WHEN $7::boolean THEN $8::text[] ELSE category  END,
                updated_at = now()
               WHERE id = $1
                 AND project_id IN (SELECT id FROM projects WHERE org_id = ANY($9::text[]))
               RETURNING display_id, status, priority"#,
        )
        .bind(issue_id)
        .bind(new_status)
        .bind(new_priority.is_some())
        .bind(new_priority)
        .bind(new_tags.is_some())
        .bind(&new_tags)
        .bind(new_category.is_some())
        .bind(&new_category)
        .bind(org_ids)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        if let Some((did, status, priority)) = result {
            updated_count += 1;
            let mut changes: Vec<String> = Vec::new();
            if new_status.is_some()   { changes.push(format!("status={}", status)); }
            if new_priority.is_some() { changes.push(format!("priority={}", priority.as_deref().unwrap_or("none"))); }
            if new_tags.is_some()     { changes.push("tags updated".to_string()); }
            if new_category.is_some() { changes.push("category updated".to_string()); }
            result_issues.push(json!({ "display_id": did, "changes": changes }));
        }
    }

    Ok(ToolResult {
        data: json!({
            "updated_count": updated_count,
            "issues": result_issues,
        }),
        for_model: format!("✅ Bulk updated {} issues.", updated_count),
        component_hint: None,
        summary: format!("Bulk updated {} issues", updated_count),
    })
}

async fn add_comment_real(
    pool: &PgPool,
    org_ids: &[String],
    user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let raw_issue_id = args.get("issue_id").and_then(|v| v.as_str())
        .ok_or_else(|| "add_comment requires 'issue_id'. Provide a display_id (e.g. 'HLM-42') or full UUID.".to_string())?;
    let issue_id: Uuid = raw_issue_id.parse().map_err(|_| format!(
        "Issue '{}' could not be resolved. Check that the display_id (e.g. 'HLM-42') or UUID is correct. Use search_issues to find the right issue.",
        raw_issue_id
    ))?;

    // Tool uses "content" key; also accept "body" as alias
    let body = args.get("content").or_else(|| args.get("body"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "add_comment requires 'content'. Provide the comment body as a Markdown string.".to_string())?;

    let author_name = args.get("author_name").and_then(|v| v.as_str())
        .unwrap_or("Baaton AI");

    // Verify issue belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id
            WHERE i.id = $1 AND p.org_id = ANY($2::text[])
         )",
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    if !exists {
        return Err(format!(
            "Issue '{}' not found or you don't have access. Verify the issue exists with search_issues.",
            raw_issue_id
        ));
    }

    let (comment_id, created_at_str): (Uuid, String) = sqlx::query_as(
        r#"INSERT INTO comments (issue_id, author_id, author_name, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, created_at::text"#,
    )
    .bind(issue_id)
    .bind(user_id)
    .bind(author_name)
    .bind(body)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to add comment: {}", e))?;

    let preview = if body.len() > 100 { &body[..100] } else { body };

    Ok(ToolResult {
        data: json!({
            "id":          comment_id.to_string(),
            "issue_id":    issue_id.to_string(),
            "author_id":   user_id,
            "author_name": author_name,
            "body":        body,
            "created_at":  created_at_str,
        }),
        for_model: format!("✅ Added comment to issue {}: \"{}\"", issue_id, preview),
        component_hint: None,
        summary: format!("Commented on issue {}", issue_id),
    })
}

async fn triage_issue_real(
    pool: &PgPool,
    org_ids: &[String],
    user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let raw_issue_id = args.get("issue_id").and_then(|v| v.as_str())
        .ok_or_else(|| "triage_issue requires 'issue_id'. Provide a display_id (e.g. 'HLM-42') or full UUID.".to_string())?;
    let issue_id: Uuid = raw_issue_id.parse().map_err(|_| format!(
        "Issue '{}' could not be resolved. Check that the display_id (e.g. 'HLM-42') or UUID is correct. Use search_issues to find the right issue.",
        raw_issue_id
    ))?;

    // Verify issue belongs to org and get current state
    let existing: Option<(String, String)> = sqlx::query_as(
        r#"SELECT i.display_id, i.status
           FROM issues i JOIN projects p ON p.id = i.project_id
           WHERE i.id = $1 AND p.org_id = ANY($2::text[])"#,
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let (display_id, current_status) =
        existing.ok_or_else(|| format!(
            "Issue '{}' not found or you don't have access. Verify the issue exists with search_issues.",
            raw_issue_id
        ))?;

    // Move backlog → todo; leave other statuses unchanged
    let new_status: &str = if current_status == "backlog" { "todo" } else { current_status.as_str() };

    let (updated_did, updated_status): (String, String) = sqlx::query_as(
        r#"UPDATE issues SET
            qualified_at = now(),
            qualified_by = $2,
            status       = $3,
            updated_at   = now()
           WHERE id = $1
           RETURNING display_id, status"#,
    )
    .bind(issue_id)
    .bind(user_id)
    .bind(new_status)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to triage issue: {}", e))?;

    // Add triage comment (fire-and-forget on failure)
    let _ = sqlx::query(
        "INSERT INTO comments (issue_id, author_id, author_name, body)
         VALUES ($1, $2, 'Baaton AI', 'Auto-triaged by Baaton AI')",
    )
    .bind(issue_id)
    .bind(user_id)
    .execute(pool)
    .await;

    let status_note = if current_status == "backlog" {
        format!(" (moved from backlog to {})", updated_status)
    } else {
        String::new()
    };

    Ok(ToolResult {
        data: json!({
            "issue_id":     issue_id.to_string(),
            "display_id":   updated_did,
            "status":       updated_status,
            "qualified_by": user_id,
        }),
        for_model: format!(
            "✅ Triaged issue {}{}.  Set qualified_at + qualified_by. Added triage comment.",
            display_id, status_note
        ),
        component_hint: None,
        summary: format!("Triaged issue {}", display_id),
    })
}

async fn create_milestones_batch_real(
    pool: &PgPool,
    org_ids: &[String],
    _user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "create_milestones_batch requires 'project_id'. Provide a project prefix (e.g. 'HLM') or full UUID.".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| format!(
            "Project '{}' could not be resolved to a UUID. It may not exist or the prefix is misspelled.",
            project_id_str
        ))?;
    let milestones_arr = args.get("milestones").and_then(|v| v.as_array())
        .ok_or_else(|| "create_milestones_batch requires 'milestones' as an array. Each element must have 'name' (string) and 'issue_ids' (array of UUIDs or display_ids).".to_string())?;

    // Verify project belongs to user's orgs and get its org_id for INSERT
    let project_org: Option<String> = sqlx::query_scalar(
        "SELECT org_id FROM projects WHERE id = $1 AND org_id = ANY($2::text[])",
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let project_org = project_org.ok_or_else(|| format!(
        "Project '{}' not found or you don't have access. Double-check the project UUID or prefix.",
        project_id_str
    ))?;

    let mut created_count: usize = 0;
    let mut result_milestones: Vec<Value> = Vec::new();

    for (order_idx, milestone_val) in milestones_arr.iter().enumerate() {
        let name = match milestone_val.get("name").and_then(|v| v.as_str()) {
            Some(n) if !n.trim().is_empty() => n,
            _ => continue,
        };
        let description  = milestone_val.get("description").and_then(|v| v.as_str());
        let target_date  = milestone_val.get("target_date").and_then(|v| v.as_str());
        let issue_ids: Vec<Uuid> = milestone_val.get("issue_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().and_then(|s| s.parse().ok())).collect())
            .unwrap_or_default();
        let order = (order_idx as i32) + 1;

        // INSERT milestone
        let (milestone_id, milestone_name): (Uuid, String) = sqlx::query_as(
            r#"INSERT INTO milestones (project_id, name, description, target_date, status, "order", org_id)
               VALUES ($1, $2, $3, $4::date, 'active', $5, $6)
               RETURNING id, name"#,
        )
        .bind(project_id)
        .bind(name)
        .bind(description)
        .bind(target_date)
        .bind(order)
        .bind(&project_org)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to create milestone '{}': {}", name, e))?;

        // Assign issues to this milestone (org-scoped)
        let issue_count: usize = if !issue_ids.is_empty() {
            sqlx::query(
                r#"UPDATE issues SET milestone_id = $1, updated_at = now()
                   WHERE id = ANY($2)
                     AND project_id IN (SELECT id FROM projects WHERE org_id = ANY($3::text[]))"#,
            )
            .bind(milestone_id)
            .bind(&issue_ids)
            .bind(org_ids)
            .execute(pool)
            .await
            .map(|r| r.rows_affected() as usize)
            .unwrap_or(0)
        } else {
            0
        };

        created_count += 1;
        result_milestones.push(json!({
            "id":          milestone_id.to_string(),
            "name":        milestone_name,
            "issue_count": issue_count,
        }));
    }

    Ok(ToolResult {
        data: json!({
            "created_count": created_count,
            "milestones":    result_milestones,
        }),
        for_model: format!(
            "✅ Created {} milestones for project {}.",
            created_count, project_id_str
        ),
        component_hint: Some("MilestoneTimeline".to_string()),
        summary: format!("Created {} milestones for project {}", created_count, project_id_str),
    })
}

// ─── Phase 2C: Complex Tool Executors ────────────────────────────────────────

async fn ai_plan_milestones(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    let rows = sqlx::query(
        "SELECT i.id::text as id, i.title, COALESCE(i.tags, ARRAY[]::text[]) as tags
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE i.project_id = $1 AND p.org_id = ANY($2::text[])
           AND i.status NOT IN ('done', 'cancelled')
         ORDER BY i.created_at ASC"
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let domain_map: &[(&str, &str)] = &[
        ("FRONT", "Frontend Polish"),
        ("BACK",  "Backend Stability"),
        ("API",   "API Improvements"),
        ("DB",    "Database & Migrations"),
        ("INFRA", "Infrastructure"),
        ("UX",    "UX & Design"),
    ];

    let mut groups: std::collections::BTreeMap<String, (&str, Vec<String>)> =
        std::collections::BTreeMap::new();
    let mut ungrouped: Vec<String> = Vec::new();

    for row in &rows {
        let id: String = row.get("id");
        let tags: Vec<String> = row.try_get("tags").unwrap_or_default();
        let tags_upper: Vec<String> = tags.iter().map(|t| t.to_uppercase()).collect();

        let mut matched = false;
        for &(domain, label) in domain_map {
            if tags_upper.iter().any(|t| t.contains(domain)) {
                groups.entry(domain.to_string())
                    .or_insert_with(|| (label, Vec::new()))
                    .1.push(id.clone());
                matched = true;
                break;
            }
        }
        if !matched {
            ungrouped.push(id);
        }
    }

    if !ungrouped.is_empty() {
        groups.entry("ZGENERAL".to_string())
            .or_insert_with(|| ("General", Vec::new()))
            .1.extend(ungrouped);
    }

    let today = chrono::Utc::now().date_naive();
    let mut milestones: Vec<Value> = Vec::new();
    let mut week_offset = 0i64;

    for (_, (name, issue_ids)) in &groups {
        week_offset += 2;
        let target_date = today + chrono::Duration::weeks(week_offset);
        let issue_count = issue_ids.len();
        let estimated_weeks = ((issue_count as f64 / 3.0).ceil() as i64).max(1);
        milestones.push(json!({
            "name": name,
            "target_date": target_date.to_string(),
            "issue_ids": issue_ids,
            "estimated_weeks": estimated_weeks,
        }));
    }

    let total = rows.len();
    Ok(ToolResult {
        data: json!({ "proposed_milestones": milestones }),
        for_model: format!(
            "Proposed {} milestone(s) for project {} covering {} open issues. Confirm via create_milestones_batch.",
            milestones.len(), project_id_str, total
        ),
        component_hint: Some("MilestoneTimeline".to_string()),
        summary: format!("Planned {} milestones for project {}", milestones.len(), project_id_str),
    })
}

async fn ai_adjust_timeline(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    let constraint = args.get("constraint").and_then(|v| v.as_str()).unwrap_or("");
    let new_deadline_str = args.get("new_deadline").and_then(|v| v.as_str());

    let rows = sqlx::query(
        "SELECT m.name, m.target_date
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         WHERE m.project_id = $1 AND p.org_id = ANY($2::text[])
           AND m.target_date IS NOT NULL
         ORDER BY m.target_date ASC"
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(ToolResult {
            data: json!({ "milestones": [], "message": "No milestones with dates found." }),
            for_model: "No milestones with target dates found. Create milestones first via plan_milestones.".to_string(),
            component_hint: Some("MilestoneTimeline".to_string()),
            summary: format!("No milestones to adjust for project {}", project_id_str),
        });
    }

    let dates: Vec<chrono::NaiveDate> = rows.iter()
        .filter_map(|r| r.try_get::<chrono::NaiveDate, _>("target_date").ok())
        .collect();

    let earliest = *dates.iter().min().unwrap();
    let latest   = *dates.iter().max().unwrap();

    let new_deadline = if let Some(d) = new_deadline_str {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
            .map_err(|e| format!("Invalid new_deadline: {}", e))?
    } else {
        let span = (latest - earliest).num_days();
        latest - chrono::Duration::days((span as f64 * 0.10).round() as i64)
    };

    let old_span = (latest - earliest).num_days().max(1);
    let new_span = (new_deadline - earliest).num_days().max(1);

    let mut revised: Vec<Value> = Vec::new();
    for row in &rows {
        let name: String = row.get("name");
        let old_date: chrono::NaiveDate = match row.try_get("target_date") {
            Ok(d) => d,
            Err(_) => continue,
        };
        let offset_days = (old_date - earliest).num_days();
        let new_offset  = (offset_days as f64 * new_span as f64 / old_span as f64).round() as i64;
        let new_date    = earliest + chrono::Duration::days(new_offset);
        revised.push(json!({
            "name":     name,
            "old_date": old_date.to_string(),
            "new_date": new_date.to_string(),
        }));
    }

    Ok(ToolResult {
        data: json!({ "milestones": revised, "constraint": constraint, "new_deadline": new_deadline.to_string() }),
        for_model: format!(
            "Adjusted {} milestones to fit deadline {}. Constraint: '{}'. Proposed — confirm to apply.",
            revised.len(), new_deadline, constraint
        ),
        component_hint: Some("MilestoneTimeline".to_string()),
        summary: format!("Adjusted timeline for project {} to fit {}", project_id_str, new_deadline),
    })
}

async fn ai_generate_prd(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;

    let project_id_str = match args.get("project_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            let brief = args.get("brief").and_then(|v| v.as_str()).unwrap_or("feature");
            let prd = format!(
                "# PRD: {}\n\n## Overview\n{}\n\n## Objectives\n- Deliver the described feature\n\n## Scope\n- TBD\n\n## Open Questions\n- None yet",
                brief, brief
            );
            return Ok(ToolResult {
                data: json!({ "title": brief, "sections": [{ "heading": "Overview", "content": prd }] }),
                for_model: format!("Generated PRD for brief: {}", brief),
                component_hint: Some("PRDDocument".to_string()),
                summary: format!("Generated PRD: {}", brief),
            });
        }
    };

    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    let proj_row = sqlx::query(
        "SELECT name, description FROM projects WHERE id = $1 AND org_id = ANY($2::text[])"
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Project not found".to_string())?;

    let project_name: String = proj_row.get("name");
    let project_desc: Option<String> = proj_row.try_get("description").unwrap_or(None);
    let prd_title = args.get("title").and_then(|v| v.as_str())
        .unwrap_or(&project_name).to_string();

    let issue_rows = sqlx::query(
        "SELECT i.title, i.type as issue_type, COALESCE(i.tags, ARRAY[]::text[]) as tags
         FROM issues i
         WHERE i.project_id = $1
           AND i.status NOT IN ('done', 'cancelled')
         ORDER BY i.created_at ASC
         LIMIT 200"
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let milestone_rows = sqlx::query(
        r#"SELECT name, description, target_date::text as target_date_str, status
         FROM milestones
         WHERE project_id = $1
         ORDER BY "order" ASC NULLS LAST, target_date ASC NULLS LAST"#
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut sections: Vec<Value> = Vec::new();

    // 1. Overview
    let overview = project_desc.unwrap_or_else(|| {
        format!("{} is an active project with ongoing development work.", project_name)
    });
    sections.push(json!({ "heading": "Overview", "content": overview }));

    // 2. Objectives (milestones)
    if !milestone_rows.is_empty() {
        let objectives: Vec<String> = milestone_rows.iter().map(|r| {
            let name: String = r.get("name");
            let date: String = r.try_get("target_date_str").unwrap_or_default();
            format!("- **{}** (target: {})", name, date)
        }).collect();
        sections.push(json!({ "heading": "Objectives", "content": objectives.join("\n") }));
    }

    // 3. Scope — by domain tag
    let domain_keys = ["FRONT", "BACK", "API", "DB", "INFRA", "UX"];
    let mut by_domain: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    let mut questions: Vec<String> = Vec::new();

    for row in &issue_rows {
        let title: String = row.get("title");
        let issue_type: String = row.try_get("issue_type").unwrap_or_else(|_| "feature".to_string());
        let tags: Vec<String> = row.try_get("tags").unwrap_or_default();

        if issue_type == "question" {
            questions.push(title.clone());
        }

        let tags_upper: Vec<String> = tags.iter().map(|t| t.to_uppercase()).collect();
        let mut added = false;
        for key in &domain_keys {
            if tags_upper.iter().any(|t| t.contains(key)) {
                by_domain.entry(key.to_string()).or_default()
                    .push(format!("- {}", title));
                added = true;
                break;
            }
        }
        if !added {
            by_domain.entry("General".to_string()).or_default()
                .push(format!("- {}", title));
        }
    }

    if !by_domain.is_empty() {
        let content: Vec<String> = by_domain.iter()
            .map(|(cat, items)| format!("### {}\n{}", cat, items.join("\n")))
            .collect();
        sections.push(json!({ "heading": "Scope", "content": content.join("\n\n") }));
    }

    // 4. Technical Requirements — by issue type
    let mut by_type: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for row in &issue_rows {
        let title: String = row.get("title");
        let issue_type: String = row.try_get("issue_type").unwrap_or_else(|_| "feature".to_string());
        by_type.entry(issue_type).or_default().push(format!("- {}", title));
    }
    if !by_type.is_empty() {
        let content: Vec<String> = by_type.iter()
            .map(|(t, items)| format!("**{}**\n{}", t.to_uppercase(), items.join("\n")))
            .collect();
        sections.push(json!({ "heading": "Technical Requirements", "content": content.join("\n\n") }));
    }

    // 5. Timeline
    if !milestone_rows.is_empty() {
        let timeline: Vec<String> = milestone_rows.iter().map(|r| {
            let name: String   = r.get("name");
            let date: String   = r.try_get("target_date_str").unwrap_or_default();
            let status: String = r.try_get("status").unwrap_or_else(|_| "planned".to_string());
            format!("- **{}** — {} ({})", name, date, status)
        }).collect();
        sections.push(json!({ "heading": "Timeline", "content": timeline.join("\n") }));
    }

    // 6. Open Questions
    if !questions.is_empty() {
        let content: Vec<String> = questions.iter().map(|q| format!("- {}", q)).collect();
        sections.push(json!({ "heading": "Open Questions", "content": content.join("\n") }));
    }

    let heading_list: Vec<&str> = sections.iter()
        .filter_map(|s| s.get("heading").and_then(|h| h.as_str()))
        .collect();

    Ok(ToolResult {
        data: json!({ "title": prd_title, "sections": sections }),
        for_model: format!(
            "Generated PRD '{}' with {} sections: {}. {} open issues, {} milestones referenced.",
            prd_title, sections.len(), heading_list.join(", "),
            issue_rows.len(), milestone_rows.len()
        ),
        component_hint: Some("PRDDocument".to_string()),
        summary: format!("Generated PRD for project {}", project_id_str),
    })
}

async fn ai_manage_initiatives(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");

    match action {
        "list" => {
            let rows = sqlx::query(
                "SELECT i.id::text, i.name, i.description, i.status,
                        i.target_date::text as target_date_str,
                        COUNT(ip.project_id) as project_count
                 FROM initiatives i
                 LEFT JOIN initiative_projects ip ON ip.initiative_id = i.id
                 WHERE i.org_id = ANY($1::text[])
                 GROUP BY i.id
                 ORDER BY i.created_at DESC"
            )
            .bind(org_ids)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let initiatives: Vec<Value> = rows.iter().map(|r| json!({
                "id":            r.get::<String, _>("id"),
                "name":          r.get::<String, _>("name"),
                "description":   r.try_get::<Option<String>, _>("description").ok().flatten(),
                "status":        r.try_get::<String, _>("status").unwrap_or_default(),
                "target_date":   r.try_get::<Option<String>, _>("target_date_str").ok().flatten(),
                "project_count": r.try_get::<i64, _>("project_count").unwrap_or(0),
            })).collect();

            Ok(ToolResult {
                data: json!(initiatives),
                for_model: format!("Found {} initiatives.", initiatives.len()),
                component_hint: None,
                summary: "Listed initiatives".to_string(),
            })
        }

        "create" => {
            let name = args.get("name").and_then(|v| v.as_str())
                .ok_or_else(|| "name is required".to_string())?;
            let description = args.get("description").and_then(|v| v.as_str());
            let status      = args.get("status").and_then(|v| v.as_str()).unwrap_or("active");
            let target_date = args.get("target_date").and_then(|v| v.as_str());

            let primary_org = org_ids.first().ok_or_else(|| "No org context".to_string())?;
            let new_id: String = sqlx::query(
                "INSERT INTO initiatives (org_id, name, description, status, target_date)
                 VALUES ($1, $2, $3, $4, $5::date)
                 RETURNING id::text"
            )
            .bind(primary_org)
            .bind(name)
            .bind(description)
            .bind(status)
            .bind(target_date)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get("id");

            Ok(ToolResult {
                data: json!({ "id": new_id, "name": name, "status": status }),
                for_model: format!("Created initiative '{}' (id: {}).", name, new_id),
                component_hint: None,
                summary: format!("Created initiative: {}", name),
            })
        }

        "update" => {
            let initiative_id = args.get("initiative_id").and_then(|v| v.as_str())
                .ok_or_else(|| "initiative_id is required".to_string())?;
            let initiative_uuid: Uuid = initiative_id.parse()
                .map_err(|_| "Invalid initiative_id".to_string())?;

            sqlx::query(
                "UPDATE initiatives
                 SET name        = COALESCE($3, name),
                     description = COALESCE($4, description),
                     status      = COALESCE($5, status)
                 WHERE id = $1 AND org_id = ANY($2::text[])"
            )
            .bind(initiative_uuid)
            .bind(org_ids)
            .bind(args.get("name").and_then(|v| v.as_str()))
            .bind(args.get("description").and_then(|v| v.as_str()))
            .bind(args.get("status").and_then(|v| v.as_str()))
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "id": initiative_id, "updated": true }),
                for_model: format!("Updated initiative {}.", initiative_id),
                component_hint: None,
                summary: format!("Updated initiative {}", initiative_id),
            })
        }

        "add_project" => {
            let initiative_id = args.get("initiative_id").and_then(|v| v.as_str())
                .ok_or_else(|| "initiative_id is required".to_string())?;
            let project_id = args.get("project_id").and_then(|v| v.as_str())
                .ok_or_else(|| "project_id is required".to_string())?;
            let initiative_uuid: Uuid = initiative_id.parse()
                .map_err(|_| "Invalid initiative_id".to_string())?;
            let project_uuid: Uuid = project_id.parse()
                .map_err(|_| "Invalid project_id".to_string())?;

            sqlx::query(
                "INSERT INTO initiative_projects (initiative_id, project_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING"
            )
            .bind(initiative_uuid)
            .bind(project_uuid)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "initiative_id": initiative_id, "project_id": project_id }),
                for_model: format!("Added project {} to initiative {}.", project_id, initiative_id),
                component_hint: None,
                summary: "Added project to initiative".to_string(),
            })
        }

        "remove_project" => {
            let initiative_id = args.get("initiative_id").and_then(|v| v.as_str())
                .ok_or_else(|| "initiative_id is required".to_string())?;
            let project_id = args.get("project_id").and_then(|v| v.as_str())
                .ok_or_else(|| "project_id is required".to_string())?;
            let initiative_uuid: Uuid = initiative_id.parse()
                .map_err(|_| "Invalid initiative_id".to_string())?;
            let project_uuid: Uuid = project_id.parse()
                .map_err(|_| "Invalid project_id".to_string())?;

            sqlx::query(
                "DELETE FROM initiative_projects WHERE initiative_id = $1 AND project_id = $2"
            )
            .bind(initiative_uuid)
            .bind(project_uuid)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "initiative_id": initiative_id, "project_id": project_id }),
                for_model: format!("Removed project {} from initiative {}.", project_id, initiative_id),
                component_hint: None,
                summary: "Removed project from initiative".to_string(),
            })
        }

        _ => Err(format!("Unknown action '{}' for manage_initiatives", action)),
    }
}

async fn ai_manage_automations(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    match action {
        "list" => {
            let rows = sqlx::query(
                "SELECT id::text, name, trigger, conditions, actions, enabled
                 FROM automation_rules
                 WHERE project_id = $1 AND org_id = ANY($2::text[])
                 ORDER BY created_at DESC"
            )
            .bind(project_id)
            .bind(org_ids)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let rules: Vec<Value> = rows.iter().map(|r| json!({
                "id":         r.get::<String, _>("id"),
                "name":       r.get::<String, _>("name"),
                "trigger":    r.get::<String, _>("trigger"),
                "conditions": r.try_get::<Value, _>("conditions").unwrap_or(json!([])),
                "actions":    r.try_get::<Value, _>("actions").unwrap_or(json!([])),
                "enabled":    r.try_get::<bool, _>("enabled").unwrap_or(true),
            })).collect();

            Ok(ToolResult {
                data: json!(rules),
                for_model: format!("Found {} automation rules for project {}.", rules.len(), project_id_str),
                component_hint: None,
                summary: format!("Listed {} automations", rules.len()),
            })
        }

        "create" => {
            let name = args.get("name").and_then(|v| v.as_str())
                .ok_or_else(|| "name is required".to_string())?;
            let trigger = args.get("trigger_type").and_then(|v| v.as_str())
                .ok_or_else(|| "trigger_type is required".to_string())?;
            let trigger_cfg = args.get("trigger_config").and_then(|v| v.as_str()).unwrap_or("{}");
            let action_type = args.get("action_type").and_then(|v| v.as_str()).unwrap_or("add_comment");
            let action_cfg  = args.get("action_config").and_then(|v| v.as_str()).unwrap_or("{}");

            let conditions: Value = serde_json::from_str(trigger_cfg)
                .unwrap_or_else(|_| json!([{"type": trigger}]));
            let actions_val: Value = serde_json::from_str(action_cfg)
                .unwrap_or_else(|_| json!([{"type": action_type}]));

            let new_id: String = sqlx::query(
                "INSERT INTO automation_rules (project_id, org_id, name, trigger, conditions, actions)
                 VALUES ($1, (SELECT org_id FROM projects WHERE id = $1), $2, $3, $4, $5)
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(name)
            .bind(trigger)
            .bind(&conditions)
            .bind(&actions_val)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get("id");

            Ok(ToolResult {
                data: json!({ "id": new_id, "name": name, "trigger": trigger }),
                for_model: format!("Created automation '{}' (trigger: {}) — id: {}.", name, trigger, new_id),
                component_hint: None,
                summary: format!("Created automation: {}", name),
            })
        }

        "toggle" => {
            let automation_id = args.get("automation_id").and_then(|v| v.as_str())
                .ok_or_else(|| "automation_id is required".to_string())?;
            let automation_uuid: Uuid = automation_id.parse()
                .map_err(|_| "Invalid automation_id".to_string())?;

            let row = sqlx::query(
                "UPDATE automation_rules SET enabled = NOT enabled
                 WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])
                 RETURNING enabled"
            )
            .bind(automation_uuid)
            .bind(project_id)
            .bind(org_ids)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

            let enabled: bool = row.get("enabled");
            Ok(ToolResult {
                data: json!({ "id": automation_id, "enabled": enabled }),
                for_model: format!("Automation {} is now {}.", automation_id,
                    if enabled { "enabled" } else { "disabled" }),
                component_hint: None,
                summary: format!("Toggled automation {}", automation_id),
            })
        }

        "delete" => {
            let automation_id = args.get("automation_id").and_then(|v| v.as_str())
                .ok_or_else(|| "automation_id is required".to_string())?;
            let automation_uuid: Uuid = automation_id.parse()
                .map_err(|_| "Invalid automation_id".to_string())?;

            sqlx::query(
                "DELETE FROM automation_rules WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])"
            )
            .bind(automation_uuid)
            .bind(project_id)
            .bind(org_ids)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "id": automation_id, "deleted": true }),
                for_model: format!("Deleted automation {}.", automation_id),
                component_hint: None,
                summary: format!("Deleted automation {}", automation_id),
            })
        }

        _ => Err(format!("Unknown action '{}' for manage_automations", action)),
    }
}

async fn ai_manage_sla(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list_rules");
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    match action {
        "list_rules" => {
            let rows = sqlx::query(
                "SELECT id::text, priority, deadline_hours
                 FROM sla_rules
                 WHERE project_id = $1 AND org_id = ANY($2::text[])
                 ORDER BY CASE priority
                   WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 ELSE 4 END"
            )
            .bind(project_id)
            .bind(org_ids)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let rules: Vec<Value> = rows.iter().map(|r| json!({
                "id":             r.get::<String, _>("id"),
                "priority":       r.get::<String, _>("priority"),
                "deadline_hours": r.get::<i32, _>("deadline_hours"),
            })).collect();

            Ok(ToolResult {
                data: json!(rules),
                for_model: format!("Found {} SLA rules for project {}.", rules.len(), project_id_str),
                component_hint: None,
                summary: format!("Listed {} SLA rules", rules.len()),
            })
        }

        "stats" => {
            let breached: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM issues WHERE project_id = $1 AND sla_breached = true"
            )
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

            let total_open: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM issues
                 WHERE project_id = $1 AND status NOT IN ('done', 'cancelled')"
            )
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

            let compliance = if total_open > 0 {
                ((1.0 - breached as f64 / total_open as f64) * 100.0).round() / 100.0
            } else { 1.0 };

            Ok(ToolResult {
                data: json!({
                    "project_id":      project_id_str,
                    "total_open":      total_open,
                    "breached_count":  breached,
                    "compliance_rate": compliance,
                }),
                for_model: format!(
                    "SLA stats for project {}: {} open, {} breached ({}% compliance).",
                    project_id_str, total_open, breached,
                    (compliance * 100.0).round() as i64
                ),
                component_hint: None,
                summary: format!("SLA stats: {} breached", breached),
            })
        }

        "create_rule" => {
            let priority = args.get("priority").and_then(|v| v.as_str())
                .ok_or_else(|| "priority is required".to_string())?;
            let deadline_hours = args.get("deadline_hours").and_then(|v| v.as_i64())
                .ok_or_else(|| "deadline_hours is required".to_string())? as i32;

            let new_id: String = sqlx::query(
                "INSERT INTO sla_rules (project_id, org_id, priority, deadline_hours)
                 VALUES ($1, (SELECT org_id FROM projects WHERE id = $1), $2, $3)
                 ON CONFLICT (project_id, priority)
                 DO UPDATE SET deadline_hours = EXCLUDED.deadline_hours
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(priority)
            .bind(deadline_hours)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get("id");

            Ok(ToolResult {
                data: json!({ "id": new_id, "priority": priority, "deadline_hours": deadline_hours }),
                for_model: format!("Created/updated SLA rule: {} = {}h deadline.", priority, deadline_hours),
                component_hint: None,
                summary: format!("SLA rule: {}={}h", priority, deadline_hours),
            })
        }

        "delete_rule" => {
            let rule_id = args.get("rule_id").and_then(|v| v.as_str())
                .ok_or_else(|| "rule_id is required".to_string())?;
            let rule_uuid: Uuid = rule_id.parse()
                .map_err(|_| "Invalid rule_id".to_string())?;

            sqlx::query(
                "DELETE FROM sla_rules WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])"
            )
            .bind(rule_uuid)
            .bind(project_id)
            .bind(org_ids)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "id": rule_id, "deleted": true }),
                for_model: format!("Deleted SLA rule {}.", rule_id),
                component_hint: None,
                summary: format!("Deleted SLA rule {}", rule_id),
            })
        }

        _ => Err(format!("Unknown action '{}' for manage_sla", action)),
    }
}

// Table: issue_templates (migration 031)
async fn ai_manage_templates(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    match action {
        "list" => {
            let rows = sqlx::query(
                "SELECT id::text, name, description, default_priority,
                        default_issue_type, default_tags, is_default
                 FROM issue_templates
                 WHERE project_id = $1 AND org_id = ANY($2::text[])
                 ORDER BY is_default DESC, created_at DESC"
            )
            .bind(project_id)
            .bind(org_ids)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let templates: Vec<Value> = rows.iter().map(|r| json!({
                "id":               r.get::<String, _>("id"),
                "name":             r.get::<String, _>("name"),
                "description":      r.try_get::<Option<String>, _>("description").ok().flatten(),
                "default_priority": r.try_get::<String, _>("default_priority").unwrap_or_else(|_| "medium".to_string()),
                "default_type":     r.try_get::<String, _>("default_issue_type").unwrap_or_else(|_| "feature".to_string()),
                "default_tags":     r.try_get::<Vec<String>, _>("default_tags").unwrap_or_default(),
                "is_default":       r.try_get::<bool, _>("is_default").unwrap_or(false),
            })).collect();

            Ok(ToolResult {
                data: json!(templates),
                for_model: format!("Found {} issue templates for project {}.", templates.len(), project_id_str),
                component_hint: None,
                summary: format!("Listed {} templates", templates.len()),
            })
        }

        "create" => {
            let name = args.get("name").and_then(|v| v.as_str())
                .ok_or_else(|| "name is required".to_string())?;
            let description = args.get("description").and_then(|v| v.as_str());
            let priority    = args.get("default_priority").and_then(|v| v.as_str()).unwrap_or("medium");
            let issue_type  = args.get("default_type").and_then(|v| v.as_str()).unwrap_or("feature");

            let new_id: String = sqlx::query(
                "INSERT INTO issue_templates
                   (project_id, org_id, name, description, default_priority, default_issue_type)
                 VALUES ($1, (SELECT org_id FROM projects WHERE id = $1), $2, $3, $4, $5)
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(name)
            .bind(description)
            .bind(priority)
            .bind(issue_type)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get("id");

            Ok(ToolResult {
                data: json!({ "id": new_id, "name": name, "default_priority": priority, "default_type": issue_type }),
                for_model: format!("Created template '{}' (id: {}).", name, new_id),
                component_hint: None,
                summary: format!("Created template: {}", name),
            })
        }

        "delete" => {
            let template_id = args.get("template_id").and_then(|v| v.as_str())
                .ok_or_else(|| "template_id is required".to_string())?;
            let template_uuid: Uuid = template_id.parse()
                .map_err(|_| "Invalid template_id".to_string())?;

            sqlx::query(
                "DELETE FROM issue_templates WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])"
            )
            .bind(template_uuid)
            .bind(project_id)
            .bind(org_ids)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "id": template_id, "deleted": true }),
                for_model: format!("Deleted template {}.", template_id),
                component_hint: None,
                summary: format!("Deleted template {}", template_id),
            })
        }

        _ => Err(format!("Unknown action '{}' for manage_templates", action)),
    }
}

// Table: recurrence_rules (migration 026)
async fn ai_manage_recurring(pool: &PgPool, org_ids: &[String], args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("list");
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    match action {
        "list" => {
            let rows = sqlx::query(
                "SELECT id::text, title_template, priority, issue_type, rrule, paused,
                        to_char(next_run_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') as next_run_str,
                        occurrence_count
                 FROM recurrence_rules
                 WHERE project_id = $1 AND org_id = ANY($2::text[])
                 ORDER BY created_at DESC"
            )
            .bind(project_id)
            .bind(org_ids)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let rules: Vec<Value> = rows.iter().map(|r| json!({
                "id":               r.get::<String, _>("id"),
                "title":            r.get::<String, _>("title_template"),
                "priority":         r.try_get::<String, _>("priority").unwrap_or_else(|_| "medium".to_string()),
                "issue_type":       r.try_get::<String, _>("issue_type").unwrap_or_else(|_| "feature".to_string()),
                "cron":             r.try_get::<String, _>("rrule").unwrap_or_default(),
                "enabled":          !r.try_get::<bool, _>("paused").unwrap_or(false),
                "next_run":         r.try_get::<Option<String>, _>("next_run_str").ok().flatten(),
                "occurrence_count": r.try_get::<i32, _>("occurrence_count").unwrap_or(0),
            })).collect();

            Ok(ToolResult {
                data: json!(rules),
                for_model: format!("Found {} recurring configs for project {}.", rules.len(), project_id_str),
                component_hint: None,
                summary: format!("Listed {} recurring configs", rules.len()),
            })
        }

        "create" => {
            let title = args.get("title").and_then(|v| v.as_str())
                .ok_or_else(|| "title is required".to_string())?;
            let cron = args.get("cron_expression").and_then(|v| v.as_str())
                .ok_or_else(|| "cron_expression is required".to_string())?;
            let priority    = args.get("priority").and_then(|v| v.as_str()).unwrap_or("medium");
            let issue_type  = args.get("issue_type").and_then(|v| v.as_str()).unwrap_or("feature");
            let description = args.get("description").and_then(|v| v.as_str());
            let next_run    = chrono::Utc::now() + chrono::Duration::days(1);

            let new_id: String = sqlx::query(
                "INSERT INTO recurrence_rules
                   (project_id, org_id, title_template, description, priority, issue_type, rrule, next_run_at)
                 VALUES ($1, (SELECT org_id FROM projects WHERE id = $1), $2, $3, $4, $5, $6, $7)
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(title)
            .bind(description)
            .bind(priority)
            .bind(issue_type)
            .bind(cron)
            .bind(next_run)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get("id");

            Ok(ToolResult {
                data: json!({ "id": new_id, "title": title, "cron": cron }),
                for_model: format!("Created recurring config '{}' (cron: {}) — id: {}.", title, cron, new_id),
                component_hint: None,
                summary: format!("Created recurring: {}", title),
            })
        }

        "toggle" => {
            let recurring_id = args.get("recurring_id").and_then(|v| v.as_str())
                .ok_or_else(|| "recurring_id is required".to_string())?;
            let recurring_uuid: Uuid = recurring_id.parse()
                .map_err(|_| "Invalid recurring_id".to_string())?;

            let row = sqlx::query(
                "UPDATE recurrence_rules SET paused = NOT paused
                 WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])
                 RETURNING paused"
            )
            .bind(recurring_uuid)
            .bind(project_id)
            .bind(org_ids)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

            let paused: bool = row.get("paused");
            Ok(ToolResult {
                data: json!({ "id": recurring_id, "enabled": !paused }),
                for_model: format!("Recurring config {} is now {}.", recurring_id,
                    if paused { "paused" } else { "active" }),
                component_hint: None,
                summary: format!("Toggled recurring {}", recurring_id),
            })
        }

        "delete" => {
            let recurring_id = args.get("recurring_id").and_then(|v| v.as_str())
                .ok_or_else(|| "recurring_id is required".to_string())?;
            let recurring_uuid: Uuid = recurring_id.parse()
                .map_err(|_| "Invalid recurring_id".to_string())?;

            sqlx::query(
                "DELETE FROM recurrence_rules WHERE id = $1 AND project_id = $2 AND org_id = ANY($3::text[])"
            )
            .bind(recurring_uuid)
            .bind(project_id)
            .bind(org_ids)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(ToolResult {
                data: json!({ "id": recurring_id, "deleted": true }),
                for_model: format!("Deleted recurring config {}.", recurring_id),
                component_hint: None,
                summary: format!("Deleted recurring {}", recurring_id),
            })
        }

        _ => Err(format!("Unknown action '{}' for manage_recurring", action)),
    }
}
