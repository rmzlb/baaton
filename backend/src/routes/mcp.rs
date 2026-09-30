//! MCP Streamable HTTP transport for Baaton.
//!
//! Exposes Baaton project management tools via the Model Context Protocol
//! (Streamable HTTP, 2025-03-26) at `POST /mcp`.
//!
//! Auth: Clerk JWT (OAuth 2.1 via ChatGPT/Codex) OR Baaton API key (`baa_...`).
//! Anonymous access: `initialize` and `tools/list` only.
//! All `tools/call` require authentication.
//!
//! The `credentials.rs` module is not used here; auth is done inline so the
//! MCP endpoint can return proper `WWW-Authenticate` challenges.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::middleware::{fetch_jwks_keys, AuthUser, JwksKeys};

// ── Embedded skill ───────────────────────────────────────────────────────────

const SKILL_MD: &str =
    include_str!("../mcp_skill.md");

fn skill_md_digest() -> String {
    let hash = Sha256::digest(SKILL_MD.as_bytes());
    format!("sha256:{:x}", hash)
}

// ── MCP resource URL ─────────────────────────────────────────────────────────

fn mcp_resource() -> String {
    std::env::var("MCP_PUBLIC_URL")
        .unwrap_or_else(|_| "https://api.baaton.dev/mcp".to_string())
}

// ── JSON-RPC types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct McpRequest {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct McpResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

#[derive(Debug, Serialize)]
pub struct McpError {
    pub code: i32,
    pub message: String,
}

impl McpResponse {
    fn ok(id: Option<Value>, result: Value) -> Self {
        McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn err(id: Option<Value>, code: i32, message: impl Into<String>) -> Self {
        McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(McpError {
                code,
                message: message.into(),
            }),
        }
    }
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

/// Auth result for MCP — either authenticated, or the 401 challenge string.
enum McpAuth {
    Authenticated(AuthUser),
    Unauthenticated,
    Invalid(String),
}

async fn extract_mcp_auth(
    headers: &HeaderMap,
    pool: &PgPool,
    jwks: &JwksKeys,
) -> McpAuth {
    let Some(auth_value) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
    else {
        return McpAuth::Unauthenticated;
    };

    let Some(token) = auth_value.strip_prefix("Bearer ") else {
        return McpAuth::Invalid("Invalid Authorization header format".into());
    };

    // API key path
    if token.starts_with("baa_") {
        return validate_api_key(token, pool).await;
    }

    // Clerk JWT path
    validate_clerk_jwt(token, jwks).await
}

async fn validate_api_key(token: &str, pool: &PgPool) -> McpAuth {
    use sha2::Digest;
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));

    #[derive(sqlx::FromRow)]
    struct KeyRow {
        id: Uuid,
        created_by: Option<String>,
        name: String,
        permissions: Vec<String>,
        legacy_full_access: bool,
        scoped_org_ids: Vec<String>,
        project_ids: Vec<Uuid>,
    }

    let row = match sqlx::query_as::<_, KeyRow>(
        "SELECT k.id, k.created_by, k.name, k.permissions,
                COALESCE(k.legacy_full_access, false) AS legacy_full_access,
                COALESCE(k.project_ids, '{}') AS project_ids,
                COALESCE((SELECT array_agg(s.org_id ORDER BY s.org_id)
                           FROM api_key_org_scopes s WHERE s.api_key_id = k.id),
                          ARRAY[k.org_id]) AS scoped_org_ids
         FROM api_keys k
         WHERE k.key_hash = $1 AND (k.expires_at IS NULL OR k.expires_at > now())",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return McpAuth::Invalid("Invalid API key".into()),
        Err(e) => {
            tracing::error!(error=%e, "MCP API key lookup failed");
            return McpAuth::Invalid("Auth error".into());
        }
    };

    // Refresh org IDs via Clerk
    let mut effective_orgs = row.scoped_org_ids.clone();
    if let Some(ref owner) = row.created_by {
        if let Ok(owner_orgs) = crate::routes::issues::fetch_user_org_ids(owner).await {
            effective_orgs.retain(|id| owner_orgs.contains(id));
        }
    }
    if effective_orgs.is_empty() {
        return McpAuth::Invalid("API key no longer has access to any organization".into());
    }

    McpAuth::Authenticated(AuthUser {
        user_id: format!("apikey:{}", row.id),
        org_id: Some(effective_orgs[0].clone()),
        org_slug: None,
        org_role: None,
        email: None,
        display_name: Some(row.name.clone()),
        scoped_org_ids: effective_orgs,
        scoped_project_ids: row.project_ids,
        actor_kind: crate::middleware::ActorKind::ApiKey,
        actor_key_id: Some(row.id),
        on_behalf_of: row.created_by.clone(),
        permissions: row.permissions.clone(),
        legacy_full_access: row.legacy_full_access,
    })
}

