# 🔍 Deep Audit: OpenClaw Mission Control vs Baaton

**Date**: 2026-03-14
**Source**: github.com/abhi1693/openclaw-mission-control (tweet by @tom_doerr)
**Context**: Agent orchestration dashboard — direct competitor in the "AI-first PM" space

---

## TL;DR

Mission Control est un dashboard d'orchestration d'agents AI construit pour OpenClaw. C'est pas un PM tool complet comme Baaton, mais il a des **concepts UX et des features qu'on devrait voler immédiatement** : approval governance, board goals, skills marketplace, et un chat @mention pour les agents.

Baaton est plus mature côté PM (sprints, milestones, roadmap, triage, gamification). Mission Control est plus mature côté **agent governance** (approvals, confidence scores, rubric scoring).

**Le vrai insight** : Mission Control traite les agents comme des employés à manager. Baaton traite les agents comme des collaborateurs. Les deux ont raison sur des aspects différents.

---

## 1. ARCHITECTURE & STACK COMPARISON

| | Mission Control | Baaton |
|--|----------------|--------|
| Frontend | Next.js + Tailwind + shadcn/ui + Clerk | React + Tailwind + Clerk |
| Backend | Python FastAPI (auto-generated clients via Orval) | Rust Axum + Supabase |
| State | TanStack Query (15s polling) | TanStack Query |
| Charts | Recharts | Custom |
| Auth | Clerk (orgs + roles) | Clerk |
| Design System | Atomic (atoms/molecules/organisms/templates) | Component-based |
| API Pattern | OpenAPI auto-gen → typed hooks | Manual REST |
| Real-time | Polling (15-30s) | Polling |

**Verdict** : Stack similaire. Leur auto-gen API + typed hooks via Orval est intéressant. Notre Rust backend est un avantage perf/fiabilité.

---

## 2. FEATURE-BY-FEATURE COMPARISON

### 2.1 Core Board / Task Management

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Kanban board | ✅ Board/List toggle | ✅ Full kanban + density modes | 🟰 |
| Task cards | Priority badges (HIGH/MED), tags, assignee | Richer (type, status, due date, labels) | **Baaton** |
| Sub-status filters in columns | ✅ (All / Approval needed / Lead review / Blocked) | ❌ | **MC** 🎯 |
| Visual card states | Yellow left border for "review" items | Status colors | **MC** 🎯 |
| Multiple projects | ❌ Single board per workspace | ✅ Multi-project, multi-org | **Baaton** |
| List view | ✅ Basic | ✅ AllIssues sortable | 🟰 |
| Sub-tasks | ❌ | ✅ | **Baaton** |
| Issue relations | ❌ | ✅ (blocks, related) | **Baaton** |
| Templates | ❌ | ✅ | **Baaton** |
| Recurring issues | ❌ | ✅ | **Baaton** |

### 2.2 Agent Management (THE key comparison)

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Agent list/CRUD | ✅ Full table with sort | ✅ AgentConfig page | 🟰 |
| Agent roles | ✅ "Board Lead", "Generalist" | ❌ | **MC** 🎯 |
| Agent online status | ✅ Green dot indicators | ❌ | **MC** 🎯 |
| Agent assignment to tasks | ✅ Per-card assignee display | ✅ | 🟰 |
| Agent config per project | ❌ | ✅ Dedicated endpoint | **Baaton** |
| @mention agents in chat | ✅ BoardChatComposer with autocomplete | ❌ | **MC** 🎯🔥 |
| Agent session monitoring | ✅ Dashboard sessions + token usage | ❌ | **MC** 🎯 |
| Gateway status (infra) | ✅ Connected/disconnected, URL, error | ❌ (API-first, no gateway) | **MC** (niche) |
| Permissive workflows | ❌ Strict transitions | ✅ Warnings not errors, skipped_steps | **Baaton** ⭐ |
| TLDR summaries | ❌ | ✅ First-class TLDR | **Baaton** ⭐ |
| API-first docs | ❌ | ✅ /public/docs, /public/skill | **Baaton** ⭐ |
| AI triage | ❌ | ✅ AI triage endpoint | **Baaton** |

