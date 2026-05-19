# Baaton backend tests

## Layout

- `smoke.sh` — black-box HTTP smoke tests against a running backend (used post-deploy).
- Inline `#[cfg(test)] mod tests { ... }` — unit tests for pure functions, runnable with `cargo test`.

## Running unit tests

```bash
cd backend
cargo test
```

Notable unit-test surfaces:

- `routes::agent_sessions::should_enqueue_pr_comment` — gate predicate for the
  `post_run_comment` background job.
- `routes::public_run_ssr::truncate_chars` — char-boundary-safe truncation for
  multibyte summaries (regression: French accents used to panic on byte slicing).

## Running the smoke script

```bash
BAATON_API_KEY=baa_xxx ./tests/smoke.sh https://api.baaton.dev
```

## Deferred — integration test for publish → enqueue → Octocrab loop

A proper integration test for the agent-session → `github_sync_jobs` enqueue
loop would assert, against a real Postgres pool, that:

1. `publish` on a session with `pr_url` set inserts a `post_run_comment` row.
2. `update` to `status=completed` on a public session with `pr_url` enqueues
   a row.
3. `update` that changes `pr_url` clears `pr_comment_id` (so the next comment
   doesn't try to PATCH a stale GitHub comment that lives on the old PR).

This requires non-trivial scaffolding that does not exist yet:

- A `DATABASE_URL_TEST` pointing at a throwaway Postgres
  (or testcontainers-rs spinning one up per run).
- A migration runner invocation in test setup (`sqlx::migrate!` against the
  test pool).
- Org/project/issue/session fixtures (per test, with cleanup or transaction
  rollback).
- A way to run the axum router in-process (or extract the relevant handlers
  into pure-async fns that take `&PgPool` directly).

**Estimate:** half a day to set up properly — out of scope for the initial
post-launch hardening pass.

**Until then:** the predicate at the heart of the loop
(`should_enqueue_pr_comment`) is unit-tested in isolation, and the smoke
script (`smoke.sh`) provides black-box coverage of the public surface
(SSR, OG, public/runs/{token}, agent-sessions CRUD).