async fn validate_clerk_jwt(token: &str, jwks: &JwksKeys) -> McpAuth {
    use crate::middleware::ClerkClaims;
    use jsonwebtoken::{decode, decode_header, Algorithm, Validation};

    let issuer =
        std::env::var("CLERK_ISSUER").unwrap_or_else(|_| "https://clerk.baaton.dev".to_string());

    let header = match decode_header(token) {
        Ok(h) => h,
        Err(e) => return McpAuth::Invalid(format!("JWT header error: {}", e)),
    };
    let kid = match header.kid {
        Some(k) => k,
        None => return McpAuth::Invalid("JWT missing kid".into()),
    };

    let keys = jwks.read().await;
    let decoding_key = match keys.get(&kid) {
        Some(k) => k.clone(),
        None => {
            drop(keys);
            // Try refreshing JWKS
            match fetch_jwks_keys(&issuer).await {
                Ok(new_keys) => {
                    if let Some(k) = new_keys.get(&kid) {
                        k.clone()
                    } else {
                        return McpAuth::Invalid(format!("Unknown JWT kid: {}", kid));
                    }
                }
                Err(e) => return McpAuth::Invalid(format!("JWKS refresh failed: {}", e)),
            }
        }
    };

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[&issuer]);
    validation.validate_aud = false; // Clerk doesn't echo resource in aud

    let claims = match decode::<ClerkClaims>(token, &decoding_key, &validation) {
        Ok(d) => d.claims,
        Err(e) => return McpAuth::Invalid(format!("JWT invalid: {}", e)),
    };

    if claims.sts.as_deref() == Some("pending") {
        return McpAuth::Invalid("Session pending — user must join an org".into());
    }

    let (org_id, org_slug, org_role) = if let Some(ref o) = claims.o {
        (
            Some(o.id.clone()),
            o.slg.clone(),
            o.rol.as_ref().map(|r| format!("org:{}", r)),
        )
    } else {
        (claims.org_id.clone(), claims.org_slug.clone(), claims.org_role.clone())
    };

    let display_name = {
        let first = claims.first_name.as_deref().unwrap_or("").trim();
        let last = claims.last_name.as_deref().unwrap_or("").trim();
        let full = format!("{} {}", first, last).trim().to_string();
        if full.is_empty() { claims.username.clone() } else { Some(full) }
    };

    McpAuth::Authenticated(AuthUser {
        user_id: claims.sub,
        scoped_org_ids: org_id.iter().cloned().collect(),
        org_id,
        org_slug,
        org_role,
        email: claims.email,
        display_name,
        scoped_project_ids: vec![],
        actor_kind: crate::middleware::ActorKind::Human,
        actor_key_id: None,
        on_behalf_of: None,
        permissions: vec![crate::permissions::ADMIN_FULL.to_string()],
        legacy_full_access: false,
    })
}

// ── WWW-Authenticate challenge ────────────────────────────────────────────────

fn www_authenticate_header() -> String {
    // resource_metadata points to the well-known endpoint at the server root.
    // The resource identifier is https://api.baaton.dev/mcp (the MCP endpoint).
    "Bearer resource_metadata=\"https://api.baaton.dev/.well-known/oauth-protected-resource\"".to_string()
}

fn auth_required_tool_result() -> Value {
    json!({
        "content": [{"type": "text", "text": "Authentication required. Please connect your Baaton account."}],
        "_meta": {
            "mcp/www_authenticate": [
                "Bearer resource_metadata=\"https://api.baaton.dev/.well-known/oauth-protected-resource\", error=\"invalid_token\", error_description=\"Authentication required\""
            ]
        },
        "isError": true
    })
}

// ── Main handler ──────────────────────────────────────────────────────────────

pub async fn handle_mcp(
    State(pool): State<PgPool>,
    Extension(jwks): Extension<JwksKeys>,
    headers: HeaderMap,
    body: Json<McpRequest>,
) -> Response {
    let auth = extract_mcp_auth(&headers, &pool, &jwks).await;
    let req = body.0;

    // For methods that need auth, check here and return WWW-Authenticate
    let method = req.method.as_str();
    let is_public_method = matches!(method, "initialize" | "ping" | "notifications/initialized");

    if !is_public_method && method != "tools/list" && method != "skills/list" && method != "skills/get" && method != "resources/read" {
        // Private methods require auth
        if let McpAuth::Invalid(msg) = &auth {
            let resp = McpResponse::err(req.id.clone(), -32001, msg.clone());
            return (
                StatusCode::UNAUTHORIZED,
                [
                    ("content-type", "application/json"),
                    ("www-authenticate", Box::leak(www_authenticate_header().into_boxed_str())),
                ],
                Json(resp),
            )
                .into_response();
        }
    }

    let result = dispatch_method(req, auth, &pool).await;

    match result {
        Ok(resp) => (StatusCode::OK, [("content-type", "application/json")], Json(resp)).into_response(),
        Err(e) => {
            tracing::error!(error=%e, "MCP dispatch error");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"Internal error"}}))).into_response()
        }
    }
}

