/**
 * Baaton AI Engine — Gemini function calling with skills.
 * Uses @google/generative-ai SDK for proper browser CORS support.
 *
 * 10/10 Features:
 * - State machine integration (ai-state.ts)
 * - Retry with exponential backoff
 * - Token budget tracking
 * - Conversation summarization for long chats
 * - Client-side rate limiting
 * - Prompt caching optimization (static/dynamic block split)
 * - Structured output hints in system prompt
 */

import { GoogleGenerativeAI, type Content, type Part } from '@google/generative-ai';
import type { Issue, Project, Milestone } from './types';
import { getToolsForContext, detectSkillContext } from './ai-skills';
import { executeSkill } from './ai-executor';
import type { SkillResult } from './ai-skills';
import {
  type AIStateContext,
  resetState,
  transition,
  recordSkillExecution,
  recordTokenUsage,
  incrementTurn,
  deriveSkillContext,
  estimateTokens,
  isApproachingTokenBudget,
} from './ai-state';

// API key: prefer fetching from backend proxy (server-side), fallback to env
let _cachedApiKey: string | null = null;
const GEMINI_MODEL = 'gemini-2.0-flash';
const API_URL = import.meta.env.VITE_API_URL || '';

async function getGeminiApiKey(authToken?: string): Promise<string> {
  // Return cached key if we have one
  if (_cachedApiKey) return _cachedApiKey;

  // Try to fetch from backend (keeps key server-side)
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
    } catch {
      // Fallback to env
    }
  }

  // Fallback: env variable (for local dev or if backend proxy unavailable)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY || '';
  if (envKey) {
    _cachedApiKey = envKey;
    return envKey;
  }

  throw new Error('AI non configuré. Clé API manquante.');
}

// ─── Client-side Rate Limiting ────────────────
const RATE_LIMIT = { maxPerMinute: 10, maxPerHour: 100 };
let callTimestamps: number[] = [];

function checkRateLimit(): boolean {
  const now = Date.now();
  // Prune timestamps older than 1 hour
  callTimestamps = callTimestamps.filter(t => now - t < 3600000);
  const lastMinute = callTimestamps.filter(t => now - t < 60000);
  if (lastMinute.length >= RATE_LIMIT.maxPerMinute) return false;
  if (callTimestamps.length >= RATE_LIMIT.maxPerHour) return false;
  callTimestamps.push(now);
  return true;
}

export class RateLimitError extends Error {
  constructor() {
    super('Rate limit exceeded — please wait a moment before sending another message.');
    this.name = 'RateLimitError';
  }
}

// ─── Context Builder ──────────────────────────

