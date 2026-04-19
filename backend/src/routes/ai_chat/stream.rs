use axum::response::sse::Event;
use serde_json::{json, Value};
use sqlx::types::Json;
use sqlx::PgPool;
use std::convert::Infallible;

use super::types::UIMessageChunk;

// ─── SSE Helpers ────────────────────────────────────────────────────────────

fn sse_chunk(chunk: &UIMessageChunk) -> Result<Event, Infallible> {
    Ok(Event::default().data(serde_json::to_string(chunk).unwrap_or_default()))
}

fn sse_done() -> Result<Event, Infallible> {
    Ok(Event::default().data("[DONE]"))
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() > max {
        format!(
            "{}\n\n[truncated at {} chars — full data in UI]",
            &s[..max],
            max
        )
    } else {
        s.to_string()
    }
}

// ─── System Prompt Builder (copied from ai_agent.rs) ────────────────────────
// Kept separate to avoid coupling with the deprecated route.

fn build_system_prompt(context: &str) -> String {
    // ~250 mots fixes : préfixe stable pour cache Gemini + règles 2026 (pas de listes « you must » en capitales).
    let static_blocks = r#"# Baaton AI

Copilote produit/dev pour Baaton (Kanban multi-projets, préfixes type HLM/SQX, vue cross-org comme /all-issues). Tu t'appuies uniquement sur les outils pour les faits (pas d'invention).

