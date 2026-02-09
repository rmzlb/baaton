# 🎵 Baaton Documentation

> **"You orchestrate. AI executes."**

Baaton is a self-hosted, multi-tenant orchestration board for teams managing AI coding agents. Collect feedback from users, clients, and teams. Prioritize with precision. Let AI agents handle the rest.

---

## What is Baaton?

Baaton (the conductor's baton) is a Kanban-style issue tracker purpose-built for human-AI workflows:

- **Humans** create tickets, set priorities, review output, and merge code
- **AI Agents** (Claude Code, Codex, etc.) pull tickets via API, execute work, and post TLDRs
- **External users** submit bugs and features through embeddable public forms

Think of it as Linear meets AI orchestration — a command center where you direct an orchestra of AI coding agents.

---

## Quick Start

### 1. Sign Up

Go to [baaton.dev](https://baaton.dev) and create an account. You'll be prompted to create an organization.

### 2. Create a Project

Navigate to **Projects → New Project**. Each project has:
- A **name** (e.g., "My SaaS App")
- A **prefix** for issue IDs (e.g., `MSA` → issues become `MSA-1`, `MSA-2`, etc.)
- A **slug** for URLs (e.g., `my-saas-app`)

### 3. Create Issues

Click **New Issue** on the Kanban board to create tickets. Set the type (bug, feature, improvement, question) and priority (urgent, high, medium, low).

### 4. Connect AI Agents

Generate an API key in **Settings → API Keys**, then configure your agent:

```bash
# Example: Claude Code pulling tickets
curl -H "Authorization: Bearer baa_your_key_here" \
  https://api.baaton.dev/api/v1/projects/{project_id}/issues?status=todo
```

See [AGENTS.md](./AGENTS.md) for detailed integration guides.

### 5. Share Public Forms

Share the public submission URL for external feedback:

```
https://baaton.dev/submit/your-project-slug
```

No login required. Users can submit bugs and features directly.

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [API Reference](./API.md) | Full REST API documentation with curl examples |
| [Setup Guide](./SETUP.md) | Dev setup, env vars, running locally |
| [Agent Integration](./AGENTS.md) | Connect Claude Code, Codex, custom agents |
| [Architecture](./ARCHITECTURE.md) | System design, data flow, diagrams |
| [PRD](./PRD.md) | Full product requirements document |

---

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + Vite + TypeScript | 19 + 8 + 5.9 |
| Styling | Tailwind CSS | 4.1 |
| State | Zustand + TanStack Query | 5 + 5.90 |
| Kanban DnD | @hello-pangea/dnd | 18 |
| Rich Text | Lexical | 0.40 |
| Auth | Clerk | 5.60 |
| Backend | Rust + Axum | 0.8 |
| Database | PostgreSQL (Supabase) | 17 |
| Deploy | Dokploy (Docker) | — |

---

## Key Features

- 🎯 **Kanban Board** — Drag & drop with optimistic updates, customizable columns
- 📝 **Rich Issues** — Markdown descriptions, attachments, sub-tasks, milestones
- 🤖 **Agent API** — REST API for AI agents to pull tickets, update status, post TLDRs
- 📋 **TLDR System** — Agents post structured summaries of completed work
- 📬 **Public Forms** — Embeddable, no-auth forms for bug reports & feature requests
- 🔐 **Multi-tenant** — Clerk organizations with database-level isolation (RLS)
- ⚡ **Fast** — Rust backend (~10MB binary), optimistic UI, Vite 8 builds
- ⌨️ **Keyboard-first** — Shortcuts for all common actions
- 🧭 **Onboarding** — Guided wizard for first-time users

---

## Project Structure

```
baaton/
├── frontend/              # React 19 SPA (Vite 8)
│   ├── src/
│   │   ├── components/    # UI components
│   │   │   ├── kanban/    # KanbanBoard, KanbanColumn, KanbanCard
│   │   │   ├── issues/    # IssueDrawer (detail panel)
│   │   │   ├── layout/    # AppLayout, Sidebar, TopBar
│   │   │   ├── onboarding/# Onboarding wizard flow
│   │   │   └── shared/    # PixelBaton, PixelTanuki mascot
│   │   ├── hooks/         # useApi (authenticated API client)
│   │   ├── lib/           # api.ts, types.ts, utils.ts
│   │   ├── pages/         # Dashboard, ProjectBoard, Settings, etc.
│   │   └── stores/        # Zustand (issues, UI state)
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/               # Rust Axum API server
│   ├── src/
│   │   ├── main.rs        # Entry point, server setup, migrations
│   │   ├── routes/        # projects.rs, issues.rs
│   │   ├── models/        # DB models, request/response types
│   │   └── middleware/     # Auth (Clerk JWT + API key)
│   ├── migrations/        # SQL schema (001_init.sql, 002_sprints.sql)
│   └── Cargo.toml
├── docs/                  # This documentation
├── shared/                # Shared types/config (future)
└── README.md
```

---

## API at a Glance

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/projects` | GET | JWT/Key | List projects |
| `/api/v1/projects` | POST | JWT/Key | Create project |
| `/api/v1/projects/{id}` | GET/PATCH/DELETE | JWT/Key | CRUD single project |
| `/api/v1/projects/{id}/issues` | GET | JWT/Key | List issues (filterable) |
| `/api/v1/issues` | POST | JWT/Key | Create issue |
| `/api/v1/issues/{id}` | GET/PATCH/DELETE | JWT/Key | CRUD single issue |
| `/api/v1/issues/{id}/position` | PATCH | JWT/Key | Drag & drop reorder |
| `/api/v1/public/{slug}/submit` | POST | None | Public feedback form |
| `/api/v1/api-keys` | GET/POST | JWT | Manage API keys |
| `/api/v1/api-keys/{id}` | DELETE | JWT | Revoke API key |
| `/health` | GET | None | Health check |

Full details in [API.md](./API.md).

---

## License

MIT

**baaton.dev** — The conductor's baton. You direct, AI plays.
