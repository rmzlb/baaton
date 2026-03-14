# Baaton Feature Matrix — Industry Best Practices Audit

## Competitive Reference: Linear, GitHub Projects, Notion, Plane, Huly

---

## 🏗️ CORE — Issue Tracking

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| Kanban board | ✅ | ✅ | ✅ | — | — |
| List view | ✅ | ✅ | ✅ | — | — |
| Issue detail drawer | ✅ | ✅ | ✅ | — | — |
| Rich text description (Markdown) | ✅ | ✅ | ✅ | — | — |
| Sub-issues / child issues | ✅ | ❌ | ⚠️ DB ready, no UI | 🟡 Medium | Medium |
| Issue templates | ✅ | ✅ | ❌ | 🟡 Medium | Small |
| Issue relations (blocking/blocked) | ✅ | ❌ | ❌ | 🟡 Medium | Medium |
| Duplicate detection (AI) | ✅ | ❌ | ❌ | 🟢 Low | Large |
| Recurring issues | ✅ | ❌ | ❌ | 🟢 Low | Medium |
| Issue estimates (T-shirt/Fibonacci) | ✅ | ❌ | ❌ | 🟡 Medium | Small |
| Due dates | ✅ | ✅ | ✅ | — | — |
| Attachments | ✅ | ✅ | ⚠️ Model exists | 🟡 Medium | Medium |

## 👤 PERSONAL — My Work

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| **My Issues (Focus view)** | ✅ Core | ✅ | ⚠️ Basic /my-tasks | 🔴 Critical | Medium |
| Focus grouping (Urgent→SLA→Blocking→Cycle→Active→Backlog) | ✅ | ❌ | ❌ | 🔴 Critical | Medium |
| Assigned to me | ✅ | ✅ | ✅ | — | — |
| Created by me | ✅ | ✅ | ❌ | 🟠 High | Small |
| Subscribed issues | ✅ | ✅ | ❌ | 🟡 Medium | Medium |
| Activity feed (my issues) | ✅ | ✅ | ⚠️ Global only | 🟠 High | Small |
| Notification inbox | ✅ Core | ✅ | ❌ | 🟠 High | Large |

## 📊 VIEWS & FILTERS

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| Filter by status | ✅ | ✅ | ✅ | — | — |
| Filter by priority | ✅ | ✅ | ✅ | — | — |
| Filter by project | ✅ | ✅ | ✅ | — | — |
| Filter by assignee | ✅ | ✅ | ❌ | 🟠 High | Small |
| Filter by label/tag | ✅ | ✅ | ⚠️ Partial | 🟠 High | Small |
| Filter by due date | ✅ | ✅ | ❌ | 🟡 Medium | Small |
| Filter by created date | ✅ | ✅ | ⚠️ Sort only | 🟡 Medium | Small |
| **Custom saved views** | ✅ Core | ✅ | ❌ | 🟠 High | Medium |
| View subscriptions (notifications) | ✅ | ❌ | ❌ | 🟢 Low | Medium |
| Group by (status/priority/project/assignee) | ✅ | ✅ | ⚠️ Status only | 🟠 High | Small |
| Sort by multiple fields | ✅ | ✅ | ⚠️ Single sort | 🟡 Medium | Small |
| **Cmd+K command palette** | ✅ | ✅ | ✅ | — | — |
| Global search | ✅ | ✅ | ⚠️ In-view only | 🟠 High | Medium |

## 📈 PLANNING & CYCLES

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| **Milestones** | ✅ | ✅ | ✅ Backend + UI | — | — |
| **Cycles/Sprints** | ✅ Core | ❌ | ⚠️ Backend only, no UI | 🟠 High | Large |
| Sprint board (filter by cycle) | ✅ | ❌ | ❌ | 🟠 High | Medium |
| Auto-rollover incomplete issues | ✅ | ❌ | ❌ | 🟡 Medium | Small |
| Cycle analytics (velocity, burndown) | ✅ | ❌ | ❌ | 🟡 Medium | Large |
| **Initiatives** (group of projects) | ✅ | ❌ | ❌ | 🟢 Low | Large |
| Roadmap timeline view | ✅ | ✅ | ❌ | 🟡 Medium | Large |
| Project dependencies | ✅ | ❌ | ❌ | 🟢 Low | Medium |
| Project health & updates | ✅ | ❌ | ❌ | 🟡 Medium | Medium |

