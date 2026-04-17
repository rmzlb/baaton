# Baaton AI Backend Migration — Plan Détaillé

## TL;DR

Migrer l'orchestration AI du browser vers le backend Rust (Axum).
Le frontend devient un thin client qui envoie des messages et stream les réponses.

---

## Analyse des 4 approches possibles

### ① Frontend-Only (actuel)
```
Browser → Gemini API direct → tool calls (in-memory + REST) → UI
```
- ✅ Simple, rapide à itérer
- ❌ API key exposée dans le browser (inspectable via DevTools)
- ❌ Token metering client-side = non fiable (SaaS avec plans payants)
- ❌ Pas de logging serveur des tool calls
- ❌ Pas de streaming natif (CORS)
- ❌ Rate limiting impossible côté serveur
- **Verdict : antipattern pour un SaaS payant**

### ② Backend Rust (Axum + reqwest) — RECOMMANDÉ
```
Browser → POST /ai/agent → Axum handler → Gemini API → tool loop (DB direct) → SSE stream → UI
```
- ✅ API key jamais exposée
- ✅ Token metering exact (déjà du code dans `ai.rs` pour ça)
- ✅ Logging complet de chaque step/tool call
- ✅ Rate limiting fiable par user/org
- ✅ SSE streaming natif (agent_sessions.rs a déjà le pattern)
- ✅ Tool execution directe sur la DB (pas de roundtrip REST)
- ✅ Cohérent avec le stack existant (Axum, reqwest, sqlx)
- ❌ +50-100ms latence (hop réseau)
- ❌ Pas d'écosystème tool calling natif en Rust (vs AI SDK)
- **Verdict : best practice pour SaaS, cohérent avec le stack**

### ③ Backend Rust + `rig-core` (framework AI Rust)
```
Browser → POST /ai/agent → Axum + Rig → multi-provider → tool loop → SSE → UI
```
- ✅ Tout ce que ② offre, plus :
- ✅ Abstraction multi-provider (Gemini/Claude/GPT swap en 1 ligne)
- ✅ Tool calling typé natif (trait `Tool` + Serde)
- ✅ Compile-time safety sur les tools
- ❌ Nouvelle dep (rig-core 0.8+), learning curve
- ❌ Moins mature que AI SDK pour tool calling complexe
- **Verdict : bon si on veut multi-provider. Overkill si on reste Gemini-only**

### ④ Hybrid : Backend Node.js (AI SDK) + Rust API
```
Browser → POST /ai/agent → Node.js sidecar (AI SDK + streamText) → tool calls → Rust API → DB
           ↓
        SSE stream → Browser
```
- ✅ Bénéficie de l'écosystème AI SDK complet (ToolLoopAgent, prepareStep, useChat)
- ✅ Generative UI possible (`@ai-sdk/rsc` stream React components)
- ✅ API key server-side
- ❌ Ajoute un service Node.js (+ maintenance, + complexité infra)
- ❌ Latence double hop (Node → Rust → DB)
- ❌ Incohérent avec le stack (backend = Rust, pas Node)
- **Verdict : maximum features mais complexité infra**

### ⑤ Hybrid léger : Backend Rust orchestre, frontend reçoit des "UI hints"
```
Browser → POST /ai/agent → Axum → Gemini → tool loop (DB direct)
           ↓ SSE stream
        { type: "text", content: "..." }
        { type: "tool_call", name: "search_issues", status: "executing" }
        { type: "tool_result", name: "search_issues", data: {...}, component: "IssueTable" }
        { type: "text", content: "Voici les 7 issues..." }
```
Le backend renvoie des "component hints" — le frontend a un registry de composants React et rend le bon composant pour chaque tool result. Pas de React server-side, juste du JSON typé.

- ✅ API key server-side
- ✅ Pas de Node.js sidecar
- ✅ Rich UI (le frontend rend `<IssueTable>`, `<MetricsCard>`, `<MilestoneTimeline>`)
- ✅ Simple à implémenter (JSON + component registry)
- ✅ Le backend contrôle quoi montrer, le frontend contrôle comment le montrer
- ❌ Pas de "Generative UI" (le modèle ne choisit pas le composant)
- **Verdict : meilleur compromis pour Baaton**

---

## Décision : Approche ⑤ (Backend Rust + UI Hints)

### Pourquoi :
1. **Le backend Rust existe déjà** avec SSE, agent sessions, et un proxy Gemini
2. **Pas de nouvelle infra** (pas de sidecar Node.js)
3. **Rich UI** — le chat affiche des composants React pour les résultats de tools
4. **Sécurité** — API key jamais dans le browser
5. **Metering exact** — le backend compte les tokens
6. **Extensible** — si on veut Claude/GPT plus tard, on ajoute `rig-core`

