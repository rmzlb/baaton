import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Layers, Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, AlertTriangle,
  Search, Filter, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { timeAgo, cn } from '@/lib/utils';
import type { Issue, IssuePriority, IssueType } from '@/lib/types';

// ─── Config ──────────────────────────────────
const typeIcons: Record<IssueType, typeof Bug> = {
  bug: Bug, feature: Sparkles, improvement: Zap, question: HelpCircle,
};
const typeColors: Record<IssueType, string> = {
  bug: 'text-red-400', feature: 'text-emerald-400',
  improvement: 'text-blue-400', question: 'text-purple-400',
};
const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: '#ef4444', label: 'Urgent' },
  high: { icon: ArrowUp, color: '#f97316', label: 'High' },
  medium: { icon: Minus, color: '#eab308', label: 'Medium' },
  low: { icon: ArrowDown, color: '#6b7280', label: 'Low' },
};
const statusConfig: Record<string, { color: string; label: string }> = {
  backlog: { color: '#6b7280', label: 'Backlog' },
  todo: { color: '#3b82f6', label: 'Todo' },
  in_progress: { color: '#f59e0b', label: 'In Progress' },
  in_review: { color: '#8b5cf6', label: 'In Review' },
  done: { color: '#22c55e', label: 'Done' },
  cancelled: { color: '#ef4444', label: 'Cancelled' },
};
const CATEGORY_COLORS: Record<string, string> = {
  FRONT: '#3b82f6', BACK: '#22c55e', API: '#8b5cf6', DB: '#f97316',
};

type GroupBy = 'project' | 'status' | 'priority';
type SortBy = 'updated' | 'created' | 'priority' | 'title';