## 📥 TRIAGE & INTAKE

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| **Triage inbox** | ✅ Core | ❌ | ❌ | 🟠 High | Medium |
| Accept/Decline/Duplicate/Snooze actions | ✅ | ❌ | ❌ | 🟠 High | Medium |
| Triage responsibility rotation | ✅ | ❌ | ❌ | 🟢 Low | Medium |
| Public issue submission | ✅ | ✅ | ✅ | — | — |
| SLAs (auto-deadlines) | ✅ | ❌ | ❌ | 🟡 Medium | Medium |

## 🤖 AI & AUTOMATION

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| AI issue creation from text | ✅ | ✅ Copilot | ✅ Gemini | — | — |
| AI TLDR / summary | ✅ | ❌ | ✅ | — | — |
| AI milestone planning | ✅ | ❌ | ✅ | — | — |
| AI auto-labeling | ✅ | ❌ | ❌ | 🟡 Medium | Small |
| AI duplicate detection | ✅ | ❌ | ❌ | 🟡 Medium | Medium |
| Workflow automations (on status change) | ✅ | ✅ Actions | ❌ | 🟡 Medium | Large |
| Auto-close stale backlog | ✅ | ✅ | ❌ | 🟡 Medium | Small |
| Agent API (external AI agents) | ❌ | ❌ | ⚠️ Planned | 🟠 High | Medium |
| MCP Server | ❌ | ❌ | ⚠️ Planned | 🟠 High | Medium |

## 📊 ANALYTICS & INSIGHTS

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| **Velocity chart** | ✅ | ❌ | ❌ | 🟡 Medium | Medium |
| **Burndown/Burnup** | ✅ | ❌ | ❌ | 🟡 Medium | Medium |
| Cycle time distribution | ✅ | ❌ | ❌ | 🟡 Medium | Medium |
| Custom dashboards | ✅ | ❌ | ❌ | 🟢 Low | Large |
| Team workload view | ✅ | ❌ | ❌ | 🟡 Medium | Medium |
| Issue age / staleness | ✅ | ❌ | ❌ | 🟡 Medium | Small |

## 🔗 INTEGRATIONS

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| **GitHub PR ↔ Issue sync** | ✅ Core | Native | ✅ | — | — |
| Slack notifications | ✅ | ✅ | ❌ | 🟡 Medium | Medium |
| Figma embeds | ✅ | ❌ | ❌ | 🟢 Low | Small |
| Sentry → Issue auto-create | ✅ | ✅ | ❌ | 🟢 Low | Medium |
| Webhook outgoing | ✅ | ✅ | ❌ | 🟡 Medium | Small |
| API (REST) | ✅ GraphQL | ✅ REST | ✅ REST | — | — |
| Zapier/Make integration | ✅ | ✅ | ❌ | 🟢 Low | Small |

## 🎨 UX & POLISH

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| Keyboard shortcuts (full) | ✅ | ⚠️ | ✅ Most | 🟡 Medium | Small |
| Multi-select + bulk actions | ✅ | ✅ | ✅ | — | — |
| Right-click context menu | ✅ | ❌ | ✅ | — | — |
| Drag & drop (kanban) | ✅ | ✅ | ✅ | — | — |
| Dark/Light mode | ✅ | ✅ | ✅ | — | — |
| **Skeleton loading states** | ✅ | ✅ | ❌ | 🟠 High | Small |
| **Optimistic UI** | ✅ | ⚠️ | ✅ | — | — |
| PWA support | ❌ Desktop app | ✅ | ⚠️ Missing icons | 🟡 Medium | Tiny |
| Responsive mobile | ✅ App | ✅ | ✅ | — | — |
| Click-to-copy issue IDs | ❌ | ❌ | ✅ Unique! | — | — |
| Cross-org dashboard | ❌ | ❌ | ✅ Unique! | — | — |

