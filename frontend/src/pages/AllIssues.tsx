import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ListView } from '@/components/list/ListView';
import { IssuesTable } from '@/components/issues/IssuesTable';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useUIStore, type BoardDensity } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Layers, Kanban, List, Table2, Rows3, Rows4, StretchHorizontal,
  X, Circle,
  CheckCircle2,
  Bookmark,
} from 'lucide-react';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ProjectTabRail } from '@/components/shared/ProjectTabRail';
import { useCrossOrgMembers } from '@/hooks/useCrossOrgMembers';
import { MemberResolutionProvider } from '@/contexts/MemberResolutionContext';
import { cn } from '@/lib/utils';
import { usePersistedState, stringArray } from '@/lib/persistedState';
import type { Issue, IssueStatus, ProjectStatus, ProjectTag, SavedView } from '@/lib/types';

// ─── Statuses (global) ───────────────────────
const STATUSES: ProjectStatus[] = [
  { key: 'todo', label: 'Draft', color: '#3b82f6', hidden: false },
  { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: false },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
  { key: 'not_ok', label: 'Not OK', color: '#fa6400', hidden: false },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
  { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
  { key: 'cancelled', label: 'Canceled', color: '#ef4444', hidden: true },
];

// Global cross-project views only render the 6 canonical statuses. Projects may
// define custom statuses (e.g. "Pas ok"), but every status is pinned to a
// category (Linear-style workflow-state type). Map any non-core status onto its
// category's canonical column so the aggregated board never silently drops issues.
const CORE_STATUS_KEYS = new Set(STATUSES.map((s) => s.key));
const CATEGORY_TO_CORE_STATUS: Record<string, string> = {
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'cancelled',
};
function toGlobalStatus(status: string, category?: string | null): IssueStatus {
  if (CORE_STATUS_KEYS.has(status)) return status as IssueStatus;
  if (category && CATEGORY_TO_CORE_STATUS[category]) {
    return CATEGORY_TO_CORE_STATUS[category] as IssueStatus;
  }
  return 'in_progress';
}

// ─── Custom status columns (option 2) ─────────
// A project can define custom statuses (e.g. "Pas ok"). On the aggregated board
// we render them as real columns instead of folding them onto a canonical one.
// Same-named custom statuses across projects merge into a single synthetic
// column keyed `custom:<normalized-label>`; empty columns never appear because
// they are derived from issues actually present.
const CUSTOM_PREFIX = 'custom:';
function normLabel(label: string): string {
  return label.trim().toLowerCase();
}
function isCustomStatus(status: string, label?: string | null): boolean {
  return !CORE_STATUS_KEYS.has(status) && !!label && label.trim().length > 0;
}
function customColumnKey(label: string): string {
  return `${CUSTOM_PREFIX}${normLabel(label)}`;
}

type ViewMode = 'kanban' | 'list' | 'table';

const PROJECT_FILTER_STORAGE_KEY = 'all-issues:project-filter:v1';

interface CrossOrgProjectOption {
  id: string;
  name: string;
  slug: string;
  prefix: string;
  orgId: string;
}

interface DashboardProjectIndexResponse {
  orgs: Array<{
    id: string;
    name: string;
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      prefix: string;
    }>;
  }>;
}

