# Connecting AI Agents to Baaton

This guide explains how to integrate AI coding agents (Claude Code, Codex, custom agents) with Baaton's REST API.

---

## Overview

Baaton acts as the orchestration layer between human decision-makers and AI agents:

```
Human (Baaton UI)           AI Agent
    │                          │
    ├── Create ticket ─────►   │
    ├── Set priority ──────►   │
    │                          ├── Poll for tickets (GET /issues?status=todo)
    │                          ├── Read ticket details (GET /issues/{id})
    │                          ├── Work on code
    │                          ├── Update status → in_progress (PATCH /issues/{id})
    │                          ├── Post TLDR summary (POST /issues/{id}/tldr)
    │                          └── Update status → in_review (PATCH /issues/{id})
    ├── Review work  ◄─────    │
    ├── Approve / Reject       │
    └── Mark Done              │
```

---

## Step 1: Create an API Key

### Via the UI

1. Log in to [baaton.dev](https://baaton.dev)
2. Go to **Settings → API Keys**
3. Click **Generate New API Key**
4. Enter a name (e.g., `claude-code-prod`)
5. **Copy the key immediately** — it's only shown once!

### Via the API (if you have a Clerk JWT)

```bash
curl -X POST https://api.baaton.dev/api/v1/api-keys \
  -H "Authorization: Bearer $CLERK_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Response includes the full key:

```json
{
  "data": {
    "id": "...",
    "key": "baa_abc123def456ghi789jkl012mno345",
    "key_prefix": "baa_abc1",
    "name": "my-agent",
    "permissions": ["read", "write"]
  }
}
```

Store the `key` field securely. It won't be shown again.

---

## Step 2: Find Your Project ID

```bash
export BAATON_KEY="baa_your_key_here"
export API="https://api.baaton.dev/api/v1"

# List all projects — grab the id and prefix
curl -s -H "Authorization: Bearer $BAATON_KEY" \
  "$API/projects" | jq '.data[] | {id, name, prefix, slug}'
```

Output:
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "My SaaS App",
  "prefix": "MSA",
  "slug": "my-saas-app"
}
```

Save the `id` as your `PROJECT_ID`.

---

## Step 3: Agent Workflow

A typical agent loop in 5 steps:

### 1. Pull Available Tickets

```bash
# Get all "todo" tickets, sorted by position
curl -s -H "Authorization: Bearer $BAATON_KEY" \
  "$API/projects/$PROJECT_ID/issues?status=todo" \
  | jq '.data[] | {id, display_id, title, priority, tags}'
```

You can filter further:
```bash
# High-priority bugs only
?status=todo&priority=high&type=bug

# Search by title
?status=todo&search=oauth

# Limit results
?status=todo&limit=5
```

### 2. Claim a Ticket (Set to In Progress)

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $BAATON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}' \
  "$API/issues/$ISSUE_ID" | jq
```

### 3. Read Full Ticket Details

```bash
curl -s -H "Authorization: Bearer $BAATON_KEY" \
  "$API/issues/$ISSUE_ID" | jq '.data'
```

Key fields to read:
- `title` — What to do
- `description` — Detailed requirements (markdown)
- `type` — bug / feature / improvement / question
- `priority` — urgent / high / medium / low
- `tags` — Additional context labels

### 4. Do the Work

The agent reads the ticket description, writes code, runs tests, etc. This is your agent's core logic.

### 5. Post a TLDR

> **Note:** The TLDR endpoint (`POST /issues/{id}/tldr`) is defined in the data model but the backend route handler is not yet implemented. The schema and model are ready — see `backend/src/models/mod.rs` (`CreateTldr` struct) and `backend/migrations/001_init.sql` (`tldrs` table).

```bash
curl -s -X POST \
  -H "Authorization: Bearer $BAATON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "claude-code",
    "summary": "Refactored auth module to use JWT tokens. Added refresh token rotation.",
    "files_changed": ["src/auth/jwt.ts", "src/auth/refresh.ts", "tests/auth.test.ts"],
    "tests_status": "passed",
    "pr_url": "https://github.com/org/repo/pull/42"
  }' \
  "$API/issues/$ISSUE_ID/tldr" | jq
