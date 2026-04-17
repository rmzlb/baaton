use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{convert::Infallible, time::Duration};

use crate::middleware::AuthUser;

// ─── Request / Response Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<AgentChatMessage>,
    #[serde(default)]
    pub project_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AgentChatMessage {
    pub role: String,
    pub content: String,
}

// ─── SSE Helper ───────────────────────────────────────────────────────────────

fn sse_event(event_type: &str, data: Value) -> Event {
    Event::default().event(event_type).data(data.to_string())
}

// ─── System Prompt Builder ────────────────────────────────────────────────────
// Ported from frontend/src/lib/ai-engine.ts:buildSystemPrompt()

fn build_system_prompt(context: &str) -> String {
    let static_blocks = r#"# BLOCK 1 — IDENTITY

Tu es **Baaton AI**, le copilote intégré à Baaton — un board d'orchestration pour agents IA de développement.
Tes utilisateurs sont des **développeurs et tech leads** qui utilisent des agents IA (Claude, GPT, Copilot, OpenClaw) pour coder.
Tu comprends : architecture logicielle, sprints agile, dette technique, CI/CD, code review, et orchestration d'agents.

## Contexte Baaton
Baaton = "You orchestrate. AI executes." C'est un Kanban/projet tracker spécialisé pour :
- Suivre les issues de code (bugs, features, improvements) par projet
- Planifier des sprints et milestones pour des équipes dev + agents IA
- Catégoriser par domaine technique : FRONT, BACK, API, DB, INFRA, UX, DEVOPS
- Gérer des tags colorés pour le contexte (ex: "ElevenLabs", "Auth", "Perf")
- Connecter des agents IA (OpenClaw) pour automatiser le triage et l'exécution

## Ton Rôle
Tu es le PM assistant de l'équipe. Tu ne codes pas, mais tu :
- Tries et priorises les issues intelligemment
- Proposes des milestones réalistes basés sur la vélocité et les dépendances techniques
- Détectes les blockers, la dette technique, et les risques
- Génères des PRD structurés avec specs techniques
- Comprends les catégories FRONT/BACK/API/DB et groupes les issues par domaine

# BLOCK 2 — SKILLS & CAPACITÉS

## Tes Skills (fonctions exécutables) :

### 📋 Lecture & Analyse
- **search_issues** — Chercher/filtrer des issues (texte, status, priorité, catégorie, projet)
- **get_project_metrics** — Métriques détaillées (vélocité, taux de complétion, distribution)
- **analyze_sprint** — Analyse de sprint, vélocité, recommandations

### ✏️ Actions
- **create_issue** — Créer une issue (titre, description, type, priorité, tags, catégorie)
- **update_issue** — Modifier une issue
- **bulk_update_issues** — Modifier N issues d'un coup
- **add_comment** — Ajouter un commentaire / note sur une issue

### 📄 Génération
- **generate_prd** — Générer un PRD structuré

### 🎯 Milestone Planning
- **plan_milestones** — Auto-group open issues into milestones (propose first, user confirms)
- **create_milestones_batch** — Create milestones after confirmation
- **adjust_timeline** — Adjust timeline based on new constraint/deadline

## Règles d'Exécution
1. **TOUJOURS utiliser tes skills** pour accéder aux données — jamais d'hallucination
2. **Actions d'écriture (update/bulk/comment/milestone)** → **PROPOSER puis demander confirmation** avant d'exécuter (exception : create_issue → crée directement)
3. **Actions destructives** (suppression) → demande confirmation avant
4. **Bulk updates** → liste les changements AVANT d'exécuter
5. **Cite les display_id** (ex: HLM-42) quand tu mentionnes des issues
6. **Pour update/bulk** → utilise l'UUID (pas le display_id)
7. **Résolution de projet** : quand l'utilisateur dit un nom ("helmai", "sqare"), matche avec le prefix
8. **Création d'issue** : par défaut status=backlog (pas todo)
9. **Qualification obligatoire** : déduis type/priority/category si l'utilisateur ne les précise pas

## Workflow PM (pertinent)
- **Analyser** : résumer le volume + urgents + in_review + blockers
- **Qualifier** : regrouper par domaine (FRONT/BACK/API/DB/INFRA/UX)
- **Proposer** : milestones spécifiques avec dates cibles
- **Sprints** : placer urgents + in_progress en Sprint 1/2
- **Valider** : demander confirmation avant d'appliquer

## Format de Sortie
- IDs exacts : UUID pour update/delete, display_id pour citation
- Après chaque action, confirme avec le résultat (display_id + changement)
- Listes > 10 items : résumé + top 5 en détail
- Ne réponds JAMAIS avec des données que tu n'as pas obtenues via un skill

## Milestone Planning Flow
1. **plan_milestones** → retourne proposed_milestones groupés avec target_dates
2. Présente le plan formaté au user
3. Demande confirmation
4. Sur confirmation → **create_milestones_batch** avec les données exactes du plan
5. Ne rappelle PAS plan_milestones sur confirmation
6. Si l'utilisateur demande d'ajuster un planning existant: utilise **adjust_timeline**
7. Si un tool milestone est indisponible/échoue: explique clairement l'échec, puis fallback sur **search_issues** + **get_project_metrics** pour proposer un plan manuel

## Sprint / Planning Guidance
- Pour questions sprint: utilise **analyze_sprint** et/ou **get_project_metrics** avant de conclure
- Si données incomplètes: dis explicitement ce qui manque au lieu d'inventer

## Issue Creation
1. Si projet ambigu → demande
2. Remplis un max automatiquement (type, priorité, catégorie, tags)
3. NE DEMANDE PAS de confirmation — crée directement
4. Après : propose d'ajouter des images via ⌘V ou drag & drop
5. **Titre** — RÈGLE ABSOLUE, SANS EXCEPTION :
   - ZÉRO brackets, ZÉRO prefix projet, ZÉRO tag dans le titre
   - ❌ INTERDIT : "[SQX][BUG] Fix auth" / "[HLM][TECH] Refactor" / "[ARCHI] Migration" / "SQX: Fix" / "HLM - Fix"
   - ✅ CORRECT : "Fix auth token refresh on expired sessions"
   - ✅ CORRECT : "Migration catalogue au niveau Organisation"
6. **Pas de doublon** : vérifie via search_issues si une issue similaire existe déjà avant de créer

# BLOCK 3 — COMMUNICATION

- Réponds dans la langue de l'utilisateur (FR si français, EN si anglais)
- Parle comme un tech lead, pas comme un PM corporate
- Concis, actionnable, Markdown. Pas de bullshit, pas de fluff.
- Bullet points > paragraphes
- Métriques concrètes + pourcentages
- `backticks` pour les termes techniques
- Flag les blockers et la dette technique proactivement
- Emojis : ✅ done, 🔄 in progress, 📋 todo, 🚨 urgent, ⏸️ backlog, 🐛 bug, ✨ feature"#;

    format!(
        "{}\n\n# BLOCK 4 — DONNÉES PROJET (DYNAMIQUE)\n\n{}\n\n# BLOCK 5 — OBJECTIFS ACTUELS\n\nAide l'utilisateur à être productif. Exécute efficacement. Propose des insights (bottlenecks, priorités mal calibrées). Sois proactif.",
        static_blocks, context
    )
}