## Outils
Lecture : **org_overview** (1ᵉʳ choix pour tout récap multi-projets / état des lieux / dashboard / snapshot — ne JAMAIS chaîner get_project_metrics+analyze_sprint+weekly_recap pour ça, c'est exactement ce que org_overview fait en 1 appel), search_issues, get_project_metrics (drill-down 1 projet), analyze_sprint (1 sprint précis), weekly_recap (par personne), suggest_priorities, find_similar_issues, workload_by_assignee, compare_projects (2-5 projets head-to-head), export_project. Écriture : enchaîner **propose_issue / propose_update_issue / propose_bulk_update / propose_comment** → validation UI → **create_issue, update_issue, bulk_update_issues, add_comment** avec les `finalValues` retournés. Planning : plan_milestones → create_milestones_batch, adjust_timeline. Autres : generate_prd, triage_issue, manage_* (initiatives, automations, SLA, templates, recurring).

## Écritures
- Ne jamais appeler create/update/bulk/comment sans passage par le **propose_*** correspondant. Si `approved` est faux, une phrase d'acquittement suffit.
- Plusieurs créations demandées dans le même message : plusieurs appels **propose_issue** dans la même réponse (parallèle).
- Ambiguïté réelle (plusieurs projets possibles, plusieurs issues qui matchent) : une question courte. Préfixe ou cible unique : exécute.

## Titres, IDs, descriptions
- Titres : phrase claire, sans préfixe projet ni étiquette type [BUG] dans le titre.
- Citer les **display_id** (HLM-42). Pour les champs techniques, utiliser les UUID fournis par les outils quand nécessaire.
- **propose_issue** : description Markdown structurée selon le type (bug : contexte + reproduction + attendu/actuel ; feature : besoin + solution + critères d'acceptation ; improvement : bénéfice ; question : question + contexte). Enrichir avec le contexte projet ci-dessous ; ne pas laisser vide.

## Analyse
- Question multi-projets / "état des lieux" / "récap" / "dashboard" / "comment vont les projets ?" → **org_overview** SEUL, jamais combiné avec get_project_metrics ou analyze_sprint (doublons garantis).
- Sprint précis ou drill-down 1 projet : **analyze_sprint** et/ou **get_project_metrics**.
- Données manquantes : le dire au lieu de combler.

## Réponses
Langue de l'utilisateur. Style tech lead, concis, listes et métriques issues des outils. Après une écriture réussie : une courte confirmation avec display_id si pertinent."#;

    format!(
        "{}\n\n# Données projet (contexte)\n\n{}",
        static_blocks, context
    )
}

// ─── Project Context Builder (copied from ai_agent.rs) ─────────────────────

pub(super) async fn build_project_context(
    pool: &PgPool,
    org_ids: &[String],
    project_ids: &[String],
) -> String {
    #[derive(sqlx::FromRow)]
    struct ProjectRow {
        id: uuid::Uuid,
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
            "SELECT id, name, prefix FROM projects WHERE org_id = ANY($1::text[]) ORDER BY name ASC LIMIT 20",
        )
        .bind(org_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, ProjectRow>(
            "SELECT id, name, prefix FROM projects WHERE org_id = ANY($1::text[]) AND id = ANY($2::uuid[]) ORDER BY name ASC",
        )
        .bind(org_ids)
        .bind(project_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    if projects.is_empty() {
        return "Aucun projet trouvé dans cette organisation.".to_string();
    }

    let counts: Vec<IssueCountRow> = if project_ids.is_empty() {
        sqlx::query_as::<_, IssueCountRow>(
            r#"
            SELECT p.name AS project_name, i.status, COUNT(*) AS cnt
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            WHERE p.org_id = ANY($1::text[]) AND LOWER(i.status) NOT IN ('done', 'cancelled')
            GROUP BY p.name, i.status
            ORDER BY p.name ASC
            "#,
        )
        .bind(org_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, IssueCountRow>(
            r#"
            SELECT p.name AS project_name, i.status, COUNT(*) AS cnt
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            WHERE p.org_id = ANY($1::text[]) AND p.id = ANY($2::uuid[]) AND LOWER(i.status) NOT IN ('done', 'cancelled')
            GROUP BY p.name, i.status
            ORDER BY p.name ASC
            "#,
        )
        .bind(org_ids)
        .bind(project_ids)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    let mut ctx = String::from("## Projets disponibles\n\n");
    for project in &projects {
        ctx.push_str(&format!(
            "### {} (prefix: {}, id: {})\n",
            project.name, project.prefix, project.id
        ));
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

// ─── Agent Loop Stream ──────────────────────────────────────────────────────

/// Build the SSE stream that runs the Gemini agent loop, emitting
/// UIMessageChunk events per the AI SDK v5 protocol.
pub fn build_stream(
    pool: PgPool,
    org_ids: Vec<String>,
    user_id: String,
    project_ids: Vec<String>,
    mut contents: Vec<Value>,
    api_key: String,
) -> impl futures::Stream<Item = Result<Event, Infallible>> {
    async_stream::stream! {
        let context = build_project_context(&pool, &org_ids, &project_ids).await;
        let system_prompt = build_system_prompt(&context);

        let tool_defs = crate::routes::ai_tools::get_tool_definitions();
        let function_declarations: Vec<Value> = tool_defs
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters
                })
            })
            .collect();

        let message_id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        yield sse_chunk(&UIMessageChunk::Start { message_id });
        yield sse_chunk(&UIMessageChunk::StartStep);

        let client = reqwest::Client::new();
        // Aligné avec `ai.rs` : preview Gemini 3 Flash ; surcharge via GEMINI_CHAT_MODEL (ex. gemini-2.5-flash).
        let model = std::env::var("GEMINI_CHAT_MODEL")
            .unwrap_or_else(|_| "gemini-3-flash-preview".to_string());
        let mut total_tokens_in: i32 = 0;
        let mut total_tokens_out: i32 = 0;
        let mut total_tokens_cached: i32 = 0;

        'agent_loop: for _step in 0..5usize {
            let request_body = json!({
                "contents": contents,
                "tools": [{ "functionDeclarations": function_declarations }],
                "systemInstruction": {
                    "parts": [{ "text": system_prompt }]
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

            // Retry with exponential backoff on 429 (rate limit) or 503 (overloaded).
            // Gemini quotas reset quickly; a short wait usually fixes it.
            const MAX_RETRIES: usize = 3;
            let backoff_ms = [1000_u64, 2000, 4000];
            let resp: Option<reqwest::Response> = {
                let mut r = None;
                for attempt in 0..=MAX_RETRIES {
                    match client.post(&url).json(&request_body).send().await {
                        Ok(raw) => {
                            let s = raw.status();
                            let is_retryable = s == 429 || s == 503;
                            if !is_retryable || attempt == MAX_RETRIES {
                                r = Some(raw);
                                break;
                            }
                            let wait = backoff_ms[attempt.min(backoff_ms.len() - 1)];
                            tracing::warn!(
                                "Gemini {} — retrying in {}ms (attempt {}/{})",
                                s.as_u16(),
                                wait,
                                attempt + 1,
                                MAX_RETRIES
                            );
                            tokio::time::sleep(tokio::time::Duration::from_millis(wait)).await;
                        }
                        Err(e) => {
                            tracing::error!("Gemini request failed (attempt {}): {}", attempt + 1, e);
                            if attempt == MAX_RETRIES {
                                yield sse_chunk(&UIMessageChunk::Error {
                                    error_text: "Impossible de joindre l'IA. Verifie ta connexion et reessaie.".into(),
                                });
                                break 'agent_loop;
                            }
                            let wait = backoff_ms[attempt.min(backoff_ms.len() - 1)];
                            tokio::time::sleep(tokio::time::Duration::from_millis(wait)).await;
                        }
                    }
                }
                r
            };
            let Some(resp) = resp else { break 'agent_loop };

            let status = resp.status();
            if !status.is_success() {
                let err_body = resp.text().await.unwrap_or_default();
                tracing::error!("Gemini error {}: {}", status.as_u16(), err_body);

                // Extract a human-readable error message from Gemini's body if possible
                let gemini_reason: Option<String> = serde_json::from_str::<Value>(&err_body)
                    .ok()
                    .and_then(|v| {
                        v.pointer("/error/message")
                            .and_then(|m| m.as_str())
                            .map(String::from)
                    });

                let user_msg = match status.as_u16() {
                    429 => format!(
                        "L'IA est debordee (quota Gemini atteint). Reessaie dans quelques secondes. {}",
                        gemini_reason.as_deref().unwrap_or("")
                    ).trim().to_string(),
                    503 => "L'IA est temporairement indisponible. Reessaie dans un instant.".into(),
                    500..=599 => format!(
                        "Erreur interne de l'IA (code {}). Reessaie dans un moment.",
                        status.as_u16()
                    ),
                    401 | 403 => "L'IA n'est pas configuree correctement (cle API). Contacte l'admin.".into(),
                    400 => gemini_reason
                        .map(|r| format!("Requete invalide : {}", r))
                        .unwrap_or_else(|| "Requete invalide a l'IA.".into()),
                    _ => format!(
                        "Erreur IA (code {}). {}",
                        status.as_u16(),
                        gemini_reason.unwrap_or_default()
                    ),
                };

                yield sse_chunk(&UIMessageChunk::Error { error_text: user_msg });
                break 'agent_loop;
            }

            let gemini_resp: Value = match resp.json::<Value>().await {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!("Failed to parse Gemini response: {}", e);
                    yield sse_chunk(&UIMessageChunk::Error {
                        error_text: "Invalid AI service response".into(),
                    });
                    break 'agent_loop;
                }
            };

            if let Some(usage) = gemini_resp.pointer("/usageMetadata") {
                total_tokens_in += usage
                    .get("promptTokenCount")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                total_tokens_out += usage
                    .get("candidatesTokenCount")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                // Implicit/explicit prefix cache (Gemini 2.5+ / doc API). Nom aligné sur la doc Google.
                let cached = usage
                    .get("cachedContentTokenCount")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                total_tokens_cached += cached;
                if cached > 0 {
                    tracing::info!(
                        target: "baaton.ai.cache",
                        model = %model,
                        step_cached_prompt_tokens = cached,
                        step_prompt_tokens = usage
                            .get("promptTokenCount")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0),
                        "Gemini cache: cachedContentTokenCount > 0"
                    );
                }
            }

            let parts = gemini_resp
                .pointer("/candidates/0/content/parts")
                .and_then(|p| p.as_array())
                .cloned()
                .unwrap_or_default();

            if parts.is_empty() {
                yield sse_chunk(&UIMessageChunk::Error {
                    error_text: "Empty response from AI service".into(),
                });
                break 'agent_loop;
            }

            let has_function_calls =
                parts.iter().any(|p| p.get("functionCall").is_some());

            if has_function_calls {
                if let Some(model_content) =
                    gemini_resp.pointer("/candidates/0/content").cloned()
                {
                    contents.push(model_content);
                } else {
                    contents.push(json!({ "role": "model", "parts": parts }));
                }

                let mut function_responses: Vec<Value> = Vec::new();
                let mut hit_client_interactive = false;

                for part in &parts {
                    let fc = match part.get("functionCall") {
                        Some(fc) => fc,
                        None => continue,
                    };

                    let tool_call_id =
                        format!("call_{}", uuid::Uuid::new_v4().simple());
                    let tool_name = fc["name"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let mut input = fc["args"].clone();

                    // Resolve prefixes (e.g. "HLM") and display_ids (e.g. "HLM-42")
                    // to UUIDs BEFORE emitting to the client, so proposal forms
                    // can preselect the right project/issue in their dropdowns.
                    // For non-client-interactive tools, execute_tool will call
                    // resolve_args_ids again — it's idempotent on UUIDs.
                    crate::routes::ai_tools::resolve_args_ids(&pool, &org_ids, &mut input).await;

                    // Capture Gemini's per-call thoughtSignature and forward it
                    // as AI SDK `providerMetadata`. Without this round-trip,
                    // Gemini 2.5+/3.x returns 400 "Function call is missing a
                    // thought_signature" on the very next turn.
                    let provider_metadata = part
                        .get("thoughtSignature")
                        .cloned()
                        .map(|sig| json!({ "google": { "thoughtSignature": sig } }));

                    yield sse_chunk(&UIMessageChunk::ToolInputAvailable {
                        tool_call_id: tool_call_id.clone(),
                        tool_name: tool_name.clone(),
                        input: input.clone(),
                        provider_metadata,
                    });

                    if crate::routes::ai_tools::is_client_interactive(&tool_name)
                    {
                        hit_client_interactive = true;
                        break;
                    }

                    match crate::routes::ai_tools::execute_tool(
                        &pool, &org_ids, &user_id, &tool_name, input,
                    )
                    .await
                    {
                        Ok(tool_result) => {
                            let output = json!({
                                "result": truncate(&tool_result.for_model, 4000),
                                "data": tool_result.data,
                                "component": tool_result.component_hint,
                                "summary": tool_result.summary,
                            });
                            yield sse_chunk(
                                &UIMessageChunk::ToolOutputAvailable {
                                    tool_call_id,
                                    output: output.clone(),
                                },
                            );
                            function_responses.push(json!({
                                "functionResponse": {
                                    "name": tool_name,
                                    "response": { "result": output["result"] }
                                }
                            }));
                        }
                        Err(e) => {
                            tracing::warn!(
                                "Tool '{}' failed: {}",
                                tool_name,
                                e
                            );
                            yield sse_chunk(&UIMessageChunk::Error {
                                error_text: format!(
                                    "Tool {} failed: {}",
                                    tool_name, e
                                ),
                            });
                            function_responses.push(json!({
                                "functionResponse": {
                                    "name": tool_name,
                                    "response": { "error": e }
                                }
                            }));
                        }
                    }
                }

                if hit_client_interactive {
                    break 'agent_loop;
                }

                if !function_responses.is_empty() {
                    contents.push(json!({
                        "role": "user",
                        "parts": function_responses
                    }));
                }
            } else {
                let text_content: String = parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("");

                if !text_content.is_empty() {
                    let text_id =
                        format!("txt_{}", uuid::Uuid::new_v4().simple());
                    yield sse_chunk(&UIMessageChunk::TextStart {
                        id: text_id.clone(),
                    });
                    yield sse_chunk(&UIMessageChunk::TextDelta {
                        id: text_id.clone(),
                        delta: text_content,
                    });
                    yield sse_chunk(&UIMessageChunk::TextEnd { id: text_id });
                }
                break 'agent_loop;
            }
        }

        let meta = json!({
            "cached_prompt_tokens": total_tokens_cached,
        });
        tracing::info!(
            target: "baaton.ai.cache",
            model = %model,
            total_prompt_tokens = total_tokens_in,
            total_output_tokens = total_tokens_out,
            total_cached_prompt_tokens = total_tokens_cached,
            "ai_chat turn usage (cachedContentTokenCount sum per request steps)"
        );
        let _ = sqlx::query(
            "INSERT INTO ai_usage (org_id, user_id, event_type, tokens_in, tokens_out, model, metadata) VALUES ($1, $2, 'ai_chat', $3, $4, $5, $6)",
        )
        .bind(org_ids.first().map(|s| s.as_str()).unwrap_or(""))
        .bind(&user_id)
        .bind(total_tokens_in)
        .bind(total_tokens_out)
        .bind(&model)
        .bind(Json(meta))
        .execute(&pool)
        .await;

        yield sse_chunk(&UIMessageChunk::FinishStep);
        yield sse_chunk(&UIMessageChunk::Finish);
        yield sse_done();
    }
}
