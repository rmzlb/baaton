import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ListView } from '@/components/list/ListView';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useUIStore, type BoardDensity } from '@/stores/ui';
import {
  Layers, Kanban, List, Rows3, Rows4, StretchHorizontal,
  Filter, ChevronDown, X,
} from 'lucide-react';
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
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);

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
  const [showFilters, setShowFilters] = useState(false);

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

  // Apply project filter
  const filteredIssues = useMemo(() => {
    if (projectFilter.length === 0) return allIssuesRaw;
    return allIssuesRaw.filter((i) => projectFilter.includes(i.project_id));
  }, [allIssuesRaw, projectFilter]);

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

  // Find selected issue for drawer
  const selectedIssue = allIssuesRaw.find((i) => i.id === selectedIssueId);

  const hasFilters = projectFilter.length > 0;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        Loading all issues…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — same layout as ProjectBoard */}
      <div className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-primary truncate flex items-center gap-2">
            <Layers size={20} className="text-accent shrink-0" />
            All Issues
          </h1>
          <p className="text-xs text-secondary font-mono uppercase tracking-wider">
            {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''} · {projects.length} project{projects.length !== 1 ? 's' : ''} · {viewMode} view
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Project filter */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
              hasFilters
                ? 'border-accent text-accent bg-accent/5'
                : 'border-border text-secondary hover:border-secondary',
            )}
          >
            <Filter size={12} />
            Filter
            {hasFilters && (
              <span className="rounded-full bg-accent text-black px-1.5 text-[10px] font-bold">
                {projectFilter.length}
              </span>
            )}
          </button>

          {/* Density Toggle */}
          <DensityToggle />

          {/* View Toggle */}
          <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
            <button
              onClick={() => setViewMode('kanban')}
              className={cn(
                'rounded-[5px] p-1.5 transition-colors',
                viewMode === 'kanban'
                  ? 'bg-surface-hover text-primary'
                  : 'text-muted hover:text-secondary',
              )}
              title="Kanban view"
            >
              <Kanban size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'rounded-[5px] p-1.5 transition-colors',
                viewMode === 'list'
                  ? 'bg-surface-hover text-primary'
                  : 'text-muted hover:text-secondary',
              )}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar (collapsible) */}
      {showFilters && (
        <div className="flex items-center gap-2 border-b border-border px-4 md:px-6 py-2 bg-surface/50">
          <MultiSelect
            label="Project"
            options={projects.map((p) => ({ value: p.id, label: `${p.prefix} — ${p.name}` }))}
            selected={projectFilter}
            onChange={setProjectFilter}
          />
          {hasFilters && (
            <button
              onClick={() => setProjectFilter([])}
              className="flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
      )}

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
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
