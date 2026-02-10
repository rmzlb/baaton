import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ListView } from '@/components/list/ListView';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useUIStore, type BoardDensity } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Layers, Kanban, List, Rows3, Rows4, StretchHorizontal,
  ChevronDown, X, Search, SlidersHorizontal,
  ArrowUp, ArrowDown, Minus, Flame,
  Circle, Clock, Eye, CheckCircle2, XCircle, Archive,
  FolderOpen,
} from 'lucide-react';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { cn } from '@/lib/utils';
import type { Issue, IssueStatus, ProjectStatus, ProjectTag } from '@/lib/types';

// ─── Statuses (global) ───────────────────────
const STATUSES: ProjectStatus[] = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: true },
  { key: 'todo', label: 'Todo', color: '#3b82f6', hidden: false },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
  { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444', hidden: true },
];

const STATUS_ICONS: Record<string, typeof Circle> = {
  backlog: Archive,
  todo: Circle,
  in_progress: Clock,
  in_review: Eye,
  done: CheckCircle2,
  cancelled: XCircle,
};

const PRIORITY_CONFIG = [
  { key: 'urgent', label: 'Urgent', icon: Flame, color: '#ef4444', textColor: 'text-red-500' },
  { key: 'high', label: 'High', icon: ArrowUp, color: '#f97316', textColor: 'text-orange-500' },
  { key: 'medium', label: 'Medium', icon: Minus, color: '#eab308', textColor: 'text-yellow-500' },
  { key: 'low', label: 'Low', icon: ArrowDown, color: '#6b7280', textColor: 'text-gray-400' },
];

type ViewMode = 'kanban' | 'list';