export function AllIssues() {
  const apiClient = useApi();
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Fetch all projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Fetch all issues from all projects
  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: ['all-issues', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map((p) =>
          apiClient.issues.listByProject(p.id, { limit: 500 }).catch(() => [] as Issue[]),
        ),
      );
      return results.flat();
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  // Apply filters
  const filtered = useMemo(() => {
    let result = allIssues;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.display_id.toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q),
      );
    }
    if (statusFilter.length > 0) {
      result = result.filter((i) => statusFilter.includes(i.status));
    }
    if (priorityFilter.length > 0) {
      result = result.filter((i) => i.priority && priorityFilter.includes(i.priority));
    }
    if (categoryFilter.length > 0) {
      result = result.filter((i) => (i.category || []).some((c) => categoryFilter.includes(c)));
    }
    if (projectFilter.length > 0) {
      result = result.filter((i) => projectFilter.includes(i.project_id));
    }

    return result;
  }, [allIssues, search, statusFilter, priorityFilter, categoryFilter, projectFilter]);

  // Sort
  const sorted = useMemo(() => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'priority': {
          const pa = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 99;
          const pb = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 99;
          return pa - pb;
        }
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }, [filtered, sortBy]);

  // Group
  const grouped = useMemo(() => {
    const groups: Record<string, { label: string; issues: Issue[]; color?: string }> = {};

    for (const issue of sorted) {
      let key: string;
      let label: string;
      let color: string | undefined;

      switch (groupBy) {
        case 'project': {
          key = issue.project_id;
          const p = projectMap[issue.project_id];
          label = p ? `${p.prefix} — ${p.name}` : issue.project_id;
          break;
        }
        case 'status':
          key = issue.status;
          label = statusConfig[issue.status]?.label || issue.status;
          color = statusConfig[issue.status]?.color;
          break;
        case 'priority':
          key = issue.priority || 'none';
          label = issue.priority
            ? priorityConfig[issue.priority as IssuePriority]?.label || issue.priority
            : 'No Priority';
          color = issue.priority
            ? priorityConfig[issue.priority as IssuePriority]?.color
            : '#6b7280';
          break;
      }

      if (!groups[key]) groups[key] = { label, issues: [], color };
      groups[key].issues.push(issue);
    }

    return groups;
  }, [sorted, groupBy, projectMap]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasFilters = statusFilter.length + priorityFilter.length + categoryFilter.length + projectFilter.length > 0;

  const clearAllFilters = () => {
    setStatusFilter([]);
    setPriorityFilter([]);
    setCategoryFilter([]);
    setProjectFilter([]);
    setSearch('');
  };

  // Find selected issue for drawer
  const selectedIssue = allIssues.find((i) => i.id === selectedIssueId);

  // ─── Filter dropdown helper ──────────────────
  function MultiSelect({
    label,
    options,
    selected,
    onChange,
  }: {
    label: string;
    options: { value: string; label: string; color?: string }[];
    selected: string[];
    onChange: (val: string[]) => void;
  }) {
    const [open, setOpen] = useState(false);
    const toggle = (val: string) =>
      onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);

    return (
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
            selected.length > 0
              ? 'border-accent text-accent bg-accent/5'
              : 'border-border text-secondary hover:border-secondary',
          )}
        >
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-accent text-black px-1.5 text-[10px] font-bold">
              {selected.length}
            </span>
          )}
          <ChevronDown size={12} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border border-border bg-surface shadow-xl py-1 min-w-[160px]">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors"
                >
                  <span
                    className={cn(
                      'h-3.5 w-3.5 rounded border flex items-center justify-center text-[10px]',
                      selected.includes(opt.value)
                        ? 'bg-accent border-accent text-black'
                        : 'border-border',
                    )}
                  >
                    {selected.includes(opt.value) && '✓'}
                  </span>
                  {opt.color && (
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: opt.color }}
                    />
                  )}
                  <span className="text-primary">{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        Loading all issues…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 md:px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
              <Layers size={20} className="text-accent" />
              All Issues
            </h1>
            <p className="text-xs text-secondary font-mono uppercase tracking-wider">
              {filtered.length} of {allIssues.length} issues · {projects.length} projects
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Group by */}
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-primary outline-none focus:border-accent"
            >
              <option value="project">Group: Project</option>
              <option value="status">Group: Status</option>
              <option value="priority">Group: Priority</option>
            </select>

            {/* Sort by */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-primary outline-none focus:border-accent"
            >
              <option value="updated">Sort: Updated</option>
              <option value="created">Sort: Created</option>
              <option value="priority">Sort: Priority</option>
              <option value="title">Sort: Title</option>
            </select>

            {/* Toggle filters */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                hasFilters
                  ? 'border-accent text-accent'
                  : 'border-border text-secondary hover:border-secondary',
              )}
            >
              <Filter size={12} />
              Filters
              {hasFilters && (
                <span className="rounded-full bg-accent text-black px-1.5 text-[10px] font-bold">
                  {statusFilter.length + priorityFilter.length + categoryFilter.length + projectFilter.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search + Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues…"
              className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-primary placeholder-muted outline-none focus:border-accent"
            />
          </div>

          {showFilters && (
            <>
              <MultiSelect
                label="Status"
                options={Object.entries(statusConfig).map(([k, v]) => ({
                  value: k, label: v.label, color: v.color,
                }))}
                selected={statusFilter}
                onChange={setStatusFilter}
              />
              <MultiSelect
                label="Priority"
                options={Object.entries(priorityConfig).map(([k, v]) => ({
                  value: k, label: v.label, color: v.color,
                }))}
                selected={priorityFilter}
                onChange={setPriorityFilter}
              />
              <MultiSelect
                label="Category"
                options={Object.keys(CATEGORY_COLORS).map((k) => ({
                  value: k, label: k, color: CATEGORY_COLORS[k],
                }))}
                selected={categoryFilter}
                onChange={setCategoryFilter}
              />
              <MultiSelect
                label="Project"
                options={projects.map((p) => ({
                  value: p.id, label: `${p.prefix} — ${p.name}`,
                }))}
                selected={projectFilter}
                onChange={setProjectFilter}
              />
              {hasFilters && (
                <button
                  onClick={clearAllFilters}
                  className="flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors"
                >
                  <X size={12} /> Clear all
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {Object.keys(grouped).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Layers size={40} className="text-border mb-3" />
            <p className="text-sm text-secondary">No issues match your filters</p>
            {hasFilters && (
              <button
                onClick={clearAllFilters}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([key, group]) => {
              const isCollapsed = collapsedGroups.has(key);

              return (
                <div key={key}>
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(key)}
                    className="flex items-center gap-2 mb-2 w-full text-left group"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} className="text-muted" />
                    ) : (
                      <ChevronDown size={14} className="text-muted" />
                    )}
                    {group.color && (
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                    )}
                    {groupBy === 'project' && projectMap[key] && (
                      <span className="h-6 w-6 rounded-md bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                        {projectMap[key].prefix.slice(0, 2)}
                      </span>
                    )}
                    <h2 className="text-sm font-semibold text-primary group-hover:text-accent transition-colors">
                      {group.label}
                    </h2>
                    <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted font-mono">
                      {group.issues.length}
                    </span>
                  </button>

                  {/* Issue rows */}
                  {!isCollapsed && (
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                      {group.issues.map((issue, idx) => {
                        const TypeIcon = typeIcons[issue.type] ?? Sparkles;
                        const priority = issue.priority
                          ? priorityConfig[issue.priority as IssuePriority]
                          : null;
                        const PriorityIcon = priority?.icon;
                        const project = projectMap[issue.project_id];
                        const borderColor = priority?.color || 'transparent';

                        return (
                          <div
                            key={issue.id}
                            onClick={() => openDetail(issue.id)}
                            className={cn(
                              'flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-hover transition-colors min-h-[40px]',
                              idx < group.issues.length - 1 && 'border-b border-border/50',
                            )}
                            style={{ borderLeft: `3px solid ${borderColor}` }}
                          >
                            {/* Status dot */}
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  statusConfig[issue.status]?.color || '#6b7280',
                              }}
                            />

                            {/* Type */}
                            <TypeIcon size={13} className={typeColors[issue.type]} />

                            {/* ID */}
                            <span className="text-[10px] font-mono text-muted shrink-0 w-16">
                              {issue.display_id}
                            </span>

                            {/* Title */}
                            <span className="text-sm text-primary truncate flex-1">
                              {issue.title}
                            </span>

                            {/* Category badges */}
                            {(issue.category || []).map((cat) => (
                              <span
                                key={cat}
                                className="rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0 hidden lg:inline"
                                style={{
                                  backgroundColor: `${CATEGORY_COLORS[cat] || '#6b7280'}20`,
                                  color: CATEGORY_COLORS[cat] || '#6b7280',
                                }}
                              >
                                {cat}
                              </span>
                            ))}

                            {/* Priority icon */}
                            {PriorityIcon && (
                              <PriorityIcon size={13} style={{ color: priority?.color }} />
                            )}

                            {/* Project badge (when not grouped by project) */}
                            {groupBy !== 'project' && project && (
                              <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[9px] text-muted font-mono shrink-0 hidden md:inline">
                                {project.prefix}
                              </span>
                            )}

                            {/* Tags */}
                            {issue.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-surface-hover px-2 py-0.5 text-[9px] text-secondary hidden xl:inline"
                              >
                                {tag}
                              </span>
                            ))}

                            {/* Updated */}
                            <span className="text-[10px] text-muted shrink-0 w-14 text-right hidden md:inline">
                              {timeAgo(issue.updated_at)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drawer */}
      {isDetailOpen && selectedIssueId && (
        <IssueDrawer
          issueId={selectedIssueId}
          projectId={selectedIssue?.project_id}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