// ── Method dispatch ───────────────────────────────────────────────────────────

async fn dispatch_method(
    req: McpRequest,
    auth: McpAuth,
    pool: &PgPool,
) -> Result<McpResponse, String> {
    let id = req.id.clone();
    let params = req.params.clone().unwrap_or(json!({}));

    match req.method.as_str() {
        "initialize" => Ok(McpResponse::ok(id, handle_initialize(params))),
        "ping" => Ok(McpResponse::ok(id, json!({}))),
        "notifications/initialized" => Ok(McpResponse::ok(id, json!({}))),
        "tools/list" => Ok(McpResponse::ok(id, json!({"tools": tools_list()}))),
        "tools/call" => {
            let auth_user = match auth {
                McpAuth::Authenticated(u) => u,
                McpAuth::Unauthenticated | McpAuth::Invalid(_) => {
                    return Ok(McpResponse::ok(id, auth_required_tool_result()));
                }
            };
            Ok(McpResponse::ok(id, handle_tools_call(params, &auth_user, pool).await))
        }
        "skills/list" => Ok(McpResponse::ok(id, handle_skills_list())),
        "skills/get" => Ok(McpResponse::ok(id, handle_skills_get(params))),
        "resources/read" => Ok(McpResponse::ok(id, handle_resources_read(params))),
        other => Ok(McpResponse::err(id, -32601, format!("Method not found: {}", other))),
    }
}

// ── initialize ────────────────────────────────────────────────────────────────

fn handle_initialize(_params: Value) -> Value {
    json!({
        "protocolVersion": "2025-03-26",
        "serverInfo": {
            "name": "baaton",
            "version": "0.2.0"
        },
        "capabilities": {
            "tools": {},
            "resources": {},
            "extensions": {
                "io.modelcontextprotocol/skills": {}
            }
        },
        "instructions": "Use list_projects first to find the org's projects, then list_issues or search to find relevant tickets. Call get_profile to identify the current user. Always use create_issue for new work, update_issue to change status/priority, and post_tldr after completing work."
    })
}

// ── Tool definitions ──────────────────────────────────────────────────────────

fn tools_list() -> Vec<Value> {
    vec![
        json!({
            "name": "get_profile",
            "title": "Get current user profile",
            "description": "Return the authenticated user's profile (id, name, email). Call this once to identify who is connected.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "outputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "email": {"type": "string"},
                    "nickname": {"type": "string"}
                },
                "required": ["id"]
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": []}],
            "_meta": {"openai/profile": true}
        }),
        json!({
            "name": "list_projects",
            "title": "List projects",
            "description": "List all Baaton projects accessible to the authenticated user. Returns project id, name, slug, and status list.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 50, "description": "Max projects to return"}
                },
                "additionalProperties": false
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "projects": {"type": "array", "items": {"type": "object"}}
                }
            },
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "list_issues",
            "title": "List issues",
            "description": "List issues in a project or across all projects, with optional status/priority/assignee filters.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "string", "description": "Filter by project UUID"},
                    "status": {"type": "string", "description": "Filter by status key (e.g. 'todo', 'in_progress', 'done')"},
                    "priority": {"type": "string", "enum": ["urgent", "high", "medium", "low"]},
                    "assignee_id": {"type": "string", "description": "Filter by assignee Clerk user ID"},
                    "limit": {"type": "integer", "default": 25, "maximum": 100},
                    "archived": {"type": "boolean", "default": false}
                },
                "additionalProperties": false
            },
            "outputSchema": {"type": "object", "properties": {"issues": {"type": "array"}}},
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "search_issues",
            "title": "Search issues",
            "description": "Full-text search across issue titles, descriptions, and comments. Use when looking for a specific topic or keyword.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "q": {"type": "string", "description": "Search query"},
                    "project_id": {"type": "string", "description": "Restrict to a project UUID"},
                    "limit": {"type": "integer", "default": 10, "maximum": 50}
                },
                "required": ["q"],
                "additionalProperties": false
            },
            "outputSchema": {"type": "object", "properties": {"issues": {"type": "array"}}},
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "get_issue",
            "title": "Get issue",
            "description": "Get a single issue by UUID or display_id (e.g. 'BAA-42'). Returns full detail including description and comments.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue UUID or display_id (e.g. BAA-42)"}
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "outputSchema": {"type": "object"},
            "annotations": {"readOnlyHint": true, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "create_issue",
            "title": "Create issue",
            "description": "Create a new issue in a Baaton project. Use list_projects first to get the project_id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "string", "description": "Project UUID"},
                    "title": {"type": "string", "description": "Issue title"},
                    "description": {"type": "string", "description": "Issue description (Markdown)"},
                    "priority": {"type": "string", "enum": ["urgent", "high", "medium", "low"]},
                    "status": {"type": "string", "description": "Initial status key (defaults to first project status)"},
                    "issue_type": {"type": "string", "enum": ["bug", "feature", "improvement", "question"]},
                    "assignee_ids": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["project_id", "title"],
                "additionalProperties": false
            },
            "outputSchema": {"type": "object"},
            "annotations": {"readOnlyHint": false, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "update_issue",
            "title": "Update issue",
            "description": "Update an issue's status, priority, title, description, or assignees. Use get_issue first to confirm the current state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue UUID"},
                    "status": {"type": "string", "description": "New status key"},
                    "priority": {"type": "string", "enum": ["urgent", "high", "medium", "low"]},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "assignee_ids": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["id"],
                "additionalProperties": false
            },
            "outputSchema": {"type": "object"},
            "annotations": {"readOnlyHint": false, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "add_comment",
            "title": "Add comment",
            "description": "Add a comment to an issue. Use for status updates, blockers, or questions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "issue_id": {"type": "string", "description": "Issue UUID"},
                    "body": {"type": "string", "description": "Comment text (Markdown)"}
                },
                "required": ["issue_id", "body"],
                "additionalProperties": false
            },
            "outputSchema": {"type": "object"},
            "annotations": {"readOnlyHint": false, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
        json!({
            "name": "post_tldr",
            "title": "Post TLDR",
            "description": "Post a work summary (TLDR) on an issue after completing work: what was done, files changed, test status.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "issue_id": {"type": "string", "description": "Issue UUID"},
                    "summary": {"type": "string", "description": "What was done"},
                    "files_changed": {"type": "array", "items": {"type": "string"}, "description": "List of changed file paths"},
                    "tests_status": {"type": "string", "enum": ["passed", "failed", "skipped", "none"], "default": "none"}
                },
                "required": ["issue_id", "summary"],
                "additionalProperties": false
            },
            "outputSchema": {"type": "object"},
            "annotations": {"readOnlyHint": false, "destructiveHint": false, "openWorldHint": false},
            "securitySchemes": [{"type": "oauth2", "scopes": ["user:org:read"]}]
        }),
    ]
}

