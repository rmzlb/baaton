# Baaton Agent Skills — Implementation Plan

> **"Give AI agents superpowers. Give them Baaton."**

## Executive Summary

Baaton needs to be accessible to AI coding agents (Claude Code, Codex, OpenClaw, Cursor, Windsurf) as a first-class integration. The goal: any agent can `npx skills add baaton-dev/agent-skills` and immediately know how to read tickets, update statuses, post TLDRs, and manage projects.

**Three distribution channels, in priority order:**

| Channel | Format | Target Agents | Effort |
|---------|--------|---------------|--------|
| 1. **Agent Skill** (`npx skills add`) | SKILL.md + scripts | Claude Code, Codex, OpenClaw, Cursor | 2 days |
| 2. **MCP Server** (`npx @baaton/mcp-server`) | JSON-RPC over stdio | Claude Desktop, any MCP client | 3-5 days |
| 3. **CLAUDE.md snippet** (copy-paste) | Markdown in repo | Claude Code (zero-install) | 1 day |

---

## 1. Agent Skill (Priority #1)

### Why Agent Skills > MCP

- **Agent Skills = recipes** (instructions + scripts). They're lightweight, install instantly, work across all major agents.
- **MCP = infrastructure** (running server process). More powerful but heavier, requires process management.
- **Vercel's `npx skills add`** is becoming the standard distribution mechanism (Jan 2026). Linear, Supabase, Vercel all ship skills this way.

### Structure

```
baaton-agent-skills/
├── baaton-project-management/
│   ├── SKILL.md                    # Core skill instructions
│   ├── scripts/
│   │   ├── baaton-api.sh           # API helper (curl wrapper with auth)
│   │   └── setup.sh               # Interactive setup (API key config)
│   └── references/
│       ├── api-reference.md        # Full REST API docs
│       ├── workflows.md            # Common workflows (triage, sprint, release)
│       └── prd-template.md         # PRD template for generate_prd
├── package.json                    # npm package metadata
├── README.md                       # GitHub readme + install instructions
└── LICENSE                         # MIT
```

### SKILL.md Content

```yaml
---
name: baaton-project-management
description: |
  Manage projects, issues, and sprints on Baaton (baaton.dev) — a multi-tenant
  orchestration board for AI coding agents. Use when:
  (1) Reading or searching tickets/issues across projects
  (2) Creating new issues (bugs, features, improvements)
  (3) Updating issue status, priority, assignees, or tags
  (4) Posting TLDRs (work summaries) after completing tasks
  (5) Reading PRDs or project documentation
  (6) Planning milestones or analyzing sprint velocity
  (7) Managing project boards (kanban status transitions)
  Trigger words: ticket, issue, bug, feature, backlog, sprint, milestone,
  kanban, baaton, TLDR, project board, triage, prioritize
---
```

**Body sections:**
1. **Setup** — How to configure API key (`BAATON_API_KEY` env var or `.baaton` file)
2. **Authentication** — API key format (`baa_xxx`), how to generate one
3. **Core Workflows** — Step-by-step for each action
4. **API Quick Reference** — Endpoints, request/response examples
5. **Status Transitions** — Valid status flows (backlog→todo→in_progress→...)
6. **Best Practices** — When to post TLDRs, how to format descriptions, tag conventions
7. **Error Handling** — Common errors and fixes

### scripts/baaton-api.sh

```bash
#!/bin/bash
# Baaton API helper — wraps curl with auth and error handling
# Usage: ./baaton-api.sh GET /projects
#        ./baaton-api.sh POST /issues '{"title":"Fix login"}'

BAATON_URL="${BAATON_API_URL:-https://api.baaton.dev}"
BAATON_KEY="${BAATON_API_KEY}"

if [ -z "$BAATON_KEY" ]; then
  # Try reading from .baaton config
  if [ -f ".baaton" ]; then
    BAATON_KEY=$(grep '^api_key=' .baaton | cut -d= -f2)
  fi
fi

METHOD="$1"; ENDPOINT="$2"; BODY="$3"
curl -s -X "$METHOD" "${BAATON_URL}/api/v1${ENDPOINT}" \
  -H "Authorization: Bearer ${BAATON_KEY}" \
  -H "Content-Type: application/json" \
  ${BODY:+-d "$BODY"}
```

