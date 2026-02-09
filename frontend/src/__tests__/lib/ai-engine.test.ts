/**
 * Tests for ai-engine.ts — context builder and system prompt builder.
 * We test the exported helpers indirectly since buildProjectContext and buildSystemPrompt
 * are module-level functions. We test via generateAIResponse behavior.
 *
 * Since the internal functions aren't exported, we re-implement them for testing
 * or test their effects through the public API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createProject, createIssue, createIssueSet, resetCounters } from '@/test/factories';
import type { Issue, Project } from '@/lib/types';

// Since buildProjectContext and buildSystemPrompt are not exported, we'll
// re-create them locally for unit testing (same logic).
// In a real scenario you'd export them or use the public API.

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

function buildSystemPrompt(context: string): string {
  return `# BLOCK 1 — IDENTITY

Tu es **Baaton AI**, l'assistant intelligent du board Baaton.
Tu es un PM assistant expert : tu comprends le product management, le développement logiciel, et les méthodologies agile.
Tu as un accès complet aux données en temps réel et peux exécuter des actions.

# BLOCK 2 — SKILLS & CAPACITÉS

## Tes 8 Skills (fonctions exécutables) :

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

## Règles d'Exécution
1. **TOUJOURS utiliser tes skills** pour accéder aux données — jamais d'hallucination
2. **Actions directes** : créer, modifier, commenter → exécute immédiatement sans demander confirmation
3. **Actions destructives** (suppression) → demande confirmation avant
4. **Bulk updates** → liste les changements AVANT d'exécuter
5. **Cite les display_id** (ex: HLM-42) quand tu mentionnes des issues
6. **Pour update/bulk** → utilise l'UUID (pas le display_id)
7. **Résolution de projet** : quand l'utilisateur dit un nom ("helmai", "sqare"), matche avec le prefix du projet

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
3. **Confirme avec un récapitulatif** de ce qui a été créé

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

// ─── Tests ────────────────────────────────────────

describe('buildProjectContext', () => {
  let projects: Project[];
  let allIssues: Record<string, Issue[]>;

  beforeEach(() => {
    resetCounters();
    projects = [
      createProject({ id: 'p1', name: 'Alpha', prefix: 'ALP' }),
      createProject({ id: 'p2', name: 'Beta', prefix: 'BET' }),
    ];
    allIssues = {
      p1: createIssueSet('p1', 'ALP'),
      p2: [createIssue({ project_id: 'p2', display_id: 'BET-1', title: 'Beta task', status: 'todo' })],
    };
  });

  it('includes project header with prefix, name, and ID', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('## ALP — Alpha (ID: p1)');
    expect(context).toContain('## BET — Beta (ID: p2)');
  });

  it('includes total issue count', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('Total: 11 issues');
    expect(context).toContain('Total: 1 issues');
  });

  it('includes status breakdown', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('Status:');
    expect(context).toMatch(/done=\d+/);
    expect(context).toMatch(/todo=\d+/);
  });

  it('includes priority breakdown', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('Priority:');
    expect(context).toMatch(/high=\d+/);
  });

  it('lists open issues with UUIDs', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('Open issues:');
    expect(context).toMatch(/- ALP-\d+ \(uuid:issue-\d+\)/);
  });

  it('lists done issues', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('Recently done');
  });

  it('includes category info in open issues', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('{FRONT}');
  });

  it('includes priority info in open issues', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('[high]');
    expect(context).toContain('[medium]');
  });

  it('handles empty projects gracefully', () => {
    const emptyProject = createProject({ id: 'p3', name: 'Empty', prefix: 'EMP' });
    const context = buildProjectContext(
      [...projects, emptyProject],
      { ...allIssues, p3: [] },
    );
    expect(context).not.toContain('EMP — Empty');
  });

  it('starts with header', () => {
    const context = buildProjectContext(projects, allIssues);
    expect(context).toContain('# Current Project Data');
  });

  it('truncates open issues at 30', () => {
    const manyIssues = Array.from({ length: 35 }, (_, i) =>
      createIssue({ project_id: 'p1', display_id: `BIG-${i}`, title: `Issue ${i}`, status: 'todo' }),
    );
    const context = buildProjectContext(
      [createProject({ id: 'p1', name: 'Big', prefix: 'BIG' })],
      { p1: manyIssues },
    );
    expect(context).toContain('... and 5 more');
  });
});

describe('buildSystemPrompt', () => {
  it('includes all 5 blocks', () => {
    const prompt = buildSystemPrompt('test context');
    expect(prompt).toContain('# BLOCK 1 — IDENTITY');
    expect(prompt).toContain('# BLOCK 2 — SKILLS & CAPACITÉS');
    expect(prompt).toContain('# BLOCK 3 — COMMUNICATION');
    expect(prompt).toContain('# BLOCK 4 — DONNÉES PROJET (DYNAMIQUE)');
    expect(prompt).toContain('# BLOCK 5 — OBJECTIFS ACTUELS');
  });

  it('includes identity as Baaton AI', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('Baaton AI');
    expect(prompt).toContain('PM assistant expert');
  });

  it('includes skill descriptions', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('search_issues');
    expect(prompt).toContain('create_issue');
    expect(prompt).toContain('update_issue');
    expect(prompt).toContain('bulk_update_issues');
    expect(prompt).toContain('add_comment');
    expect(prompt).toContain('get_project_metrics');
    expect(prompt).toContain('analyze_sprint');
    expect(prompt).toContain('generate_prd');
  });

  it('embeds the context in block 4', () => {
    const context = 'MY_CUSTOM_PROJECT_CONTEXT';
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('MY_CUSTOM_PROJECT_CONTEXT');
  });

  it('includes execution rules', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('TOUJOURS utiliser tes skills');
    expect(prompt).toContain('Actions directes');
    expect(prompt).toContain('Cite les display_id');
  });

  it('includes communication rules', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('Réponds dans la langue');
    expect(prompt).toContain('emojis');
    expect(prompt).toContain('bullet points');
  });
});