---

## Architecture cible

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React SPA)             │
│                                                   │
│  AIAssistant.tsx                                  │
│    ├── useAgentChat() hook                        │
│    │     ├── POST /ai/agent { message, context }  │
│    │     └── SSE stream ← /ai/agent (EventSource) │
│    │                                              │
│    └── Component Registry                         │
│          ├── "IssueTable" → <IssueTable />        │
│          ├── "MetricsCard" → <MetricsCard />      │
│          ├── "SprintAnalysis" → <SprintAnalysis /> │
│          ├── "MilestoneTimeline" → <Timeline />   │
│          ├── "PriorityList" → <PriorityList />    │
│          └── "MarkdownText" → <Markdown />        │
└───────────────────┬─────────────────────────────┘
                    │ HTTPS
┌───────────────────▼─────────────────────────────┐
│              Backend (Rust / Axum)                │
│                                                   │
│  POST /ai/agent                                   │
│    ├── Auth check (Clerk JWT)                     │
│    ├── Quota check (ai_usage table)               │
│    ├── Build system prompt + context              │
│    ├── Build tool definitions (JSON Schema)       │
│    │                                              │
│    ├── ═══ Agent Loop (max 5 iterations) ═══     │
│    │   ├── POST Gemini generateContent            │
│    │   ├── Parse response                         │
│    │   ├── If text → SSE: { type: "text" }        │
│    │   ├── If tool_call →                         │
│    │   │   ├── SSE: { type: "tool_start" }        │
│    │   │   ├── Execute tool (DB direct via sqlx)   │
│    │   │   ├── SSE: { type: "tool_result", component }│
│    │   │   └── Feed result back to Gemini         │
│    │   └── Loop until text or max_steps           │
│    │                                              │
│    ├── Record usage (ai_usage table)              │
│    ├── Log session (agent_sessions table)         │
│    └── SSE: { type: "done" }                      │
│                                                   │
│  Tool Executors (DB direct, no REST roundtrip)    │
│    ├── search_issues → SELECT FROM issues WHERE   │
│    ├── create_issue → INSERT INTO issues          │
│    ├── get_metrics → aggregate queries            │
│    ├── plan_milestones → deterministic algo        │
│    └── ... (20 tools)                             │
└───────────────────────────────────────────────────┘
```

---

## Plan d'exécution — 5 Phases

### Phase 1 : Backend — Agent endpoint + SSE streaming
**Fichiers : `backend/src/routes/ai_agent.rs` (nouveau)**

Le cœur du refactor. Un seul endpoint qui :
1. Reçoit `{ message, history[], project_ids[], context? }`
2. Build le system prompt (réutilise la logique de `ai-engine.ts:buildSystemPrompt`)
3. Définit les 20 tools en JSON Schema
4. Lance la boucle agent (max 5 itérations)
5. Stream chaque étape via SSE

```rust
// Pseudo-code de la structure
pub async fn agent_chat(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<AgentChatRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // 1. Auth + quota check
    // 2. Build system prompt from DB data
    // 3. Define tools (JSON Schema)
    // 4. Agent loop
    let stream = async_stream::stream! {
        let mut messages = body.history;
        messages.push(user_message);
        
        for step in 0..5 {
            // Call Gemini
            let response = call_gemini(&api_key, &model, &messages, &tools).await;
            
            match response {
                GeminiResponse::Text(text) => {
                    yield sse_event("text", json!({ "content": text }));
                    break;
                }
                GeminiResponse::ToolCalls(calls) => {
                    for call in calls {
                        yield sse_event("tool_start", json!({ 
                            "name": call.name, 
                            "args": call.args 
                        }));
                        
                        let result = execute_tool(&pool, &auth, &call).await;
                        
                        yield sse_event("tool_result", json!({
                            "name": call.name,
                            "data": result.data,
                            "component": result.component_hint,
                            "summary": result.summary,
                        }));
                        
                        // Feed back to Gemini
                        messages.push(tool_result_message(call.name, result.for_model));
                    }
                }
            }
        }
        
        yield sse_event("done", json!({ "usage": { ... } }));
    };
    
    Sse::new(stream)
}
```

**Détail des sous-tâches :**

1.1. **Types** — `AgentChatRequest`, `AgentChatEvent`, `ToolDefinition`, `ToolResult`
1.2. **System prompt builder** — port depuis `ai-engine.ts:buildSystemPrompt()`
1.3. **Tool definitions** — 20 tools en JSON Schema (port depuis `ai-skills.ts:TOOL_SCHEMAS`)
1.4. **Gemini client** — `call_gemini()` avec reqwest (évolution du `chat()` existant)
1.5. **SSE stream** — réutiliser le pattern de `agent_sessions.rs:stream_steps()`
1.6. **Route registration** — `.route("/ai/agent", post(ai_agent::agent_chat))`

### Phase 2 : Backend — Tool executors (DB direct)
**Fichiers : `backend/src/routes/ai_tools.rs` (nouveau)**

Port des 20 executors de `ai-executor.ts` vers Rust avec accès DB direct.

**Catégorie A — Read-only (SQL queries, pas de side effects) :**
- `search_issues` → `SELECT ... FROM issues WHERE ...` avec full-text search
- `get_project_metrics` → aggregate queries (COUNT, AVG, GROUP BY)
- `analyze_sprint` → query issues par sprint + calculs
- `weekly_recap` → query issues updated dans les 7 derniers jours
- `suggest_priorities` → scoring algorithm (port du TypeScript)
- `export_project` → query + format JSON/CSV

**Catégorie B — Write (INSERT/UPDATE, side effects) :**
- `create_issue` → `INSERT INTO issues`
- `update_issue` → `UPDATE issues SET ...`
- `bulk_update_issues` → batch `UPDATE`
- `add_comment` → `INSERT INTO comments`
- `triage_issue` → update status + add comment
- `create_milestones_batch` → `INSERT INTO milestones`

**Catégorie C — Complex logic (algorithmes + DB) :**
- `plan_milestones` → algorithme de planification (port TypeScript → Rust)
- `adjust_timeline` → recalcul dates
- `generate_prd` → template + données → texte structuré
- `manage_initiatives` → CRUD initiatives
- `manage_automations` → CRUD automations
- `manage_sla` → CRUD SLA rules
- `manage_templates` → CRUD templates
- `manage_recurring` → CRUD recurring issues

**Chaque executor renvoie :**
```rust
struct ToolResult {
    data: serde_json::Value,       // Données brutes (pour le component frontend)
    for_model: String,             // Texte lisible (ce que Gemini reçoit)
    component_hint: Option<String>, // "IssueTable", "MetricsCard", etc.
    summary: String,               // Résumé court pour le log
}
```

**Component hints mapping :**
| Tool | Component Hint | Frontend Component |
|------|---------------|-------------------|
| search_issues | `IssueTable` | `<IssueResultsTable issues={data} />` |
| get_project_metrics | `MetricsCard` | `<ProjectMetricsCard metrics={data} />` |
| analyze_sprint | `SprintAnalysis` | `<SprintAnalysisCard analysis={data} />` |
| weekly_recap | `WeeklyRecap` | `<WeeklyRecapCard recap={data} />` |
| suggest_priorities | `PriorityList` | `<PriorityListCard priorities={data} />` |
| plan_milestones | `MilestoneTimeline` | `<MilestoneTimelineCard plan={data} />` |
| create_issue | `IssueCreated` | `<IssueCreatedCard issue={data} />` |
| update_issue | `IssueUpdated` | `<IssueUpdatedCard change={data} />` |
| generate_prd | `PRDDocument` | `<PRDViewer prd={data} />` |
| (text only tools) | `null` | Rendered as markdown |

### Phase 3 : Frontend — `useAgentChat` hook + AI Elements + Component Registry
**Fichiers : `frontend/src/hooks/useAgentChat.ts` (nouveau), `frontend/src/components/ai/tool-components/` (nouveau)**

**NEW: Use AI Elements (https://elements.ai-sdk.dev/)** — a shadcn/ui registry for AI chat UIs.
Install: `npx ai-elements@latest add conversation message tool prompt-input suggestion shimmer`
Components are copied to `components/ai-elements/` (source code, not a package).

AI Elements provides:
- `Conversation` — chat wrapper with auto-scroll
- `Message` + `MessageResponse` — message bubbles with markdown (uses Streamdown)
- `Tool` + `ToolHeader` + `ToolContent` + `ToolInput` + `ToolOutput` — collapsible tool call display
- `PromptInput` — chat input with submit button
- `Suggestion` — suggested prompts
- `Shimmer` — streaming loading animation

Custom data-rich components (IssueTable, MetricsCard) go INSIDE `ToolOutput`.

3.1. **`useAgentChat` hook** — remplace `generateAIResponse()` :
```tsx
function useAgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  async function sendMessage(content: string) {
    setIsStreaming(true);
    
    const eventSource = new EventSource(`/api/v1/ai/agent`, {
      // POST via fetch, then switch to SSE
    });
    
    // Or use fetch + ReadableStream for POST + streaming:
    const response = await fetch('/api/v1/ai/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, history: messages, project_ids: [...] }),
    });
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const events = parseSSE(decoder.decode(value));
      for (const event of events) {
        switch (event.type) {
          case 'text':
            appendTextToLastMessage(event.data.content);
            break;
          case 'tool_start':
            addToolCallMessage(event.data.name, 'executing');
            break;
          case 'tool_result':
            updateToolCallMessage(event.data.name, 'done', event.data);
            break;
          case 'done':
            setIsStreaming(false);
            break;
        }
      }
    }
  }
  
  return { messages, sendMessage, isStreaming };
}
```

3.2. **Component Registry** — map tool names to React components :
```tsx
const TOOL_COMPONENTS: Record<string, React.ComponentType<{ data: any }>> = {
  IssueTable: IssueResultsTable,
  MetricsCard: ProjectMetricsCard,
  SprintAnalysis: SprintAnalysisCard,
  WeeklyRecap: WeeklyRecapCard,
  PriorityList: PriorityListCard,
  MilestoneTimeline: MilestoneTimelineCard,
  IssueCreated: IssueCreatedCard,
  IssueUpdated: IssueUpdatedCard,
  PRDDocument: PRDViewer,
};