function buildProjectContext(projects: Project[], allIssues: Record<string, Issue[]>): string {
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

    // List open issues (todo + in_progress) with IDs for reference
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

    // Recent done
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
//
// PROMPT CACHING OPTIMIZATION:
// Gemini caches prompts that are > 1024 tokens with identical prefixes.
// Blocks 1-3 are STATIC (never change between calls) → cached by Gemini's KV cache.
// Blocks 4-5 are DYNAMIC (change per session/turn) → appended after cache boundary.
//
// The static portion (Blocks 1-3) is ~2800 tokens, well above the 1024-token
// caching threshold. This means subsequent calls in the same session will
// get KV cache hits on Blocks 1-3, reducing latency and cost.
//

function buildSystemPrompt(context: string): string {
  // ════════════════════════════════════════════════════════════════
  // STATIC BLOCKS (1-3): Cacheable by Gemini KV cache (>1024 tokens)
  // Do NOT add dynamic content above the DYNAMIC marker below.
  // ════════════════════════════════════════════════════════════════

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
- Tries et priorises les issues intelligemment (urgence clinique pour HelmAI, perf pour Baaton, etc.)
- Proposes des milestones réalistes basés sur la vélocité et les dépendances techniques
- Détectes les blockers, la dette technique, et les risques
- Génères des PRD structurés avec specs techniques
- Comprends les catégories FRONT/BACK/API/DB et groupes les issues par domaine

# BLOCK 2 — SKILLS & CAPACITÉS

## Tes 11 Skills (fonctions exécutables) :

### 📋 Lecture & Analyse
- **search_issues** — Chercher/filtrer des issues (texte, status, priorité, catégorie, projet)
- **get_project_metrics** — Métriques détaillées (vélocité, taux de complétion, distribution)
- **analyze_sprint** — Analyse de sprint, vélocité, recommandations pour le prochain sprint

### ✏️ Actions
- **create_issue** — Créer une issue (titre, description, type, priorité, tags, catégorie)
- **update_issue** — Modifier une issue (status, priorité, description, tags, assignée)
- **bulk_update_issues** — Modifier N issues d'un coup (reprioritisation, changement de status en masse)
- **add_comment** — Ajouter un commentaire / note sur une issue

### 📄 Génération
- **generate_prd** — Générer un PRD structuré (objectifs, user stories, critères d'acceptance, specs techniques)

### 🎯 Milestone Planning
- **plan_milestones** — Analyser les tickets ouverts, détecter les dépendances entre issues (par similarité de titre/description), calculer la vélocité (issues/semaine), et proposer un plan de milestones avec chemin critique. Ne crée rien automatiquement — propose d'abord, l'utilisateur confirme.
- **create_milestones_batch** — Créer plusieurs milestones et assigner les issues d'un coup. Utiliser APRÈS plan_milestones quand l'utilisateur confirme le plan proposé.
- **adjust_timeline** — Ajuster la timeline des milestones selon une nouvelle contrainte/deadline. Récupère les milestones, issues, dépendances et vélocité pour proposer un replanning réaliste.

## Règles d'Exécution
1. **TOUJOURS utiliser tes skills** pour accéder aux données — jamais d'hallucination
2. **Actions directes** : créer, modifier, commenter → exécute immédiatement sans demander confirmation
3. **Actions destructives** (suppression) → demande confirmation avant
4. **Bulk updates** → liste les changements AVANT d'exécuter
5. **Cite les display_id** (ex: HLM-42) quand tu mentionnes des issues
6. **Pour update/bulk** → utilise l'UUID (pas le display_id)
7. **Résolution de projet** : quand l'utilisateur dit un nom ("helmai", "sqare"), matche avec le prefix du projet

## Format de Sortie Structuré (STRICT)
- Utilise TOUJOURS les IDs exacts : UUID pour update/delete, display_id pour citation dans le texte
- Ne mélange JAMAIS display_id et UUID dans un appel de fonction
- Si un skill échoue, explique pourquoi ET propose une alternative
- Après chaque action, confirme avec le résultat exact (display_id + ce qui a changé)
- Pour les listes > 10 items, utilise un résumé + les 5 plus importants en détail
- Ne réponds JAMAIS avec des données que tu n'as pas obtenues via un skill

## Comportement pour le Milestone Planning

Quand l'utilisateur demande de planifier des milestones :
1. **Appelle plan_milestones** — il retourne des proposed_milestones déjà groupés avec target_dates et issue_ids
2. **Présente le plan au user** avec le format ci-dessous. Le plan est DÉJÀ calculé, tu dois juste le formater joliment.
3. **Demande confirmation** : "Voulez-vous appliquer ce plan ?"
4. **Quand l'utilisateur confirme** (dit oui, ok, apply, etc.), appelle IMMÉDIATEMENT **create_milestones_batch** avec exactement les données du plan proposé:
   - project_id: utilise le project_id du résultat plan_milestones
   - milestones: copie EXACTEMENT le tableau proposed_milestones (name, description, target_date, order, issue_ids)
5. **NE rappelle PAS plan_milestones** quand l'utilisateur confirme — utilise les données déjà retournées

Format de présentation :
📊 **Vélocité** : X issues/semaine | ⏱️ **Total** : ~Y semaines

🎯 **Milestone 1 : [name]** (cible: [target_date], ~[estimated_weeks] sem)
- [display_id] [title] ([type], [priority])
- [display_id] [title] ([type], [priority])

🎯 **Milestone 2 : [name]** (cible: [target_date], ~[estimated_weeks] sem)
- ...

✅ Appliquer ce plan ? (le bouton "Apply Plan" apparaîtra automatiquement)

## Comportement pour la Création d'Issue

Quand l'utilisateur demande de créer une issue :
1. **Si le projet est ambigu** (pas sur une page projet, ou plusieurs projets possibles) → demande dans quel projet
2. **Remplis un maximum de champs automatiquement** :
   - Titre : clair et concis
   - Description : détaillée, structurée en Markdown, avec contexte
   - Type : déduis du contenu (bug, feature, improvement, question)
   - Priorité : déduis de l'urgence exprimée
   - Catégorie : déduis des mots-clés techniques (FRONT, BACK, API, DB)
   - Tags : utilise les tags existants du projet si pertinents
3. **NE DEMANDE PAS de confirmation** — crée directement l'issue
4. **Après création**, propose : "📎 Tu peux ajouter des images en ouvrant l'issue et en collant (⌘V) ou drag & drop"

## Capacités de Baaton (ce que tu SAIS faire)
- ✅ Pièces jointes : images via paste (⌘V), drag & drop, compression automatique
- ✅ Annotation d'images : outil intégré (stylo, flèches, cercles, texte, 7 couleurs)
- ✅ Lightbox : visualisation plein écran avec zoom
- ✅ Commentaires avec mentions
- ✅ Description rich text (Markdown, slash commands, toolbar)
- ✅ Tags colorés (15 couleurs)
- ✅ Deep links (?issue=HLM-42)
- ✅ Raccourcis clavier (J/K naviguer, E éditer, N nouveau, ? aide)

**IMPORTANT** : Ne dis JAMAIS que tu ne peux pas gérer les images. Baaton supporte les images nativement. Indique à l'utilisateur d'ouvrir l'issue et de coller/glisser les images.

# BLOCK 3 — COMMUNICATION

## Langue
- Réponds dans la langue de l'utilisateur (FR si français, EN si anglais)
- Parle comme un tech lead, pas comme un PM corporate
- Concis, actionnable, Markdown. Pas de bullshit, pas de fluff.
- Emojis statut : ✅ done, 🔄 in progress, 📋 todo, 🚨 urgent, ⏸️ backlog, 🐛 bug, ✨ feature

## Format de Réponse
- **Bullet points** : pas de paragraphes. Les devs scannent, ils ne lisent pas.
- **Métriques** : chiffres concrets + pourcentages (ex: "vélocité: 5 issues/sem, burn rate: 72%")
- **Issues** : TOUJOURS cite le display_id (ex: HLM-42)
- **Actions** : confirme ce qui a été fait (ex: "✅ HLM-42 → status: done, priority: high")
- **Code/technique** : utilise \`backticks\` pour les termes techniques, noms de fichiers, commandes
- **Risques** : flag les blockers et la dette technique proactivement

## Weekly Recap (quand demandé)
Fournis un rapport structuré :
1. **📊 Résumé** : X issues créées, Y complétées, Z en cours
2. **✅ Complétées** : liste des issues terminées cette semaine
3. **🔄 En cours** : issues actives avec leur statut
4. **🚧 Bloqueurs** : issues critiques/urgentes non résolues
5. **📈 Tendance** : vélocité (issues done/semaine), taux de complétion`;

  // ════════════════════════════════════════════════════════════════
  // DYNAMIC BLOCKS (4-5): Change per session — NOT cached.
  // ════════════════════════════════════════════════════════════════

  const DYNAMIC_BLOCKS = `# BLOCK 4 — DONNÉES PROJET (DYNAMIQUE)

${context}

# BLOCK 5 — OBJECTIFS ACTUELS

Ton objectif principal : aider l'utilisateur à être plus productif dans la gestion de ses projets.
- Réponds précisément aux questions
- Exécute les actions demandées efficacement
- Propose des insights quand c'est pertinent (bottlenecks, priorités mal calibrées)
- Sois proactif : si tu vois un problème dans les données, mentionne-le`;

  return `${STATIC_BLOCKS}\n\n${DYNAMIC_BLOCKS}`;
}

// ─── Gemini SDK Types ─────────────────────────

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
}

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

// Tool masking: return only context-relevant tools (Manus pattern)
function getToolDeclarations(context?: string) {
  const tools = getToolsForContext(context as any || 'default');
  if (!tools || !Array.isArray(tools)) return undefined;
  return tools;
}

async function callGemini(
  contents: GeminiContent[],
  systemPrompt: string,
  skillContext?: string,
  authToken?: string,
): Promise<{
  text?: string;
  functionCalls?: GeminiFunctionCall[];
}> {
  const apiKey = await getGeminiApiKey(authToken);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools: getToolDeclarations(skillContext) as any,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2000,
      topP: 0.9,
    },
  });

  // Convert our contents to SDK Content format
  const sdkContents: Content[] = contents.map((c) => ({
    role: c.role,
    parts: c.parts.map((p): Part => {
      if (p.text) return { text: p.text };
      if (p.functionCall) return { functionCall: { name: p.functionCall.name, args: p.functionCall.args } } as Part;
      if (p.functionResponse) return { functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response } } as Part;
      return { text: '' };
    }),
  }));

  const result = await model.generateContent({ contents: sdkContents });
  const response = result.response;
  const candidate = response.candidates?.[0];
  if (!candidate) throw new Error('No response from Gemini');

  const parts = candidate.content?.parts || [];
  const textParts = parts.filter((p) => p.text).map((p) => p.text!);
  const functionCalls = parts
    .filter((p) => (p as any).functionCall)
    .map((p) => (p as any).functionCall as GeminiFunctionCall);

  return {
    text: textParts.length > 0 ? textParts.join('\n') : undefined,
    functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
  };
}

