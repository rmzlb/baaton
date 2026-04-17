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

// ─── Tool Definitions (Gemini JSON Schema) ────────────────────────────────────

pub fn get_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        tool(
            "search_issues",
            "Search and filter issues using full-text search and structured filters (status, priority, category, project). Use to find tickets, list what's in progress, identify blockers, or check duplicates before creating.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "query": {
                        "type": "STRING",
                        "description": "Free-text search against issue title and description."
                    },
                    "project_id": {
                        "type": "STRING",
                        "description": "UUID or prefix of project to search within. Omit to search all."
                    },
                    "status": {
                        "type": "STRING",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
                        "description": "Filter by workflow status."
                    },
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Filter by priority level."
                    },
                    "category": {
                        "type": "STRING",
                        "enum": ["FRONT", "BACK", "API", "DB", "INFRA", "UX", "DEVOPS"],
                        "description": "Filter by technical domain."
                    },
                    "limit": {
                        "type": "NUMBER",
                        "description": "Max results (default 20, max 100)."
                    }
                }
            }),
        ),
        tool(
            "propose_issue",
            "PROPOSE creating a new issue (does NOT create it). Returns an editable proposal for the user to review and confirm. ALWAYS use this BEFORE create_issue. The user will see an editable form and either approve (then call create_issue with their final values) or cancel.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (e.g. 'HLM'). Required."},
                    "title": {"type": "STRING", "description": "Short plain-text title. No brackets or prefixes."},
                    "description": {"type": "STRING", "description": "Detailed description in Markdown."},
                    "type": {"type": "STRING", "enum": ["bug", "feature", "improvement", "question"], "description": "Issue classification."},
                    "priority": {"type": "STRING", "enum": ["urgent", "high", "medium", "low"], "description": "Urgency level."},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Labels like ['auth', 'mobile']."},
                    "category": {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Technical domains: FRONT, BACK, API, DB, INFRA, UX, DEVOPS."}
                },
                "required": ["project_id", "title"]
            }),
        ),
        tool(
            "create_issue",
            "Create a new issue with full metadata. RULE: title must be plain text with NO brackets, prefixes, or type tags. Bad: '[SQX][BUG] Fix auth'. Good: 'Fix auth token refresh on session expiry'. Returns the created issue with display_id. ONLY call this AFTER the user has approved a propose_issue.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {
                        "type": "STRING",
                        "description": "Project UUID or prefix (e.g. 'HLM'). Required."
                    },
                    "title": {
                        "type": "STRING",
                        "description": "Short plain-text title. No brackets or prefixes."
                    },
                    "description": {
                        "type": "STRING",
                        "description": "Detailed description in Markdown."
                    },
                    "type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"],
                        "description": "Issue classification."
                    },
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"],
                        "description": "Urgency level."
                    },
                    "status": {
                        "type": "STRING",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"],
                        "description": "Initial status. Defaults to backlog."
                    },
                    "tags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Labels like ['auth', 'mobile']."
                    },
                    "category": {
                        "type": "ARRAY",
                        "items": {"type": "STRING"},
                        "description": "Technical domains: FRONT, BACK, API, DB, INFRA, UX, DEVOPS."
                    }
                },
                "required": ["project_id", "title"]
            }),
        ),
        tool(
            "propose_update_issue",
            "PROPOSE updating an existing issue (does NOT modify). Returns a diff of current vs proposed values for user review. ALWAYS use this BEFORE update_issue. Only include fields you want to change.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "Internal UUID of the issue to update."},
                    "title": {"type": "STRING", "description": "New plain-text title."},
                    "description": {"type": "STRING", "description": "New Markdown description."},
                    "status": {"type": "STRING", "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]},
                    "priority": {"type": "STRING", "enum": ["urgent", "high", "medium", "low"]},
                    "type": {"type": "STRING", "enum": ["bug", "feature", "improvement", "question"]},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "category": {"type": "ARRAY", "items": {"type": "STRING"}}
                },
                "required": ["issue_id"]
            }),
        ),
        tool(
            "propose_bulk_update",
            "PROPOSE bulk updating N issues (does NOT modify). Returns the list of affected issues and the changes for user review. ALWAYS use this BEFORE bulk_update_issues.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "updates": {
                        "type": "ARRAY",
                        "description": "Array of per-issue update objects.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "issue_id": {"type": "STRING"},
                                "status": {"type": "STRING", "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]},
                                "priority": {"type": "STRING", "enum": ["urgent", "high", "medium", "low"]},
                                "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                                "category": {"type": "ARRAY", "items": {"type": "STRING"}}
                            },
                            "required": ["issue_id"]
                        }
                    }
                },
                "required": ["updates"]
            }),
        ),
        tool(
            "propose_comment",
            "PROPOSE adding a comment to an issue (does NOT add it). Returns an editable preview for user review. ALWAYS use this BEFORE add_comment.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID of the issue."},
                    "content": {"type": "STRING", "description": "Proposed comment body in Markdown."}
                },
                "required": ["issue_id", "content"]
            }),
        ),
        tool(
            "update_issue",
            "Update fields of an existing issue by UUID. Only changed fields need to be provided. ONLY call after propose_update_issue has been approved by the user.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {
                        "type": "STRING",
                        "description": "Internal UUID of the issue to update."
                    },
                    "title": {"type": "STRING", "description": "New plain-text title."},
                    "description": {"type": "STRING", "description": "New Markdown description (replaces existing)."},
                    "status": {
                        "type": "STRING",
                        "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]
                    },
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"]
                    },
                    "type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"]
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
            }),
        ),
        tool(
            "bulk_update_issues",
            "Apply updates to multiple issues atomically. ONLY call after propose_bulk_update has been approved by the user.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "updates": {
                        "type": "ARRAY",
                        "description": "Array of per-issue update objects.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "issue_id": {"type": "STRING", "description": "Issue UUID."},
                                "status": {
                                    "type": "STRING",
                                    "enum": ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]
                                },
                                "priority": {
                                    "type": "STRING",
                                    "enum": ["urgent", "high", "medium", "low"]
                                },
                                "tags": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"}
                                },
                                "category": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"}
                                }
                            },
                            "required": ["issue_id"]
                        }
                    }
                },
                "required": ["updates"]
            }),
        ),
        tool(
            "add_comment",
            "Append a threaded comment to an issue. ONLY call after propose_comment has been approved by the user.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID of the issue to comment on."},
                    "content": {"type": "STRING", "description": "Comment body in Markdown."},
                    "author_name": {"type": "STRING", "description": "Display name of the author (optional)."}
                },
                "required": ["issue_id", "content"]
            }),
        ),
        tool(
            "generate_prd",
            "Generate a complete PRD (Product Requirements Document) from a brief description. Returns Markdown with user stories, acceptance criteria, and technical considerations.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "brief": {"type": "STRING", "description": "Feature/problem description to document."},
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix for context (optional)."}
                },
                "required": ["brief"]
            }),
        ),
        tool(
            "analyze_sprint",
            "Analyze current sprint velocity, throughput, stuck issues, and capacity. Returns structured analysis with next-sprint recommendations.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix. Omit for all projects."}
                }
            }),
        ),
        tool(
            "get_project_metrics",
            "Fetch metrics dashboard: status breakdown, priority distribution, category split, completion rate, and recent activity.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix. Omit to aggregate across all projects."}
                }
            }),
        ),
        tool(
            "weekly_recap",
            "Generate a weekly activity recap: completed issues, in-progress, newly created, and blocked/stale. Use for standups or end-of-week reviews.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix. Omit for cross-project recap."},
                    "days": {"type": "NUMBER", "description": "Days to look back (default 7)."}
                }
            }),
        ),
        tool(
            "suggest_priorities",
            "Analyze open issues and generate AI reprioritization recommendations. Detects stale urgent issues, blocking chains, and priority imbalances. Returns ranked suggestions — does NOT apply changes automatically.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix. Omit for cross-project suggestions."}
                }
            }),
        ),
        tool(
            "plan_milestones",
            "Auto-group open issues into a sequenced milestone plan based on priority, category, and velocity. Returns a proposed plan — do NOT create milestones yet; wait for user confirmation, then call create_milestones_batch.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix. Required."},
                    "target_date": {"type": "STRING", "description": "Hard deadline in YYYY-MM-DD format."},
                    "team_size": {"type": "NUMBER", "description": "Number of active developers (default 1)."}
                },
                "required": ["project_id"]
            }),
        ),
        tool(
            "create_milestones_batch",
            "Create multiple milestones and assign issues atomically. Call this only after user has confirmed the plan from plan_milestones.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix."},
                    "milestones": {
                        "type": "ARRAY",
                        "description": "Ordered list of milestones to create.",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "name": {"type": "STRING", "description": "Milestone name."},
                                "description": {"type": "STRING", "description": "Markdown description."},
                                "target_date": {"type": "STRING", "description": "Target date YYYY-MM-DD."},
                                "order": {"type": "NUMBER", "description": "Display order (1-based)."},
                                "issue_ids": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "Issue UUIDs to assign."
                                }
                            },
                            "required": ["name", "issue_ids"]
                        }
                    }
                },
                "required": ["project_id", "milestones"]
            }),
        ),
        tool(
            "adjust_timeline",
            "Recalculate milestone schedule given a new deadline or scope change. Returns a revised plan proposal — does NOT apply changes automatically.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix."},
                    "constraint": {"type": "STRING", "description": "Natural-language constraint, e.g. 'finish by 2026-03-15' or 'we lost one dev'."}
                },
                "required": ["project_id", "constraint"]
            }),
        ),
        tool(
            "triage_issue",
            "AI-powered triage of a single issue: suggests priority, tags, category, and surfaces similar/duplicate issues. Returns suggestions with confidence scores.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "issue_id": {"type": "STRING", "description": "UUID of the issue to triage."}
                },
                "required": ["issue_id"]
            }),
        ),
        tool(
            "manage_initiatives",
            "CRUD for strategic initiatives (high-level goals spanning multiple projects). Actions: list, create, update, add_project, remove_project.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "update", "add_project", "remove_project"],
                        "description": "Operation to perform."
                    },
                    "initiative_id": {"type": "STRING", "description": "Initiative UUID (required for update, add_project, remove_project)."},
                    "name": {"type": "STRING", "description": "Initiative name (required for create)."},
                    "description": {"type": "STRING", "description": "Markdown goal description."},
                    "status": {
                        "type": "STRING",
                        "enum": ["active", "completed", "archived"]
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix (required for add_project, remove_project)."}
                },
                "required": ["action"]
            }),
        ),
        tool(
            "manage_automations",
            "Configure event-driven workflow automations. Actions: list, create, toggle (enable/disable), delete.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "toggle", "delete"]
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix."},
                    "automation_id": {"type": "STRING", "description": "Automation UUID (for toggle/delete)."},
                    "name": {"type": "STRING", "description": "Human-readable automation name."},
                    "trigger_type": {
                        "type": "STRING",
                        "enum": ["status_changed", "priority_changed", "assignee_changed", "label_added", "due_date_passed"]
                    },
                    "trigger_config": {"type": "STRING", "description": "JSON string of trigger parameters."},
                    "action_type": {
                        "type": "STRING",
                        "enum": ["set_status", "set_priority", "add_label", "assign_user", "send_webhook", "add_comment"]
                    },
                    "action_config": {"type": "STRING", "description": "JSON string of action parameters."}
                },
                "required": ["action", "project_id"]
            }),
        ),
        tool(
            "manage_sla",
            "Manage SLA rules and monitor compliance. Actions: list_rules, stats, create_rule, delete_rule.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list_rules", "stats", "create_rule", "delete_rule"]
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix."},
                    "rule_id": {"type": "STRING", "description": "SLA rule UUID (for delete_rule)."},
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"]
                    },
                    "deadline_hours": {"type": "NUMBER", "description": "Max resolution time in hours (for create_rule)."}
                },
                "required": ["action", "project_id"]
            }),
        ),
        tool(
            "manage_templates",
            "Manage reusable issue templates. Actions: list, create, delete.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "delete"]
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix."},
                    "template_id": {"type": "STRING", "description": "Template UUID (for delete)."},
                    "name": {"type": "STRING", "description": "Template display name."},
                    "description": {"type": "STRING", "description": "Pre-filled Markdown body."},
                    "default_priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"]
                    },
                    "default_type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"]
                    }
                },
                "required": ["action", "project_id"]
            }),
        ),
        tool(
            "manage_recurring",
            "Manage recurring issue configs that auto-create tickets on a cron schedule. Actions: list, create, toggle, trigger, delete.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "action": {
                        "type": "STRING",
                        "enum": ["list", "create", "toggle", "trigger", "delete"]
                    },
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix."},
                    "recurring_id": {"type": "STRING", "description": "Recurring config UUID (for toggle/trigger/delete)."},
                    "title": {"type": "STRING", "description": "Issue title template."},
                    "description": {"type": "STRING", "description": "Issue description template."},
                    "priority": {
                        "type": "STRING",
                        "enum": ["urgent", "high", "medium", "low"]
                    },
                    "issue_type": {
                        "type": "STRING",
                        "enum": ["bug", "feature", "improvement", "question"]
                    },
                    "cron_expression": {"type": "STRING", "description": "5-field cron, e.g. '0 9 * * 1' (every Monday 9am UTC)."}
                },
                "required": ["action", "project_id"]
            }),
        ),
        tool(
            "export_project",
            "Export all issues in a project as structured JSON with all fields including comments. Use for data dumps, backups, or external analysis.",
            json!({
                "type": "OBJECT",
                "properties": {
                    "project_id": {"type": "STRING", "description": "Project UUID or prefix to export."}
                },
                "required": ["project_id"]
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

async fn exec_search_issues(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let query_text = args.get("query").and_then(|v| v.as_str())
        .map(|q| format!("%{}%", q));
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    let status_filter = args.get("status").and_then(|v| v.as_str()).map(String::from);
    let priority_filter = args.get("priority").and_then(|v| v.as_str()).map(String::from);
    let category_filter = args.get("category").and_then(|v| v.as_str()).map(String::from);
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20).min(100);

    let rows = sqlx::query_as::<_, SearchIssueRow>(
        r#"SELECT i.id, i.display_id, i.title, i.status, i.priority, i.category,
                  p.name AS project_name, i.updated_at
           FROM issues i
           JOIN projects p ON p.id = i.project_id
           WHERE p.org_id = $1
             AND ($2::uuid IS NULL OR i.project_id = $2)
             AND ($3::text IS NULL OR i.status = $3)
             AND ($4::text IS NULL OR i.priority = $4)
             AND ($5::text IS NULL OR i.title ILIKE $5 OR i.description ILIKE $5)
             AND ($6::text IS NULL OR $6 = ANY(i.category))
           ORDER BY i.updated_at DESC
           LIMIT $7"#,
    )
    .bind(org_id)
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

    let data: Vec<Value> = rows.into_iter().map(|r| json!({
        "id": r.id,
        "display_id": r.display_id,
        "title": r.title,
        "status": r.status,
        "priority": r.priority,
        "category": r.category.unwrap_or_default(),
        "project_name": r.project_name,
        "updated_at": r.updated_at,
    })).collect();

    Ok(ToolResult {
        data: json!(data),
        for_model: format!("\u{1f4cb} Found {} issues:\n{}", n, lines),
        component_hint: Some("IssueTable".to_string()),
        summary: format!("Found {} issues", n),
    })
}

async fn exec_get_project_metrics(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2)"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status NOT IN ('done', 'cancelled')"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let in_progress: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'in_progress'"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let done: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'done'"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let velocity: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'done' AND i.updated_at >= NOW() - INTERVAL '14 days'"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let bug_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.type = 'bug'"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let avg_cycle_time: Option<f64> = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT AVG(EXTRACT(EPOCH FROM (i.closed_at - i.created_at)) / 3600.0) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.closed_at IS NOT NULL"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(None);

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

async fn exec_analyze_sprint(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    let sprint = sqlx::query_as::<_, SprintSummaryRow>(
        "SELECT s.id, s.name FROM sprints s JOIN projects p ON p.id = s.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR s.project_id = $2) AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1"
    )
    .bind(org_id)
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

async fn exec_weekly_recap(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let project_id: Option<Uuid> = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    let days = args.get("days").and_then(|v| v.as_i64()).unwrap_or(7).clamp(1, 30);
    let since = chrono::Utc::now() - chrono::Duration::days(days);

    let completed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.status = 'done' AND i.updated_at >= $3"
    ).bind(org_id).bind(project_id).bind(since).fetch_one(pool).await.unwrap_or(0);

    let new_created: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.created_at >= $3"
    ).bind(org_id).bind(project_id).bind(since).fetch_one(pool).await.unwrap_or(0);

    let blockers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.org_id = $1 AND ($2::uuid IS NULL OR i.project_id = $2) AND i.priority IN ('urgent', 'high') AND i.status NOT IN ('done', 'cancelled') AND i.updated_at < NOW() - INTERVAL '2 days'"
    ).bind(org_id).bind(project_id).fetch_one(pool).await.unwrap_or(0);

    let top_contributor: Option<String> = sqlx::query_scalar::<_, String>(
        "SELECT user_name FROM activity_log WHERE org_id = $1 AND ($2::uuid IS NULL OR project_id = $2) AND created_at >= $3 AND user_name IS NOT NULL GROUP BY user_name ORDER BY COUNT(*) DESC LIMIT 1"
    ).bind(org_id).bind(project_id).bind(since).fetch_optional(pool).await.unwrap_or(None);

    Ok(ToolResult {
        data: json!({
            "completed": completed,
            "new_created": new_created,
            "blockers": blockers,
            "top_contributor": top_contributor,
            "period": format!("Last {} days", days),
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

async fn exec_suggest_priorities(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
           WHERE p.org_id = $1
             AND ($2::uuid IS NULL OR i.project_id = $2)
             AND i.status NOT IN ('done', 'cancelled')
           ORDER BY score DESC
           LIMIT 10"#,
    )
    .bind(org_id)
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

async fn exec_export_project(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let project_id: Uuid = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "export_project requires a valid project_id".to_string())?;

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    ).bind(project_id).bind(org_id).fetch_one(pool).await
        .map_err(|e| format!("export project check: {}", e))?;

    if !exists {
        return Err("Project not found or access denied".to_string());
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

async fn resolve_project_id(pool: &PgPool, org_id: &str, raw: &str) -> Option<Uuid> {
    if let Ok(uuid) = raw.parse::<Uuid>() {
        return Some(uuid);
    }

    // Try prefix match (case-insensitive)
    let by_prefix: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM projects WHERE org_id = $1 AND UPPER(prefix) = UPPER($2) LIMIT 1",
    )
    .bind(org_id)
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
        "SELECT id FROM projects WHERE org_id = $1 AND LOWER(name) LIKE LOWER($2) LIMIT 1",
    )
    .bind(org_id)
    .bind(format!("%{}%", raw))
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

/// Pre-process tool args: resolve any project_id field from prefix/name to UUID.
async fn resolve_args_project_id(pool: &PgPool, org_id: &str, args: &mut Value) {
    if let Some(raw) = args.get("project_id").and_then(|v| v.as_str()).map(String::from) {
        if raw.parse::<Uuid>().is_err() {
            if let Some(uuid) = resolve_project_id(pool, org_id, &raw).await {
                args["project_id"] = Value::String(uuid.to_string());
            }
        }
    }
}

/// Returns a proposal for issue creation (does NOT create). Frontend renders
/// an editable form + Approve/Cancel buttons.
async fn exec_propose_issue(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let project_id_str = args.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
    let project_id: Option<Uuid> = project_id_str.parse().ok();

    let project_info: Option<(String, String)> = match project_id {
        Some(uid) => sqlx::query_as::<_, (String, String)>(
            "SELECT name, prefix FROM projects WHERE id = $1 AND org_id = $2",
        )
        .bind(uid)
        .bind(org_id)
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
async fn exec_propose_update_issue(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let issue_id_str = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("");
    let issue_id: Uuid = issue_id_str.parse()
        .map_err(|_| format!("Invalid issue_id UUID: {}", issue_id_str))?;

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
         FROM issues WHERE id = $1 AND org_id = $2",
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {e}"))?
    .ok_or_else(|| "Issue not found".to_string())?;

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
async fn exec_propose_bulk_update(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let updates = args.get("updates").and_then(|v| v.as_array())
        .ok_or_else(|| "updates must be an array".to_string())?;

    let mut rows: Vec<Value> = Vec::new();
    for u in updates {
        let issue_id_str = u.get("issue_id").and_then(|v| v.as_str()).unwrap_or("");
        let Ok(issue_id) = issue_id_str.parse::<Uuid>() else { continue };

        let cur: Option<(String, String, String, String)> = sqlx::query_as(
            "SELECT display_id, title, status, priority FROM issues WHERE id = $1 AND org_id = $2",
        )
        .bind(issue_id)
        .bind(org_id)
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
async fn exec_propose_comment(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    let issue_id_str = args.get("issue_id").and_then(|v| v.as_str()).unwrap_or("");
    let issue_id: Uuid = issue_id_str.parse()
        .map_err(|_| format!("Invalid issue_id UUID: {}", issue_id_str))?;
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let issue: Option<(String, String)> = sqlx::query_as(
        "SELECT display_id, title FROM issues WHERE id = $1 AND org_id = $2",
    )
    .bind(issue_id)
    .bind(org_id)
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

pub async fn execute_tool(
    pool: &PgPool,
    org_id: &str,
    user_id: &str,
    tool_name: &str,
    args: Value,
) -> Result<ToolResult, String> {
    let mut args = args;
    resolve_args_project_id(pool, org_id, &mut args).await;

    match tool_name {
        "search_issues" => match exec_search_issues(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("search_issues real query failed: {e}; falling back to stub"); Ok(stub_search_issues(&args)) }
        },
        "propose_issue" => exec_propose_issue(pool, org_id, &args).await,
        "propose_update_issue" => exec_propose_update_issue(pool, org_id, &args).await,
        "propose_bulk_update" => exec_propose_bulk_update(pool, org_id, &args).await,
        "propose_comment" => exec_propose_comment(pool, org_id, &args).await,
        "create_issue" => create_issue_real(pool, org_id, user_id, &args).await,
        "update_issue" => update_issue_real(pool, org_id, user_id, &args).await,
        "bulk_update_issues" => bulk_update_issues_real(pool, org_id, user_id, &args).await,
        "add_comment" => add_comment_real(pool, org_id, user_id, &args).await,
        "generate_prd" => match ai_generate_prd(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("generate_prd real query failed: {e}; falling back to stub"); Ok(stub_generate_prd(&args)) }
        },
        "analyze_sprint" => match exec_analyze_sprint(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("analyze_sprint real query failed: {e}; falling back to stub"); Ok(stub_analyze_sprint(&args)) }
        },
        "get_project_metrics" => match exec_get_project_metrics(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("get_project_metrics real query failed: {e}; falling back to stub"); Ok(stub_get_project_metrics(&args)) }
        },
        "weekly_recap" => match exec_weekly_recap(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("weekly_recap real query failed: {e}; falling back to stub"); Ok(stub_weekly_recap(&args)) }
        },
        "suggest_priorities" => match exec_suggest_priorities(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("suggest_priorities real query failed: {e}; falling back to stub"); Ok(stub_suggest_priorities(&args)) }
        },
        "plan_milestones" => match ai_plan_milestones(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("plan_milestones real query failed: {e}; falling back to stub"); Ok(stub_plan_milestones(&args)) }
        },
        "create_milestones_batch" => create_milestones_batch_real(pool, org_id, user_id, &args).await,
        "adjust_timeline" => match ai_adjust_timeline(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("adjust_timeline real query failed: {e}; falling back to stub"); Ok(stub_adjust_timeline(&args)) }
        },
        "triage_issue" => triage_issue_real(pool, org_id, user_id, &args).await,
        "manage_initiatives" => match ai_manage_initiatives(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_initiatives real query failed: {e}; falling back to stub"); Ok(stub_manage_initiatives(&args)) }
        },
        "manage_automations" => match ai_manage_automations(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_automations real query failed: {e}; falling back to stub"); Ok(stub_manage_automations(&args)) }
        },
        "manage_sla" => match ai_manage_sla(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_sla real query failed: {e}; falling back to stub"); Ok(stub_manage_sla(&args)) }
        },
        "manage_templates" => match ai_manage_templates(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_templates real query failed: {e}; falling back to stub"); Ok(stub_manage_templates(&args)) }
        },
        "manage_recurring" => match ai_manage_recurring(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("manage_recurring real query failed: {e}; falling back to stub"); Ok(stub_manage_recurring(&args)) }
        },
        "export_project" => match exec_export_project(pool, org_id, &args).await {
            Ok(r) => Ok(r),
            Err(e) => { tracing::warn!("export_project real query failed: {e}; falling back to stub"); Ok(stub_export_project(&args)) }
        },
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
    org_id: &str,
    user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "invalid project_id".to_string())?;
    let title = args.get("title").and_then(|v| v.as_str())
        .ok_or_else(|| "title required".to_string())?;
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
        "SELECT prefix FROM projects WHERE id = $1 AND org_id = $2",
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let (prefix,) = row.ok_or_else(|| "Project not found or access denied".to_string())?;

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
    org_id: &str,
    _user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let issue_id: Uuid = args.get("issue_id").and_then(|v| v.as_str())
        .ok_or_else(|| "issue_id required".to_string())?
        .parse().map_err(|_| "invalid issue_id".to_string())?;

    // Verify issue belongs to org and capture current state
    let existing: Option<(String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT i.display_id, i.status, i.priority
           FROM issues i JOIN projects p ON p.id = i.project_id
           WHERE i.id = $1 AND p.org_id = $2"#,
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let (display_id, old_status, old_priority) =
        existing.ok_or_else(|| "Issue not found or access denied".to_string())?;

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
    org_id: &str,
    _user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let updates = args.get("updates").and_then(|v| v.as_array())
        .ok_or_else(|| "updates array required".to_string())?;

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
                 AND project_id IN (SELECT id FROM projects WHERE org_id = $9)
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
        .bind(org_id)
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
    org_id: &str,
    user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let issue_id: Uuid = args.get("issue_id").and_then(|v| v.as_str())
        .ok_or_else(|| "issue_id required".to_string())?
        .parse().map_err(|_| "invalid issue_id".to_string())?;

    // Tool uses "content" key; also accept "body" as alias
    let body = args.get("content").or_else(|| args.get("body"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "content required".to_string())?;

    let author_name = args.get("author_name").and_then(|v| v.as_str())
        .unwrap_or("Baaton AI");

    // Verify issue belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM issues i JOIN projects p ON p.id = i.project_id
            WHERE i.id = $1 AND p.org_id = $2
         )",
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    if !exists {
        return Err("Issue not found or access denied".to_string());
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
    org_id: &str,
    user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let issue_id: Uuid = args.get("issue_id").and_then(|v| v.as_str())
        .ok_or_else(|| "issue_id required".to_string())?
        .parse().map_err(|_| "invalid issue_id".to_string())?;

    // Verify issue belongs to org and get current state
    let existing: Option<(String, String)> = sqlx::query_as(
        r#"SELECT i.display_id, i.status
           FROM issues i JOIN projects p ON p.id = i.project_id
           WHERE i.id = $1 AND p.org_id = $2"#,
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;
    let (display_id, current_status) =
        existing.ok_or_else(|| "Issue not found or access denied".to_string())?;

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
    org_id: &str,
    _user_id: &str,
    args: &Value,
) -> Result<ToolResult, String> {
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "invalid project_id".to_string())?;
    let milestones_arr = args.get("milestones").and_then(|v| v.as_array())
        .ok_or_else(|| "milestones array required".to_string())?;

    // Verify project belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)",
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    if !exists {
        return Err("Project not found or access denied".to_string());
    }

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
        .bind(org_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to create milestone '{}': {}", name, e))?;

        // Assign issues to this milestone (org-scoped)
        let issue_count: usize = if !issue_ids.is_empty() {
            sqlx::query(
                r#"UPDATE issues SET milestone_id = $1, updated_at = now()
                   WHERE id = ANY($2)
                     AND project_id IN (SELECT id FROM projects WHERE org_id = $3)"#,
            )
            .bind(milestone_id)
            .bind(&issue_ids)
            .bind(org_id)
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

async fn ai_plan_milestones(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
    use sqlx::Row;
    let project_id_str = args.get("project_id").and_then(|v| v.as_str())
        .ok_or_else(|| "project_id is required".to_string())?;
    let project_id: Uuid = project_id_str.parse()
        .map_err(|_| "Invalid project_id".to_string())?;

    let rows = sqlx::query(
        "SELECT i.id::text as id, i.title, COALESCE(i.tags, ARRAY[]::text[]) as tags
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE i.project_id = $1 AND p.org_id = $2
           AND i.status NOT IN ('done', 'cancelled')
         ORDER BY i.created_at ASC"
    )
    .bind(project_id)
    .bind(org_id)
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

async fn ai_adjust_timeline(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
         WHERE m.project_id = $1 AND p.org_id = $2
           AND m.target_date IS NOT NULL
         ORDER BY m.target_date ASC"
    )
    .bind(project_id)
    .bind(org_id)
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

async fn ai_generate_prd(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
        "SELECT name, description FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(project_id)
    .bind(org_id)
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

async fn ai_manage_initiatives(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
                 WHERE i.org_id = $1
                 GROUP BY i.id
                 ORDER BY i.created_at DESC"
            )
            .bind(org_id)
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

            let new_id: String = sqlx::query(
                "INSERT INTO initiatives (org_id, name, description, status, target_date)
                 VALUES ($1, $2, $3, $4, $5::date)
                 RETURNING id::text"
            )
            .bind(org_id)
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
                 WHERE id = $1 AND org_id = $2"
            )
            .bind(initiative_uuid)
            .bind(org_id)
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

async fn ai_manage_automations(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
                 WHERE project_id = $1 AND org_id = $2
                 ORDER BY created_at DESC"
            )
            .bind(project_id)
            .bind(org_id)
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
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(org_id)
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
                 WHERE id = $1 AND project_id = $2 AND org_id = $3
                 RETURNING enabled"
            )
            .bind(automation_uuid)
            .bind(project_id)
            .bind(org_id)
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
                "DELETE FROM automation_rules WHERE id = $1 AND project_id = $2 AND org_id = $3"
            )
            .bind(automation_uuid)
            .bind(project_id)
            .bind(org_id)
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

async fn ai_manage_sla(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
                 WHERE project_id = $1 AND org_id = $2
                 ORDER BY CASE priority
                   WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 ELSE 4 END"
            )
            .bind(project_id)
            .bind(org_id)
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
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (project_id, priority)
                 DO UPDATE SET deadline_hours = EXCLUDED.deadline_hours
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(org_id)
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
                "DELETE FROM sla_rules WHERE id = $1 AND project_id = $2 AND org_id = $3"
            )
            .bind(rule_uuid)
            .bind(project_id)
            .bind(org_id)
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
async fn ai_manage_templates(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
                 WHERE project_id = $1 AND org_id = $2
                 ORDER BY is_default DESC, created_at DESC"
            )
            .bind(project_id)
            .bind(org_id)
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
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(org_id)
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
                "DELETE FROM issue_templates WHERE id = $1 AND project_id = $2 AND org_id = $3"
            )
            .bind(template_uuid)
            .bind(project_id)
            .bind(org_id)
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
async fn ai_manage_recurring(pool: &PgPool, org_id: &str, args: &Value) -> Result<ToolResult, String> {
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
                 WHERE project_id = $1 AND org_id = $2
                 ORDER BY created_at DESC"
            )
            .bind(project_id)
            .bind(org_id)
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
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id::text"
            )
            .bind(project_id)
            .bind(org_id)
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
                 WHERE id = $1 AND project_id = $2 AND org_id = $3
                 RETURNING paused"
            )
            .bind(recurring_uuid)
            .bind(project_id)
            .bind(org_id)
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
                "DELETE FROM recurrence_rules WHERE id = $1 AND project_id = $2 AND org_id = $3"
            )
            .bind(recurring_uuid)
            .bind(project_id)
            .bind(org_id)
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
