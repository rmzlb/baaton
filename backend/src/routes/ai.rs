use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{middleware::AuthUser, models::ApiResponse};

// ─── Key Endpoint (returns Gemini API key to authenticated users) ──

pub async fn get_key(
    Extension(_auth): Extension<AuthUser>,
) -> Response {
    match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => {
            Json(serde_json::json!({"key": k})).into_response()
        }
        _ => {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"error": "AI service not configured"})),
            )
                .into_response()
        }
    }
}

// ─── Request Types (from frontend) ───────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub tools: Option<Vec<Value>>,
    #[serde(default)]
    pub system_instruction: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// ─── Gemini API Types ─────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

// ─── Handler ──────────────────────────────────────────

pub async fn chat(
    Extension(_auth): Extension<AuthUser>, // Ensures user is authenticated
    Json(body): Json<ChatRequest>,
) -> Response {
    // Validate input
    if body.messages.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "messages must not be empty"})),
        )
            .into_response();
    }
    if body.messages.len() > 100 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "too many messages (max 100)"})),
        )
            .into_response();
    }
    for msg in &body.messages {
        if msg.content.len() > 50_000 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "message content too long (max 50000 chars)"})),
            )
                .into_response();
        }
    }

    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::error!("GEMINI_API_KEY not set");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({"error": "AI service not configured"})),
            )
                .into_response();
        }
    };

    let model = body.model.as_deref().unwrap_or("gemini-3-flash-preview");

    // Convert messages to Gemini format
    let contents: Vec<GeminiContent> = body
        .messages
        .iter()
        .map(|m| GeminiContent {
            role: Some(match m.role.as_str() {
                "assistant" => "model".to_string(),
                other => other.to_string(),
            }),
            parts: vec![GeminiPart {
                text: m.content.clone(),
            }],
        })
        .collect();

    // Build system instruction if provided
    let system_instruction = body.system_instruction.map(|text| GeminiContent {
        role: None,
        parts: vec![GeminiPart { text }],
    });

    let gemini_body = GeminiRequest {
        contents,
        tools: body.tools,
        system_instruction,
    };

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let client = reqwest::Client::new();
    let resp = match client.post(&url).json(&gemini_body).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Gemini API request failed: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Failed to reach AI service"})),
            )
                .into_response();
        }
    };

    let status = resp.status();
    let resp_bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("Failed to read Gemini response body: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid AI service response"})),
            )
                .into_response();
        }
    };

    if !status.is_success() {
        tracing::error!(
            "Gemini API error {}: {}",
            status.as_u16(),
            String::from_utf8_lossy(&resp_bytes)
        );
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("AI service returned status {}", status.as_u16())})),
        )
            .into_response();
    }

    // Return the Gemini response as-is (preserving function calls, candidates, etc.)
    let gemini_json: Value = match serde_json::from_slice(&resp_bytes) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("Failed to parse Gemini response as JSON: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid AI service response"})),
            )
                .into_response();
        }
    };

    Json(gemini_json).into_response()
}

// ─── Deterministic PM Full Review (no Gemini tools) ─────────────

#[derive(Debug, Deserialize, Default)]
pub struct PmFullReviewRequest {
    #[serde(default)]
    pub project_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    pub horizon_days: Option<i64>,
    #[serde(default)]
    pub sprint_length_days: Option<i64>,
}

#[derive(Debug, sqlx::FromRow, Clone)]
struct PmProjectRow {
    id: Uuid,
    name: String,
    prefix: String,
}

#[derive(Debug, sqlx::FromRow, Clone)]
struct PmIssueRow {
    id: Uuid,
    display_id: String,
    title: String,
    project_id: Uuid,
    project_name: String,
    project_prefix: String,
    status: String,
    priority: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    assignee_ids: Vec<String>,
    category: Vec<String>,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PmFullReviewResponse {
    generated_at: DateTime<Utc>,
    horizon_days: i64,
    sprint_length_days: i64,
    period: ReviewPeriod,
    sprint_windows: Vec<SprintWindow>,
    summary: PmReviewSummary,
    projects: Vec<ProjectPlan>,
    priority_suggestions: Vec<PrioritySuggestion>,
}

#[derive(Debug, Serialize)]
pub struct ReviewPeriod {
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Serialize, Clone)]
pub struct SprintWindow {
    key: String,
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Serialize)]
pub struct PmReviewSummary {
    project_count: usize,
    open_issue_count: usize,
    milestone_a_count: usize,
    milestone_b_count: usize,
    milestone_c_count: usize,
    sprint1_count: usize,
    sprint2_count: usize,
    sprint3_count: usize,
    priority_suggestions_count: usize,
}