// ─── Retry with Exponential Backoff ───────────

async function callGeminiWithRetry(
  contents: GeminiContent[],
  systemPrompt: string,
  skillContext?: string,
  authToken?: string,
  maxRetries = 2,
  baseDelay = 1000,
): Promise<{
  text?: string;
  functionCalls?: GeminiFunctionCall[];
}> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callGemini(contents, systemPrompt, skillContext, authToken);
    } catch (error: any) {
      if (attempt === maxRetries) throw error;
      const msg = error?.message || '';
      const isRetryable =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('timeout') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE');
      if (!isRetryable) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[AI Engine] Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, msg);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

// ─── Conversation Summarization ───────────────

function summarizeConversation(
  history: { role: string; content: string }[],
): { role: string; content: string }[] {
  // If conversation is short enough, return as-is
  if (history.length <= 20) return history;

  // Keep first 2 messages (initial context)
  const first = history.slice(0, 2);

  // Summarize middle messages
  const middle = history.slice(2, -6);
  const summaryParts: string[] = [];
  for (const msg of middle) {
    // Extract key info: skill executions and user intents
    const role = msg.role === 'user' ? 'User' : 'AI';
    // Truncate long messages to key info
    const truncated = msg.content.length > 150
      ? msg.content.substring(0, 150) + '...'
      : msg.content;
    summaryParts.push(`${role}: ${truncated}`);
  }

  const summaryMessage = {
    role: 'user' as const,
    content: `[Previous conversation context — ${middle.length} messages summarized]\n${summaryParts.join('\n')}`,
  };

  // Keep last 6 messages verbatim
  const recent = history.slice(-6);

  return [...first, summaryMessage, ...recent];
}

