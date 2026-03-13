# Baaton vs Linear vs Jira vs ClickUp — Deep Feature Audit (March 2026)

## Scoring: 0 = absent, 1 = basic, 2 = good, 3 = best-in-class
## 🎯 = interesting for Baaton to add | ⭐ = Baaton advantage | 🔥 = critical gap

---

## 1. CORE ISSUE TRACKING

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Issues CRUD | 3 | 3 | 3 | 3 | Parity |
| Sub-issues/children | 2 | 3 | 3 | 3 | Baaton has it, Linear has infinite nesting |
| Issue relations (blocks, related) | 2 | 3 | 3 | 2 | Baaton: blocks/related. Linear: blocks, blocked by, related, duplicate |
| Custom fields | 0 | 2 | 3 | 3 | 🔥🎯 Baaton has NONE. Jira king. ClickUp 15+ field types |
| Issue types (bug, feature, task) | 2 | 2 | 3 | 3 | Baaton: type field. Jira: full custom types with schemes |
| Priority levels | 2 | 2 | 2 | 2 | Parity (urgent/high/med/low) |
| Estimates (story points) | 0 | 2 | 3 | 3 | 🎯 Baaton has none. Linear: T-shirt/points. Jira: full story points |
| Due dates | 2 | 2 | 2 | 3 | ClickUp: start+due dates, time estimates |
| Attachments | 2 | 2 | 3 | 3 | Baaton: basic. Jira/ClickUp: rich media |
| Rich text / markdown | 2 | 3 | 2 | 3 | Linear: excellent markdown. ClickUp: rich editor |
| Templates | 2 | 2 | 3 | 3 | Baaton: issue templates. Jira: full project templates |
| Recurring issues | 2 | 1 | 2 | 3 | ⭐ Baaton has dedicated recurring system. ClickUp best |
| **Subtotal** | **19/36** | **27/36** | **32/36** | **33/36** | |

## 2. VIEWS & NAVIGATION

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Kanban board | 3 | 3 | 3 | 3 | Parity — Baaton's is polished with density modes |
| List view | 2 | 3 | 3 | 3 | Baaton: AllIssues page. Others: sortable columns |
| Table view (spreadsheet) | 0 | 1 | 2 | 3 | 🎯 ClickUp: full spreadsheet mode. Baaton: none |
| Timeline / Gantt | 1 | 2 | 3 | 3 | 🎯 Baaton: basic RoadmapTimeline. Jira/ClickUp: full Gantt |
| Calendar view | 0 | 1 | 2 | 3 | 🎯 Baaton: none. ClickUp: full calendar |
| Saved views / filters | 2 | 3 | 3 | 3 | Baaton: views system. Linear: best filter UX |
| Global search | 2 | 3 | 2 | 3 | Baaton: search + global search. Linear: AI-semantic search |
| Command palette | 2 | 3 | 1 | 2 | Baaton: has it. Linear: best keyboard UX |
| Keyboard shortcuts | 1 | 3 | 2 | 2 | 🎯 Linear is keyboard-first. Baaton: basic |
| Dashboard / homepage | 3 | 2 | 2 | 3 | ⭐ Baaton dashboard is rich (metrics, gamification, projects) |
| **Subtotal** | **16/30** | **24/30** | **23/30** | **28/30** | |

## 3. PLANNING & ROADMAP

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Sprints / Cycles | 2 | 3 | 3 | 3 | Baaton: sprints + cycles. Linear: auto rollover |
| Milestones | 2 | 2 | 1 | 2 | Baaton: dedicated milestones page |
| Initiatives / Epics | 2 | 3 | 3 | 2 | Baaton: initiatives with project grouping |
| Roadmap visualization | 1 | 3 | 3 | 3 | 🎯 Baaton: basic timeline. Others: rich interactive roadmaps |
| Backlog management | 2 | 3 | 3 | 2 | Linear: triage → backlog flow is best |
| Capacity planning | 0 | 1 | 2 | 2 | 🎯 Baaton: none. Jira: workload view |
| Dependencies (Gantt) | 0 | 1 | 3 | 3 | 🔥🎯 Jira/ClickUp: full dependency chains |
| Goals / OKRs | 0 | 0 | 1 | 3 | 🎯 ClickUp: Goals + OKRs built-in |
| **Subtotal** | **9/24** | **16/24** | **19/24** | **20/24** | |

## 4. AUTOMATION & WORKFLOWS

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Workflow automations | 2 | 2 | 3 | 3 | Baaton: rule-based automations. Jira: most powerful |
| Auto-assign | 2 | 2 | 2 | 2 | Baaton: per-project auto-assign config |
| Status transitions | 3 | 2 | 3 | 2 | ⭐ Baaton: permissive with AI-friendly warnings |
| SLA rules | 2 | 2 | 3 | 1 | Baaton: SLA per project. Jira: full SLM |
| Webhook events | 3 | 3 | 3 | 2 | ⭐ Baaton: org-level webhooks, great API |
| Triage system | 2 | 3 | 2 | 1 | Linear: best triage UX. Baaton: AI triage |
| Email intake | 2 | 1 | 3 | 2 | ⭐ Baaton: email-to-issue. Jira: full email channel |
| Public submission | 2 | 0 | 1 | 1 | ⭐ Baaton: public submit forms per project |
| **Subtotal** | **18/24** | **15/24** | **20/24** | **14/24** | |

