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

## Frontend taste — non-negotiables
*Distilled from `taste-skill` (minimalist + redesign chapters) and our own iterations. Read these before touching any UI in `frontend/`.*

**Product context.** B2B Kanban dashboard, Linear/Notion vibe. Aim for **calm, fast, predictable** — NOT Awwwards motion. Keep `DESIGN_VARIANCE ≈ 3-4`, `MOTION_INTENSITY ≈ 3-4`, `VISUAL_DENSITY ≈ 6-7` (cockpit-leaning).

### Tokens & primitives (already in `globals.css`)
- Colors via CSS vars: `--color-{bg,surface,surface-hover,border,primary,secondary,muted,accent}`. **Never hardcode** `#fff`/`#000`/`bg-zinc-*` in app code — use the tokens. Light + dark mode break otherwise.
- Single accent: amber `#f59e0b`. Status colors (red/amber/blue/emerald) are sémantiques, pas décoratifs — use only for state, never as UI accent.
- Radius scale: `rounded-md` (inner), `rounded-xl` (card outer). No `rounded-full` on big containers.
- Numbers: always `tabular-nums` (KPIs, counts, percentages, IDs). No exception.
- `min-h-[100dvh]` not `100vh`. `100dvh` exists for the iOS Safari viewport bug.
- Fonts: Inter for body, JetBrains Mono for numbers/IDs/code. Don't introduce new font families.

### Cards / surfaces — single-surface pattern
The default Linear-style "data card" pattern we use everywhere (`OrgOverviewCard`, `WeeklyRecap`, `MetricsCard`, `SprintAnalysis`):
- **One** outer `rounded-xl border border-[--color-border] bg-[--color-surface]`.
- Internal sections separated by **horizontal dividers only** (`<div className="border-t border-[--color-border]" />`), never nested boxes.
- Section headers: `text-[10px] font-medium uppercase tracking-wider text-[--color-muted]` + a `lucide` icon at `size={11}`.
- Section bodies: `px-3.5 py-2.5` standard padding.
- Pills (chips): `rounded-full px-2.5 py-1 text-[11px]` with subtle tinted background (`bg-{tone}-500/10`, `text-{tone}-300`).

### Animations — pre-built utilities (use, don't reinvent)
`globals.css` already exposes:
- `.animate-tool-in` — 160ms slide-in for tool parts in the AI chat.
- `.animate-row-in` + `style={{ '--row-index': i }}` — staggered cascade for list rows (35ms × min(i, 12)). Apply to every list/grid row that mounts after data load.
- `.animate-reveal-up*`, `.animate-fade-in*` — landing-page hero reveals.
- The whole site honors `prefers-reduced-motion: reduce` — animations are auto-neutralized for affected users. **Don't add animations that depend on visual delay for correctness.**
- Easing default: `cubic-bezier(0.16, 1, 0.3, 1)` (premium spring-out feel). Avoid Tailwind's default linear easing for anything > 100ms.

### Interaction states — mandatory checklist
Every clickable element must have:
1. **Hover** — color shift (no glow, no shadow pop).
2. **Active** — `active:scale-[0.98]` (or `[0.99]` for big surfaces) + slight bg deepening. Tactile feedback.
3. **Focus** — visible ring `focus:ring-2 focus:ring-amber-500/30`.
4. **Disabled** — `disabled:opacity-50 disabled:cursor-not-allowed`.
5. Transition: `transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]` + `will-change-transform` if scaling.

### Forbidden defaults
- ❌ Hardcoded hex colors in components (use tokens).
- ❌ Pure `#000000` background (we use `--color-bg` = `#0a0a0a`).
- ❌ Generic Tailwind `shadow-md/lg/xl`. Tinted shadows or none.
- ❌ Spinners as loading state. Use a `<Skeleton>` matching the actual layout shape.
- ❌ Empty `else: return null` empty states. Compose a friendly empty state with icon + label (cf. `WeeklyRecap` "Nothing recorded over the last Nd").
- ❌ `<div className="h-screen ...">` for full-height sections. Use `min-h-[100dvh]`.
- ❌ Flexbox percentage math (`w-[calc(33%-1rem)]`). Use CSS Grid.
- ❌ Animating `top/left/width/height`. Animate `transform` and `opacity` only.
- ❌ `text-wrap: balance` is now applied globally to headings — don't override.
- ❌ Adding new icon libraries. Stick to `lucide-react` (already standardized).

### When an LLM agent edits the frontend
1. **Read `globals.css` first** — most "missing utility" intuitions are already there.
2. **Mirror an adjacent existing component** instead of inventing a new pattern. The closest production examples are `OrgOverviewCard.tsx` and `WeeklyRecap.tsx` — both are reference-quality.
3. **Run `pnpm build` before committing** — Vite catches missing imports and dead types that lint misses.
4. **i18n every string** — every visible label goes through `t()`. `defaultValue` is mandatory in case a key is missing.