// ── Tool call dispatcher ──────────────────────────────────────────────────────

async fn handle_tools_call(params: Value, auth: &AuthUser, pool: &PgPool) -> Value {
    let name = match params.get("name").and_then(|v| v.as_str()) {
        Some(n) => n.to_string(),
        None => return tool_error("Missing tool name"),
    };
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    let result = match name.as_str() {
        "get_profile" => tool_get_profile(auth).await,
        "list_projects" => tool_list_projects(auth, pool, &args).await,
        "list_issues" => tool_list_issues(auth, pool, &args).await,
        "search_issues" => tool_search_issues(auth, pool, &args).await,
        "get_issue" => tool_get_issue(auth, pool, &args).await,
        "create_issue" => tool_create_issue(auth, pool, &args).await,
        "update_issue" => tool_update_issue(auth, pool, &args).await,
        "add_comment" => tool_add_comment(auth, pool, &args).await,
        "post_tldr" => tool_post_tldr(auth, pool, &args).await,
        unknown => return tool_error(format!("Unknown tool: {}", unknown)),
    };

    match result {
        Ok(data) => {
            let text = serde_json::to_string_pretty(&data).unwrap_or_default();
            json!({
                "content": [{"type": "text", "text": text}],
                "structuredContent": data,
                "isError": false
            })
        }
        Err(e) => tool_error(e),
    }
}

fn tool_error(msg: impl Into<String>) -> Value {
    let m = msg.into();
    json!({
        "content": [{"type": "text", "text": m}],
        "isError": true
    })
}

// ── get_profile ───────────────────────────────────────────────────────────────

async fn tool_get_profile(auth: &AuthUser) -> Result<Value, String> {
    let id = auth.responsible_user_id().to_string();
    let mut profile = json!({"id": id});
    if let Some(name) = &auth.display_name {
        profile["name"] = json!(name);
    }
    if let Some(email) = &auth.email {
        profile["email"] = json!(email);
    }
    if auth.is_api_key() {
        profile["nickname"] = json!(format!("API key ({})", auth.display_name.as_deref().unwrap_or("unnamed")));
    }
    Ok(profile)
}

// ── list_projects ─────────────────────────────────────────────────────────────