### 2.3 Approval & Governance 🔥

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Approval workflow | ✅ Full system (approve/reject per action) | ❌ | **MC** 🔥🎯 |
| Confidence score | ✅ Per-approval confidence % | ❌ | **MC** 🎯 |
| Rubric scoring | ✅ Multi-criteria rubric charts (PieChart) | ❌ | **MC** 🎯 |
| Approval queue (global) | ✅ Cross-board approvals page | ❌ | **MC** 🎯 |
| Action type tracking | ✅ (task.create, task.assign, etc.) | ❌ | **MC** 🎯 |
| Board-level approval panel | ✅ Inline in board view | ❌ | **MC** 🎯 |

**This is Mission Control's killer feature.** L'idée : chaque action d'un agent peut déclencher un workflow d'approbation. L'humain voit le contexte (confiance, rubric score, tâches liées) et approve/reject.

Baaton a des workflows permissifs (warnings, action_hints) mais PAS de gouvernance formelle. C'est un trou.

### 2.4 Goals & Objectives

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Board goals | ✅ Objective + success metrics + target date | ❌ | **MC** 🎯 |
| "Goal Board" vs "General Board" | ✅ Board type distinction | ❌ | **MC** 🎯 |
| Goal confirmation workflow | ✅ Confirmed/Needs confirmation badges | ❌ | **MC** 🎯 |
| Initiatives / Epics | ❌ | ✅ Initiatives + grouping | **Baaton** |
| Milestones | ❌ | ✅ Dedicated page | **Baaton** |
| Roadmap | ❌ | ✅ Timeline view | **Baaton** |

### 2.5 Skills & Marketplace

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Skills marketplace | ✅ 81 skills, search, categories, risk levels | ❌ | **MC** 🎯🔥 |
| Skill packs (bundles) | ✅ Installable packs from GitHub | ❌ | **MC** 🎯 |
| Risk assessment | ✅ SAFE/UNSAFE per skill | ❌ | **MC** 🎯 |
| Installed tracking | ✅ "Primary" / uninstalled | ❌ | **MC** |

### 2.6 Dashboard & Analytics

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Top metric cards | ✅ (boards, agents, sessions, tasks) | ✅ Rich dashboard | 🟰 |
| Activity feed | ✅ Timeline with relative timestamps | ✅ Activity log | 🟰 |
| Gamification | ❌ | ✅ Heatmap, streaks, PBs | **Baaton** ⭐⭐ |
| Velocity metrics | ❌ | ✅ Personal + org velocity | **Baaton** ⭐ |
| Token usage monitoring | ✅ Per-session tokens/limit/% | ❌ | **MC** 🎯 |
| Gateway health | ✅ Connected/error monitoring | ❌ | **MC** |

### 2.7 Planning & Workflows

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Sprints/Cycles | ❌ | ✅ | **Baaton** |
| Automations | ❌ | ✅ Rule-based | **Baaton** |
| SLA rules | ❌ | ✅ Per project | **Baaton** |
| Webhooks | ❌ | ✅ Org-level | **Baaton** |
| Email intake | ❌ | ✅ | **Baaton** |
| Public submit | ❌ | ✅ | **Baaton** |

### 2.8 Collaboration & UX

| Feature | Mission Control | Baaton | Winner |
|---------|----------------|--------|--------|
| Onboarding chat | ✅ Chat-guided board setup | ❌ | **MC** 🎯 |
| Board chat (@mention) | ✅ With agent autocomplete | ❌ | **MC** 🎯 |
| Comments on issues | ❌ (chat-based) | ✅ | **Baaton** |
| Command palette | ❌ | ✅ | **Baaton** |
| Search | ❌ | ✅ Global search | **Baaton** |
| Invite system | ✅ | ✅ | 🟰 |

