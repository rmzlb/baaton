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
  Filter, ChevronDown, X, Search, SlidersHorizontal, FolderOpen,
  ArrowUp, ArrowDown, Minus, AlertTriangle,
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

type ViewMode = 'kanban' | 'list';

// ─── Multi-select filter ──────────────────────
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
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
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
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

// ─── Main Component ───────────────────────────
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

  // View mode
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

  // Fetch all projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Fetch all issues from all projects
  const { data: allIssuesRaw = [], isLoading } = useQuery({
    queryKey: ['all-issues', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (p) => {
          try {
            const issues = await apiClient.issues.listByProject(p.id, { limit: 500 });
            return issues;
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

  // Fetch all project tags (merged)
  const { data: allTags = [] } = useQuery({
    queryKey: ['all-project-tags', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (p) => {
          try {
            return await apiClient.tags.listByProject(p.id);
          } catch {
            return [] as ProjectTag[];
          }
        }),
      );
      // Dedupe by name
      const seen = new Map<string, ProjectTag>();
      for (const tag of results.flat()) {
        if (!seen.has(tag.name)) seen.set(tag.name, tag);
      }
      return Array.from(seen.values());
    },
    enabled: projects.length > 0,
    staleTime: 60_000,
  });

  // Apply all filters
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

    // Sort
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

  const PRIORITY_OPTIONS = [
    { value: 'urgent', label: 'Urgent', color: '#ef4444' },
    { value: 'high', label: 'High', color: '#f97316' },
    { value: 'medium', label: 'Medium', color: '#eab308' },
    { value: 'low', label: 'Low', color: '#6b7280' },
  ];

  const SORT_OPTIONS = [
    { key: 'manual' as const, label: t('kanban.manual') || 'Manual' },
    { key: 'priority' as const, label: t('kanban.priority') || 'Priority' },
    { key: 'created' as const, label: t('kanban.created') || 'Created' },
    { key: 'updated' as const, label: t('kanban.updated') || 'Updated' },
  ];

  // Drag & drop handler — update via API
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

  // ── Deep link: open from ?issue=HLM-18 on initial load ONCE ──
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

  // Find selected issue for drawer
  const selectedIssue = allIssuesRaw.find((i) => i.id === selectedIssueId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        {t('allIssues.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3 gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base md:text-lg font-semibold text-primary truncate flex items-center gap-2">
            <Layers size={18} className="text-accent shrink-0 md:w-5 md:h-5" />
            {t('allIssues.title')}
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider truncate">
            {t('allIssues.issueCount', { count: filteredIssues.length })} · {t('allIssues.projectCount', { count: projects.length })} · {viewMode} view
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

      {/* Filter & Sort Toolbar */}
      <div className="relative flex flex-wrap items-center gap-1.5 md:gap-2 border-b border-border px-3 md:px-6 py-2 overflow-visible z-30">
        {/* Search */}
        <div className="relative shrink-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('kanban.filterIssues') || 'Filter issues...'}
            className="h-8 w-32 sm:w-48 rounded-md border border-border bg-surface pl-8 pr-3 text-xs text-primary placeholder-muted outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Project filter */}
        <MultiSelect
          label={t('allIssues.project') || 'Project'}
          options={projects.map((p) => ({ value: p.id, label: `${p.prefix} — ${p.name}` }))}
          selected={projectFilter}
          onChange={setProjectFilter}
        />

        {/* Status filter */}
        <MultiSelect
          label={t('allIssues.status') || 'Status'}
          options={STATUSES.map((s) => ({ value: s.key, label: s.label, color: s.color }))}
          selected={statusFilter}
          onChange={setStatusFilter}
        />

        {/* Priority filter */}
        <MultiSelect
          label={t('kanban.priority') || 'Priority'}
          options={PRIORITY_OPTIONS}
          selected={priorityFilter}
          onChange={setPriorityFilter}
        />

        {/* Clear all */}
        {hasFilters && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-accent hover:bg-accent/10 transition-colors"
          >
            <X size={12} />
            {t('kanban.clearAll') || 'Clear'}
          </button>
        )}

        {/* Sort — pushed right */}
        <div className="relative ml-auto">
          <SortDropdown
            options={SORT_OPTIONS}
            value={sortMode}
            onChange={setSortMode}
          />
        </div>
      </div>

      {/* Board or List — same components as ProjectBoard */}
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
          />
        )}
      </div>

      {/* Issue Detail Drawer */}
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

// ─── Sort Dropdown ────────────────────────────
function SortDropdown({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: any) => void;
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
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-secondary hover:text-primary transition-colors min-h-[32px]"
      >
        <SlidersHorizontal size={12} />
        <span className="hidden sm:inline">{options.find((o) => o.key === value)?.label}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-border bg-surface py-1 shadow-xl">
            {options.map((opt) => (
              <button
                key={opt.key}
                onClick={() => { onChange(opt.key); setOpen(false); }}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-xs transition-colors',
                  value === opt.key ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default AllIssues;
