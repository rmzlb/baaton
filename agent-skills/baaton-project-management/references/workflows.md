# Baaton Agent Workflows

Common step-by-step workflows for AI agents interacting with Baaton.

---

## 1. Start Working on a Ticket

Use when picking up an assigned issue or starting new work.

```
1. GET /issues/mine?assignee_id=YOUR_ID     → Find assigned issues
2. Pick the highest-priority issue
3. PATCH /issues/{id}                        → {"status": "in_progress"}
4. Read issue.description for requirements
5. Do the work
6. POST /issues/{id}/tldr                    → Post work summary
7. PATCH /issues/{id}                        → {"status": "in_review"}
```

**Example TLDR body:**
```json
{
  "agent_name": "claude-code",
  "summary": "## Changes\n- Fixed null pointer in auth middleware\n- Added input validation for email field\n\n## Testing\n- All existing tests pass\n- Added 2 new test cases for edge cases",
  "files_changed": ["src/middleware/auth.rs", "src/validation.rs", "tests/auth_test.rs"],
  "tests_status": "passed",
  "pr_url": "https://github.com/org/repo/pull/42"
}
```

---

## 2. Report a Bug

Use when you discover a bug during development.

```
1. POST /issues                              → Create bug issue
```

**Body:**
```json
{
  "project_id": "PROJECT_UUID",
  "title": "Auth middleware panics on empty Bearer token",
  "description": "## Bug\nThe auth middleware panics when the Authorization header contains `Bearer ` with no token.\n\n## Steps to Reproduce\n1. Send request with `Authorization: Bearer `\n2. Server panics\n\n## Expected\nReturn 401 Unauthorized\n\n## Actual\nServer crash (500)",
  "type": "bug",
  "priority": "high",
  "tags": ["backend", "auth"]
}
```

---

## 3. Sprint Triage

Use when reviewing and prioritizing the backlog.

```
1. GET /projects/{id}/issues?status=backlog  → Get all backlog items
2. For each issue, assess priority:
   - Critical bugs → priority: "urgent", status: "todo"
   - Important features → priority: "high", status: "todo"
   - Nice-to-haves → priority: "low", keep in backlog
3. PATCH /issues/{id}                        → Update priority + status
4. Optionally assign to milestone:
   PATCH /issues/{id}                        → {"milestone_id": "uuid"}
```

**Triage criteria:**
- **urgent**: Production broken, data loss, security issue
- **high**: Core feature blocked, significant UX issue
- **medium**: Normal priority work
- **low**: Polish, nice-to-have, tech debt

---

## 4. Post Completion Summary (TLDR)

Use after finishing work on any issue. The TLDR system is Baaton's core feature for agent visibility.

```
1. POST /issues/{id}/tldr
```

**Best TLDR format:**
```json
{
  "agent_name": "claude-code",
  "summary": "## Summary\nBrief one-liner of what was done.\n\n## Changes\n- Change 1\n- Change 2\n\n## Notes\nAny caveats or follow-up needed.",
  "files_changed": ["file1.rs", "file2.ts"],
  "tests_status": "passed",
  "pr_url": "https://github.com/..."
}
```

**Rules for good TLDRs:**
- Keep summary under 500 words
- List ALL files changed
- Set `tests_status` accurately: `passed`, `failed`, `skipped`, or `none`
- Include `pr_url` if a PR was created
- Multiple TLDRs per issue are fine (iterations, re-opens)

---

## 5. Create and Plan a Milestone

Use when organizing work into a release or milestone.

```
1. POST /projects/{id}/milestones            → Create milestone
2. GET /projects/{id}/issues?status=backlog   → Review backlog
3. For relevant issues:
   PATCH /issues/{id}                         → {"milestone_id": "milestone_uuid", "status": "todo"}
4. GET /milestones/{id}                       → Verify milestone (shows all linked issues)
```

**Create body:**
```json
{
  "name": "v1.0 MVP Launch",
  "description": "Core features needed for public launch",
  "target_date": "2026-03-15",
  "estimated_days": 21
}
```

**Check progress:**
```
GET /projects/{id}/milestones
```
Response includes `total_issues`, `done_issues`, `bug_count`, `feature_count` per milestone.
