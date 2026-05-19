# Baaton — GitHub Marketplace Listing

Pre-submission checklist for the GitHub Marketplace listing.
This file lives in the repo root for review; not consumed by any tool.

## Listing copy

**Name**: Baaton

**Tagline**: The shareable receipt for every AI agent's work.

**Categories** (pick 2): Project management · AI-assisted development

**Short description** (130 chars max):
The neutral, GitHub-native accountability layer for AI coding agents — Cursor, Devin, Copilot, Claude Code, Codex.

**Long description**:

Every PR you ship now has agents touching the code. None of them remember what they did, who approved it, or which tests ran.

Baaton turns every agent run into a public, shareable receipt. Each completed run gets a stable URL like `r.baaton.dev/<token>` that auto-posts as a markdown comment on the GitHub PR — agent name, files changed, tests status, summary, link back to the full run card.

Vendor-neutral by design: works with Cursor agents, Devin, GitHub Copilot, Claude Code, Codex, OpenClaw, or any agent that hits the Baaton API. Drop a badge in your README, paste a Run Card link in Slack, or just leave the auto-PR-comment to do its job.

Why teams adopt it:
- **Public-by-default Run Cards** with embedded attribution
- **Automatic PR comments** (idempotent — re-runs update, never duplicate)
- **Privacy gates 3-levels** (org → project → session) — opt-in, default private
- **GitHub App** distribution + README badge for OSS repos
- **API-first** — every CRUD op available to agents directly

Built in Rust + React. Open core.

**Screenshots needed** (capture before submit):
- IssueDrawer with AgentRunCard (Publish flow)
- A real `r.baaton.dev/<token>` page in dark mode
- An OG card preview when pasted in Slack
- A PR comment auto-posted on a real PR
- The README badge in context

**Pricing tier**: Free for first GA. Paid tiers TBD (per seat or per agent run).

## Required pre-submission

- [ ] App permissions audit: minimal scopes — `pull_requests:write` (for PR comments), `issues:read`, `metadata:read`, `contents:read` (for repo lookup)
- [ ] Webhook events subscribed: `pull_request`, `pull_request_review`, `push`, `issues`
- [ ] Privacy policy live at https://baaton.dev/privacy
- [ ] Terms of service live at https://baaton.dev/terms
- [ ] Support email working
- [ ] Free trial / free tier defined
- [ ] Logo: 200×200 transparent PNG (use the amber dot + "Baaton" wordmark)
- [ ] Feature image: 1280×640
- [ ] Demo video: 60s, captured from a real org with agents publishing real runs

## Submission link

https://github.com/marketplace/listings/new

(Submit only after the screenshots + demo video are recorded with real data, NOT the smoke-test fake session.)