### Distribution

```bash
# Users install with:
npx skills add baaton-dev/baaton-agent-skills

# Or globally:
npx skills add -g baaton-dev/baaton-agent-skills

# Works with all agents:
# - Claude Code: .claude/skills/baaton-project-management/
# - Codex: .codex/skills/baaton-project-management/  
# - OpenClaw: .openclaw/skills/baaton-project-management/
# - Cursor: .cursor/skills/baaton-project-management/
```

### npm Package

```json
{
  "name": "@baaton/agent-skills",
  "version": "1.0.0",
  "description": "AI agent skills for Baaton project management",
  "repository": "baaton-dev/baaton-agent-skills",
  "keywords": ["agent-skills", "ai", "project-management", "baaton", "claude", "codex"],
  "license": "MIT"
}
```

---

## 2. MCP Server (Priority #2)

### Why MCP Too?

- Claude Desktop uses MCP natively (not skills)
- MCP provides **typed tools** with JSON Schema — more structured than markdown instructions
- MCP supports **streaming**, **resources** (read project data as context), and **prompts**

### Structure

```
@baaton/mcp-server/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   ├── issues.ts         # list, create, update, search issues
│   │   ├── projects.ts       # list, get projects
│   │   ├── tldrs.ts          # post TLDR
│   │   ├── milestones.ts     # list, create milestones
│   │   └── comments.ts       # add comment
│   ├── resources/
│   │   ├── project-board.ts  # Expose kanban board as readable resource
│   │   └── prd.ts            # Expose PRDs as resources
│   └── prompts/
│       ├── triage.ts         # "Triage this issue" prompt template
│       └── sprint-plan.ts    # "Plan next sprint" prompt template
├── package.json
├── tsconfig.json
└── README.md
```

### MCP Tools (14 tools)

| Tool | Description |
|------|-------------|
| `baaton_list_projects` | List all projects in org |
| `baaton_search_issues` | Search/filter issues (status, priority, tags, text) |
| `baaton_get_issue` | Get issue details (with comments, TLDRs) |
| `baaton_create_issue` | Create new issue |
| `baaton_update_issue` | Update status, priority, assignee, tags |
| `baaton_bulk_update` | Bulk status/priority changes |
| `baaton_add_comment` | Add comment to issue |
| `baaton_post_tldr` | Post agent work summary |
| `baaton_list_milestones` | List milestones with progress |
| `baaton_create_milestone` | Create milestone |
| `baaton_get_metrics` | Project metrics (status breakdown, velocity) |
| `baaton_list_tags` | List project tags |
| `baaton_public_submit` | Submit issue via public form |
| `baaton_activity_feed` | Recent activity log |

### Usage

```json
{
  "mcpServers": {
    "baaton": {
      "command": "npx",
      "args": ["-y", "@baaton/mcp-server"],
      "env": {
        "BAATON_API_KEY": "baa_your_key_here",
        "BAATON_API_URL": "https://api.baaton.dev"
      }
    }
  }
}
```

---

## 3. CLAUDE.md Snippet (Priority #3 — Simplest)

For projects that just need quick integration without installing anything:

```markdown
<!-- Add to your project's CLAUDE.md -->

## Baaton Integration

This project uses Baaton (baaton.dev) for issue tracking.

### API Access
- Base URL: https://api.baaton.dev/api/v1
- Auth: `Authorization: Bearer $BAATON_API_KEY`
- Project: PROJECT_SLUG (prefix: XXX)

### Key Endpoints
- `GET /projects/{id}/issues?status=todo` — List open issues
- `POST /issues` — Create issue `{"project_id":"...","title":"...","type":"bug"}`
- `PATCH /issues/{id}` — Update `{"status":"in_progress"}`
- `POST /issues/{id}/tldr` — Post summary `{"agent_name":"claude","summary":"..."}`

### Workflow
1. Before starting work: Check assigned issues (`GET /issues/mine`)
2. Starting work: Move to `in_progress`
3. After completing: Post TLDR + move to `in_review`
4. Found a bug: Create new issue with type `bug`
```

