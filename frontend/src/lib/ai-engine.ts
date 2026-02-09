/**
 * Baaton AI Engine — connects to project data and Gemini for intelligent responses.
 * Fetches real issues from the Baaton API, builds context, calls Gemini Flash.
 */

import type { Issue, Project } from './types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

interface ProjectContext {
  project: Project;
  issues: Issue[];
  statusCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  recentActivity: Issue[];
  blockers: Issue[];
}

function buildProjectContext(project: Project, issues: Issue[]): ProjectContext {
  const statusCounts: Record<string, number> = {};
  const priorityCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};

  for (const issue of issues) {
    statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
    if (issue.priority) {
      priorityCounts[issue.priority] = (priorityCounts[issue.priority] || 0) + 1;
    }
    for (const cat of issue.category || []) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }

  // Recent: sorted by updated_at desc
  const recentActivity = [...issues]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 10);

  // Blockers: urgent/high priority + in_progress or todo
  const blockers = issues.filter(
    (i) =>
      (i.priority === 'urgent' || i.priority === 'high') &&
      (i.status === 'todo' || i.status === 'in_progress'),
  );

  return { project, issues, statusCounts, priorityCounts, categoryCounts, recentActivity, blockers };
}

function formatContextForLLM(ctx: ProjectContext): string {
  const lines: string[] = [];

  lines.push(`# Project: ${ctx.project.name} (${ctx.project.prefix})`);
  lines.push(`Total issues: ${ctx.issues.length}`);
  lines.push('');

  // Status breakdown
  lines.push('## Status breakdown:');
  for (const [status, count] of Object.entries(ctx.statusCounts)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push('');

  // Priority breakdown
  if (Object.keys(ctx.priorityCounts).length > 0) {
    lines.push('## Priority breakdown:');
    for (const [priority, count] of Object.entries(ctx.priorityCounts)) {
      lines.push(`- ${priority}: ${count}`);
    }
    lines.push('');
  }

  // Category breakdown
  if (Object.keys(ctx.categoryCounts).length > 0) {
    lines.push('## Category (Type) breakdown:');
    for (const [cat, count] of Object.entries(ctx.categoryCounts)) {
      lines.push(`- ${cat}: ${count}`);
    }
    lines.push('');
  }

  // Urgent/high items
  if (ctx.blockers.length > 0) {
    lines.push('## Urgent/High priority items (potential blockers):');
    for (const b of ctx.blockers.slice(0, 15)) {
      lines.push(`- [${b.display_id}] ${b.title} (${b.status}, ${b.priority})`);
    }
    lines.push('');
  }

  // Todo items
  const todoItems = ctx.issues.filter((i) => i.status === 'todo');
  if (todoItems.length > 0) {
    lines.push(`## Todo items (${todoItems.length}):`);
    for (const t of todoItems.slice(0, 20)) {
      const prio = t.priority ? ` [${t.priority}]` : '';
      const cats = (t.category || []).length > 0 ? ` {${(t.category || []).join(',')}}` : '';
      const tags = t.tags.length > 0 ? ` [${t.tags.join(',')}]` : '';
      lines.push(`- [${t.display_id}] ${t.title}${prio}${cats}${tags}`);
    }
    lines.push('');
  }

  // In progress items
  const inProgress = ctx.issues.filter((i) => i.status === 'in_progress');
  if (inProgress.length > 0) {
    lines.push(`## In Progress items (${inProgress.length}):`);
    for (const ip of inProgress.slice(0, 15)) {
      const prio = ip.priority ? ` [${ip.priority}]` : '';
      lines.push(`- [${ip.display_id}] ${ip.title}${prio}`);
    }
    lines.push('');
  }

  // Done items (last 10)
  const doneItems = ctx.issues
    .filter((i) => i.status === 'done')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  if (doneItems.length > 0) {
    lines.push(`## Recently completed (${doneItems.length} total, showing last 10):`);
    for (const d of doneItems.slice(0, 10)) {
      lines.push(`- [${d.display_id}] ${d.title}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function callGemini(systemPrompt: string, userMessage: string, conversationHistory: { role: string; content: string }[]): Promise<string> {
  // Build contents array with conversation history
  const contents: { role: string; parts: { text: string }[] }[] = [];

  // Add history (last 6 messages for context)
  for (const msg of conversationHistory.slice(-6)) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    });
  }

  // Add current message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1500,
      topP: 0.95,
    },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Gemini API error:', errText);
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');
  return text;
}

export async function generateAIResponse(
  userMessage: string,
  projects: Project[],
  allIssuesByProject: Record<string, Issue[]>,
  conversationHistory: { role: string; content: string }[],
): Promise<string> {
  // Build context for all projects
  const projectContexts: string[] = [];

  for (const project of projects) {
    const issues = allIssuesByProject[project.id] || [];
    if (issues.length === 0) continue;
    const ctx = buildProjectContext(project, issues);
    projectContexts.push(formatContextForLLM(ctx));
  }

  const fullContext = projectContexts.join('\n---\n\n');

  const systemPrompt = `Tu es Baaton AI, l'assistant intelligent du board de gestion de projets Baaton.
Tu as accès aux données en temps réel de tous les projets et issues.

Ton rôle :
- Répondre aux questions sur l'avancement des projets
- Faire des résumés clairs et actionnables
- Identifier les blockers et suggérer des repriorisations
- Aider à organiser le travail et les sprints
- Donner des insights sur la vélocité et la charge de travail

Règles :
- Réponds en français si la question est en français, sinon en anglais
- Utilise le markdown pour structurer tes réponses (headers, listes, bold)
- Cite les IDs des issues quand tu les mentionnes (ex: HLM-42)
- Sois concis mais complet
- Si tu ne sais pas, dis-le honnêtement
- Donne des recommandations concrètes, pas vagues

Voici les données actuelles des projets :

${fullContext}`;

  return callGemini(systemPrompt, userMessage, conversationHistory);
}