## 5. AI & AGENTS

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| AI chat assistant | 2 | 2 | 2 | 3 | Baaton: Gemini-powered AI chat. ClickUp Brain best |
| AI triage / auto-categorize | 2 | 3 | 2 | 2 | Linear: Triage Intelligence. Baaton: AI triage endpoint |
| Agent platform (assign to agents) | 1 | 3 | 1 | 1 | 🔥🎯 Linear: Cursor/Codex/Devin/Copilot as assignees |
| MCP / tool access | 0 | 3 | 0 | 0 | 🔥🎯 Linear has MCP access. Game changer |
| API-first for agents | 3 | 3 | 2 | 2 | ⭐ Baaton: born API-first, agent skill file, /public/docs |
| AI PM review | 2 | 0 | 0 | 1 | ⭐ Baaton: full PM review endpoint |
| Agent config per project | 2 | 1 | 0 | 0 | ⭐ Baaton: agent-config endpoint |
| TLDR summaries | 2 | 1 | 0 | 1 | ⭐ Baaton: first-class TLDR system |
| Permissive workflow (AI-friendly) | 3 | 1 | 0 | 0 | ⭐⭐ Baaton: warnings not errors, skipped_steps, action_hints |
| **Subtotal** | **17/27** | **17/27** | **7/27** | **10/27** | |

## 6. INTEGRATIONS

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| GitHub (PRs, commits, sync) | 2 | 3 | 3 | 2 | Baaton: GitHub webhook + mapping. Linear: deep sync |
| Slack integration | 2 | 3 | 3 | 3 | Baaton: slash commands + notifications |
| Figma | 0 | 3 | 1 | 2 | 🎯 Linear: best Figma integration |
| Sentry / error tracking | 0 | 3 | 2 | 1 | 🎯 Linear: Sentry creates issues |
| Zendesk / Intercom | 0 | 2 | 3 | 1 | Customer support → issues |
| Google Workspace | 0 | 1 | 2 | 3 | ClickUp: deep Google integration |
| Zapier / Make | 0 | 1 | 3 | 3 | 🎯 No-code automation connectors |
| Native integrations count | ~5 | 100+ | 3000+ | 1000+ | Baaton: GitHub, Slack, webhooks, email |
| Import from other tools | 2 | 3 | 2 | 3 | Baaton: import/export JSON |
| **Subtotal** | **6/27** | **22/27** | **22/27** | **21/27** | |

## 7. COLLABORATION

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Comments on issues | 3 | 3 | 3 | 3 | Parity |
| @mentions | 1 | 3 | 3 | 3 | 🎯 Baaton: basic. Others: full mention system |
| Activity log / audit trail | 3 | 3 | 3 | 3 | ⭐ Baaton: rich activity feed |
| Notifications (in-app) | 2 | 3 | 3 | 3 | Baaton: notification system + preferences |
| Notifications (email/push) | 0 | 3 | 3 | 3 | 🔥🎯 Baaton: in-app only |
| Real-time updates | 1 | 3 | 2 | 2 | 🎯 Linear: real-time sync. Baaton: polling |
| Docs / wiki | 0 | 0 | 3 | 3 | ClickUp: Docs. Jira: Confluence |
| Whiteboards | 0 | 0 | 1 | 3 | ClickUp: built-in whiteboards |
| Chat / messaging | 0 | 0 | 0 | 3 | ClickUp: built-in chat |
| **Subtotal** | **10/27** | **18/27** | **21/27** | **26/27** | |

## 8. ANALYTICS & REPORTING

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Velocity metrics | 3 | 2 | 3 | 2 | ⭐ Baaton: personal + org velocity, trends |
| Activity heatmap | 3 | 0 | 0 | 0 | ⭐⭐ Unique to Baaton |
| Gamification (streaks, PBs) | 3 | 0 | 0 | 0 | ⭐⭐ Unique to Baaton |
| Cycle/sprint reports | 1 | 3 | 3 | 2 | 🎯 Linear: burndown, velocity per cycle |
| Custom dashboards | 1 | 2 | 3 | 3 | 🎯 Jira/ClickUp: fully custom dashboards |
| Burndown / burnup charts | 0 | 2 | 3 | 2 | 🔥🎯 Classic agile reporting |
| Time tracking | 0 | 0 | 2 | 3 | 🎯 ClickUp: native time tracking |
| Workload view | 0 | 0 | 2 | 3 | 🎯 Who's overloaded |
| Export / data warehouse | 1 | 2 | 3 | 2 | Linear: data warehouse sync |
| **Subtotal** | **12/27** | **11/27** | **19/27** | **17/27** | |