```

### 6. Move to Review

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $BAATON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review"}' \
  "$API/issues/$ISSUE_ID" | jq
```

---

## Claude Code Integration

### AGENTS.md Configuration

Add this to your project's `AGENTS.md` so Claude Code knows how to interact with Baaton:

```markdown
## Baaton Integration

When starting a task, check Baaton for assigned tickets:

\`\`\`bash
export BAATON_KEY="baa_your_key_here"
export BAATON_API="https://api.baaton.dev/api/v1"
export PROJECT_ID="your-project-uuid"

# List todo issues
curl -s -H "Authorization: Bearer $BAATON_KEY" \
  "$BAATON_API/projects/$PROJECT_ID/issues?status=todo" \
  | jq '.data[] | {id, display_id, title, priority}'
\`\`\`

After completing work:

\`\`\`bash
# Post TLDR
curl -s -X POST \
  -H "Authorization: Bearer $BAATON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "claude-code",
    "summary": "SUMMARY_HERE",
    "files_changed": ["file1.ts", "file2.ts"],
    "tests_status": "passed"
  }' \
  "$BAATON_API/issues/ISSUE_ID/tldr"

# Mark as review
curl -s -X PATCH \
  -H "Authorization: Bearer $BAATON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_review"}' \
  "$BAATON_API/issues/ISSUE_ID"
\`\`\`
```

### Environment Setup

Set the API key as an environment variable in your Claude Code session:

```bash
export BAATON_KEY="baa_abc123def456..."
```

Or store it in a `.env` file that Claude Code can read.

---

## Codex Integration

OpenAI Codex agents follow the same REST API pattern:

```python
import os
import requests

BAATON_API = "https://api.baaton.dev/api/v1"
BAATON_KEY = os.environ["BAATON_KEY"]
HEADERS = {
    "Authorization": f"Bearer {BAATON_KEY}",
    "Content-Type": "application/json",
}

def get_todo_issues(project_id: str):
    """Pull tickets that are ready to work on."""
    resp = requests.get(
        f"{BAATON_API}/projects/{project_id}/issues",
        headers=HEADERS,
        params={"status": "todo"},
    )
    return resp.json()["data"]

def claim_issue(issue_id: str):
    """Mark an issue as in-progress."""
    requests.patch(
        f"{BAATON_API}/issues/{issue_id}",
        headers=HEADERS,
        json={"status": "in_progress"},
    )

def post_tldr(issue_id: str, summary: str, files: list[str], tests: str = "none"):
    """Post a TLDR after completing work."""
    requests.post(
        f"{BAATON_API}/issues/{issue_id}/tldr",
        headers=HEADERS,
        json={
            "agent_name": "codex",
            "summary": summary,
            "files_changed": files,
            "tests_status": tests,
        },
    )

def submit_for_review(issue_id: str):
    """Move issue to review."""
    requests.patch(
        f"{BAATON_API}/issues/{issue_id}",
        headers=HEADERS,
        json={"status": "in_review"},
    )
```

---

## Custom Agent Loop (TypeScript)

Complete agent loop example:

```typescript
const BAATON_API = "https://api.baaton.dev/api/v1";
const API_KEY = process.env.BAATON_KEY!;
const PROJECT_ID = process.env.BAATON_PROJECT_ID!;

interface Issue {
  id: string;
  display_id: string;
  title: string;
  description: string | null;
  priority: string | null;
  tags: string[];
}

async function baaton<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BAATON_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json.data;
}

async function agentLoop() {
  // 1. Get next ticket
  const issues: Issue[] = await baaton(
    "GET",
    `/projects/${PROJECT_ID}/issues?status=todo&limit=1`
  );
  if (issues.length === 0) {
    console.log("No tickets to work on.");
    return;
  }

  const issue = issues[0];
  console.log(`Working on ${issue.display_id}: ${issue.title}`);

  // 2. Claim it
  await baaton("PATCH", `/issues/${issue.id}`, { status: "in_progress" });

  // 3. Do the work (your agent logic here)
  const result = await doWork(issue);

  // 4. Post TLDR
  await baaton("POST", `/issues/${issue.id}/tldr`, {
    agent_name: "my-agent",
    summary: result.summary,
    files_changed: result.filesChanged,
    tests_status: result.testsStatus,
  });

  // 5. Submit for review
  await baaton("PATCH", `/issues/${issue.id}`, { status: "in_review" });
  console.log(`${issue.display_id} submitted for review.`);
}

async function doWork(issue: Issue) {
  // Your agent logic here
  return {
    summary: "Implemented the feature as described.",
    filesChanged: ["src/feature.ts"],
    testsStatus: "passed" as const,
  };
}

// Run
agentLoop().catch(console.error);
```

