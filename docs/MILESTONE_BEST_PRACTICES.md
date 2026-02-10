# Milestone Tracker — 10/10 Best Practices

## Research Sources
- Linear (milestones on timeline, drag to reorder)
- GitHub (milestones + burndown charts via Zenhub)
- GitLab (burndown + burnup charts)
- Plane.so (cycles + modules)
- Atlassian/Monday.com (dependency tracking, AI planning)
- Zenhub (velocity tracking, ideal vs actual lines)

## Must-Have Features (10/10 Score)

### 1. Milestone Cards (Linear-style)
- Name, description, target date
- **Progress bar** with percentage (done/total issues)
- **Issue type breakdown**: 🐛 bugs, ✨ features, ⚡ improvements (colored counts)
- Status badge: Active (blue), Completed (green), At-risk (amber), Overdue (red)
- **Click to expand** → detail view

### 2. Gantt/Timeline View
- CSS Grid-based (NO external deps)
- X-axis: weeks or months (auto-scaled based on date range)
- Y-axis: milestones (ordered by `order` field)
- **Horizontal bars** from start → target_date
  - Progress fill inside the bar (done %)
  - Color: blue (active), green (completed), amber (at-risk), red (overdue)
- **Today line**: vertical red dashed line
- **Milestone markers**: diamond ◆ on the timeline
- **Drag to reschedule** milestone dates (drag bar ends)
- Hover tooltip with details

### 3. Burndown Chart (per milestone)
- **Ideal line**: straight diagonal (total → 0)
- **Actual line**: real progress (issues closed over time)
- SVG-based (no chart library needed for simple lines)
- Shows if ahead/behind schedule
- X-axis: time (days), Y-axis: remaining issues

### 4. Dependency Visualization
- Issues can have `depends_on` links
- Show blocked issues with 🔒 icon
- **Critical path** highlighting: longest chain of dependencies
- Warn when moving a milestone would break dependency chains

### 5. AI Milestone Planning (our killer feature)
From research:
- AI analyzes all open tickets → proposes logical groupings
- Estimates timing based on issue count + complexity (type, priority)
- Auto-detects dependencies from title/description similarity
- "I want to finish by X" → recalculates entire plan
- Priority suggestion based on dependency chains + business impact
- **Weekly velocity** tracking: actual vs planned burn rate

### 6. Sprint Integration
- Milestones contain sprints
- Sprints are 1-2 week time-boxes within milestones
- Sprint burndown separate from milestone burndown
- Drag issues between sprints

### 7. Filters & Grouping (Linear)
- Filter issues by milestone
- Group board/list view by milestone
- Quick filter: click milestone in sidebar → shows only its issues

### 8. Keyboard Shortcuts (Linear)
- `Shift+M` → assign milestone to issue
- `G M` → go to milestones page

### 9. Status Auto-computation
- If all issues done → auto-complete milestone
- If target_date passed + issues remaining → mark as "at-risk"
- Progress % auto-calculated from done/total

### 10. Export & Reporting
- Milestone summary report (for stakeholders)
- CSV export of milestone data
- Shareable link to milestone view

## Anti-patterns to Avoid
- ❌ Heavy charting libraries (Chart.js, D3) — use SVG/CSS Grid
- ❌ Mandatory sprints — milestones should work without sprints
- ❌ Complex dependency management — keep it simple (just `depends_on` array)
- ❌ Auto-creating milestones without confirmation
- ❌ Rigid Gantt (Jira-style) — keep it fluid and draggable

## UX Guidelines
- Default to **Timeline view** (Gantt) as primary, cards as secondary
- Empty state: "No milestones yet. Ask AI to plan your roadmap 🤖"
- Milestone picker in issue drawer should show progress bars
- Color-code everything: green=on-track, amber=at-risk, red=overdue
- Animation: progress bars should animate when updating