## ⚡ PERFORMANCE

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| **Bulk issues endpoint** (GET /issues) | ✅ | ✅ | ❌ N+1 calls | 🔴 Critical | Small |
| Skeleton placeholders | ✅ | ✅ | ❌ | 🟠 High | Small |
| Virtual scroll (1000+ issues) | ✅ | ✅ | ❌ | 🟡 Medium | Medium |
| Prefetch on hover | ✅ | ✅ | ❌ | 🟡 Medium | Small |
| Server-side pagination | ✅ | ✅ | ⚠️ limit=500 | 🟡 Medium | Small |
| Incremental static regen | N/A SPA | ✅ | N/A SPA | — | — |

## 🔐 SECURITY & AUTH

| Feature | Linear | GitHub | Baaton | Priority | Effort |
|---------|--------|--------|--------|----------|--------|
| JWT verification | ✅ | ✅ | ✅ Just shipped | — | — |
| Org-scoped data isolation | ✅ | ✅ | ✅ Just shipped | — | — |
| RBAC (role-based permissions) | ✅ | ✅ | ⚠️ Clerk roles, no enforcement | 🟠 High | Medium |
| Audit log | ✅ | ✅ | ❌ | 🟡 Medium | Medium |
| API key management | ✅ | ✅ | ✅ Backend ready | 🟡 Medium | Small |
| 2FA | ✅ | ✅ | ✅ via Clerk | — | — |

---

## 📋 IMPLEMENTATION ROADMAP (Priority Order)

### Phase 1 — Performance & Polish (1 week)
1. **GET /issues bulk endpoint** — single API call for all org issues (eliminates N+1)
2. **Skeleton loading states** — Dashboard, AllIssues, ProjectBoard
3. **Assignee filter** in AllIssues
4. **Group by** (priority, assignee, project) in list view
5. **PWA icons** (192px + 512px)

### Phase 2 — My Work & Views (1 week)  
6. **My Issues upgrade** — Focus grouping, Created/Subscribed tabs
7. **Custom saved views** — save filter combos in sidebar
8. **Global search** — cross-project issue search with Cmd+K
9. **Notification inbox** — basic in-app notifications

### Phase 3 — Planning & Cycles (1-2 weeks)
10. **Sprint UI** — cycle planning view, add issues to sprint
11. **Triage inbox** — accept/decline/snooze incoming issues
12. **Roadmap timeline** — Gantt-like project timeline
13. **Sub-issues UI** — tree view in issue detail

### Phase 4 — Analytics & Automations (2 weeks)
14. **Velocity chart** — issues closed per week
15. **Burndown/Burnup** — sprint progress
16. **Workflow automations** — on status change triggers
17. **SLAs** — auto-deadline on priority issues

### Phase 5 — Integrations & Growth (ongoing)
18. **Slack integration** — create issues from Slack
19. **Webhook outgoing** — notify external services
20. **Agent API + MCP** — AI agent endpoints
21. **Issue templates** — reusable templates
22. **Issue estimates** — T-shirt sizing

### Phase 6 — Agent Governance (2026-03)
22. **Approval workflow** — structured approval requests from agents, approve/reject in-app ✅
23. **Agent status indicators** — green/gray dots on kanban cards for agent activity ✅
24. **Sub-status filters** — filter chips inside kanban columns (in_review, in_progress) ✅
25. **Left border attention states** — SLA breach/at risk/blocked/stale/new visual cues ✅
26. **System health indicator** — sidebar footer status dot ✅
27. **Risk scoring** — confidence/risk on approval requests (backlog)
28. **Guard policies** — configurable rules per project (backlog)

---

*Generated 2026-02-11 — Updated 2026-03-14 — Based on Linear, GitHub Projects, Notion, Plane, Huly, DashClaw, OpenClaw Mission Control analysis*