async fn tool_list_projects(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50).min(100);
    let org_ids = &auth.scoped_org_ids;
    if org_ids.is_empty() {
        return Ok(json!({"projects": []}));
    }

    #[derive(sqlx::FromRow, Serialize)]
    struct ProjectRow {
        id: Uuid,
        org_id: String,
        name: String,
        slug: String,
        description: Option<String>,
        prefix: String,
        statuses: serde_json::Value,
        created_at: chrono::DateTime<chrono::Utc>,
    }

    let projects = sqlx::query_as::<_, ProjectRow>(
        "SELECT id, org_id, name, slug, description, prefix, statuses, created_at
         FROM projects
         WHERE org_id = ANY($1)
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(org_ids)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(json!({
        "projects": projects.iter().map(|p| json!({
            "id": p.id,
            "name": p.name,
            "slug": p.slug,
            "org_id": p.org_id,
            "description": p.description,
            "prefix": p.prefix,
            "statuses": p.statuses
        })).collect::<Vec<_>>()
    }))
}

// ── list_issues ───────────────────────────────────────────────────────────────

async fn tool_list_issues(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(25).min(100) as i32;
    let archived = args.get("archived").and_then(|v| v.as_bool()).unwrap_or(false);
    let project_id = args.get("project_id").and_then(|v| v.as_str()).and_then(|s| s.parse::<Uuid>().ok());
    let status = args.get("status").and_then(|v| v.as_str()).map(|s| s.to_string());
    let priority = args.get("priority").and_then(|v| v.as_str()).map(|s| s.to_string());
    let assignee_id = args.get("assignee_id").and_then(|v| v.as_str()).map(|s| s.to_string());

    let org_ids = &auth.scoped_org_ids;
    if org_ids.is_empty() {
        return Ok(json!({"issues": []}));
    }

    // Check project access
    if let Some(pid) = project_id {
        if !auth.has_project_access(pid) {
            return Err("Access denied to this project".into());
        }
    }

    #[derive(sqlx::FromRow, Serialize)]
    struct IssueRow {
        id: Uuid,
        project_id: Uuid,
        display_id: String,
        title: String,
        status: String,
        priority: Option<String>,
        assignee_ids: Vec<String>,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    }

    let issues = sqlx::query_as::<_, IssueRow>(
        "SELECT i.id, i.project_id, i.display_id, i.title, i.status, i.priority,
                i.assignee_ids, i.created_at, i.updated_at
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE p.org_id = ANY($1)
           AND ($2::uuid IS NULL OR i.project_id = $2)
           AND ($3::text IS NULL OR i.status = $3)
           AND ($4::text IS NULL OR i.priority = $4)
           AND ($5::text IS NULL OR $5 = ANY(i.assignee_ids))
           AND i.archived = $6
         ORDER BY i.updated_at DESC
         LIMIT $7",
    )
    .bind(org_ids)
    .bind(project_id)
    .bind(&status)
    .bind(&priority)
    .bind(&assignee_id)
    .bind(archived)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(json!({"issues": issues}))
}

// ── search_issues ─────────────────────────────────────────────────────────────

async fn tool_search_issues(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let q = args.get("q").and_then(|v| v.as_str()).ok_or("Missing 'q'")?;
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10).min(50) as i32;
    let project_id = args.get("project_id").and_then(|v| v.as_str()).and_then(|s| s.parse::<Uuid>().ok());

    let org_ids = &auth.scoped_org_ids;
    if org_ids.is_empty() {
        return Ok(json!({"issues": []}));
    }

    if let Some(pid) = project_id {
        if !auth.has_project_access(pid) {
            return Err("Access denied to this project".into());
        }
    }

    let tsquery = q.split_whitespace()
        .map(|w| format!("{}:*", w))
        .collect::<Vec<_>>()
        .join(" & ");

    #[derive(sqlx::FromRow, Serialize)]
    struct SearchRow {
        id: Uuid,
        project_id: Uuid,
        display_id: String,
        title: String,
        status: String,
        priority: Option<String>,
    }

    let results = sqlx::query_as::<_, SearchRow>(
        "SELECT i.id, i.project_id, i.display_id, i.title, i.status, i.priority
         FROM issues i
         JOIN projects p ON p.id = i.project_id
         WHERE p.org_id = ANY($1)
           AND ($2::uuid IS NULL OR i.project_id = $2)
           AND i.archived = false
           AND (
               i.search_vector @@ to_tsquery('english', $3)
               OR i.title ILIKE $4
           )
         ORDER BY ts_rank(i.search_vector, to_tsquery('english', $3)) DESC
         LIMIT $5",
    )
    .bind(org_ids)
    .bind(project_id)
    .bind(&tsquery)
    .bind(format!("%{}%", q))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(json!({"issues": results}))
}

// ── get_issue ─────────────────────────────────────────────────────────────────

