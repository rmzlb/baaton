# 🎵 Baaton

**You orchestrate. AI executes.**

Baaton is a self-hosted, multi-tenant orchestration board for teams managing AI coding agents. Collect feedback from users, clients, and teams. Prioritize with precision. Let AI agents handle the rest.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 · Vite 8 · TypeScript 5.9 · Tailwind 4 |
| Backend | Rust · Axum 0.8 · sqlx · PostgreSQL |
| Auth | Clerk (frontend + clerk-rs backend) |
| Database | Supabase (hosted PostgreSQL 17) |
| Deploy | Railway |

## Quick Start

### Frontend
```bash
cd frontend
npm install
npm run dev  # → http://localhost:3000
```

### Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase + Clerk credentials
cargo run    # → http://localhost:4000
```

## Architecture

```
Frontend (SPA)  ←→  Backend (Rust API)  ←→  Supabase (PostgreSQL)
     ↑                    ↑
  Clerk Auth          clerk-rs JWT
                     + API Keys (agents)
```

## Features

- 🎯 **Kanban Board** — Drag & drop, customizable columns, keyboard shortcuts
- 📝 **Rich Issues** — Markdown, attachments, sub-tasks, milestones
- 🤖 **Agent API** — REST API for Claude Code, Codex, and other agents
- 📋 **TLDR System** — Agents post summaries of what they did
- 📬 **Public Forms** — Embeddable forms for bug reports and feature requests
- 🧠 **LLM Qualifier** — Auto-categorize and format incoming submissions
- 🔐 **Multi-tenant** — Clerk organizations with RLS isolation
- ⚡ **Fast** — Rust backend, optimistic UI updates, Vite 8 builds

## License

MIT

---

**baaton.dev** — The conductor's baton. You direct, AI plays.