// ═══════════════════════════════════════════════
// Filter Chip — toggleable pill (Linear-style)
// ═══════════════════════════════════════════════
function FilterChip({
  label,
  active,
  onClick,
  color,
  icon: Icon,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
  icon?: typeof Circle;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 border whitespace-nowrap select-none',
        active
          ? 'border-accent/40 bg-accent/10 text-accent shadow-sm shadow-accent/5'
          : 'border-transparent bg-surface-hover/60 text-secondary hover:bg-surface-hover hover:text-primary',
      )}
    >
      {Icon && <Icon size={12} style={color && active ? { color } : undefined} className={active ? '' : 'text-muted'} />}
      {!Icon && color && (
        <span
          className={cn('h-2 w-2 rounded-full shrink-0 transition-transform', active && 'scale-110')}
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      {count !== undefined && count > 0 && (
        <span className={cn(
          'rounded-full px-1.5 text-[9px] font-bold tabular-nums',
          active ? 'bg-accent/20 text-accent' : 'bg-surface text-muted',
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════
// Filter Dropdown — for multi-select with popover
// ═══════════════════════════════════════════════
function FilterDropdown({
  trigger,
  children,
  align = 'left',
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div className={cn(
          'absolute top-full mt-1.5 z-50 rounded-xl border border-border bg-surface shadow-2xl py-1.5 min-w-[200px] max-h-[320px] overflow-y-auto',
          align === 'right' ? 'right-0' : 'left-0',
        )}>
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  selected,
  onClick,
  icon: Icon,
  color,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon?: typeof Circle;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors rounded-md mx-1',
        selected ? 'bg-accent/8 text-primary' : 'text-secondary hover:bg-surface-hover hover:text-primary',
      )}
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className={cn(
        'h-4 w-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-all',
        selected ? 'bg-accent border-accent text-black scale-105' : 'border-border',
      )}>
        {selected && '✓'}
      </span>
      {Icon && <Icon size={14} style={color ? { color } : undefined} />}
      {!Icon && color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      <span className="flex-1 text-left truncate">{label}</span>
    </button>
  );
}

// ─── Density Toggle ───────────────────────────
const DENSITY_CONFIG: { key: BoardDensity; icon: typeof Rows3; title: string }[] = [
  { key: 'compact', icon: Rows4, title: 'Compact' },
  { key: 'default', icon: Rows3, title: 'Default' },
  { key: 'spacious', icon: StretchHorizontal, title: 'Spacious' },
];

function DensityToggle() {
  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);
  return (
    <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
      {DENSITY_CONFIG.map(({ key, icon: Icon, title }) => (
        <button
          key={key}
          onClick={() => setDensity(key)}
          className={cn(
            'rounded-[5px] p-1.5 transition-colors',
            density === key ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
          )}
          title={title}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export function AllIssues() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const [, setSearchParams] = useSearchParams();
  const initialIssueParam = useRef(new URLSearchParams(window.location.search).get('issue'));

  // View mode (persisted)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('baaton-view-all-issues');
    return (saved === 'list' ? 'list' : 'kanban') as ViewMode;
  });
  useEffect(() => {
    localStorage.setItem('baaton-view-all-issues', viewMode);
  }, [viewMode]);

  // Filters
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'manual' | 'priority' | 'created' | 'updated'>('manual');
  const [searchFocused, setSearchFocused] = useState(false);

  // Toggle helpers
  const toggleFilter = (arr: string[], val: string, setter: (v: string[]) => void) =>
    setter(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);

  // ─── Data fetching ─────────────────────────
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const { data: allIssuesRaw = [], isLoading } = useQuery({
    queryKey: ['all-issues', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (p) => {
          try {
            return await apiClient.issues.listByProject(p.id, { limit: 500 });
          } catch {
            return [] as Issue[];
          }
        }),
      );
      return results.flat();
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['all-project-tags', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (p) => {
          try { return await apiClient.tags.listByProject(p.id); }
          catch { return [] as ProjectTag[]; }
        }),
      );
      const seen = new Map<string, ProjectTag>();
      for (const tag of results.flat()) {
        if (!seen.has(tag.name)) seen.set(tag.name, tag);
      }
      return Array.from(seen.values());
    },
    enabled: projects.length > 0,
    staleTime: 60_000,
  });

  // ─── Issue counts per project (for chips) ──
  const issueCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of allIssuesRaw) {
      counts[i.project_id] = (counts[i.project_id] || 0) + 1;
    }
    return counts;
  }, [allIssuesRaw]);

  const issueCountByStatus = useMemo(() => {
    const source = projectFilter.length > 0
      ? allIssuesRaw.filter((i) => projectFilter.includes(i.project_id))
      : allIssuesRaw;
    const counts: Record<string, number> = {};
    for (const i of source) {
      counts[i.status] = (counts[i.status] || 0) + 1;
    }
    return counts;
  }, [allIssuesRaw, projectFilter]);

  // ─── Apply filters ─────────────────────────
  const filteredIssues = useMemo(() => {
    let result = allIssuesRaw;

    if (projectFilter.length > 0) {
      result = result.filter((i) => projectFilter.includes(i.project_id));
    }
    if (statusFilter.length > 0) {
      result = result.filter((i) => statusFilter.includes(i.status));
    }
    if (priorityFilter.length > 0) {
      result = result.filter((i) => i.priority && priorityFilter.includes(i.priority));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.display_id.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const sorted = [...result];
    switch (sortMode) {
      case 'priority': {
        const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        return sorted.sort((a, b) => (order[a.priority || 'low'] ?? 4) - (order[b.priority || 'low'] ?? 4));
      }
      case 'created':
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case 'updated':
        return sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      default:
        return sorted;
    }
  }, [allIssuesRaw, projectFilter, statusFilter, priorityFilter, searchQuery, sortMode]);

  const hasFilters = projectFilter.length > 0 || statusFilter.length > 0 || priorityFilter.length > 0 || searchQuery.length > 0;

  const clearAllFilters = () => {
    setProjectFilter([]);
    setStatusFilter([]);
    setPriorityFilter([]);
    setSearchQuery('');
  };

  // ─── Drag & drop ───────────────────────────
  const positionMutation = useMutation({
    mutationFn: ({ id, status, position }: { id: string; status: string; position: number }) =>
      apiClient.issues.updatePosition(id, status, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
    },
  });

  const handleMoveIssue = (issueId: string, newStatus: IssueStatus, newPosition: number) => {
    positionMutation.mutate({ id: issueId, status: newStatus, position: newPosition });
  };

  // ─── Deep link ─────────────────────────────
  useEffect(() => {
    const param = initialIssueParam.current;
    if (!param || allIssuesRaw.length === 0) return;
    const found = allIssuesRaw.find((i) => i.display_id.toLowerCase() === param.toLowerCase());
    if (found) openDetail(found.id);
    initialIssueParam.current = null;
  }, [allIssuesRaw, openDetail]);

  useEffect(() => {
    if (isDetailOpen && selectedIssueId) {
      const issue = allIssuesRaw.find((i) => i.id === selectedIssueId);
      if (issue) {
        setSearchParams((prev) => { prev.set('issue', issue.display_id); return prev; }, { replace: true });
      }
    }
  }, [isDetailOpen, selectedIssueId, allIssuesRaw, setSearchParams]);

  const handleCloseDetail = useCallback(() => {
    closeDetail();
    setSearchParams((prev) => { prev.delete('issue'); return prev; }, { replace: true });
  }, [closeDetail, setSearchParams]);

  const selectedIssue = allIssuesRaw.find((i) => i.id === selectedIssueId);

  // ─── Sort options ──────────────────────────
  const SORT_OPTIONS = [
    { key: 'manual' as const, label: t('kanban.manual') || 'Manual' },
    { key: 'priority' as const, label: t('kanban.priority') || 'Priority' },
    { key: 'created' as const, label: t('kanban.created') || 'Created' },
    { key: 'updated' as const, label: t('kanban.updated') || 'Updated' },
  ];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        {t('allIssues.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3 gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base md:text-lg font-semibold text-primary truncate flex items-center gap-2">
            <Layers size={18} className="text-accent shrink-0 md:w-5 md:h-5" />
            {t('allIssues.title')}
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider truncate">
            {filteredIssues.length} / {allIssuesRaw.length} issues · {projects.length} projects
          </p>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <GlobalCreateIssueButton variant="compact" />
          <div className="hidden sm:block">
            <DensityToggle />
          </div>
          <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
            <button
              onClick={() => setViewMode('kanban')}
              className={cn(
                'rounded-[5px] p-1.5 transition-colors',
                viewMode === 'kanban' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
              )}
              title={t('projectBoard.kanbanView')}
            >
              <Kanban size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'rounded-[5px] p-1.5 transition-colors',
                viewMode === 'list' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
              )}
              title={t('projectBoard.listView')}
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Filter Bar — Linear/Notion style ═══ */}
      <div className="border-b border-border overflow-visible z-30">
        {/* Row 1: Search + Project chips + Sort */}
        <div className="flex items-center gap-2 px-3 md:px-6 py-2">
          {/* Search */}
          <div className={cn(
            'relative shrink-0 transition-all duration-200',
            searchFocused ? 'w-56' : 'w-36 sm:w-44',
          )}>
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search issues..."
              className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-xs text-primary placeholder-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Separator */}
          <div className="h-5 w-px bg-border shrink-0 hidden sm:block" />

          {/* Project filter chips */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
            {projects.length > 1 && (
              <FilterChip
                label="All"
                active={projectFilter.length === 0}
                onClick={() => setProjectFilter([])}
                icon={FolderOpen}
                count={allIssuesRaw.length}
              />
            )}
            {projects.map((p) => (
              <FilterChip
                key={p.id}
                label={p.prefix}
                active={projectFilter.includes(p.id)}
                onClick={() => toggleFilter(projectFilter, p.id, setProjectFilter)}
                count={issueCountByProject[p.id] || 0}
              />
            ))}
          </div>

          {/* Sort dropdown — right aligned */}
          <div className="shrink-0 ml-auto">
            <FilterDropdown
              align="right"
              trigger={
                <button className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-secondary hover:text-primary hover:border-secondary transition-colors min-h-[32px]">
                  <SlidersHorizontal size={12} />
                  <span className="hidden sm:inline">
                    {SORT_OPTIONS.find((o) => o.key === sortMode)?.label}
                  </span>
                  <ChevronDown size={10} />
                </button>
              }
            >
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">Sort by</div>
              {SORT_OPTIONS.map((opt) => (
                <DropdownItem
                  key={opt.key}
                  label={opt.label}
                  selected={sortMode === opt.key}
                  onClick={() => setSortMode(opt.key)}
                />
              ))}
            </FilterDropdown>
          </div>
        </div>

        {/* Row 2: Status chips + Priority dropdown + Active filter tokens */}
        <div className="flex items-center gap-2 px-3 md:px-6 pb-2 overflow-visible">
          {/* Status chips (always visible — most used filter) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {STATUSES.map((s) => {
              const StatusIcon = STATUS_ICONS[s.key] || Circle;
              return (
                <FilterChip
                  key={s.key}
                  label={s.label}
                  active={statusFilter.includes(s.key)}
                  onClick={() => toggleFilter(statusFilter, s.key, setStatusFilter)}
                  icon={StatusIcon}
                  color={s.color}
                  count={issueCountByStatus[s.key] || 0}
                />
              );
            })}
          </div>

          {/* Separator */}
          <div className="h-5 w-px bg-border shrink-0 hidden sm:block" />

          {/* Priority dropdown */}
          <FilterDropdown
            trigger={
              <button className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border transition-all whitespace-nowrap',
                priorityFilter.length > 0
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-transparent bg-surface-hover/60 text-secondary hover:bg-surface-hover hover:text-primary',
              )}>
                <Flame size={12} />
                Priority
                {priorityFilter.length > 0 && (
                  <span className="rounded-full bg-accent/20 px-1.5 text-[9px] font-bold text-accent">
                    {priorityFilter.length}
                  </span>
                )}
                <ChevronDown size={10} />
              </button>
            }
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">Priority</div>
            {PRIORITY_CONFIG.map((p) => (
              <DropdownItem
                key={p.key}
                label={p.label}
                selected={priorityFilter.includes(p.key)}
                onClick={() => toggleFilter(priorityFilter, p.key, setPriorityFilter)}
                icon={p.icon}
                color={p.color}
              />
            ))}
          </FilterDropdown>

          {/* Clear all button */}
          {hasFilters && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent transition-all whitespace-nowrap"
            >
              <X size={12} />
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ═══ Board or List ═══ */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            statuses={STATUSES}
            issues={filteredIssues}
            onMoveIssue={handleMoveIssue}
            onIssueClick={(issue) => openDetail(issue.id)}
            onCreateIssue={() => {}}
            projectTags={allTags}
          />
        ) : (
          <ListView
            statuses={STATUSES}
            issues={filteredIssues}
            onIssueClick={(issue) => openDetail(issue.id)}
            projectTags={allTags}
            projects={projects}
            hideFilterBar
          />
        )}
      </div>

      {/* ═══ Issue Drawer ═══ */}
      {isDetailOpen && selectedIssueId && (
        <IssueDrawer
          issueId={selectedIssueId}
          statuses={STATUSES}
          projectId={selectedIssue?.project_id}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
}

export default AllIssues;