#[derive(Debug, Serialize)]
pub struct ProjectPlan {
    project_id: Uuid,
    project_name: String,
    project_prefix: String,
    open_issue_count: usize,
    milestones: Vec<MilestoneBucket>,
    sprints: Vec<SprintBucket>,
}

#[derive(Debug, Serialize)]
pub struct MilestoneBucket {
    key: String,
    name: String,
    issue_ids: Vec<String>,
    issues: Vec<PmIssuePlanItem>,
}

#[derive(Debug, Serialize)]
pub struct SprintBucket {
    key: String,
    name: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    issue_ids: Vec<String>,
    issues: Vec<PmIssuePlanItem>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PmIssuePlanItem {
    id: Uuid,
    display_id: String,
    title: String,
    project_id: Uuid,
    project_name: String,
    project_prefix: String,
    status: String,
    priority: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    assignee_ids: Vec<String>,
    category: Vec<String>,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PrioritySuggestion {
    rank: usize,
    reason: String,
    issue: PmIssuePlanItem,
}

struct RankedSuggestion<'a> {
    score: i32,
    reason: String,
    issue: &'a PmIssueRow,
}

fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

fn priority_rank(priority: Option<&str>) -> i32 {
    match priority.map(normalize).as_deref() {
        Some("urgent") => 0,
        Some("high") => 1,
        Some("medium") => 2,
        Some("low") => 3,
        _ => 4,
    }
}

fn is_active_status(status: &str) -> bool {
    matches!(normalize(status).as_str(), "in_progress" | "in_review")
}

fn is_backlog_status(status: &str) -> bool {
    matches!(normalize(status).as_str(), "todo" | "backlog")
}

fn has_blocker_signal(issue: &PmIssueRow) -> bool {
    let status = normalize(&issue.status);
    if status == "blocked" || status == "blocker" {
        return true;
    }

    let title_lc = normalize(&issue.title);
    if title_lc.contains("blocker") || title_lc.contains("blocked") || title_lc.contains("blocking") {
        return true;
    }

    issue
        .tags
        .iter()
        .chain(issue.category.iter())
        .map(|v| normalize(v))
        .any(|v| {
            v.contains("blocker")
                || v.contains("blocked")
                || v.contains("incident")
                || v.contains("hotfix")
                || v.contains("critical")
        })
}

fn is_hot_in_review(issue: &PmIssueRow) -> bool {
    normalize(&issue.status) == "in_review" && priority_rank(issue.priority.as_deref()) <= 1
}

fn milestone_key(issue: &PmIssueRow) -> (&'static str, &'static str) {
    if priority_rank(issue.priority.as_deref()) == 0 || has_blocker_signal(issue) || is_hot_in_review(issue)
    {
        return ("milestone_a", "Milestone A — Stabilization");
    }

    if is_active_status(&issue.status) || priority_rank(issue.priority.as_deref()) == 1 {
        return ("milestone_b", "Milestone B — Active Delivery");
    }

    if is_backlog_status(&issue.status) {
        return ("milestone_c", "Milestone C — Backlog Acceleration");
    }

    ("milestone_c", "Milestone C — Backlog Acceleration")
}

fn score_issue_for_priority(issue: &PmIssueRow, today: NaiveDate) -> (i32, String) {
    let mut score = 0;
    let mut reasons: Vec<String> = Vec::new();

    match normalize(issue.priority.as_deref().unwrap_or("none")).as_str() {
        "urgent" => {
            score += 100;
            reasons.push("urgent priority".to_string());
        }
        "high" => {
            score += 75;
            reasons.push("high priority".to_string());
        }
        "medium" => {
            score += 45;
            reasons.push("medium priority".to_string());
        }
        "low" => {
            score += 20;
            reasons.push("low priority".to_string());
        }
        _ => {
            score += 30;
            reasons.push("priority missing (needs triage)".to_string());
        }
    }

    let status = normalize(&issue.status);
    match status.as_str() {
        "blocked" | "blocker" => {
            score += 40;
            reasons.push("currently blocked".to_string());
        }
        "in_review" => {
            score += 30;
            reasons.push("waiting in review".to_string());
        }
        "in_progress" => {
            score += 25;
            reasons.push("already in progress".to_string());
        }
        "todo" | "backlog" => {
            score += 10;
        }
        _ => {
            score += 5;
        }
    }

    if has_blocker_signal(issue) {
        score += 35;
        reasons.push("blocker/hotfix signal detected".to_string());
    }

    let age_days = (today - issue.created_at.date_naive()).num_days().max(0);
    score += age_days.min(30) as i32;
    if age_days >= 7 {
        reasons.push(format!("stale for {} days", age_days));
    }

    if issue.assignee_ids.is_empty() {
        score += 8;
        reasons.push("no assignee".to_string());
    }

    if reasons.is_empty() {
        reasons.push("open issue requiring planning".to_string());
    }

    (score, reasons.join("; "))
}

fn to_plan_item(issue: &PmIssueRow) -> PmIssuePlanItem {
    PmIssuePlanItem {
        id: issue.id,
        display_id: issue.display_id.clone(),
        title: issue.title.clone(),
        project_id: issue.project_id,
        project_name: issue.project_name.clone(),
        project_prefix: issue.project_prefix.clone(),
        status: issue.status.clone(),
        priority: issue.priority.clone(),
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        assignee_ids: issue.assignee_ids.clone(),
        category: issue.category.clone(),
        tags: issue.tags.clone(),
    }
}

fn sort_by_priority_then_oldest(a: &&PmIssueRow, b: &&PmIssueRow) -> std::cmp::Ordering {
    priority_rank(a.priority.as_deref())
        .cmp(&priority_rank(b.priority.as_deref()))
        .then_with(|| a.created_at.cmp(&b.created_at))
        .then_with(|| a.display_id.cmp(&b.display_id))
}

fn sort_oldest_first(a: &&PmIssueRow, b: &&PmIssueRow) -> std::cmp::Ordering {
    a.created_at
        .cmp(&b.created_at)
        .then_with(|| priority_rank(a.priority.as_deref()).cmp(&priority_rank(b.priority.as_deref())))
        .then_with(|| a.display_id.cmp(&b.display_id))
}

pub async fn pm_full_review(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<PmFullReviewRequest>,
) -> Result<Json<ApiResponse<PmFullReviewResponse>>, (StatusCode, Json<Value>)> {
    let org_id = auth
        .org_id
        .as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let horizon_days = body.horizon_days.unwrap_or(42).clamp(7, 180);
    let sprint_length_days = body.sprint_length_days.unwrap_or(14).clamp(7, 42);
    let selected_project_ids = body.project_ids.and_then(|ids| if ids.is_empty() { None } else { Some(ids) });

    let projects = sqlx::query_as::<_, PmProjectRow>(
        r#"
        SELECT p.id, p.name, p.prefix
        FROM projects p
        WHERE p.org_id = $1
          AND ($2::uuid[] IS NULL OR p.id = ANY($2))
        ORDER BY p.name ASC
        "#,
    )
    .bind(org_id)
    .bind(&selected_project_ids)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Failed to list projects: {}", e)})),
        )
    })?;

    let issues = sqlx::query_as::<_, PmIssueRow>(
        r#"
        SELECT
            i.id,
            i.display_id,
            i.title,
            i.project_id,
            p.name AS project_name,
            p.prefix AS project_prefix,
            i.status,
            i.priority,
            i.created_at,
            i.updated_at,
            COALESCE(i.assignee_ids, '{}'::text[]) AS assignee_ids,
            COALESCE(i.category, '{}'::text[]) AS category,
            COALESCE(i.tags, '{}'::text[]) AS tags
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1
          AND ($2::uuid[] IS NULL OR i.project_id = ANY($2))
          AND LOWER(i.status) NOT IN ('done', 'cancelled')
        ORDER BY p.name ASC, i.created_at ASC, i.display_id ASC
        "#,
    )
    .bind(org_id)
    .bind(&selected_project_ids)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Failed to list open issues: {}", e)})),
        )
    })?;

    let today = Utc::now().date_naive();
    let horizon_end = today + Duration::days(horizon_days - 1);

    let mut sprint_windows: Vec<SprintWindow> = Vec::with_capacity(3);
    for idx in 0..3 {
        let start = today + Duration::days((idx as i64) * sprint_length_days);
        let computed_end = start + Duration::days(sprint_length_days - 1);
        let end = if start > horizon_end {
            start
        } else {
            computed_end.min(horizon_end)
        };

        sprint_windows.push(SprintWindow {
            key: format!("sprint{}", idx + 1),
            name: format!("Sprint {}", idx + 1),
            start_date: start,
            end_date: end,
        });
    }

    let all_open_issues = issues.clone();

    let mut issues_by_project: HashMap<Uuid, Vec<PmIssueRow>> = HashMap::new();
    for issue in issues {
        issues_by_project.entry(issue.project_id).or_default().push(issue);
    }

    let mut project_plans: Vec<ProjectPlan> = Vec::with_capacity(projects.len());

    let mut total_milestone_a = 0usize;
    let mut total_milestone_b = 0usize;
    let mut total_milestone_c = 0usize;
    let mut total_sprint1 = 0usize;
    let mut total_sprint2 = 0usize;
    let mut total_sprint3 = 0usize;

    for project in projects {
        let project_issues = issues_by_project.remove(&project.id).unwrap_or_default();
        let issue_refs: Vec<&PmIssueRow> = project_issues.iter().collect();

        // Milestone buckets
        let mut milestone_a: Vec<&PmIssueRow> = Vec::new();
        let mut milestone_b: Vec<&PmIssueRow> = Vec::new();
        let mut milestone_c: Vec<&PmIssueRow> = Vec::new();

        for issue in &issue_refs {
            match milestone_key(issue).0 {
                "milestone_a" => milestone_a.push(issue),
                "milestone_b" => milestone_b.push(issue),
                _ => milestone_c.push(issue),
            }
        }

        milestone_a.sort_by(sort_by_priority_then_oldest);
        milestone_b.sort_by(sort_by_priority_then_oldest);
        milestone_c.sort_by(sort_by_priority_then_oldest);

        // Sprint buckets
        let sprint1_capacity = if issue_refs.is_empty() {
            0
        } else {
            ((issue_refs.len() + 2) / 3).max(1)
        };

        let mut sprint1_candidates: Vec<&PmIssueRow> = issue_refs
            .iter()
            .copied()
            .filter(|i| priority_rank(i.priority.as_deref()) <= 1)
            .collect();
        sprint1_candidates.sort_by(sort_oldest_first);

        let mut sprint1: Vec<&PmIssueRow> = Vec::new();
        let mut sprint1_ids: HashSet<Uuid> = HashSet::new();
        for issue in sprint1_candidates {
            if sprint1.len() >= sprint1_capacity {
                break;
            }
            if sprint1_ids.insert(issue.id) {
                sprint1.push(issue);
            }
        }

        if sprint1.len() < sprint1_capacity {
            let mut active_fill: Vec<&PmIssueRow> = issue_refs
                .iter()
                .copied()
                .filter(|i| is_active_status(&i.status) && !sprint1_ids.contains(&i.id))
                .collect();
            active_fill.sort_by(sort_oldest_first);
            for issue in active_fill {
                if sprint1.len() >= sprint1_capacity {
                    break;
                }
                if sprint1_ids.insert(issue.id) {
                    sprint1.push(issue);
                }
            }
        }

        let mut sprint2: Vec<&PmIssueRow> = Vec::new();
        let mut sprint3: Vec<&PmIssueRow> = Vec::new();

        for issue in &issue_refs {
            if sprint1_ids.contains(&issue.id) {
                continue;
            }

            if priority_rank(issue.priority.as_deref()) <= 1 || is_active_status(&issue.status) {
                sprint2.push(issue);
            } else {
                sprint3.push(issue);
            }
        }

        sprint1.sort_by(sort_by_priority_then_oldest);
        sprint2.sort_by(sort_by_priority_then_oldest);
        sprint3.sort_by(sort_by_priority_then_oldest);

        total_milestone_a += milestone_a.len();
        total_milestone_b += milestone_b.len();
        total_milestone_c += milestone_c.len();
        total_sprint1 += sprint1.len();
        total_sprint2 += sprint2.len();
        total_sprint3 += sprint3.len();

        let milestones = vec![
            MilestoneBucket {
                key: "milestone_a".to_string(),
                name: "Milestone A — Stabilization".to_string(),
                issue_ids: milestone_a.iter().map(|i| i.display_id.clone()).collect(),
                issues: milestone_a.iter().map(|i| to_plan_item(i)).collect(),
            },
            MilestoneBucket {
                key: "milestone_b".to_string(),
                name: "Milestone B — Active Delivery".to_string(),
                issue_ids: milestone_b.iter().map(|i| i.display_id.clone()).collect(),
                issues: milestone_b.iter().map(|i| to_plan_item(i)).collect(),
            },
            MilestoneBucket {
                key: "milestone_c".to_string(),
                name: "Milestone C — Backlog Acceleration".to_string(),
                issue_ids: milestone_c.iter().map(|i| i.display_id.clone()).collect(),
                issues: milestone_c.iter().map(|i| to_plan_item(i)).collect(),
            },
        ];

        let s1 = &sprint_windows[0];
        let s2 = &sprint_windows[1];
        let s3 = &sprint_windows[2];

        let sprints = vec![
            SprintBucket {
                key: s1.key.clone(),
                name: s1.name.clone(),
                start_date: s1.start_date,
                end_date: s1.end_date,
                issue_ids: sprint1.iter().map(|i| i.display_id.clone()).collect(),
                issues: sprint1.iter().map(|i| to_plan_item(i)).collect(),
            },
            SprintBucket {
                key: s2.key.clone(),
                name: s2.name.clone(),
                start_date: s2.start_date,
                end_date: s2.end_date,
                issue_ids: sprint2.iter().map(|i| i.display_id.clone()).collect(),
                issues: sprint2.iter().map(|i| to_plan_item(i)).collect(),
            },
            SprintBucket {
                key: s3.key.clone(),
                name: s3.name.clone(),
                start_date: s3.start_date,
                end_date: s3.end_date,
                issue_ids: sprint3.iter().map(|i| i.display_id.clone()).collect(),
                issues: sprint3.iter().map(|i| to_plan_item(i)).collect(),
            },
        ];

        project_plans.push(ProjectPlan {
            project_id: project.id,
            project_name: project.name,
            project_prefix: project.prefix,
            open_issue_count: issue_refs.len(),
            milestones,
            sprints,
        });
    }

    let mut ranked: Vec<RankedSuggestion<'_>> = all_open_issues
        .iter()
        .map(|issue| {
            let (score, reason) = score_issue_for_priority(issue, today);
            RankedSuggestion { score, reason, issue }
        })
        .collect();

    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.issue.created_at.cmp(&b.issue.created_at))
            .then_with(|| a.issue.display_id.cmp(&b.issue.display_id))
    });

    let priority_suggestions: Vec<PrioritySuggestion> = ranked
        .into_iter()
        .take(10)
        .enumerate()
        .map(|(idx, ranked)| PrioritySuggestion {
            rank: idx + 1,
            reason: ranked.reason,
            issue: to_plan_item(ranked.issue),
        })
        .collect();

    let response = PmFullReviewResponse {
        generated_at: Utc::now(),
        horizon_days,
        sprint_length_days,
        period: ReviewPeriod {
            start_date: today,
            end_date: horizon_end,
        },
        sprint_windows,
        summary: PmReviewSummary {
            project_count: project_plans.len(),
            open_issue_count: total_milestone_a + total_milestone_b + total_milestone_c,
            milestone_a_count: total_milestone_a,
            milestone_b_count: total_milestone_b,
            milestone_c_count: total_milestone_c,
            sprint1_count: total_sprint1,
            sprint2_count: total_sprint2,
            sprint3_count: total_sprint3,
            priority_suggestions_count: priority_suggestions.len(),
        },
        projects: project_plans,
        priority_suggestions,
    };

    Ok(Json(ApiResponse::new(response)))
}
