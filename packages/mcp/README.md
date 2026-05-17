# @baaton/mcp

MCP server bridge for [Baaton](https://baaton.dev) — project management for AI coding agents.

Thin bridge that exposes Baaton's REST API as MCP tools. All logic lives server-side; this package just translates MCP ↔ HTTP.

## Quick Start

```bash
BAATON_API_KEY=baa_your_key npx -y @baaton/mcp
```

## MCP Config

Add to your agent's MCP configuration:

```json
{
  "mcpServers": {
    "baaton": {
      "command": "npx",
      "args": ["-y", "@baaton/mcp"],
      "env": {
        "BAATON_URL": "https://api.baaton.dev/api/v1",
        "BAATON_API_KEY": "baa_your_key_here"
      }
    }
  }
}
```

Works with: Claude Code, Cursor, VS Code, Cline, Windsurf, Gemini CLI, and any MCP client.

## Tools

| Tool | Description |
|------|-------------|
| `baaton_list_projects` | List all projects |
| `baaton_get_project_context` | Get project context (stack, conventions) |
| `baaton_list_issues` | List/filter issues |
| `baaton_get_issue` | Get single issue |
| `baaton_create_issue` | Create issue |
| `baaton_update_issue` | Update issue |
| `baaton_post_tldr` | Post work summary |
| `baaton_search` | Full-text search |
| `baaton_add_comment` | Add comment |
| `baaton_my_issues` | Get assigned issues |

## Why only 10 tools?

Because [your agent already speaks HTTP](https://baaton.dev). The MCP bridge is a convenience layer for agents that prefer MCP. For direct API access (faster, more endpoints, zero wrapper), use the REST API:

```bash
curl https://api.baaton.dev/api/v1/public/docs
```

## License

MIT