async fn tool_get_issue(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let id_str = args.get("id").and_then(|v| v.as_str()).ok_or("Missing 'id'")?;
    let org_ids = &auth.scoped_org_ids;

    #[derive(sqlx::FromRow)]
    struct IssueRow {
        id: Uuid,
        project_id: Uuid,
        org_id: String,
        display_id: String,
        title: String,
        description: Option<String>,
        status: String,
        priority: Option<String>,
        assignee_ids: Vec<String>,
        created_by_name: Option<String>,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    }

    let issue = if let Ok(uuid) = id_str.parse::<Uuid>() {
        sqlx::query_as::<_, IssueRow>(
            "SELECT i.id, i.project_id, p.org_id, i.display_id, i.title,
                    i.description, i.status, i.priority, i.assignee_ids,
                    i.created_by_name, i.created_at, i.updated_at
             FROM issues i JOIN projects p ON p.id = i.project_id
             WHERE i.id = $1 AND p.org_id = ANY($2)",
        )
        .bind(uuid)
        .bind(org_ids)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?
    } else {
        sqlx::query_as::<_, IssueRow>(
            "SELECT i.id, i.project_id, p.org_id, i.display_id, i.title,
                    i.description, i.status, i.priority, i.assignee_ids,
                    i.created_by_name, i.created_at, i.updated_at
             FROM issues i JOIN projects p ON p.id = i.project_id
             WHERE i.display_id = $1 AND p.org_id = ANY($2)",
        )
        .bind(id_str)
        .bind(org_ids)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?
    };

    let issue = issue.ok_or_else(|| format!("Issue '{}' not found", id_str))?;
    if !auth.has_project_access(issue.project_id) {
        return Err("Access denied".into());
    }

    // Fetch recent comments
    #[derive(sqlx::FromRow, Serialize)]
    struct CommentRow {
        id: Uuid,
        body: String,
        created_by_name: Option<String>,
        created_at: chrono::DateTime<chrono::Utc>,
    }
    let comments = sqlx::query_as::<_, CommentRow>(
        "SELECT id, body, created_by_name, created_at FROM comments WHERE issue_id = $1 ORDER BY created_at ASC LIMIT 20",
    )
    .bind(issue.id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Ok(json!({
        "id": issue.id,
        "project_id": issue.project_id,
        "display_id": issue.display_id,
        "title": issue.title,
        "description": issue.description,
        "status": issue.status,
        "priority": issue.priority,
        "assignee_ids": issue.assignee_ids,
        "created_by_name": issue.created_by_name,
        "created_at": issue.created_at,
        "updated_at": issue.updated_at,
        "recent_comments": comments
    }))
}

// ── create_issue ──────────────────────────────────────────────────────────────

async fn tool_create_issue(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let project_id = args.get("project_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Uuid>().ok())
        .ok_or("Missing or invalid 'project_id'")?;
    let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing 'title'")?;

    // Verify org access
    let org_ids = &auth.scoped_org_ids;
    let project_org: Option<String> = sqlx::query_scalar(
        "SELECT org_id FROM projects WHERE id = $1 AND org_id = ANY($2)",
    )
    .bind(project_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let org_id = project_org.ok_or("Project not found or access denied")?;
    if !auth.has_project_access(project_id) {
        return Err("Access denied to this project".into());
    }

    let description = args.get("description").and_then(|v| v.as_str());
    let priority = args.get("priority").and_then(|v| v.as_str()).unwrap_or("medium");
    let issue_type = args.get("issue_type").and_then(|v| v.as_str()).unwrap_or("feature");
    let assignee_ids: Vec<String> = args.get("assignee_ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    // Get project prefix and next display_id
    #[derive(sqlx::FromRow)]
    struct ProjectInfo { prefix: String, statuses: serde_json::Value }
    let proj = sqlx::query_as::<_, ProjectInfo>("SELECT prefix, statuses FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    // Determine initial status
    let initial_status = args.get("status").and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            proj.statuses.as_array()
                .and_then(|a| a.first())
                .and_then(|s| s.get("key").and_then(|k| k.as_str()).map(String::from))
        })
        .unwrap_or_else(|| "todo".to_string());

    // Get next sequence number
    // Get next display_id number — same query as routes/issues.rs
    let next_number: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX((SPLIT_PART(display_id, '-', 2))::bigint), 0) + 1
         FROM issues
         WHERE project_id = $1
           AND display_id ~ ('^' || $2 || '-[0-9]+$')",
    )
    .bind(project_id)
    .bind(&proj.prefix)
    .fetch_one(pool)
    .await
    .unwrap_or((1i64,));

    let display_id = format!("{}-{}", proj.prefix, next_number.0);
    let creator_id = auth.responsible_user_id().to_string();
    let creator_name = auth.display_name.clone();
    let default_pos: f64 = next_number.0 as f64 * 1000.0;

    #[derive(sqlx::FromRow)]
    struct NewIssue { id: Uuid, display_id: String }

    let issue = sqlx::query_as::<_, NewIssue>(
        "INSERT INTO issues (
            project_id, display_id, title, description, type, status, priority,
            assignee_ids, tags, category, attachments, position, source,
            created_by_id, created_by_name
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}', '{}', '[]', $9, $10, $11, $12)
         RETURNING id, display_id",
    )
    .bind(project_id)
    .bind(&display_id)
    .bind(title)
    .bind(description)
    .bind(issue_type)
    .bind(&initial_status)
    .bind(priority)
    .bind(&assignee_ids)
    .bind(default_pos)
    .bind("api")
    .bind(&creator_id)
    .bind(&creator_name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("DB error creating issue: {}", e))?;

    Ok(json!({
        "id": issue.id,
        "display_id": issue.display_id,
        "title": title,
        "status": initial_status,
        "priority": priority,
        "project_id": project_id
    }))
}

