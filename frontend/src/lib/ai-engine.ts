/**
 * Baaton AI Engine — Gemini function calling with skills.
 * The AI reads real project data and can execute actions via skills.
 */

import type { Issue, Project } from './types';
import { SKILL_TOOLS } from './ai-skills';
import { executeSkill } from './ai-executor';
import type { SkillResult } from './ai-skills';

const API_URL = import.meta.env.VITE_API_URL || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
// Use backend proxy to keep API key server-side. Fallback to direct Gemini if no backend.
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const USE_PROXY = !!API_URL;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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

// ─── System Prompt ────────────────────────────

function buildSystemPrompt(context: string): string {
  return `Tu es **Baaton AI**, un agent intelligent intégré dans le board de gestion de projets Baaton.
Tu as accès aux données en temps réel ET tu peux **exécuter des actions** via tes skills.

## Tes Skills (fonctions disponibles) :
- **search_issues** — Chercher/filtrer des issues
- **create_issue** — Créer une nouvelle issue
- **update_issue** — Modifier une issue (status, priority, tags, etc.)
- **bulk_update_issues** — Modifier plusieurs issues d'un coup
- **add_comment** — Ajouter un commentaire
- **generate_prd** — Générer un PRD structuré
- **analyze_sprint** — Analyser la vélocité et planifier un sprint
- **get_project_metrics** — Obtenir les métriques détaillées

## Règles :
- Réponds en français si la question est en français
- Utilise TOUJOURS tes skills pour accéder aux données — ne te base pas que sur le contexte statique
- Pour les actions (création, modification), **exécute directement** sauf si c'est destructif (suppression)
- Cite les display_id (ex: HLM-42) quand tu mentionnes des issues
- Quand tu crées ou modifies, confirme ce qui a été fait
- Pour les bulk updates, liste les changements avant d'exécuter
- Sois concis, actionnable, structuré (Markdown)
- Quand on te donne un nom de projet (ex: "helmai", "sqare"), utilise le prefix pour identifier le bon project_id
- Pour update_issue et bulk_update, utilise l'UUID (pas le display_id)

## Données actuelles :
${context}`;
}

// ─── Gemini API Call with Function Calling ────

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

async function callGemini(
  contents: GeminiContent[],
  systemPrompt: string,
  authToken?: string,
): Promise<{
  text?: string;
  functionCalls?: GeminiFunctionCall[];
}> {
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: SKILL_TOOLS,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2000,
      topP: 0.9,
    },
  };

  let res: Response;

  // Try backend proxy first (keeps API key server-side)
  if (USE_PROXY && authToken) {
    try {
      // Convert Gemini format to simple messages for the proxy
      const messages = contents.map((c) => ({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.parts.map((p) => p.text || JSON.stringify(p.functionCall || p.functionResponse || '')).join('\n'),
      }));

      res = await fetch(`${API_URL}/api/v1/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ messages, model: GEMINI_MODEL }),
      });

      if (res.ok) {
        const data = await res.json();
        return { text: data.content || data.data?.content };
      }
      // If proxy fails, fall through to direct call
      console.warn('AI proxy failed, falling back to direct Gemini call');
    } catch {
      console.warn('AI proxy unavailable, falling back to direct Gemini call');
    }
  }

  // Direct Gemini call (fallback)
  if (!GEMINI_API_KEY) {
    throw new Error('AI non configuré. Contactez l\'administrateur.');
  }

  res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Gemini API error:', errText);
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error('No response from Gemini');

  const parts: GeminiPart[] = candidate.content?.parts || [];

  const textParts = parts.filter((p) => p.text).map((p) => p.text!);
  const functionCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => p.functionCall!);

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
};

export async function generateAIResponse(
  userMessage: string,
  projects: Project[],
  allIssuesByProject: Record<string, Issue[]>,
  conversationHistory: { role: string; content: string }[],
  apiClient: ApiClientType,
  authToken?: string,
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
    const response = await callGemini(contents, systemPrompt, authToken);

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
