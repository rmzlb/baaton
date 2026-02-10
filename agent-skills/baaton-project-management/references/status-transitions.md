# Baaton Status Transitions

## Statuses

| Status | Key | Color | Description |
|--------|-----|-------|-------------|
| Backlog | `backlog` | Gray | Unplanned, needs triage |
| Todo | `todo` | Blue | Planned, ready to pick up |
| In Progress | `in_progress` | Amber | Actively being worked on |
| In Review | `in_review` | Purple | Work done, awaiting human review |
| Done | `done` | Green | Completed and verified |
| Cancelled | `cancelled` | Red | Won't do |

## Standard Flow

```
backlog → todo → in_progress → in_review → done
                                    ↓
                               cancelled
```

## Transition Rules

All transitions are technically allowed, but follow these conventions:

| From | To | When |
|------|----|------|
| backlog | todo | After triage, issue is planned |
| todo | in_progress | Agent/developer starts work |
| in_progress | in_review | Work complete, TLDR posted |
| in_review | done | Human verifies and approves |
| in_review | in_progress | Changes requested, needs rework |
| any | cancelled | Issue is no longer relevant |
| done | in_progress | Bug re-opened, needs more work |

## Agent Guidelines

1. **Never set `done` directly** — always go through `in_review` first
2. **Always post TLDR before** moving to `in_review`
3. **Set `in_progress`** immediately when starting work (signals to other agents)
4. Use `cancelled` only if explicitly told to abandon the work