// ── update_issue ──────────────────────────────────────────────────────────────

async fn tool_update_issue(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let id = args.get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Uuid>().ok())
        .ok_or("Missing or invalid 'id' (must be UUID)")?;

    let org_ids = &auth.scoped_org_ids;

    // Check access
    #[derive(sqlx::FromRow)]
    struct IssueCheck { project_id: Uuid, display_id: String }
    let check = sqlx::query_as::<_, IssueCheck>(
        "SELECT i.project_id, i.display_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2)",
    )
    .bind(id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?
    .ok_or("Issue not found or access denied")?;

    if !auth.has_project_access(check.project_id) {
        return Err("Access denied".into());
    }

    // Build dynamic update
    let mut sets: Vec<String> = Vec::new();
    let mut fields: HashMap<&str, Value> = HashMap::new();

    if let Some(v) = args.get("status").and_then(|v| v.as_str()) {
        sets.push("status".to_string());
        fields.insert("status", json!(v));
    }
    if let Some(v) = args.get("priority").and_then(|v| v.as_str()) {
        sets.push("priority".to_string());
        fields.insert("priority", json!(v));
    }
    if let Some(v) = args.get("title").and_then(|v| v.as_str()) {
        sets.push("title".to_string());
        fields.insert("title", json!(v));
    }
    if let Some(v) = args.get("description").and_then(|v| v.as_str()) {
        sets.push("description".to_string());
        fields.insert("description", json!(v));
    }

    if sets.is_empty() {
        return Err("No fields to update".into());
    }

    // Apply updates one field at a time for simplicity
    for field in &sets {
        let val = &fields[field.as_str()];
        match field.as_str() {
            "status" => {
                sqlx::query("UPDATE issues SET status = $1, updated_at = now(), status_changed_at = now() WHERE id = $2")
                    .bind(val.as_str().unwrap_or_default())
                    .bind(id)
                    .execute(pool).await.map_err(|e| format!("DB error: {}", e))?;
            }
            "priority" => {
                sqlx::query("UPDATE issues SET priority = $1, updated_at = now() WHERE id = $2")
                    .bind(val.as_str().unwrap_or_default())
                    .bind(id)
                    .execute(pool).await.map_err(|e| format!("DB error: {}", e))?;
            }
            "title" => {
                sqlx::query("UPDATE issues SET title = $1, updated_at = now() WHERE id = $2")
                    .bind(val.as_str().unwrap_or_default())
                    .bind(id)
                    .execute(pool).await.map_err(|e| format!("DB error: {}", e))?;
            }
            "description" => {
                sqlx::query("UPDATE issues SET description = $1, updated_at = now() WHERE id = $2")
                    .bind(val.as_str().unwrap_or_default())
                    .bind(id)
                    .execute(pool).await.map_err(|e| format!("DB error: {}", e))?;
            }
            _ => {}
        }
    }

    Ok(json!({
        "id": id,
        "display_id": check.display_id,
        "updated": sets,
        "ok": true
    }))
}

// ── add_comment ───────────────────────────────────────────────────────────────

async fn tool_add_comment(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let issue_id = args.get("issue_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Uuid>().ok())
        .ok_or("Missing or invalid 'issue_id'")?;
    let body = args.get("body").and_then(|v| v.as_str()).ok_or("Missing 'body'")?;

    let org_ids = &auth.scoped_org_ids;
    let project_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT i.project_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2)",
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let project_id = project_id.ok_or("Issue not found or access denied")?;
    if !auth.has_project_access(project_id) {
        return Err("Access denied".into());
    }

    let comment_id = Uuid::new_v4();
    let creator_name = auth.display_name.clone()
        .unwrap_or_else(|| auth.responsible_user_id().chars().take(20).collect::<String>());
    let creator_id = auth.responsible_user_id().to_string();
    let actor_key_id: Option<Uuid> = auth.actor_key_id;
    let on_behalf_of: Option<String> = auth.on_behalf_of.clone();

    #[derive(sqlx::FromRow)]
    struct NewComment { id: Uuid }

    let c = sqlx::query_as::<_, NewComment>(
        "INSERT INTO comments (
            issue_id, author_id, author_name, body, actor_type, actor_key_id, on_behalf_of,
            on_behalf_of_name, on_behalf_of_email
         )
         VALUES ($1, $2, $3, $4, $5, $6,
                 COALESCE($7, (SELECT created_by FROM api_keys WHERE id = $6)),
                 $8, $9)
         RETURNING id",
    )
    .bind(issue_id)
    .bind(&creator_id)
    .bind(&creator_name)
    .bind(body)
    .bind(auth.actor_kind.as_str())
    .bind(actor_key_id)
    .bind(&on_behalf_of)
    .bind(None::<String>)
    .bind(None::<String>)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(json!({"id": c.id, "issue_id": issue_id, "ok": true}))
}

