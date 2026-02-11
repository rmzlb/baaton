/**
 * Baaton AI Engine v2 — Vercel AI SDK (@ai-sdk/google)
 *
 * Migrated from @google/generative-ai to Vercel AI SDK for:
 * - Built-in agentic loop (maxSteps)
 * - Typed tool results
 * - Unified provider interface (swap Gemini/Claude/GPT)
 * - Proper token usage from response metadata
 * - Automatic retry handling
 *
 * Keeps all existing features:
 * - State machine integration (ai-state.ts)
 * - Tool masking (5 contexts via ai-skills.ts)
 * - Conversation summarization
 * - Rate limiting + token budget
 * - 5-block Manus system prompt
 */

import { generateText, jsonSchema, type CoreMessage, type CoreTool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Issue, Project, Milestone } from './types';
import { getToolsForContext, type SkillContext } from './ai-skills';
import { executeSkill } from './ai-executor';
import type { SkillResult } from './ai-skills';
import {
  type AIStateContext,
  createInitialState,
  transition,
  stateToSkillContext,
  checkRateLimit,
  estimateTokens,
  checkBudget,
  summarizeHistory,
} from './ai-state';

// ─── API Key (fetched from backend) ───────────
let _cachedApiKey: string | null = null;
const API_URL = import.meta.env.VITE_API_URL || '';

async function getGeminiApiKey(authToken?: string): Promise<string> {
  if (_cachedApiKey) return _cachedApiKey;
  if (API_URL && authToken) {
    try {
      const res = await fetch(`${API_URL}/api/v1/ai/key`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.key) {
          _cachedApiKey = data.key;
          return _cachedApiKey;
        }
      }
    } catch { /* backend unreachable */ }
  }
  throw new Error('AI non configuré. Clé API manquante.');
}

// ─── Errors ───────────────────────────────────
export class RateLimitError extends Error {
  constructor() {
    super('Rate limit exceeded — please wait a moment before sending another message.');
    this.name = 'RateLimitError';
  }
}

function mapProviderErrorToUserMessage(errorLike: unknown): string {
  const msg = errorLike instanceof Error ? errorLike.message : String(errorLike || '');

  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Rate limited — wait a moment and try again.';
  }
  if (msg.includes('403') || msg.includes('API_KEY') || msg.includes('permission')) {
    return 'AI configuration issue (API key/permissions). Please check settings.';
  }
  if (msg.includes('ECONNRESET') || msg.includes('fetch') || msg.includes('network') || msg.includes('Network')) {
    return 'Network issue while contacting AI provider. Please retry.';
  }
  if (msg.toLowerCase().includes('schema') || msg.toLowerCase().includes('object')) {
    return 'AI tool schema mismatch detected. Please retry; if it persists, contact support.';
  }

  return 'AI request failed unexpectedly. Please try again.';
}

// ─── Convert Gemini Tool Declarations → AI SDK Tools ────
// Bridge: getToolsForContext returns Gemini format [{functionDeclarations: [...]}]
// AI SDK needs Record<string, CoreTool> with jsonSchema parameters

function convertGeminiPropertyToJsonSchema(prop: any): any {
  if (!prop) return { type: 'string' };
  const schema: any = {};
  switch (prop.type) {
    case 'STRING':
      schema.type = 'string';
      break;
    case 'NUMBER':
      schema.type = 'number';
      break;
    case 'BOOLEAN':
      schema.type = 'boolean';
      break;
    case 'ARRAY':
      schema.type = 'array';
      if (prop.items) {
        schema.items = convertGeminiPropertyToJsonSchema(prop.items);
      }
      break;
    case 'OBJECT':
      schema.type = 'object';
      if (prop.properties) {
        schema.properties = {};
        for (const [k, v] of Object.entries(prop.properties)) {
          schema.properties[k] = convertGeminiPropertyToJsonSchema(v);
        }
      }
      if (prop.required) schema.required = prop.required;
      break;
    default:
      schema.type = 'string';
  }
  if (prop.description) schema.description = prop.description;
  return schema;
}

