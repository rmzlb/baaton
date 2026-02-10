# @baaton/agent-skills

[![npm version](https://img.shields.io/npm/v/@baaton/agent-skills.svg)](https://www.npmjs.com/package/@baaton/agent-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Give your AI agent a project board. One command. Full project access.

**Baaton** is a multi-tenant project management board built for AI coding agents. This skill package lets any agent read tickets, update statuses, post work summaries (TLDRs), and manage projects on [baaton.dev](https://baaton.dev).

## Install

```bash
npx skills add @baaton/agent-skills
```

## Quick Start

### 1. Get an API key

Go to [baaton.dev](https://baaton.dev) → Project Settings → API Keys → Generate.

### 2. Configure

```bash
export BAATON_API_KEY=baa_your_key_here
```

Or run the interactive setup:

```bash
./scripts/setup.sh
```

### 3. Your agent is ready

Your agent can now read tickets, create issues, update statuses, and post TLDRs — all through natural language.

## What Your Agent Can Do

| Action | Example Prompt |
|--------|---------------|
| **Read tickets** | "What are my open issues on Baaton?" |
| **Create issues** | "Create a bug report for the login crash" |
| **Update status** | "Move BAA-42 to in_progress" |
| **Post TLDR** | "Post a work summary for BAA-42" |
| **Search issues** | "Find all high-priority bugs" |
| **Plan milestones** | "Create a v1.0 milestone for March 15" |
| **Triage backlog** | "Review and prioritize backlog items" |

## Agent Workflow

```
1. Agent reads assigned issues          GET /issues/mine
2. Picks highest priority one
3. Sets status to in_progress           PATCH /issues/{id}
4. Does the work
5. Posts TLDR summary                   POST /issues/{id}/tldr
6. Moves to in_review                   PATCH /issues/{id}
7. Human reviews and marks done         ✅
```

## Compatible Agents

- **Claude Code** — `.claude/skills/`
- **Codex (OpenAI)** — `.codex/skills/`
- **OpenClaw** — `.openclaw/skills/`
- **Cursor** — `.cursor/skills/`
- **Windsurf** — `.windsurf/skills/`

## Package Contents

```
baaton-project-management/
├── SKILL.md                    # Core instructions (loaded into agent context)
├── scripts/
│   ├── baaton-api.sh           # API helper (curl wrapper with auth)
│   └── setup.sh                # Interactive setup wizard
└── references/
    ├── api-reference.md        # Full REST API documentation
    ├── workflows.md            # Step-by-step agent workflows
    └── status-transitions.md   # Kanban status flow guide
```

## Manual Install (CLAUDE.md)

If you prefer copy-paste over `npx skills add`, see [CLAUDE_SNIPPET.md](./CLAUDE_SNIPPET.md) for a minimal snippet to add to your project's `CLAUDE.md`.

## Links

- 🌐 [baaton.dev](https://baaton.dev) — Dashboard
- 📖 [API Reference](./baaton-project-management/references/api-reference.md) — Full endpoint docs
- 🐛 [Issues](https://github.com/baaton-dev/agent-skills/issues) — Report bugs

## License

MIT © [Baaton](https://baaton.dev)