---

## TLDR Fields

When posting a TLDR, include as much context as possible:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_name` | string | ✅ | Your agent's name (e.g., `claude-code`, `codex`, `my-bot`) |
| `summary` | string | ✅ | Markdown summary of what was done |
| `files_changed` | string[] | ❌ | List of files modified |
| `tests_status` | enum | ❌ | `passed` / `failed` / `skipped` / `none` (default: `none`) |
| `pr_url` | string | ❌ | Link to the pull request |

### Good TLDR Example

```json
{
  "agent_name": "claude-code",
  "summary": "## OAuth Implementation\n\n- Added Google OAuth provider (`src/auth/google.ts`)\n- Added GitHub OAuth provider (`src/auth/github.ts`)\n- Created shared OAuth callback handler\n- Added token refresh logic with rotation\n- 12 new tests, all passing\n\n### Breaking Changes\n- `AUTH_PROVIDERS` env var now required",
  "files_changed": [
    "src/auth/google.ts",
    "src/auth/github.ts",
    "src/auth/callback.ts",
    "src/auth/refresh.ts",
    "tests/auth/oauth.test.ts"
  ],
  "tests_status": "passed",
  "pr_url": "https://github.com/org/repo/pull/42"
}
```

---

## MCP Server (Planned)

We plan to build an MCP (Model Context Protocol) server for native AI agent integration:

```json
{
  "mcpServers": {
    "baaton": {
      "command": "npx",
      "args": ["-y", "@baaton/mcp-server"],
      "env": {
        "BAATON_API_KEY": "baa_your_key_here",
        "BAATON_PROJECT_ID": "your-project-uuid"
      }
    }
  }
}
```

Planned tools:
- `baaton_list_issues` — List issues with filters
- `baaton_get_issue` — Get full issue details
- `baaton_update_status` — Change issue status
- `baaton_post_tldr` — Submit work summary
- `baaton_create_issue` — Create a new issue

---

## Best Practices

1. **One agent per API key** — Makes it easy to track which agent did what via `last_used_at`
2. **Claim before working** — Set status to `in_progress` immediately to avoid conflicts with other agents
3. **Detailed TLDRs** — Include file lists, test status, and PR links for human reviewers
4. **Handle failures** — If work fails, update the issue status back to `todo` or add a comment explaining why
5. **Respect rate limits** — 100 req/min per API key; use polling intervals of ≥30 seconds
6. **Use `display_id` for logging** — More readable than UUIDs (`MSA-42` vs `a1b2c3d4-...`)
7. **Filter intelligently** — Use query params (`?status=todo&priority=high&type=bug`) instead of fetching everything

---

## Troubleshooting

### 401 Unauthorized
- Check your API key is correct and not revoked
- API keys start with `baa_`
- Ensure the `Authorization` header uses `Bearer` prefix

### 404 Not Found
- Verify the project/issue UUID is correct
- For public endpoints, verify the project slug (not UUID)
- Check the endpoint path includes `/api/v1/`

### Empty results
- Check the `status` filter — issues default to `todo`, not `backlog`
- Verify the project has issues: try without any query params first
- Check `limit` and `offset` pagination

### Rate limited (429)
- Default: 100 req/min per API key
- Implement exponential backoff
- Poll less frequently (every 30-60 seconds)
