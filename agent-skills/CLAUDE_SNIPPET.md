# Baaton Integration Snippet for CLAUDE.md

Copy the section below into your project's `CLAUDE.md` (or `AGENTS.md`, `.cursor/rules`, etc.):

---

```markdown
## Baaton Integration

This project tracks issues on [Baaton](https://baaton.dev).

### Config
- API: `https://api.baaton.dev/api/v1`
- Auth: `Authorization: Bearer $BAATON_API_KEY`
- Project ID: YOUR_PROJECT_UUID

### Key Endpoints
```
GET  /projects/{id}/issues?status=todo     List issues (filter: status, priority, type, search)
GET  /issues/{id}                          Get issue details (includes TLDRs + comments)
GET  /issues/mine?assignee_id=ID           My assigned issues
POST /issues                               Create issue {"project_id","title","type","priority"}
PATCH /issues/{id}                         Update {"status","priority","tags","assignee_ids"}
POST /issues/{id}/tldr                     Post summary {"agent_name","summary","files_changed","tests_status"}
POST /issues/{id}/comments                 Add comment {"author_id","author_name","body"}
```

### Workflow
1. Before starting: `GET /issues/mine` → pick highest priority
2. Starting work: `PATCH /issues/{id}` → `{"status":"in_progress"}`
3. After completing: `POST /issues/{id}/tldr` → post summary
4. Then: `PATCH /issues/{id}` → `{"status":"in_review"}`
5. Found a bug: `POST /issues` with `"type":"bug"`

### Statuses
backlog → todo → in_progress → in_review → done | cancelled

### Types & Priorities
- Types: bug, feature, improvement, question
- Priority: urgent, high, medium, low
```

---

Replace `YOUR_PROJECT_UUID` with your actual project ID from Baaton.
