-- 049: Project Context, Project Templates, and enhanced TLDRs

-- ─── project_contexts ─────────────────────────────────
CREATE TABLE IF NOT EXISTS project_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    stack TEXT,
    conventions TEXT,
    architecture TEXT,
    constraints TEXT,
    current_focus TEXT,
    learnings TEXT,
    custom_context JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_contexts_org_id ON project_contexts(org_id);

-- ─── project_templates ────────────────────────────────
CREATE TABLE IF NOT EXISTS project_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    default_context JSONB NOT NULL DEFAULT '{}',
    default_statuses JSONB,
    default_tags TEXT[] NOT NULL DEFAULT '{}',
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_templates_org_id ON project_templates(org_id);

-- ─── Enhanced TLDRs ───────────────────────────────────
ALTER TABLE tldrs ADD COLUMN IF NOT EXISTS decisions_made TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tldrs ADD COLUMN IF NOT EXISTS edge_cases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tldrs ADD COLUMN IF NOT EXISTS context_updates TEXT[] NOT NULL DEFAULT '{}';

-- ─── Seed system templates ────────────────────────────
INSERT INTO project_templates (name, description, default_context, default_tags, is_system)
VALUES
(
    'Rust API',
    'Backend API built with Rust, Axum, sqlx, and PostgreSQL',
    '{
        "stack": "Rust, Axum, sqlx, PostgreSQL, Tokio",
        "conventions": "Use async/await throughout. Errors returned as (StatusCode, Json<Value>). Models in src/models/mod.rs. Routes in src/routes/. Run cargo check after every file change. Migrations in migrations/ numbered sequentially.",
        "architecture": "Axum router with middleware for auth. PgPool shared via State<PgPool>. AuthUser extension via Clerk JWTs or API keys. ApiResponse<T> wraps all responses.",
        "constraints": "Compile times matter — minimize dependencies. No panics in prod. Use structured logging via tracing::. Migrations are append-only."
    }',
    ARRAY['backend', 'rust', 'api'],
    true
),
(
    'Next.js App',
    'Full-stack web app built with Next.js, React, and Tailwind CSS',
    '{
        "stack": "Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui, Prisma/Drizzle",
        "conventions": "App Router pattern. Server components by default, client components only when needed. API routes in app/api/. Shared types in lib/types.ts. Use server actions for mutations.",
        "architecture": "Next.js App Router with layout.tsx hierarchy. Auth via Clerk or NextAuth. DB via Prisma ORM. Deployed on Vercel or Docker.",
        "constraints": "Minimize client-side JS. Avoid large client bundles. Images via next/image. No useEffect for data fetching — use React Server Components."
    }',
    ARRAY['frontend', 'nextjs', 'react', 'fullstack'],
    true
),
(
    'React SPA',
    'Single-page application with Vite, React, TanStack Query, and Tailwind CSS',
    '{
        "stack": "Vite, React 18, TypeScript, TanStack Query, Tailwind CSS, React Router",
        "conventions": "Hooks in src/hooks/. Pages in src/pages/. Components in src/components/. API calls via useApi() hook wrapping fetch. TanStack Query for server state. Dark theme via CSS variables.",
        "architecture": "SPA with React Router. API client in src/lib/api.ts. Types in src/lib/types.ts. Auth token injected per-request. No global state management — TanStack Query is the cache.",
        "constraints": "No Redux or heavy state libs. Lazy-load heavy pages. Tailwind only for styling. Wrap all API responses in ApiResponse<T> pattern."
    }',
    ARRAY['frontend', 'react', 'spa', 'vite'],
    true
)
ON CONFLICT DO NOTHING;