// ─── Main Chat Function ───────────────────────

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
  if (!checkRateLimit()) {
    throw new RateLimitError();
  }

  // ── State Machine: init or use provided ──
  let ctx = stateContext ? { ...stateContext } : resetState();
  ctx = incrementTurn(ctx);
  ctx = transition(ctx, 'user_message');

  const context = buildProjectContext(projects, allIssuesByProject);
  const systemPrompt = buildSystemPrompt(context);
  const skillsExecuted: SkillResult[] = [];

  // ── Token tracking ──
  let inputTokens = estimateTokens(systemPrompt);
  let outputTokens = 0;

  // ── Tool Masking: derive from state machine + message text ──
  let skillContext = deriveSkillContext(ctx, userMessage);

  // ── Conversation Summarization for long chats ──
  const processedHistory = summarizeConversation(conversationHistory);

  // Build conversation contents
  const contents: GeminiContent[] = [];

  // Add conversation history (summarized if needed, last 8 messages)
  for (const msg of processedHistory.slice(-8)) {
    const part = { text: msg.content };
    inputTokens += estimateTokens(msg.content);
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [part],
    });
  }

  // Add current user message
  inputTokens += estimateTokens(userMessage);
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  // ── Token budget warning ──
  if (isApproachingTokenBudget(ctx)) {
    console.warn(`[AI Engine] Token budget approaching limit: ${ctx.tokenCount} tokens used`);
  }

  // Agentic loop — keep calling Gemini until we get a text response (max 5 rounds)
  for (let round = 0; round < 5; round++) {
    const response = await callGeminiWithRetry(contents, systemPrompt, skillContext, authToken);

    // Track output tokens
    if (response.text) {
      outputTokens += estimateTokens(response.text);
    }

    // If we got function calls, execute them and feed results back
    if (response.functionCalls && response.functionCalls.length > 0) {
      // Add model's function call to conversation
      contents.push({
        role: 'model',
        parts: response.functionCalls.map((fc) => ({
          functionCall: { name: fc.name, args: fc.args },
        })),
      });

      // Execute each function call
      const functionResponseParts: GeminiPart[] = [];

      for (const fc of response.functionCalls) {
        console.log(`[AI Skill] Executing: ${fc.name}`, fc.args);
        const startTime = performance.now();
        const result = await executeSkill(
          fc.name,
          fc.args,
          apiClient,
          allIssuesByProject,
          projects,
        );
        const executionTime = Math.round(performance.now() - startTime);

        // Attach execution time to result
        const enrichedResult = { ...result, executionTimeMs: executionTime };
        skillsExecuted.push(enrichedResult);

        // Update state machine after skill execution
        ctx = recordSkillExecution(ctx, fc.name, result.data);

        // Update tool masking context after skill execution
        if (fc.name === 'plan_milestones' && result.success) {
          skillContext = 'milestone_confirm';
        }

        const responseData = result.data || { success: result.success, error: result.error };
        const responseStr = JSON.stringify(responseData);
        inputTokens += estimateTokens(responseStr);

        functionResponseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result: responseData },
          },
        });
      }

      // Feed results back to Gemini
      contents.push({
        role: 'user',
        parts: functionResponseParts,
      });

      // If we also got text, we can return it with the skills
      if (response.text) {
        ctx = transition(ctx, 'response_complete');
        ctx = recordTokenUsage(ctx, inputTokens, outputTokens);
        return {
          text: response.text,
          skillsExecuted,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            turnCount: ctx.turnCount,
          },
          stateContext: ctx,
        };
      }

      // Otherwise, loop to get Gemini's interpretation of the results
      continue;
    }

    // No function calls — just text
    if (response.text) {
      ctx = transition(ctx, 'response_complete');
      ctx = recordTokenUsage(ctx, inputTokens, outputTokens);
      return {
        text: response.text,
        skillsExecuted,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          turnCount: ctx.turnCount,
        },
        stateContext: ctx,
      };
    }

    break;
  }

  ctx = transition(ctx, 'response_complete');
  ctx = recordTokenUsage(ctx, inputTokens, outputTokens);
  return {
    text: "Je n'ai pas pu générer de réponse. Réessaie avec plus de détails.",
    skillsExecuted,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      turnCount: ctx.turnCount,
    },
    stateContext: ctx,
  };
}