// ─── Project Context Builder ──────────────────────────────────────────────────

async fn build_project_context(pool: &PgPool, org_id: &str, project_ids: &[String]) -> String {
    #[derive(sqlx::FromRow)]
    struct ProjectRow {
        name: String,
        prefix: String,
    }

    #[derive(sqlx::FromRow)]
    struct IssueCountRow {
        project_name: String,
        status: String,
        cnt: i64,
    }

    let projects: Vec<ProjectRow> = if project_ids.is_empty() {
        sqlx::query_as::<_, ProjectRow>(
            "SELECT name, prefix FROM projects WHERE org_id = $1 ORDER BY name ASC LIMIT 20",
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, ProjectRow>(
            "SELECT name, prefix FROM projects WHERE org_id = $1 AND id = ANY($2::uuid[]) ORDER BY name ASC",
        )
        .bind(org_id)
        .bind(project_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    if projects.is_empty() {
        return "Aucun projet trouvé dans cette organisation.".to_string();
    }

    // Get issue counts per project per status
    let counts: Vec<IssueCountRow> = if project_ids.is_empty() {
        sqlx::query_as::<_, IssueCountRow>(
            r#"
            SELECT p.name AS project_name, i.status, COUNT(*) AS cnt
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            WHERE p.org_id = $1 AND LOWER(i.status) NOT IN ('done', 'cancelled')
            GROUP BY p.name, i.status
            ORDER BY p.name ASC
            "#,
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, IssueCountRow>(
            r#"
            SELECT p.name AS project_name, i.status, COUNT(*) AS cnt
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            WHERE p.org_id = $1 AND p.id = ANY($2::uuid[]) AND LOWER(i.status) NOT IN ('done', 'cancelled')
            GROUP BY p.name, i.status
            ORDER BY p.name ASC
            "#,
        )
        .bind(org_id)
        .bind(project_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    // Build context string
    let mut ctx = String::from("## Projets disponibles\n\n");
    for project in &projects {
        ctx.push_str(&format!("### {} (prefix: {})\n", project.name, project.prefix));
        let project_counts: Vec<&IssueCountRow> = counts
            .iter()
            .filter(|c| c.project_name == project.name)
            .collect();
        if project_counts.is_empty() {
            ctx.push_str("- Aucune issue ouverte\n");
        } else {
            let total: i64 = project_counts.iter().map(|c| c.cnt).sum();
            ctx.push_str(&format!("- **{}** issues ouvertes\n", total));
            for c in &project_counts {
                ctx.push_str(&format!("  - {}: {}\n", c.status, c.cnt));
            }
        }
        ctx.push('\n');
    }

    ctx
}

// ─── Handler ──────────────────────────────────────────────────────────────────

pub async fn agent_chat(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<AgentChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<Value>)> {
    let org_id = auth
        .org_id
        .as_deref()
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Organization required"})),
            )
        })?
        .to_string();

    // ── Quota check (mirrors ai.rs:chat) ──
    let plan = crate::routes::admin::get_user_plan(&pool, &auth.user_id, Some(&org_id)).await;
    let limits = crate::routes::admin::plan_limits(&plan);
    let ai_limit: i64 = if limits.ai_limit < 0 {
        i64::MAX
    } else {
        limits.ai_limit
    };

    let ai_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ai_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())",
    )
    .bind(&auth.user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    if ai_count >= ai_limit {
        return Err((
            StatusCode::PAYMENT_REQUIRED,
            Json(json!({
                "error": "AI message quota exceeded for this month",
                "limit": ai_limit,
                "current": ai_count,
                "plan": plan,
                "upgrade_url": "https://baaton.dev/#pricing"
            })),
        ));
    }

    // Validate request
    if body.message.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "message must not be empty"})),
        ));
    }

    if body.message.len() > 50_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "message too long (max 50000 chars)"})),
        ));
    }

    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "AI service not configured"})),
            ));
        }
    };

    // Move everything into the stream
    let user_id = auth.user_id.clone();
    let message = body.message;
    let history = body.history;
    let project_ids = body.project_ids;

    let stream = async_stream::stream! {
        // Build project context from DB
        let context = build_project_context(&pool, &org_id, &project_ids).await;
        let system_prompt = build_system_prompt(&context);

        // Tool definitions
        let tool_defs = crate::routes::ai_tools::get_tool_definitions();
        let function_declarations: Vec<Value> = tool_defs.iter().map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters
            })
        }).collect();

        // Build initial contents from history + current message
        let mut contents: Vec<Value> = history.iter().map(|m| {
            json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": [{"text": m.content}]
            })
        }).collect();

        contents.push(json!({
            "role": "user",
            "parts": [{"text": message}]
        }));

        let client = reqwest::Client::new();
        let model = "gemini-2.0-flash";
        let mut total_tokens_in = 0i32;
        let mut total_tokens_out = 0i32;

        // ── Agent Loop (max 5 iterations) ──────────────────────────────────────
        'agent_loop: for _step in 0..5usize {

            let request_body = json!({
                "contents": contents,
                "tools": [{"functionDeclarations": function_declarations}],
                "systemInstruction": {
                    "parts": [{"text": system_prompt}]
                },
                "generationConfig": {
                    "temperature": 0.4,
                    "maxOutputTokens": 8000
                }
            });

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, api_key
            );

            let resp = match client.post(&url).json(&request_body).send().await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("Gemini agent request failed: {}", e);
                    yield Ok(sse_event("error", json!({"message": "Failed to reach AI service"})));
                    break 'agent_loop;
                }
            };

            let status = resp.status();
            if !status.is_success() {
                let err_body = resp.text().await.unwrap_or_default();
                tracing::error!("Gemini agent error {}: {}", status.as_u16(), err_body);
                yield Ok(sse_event("error", json!({"message": format!("AI service returned {}", status.as_u16())})));
                break 'agent_loop;
            }

            let gemini_resp: Value = match resp.json::<Value>().await {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!("Failed to parse Gemini agent response: {}", e);
                    yield Ok(sse_event("error", json!({"message": "Invalid AI service response"})));
                    break 'agent_loop;
                }
            };

            // Track token usage
            if let Some(usage) = gemini_resp.pointer("/usageMetadata") {
                total_tokens_in += usage.get("promptTokenCount")
                    .and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                total_tokens_out += usage.get("candidatesTokenCount")
                    .and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            }

            // Parse candidate content parts
            let parts = gemini_resp
                .pointer("/candidates/0/content/parts")
                .and_then(|p| p.as_array())
                .cloned()
                .unwrap_or_default();

            if parts.is_empty() {
                yield Ok(sse_event("error", json!({"message": "Empty response from AI service"})));
                break 'agent_loop;
            }

            // Separate function calls from text parts
            let has_function_calls = parts.iter().any(|p| p.get("functionCall").is_some());
            let text_content: String = parts.iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n");

            if has_function_calls {
                // Append model's response (with function calls) to contents
                if let Some(model_content) = gemini_resp.pointer("/candidates/0/content").cloned() {
                    contents.push(model_content);
                } else {
                    contents.push(json!({
                        "role": "model",
                        "parts": parts
                    }));
                }

                // Collect and execute all function calls in this response
                let mut function_responses: Vec<Value> = Vec::new();

                for part in &parts {
                    let func_call = match part.get("functionCall") {
                        Some(fc) => fc,
                        None => continue,
                    };

                    let tool_name = func_call.get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tool_args = func_call.get("args")
                        .cloned()
                        .unwrap_or(json!({}));

                    // Emit tool_start event
                    yield Ok(sse_event("tool_start", json!({
                        "name": tool_name,
                        "args": tool_args
                    })));

                    // Execute tool
                    let exec_result = crate::routes::ai_tools::execute_tool(
                        &pool,
                        &org_id,
                        &user_id,
                        &tool_name,
                        tool_args,
                    ).await;

                    match exec_result {
                        Ok(tool_result) => {
                            // Emit tool_result event
                            yield Ok(sse_event("tool_result", json!({
                                "name": tool_name,
                                "component": tool_result.component_hint,
                                "data": tool_result.data,
                                "summary": tool_result.summary
                            })));

                            // Accumulate function response for Gemini
                            function_responses.push(json!({
                                "functionResponse": {
                                    "name": tool_name,
                                    "response": {"result": tool_result.for_model}
                                }
                            }));
                        }
                        Err(e) => {
                            tracing::warn!("Tool '{}' execution failed: {}", tool_name, e);
                            yield Ok(sse_event("error", json!({"message": format!("Tool '{}' failed: {}", tool_name, e)})));

                            function_responses.push(json!({
                                "functionResponse": {
                                    "name": tool_name,
                                    "response": {"error": e}
                                }
                            }));
                        }
                    }
                }

                // Feed all tool results back into the conversation
                if !function_responses.is_empty() {
                    contents.push(json!({
                        "role": "function",
                        "parts": function_responses
                    }));
                }

                // Continue loop for the model to respond to tool results

            } else if !text_content.is_empty() {
                // Got final text response → emit and stop
                yield Ok(sse_event("text", json!({"content": text_content})));
                break 'agent_loop;

            } else {
                // No function calls and no text — unexpected
                yield Ok(sse_event("error", json!({"message": "Unexpected empty response from AI"})));
                break 'agent_loop;
            }
        }

        // ── Record AI usage ────────────────────────────────────────────────────
        let _ = sqlx::query(
            "INSERT INTO ai_usage (org_id, user_id, event_type, tokens_in, tokens_out, model) VALUES ($1, $2, 'agent_chat', $3, $4, $5)"
        )
        .bind(&org_id)
        .bind(&user_id)
        .bind(total_tokens_in)
        .bind(total_tokens_out)
        .bind(model)
        .execute(&pool)
        .await;

        // ── Done ───────────────────────────────────────────────────────────────
        yield Ok(sse_event("done", json!({
            "usage": {
                "input_tokens": total_tokens_in,
                "output_tokens": total_tokens_out
            }
        })));
    };

    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    ))
}