## 9. ADMIN & SECURITY

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| Multi-org support | 3 | 2 | 3 | 2 | ⭐ Baaton: full multi-org with cross-org views |
| Role-based access | 2 | 2 | 3 | 3 | Jira: granular permissions |
| API keys (scoped) | 3 | 2 | 2 | 2 | ⭐ Baaton: project-scoped keys, permission groups |
| SSO (Google/SAML) | 2 | 3 | 3 | 3 | Baaton: Clerk (Google SSO). Enterprise: SAML |
| Audit log | 2 | 2 | 3 | 2 | Baaton: admin audit log |
| Billing / plans | 2 | 3 | 3 | 3 | Baaton: basic billing page |
| Guest access | 0 | 2 | 2 | 2 | 🎯 External collaborators |
| **Subtotal** | **14/21** | **16/21** | **19/21** | **17/21** | |

## 10. DEVELOPER EXPERIENCE

| Feature | Baaton | Linear | Jira | ClickUp | Notes |
|---------|--------|--------|------|---------|-------|
| REST API | 3 | 0 | 3 | 3 | Linear: GraphQL only. ⭐ Baaton REST is clean |
| GraphQL API | 0 | 3 | 0 | 0 | Linear: GraphQL-first |
| API documentation | 3 | 3 | 3 | 2 | ⭐ Baaton: /public/docs auto-generated |
| Agent skill file | 3 | 0 | 0 | 0 | ⭐⭐ Unique: /public/skill for AI agents |
| SDK / client libraries | 0 | 2 | 3 | 2 | 🎯 Official SDK for popular languages |
| CLI tool | 0 | 1 | 1 | 0 | |
| Webhooks (outbound) | 3 | 3 | 3 | 2 | Parity |
| Open source | 0 | 0 | 0 | 0 | None are open source |
| Self-hostable | 0 | 0 | 1 | 0 | 🎯 Jira Data Center only |
| **Subtotal** | **12/27** | **12/27** | **14/27** | **9/27** | |

---

## GRAND TOTAL

| Platform | Score | Percentage |
|----------|-------|------------|
| **ClickUp** | **195/270** | **72%** |
| **Jira** | **196/270** | **73%** |
| **Linear** | **178/270** | **66%** |
| **Baaton** | **133/270** | **49%** |

---

## BAATON UNIQUE ADVANTAGES (⭐ moat)

1. **API-first for AI agents** — /public/docs, /public/skill, agent-config per project
2. **Permissive workflows** — warnings not errors, skipped_steps, action_hints for agents
3. **TLDR system** — first-class issue summaries (not bolted on)
4. **Gamification** — heatmap, streaks, personal bests, velocity (nobody else has this)
5. **Public submit** — branded forms per project (Linear/Jira don't have this natively)
6. **Email intake** — email-to-issue per project
7. **Multi-org cross-view** — dashboard/tasks/issues across ALL orgs
8. **Scoped API keys** — project-level permission granularity

## TOP PRIORITY GAPS TO CLOSE (🔥 critical)

| # | Feature | Impact | Effort | Why |
|---|---------|--------|--------|-----|
| 1 | **Custom fields** | 🔴 HIGH | Large | #1 reason teams can't switch from Jira. Every team has unique metadata |
| 2 | **Email/push notifications** | 🔴 HIGH | Medium | In-app only = invisible. Teams need email digests at minimum |
| 3 | **Agent platform (MCP)** | 🔴 HIGH | Large | Linear's killer move. Cursor/Codex as first-class assignees |
| 4 | **Real-time updates (WebSocket)** | 🟡 MED | Medium | Polling feels dated vs Linear's instant sync |
| 5 | **Burndown/burnup charts** | 🟡 MED | Small | Basic agile reporting expectation |

## HIGH VALUE, MEDIUM EFFORT (🎯 recommended)

| # | Feature | Impact | Effort | Why |
|---|---------|--------|--------|-----|
| 6 | **Story point estimates** | 🟡 MED | Small | Needed for sprint planning. Easy to add |
| 7 | **Keyboard shortcuts** | 🟡 MED | Small | Power users expect this. Linear's biggest draw |
| 8 | **Table/spreadsheet view** | 🟡 MED | Medium | Bulk editing, data-heavy teams love it |
| 9 | **Calendar view** | 🟢 LOW | Medium | Nice to have for deadline-oriented teams |
| 10 | **@mentions with notifications** | 🟡 MED | Small | Social feature, drives engagement |

## DO NOT CHASE (deliberate omissions)

- **Docs/Wiki** — Not our lane. Notion/Confluence exist.
- **Chat** — Slack/Discord integration > building a chat.
- **Whiteboards** — Niche. Figma/Excalidraw exist.
- **Time tracking** — Scope creep. Toggl/Clockify exist.
- **3000+ integrations** — Focus on API quality, not quantity. Zapier/Make handles the long tail.

---

## POSITIONING INSIGHT

**Baaton's moat is NOT feature parity with Linear/Jira. It's the agent-first architecture.**

- Linear just added agents in 2026 — it's bolted on. Baaton was born with it.
- Jira has 20 years of legacy. Its agent story is clunky.
- ClickUp tries to be everything. Jack of all trades.

**Baaton = "The board agents actually use."**
Focus: API quality, permissive workflows, agent-friendly responses, gamification.
Don't become Jira. Become what Linear wishes it was for AI-native teams.