// ── post_tldr ─────────────────────────────────────────────────────────────────

async fn tool_post_tldr(auth: &AuthUser, pool: &PgPool, args: &Value) -> Result<Value, String> {
    let issue_id = args.get("issue_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Uuid>().ok())
        .ok_or("Missing or invalid 'issue_id'")?;
    let summary = args.get("summary").and_then(|v| v.as_str()).ok_or("Missing 'summary'")?;
    let tests_status = args.get("tests_status").and_then(|v| v.as_str()).unwrap_or("none");
    let files_changed: Vec<String> = args.get("files_changed")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let org_ids = &auth.scoped_org_ids;
    let project_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT i.project_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.org_id = ANY($2)",
    )
    .bind(issue_id)
    .bind(org_ids)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    let project_id = project_id.ok_or("Issue not found or access denied")?;
    if !auth.has_project_access(project_id) {
        return Err("Access denied".into());
    }

    let agent_name = auth.display_name.clone().unwrap_or_else(|| "MCP Agent".to_string());

    #[derive(sqlx::FromRow)]
    struct NewTldr { id: Uuid }

    let tldr = sqlx::query_as::<_, NewTldr>(
        "INSERT INTO tldrs (issue_id, agent_name, summary, files_changed, tests_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
    )
    .bind(issue_id)
    .bind(&agent_name)
    .bind(summary)
    .bind(&files_changed)
    .bind(tests_status)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("DB error: {}", e))?;

    Ok(json!({"id": tldr.id, "issue_id": issue_id, "ok": true}))
}

// ── Skills (MCP skills extension) ────────────────────────────────────────────

fn handle_skills_list() -> Value {
    let digest = skill_md_digest();
    json!({
        "skills": [{
            "uri": "skill://baaton/baaton-pm/SKILL.md",
            "frontmatter": {
                "name": "baaton-pm",
                "description": "Manage project issues on Baaton (baaton.dev), an API-first project management board for AI agents."
            },
            "resources": [{
                "uri": "skill://baaton/baaton-pm/SKILL.md",
                "digest": digest
            }]
        }],
        "nextCursor": null
    })
}

fn handle_skills_get(params: Value) -> Value {
    let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
    if uri == "skill://baaton/baaton-pm/SKILL.md" {
        let digest = skill_md_digest();
        json!({
            "skill": {
                "uri": "skill://baaton/baaton-pm/SKILL.md",
                "frontmatter": {
                    "name": "baaton-pm",
                    "description": "Manage project issues on Baaton (baaton.dev), an API-first project management board for AI agents."
                },
                "resources": [{
                    "uri": "skill://baaton/baaton-pm/SKILL.md",
                    "digest": digest
                }]
            }
        })
    } else {
        json!({"error": "Skill not found"})
    }
}

fn handle_resources_read(params: Value) -> Value {
    let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
    if uri == "skill://baaton/baaton-pm/SKILL.md" {
        json!({
            "contents": [{
                "uri": "skill://baaton/baaton-pm/SKILL.md",
                "mimeType": "text/markdown",
                "text": SKILL_MD
            }]
        })
    } else {
        json!({"error": format!("Resource not found: {}", uri)})
    }
}

// ── OAuth Protected Resource Metadata ────────────────────────────────────────

pub async fn oauth_protected_resource() -> impl IntoResponse {
    let resource = mcp_resource();
    (
        StatusCode::OK,
        [("content-type", "application/json")],
        Json(json!({
            "resource": resource,
            "authorization_servers": ["https://clerk.baaton.dev"],
            "scopes_supported": ["openid", "email", "profile", "user:org:read"],
            "resource_documentation": "https://baaton.dev/docs/mcp",
            "resource_policy_uri": "https://baaton.dev/privacy",
            "resource_tos_uri": "https://baaton.dev/terms"
        })),
    )
}

// ── OpenAI domain challenge ───────────────────────────────────────────────────

pub async fn openai_apps_challenge() -> Response {
    match std::env::var("OPENAI_APPS_CHALLENGE") {
        Ok(token) if !token.is_empty() => (
            StatusCode::OK,
            [("content-type", "text/plain; charset=utf-8")],
            token,
        )
            .into_response(),
        _ => (StatusCode::NOT_FOUND, "Not configured").into_response(),
    }
}