function buildAISDKTools(
  skillContext: SkillContext,
  executor: (name: string, args: Record<string, unknown>) => Promise<any>,
): Record<string, CoreTool> {
  const geminiTools = getToolsForContext(skillContext);
  const declarations = geminiTools.flatMap((t: any) => t.functionDeclarations || []);
  const tools: Record<string, CoreTool> = {};

  for (const decl of declarations) {
    // Convert Gemini params → JSON Schema
    const params = decl.parameters || { type: 'OBJECT', properties: {} };
    const schema = convertGeminiPropertyToJsonSchema(params);

    // Gemini API requires root schema to be { type: "object" } with properties
    // Ensure the root always has type "object" and properties defined
    if (schema.type !== 'object') {
      schema.type = 'object';
    }
    if (!schema.properties) {
      schema.properties = {};
    }
    // Gemini API is strict about OBJECT schemas:
    // - Must have type "object" with properties  
    // - Remove empty required arrays (Gemini rejects them)
    // - Set additionalProperties to prevent SDK from treating as "empty" schema
    if (Array.isArray(schema.required) && schema.required.length === 0) {
      delete schema.required;
    }
    // CRITICAL: The @ai-sdk/google provider's isEmptyObjectSchema() returns true
    // when properties is empty AND no additionalProperties. When true at root,
    // it returns undefined → Gemini gets no parameters → "should be of type OBJECT" error.
    // Setting additionalProperties to true prevents this.
    if (!schema.additionalProperties) {
      schema.additionalProperties = true;
    }

    // CRITICAL FIX for Gemini "parameters schema should be of type OBJECT" error:
    // The @ai-sdk/google SDK converts jsonSchema back to Gemini format, but can
    // lose the OBJECT type. Ensure schema always has non-empty properties and
    // a _dummy field to prevent the SDK from treating it as an empty schema.
    if (Object.keys(schema.properties || {}).length === 0) {
      schema.properties = { _context: { type: 'string', description: 'Optional context' } };
    }
    
    tools[decl.name] = {
      description: decl.description,
      parameters: jsonSchema(schema),
      execute: async (args: any) => {
        try {
          return await executor(decl.name, args);
        } catch (error) {
          console.error('[AI][ToolInvocationFailed]', {
            tool: decl.name,
            args,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: false,
            error: mapProviderErrorToUserMessage(error),
          };
        }
      },
    };
  }

  return tools;
}

// ─── Context Builder ──────────────────────────

export function buildProjectContext(projects: Project[], allIssues: Record<string, Issue[]>): string {
  const lines: string[] = ['# Current Project Data\n'];

  for (const project of projects) {
    const issues = allIssues[project.id] || [];
    if (issues.length === 0) continue;

    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};

    for (const issue of issues) {
      statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
      if (issue.priority) priorityCounts[issue.priority] = (priorityCounts[issue.priority] || 0) + 1;
      typeCounts[issue.type] = (typeCounts[issue.type] || 0) + 1;
      for (const cat of issue.category || []) {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    }

    lines.push(`## ${project.prefix} — ${project.name} (ID: ${project.id})`);
    lines.push(`Total: ${issues.length} issues`);
    lines.push(`Status: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (Object.keys(priorityCounts).length > 0) {
      lines.push(`Priority: ${Object.entries(priorityCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    lines.push(`Types: ${Object.entries(typeCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (Object.keys(categoryCounts).length > 0) {
      lines.push(`Domains: ${Object.entries(categoryCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    const open = issues.filter((i) => i.status === 'todo' || i.status === 'in_progress' || i.status === 'in_review');
    if (open.length > 0) {
      lines.push(`\nOpen issues:`);
      for (const i of open.slice(0, 30)) {
        const prio = i.priority ? ` [${i.priority}]` : '';
        const cats = (i.category || []).length > 0 ? ` {${(i.category || []).join(',')}}` : '';
        const tags = i.tags.length > 0 ? ` #${i.tags.join(' #')}` : '';
        const type = ` (${i.type})`;
        lines.push(`- ${i.display_id} (uuid:${i.id}) | ${i.status}${prio}${type}${cats}${tags} | ${i.title}`);
      }
      if (open.length > 30) lines.push(`  ... and ${open.length - 30} more`);
    }

    const done = issues
      .filter((i) => i.status === 'done')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    if (done.length > 0) {
      lines.push(`\nRecently done (${done.length} total):`);
      for (const i of done.slice(0, 10)) {
        lines.push(`- ${i.display_id} | ${i.title}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ─── System Prompt (5-Block Manus Pattern) ────

export function buildSystemPrompt(context: string): string {
  const STATIC_BLOCKS = `# BLOCK 1 — IDENTITY

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
2. **Actions directes** : créer, modifier, commenter → exécute immédiatement sans demander confirmation
3. **Actions destructives** (suppression) → demande confirmation avant
4. **Bulk updates** → liste les changements AVANT d'exécuter
5. **Cite les display_id** (ex: HLM-42) quand tu mentionnes des issues
6. **Pour update/bulk** → utilise l'UUID (pas le display_id)
7. **Résolution de projet** : quand l'utilisateur dit un nom ("helmai", "sqare"), matche avec le prefix

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

# BLOCK 3 — COMMUNICATION

- Réponds dans la langue de l'utilisateur (FR si français, EN si anglais)
- Parle comme un tech lead, pas comme un PM corporate
- Concis, actionnable, Markdown. Pas de bullshit, pas de fluff.
- Bullet points > paragraphes
- Métriques concrètes + pourcentages
- \`backticks\` pour les termes techniques
- Flag les blockers et la dette technique proactivement
- Emojis : ✅ done, 🔄 in progress, 📋 todo, 🚨 urgent, ⏸️ backlog, 🐛 bug, ✨ feature`;

  const DYNAMIC_BLOCKS = `# BLOCK 4 — DONNÉES PROJET (DYNAMIQUE)

${context}

# BLOCK 5 — OBJECTIFS ACTUELS

Aide l'utilisateur à être productif. Exécute efficacement. Propose des insights (bottlenecks, priorités mal calibrées). Sois proactif.`;

  return `${STATIC_BLOCKS}\n\n${DYNAMIC_BLOCKS}`;
}

// ─── Types ────────────────────────────────────

export interface AIResponse {
  text: string;
  skillsExecuted: SkillResult[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turnCount: number;
  };
  stateContext: AIStateContext;
}

type ApiClientType = {
  issues: {
    listByProject: (id: string, params?: Record<string, unknown>) => Promise<Issue[]>;
    create: (body: Record<string, unknown>) => Promise<Issue>;
    update: (id: string, body: Record<string, unknown>) => Promise<Issue>;
    delete: (id: string) => Promise<void>;
  };
  comments: {
    create: (issueId: string, body: { content: string; author_name: string }) => Promise<unknown>;
  };
  projects: {
    list: () => Promise<Project[]>;
  };
  milestones: {
    listByProject: (projectId: string) => Promise<Milestone[]>;
    create: (projectId: string, body: { name: string; description?: string; target_date?: string; status?: string }) => Promise<Milestone>;
    update: (id: string, body: Partial<Pick<Milestone, 'name' | 'description' | 'target_date' | 'status'>>) => Promise<Milestone>;
    delete: (id: string) => Promise<void>;
  };
};

// ─── Main Generate Function (Vercel AI SDK) ───

export async function generateAIResponse(
  userMessage: string,
  projects: Project[],
  allIssuesByProject: Record<string, Issue[]>,
  conversationHistory: { role: string; content: string }[],
  apiClient: ApiClientType,
  stateContext?: AIStateContext,
  authToken?: string,
): Promise<AIResponse> {
  // ── Rate Limiting ──
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    throw new RateLimitError();
  }

  // ── State Machine: init or use provided ──
  let state = stateContext ? { ...stateContext } : createInitialState();
  state = transition(state, { type: 'USER_MESSAGE', tokens: estimateTokens(userMessage) });

  // ── Budget check ──
  const budget = checkBudget(state);
  if (!budget.ok) {
    return {
      text: `⚠️ ${budget.warning}`,
      skillsExecuted: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, turnCount: state.usage.turnCount },
      stateContext: state,
    };
  }

  // ── Get API key & create provider ──
  const apiKey = await getGeminiApiKey(authToken);
  const google = createGoogleGenerativeAI({ apiKey });

  // ── Build context & prompt ──
  const context = buildProjectContext(projects, allIssuesByProject);
  const systemPrompt = buildSystemPrompt(context);

  // ── Conversation summarization ──
  const optimizedHistory = summarizeHistory(conversationHistory);

  // ── Build messages ──
  const messages: CoreMessage[] = optimizedHistory.slice(-8).map((m) => ({
    role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }));
  messages.push({ role: 'user', content: userMessage });

  // ── Tool masking from state ──
  const skillContext = stateToSkillContext(state);
  const skillsExecuted: SkillResult[] = [];

  // Deterministic PM full-review mode (no Gemini tool-calling)
  // Trigger for milestone/sprint planning prompts to bypass current provider schema instability.
  const lowerPrompt = userMessage.toLowerCase();
  const wantsPmFullReview =
    (lowerPrompt.includes('plan') || lowerPrompt.includes('analyze') || lowerPrompt.includes('analyse')) &&
    (lowerPrompt.includes('milestone') || lowerPrompt.includes('jalon')) &&
    lowerPrompt.includes('sprint');

  if (wantsPmFullReview) {
    const allIssues = Object.values(allIssuesByProject).flat();
    const openIssues = allIssues.filter((i: any) => !['done', 'cancelled'].includes(i.status));
    const now = new Date();

    const urgent = openIssues.filter((i: any) => i.priority === 'urgent');
    const inProgress = openIssues.filter((i: any) => i.status === 'in_progress');
    const review = openIssues.filter((i: any) => i.status === 'in_review');
    const backlog = openIssues.filter((i: any) => ['backlog', 'todo'].includes(i.status));

    const next = (d: number) => {
      const x = new Date(now);
      x.setDate(x.getDate() + d);
      return x.toISOString().slice(0, 10);
    };

    const lines: string[] = [
      '## PM Full Review (deterministic fallback)',
      `- Projects: ${projects.length}`,
      `- Open tickets: ${openIssues.length}`,
      `- Urgent: ${urgent.length} | In progress: ${inProgress.length} | In review: ${review.length} | Backlog/Todo: ${backlog.length}`,
      '',
      '## Proposed Milestones',
      `1) Stabilization & Hotfixes (target ${next(7)}) — focus urgent + blockers`,
      `2) Active Delivery (target ${next(21)}) — close in_progress + in_review`,
      `3) Backlog Acceleration (target ${next(42)}) — top priority backlog/todo`,
      '',
      '## Suggested Sprint Allocation',
      `- Sprint 1 (now → ${next(14)}): urgent + oldest in_progress`,
      `- Sprint 2 (${next(14)} → ${next(28)}): remaining active + critical backlog`,
      `- Sprint 3 (${next(28)} → ${next(42)}): feature backlog + polish`,
      '',
      '## Priority Recommendations',
      '- Keep all production-impact bugs as urgent/high until resolved',
      '- Promote stale in_progress (>7 days) to high and assign explicit owner',
      '- Split oversized backlog items into sub-issues before sprint planning',
      '',
      'If you want, I can now generate a project-by-project mapping (issue IDs grouped under each milestone).',
    ];

    const text = lines.join('\n');
    const outputTokens = estimateTokens(text);
    const inputTokens = estimateTokens(userMessage);
    state = transition(state, { type: 'AI_RESPONSE', tokens: outputTokens });

    return {
      text,
      skillsExecuted,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        turnCount: state.usage.turnCount,
      },
      stateContext: state,
    };
  }

  // ── Build tools with executor bridge ──
  const executor = async (name: string, args: Record<string, unknown>) => {
    state = transition(state, { type: 'SKILL_STARTED', name });
    const startTime = performance.now();

    try {
      const result = await executeSkill(name, args, apiClient, allIssuesByProject, projects);
      const executionTime = Math.round(performance.now() - startTime);
      const enriched = { ...result, executionTimeMs: executionTime };
      skillsExecuted.push(enriched);

      if (result.success) {
        state = transition(state, { type: 'SKILL_COMPLETED', name, data: result.data });
      } else {
        console.warn('[AI][SkillFailed]', { name, args, error: result.error, summary: result.summary });
        state = transition(state, { type: 'SKILL_FAILED', name, error: result.error || 'Unknown error' });
      }

      return result.data || { success: result.success, error: result.error };
    } catch (error) {
      const executionTime = Math.round(performance.now() - startTime);
      console.error('[AI][SkillCrash]', {
        name,
        args,
        executionTimeMs: executionTime,
        error: error instanceof Error ? error.message : String(error),
      });

      const friendly = mapProviderErrorToUserMessage(error);
      const fallbackResult: SkillResult = {
        skill: name,
        success: false,
        error: friendly,
        summary: `${name} failed safely`,
      };
      skillsExecuted.push({ ...fallbackResult, executionTimeMs: executionTime } as any);
      state = transition(state, { type: 'SKILL_FAILED', name, error: friendly });
      return { success: false, error: friendly };
    }
  };

  const tools = buildAISDKTools(skillContext, executor);

  try {
    // ── Vercel AI SDK: generateText with tools + maxSteps ──
    // maxSteps = 5 → agentic loop (same as our old 5-round loop)
    // The SDK handles: tool call → execute → feed result → get next response
    const result = await generateText({
      model: google('gemini-2.0-flash', {
        // Disable structuredOutputs to avoid strict schema validation issues
        // with Gemini API's OBJECT type requirements
        structuredOutputs: false,
      }),
      system: systemPrompt,
      messages,
      tools,
      maxSteps: 5,
      temperature: 0.4,
      maxTokens: 2000,
    });

    // ── Track usage from response metadata ──
    const usage = result.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const inputTokens = usage.promptTokens || estimateTokens(systemPrompt + userMessage);
    const outputTokens = usage.completionTokens || estimateTokens(result.text || '');

    state = transition(state, { type: 'AI_RESPONSE', tokens: outputTokens });

    return {
      text: result.text || "Je n'ai pas pu générer de réponse. Réessaie avec plus de détails.",
      skillsExecuted,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        turnCount: state.usage.turnCount,
      },
      stateContext: state,
    };
  } catch (err: any) {
    state = transition(state, { type: 'ERROR', error: String(err) });

    const msg = err?.message || String(err);
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      throw new RateLimitError();
    }

    // Gemini function-calling can fail on schema validation in some deployments.
    // Fail soft with a NO-TOOLS fallback that still produces actionable PM output.
    const lowerMsg = msg.toLowerCase();
    const isToolSchemaError =
      (lowerMsg.includes('schema') && lowerMsg.includes('function')) ||
      lowerMsg.includes('functiondeclaration') ||
      lowerMsg.includes('parameters schema should be of type object') ||
      lowerMsg.includes('tool schema mismatch');

    if (isToolSchemaError) {
      console.warn('[AI][GenerateTextFallbackNoTools]', {
        reason: 'tool schema mismatch',
        skillContext,
        message: msg,
      });

      try {
        const [metricsResult, prioritiesResult] = await Promise.all([
          executeSkill('get_project_metrics', {}, apiClient, allIssuesByProject, projects),
          executeSkill('suggest_priorities', {}, apiClient, allIssuesByProject, projects),
        ]);

        // Hard fallback: DO NOT call Gemini again.
        // Build a deterministic PM review from live metrics so user always gets output.
        const m: any = metricsResult?.data || {};
        const p: any = prioritiesResult?.data || {};
        const projectCount = Array.isArray(m.projects) ? m.projects.length : (m.project_count ?? 0);
        const openCount = m.open_issues ?? m.openCount ?? 0;
        const doneCount = m.done_issues ?? m.doneCount ?? 0;
        const completion = m.completion_rate ?? m.completionRate ?? null;
        const suggestions = Array.isArray(p.suggestions) ? p.suggestions : [];

        const lines: string[] = [
          '⚠️ AI function-calling indisponible temporairement — mode fallback activé.',
          '',
          '## Revue PM (fallback live data)',
          `- Projets analysés: ${projectCount}`,
          `- Tickets ouverts: ${openCount}`,
          `- Tickets terminés: ${doneCount}`,
          completion != null ? `- Taux de completion: ${completion}%` : '- Taux de completion: n/a',
          '',
          '## Priorités suggérées',
        ];

        if (suggestions.length === 0) {
          lines.push('- Aucune suggestion automatique disponible.');
        } else {
          for (const s of suggestions.slice(0, 10)) {
            if (typeof s === 'string') lines.push(`- ${s}`);
            else lines.push(`- ${s.title || s.issue || 'Issue'} → ${s.priority || 'review'}`);
          }
        }

        lines.push('', '## Next', '- Rafraîchir la session puis relancer pour plan milestones/sprints détaillé.');

        const text = lines.join('\n');
        const outputTokens = estimateTokens(text);
        const inputTokens = estimateTokens(userMessage);

        state = transition(state, { type: 'AI_RESPONSE', tokens: outputTokens });

        return {
          text,
          skillsExecuted,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            turnCount: state.usage.turnCount,
          },
          stateContext: state,
        };
      } catch (retryErr: any) {
        console.error('[AI][GenerateTextRetryFailed]', {
          message: retryErr?.message || String(retryErr),
          skillContext,
        });
      }
    }

    const friendly = mapProviderErrorToUserMessage(err);
    console.error('[AI][GenerateTextFailed]', {
      message: msg,
      friendly,
      skillContext,
      skillCount: Object.keys(tools).length,
    });

    throw new Error(friendly);
  }
}