---

## 4. Implementation Roadmap

### Phase 1: Agent Skill (Week 1)
- [ ] Create `baaton-dev/baaton-agent-skills` GitHub repo
- [ ] Write SKILL.md with full API reference
- [ ] Write `baaton-api.sh` helper script
- [ ] Write `setup.sh` (interactive API key config)
- [ ] Write workflow reference docs
- [ ] Test with Claude Code, Codex, OpenClaw
- [ ] Publish to npm as `@baaton/agent-skills`
- [ ] Add install instructions to landing page

### Phase 2: MCP Server (Week 2)
- [ ] Create `@baaton/mcp-server` package
- [ ] Implement 14 tools with JSON Schema
- [ ] Add resources (project board, PRDs)
- [ ] Add prompt templates (triage, sprint plan)
- [ ] Test with Claude Desktop
- [ ] Publish to npm
- [ ] List on mcp.so / mcpservers.org

### Phase 3: Landing Page & Docs (Week 3)
- [ ] Add "Agent Integration" section to baaton.dev
- [ ] Create /docs/agents page with install guide
- [ ] Add "Connect your AI" onboarding step
- [ ] Create demo video/GIF
- [ ] Blog post: "How to give your AI agent a project board"

---

## 5. Backend Prerequisites

Before shipping the skill, these API features need to work:

| Feature | Status | Needed For |
|---------|--------|------------|
| API key auth (baa_xxx) | ⚠️ Partial (routes exist, UI needed) | All channels |
| `GET /issues/mine` | ❌ Missing | Agent workflow |
| `POST /issues/:id/tldr` | ✅ Done | TLDR posting |
| Rate limiting per key | ⚠️ Planned | Production safety |
| Agent-specific endpoints | ❌ Missing | `/api/v1/agent/*` |
| Webhook on status change | ❌ Missing | Real-time notifications |

### New Agent Endpoints Needed

```
GET  /api/v1/agent/issues          — List issues assigned to this agent/key
GET  /api/v1/agent/issues/:id      — Get issue with full context
PATCH /api/v1/agent/issues/:id     — Update status/priority
POST /api/v1/agent/issues/:id/tldr — Post work summary  
GET  /api/v1/agent/projects        — List accessible projects
```

These mirror the existing endpoints but:
- Auth via API key (not Clerk JWT)
- Scoped to the key's org
- Simplified response (no org metadata)

---

## 6. Marketing Angle

### Landing Page Copy

> **"Your AI agent just got a project manager."**
>
> Connect Claude Code, Codex, or any AI agent to Baaton in 30 seconds.
> One command. Full project access. Zero configuration.
>
> ```bash
> npx skills add @baaton/agent-skills
> ```
>
> Your agent can now read tickets, update statuses, post work summaries,
> and create new issues — all from within your codebase.

### Key Differentiators vs Linear/GitHub

| Feature | Baaton | Linear | GitHub Issues |
|---------|--------|--------|---------------|
| `npx skills add` | ✅ | ❌ | ❌ |
| MCP server | ✅ | ✅ (community) | ✅ (official) |
| Agent-first API | ✅ (designed for it) | ❌ (human API) | ❌ (human API) |
| TLDR system | ✅ (built-in) | ❌ | ❌ |
| Public submission + LLM qualifier | ✅ | ❌ | ❌ |
| Self-hosted | ✅ | ❌ | ❌ |

---

## 7. Competitive Moat

The skill is the **distribution channel** for Baaton adoption:
1. Dev installs skill → agent uses Baaton → team adopts Baaton
2. Every `npx skills add @baaton/agent-skills` = potential paid user
3. The TLDR system is unique — no other PM tool has agent work summaries built-in
4. Self-hosted + agent-first = underserved market

---

*Created: 2026-02-10*
*Author: Haroz 🦞*
