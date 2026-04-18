# Baaton — Agent Instructions

## Project
Multi-tenant Kanban for AI coding agents. **Stack:** React 19 + Vite, Rust (Axum) + sqlx + PostgreSQL on Supabase, Clerk, Railway deploy.

## Repo layout
- `frontend/` — SPA (`components`, `pages`, `stores`, `hooks`, `lib`, `styles`)
- `backend/` — API, `migrations/`, `main.rs`
- `docs/` — PRD, API notes
- `shared/` — shared types

## Conventions
JSON API: `{ "data": T }` or `{ "error": { "message", "code" } }`. Dates UTC ISO 8601. IDs UUID v4; human display `PREFIX-N` (e.g. BAA-42). Markdown: GFM. Accent amber `#f59e0b`.

## Database & auth
Supabase Postgres with RLS; Clerk JWT carries `org_id`. Frontend `@clerk/clerk-react`; backend `clerk-rs`. Agent access: API keys (hashed in `api_keys`). Public routes rate-limited.

## Brand
Dark-first, Inter + JetBrains Mono, Pixel Tanuki mascot.

## AI chat (in-app agent)
Backend route `/api/v1/ai/chat` uses Gemini via `GEMINI_API_KEY`. Default model is **`gemini-3-flash-preview`** (same family as the legacy proxy in `ai.rs`). Override with **`GEMINI_CHAT_MODEL`** (e.g. `gemini-2.5-flash`, `gemini-2.0-flash`) if the preview is unavailable. Token usage is stored in `ai_usage` with `metadata.cached_prompt_tokens` when the API returns `cachedContentTokenCount` (implicit cache).
