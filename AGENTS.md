# Baaton — Agent Instructions

## Project Overview
Baaton is a multi-tenant orchestration board for AI coding agents.
- **Frontend**: React 19 + Vite 8 + TypeScript 5.9 (SPA)
- **Backend**: Rust (Axum 0.8) + sqlx + PostgreSQL (Supabase)
- **Auth**: Clerk (frontend + backend via clerk-rs)
- **Deploy**: Railway

## Structure
```
baaton/
├── frontend/         # React SPA (Vite)
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Route pages
│   │   ├── stores/       # Zustand stores
│   │   ├── hooks/        # Custom hooks (TanStack Query)
│   │   ├── lib/          # Utils, API client
│   │   └── styles/       # Global styles
│   └── package.json
├── backend/          # Rust API
│   ├── src/
│   │   ├── routes/       # Axum route handlers
│   │   ├── models/       # DB models (sqlx)
│   │   ├── middleware/   # Auth, rate-limit
│   │   └── main.rs
│   ├── migrations/       # SQL migrations
│   └── Cargo.toml
├── docs/             # PRD, brand, API docs
└── shared/           # Shared types (generated)
```

## Key Conventions
- All API responses: `{ "data": T }` or `{ "error": { "message": string, "code": string } }`
- Dates: ISO 8601 (UTC)
- IDs: UUID v4
- Display IDs: `PREFIX-N` (e.g. BAA-42)
- Markdown: GitHub Flavored Markdown
- Colors: Hex (#f59e0b)

## Database
- Supabase hosted PostgreSQL
- RLS enforced on all tables
- Clerk JWT provides `org_id` via `auth.jwt()->>'org_id'`
- sqlx compile-time checked queries

## Auth
- Frontend: `@clerk/clerk-react` components
- Backend: `clerk-rs` with `ClerkLayer` (tower middleware)
- Agent API: Custom API key auth (SHA-256 hashed, stored in `api_keys` table)
- Public routes: No auth, rate-limited

## Brand
- Accent: Amber (#f59e0b)
- Dark-first design
- Mascot: Pixel Tanuki
- Font: Inter + JetBrains Mono
