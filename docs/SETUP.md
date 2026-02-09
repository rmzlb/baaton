# Development Setup Guide

This guide covers setting up Baaton for local development.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | ≥ 22 | Frontend build & dev server |
| **npm** | ≥ 10 | Package management |
| **Rust** | ≥ 1.82 | Backend compilation |
| **PostgreSQL** | ≥ 15 | Database (or use Supabase hosted) |

### Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

---

## Clone & Setup

```bash
git clone https://github.com/your-org/baaton.git
cd baaton
```

---

## Frontend Setup

### 1. Install Dependencies

```bash
cd frontend
npm install --legacy-peer-deps
```

> **Note:** `--legacy-peer-deps` is needed due to React 19 peer dependency resolution with some packages.

### 2. Environment Variables

Create `frontend/.env`:

```bash
# Clerk authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_key_here

# Backend API URL
VITE_API_URL=http://localhost:4000
```

#### Getting Clerk Keys

1. Sign up at [clerk.com](https://clerk.com)
2. Create an application
3. Enable **Organizations** in Clerk settings
4. Copy the **Publishable Key** from the dashboard
5. Configure sign-in methods (email, Google, GitHub, etc.)

### 3. Run Dev Server

```bash
npm run dev
# → http://localhost:3000
```

### 4. Build for Production

```bash
npm run build
# Output: frontend/dist/
```

This runs `tsc -b` (TypeScript check) followed by `vite build`.

### 5. Preview Production Build

```bash
npm run preview
# → http://localhost:4173
```

---

## Backend Setup

### 1. Database

You have two options:

#### Option A: Supabase (Recommended for production)

1. Create a project at [supabase.com](https://supabase.com)
2. Copy the connection string from **Settings → Database → Connection string (URI)**
3. Format: `postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres`

#### Option B: Local PostgreSQL

```bash
# macOS
brew install postgresql@17
brew services start postgresql@17
createdb baaton_dev

# Linux (Ubuntu/Debian)
sudo apt install postgresql-17
sudo systemctl start postgresql
sudo -u postgres createdb baaton_dev
```

The backend runs migrations automatically on startup (`include_str!("../migrations/001_init.sql")` in `main.rs`) — no manual schema setup needed.

> **Note:** Migration 002 (sprints) is not yet auto-applied at startup. Run it manually if needed:
> ```bash
> psql $DATABASE_URL < backend/migrations/002_sprints.sql
> ```

### 2. Environment Variables

Create `backend/.env`:

```bash
# Database connection (direct, not pooled)
DATABASE_URL=postgresql://postgres:password@localhost:5432/baaton_dev

# Server port
PORT=4000

# Clerk JWT verification (get from Clerk dashboard → API Keys)
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key

# Logging level
RUST_LOG=baaton_api=debug,tower_http=info
```

### 3. Run Backend

```bash
cd backend
cargo run
# → http://localhost:4000
# Health check: http://localhost:4000/health
```

First run will:
1. Connect to the database
2. Run migrations (create all tables)
3. Seed default organization (`id: "default"`)
4. Start the API server on the configured port

### 4. Build for Production

```bash
cargo build --release
# Binary: target/release/baaton-api (~10MB, stripped + LTO)
```

---

## Full Stack Development

Run both frontend and backend simultaneously:

```bash
# Terminal 1: Backend
cd backend
cargo run

# Terminal 2: Frontend
cd frontend
npm run dev
```

The frontend at `localhost:3000` calls the API at `localhost:4000` via the `VITE_API_URL` env var. CORS is configured permissively (`Allow-Origin: *`) in the backend.

---

## Environment Variables Reference

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk publishable key (`pk_test_...` or `pk_live_...`) |
| `VITE_API_URL` | ✅ | Backend API base URL (e.g., `http://localhost:4000`) |

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `PORT` | ❌ | `4000` | Server listen port |
| `CLERK_SECRET_KEY` | ✅ | — | Clerk secret key for JWT verification |
| `RUST_LOG` | ❌ | `baaton_api=debug,tower_http=info` | Tracing log level filter |

### Production (`.env` at project root)

The project root `.env` contains all secrets for both services. **Do not commit this file.**

| Variable | Description |
|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `DATABASE_URL` | Direct Supabase connection |
| `DATABASE_URL_POOLER` | Pooled Supabase connection (for app runtime) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (for Clerk) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |
| `DOKPLOY_*` | Dokploy deployment config |

---

## Project Structure

```
baaton/
├── frontend/              # React SPA
│   ├── src/
│   │   ├── components/    # UI components
│   │   │   ├── kanban/    # KanbanBoard, KanbanColumn, KanbanCard
│   │   │   ├── issues/    # IssueDrawer (side panel)
│   │   │   ├── layout/    # AppLayout, Sidebar, TopBar
│   │   │   ├── onboarding/# OnboardingFlow + step components
│   │   │   └── shared/    # PixelBaton, PixelTanuki
│   │   ├── hooks/         # useApi (authenticated API client hook)
│   │   ├── lib/           # api.ts (fetch wrapper), types.ts, utils.ts
│   │   ├── pages/         # Dashboard, Landing, ProjectBoard, ProjectList,
│   │   │                  # PublicSubmit, Settings
│   │   ├── stores/        # Zustand stores (issues, UI)
│   │   └── styles/        # globals.css (Tailwind)
│   ├── package.json       # Dependencies (React 19, Vite 8, etc.)
│   ├── tsconfig.json      # Strict mode, path aliases (@/*)
│   └── vite.config.ts     # Vite + React + Tailwind plugins
├── backend/               # Rust API server
│   ├── src/
│   │   ├── main.rs        # Entry: DB connect, migrations, CORS, serve
│   │   ├── routes/
│   │   │   ├── mod.rs     # Router: all route definitions
│   │   │   ├── projects.rs# CRUD for projects
│   │   │   └── issues.rs  # CRUD for issues + position + public submit
│   │   ├── models/
│   │   │   └── mod.rs     # All structs: Project, Issue, TLDR, ApiKey, etc.
│   │   └── middleware/
│   │       └── mod.rs     # Placeholder for auth middleware
│   ├── migrations/
│   │   ├── 001_init.sql   # Core schema (all tables)
│   │   └── 002_sprints.sql# Sprint table + issues.sprint_id
│   └── Cargo.toml
├── docs/                  # Documentation (you are here)
├── shared/                # Shared types (future)
├── .env                   # All secrets (NOT committed)
├── .gitignore
├── AGENTS.md              # AI agent instructions for this repo
└── README.md
```

---

## Frontend Architecture Notes

### Key Libraries

| Library | Purpose | Usage |
|---------|---------|-------|
| `@clerk/clerk-react` | Auth UI & token management | `useAuth()`, `<SignIn>`, `<SignUp>` |
| `@tanstack/react-query` | Server state, caching, mutations | All data fetching |
| `zustand` + `immer` | Client-side state | Optimistic D&D, UI state |
| `@hello-pangea/dnd` | Kanban drag & drop | `KanbanBoard` component |
| `lexical` | Rich text editor | Issue descriptions |
| `framer-motion` | Animations | Transitions, onboarding |
| `react-router-dom` v7 | Routing | All page navigation |

### API Client Pattern

The frontend uses a two-layer API pattern:

1. **`lib/api.ts`** — Low-level `fetch` wrapper with JSON envelope parsing and error handling
2. **`hooks/useApi.ts`** — React hook that injects Clerk JWT tokens and provides typed, domain-specific methods

```
Component → useApi().issues.list(...) → api.get('/...', token) → fetch(...)
```

On 401 errors, the hook automatically calls `signOut()` to redirect to `/sign-in`.

### State Management

```
TanStack Query (server state)
  └── Fetches from API, caches, refetches on invalidation

Zustand (client state)
  ├── useIssuesStore — Optimistic D&D updates, selected issue
  └── useUIStore — Sidebar, theme, command bar
```

---

## Common Issues

### "Missing VITE_CLERK_PUBLISHABLE_KEY"

Set the Clerk publishable key in `frontend/.env`. Get it from [clerk.com](https://clerk.com) → your app → API Keys.

### npm install fails with peer dependency errors

```bash
npm install --legacy-peer-deps
```

### Backend can't connect to database

1. Verify `DATABASE_URL` in `backend/.env`
2. Ensure PostgreSQL is running: `pg_isready`
3. Check database exists: `psql -l | grep baaton`
4. For Supabase: ensure IP is not blocked and password has special chars URL-encoded (e.g., `*` → `%2A`)

### CORS errors in browser

The backend uses `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)`. If you get CORS errors:
1. Ensure the backend is running
2. Check `VITE_API_URL` points to the correct host/port
3. Check browser dev tools Network tab for the actual error

### TypeScript build errors

```bash
cd frontend
npx tsc --noEmit  # Check for type errors without building
```

### Build warning: chunk size > 500kB

This is expected — the SPA bundles all dependencies. For production, consider code splitting with `React.lazy()` and dynamic `import()`.

---

## Deployment

### Production Setup (Dokploy)

Baaton deploys via Dokploy (Docker-based PaaS) on a self-hosted server:

| Service | Domain | Port |
|---------|--------|------|
| Frontend | `baaton.dev` | 80 (HTTPS) |
| Backend | `api.baaton.dev` | 4000 (HTTPS) |

### Docker (Backend)

```dockerfile
FROM rust:1.82-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/baaton-api /usr/local/bin/
EXPOSE 4000
CMD ["baaton-api"]
```

### Static Hosting (Frontend)

```bash
cd frontend
npm run build
# Deploy dist/ to any static hosting (Vercel, Cloudflare Pages, Nginx, etc.)
```

Set `VITE_API_URL` at build time to point to your production backend URL.