function ToolResultRenderer({ event }: { event: ToolResultEvent }) {
  const Component = TOOL_COMPONENTS[event.component];
  if (!Component) return <Markdown content={event.summary} />;
  return <Component data={event.data} />;
}
```

3.3. **AIAssistant.tsx migration** — remplacer `generateAIResponse()` par `useAgentChat()`. Supprimer les imports de `ai-engine.ts`, `ai-executor.ts`, `ai-skills.ts`.

### Phase 4 : Frontend cleanup
**Supprimer :**
- `frontend/src/lib/ai-engine.ts` (870 lignes)
- `frontend/src/lib/ai-executor.ts` (1515 lignes)
- `frontend/src/lib/ai-skills.ts` (355 lignes)
- `frontend/src/lib/ai-state.ts` (312 lignes)
- Package `@ai-sdk/google` du frontend
- Package `ai` du frontend (sauf si useChat est utilisé ailleurs)

**Total supprimé : ~3000 lignes frontend**

L'AI SDK n'est plus nécessaire côté frontend. Le frontend ne fait que :
- Envoyer des messages via REST
- Recevoir des événements SSE
- Rendre des composants React selon les component hints

### Phase 5 : Tests + monitoring
5.1. **Backend integration tests** — tester chaque tool executor avec une DB test
5.2. **SSE streaming test** — vérifier que les events arrivent dans le bon ordre
5.3. **Frontend component tests** — vérifier le rendering de chaque tool component
5.4. **E2E test** — send message → verify stream → verify UI
5.5. **Monitoring** — dashboard des tool calls, latence, erreurs (via `agent_sessions` table)

---

## Réponse à la question : "Le backend doit-il render le HTML/React ?"

**Non.** Voici pourquoi :

| Approche | Pour | Contre |
|----------|------|--------|
| **RSC (React Server Components)** | UI la plus riche, streaming natif | Nécessite Next.js server-side, incompatible avec Vite SPA + Rust backend |
| **Backend render HTML** | Pas de JS nécessaire | Perd toute interactivité (pas de click, hover, animations) |
| **Component hints (choix ⑤)** | Best of both worlds | Le modèle ne "choisit" pas le composant (c'est hardcodé par tool) |

Le **Component Hints** pattern est le bon choix car :
1. Baaton est un **Vite SPA** (pas Next.js) — pas de RSC possible
2. Le backend est en **Rust** (pas de React.renderToString)
3. Les composants ont besoin d'**interactivité** (click sur une issue → ouvrir le drawer)
4. Le mapping tool → component est **déterministe** (search_issues → toujours IssueTable)
5. La "Generative UI" (le modèle choisit le composant) n'a pas de use case ici

Si un jour Baaton migre vers Next.js + Node.js, on pourra utiliser `@ai-sdk/rsc` pour du streaming de React components côté serveur. Mais c'est un changement de stack complet.

---

## Estimation

| Phase | Effort | Dépendance |
|-------|--------|-----------|
| Phase 1 : Backend endpoint + SSE | 2-3 jours | Rien |
| Phase 2 : 20 tool executors Rust | 3-4 jours | Phase 1 |
| Phase 3 : Frontend hook + components | 2 jours | Phase 1 |
| Phase 4 : Frontend cleanup | 0.5 jour | Phase 3 |
| Phase 5 : Tests + monitoring | 1 jour | Phase 2 + 3 |

**Total : ~9 jours de dev** (en sous-agents parallèles : Phase 2 // Phase 3)

---

## Contraintes pour les sous-agents

### Sub-agent Phase 1 (Backend endpoint)
- Ne PAS toucher aux routes existantes (`/ai/chat`, `/ai/key`, `/ai/pm-full-review`)
- Réutiliser le pattern SSE de `agent_sessions.rs:stream_steps()`
- Le system prompt doit être identique à celui de `ai-engine.ts:buildSystemPrompt()`
- Les tool definitions JSON Schema doivent matcher les Zod schemas de `ai-skills.ts`
- Max 5 iterations dans la boucle agent
- Record usage dans `ai_usage` table (comme `ai.rs:chat()` le fait déjà)
- Temperature: 0.4, max tokens: 8000

### Sub-agent Phase 2 (Tool executors)
- Chaque executor DOIT renvoyer `ToolResult { data, for_model, component_hint, summary }`
- `for_model` = le texte que Gemini reçoit (PAS du JSON brut)
- `data` = les données structurées pour le component frontend
- Les queries SQL doivent respecter le row-level security (filtrer par `org_id`)
- Ne PAS exposer de données cross-org
- Les tools write doivent aussi broadcast un SSE event (via `broadcast_event`)

### Sub-agent Phase 3 (Frontend)
- Le hook `useAgentChat` doit avoir la même interface que `generateAIResponse`
- Les components doivent être dans `src/components/ai/tool-components/`
- Chaque component reçoit un `data: any` prop (typé par component)
- Le fallback si pas de component = afficher le `summary` en Markdown
- Garder le même look & feel que le chat actuel

---

## Phase 6 — UIMessage Protocol Migration (April 2026)

### Why

The custom SSE protocol (events: `text`, `tool_start`, `tool_result`, `done`, `error`) and custom `useAgentChat` React hook reinvented what AI SDK v5 standardizes. The `__INTERNAL__:` prefix hack for tool approval was buggy: Gemini Flash 2.0 sometimes echoed the prefix back as text instead of calling the real tool.

### What changed

**Backend** ([backend/src/routes/ai_chat/](backend/src/routes/ai_chat/))
- New route `POST /api/v1/ai/chat`
- Speaks AI SDK v5 UIMessage stream protocol (SSE with typed JSON chunks)
- Required header `x-vercel-ai-ui-message-stream: v1`
- Tools split into two categories:
  - **client-interactive** (`propose_*`): no server execute, frontend renders approval UI
  - **server-execute** (`create_*`/`update_*`/`search_*`/etc.): auto-run via `execute_tool()`
- Old `/api/v1/ai/agent` route deprecated (kept one cycle as fallback)

**Frontend**
- `useAgentChat` (custom hook, ~435 lines) → `useChat` from `@ai-sdk/react` (native)
- `DefaultChatTransport` with `prepareSendMessagesRequest` for fresh JWT per request
- `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` for HIL auto-resubmit
- New `ToolPartRenderer` routes `tool-*` parts to React components (replaces custom registry)
- Proposal cards use `addToolOutput({ tool, toolCallId, output: { approved, finalValues } })`
- ~570 lines of custom code deleted (useAgentChat + ToolResultRenderer + filters + hacks)
- Sessions migrated to `UIMessage[]` format with `schema_version: 2`. Old sessions cleared with one-time toast.

### Stream protocol (UIMessage v1)

Server emits SSE `data: {...JSON...}` events ending with `data: [DONE]`. Header `x-vercel-ai-ui-message-stream: v1`.

Event types we emit:
- `start`, `start-step`
- `text-start`, `text-delta`, `text-end`
- `tool-input-available`
- `tool-output-available`
- `finish-step`, `finish`
- `error`

Frontend `useChat` parses these into `message.parts: UIMessagePart[]`.

### Tool approval flow (Human In the Loop)

1. User: "create issue HLM: foo"
2. Model calls `propose_issue` (client-interactive — server doesn't execute)
3. Backend emits `tool-input-available`, stream ends after `[DONE]`
4. Frontend renders IssueProposal card from `part.input`
5. User edits and clicks Approuver
6. Frontend calls `addToolOutput({ tool, toolCallId, output: { approved, finalValues } })`
7. `sendAutomaticallyWhen` triggers next turn (resends messages with the new tool output appended)
8. Backend sees the tool output in messages, model now calls `create_issue` (server execute)
9. Backend executes, emits `tool-output-available`, then `text-*` for confirmation
10. Stream ends, IssueCreated card shows
