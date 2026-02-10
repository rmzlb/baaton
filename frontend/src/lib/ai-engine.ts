/**
 * Baaton AI Engine — Gemini function calling with skills.
 * Uses @google/generative-ai SDK for proper browser CORS support.
 */

import { GoogleGenerativeAI, type Content, type Part } from '@google/generative-ai';
import type { Issue, Project, Milestone } from './types';
import { SKILL_TOOLS } from './ai-skills';
import { executeSkill } from './ai-executor';
import type { SkillResult } from './ai-skills';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

// ─── Context Builder ──────────────────────────

function buildProjectContext(projects: Project[], allIssues: Record<string, Issue[]>): string {
  const lines: string[] = ['# Current Project Data\n'];

  for (const project of projects) {
    const issues = allIssues[project.id] || [];
    if (issues.length === 0) continue;

    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};

    for (const issue of issues) {
      statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
      if (issue.priority) priorityCounts[issue.priority] = (priorityCounts[issue.priority] || 0) + 1;
    }

    lines.push(`## ${project.prefix} — ${project.name} (ID: ${project.id})`);
    lines.push(`Total: ${issues.length} issues`);
    lines.push(`Status: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (Object.keys(priorityCounts).length > 0) {
      lines.push(`Priority: ${Object.entries(priorityCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    // List open issues (todo + in_progress) with IDs for reference
    const open = issues.filter((i) => i.status === 'todo' || i.status === 'in_progress' || i.status === 'in_review');
    if (open.length > 0) {
      lines.push(`\nOpen issues:`);
      for (const i of open.slice(0, 30)) {
        const prio = i.priority ? ` [${i.priority}]` : '';
        const cats = (i.category || []).length > 0 ? ` {${(i.category || []).join(',')}}` : '';
        lines.push(`- ${i.display_id} (uuid:${i.id}) | ${i.status}${prio}${cats} | ${i.title}`);
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
// Block 1: STATIC — Identity & Role (never changes, max KV-cache hits)
// Block 2: STATIC — Skills & Rules
// Block 3: SEMI-STATIC — Communication Rules
// Block 4: DYNAMIC — Project Context (changes per session)
// Block 5: DYNAMIC — Current Goals (completion bias at end)

function buildSystemPrompt(context: string): string {
  return `# BLOCK 1 — IDENTITY

Tu es **Baaton AI**, l'assistant intelligent du board Baaton.
Tu es un PM assistant expert : tu comprends le product management, le développement logiciel, et les méthodologies agile.
Tu as un accès complet aux données en temps réel et peux exécuter des actions.

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

## Comportement pour le Milestone Planning

Quand l'utilisateur demande de planifier des milestones :
1. **Utilise plan_milestones** pour récupérer tous les tickets ouverts
2. **Propose un plan structuré** avec des groupements logiques, des estimations de durée, et un ordre de priorité
3. **NE CRÉE PAS les milestones automatiquement** — présente le plan et demande confirmation
4. **Quand l'utilisateur confirme**, utilise **create_milestones_batch** pour tout créer d'un coup
5. **Pour ajuster un plan existant**, utilise **adjust_timeline** avec la contrainte spécifiée

Format de proposition :
- 🎯 **Milestone 1 : Nom** (cible: date) — X issues
  - Liste des issues avec display_id
- 🎯 **Milestone 2 : Nom** (cible: date) — Y issues
  - etc.

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
- Sois concis, actionnable, structuré (Markdown)
- Utilise des emojis pour les statuts : ✅ done, 🔄 in progress, 📋 todo, 🚨 urgent, ⏸️ backlog

## Format de Réponse
- **Résumé** : bullet points, pas de paragraphes
- **Métriques** : utilise des pourcentages et des chiffres concrets
- **Issues** : cite toujours le display_id (ex: HLM-42)
- **Actions** : confirme ce qui a été fait avec le résultat

## Weekly Recap (quand demandé)
Fournis un rapport structuré :
1. **📊 Résumé** : X issues créées, Y complétées, Z en cours
2. **✅ Complétées** : liste des issues terminées cette semaine
3. **🔄 En cours** : issues actives avec leur statut
4. **🚧 Bloqueurs** : issues critiques/urgentes non résolues
5. **📈 Tendance** : vélocité (issues done/semaine), taux de complétion

# BLOCK 4 — DONNÉES PROJET (DYNAMIQUE)

${context}

# BLOCK 5 — OBJECTIFS ACTUELS

Ton objectif principal : aider l'utilisateur à être plus productif dans la gestion de ses projets.
- Réponds précisément aux questions
- Exécute les actions demandées efficacement
- Propose des insights quand c'est pertinent (bottlenecks, priorités mal calibrées)
- Sois proactif : si tu vois un problème dans les données, mentionne-le`;
}

// ─── Gemini SDK Setup ─────────────────────────

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

// Convert our SKILL_TOOLS format to SDK format
function getToolDeclarations() {
  const tools = SKILL_TOOLS;
  if (!tools || !Array.isArray(tools)) return undefined;
  return tools;
}

async function callGemini(
  contents: GeminiContent[],
  systemPrompt: string,
  _authToken?: string,
): Promise<{
  text?: string;
  functionCalls?: GeminiFunctionCall[];
}> {
  if (!GEMINI_API_KEY) {
    throw new Error('AI non configuré. Clé API manquante.');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools: getToolDeclarations() as any,
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

// ─── Main Chat Function ───────────────────────

export interface AIResponse {
  text: string;
  skillsExecuted: SkillResult[];
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
): Promise<AIResponse> {
  const context = buildProjectContext(projects, allIssuesByProject);
  const systemPrompt = buildSystemPrompt(context);
  const skillsExecuted: SkillResult[] = [];

  // Build conversation contents
  const contents: GeminiContent[] = [];

  // Add conversation history (last 8 messages)
  for (const msg of conversationHistory.slice(-8)) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    });
  }

  // Add current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  // Agentic loop — keep calling Gemini until we get a text response (max 5 rounds)
  for (let round = 0; round < 5; round++) {
    const response = await callGemini(contents, systemPrompt);

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
        const result = await executeSkill(
          fc.name,
          fc.args,
          apiClient,
          allIssuesByProject,
          projects,
        );
        skillsExecuted.push(result);

        functionResponseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result: result.data || { success: result.success, error: result.error } },
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
        return { text: response.text, skillsExecuted };
      }

      // Otherwise, loop to get Gemini's interpretation of the results
      continue;
    }

    // No function calls — just text
    if (response.text) {
      return { text: response.text, skillsExecuted };
    }

    break;
  }

  return {
    text: "Je n'ai pas pu générer de réponse. Réessaie avec plus de détails.",
    skillsExecuted,
  };
}