// ═══════════════════════════════════════════════
// Filter Chip — toggleable pill (Linear-style)
// ═══════════════════════════════════════════════
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const [searchParams, setSearchParams] = useSearchParams();
  const issueParam = searchParams.get('issue');
  const viewParam = searchParams.get('view');
  const [showDone, setShowDone] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('showDone') === '1' || params.has('issue')) return true;
    return localStorage.getItem('baaton-show-done-all-issues') === 'true';
  });

  // View mode — always kanban by default
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');

  useEffect(() => {
    localStorage.setItem('baaton-show-done-all-issues', String(showDone));
  }, [showDone]);

  // Filters — persisted, so a reload lands on the same working set
  const [projectFilter, setProjectFilter] = usePersistedState<string[]>(PROJECT_FILTER_STORAGE_KEY, [], stringArray);
  const [statusFilter, setStatusFilter] = usePersistedState<string[]>('all-issues:status-filter:v1', [], stringArray);
  const [priorityFilter, setPriorityFilter] = usePersistedState<string[]>('all-issues:priority-filter:v1', [], stringArray);
  const [assigneeFilter, setAssigneeFilter] = usePersistedState<string[]>('all-issues:assignee-filter:v1', [], stringArray);
  const [tagFilter, setTagFilter] = usePersistedState<string[]>('all-issues:tag-filter:v1', [], stringArray);

  // Toggle helpers
  const toggleFilter = (arr: string[], val: string, setter: (v: string[]) => void) =>
    setter(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);

  // ─── Data fetching ─────────────────────────
  const { data: projectIndex } = useQuery({
    queryKey: ['all-issues-project-index'],
    queryFn: () => apiClient.get<DashboardProjectIndexResponse>('/dashboard/summary'),
    staleTime: 60_000,
  });

  const { data: allIssuesRaw = [], isLoading } = useQuery({
    queryKey: ['all-issues', { showDone }],
    queryFn: async () => {
      return await apiClient.issues.listAll({ limit: 2000, excludeDone: !showDone });
    },
    staleTime: 60_000,
  });

  // Cross-org member resolution — collect all org IDs from issues
  const issueOrgIds = useMemo(() => {
    const ids = new Set<string>();
    allIssuesRaw.forEach((i) => { if (i.org_id) ids.add(i.org_id); });
    return Array.from(ids);
  }, [allIssuesRaw]);
  const { resolveUserName, resolveUserAvatar } = useCrossOrgMembers(issueOrgIds);

  const effectiveProjects = useMemo<CrossOrgProjectOption[]>(() => {
    const fromIndex = (projectIndex?.orgs ?? []).flatMap(org =>
      org.projects.map(project => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        prefix: project.prefix,
        orgId: org.id,
      })),
    );
    if (fromIndex.length > 0) return fromIndex;
    if (allIssuesRaw.length === 0) return [];

    const map = new Map<string, CrossOrgProjectOption>();
    allIssuesRaw.forEach((issue) => {
      if (map.has(issue.project_id)) return;
      const prefix = issue.display_id?.split('-')[0] || 'PRJ';
      map.set(issue.project_id, {
        id: issue.project_id,
        orgId: issue.org_id || 'unknown',
        name: prefix,
        slug: prefix.toLowerCase(),
        prefix,
      });
    });

    return Array.from(map.values());
  }, [projectIndex?.orgs, allIssuesRaw]);



  useEffect(() => {
    if (effectiveProjects.length === 0) return;
    const validIds = new Set(effectiveProjects.map(project => project.id));
    setProjectFilter((current) => {
      const next = current.filter(id => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [effectiveProjects]);

  const allTags = useMemo<ProjectTag[]>(() => {
    const seen = new Map<string, ProjectTag>();
    for (const issue of allIssuesRaw) {
      for (const tagName of issue.tags || []) {
        if (!seen.has(tagName)) {
          seen.set(tagName, {
            id: tagName,
            project_id: issue.project_id,
            name: tagName,
            color: '#6b7280',
            created_at: issue.created_at,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [allIssuesRaw]);

  // ─── Saved Views ───────────────────────────
  const { data: savedViews = [] } = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => apiClient.views.list(),
    staleTime: 60_000,
  });

  const saveViewMutation = useMutation({
    mutationFn: (body: { name: string; filters: Record<string, unknown>; sort?: string }) =>
      apiClient.views.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-views'] });
      setSaveViewOpen(false);
      setSaveViewName('');
    },
  });

  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');

  // Load view from URL param
  useEffect(() => {
    if (!viewParam || savedViews.length === 0) return;
    const view = savedViews.find((v: SavedView) => v.id === viewParam);
    if (!view) return;
    if (view.filters.projects) setProjectFilter(view.filters.projects);
    if (view.filters.statuses) setStatusFilter(view.filters.statuses);
    if (view.filters.priorities) setPriorityFilter(view.filters.priorities);
  }, [viewParam, savedViews]);

  const handleSaveView = () => {
    if (!saveViewName.trim()) return;
    saveViewMutation.mutate({
      name: saveViewName.trim(),
      filters: {
        projects: projectFilter,
        statuses: statusFilter,
        priorities: priorityFilter,
      },
      sort: 'created',
    });
  };

  // ─── Custom status columns (option 2: real merged custom columns) ──
  // Column identity per issue: canonical key, or synthetic `custom:<label>`.
  const columnKeyFor = useCallback(
    (i: Issue): string =>
      isCustomStatus(i.status, i.status_label)
        ? customColumnKey(i.status_label as string)
        : toGlobalStatus(i.status, i.status_category),
    [],
  );

  // projectId → normalized custom label → real project status key. Lets a drop
  // onto a synthetic custom column resolve to a status the backend accepts.
  const projectStatusKeyByLabel = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const i of allIssuesRaw) {
      if (!isCustomStatus(i.status, i.status_label)) continue;
      const inner = m.get(i.project_id) ?? new Map<string, string>();
      inner.set(normLabel(i.status_label as string), i.status);
      m.set(i.project_id, inner);
    }
    return m;
  }, [allIssuesRaw]);

  // Canonical columns + custom columns discovered from present issues, each
  // slotted under its canonical category (stable left→right order). Same-label
  // custom statuses merge; color = most frequent occurrence.
  const dynamicStatuses = useMemo<ProjectStatus[]>(() => {
    const custom = new Map<string, { key: string; label: string; color: string; canon: string; colorCounts: Record<string, number> }>();
    for (const i of allIssuesRaw) {
      if (!isCustomStatus(i.status, i.status_label)) continue;
      const key = customColumnKey(i.status_label as string);
      const color = i.status_color || '#6b7280';
      const existing = custom.get(key);
      if (existing) {
        existing.colorCounts[color] = (existing.colorCounts[color] || 0) + 1;
        if (existing.colorCounts[color] > (existing.colorCounts[existing.color] || 0)) existing.color = color;
      } else {
        custom.set(key, {
          key,
          label: (i.status_label as string).trim(),
          color,
          canon: toGlobalStatus(i.status, i.status_category),
          colorCounts: { [color]: 1 },
        });
      }
    }
    if (custom.size === 0) {
      return STATUSES;
    }
    const byCanon = new Map<string, ProjectStatus[]>();
    for (const c of custom.values()) {
      const arr = byCanon.get(c.canon) ?? [];
      arr.push({ key: c.key, label: c.label, color: c.color, hidden: false });
      byCanon.set(c.canon, arr);
    }
    for (const arr of byCanon.values()) arr.sort((a, b) => a.label.localeCompare(b.label));
    const ordered: ProjectStatus[] = [];
    for (const canon of STATUSES) {
      ordered.push(canon);
      const extras = byCanon.get(canon.key);
      if (extras) ordered.push(...extras);
    }
    return ordered;
  }, [allIssuesRaw]);

  // ─── Issue counts per project (for chips) ──
  const issueCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of allIssuesRaw) {
      counts[i.project_id] = (counts[i.project_id] || 0) + 1;
    }
    return counts;
  }, [allIssuesRaw]);

  // Tab order is by open-issue volume, not alphabetical. On this account one
  // project holds over half the issues while a third of projects are dormant,
  // so alphabetical order pushes the only tabs that matter off-screen.
  const projectTabs = useMemo(
    () =>
      effectiveProjects
        .map((p) => ({
          id: p.id,
          name: p.name,
          prefix: p.prefix,
          count: issueCountByProject[p.id] || 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [effectiveProjects, issueCountByProject],
  );

  const issueCountByStatus = useMemo(() => {
    const source = projectFilter.length > 0
      ? allIssuesRaw.filter((i) => projectFilter.includes(i.project_id))
      : allIssuesRaw;
    const counts: Record<string, number> = {};
    for (const i of source) {
      const key = columnKeyFor(i);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [allIssuesRaw, projectFilter, columnKeyFor]);

  // ─── Unique tags + assignees for filters ────

  // ─── Apply filters ─────────────────────────
  const filteredIssues = useMemo(() => {
    let result = allIssuesRaw;

    if (projectFilter.length > 0) {
      result = result.filter((i) => projectFilter.includes(i.project_id));
    }
    if (statusFilter.length > 0) {
      result = result.filter((i) => statusFilter.includes(columnKeyFor(i)));
    }
    if (priorityFilter.length > 0) {
      result = result.filter((i) => i.priority && priorityFilter.includes(i.priority));
    }
    if (assigneeFilter.length > 0) {
      result = result.filter((i) => i.assignee_ids.some((a) => assigneeFilter.includes(a)));
    }
    if (tagFilter.length > 0) {
      result = result.filter((i) => i.tags.some((t) => tagFilter.includes(t)));
    }
    return [...result].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allIssuesRaw, projectFilter, statusFilter, priorityFilter, assigneeFilter, tagFilter, columnKeyFor]);

  // Route each issue to its column: synthetic custom key, or canonical column.
  // Never drops an issue; custom statuses now land in their own column.
  const boardIssues = useMemo(
    () =>
      filteredIssues.map((i) => {
        const key = columnKeyFor(i);
        return key === i.status ? i : { ...i, status: key as IssueStatus };
      }),
    [filteredIssues, columnKeyFor],
  );

  const hasFilters = projectFilter.length > 0 || statusFilter.length > 0 || priorityFilter.length > 0 || assigneeFilter.length > 0 || tagFilter.length > 0;

  const clearAllFilters = () => {
    setProjectFilter([]);
    setStatusFilter([]);
    setPriorityFilter([]);
    setAssigneeFilter([]);
    setTagFilter([]);
  };

  const setDoneVisibility = useCallback((next: boolean) => {
    setShowDone(next);
    setSearchParams((prev) => {
      if (next) prev.set('showDone', '1');
      else prev.delete('showDone');
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  const toggleDoneVisibility = () => setDoneVisibility(!showDone);

  // ─── Drag & drop ───────────────────────────
  const positionMutation = useMutation({
    mutationFn: ({ id, status, rank, position }: { id: string; status: string; rank: string; position?: number }) =>
      apiClient.issues.updatePosition(id, status, rank, position),
    onMutate: async ({ id, status, rank, position }) => {
      await queryClient.cancelQueries({ queryKey: ['all-issues'] });
      const allIssuesKey = ['all-issues', { showDone }] as const;
      const previous = queryClient.getQueryData<Issue[]>(allIssuesKey);
      queryClient.setQueryData<Issue[]>(allIssuesKey, (old) =>
        old?.map((i) => (i.id === id ? { ...i, status: status as IssueStatus, rank, ...(position != null ? { position } : {}) } : i)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['all-issues', { showDone }], context.previous);
    },
    onSuccess: (serverIssue) => {
      // Merge server row; no board refetch.
      queryClient.setQueryData<Issue[]>(['all-issues', { showDone }], (old) =>
        old?.map((i) => (i.id === serverIssue.id ? { ...i, ...serverIssue } : i)),
      );
    },
  });

  const handleMoveIssue = (issueId: string, newStatus: IssueStatus, newRank: string, newPosition?: number) => {
    // Synthetic custom columns must be translated back to a real status key the
    // target issue's project accepts. If that project has no matching status,
    // throw so KanbanBoard rolls back its optimistic move and warns the user.
    let realStatus: string = newStatus;
    if (typeof newStatus === 'string' && newStatus.startsWith(CUSTOM_PREFIX)) {
      const norm = newStatus.slice(CUSTOM_PREFIX.length);
      const issue = allIssuesRaw.find((i) => i.id === issueId);
      const resolved = issue ? projectStatusKeyByLabel.get(issue.project_id)?.get(norm) : undefined;
      if (!resolved) throw new Error('status-not-in-project');
      realStatus = resolved;
    }
    positionMutation.mutate({ id: issueId, status: realStatus, rank: newRank, position: newPosition });
  };

  // ─── Deep link ─────────────────────────────
  useEffect(() => {
    if (!issueParam) return;
    if (searchParams.get('showDone') === '1' && !showDone) {
      setShowDone(true);
      return;
    }
    if (allIssuesRaw.length === 0) return;
    const found = allIssuesRaw.find((i) => i.display_id.toLowerCase() === issueParam.toLowerCase());
    if (found) {
      openDetail(found.id);
    } else if (!showDone) {
      setShowDone(true);
    }
  }, [issueParam, searchParams, showDone, allIssuesRaw, openDetail]);

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

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3">
          <div>
            <div className="h-5 w-32 rounded bg-surface-hover animate-pulse" />
            <div className="mt-1.5 h-3 w-48 rounded bg-surface-hover animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-24 rounded-lg bg-surface-hover animate-pulse" />
            <div className="h-8 w-20 rounded-lg bg-surface-hover animate-pulse" />
          </div>
        </div>
        <div className="border-b border-border px-3 md:px-6 py-2">
          <div className="flex gap-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-7 w-16 rounded-full bg-surface-hover animate-pulse" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-4 space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-hover animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <MemberResolutionProvider resolveUserName={resolveUserName} resolveUserAvatar={resolveUserAvatar}>
    <div className="flex h-full flex-col">
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3 gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-medium text-primary truncate flex items-center gap-2">
            <Layers size={18} className="text-accent shrink-0 md:w-5 md:h-5" />
            {t('allIssues.title')}
          </h1>
          <p className="text-[9px] text-secondary font-mono uppercase tracking-wider truncate">
            {filteredIssues.length} / {allIssuesRaw.length} issues · {effectiveProjects.length} projects
          </p>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <GlobalCreateIssueButton variant="compact" />
          <div className="hidden sm:block">
            <DensityToggle />
          </div>
          <button
            onClick={toggleDoneVisibility}
            className={cn(
              'flex items-center justify-center rounded-lg border p-1.5 transition-colors min-h-[32px] min-w-[32px]',
              showDone
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-transparent text-muted hover:bg-surface-hover hover:text-secondary',
            )}
            title={showDone ? 'Hide closed issues (Done/Cancelled)' : 'Show closed issues (Done/Cancelled)'}
            aria-pressed={showDone}
          >
            <CheckCircle2 size={14} />
          </button>
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
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'rounded-[5px] p-1.5 transition-colors',
                viewMode === 'table' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
              )}
              title={t('sidebar.tableView')}
            >
              <Table2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Filter Bar — Linear/Notion style ═══ */}
      <div className="border-b border-border overflow-visible z-30">
        {/* Row 1: Search + Project chips + Sort */}
        <div className="flex items-center gap-2 px-3 md:px-6 py-2">
          {/* Project switcher — flat tab rail, one click per project */}
          <ProjectTabRail
            projects={projectTabs}
            selectedIds={projectFilter}
            onChange={setProjectFilter}
            allLabel={t('allIssues.filters.allProjects')}
            allCount={allIssuesRaw.length}
            emptyLabel={t('allIssues.filters.noProjects')}
          />

        </div>

        {/* Row 2: Status chips + Priority dropdown + Active filter tokens */}
        <div className="flex items-center gap-2 px-3 md:px-6 pb-2 overflow-visible">
          {/* Status chips */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {dynamicStatuses.map((s) => (
              <FilterChip
                key={s.key}
                label={s.label}
                active={statusFilter.includes(s.key)}
                onClick={() => toggleFilter(statusFilter, s.key, setStatusFilter)}
                color={s.color}
                count={issueCountByStatus[s.key] || 0}
              />
            ))}
          </div>

          {/* Clear all button */}
          {hasFilters && (
            <>
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent transition-all whitespace-nowrap"
              >
                <X size={12} />
                {t('allIssues.clearAll')}
              </button>

              {/* Save view */}
              <div className="relative">
                <button
                  onClick={() => setSaveViewOpen(!saveViewOpen)}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 border border-transparent transition-all whitespace-nowrap"
                >
                  <Bookmark size={12} />
                  {t('allIssues.saveView')}
                </button>
                {saveViewOpen && (
                  <div className="absolute top-full mt-1.5 left-0 z-50 rounded-xl border border-border bg-surface shadow-2xl p-3 min-w-[220px]">
                    <input
                      type="text"
                      value={saveViewName}
                      onChange={(e) => setSaveViewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveView()}
                      placeholder={t('allIssues.viewNamePlaceholder')}
                      autoFocus
                      className="h-8 w-full rounded-lg border border-border bg-bg px-3 text-xs text-primary placeholder-muted outline-none focus:border-accent"
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setSaveViewOpen(false)}
                        className="flex-1 rounded-lg px-3 py-1.5 text-xs text-secondary hover:bg-surface-hover"
                      >
                        {t('createIssue.cancel')}
                      </button>
                      <button
                        onClick={handleSaveView}
                        disabled={!saveViewName.trim()}
                        className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs text-black font-medium hover:bg-accent/90 disabled:opacity-50"
                      >
                        {t('allIssues.save')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Board or List ═══ */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            statuses={dynamicStatuses}
            issues={boardIssues}
            onMoveIssue={handleMoveIssue}
            onIssueClick={(issue) => openDetail(issue.id)}
            onCreateIssue={() => {}}
            projectTags={allTags}
            doneIssuesLoaded={showDone}
            onLoadDoneIssues={() => setDoneVisibility(true)}
          />
        ) : viewMode === 'table' ? (
          <IssuesTable issues={filteredIssues} statuses={dynamicStatuses} />
        ) : (
          <ListView
            statuses={dynamicStatuses}
            issues={boardIssues}
            onIssueClick={(issue) => openDetail(issue.id)}
            projectTags={allTags}
            projects={effectiveProjects}
            hideFilterBar
          />
        )}
      </div>

      {/* ═══ Issue Drawer ═══ */}
      {isDetailOpen && selectedIssueId && (
        <IssueDrawer
          issueId={selectedIssueId}
          statuses={dynamicStatuses}
          projectId={selectedIssue?.project_id}
          onClose={handleCloseDetail}
        />
      )}
    </div>
    </MemberResolutionProvider>
  );
}

export default AllIssues;