---

## 3. UX / DESIGN DEEP DIVE

### Mission Control Design System
- **Theme**: Clean white/slate, light mode only
- **Primary accent**: Blue/indigo (#3B82F6 range)
- **Priority colors**: HIGH = red/coral, MEDIUM = orange/amber
- **Status dots**: Gray (inbox), green-yellow (in progress), blue (review), green (done)
- **Card style**: White, rounded-xl (8-10px), subtle shadow, hover elevation
- **Sidebar**: 200px fixed, categorized sections (OVERVIEW / BOARDS / SKILLS / ADMINISTRATION)
- **Typography**: System font, uppercase tracking-wider for labels
- **Pattern**: Atomic design (atoms → molecules → organisms → templates)
- **Review indicator**: Yellow/gold left border on cards needing attention

### Baaton Design System
- **Theme**: Dark mode primary, warm tones
- **Landing**: Cream/beige (#faf4e8 range) with black/orange accents
- **Typography**: Bold, editorial (condensed headlines), modern
- **Tagline style**: "THE BOARD AGENTS ACTUALLY USE." — confident, all-caps
- **Voice**: Direct, assertive

### UX Concepts Worth Stealing

1. **Sub-status filters in kanban columns**
   - MC has tabs INSIDE the Review column: "All · 5 | Approval needed · 1 | Lead review · 4 | Blocked · 0"
   - Baaton could add this to any column — lets you filter without leaving the board view

2. **Yellow left border for attention-needed cards**
   - Simple visual cue that screams "look at me" without being disruptive
   - Baaton could use this for stale issues, SLA breaches, or blocked items

3. **Agent status dots (green = online)**
   - In the Agents panel on the board, each agent shows a green dot if active
   - Baaton should show agent health/activity status on the board

4. **Token usage monitoring per session**
   - Shows used/limit/% for each agent session
   - Relevant for cost-aware teams — Baaton could add token/cost tracking

5. **Board-level Goals with success metrics**
   - Each board has an objective, measurable success metrics, and a target date
   - Baaton has milestones but not this kind of "board OKR"

---

## 4. WORDING & CONCEPTS TO REPURPOSE

### Terminology Worth Adopting

| MC Term | Current Baaton Equivalent | Recommendation |
|---------|--------------------------|----------------|
| **Operator** | User / Admin | Consider "Operator" for the human-in-the-loop role. Feels more purposeful than "user" |
| **Board Lead** | — | The primary agent responsible for a board. Good concept for agent hierarchy |
| **Confidence** | — | Add confidence % to AI-generated suggestions (triage, auto-assign) |
| **Rubric** | — | Multi-criteria scoring for agent decisions |
| **Goal Board** | Project | "Goal Board" = project with defined objective + metrics |
| **Approval** | — | First-class entity for human-gate decisions |
| **Skills** / **Packs** | Agent config | "Skills" is better than "config" — agents have skills, not config |
| **Risk Level** | — | Classify agent actions by risk (safe/moderate/dangerous) |
| **Mission Control** (framing) | Dashboard | "Mission Control" is a great frame for the ops view |

### Marketing Copy Inspiration

MC's README pitch:
> "A single interface for work orchestration, agent and gateway management, approval-driven governance, and API-backed automation."

Key phrases:
- **"Approval-driven governance"** — this is fire for enterprise positioning
- **"Work orchestration"** — better than "project management" for AI context
- **"The day-to-day operations surface"** — positions as the ops hub, not just a board

For Baaton:
- Current: "The board agents actually use."
- Could add: "Approval-driven. Agent-aware. Built for teams that ship with AI."

---

## 5. PRIORITY FEATURES TO BUILD

### 🔴 HIGH PRIORITY (steal now)

| # | Feature | Why | Effort |
|---|---------|-----|--------|
| 1 | **Approval workflow** | MC's killer feature. Agents need human gates for risky actions. This is the governance story Baaton is missing | L |
| 2 | **Agent status indicators** | Green dot = online, gray = offline. Simple, high-impact visibility | S |
| 3 | **Board/project goals** | Objective + success metrics + target date per project. Gives projects direction beyond "list of issues" | M |
| 4 | **Sub-status filters in kanban** | Filter chips inside columns (e.g., "Needs review · 3 | Blocked · 1"). Reduces friction vs separate views | M |

### 🟡 MEDIUM PRIORITY (build this quarter)

| # | Feature | Why | Effort |
|---|---------|-----|--------|
| 5 | **@mention agent chat** | Chat composer on board with agent @mention autocomplete. Bridges the gap between PM tool and agent comms | M |
| 6 | **Confidence scores on AI decisions** | When AI triage suggests a priority/assignee, show confidence %. Builds trust | S |
| 7 | **Token/cost tracking per agent** | Usage monitoring (tokens used, cost per agent). Cost-awareness for AI teams | M |
| 8 | **Visual card states** | Left border color for attention states (stale, SLA breach, blocked, needs approval) | S |

### 🟢 NICE TO HAVE (backlog)

| # | Feature | Why | Effort |
|---|---------|-----|--------|
| 9 | **Skills marketplace** | MC has it for OpenClaw skills. Baaton could have a marketplace for agent integrations/templates | XL |
| 10 | **Onboarding chat** | Chat-guided project setup. Fancy but low ROI vs wizard form | M |
| 11 | **Risk classification** | Label agent actions as safe/moderate/dangerous | S |

---

## 6. WHAT BAATON DOES BETTER (DON'T LOSE THESE)

Things MC doesn't have that Baaton should KEEP and AMPLIFY:

1. **Gamification** (heatmap, streaks, PBs) — unique moat, nobody else has this
2. **Multi-project / multi-org** — MC is single-board. Baaton scales
3. **Permissive workflows** — warnings > errors, skipped_steps, action_hints. Agent-friendly DNA
4. **TLDR system** — first-class summaries. MC has nothing like this
5. **API-first docs** (/public/docs, /public/skill) — self-documenting for agents
6. **Sprints, milestones, initiatives, roadmap** — actual PM features MC lacks entirely
7. **Public submit forms** — branded intake per project
8. **Email intake** — email-to-issue
9. **SLA rules** — per project
10. **Automations** — rule-based workflows
11. **Global search + command palette** — power user features

---

## 7. STRATEGIC TAKEAWAY

**Mission Control est un dashboard d'orchestration. Baaton est un outil de PM.**

MC est plus "ops center" — tu vois tes agents, tu approuves leurs actions, tu surveilles les gateways. C'est conçu pour une personne qui manage une fleet d'agents.

Baaton est plus "project board" — tu planifies, tu tracks, tu collabores. Les agents sont des collaborateurs, pas des subordonnés à approuver.

**La convergence** : Les deux approches vont fusionner. Le PM tool du futur aura:
- La richesse PM de Baaton (sprints, roadmap, milestones)
- La gouvernance agent de MC (approvals, confidence, rubric)
- Le monitoring de MC (status, tokens, sessions)
- La gamification de Baaton (heatmap, streaks)

**Action** : Prendre les concepts de governance (approvals + confidence + risk levels) et les intégrer dans Baaton sans perdre l'ADN "permissive workflow". La clé c'est que les approvals soient OPTIONNELS et configurables par projet, pas imposés.

---

## 8. COMPOSANT PAR COMPOSANT — UI DIFF

### 8.1 Sidebar Navigation

| Aspect | Mission Control | Baaton | Verdict |
|--------|----------------|--------|---------|
| Width | 260px fixed, pas collapsible | 56px (collapsed) / 224px (expanded), collapsible | **Baaton** meilleur — collapse + responsive |
| Sections | 4 groupes hardcoded (Overview, Boards, Skills, Admin) | 3 groupes dynamiques (Core, Planning, Tools) + Saved Views | **Baaton** meilleur — plus riche, views custom |
| Active state | `bg-blue-100 text-blue-800` (light blue fill) | `bg-surface-hover text-primary` (theme-aware) | **Baaton** — dark mode support |
| Padding | `px-3 py-2.5` (spacieux) | `px-3 py-1.5` (plus dense) | MC plus confortable, Baaton plus compact |
| Org switcher | Pas visible dans sidebar | Clerk `OrganizationSwitcher` intégré | **Baaton** meilleur |
| System status | ✅ "All systems operational" dot en footer | ❌ | **MC** 🎯 — petit ajout valorisant |
| Dark mode | ❌ Light only | ✅ Full dark/light toggle | **Baaton** |
| i18n | ❌ English only | ✅ FR/EN toggle | **Baaton** |
| Logo | "OPENCLAW Mission Control" + badge | PixelTanuki animé + "BAATON" | **Baaton** — plus de personnalité |
| Badge counts | ❌ | ✅ Triage count badge | **Baaton** |

**À reprendre de MC** :
- Status indicator en footer sidebar ("System operational" / "Degraded") — trivial à ajouter, rassure les users

### 8.2 Kanban Board

| Aspect | Mission Control | Baaton | Verdict |
|--------|----------------|--------|---------|
| Column header | Dot + label + count badge | Dot + label + count badge + "+" button | **Baaton** — "+" inline plus pratique |
| Card content | Title + priority pill + tag pills + assignee | Title + type icon + priority icon + tags + assignee + due date + SLA + PR badge + description preview | **Baaton** nettement plus riche |
| Card priority | Pill badges (text: "HIGH"/"MEDIUM") rouge/orange | Icônes (arrow up/down/octagon) avec couleur | MC plus explicite (texte), Baaton plus compact (icônes) |
| Card hover | `hover:-translate-y-0.5 hover:shadow-md` | Selection state + context menu | Différent — MC fait un lift, Baaton un select |
| Density modes | ❌ | ✅ compact/default/spacious | **Baaton** ⭐ |
| Drag & drop | ❌ (pas visible dans le code boards) | ✅ @hello-pangea/dnd full support | **Baaton** |
| Context menu | ❌ | ✅ Right-click actions | **Baaton** |
| Sub-status filters | ✅ Chips dans la colonne Review | ❌ | **MC** 🎯🔥 |
| Board/List toggle | ✅ Pill toggle | ❌ (pages séparées) | **MC** 🎯 — toggle inline plus fluide |
| Dark mode | ❌ | ✅ | **Baaton** |
| Review state border | ✅ Yellow left border 3-4px | ❌ | **MC** 🎯 — visual cue fort |
| GitHub PR link | ❌ | ✅ `GitHubPrBadge` inline | **Baaton** |
| SLA indicator | ❌ | ✅ Overdue/warning colors | **Baaton** |
| CopyableId | ❌ | ✅ Issue ID copiable | **Baaton** |

**À reprendre de MC** :
1. **Sub-status filter chips dans les colonnes** — par ex. "Review" pourrait avoir "Needs review · 3 | Blocked · 1 | Approved · 5". Filtrage SANS quitter le board.
2. **Left border color pour les états spéciaux** — SLA breach = red left border, blocked = amber, stale = gray. Simple CSS, gros impact.
3. **Board/List toggle inline** — au lieu de pages séparées, un pill toggle en haut du board.

### 8.3 Task Cards — Deep Diff

**MC Card anatomy** :
```
┌─────────────────────────────────┐
│ [Title truncated...]   [HIGH ●] │  <- Priority pill top-right
│ [● CI] [● Security]            │  <- Tag pills avec dot coloré
│ 🤖 Backend Engineer            │  <- Assignee row bottom
│▌                                │  <- Yellow left border (review state)
└─────────────────────────────────┘
```

**Baaton Card anatomy** (default density) :
```
┌─────────────────────────────────┐
│ 🐛 [BUG-42]  ↑ Due Mar 20     │  <- Type icon + ID + Priority icon + Due date
│ Title of the issue              │  <- Title
│ First line of description...    │  <- Description preview
│ [frontend] [api]  🔗PR#42      │  <- Tags + GitHub PR
│ 👤 Rmz  ⏱ 2h ago  ⚠ SLA       │  <- Assignee + time + SLA
└─────────────────────────────────┘
```

**Verdict** : Baaton card est significativement plus dense en info. MC card est plus clean/minimal mais manque de contexte. Les deux approches sont valides selon le use case.

**Hybride idéal** : Garder la richesse Baaton + ajouter le left border state de MC + les priority pills textuels quand density = spacious.

### 8.4 Dashboard

| Aspect | Mission Control | Baaton | Verdict |
|--------|----------------|--------|---------|
| Metric cards | 4 cards (boards, agents, sessions, tasks) avec icône + value + secondary | MetricsBar horizontal (velocity, tasks, active, etc.) | MC: cards individuelles. Baaton: barre unifiée. Les deux marchent |
| Activity timeline | ✅ Recent events avec relative timestamps | ✅ ActivityFeed + ActivityChart SVG | **Baaton** — plus visuel |
| Agent monitoring | ✅ Per-session token usage, connected gateways | ❌ | **MC** 🎯 |
| Gamification | ❌ | ✅ Heatmap, streaks, PBs, velocity trends | **Baaton** ⭐⭐ |
| Project list | Basic board links | Rich project cards avec stats | **Baaton** |
| Greeting | ❌ | ✅ "Good morning." contextuel | **Baaton** — touch personnelle |
| Activity chart | ❌ | ✅ Created vs closed area chart | **Baaton** |

### 8.5 Agent Management

| Aspect | Mission Control | Baaton | Verdict |
|--------|----------------|--------|---------|
| Agent list | Full sortable table (name, status, session ID, board, last seen, updated) | Config page per project | MC: global table. Baaton: per-project config |
| Agent CRUD | ✅ Create/delete/edit | ✅ Config update | 🟰 |
| Online indicators | ✅ Green dots sur le board | ❌ | **MC** 🎯 |
| Agent roles | ✅ "Board Lead", "Generalist" | ❌ | **MC** 🎯 |
| Token monitoring | ✅ used/max/% per session | ❌ | **MC** 🎯 |
| Agent in sidebar panel | ✅ Agents column on board | ❌ | **MC** 🎯 |

---

## 9. GOVERNANCE WORKFLOW — ADAPTÉ POUR BAATON

### Le problème à résoudre
L'agent ne vit PAS dans Baaton. Le code, l'exécution, les tools vivent ailleurs (OpenClaw, Cursor, Codex, etc.). Baaton gère la TÂCHE. Donc le pattern MC (approval gate sur l'exécution du tool) ne s'applique pas directement.

### Pattern AI SDK `needsApproval`
Vercel AI SDK v6 a un pattern natif :
- Tool définit `needsApproval: true` (ou une fonction conditionnelle)
- L'UI affiche Approve/Deny buttons quand le tool est en `approval-requested`
- L'agent attend la réponse avant d'exécuter
- States: `approval-requested` → `output-available` | `output-denied`

### Comment l'adapter à Baaton

**L'insight clé** : Dans Baaton, la "demande d'approbation" n'est pas un tool call — c'est un **changement de statut** ou une **action sur l'issue**.

#### Option A : "Review Gate" sur les transitions (recommandé ✅)
Configurable par projet. Quand activé :
1. L'agent (via API) passe une issue de "In Progress" → "Review"
2. Baaton ajoute automatiquement un état `needs_approval: true` sur l'issue
3. L'UI affiche des boutons **Approve** / **Reject** / **Request Changes** sur la card
4. L'humain clique
5. Baaton notifie l'agent via webhook callback (`POST webhook_url` avec `{issue_id, decision, comment}`)
6. L'issue passe à "Done" (approved) ou revient à "In Progress" (rejected) avec le commentaire

**Avantages** :
- S'intègre dans le workflow existant (statuts)
- Pas besoin de changer l'API fondamentalement
- L'agent décide quand demander une review (il push vers "Review")
- L'humain a le contrôle via le board

**Implémentation** :
- Nouveau champ `review_gate: boolean` dans project settings
- Nouveau champ `approval_status: pending|approved|rejected|null` sur l'issue
- Nouveau endpoint `POST /issues/{id}/approve` et `POST /issues/{id}/reject`
- Webhook event `issue.approval_decision` envoyé au callback de l'agent
- UI : boutons Approve/Reject sur la card quand `approval_status = pending`
- Left border amber quand en attente, green quand approved

#### Option B : "Action Approval" (comme MC, plus complexe)
Chaque action de l'agent est loggée et peut nécessiter approval :
- `agent.assign_issue` → approval si configured
- `agent.change_priority` → approval si high-risk
- `agent.close_issue` → approval systématique

Plus puissant mais beaucoup plus complexe. **Pour V2.**

#### Option C : Hybrid — Commentaire structuré
L'agent poste un commentaire structuré (type: "approval_request") avec :
```json
{
  "type": "approval_request",
  "action": "deploy_to_production",
  "details": "PR #42 merged, ready to deploy",
  "confidence": 0.85,
  "options": ["approve", "reject", "modify"]
}
```
L'UI render des boutons inline dans le feed de commentaires.
Le résultat est posté comme commentaire de réponse.

**Plus léger** que Option A, pas besoin de changer le data model des issues.

### Recommandation

**Phase 1** : Option C (commentaire structuré) — le plus rapide, s'intègre dans l'ActivityTimeline existante.
**Phase 2** : Option A (review gate) — le plus propre, nécessite des changements API+DB.

---

## 10. NOMS & STRUCTURES DE PAGES — BEST PRACTICES DE MC

### Page naming
| MC | Baaton actuel | Recommandation |
|----|---------------|----------------|
| `/dashboard` | `/dashboard` | ✅ Pareil |
| `/boards` | `/projects` | Garder "Projects" — plus riche qu'un "Board" |
| `/boards/[id]` | `/projects/[slug]/board` | ✅ Baaton meilleur (slug > UUID) |
| `/agents` | `/agent-config` | Renommer en `/agents` — plus propre |
| `/approvals` | ❌ | **Ajouter** `/approvals` comme page globale |
| `/activity` | ❌ (embedded in dashboard) | Considérer une page dédiée `/activity` |
| `/skills/marketplace` | ❌ | Backlog — pas prioritaire |
| `/tags` | Via project settings | MC a une page tags globale — intéressant pour la cohérence cross-projet |

### Design system observations
MC utilise un pattern atomic (atoms/molecules/organisms/templates) strict. Baaton est plus feature-based (components/kanban, components/issues, etc.).

Les deux approches marchent. L'atomic est plus scalable pour les gros teams, le feature-based est plus lisible pour les petites équipes. **Baaton devrait rester feature-based** mais extraire un `components/shared/` ou `components/ui/` plus riche.

### MC composants qu'on n'a pas et qui ajoutent de la valeur

1. **StatusDot** — composant réutilisable pour les indicateurs de statut (online/offline/pending)
2. **ConfirmActionDialog** — dialog de confirmation d'action destructive. Baaton a probablement un équivalent mais MC l'a bien componentisé
3. **ChartContainer + ChartTooltip** — wrapper standardisé pour tous les charts (Recharts). Si Baaton scale les analytics, utile
4. **TopMetricCard** — card individuelle pour une métrique avec icône, accent color, secondary text. Pattern réutilisable
5. **InfoBlock** — section avec titre + badge + rows key-value. Bon pour les detail panels

---

## 11. DASHCLAW ANALYSIS (Policy Firewall)

**Source**: github.com/ucsandman/DashClaw | dashclaw.io
**Category**: Decision Infrastructure / Policy Firewall for AI agents

### Positioning
DashClaw n'est PAS un PM tool. C'est un proxy entre agents et systèmes externes.

`Agent → DashClaw (Policy Engine) → External Systems`

### Architecture (7 core endpoints)
| Route | Purpose | SDK Method |
|:---|:---|:---|
| `/api/guard` | Policy evaluation ("Can I do X?") | `guard()` |
| `/api/actions` | Lifecycle recording ("I am doing X") | `createAction()`, `updateOutcome()` |
| `/api/approvals` | Human review queue | `waitForApproval()` |
| `/api/assumptions` | Reasoning integrity tracking | `recordAssumption()` |
| `/api/signals` | Anomaly detection (autonomy spikes, stale actions) | `getSignals()` |
| `/api/policies` | Guard rule management | — |
| `/api/health` | System readiness | — |

### DashClaw vs Baaton

| Aspect | DashClaw | Baaton |
|--------|----------|--------|
| **Category** | Decision infrastructure | Agent-first PM |
| **Core loop** | Guard → Act → Record → Verify | Plan → Track → Review → Ship |
| **Agent integration** | SDK interception (pre-execution) | API-first (task lifecycle) |
| **Task management** | ❌ None | ✅ Full (kanban, sprints, milestones) |
| **Risk scoring** | ✅ Per-action, 0-100 | ❌ |
| **Approval queue** | ✅ Dedicated page with risk display | ❌ (being implemented) |
| **Policy engine** | ✅ Configurable rules (threshold, type, rate) | ❌ |
| **Agent fleet monitoring** | ✅ Status, governance, last action | Partial (agent config) |
| **Decision replay** | ✅ Causal chain visualization | ❌ |
| **Compliance** | ✅ SOC 2, GDPR, EU AI Act | ❌ |
| **Gamification** | ❌ | ✅ |
| **GitHub integration** | ❌ | ✅ |
| **Multi-project** | ❌ (single org) | ✅ |
| **Dark mode** | ✅ (dark luxury) | ✅ |

### Concepts to Adopt from DashClaw

1. **Risk Score on Approvals** (HIGH PRIORITY)
   - Add optional `risk_score: 0-100` on approval requests
   - Display prominently (big number, color-coded: green < 50 < amber < 70 < red)
   - Helps human prioritize what to review first

2. **Guard Policies (Phase 3 — backlog)**
   - Configurable rules per project: "If risk > 70, require approval"
   - "If type = deploy, require approval"
   - "Max 50 issues closed/hour per agent, warn"
   - Not urgent but powerful for enterprise

3. **Approval Queue UX Pattern**
   - DashClaw's approval page: left amber border, action title bold, risk score prominent, "Systems Touched" chips, big Allow/Deny buttons
   - This pattern is the blueprint for our approval cards

4. **Decision Ledger / Agent Actions Feed**
   - Global stream of governed actions with filters (type, status, risk)
   - We have ActivityFeed — consider a filtered "Agent Activity" view

5. **Agent Fleet Table**
   - Table: name, status dot, governance badge, last action, "View Control"
   - Enrich our `/agents` page with this layout

6. **Assumption Tracking (future)**
   - `recordAssumption()` — agents record WHY they made a decision
   - Could be a structured comment type alongside approval_request
   - Useful for debugging agent reasoning

### Strategic Relationship
DashClaw could complement Baaton — not compete with it. But if Baaton absorbs the best governance patterns (risk scoring, approval queue, policies), DashClaw becomes redundant for teams already using Baaton.

**The play**: Baaton = "The board agents use" + "The governance agents need" = one fewer tool to integrate.

---

## 12. REPOS & LINKS

- Mission Control: https://github.com/abhi1693/openclaw-mission-control
- Tweet: https://x.com/tom_doerr/status/2032742209305317829
- Baaton: https://baaton.dev / https://github.com/rmzlb/baaton
- Existing Baaton audit: `docs/competitive-audit-2026-03.md`
