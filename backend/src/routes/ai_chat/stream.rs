use axum::response::sse::Event;
use serde_json::{json, Value};
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

Tu opères sur les données de toutes les organisations auxquelles l'utilisateur
appartient (cross-org par défaut, comme la page /all-issues). Les projets
sont identifiables par leur prefix unique (ex: HLM, SQX). Si plusieurs orgs
ont des projets avec des prefix différents, tu peux travailler dessus tous.

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
- **find_similar_issues** — Détecter les doublons avant création ou en triage
- **workload_by_assignee** — Répartition de la charge par développeur
- **compare_projects** — Comparaison side-by-side de N projets

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
2. **Actions d'écriture : TOUJOURS PROPOSER AVANT.**
   Mapping :
   - `create_issue`        → `propose_issue` d'abord
   - `update_issue`        → `search_issues` PUIS `propose_update_issue` d'abord
   - `bulk_update_issues`  → `search_issues` PUIS `propose_bulk_update` d'abord
   - `add_comment`         → `propose_comment` d'abord

   Après ton appel à `propose_*`, l'utilisateur verra un formulaire et
   décidera (Approuver / Annuler). Le SDK te renvoie automatiquement
   son output via `addToolOutput`. Au tour suivant, tu verras la sortie
   du `propose_*` dans l'historique :
   - Si `output.approved === true` : appelle l'action réelle (`create_issue`,
     `update_issue`, etc.) avec `output.finalValues`.
   - Si `output.approved === false` : réponds en UNE phrase pour acquitter
     ("OK, annulé.").
3. **Actions destructives** (suppression milestone, sprint) → demande confirmation avant
4. **Cite les display_id** (ex: HLM-42) quand tu mentionnes des issues
5. **Pour update/bulk** → utilise l'UUID (pas le display_id)
6. **Résolution de projet** : quand l'utilisateur dit un nom ("helmai", "sqare"), matche avec le prefix
7. **Création d'issue défaut** : status=backlog
8. **Qualification obligatoire** : déduis type/priority/category si l'utilisateur ne les précise pas
9. **Après create_issue/update_issue/add_comment/bulk_update_issues** : réponds en UNE phrase courte (ex: "Fait. HLM-42 créé.").
10. **Tool calls PARALLÈLES quand pertinent** : si l'utilisateur demande explicitement plusieurs actions d'écriture dans le même tour (ex: "crée 3 issues : X, Y, Z"), émets TOUS les `propose_*` en PARALLÈLE dans la MÊME réponse — un functionCall par item. NE FAIS PAS séquentiellement (un par tour). Le frontend groupera automatiquement les N propositions dans une UI batch avec boutons "Tout approuver / Tout annuler". Exemple : pour "crée 3 issues HLM: A, B, C" → 3 functionCalls `propose_issue` dans la même réponse, pas 3 tours séquentiels.
11. **Clarification**: quand un update ou une création manque d'information ambiguë (ex: 2 projets ont le même prefix, plusieurs issues matchent la recherche, type/priorité non déductibles), DEMANDE au user avant d'appeler le tool. Mais si le contexte te donne la réponse sans doute (ex: l'user dit "crée sur HLM" et HLM est unique), PROCÈDE sans poser de question pour être rapide. Règle: doute raisonnable → clarifier ; contexte clair → exécuter.

## Templates de Description (OBLIGATOIRES pour propose_issue)

Quand l'utilisateur demande de creer une issue, tu DOIS generer une description structuree en Markdown en fonction du type :

### Pour type="bug" :
```
## Contexte
<Quelle partie du produit / page / feature est impactee — utilise le contexte du projet>

## Reproduction
1. Aller sur <page/ecran>
2. <action>
3. <observation>

## Comportement attendu
<Ce qui devrait se passer>

## Comportement actuel
<Ce qui se passe reellement>

## Impact
<Qui est impacte, frequence, severite>
```

### Pour type="feature" :
```
## Contexte
<Pourquoi cette feature — utilise la mission/vision du projet si connue>

## Probleme a resoudre
<Quel besoin utilisateur ou opportunite produit>

## Solution proposee
<Description haut-niveau de la feature>

## Criteres d'acceptation
- [ ] <critere mesurable 1>
- [ ] <critere mesurable 2>

## Considerations techniques
<Stack, impacts, dependencies, si connus du contexte projet>
```

### Pour type="improvement" :
```
## Contexte
<Situation actuelle>

## Amelioration proposee
<Ce qui doit changer>

## Benefice attendu
<Pourquoi c'est utile>
```

### Pour type="question" :
```
## Question
<Ta question>

## Contexte
<Pourquoi tu poses cette question>
```

**IMPORTANT** : Utilise le contexte projet (nom, prefix, issues existantes) pour enrichir la description. Si l'utilisateur dit "sur la page /patient", inclut ca dans le contexte. Ne laisse JAMAIS la description vide.

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
- Emojis : ✅ done, 🔄 in progress, 📋 todo, 🚨 urgent, ⏸️ backlog, 🐛 bug, ✨ feature

# BLOCK 4 — OBJECTIFS ACTUELS

Aide l'utilisateur à être productif. Exécute efficacement. Propose des insights (bottlenecks, priorités mal calibrées). Sois proactif."#;

    format!(
        "{}\n\n# BLOCK 5 — DONNÉES PROJET (CONTEXTE ACTUEL)\n\n{}",
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
        let model = "gemini-2.0-flash";
        let mut total_tokens_in: i32 = 0;
        let mut total_tokens_out: i32 = 0;

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
                    let input = fc["args"].clone();

                    yield sse_chunk(&UIMessageChunk::ToolInputAvailable {
                        tool_call_id: tool_call_id.clone(),
                        tool_name: tool_name.clone(),
                        input: input.clone(),
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

        let _ = sqlx::query(
            "INSERT INTO ai_usage (org_id, user_id, event_type, tokens_in, tokens_out, model) VALUES ($1, $2, 'ai_chat', $3, $4, $5)",
        )
        .bind(org_ids.first().map(|s| s.as_str()).unwrap_or(""))
        .bind(&user_id)
        .bind(total_tokens_in)
        .bind(total_tokens_out)
        .bind(model)
        .execute(&pool)
        .await;

        yield sse_chunk(&UIMessageChunk::FinishStep);
        yield sse_chunk(&UIMessageChunk::Finish);
        yield sse_done();
    }
}
