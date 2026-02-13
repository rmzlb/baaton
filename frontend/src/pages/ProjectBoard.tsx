import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ListView } from '@/components/list/ListView';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { CreateIssueModal } from '@/components/issues/CreateIssueModal';
import { PublicLinkModal } from '@/components/projects/PublicLinkModal';
import { ShortcutHelp } from '@/components/shared/ShortcutHelp';
import { KanbanBoardSkeleton, ListViewSkeleton } from '@/components/shared/Skeleton';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useNotificationStore } from '@/stores/notifications';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useTranslation } from '@/hooks/useTranslation';
import { Plus, Kanban, List, Rows3, Rows4, StretchHorizontal, Link2 } from 'lucide-react';
import { useUIStore, type BoardDensity } from '@/stores/ui';
import { cn } from '@/lib/utils';
import type { Issue, IssueStatus, ProjectStatus } from '@/lib/types';

// Default statuses (used when project statuses aren't loaded yet)
const DEFAULT_STATUSES: ProjectStatus[] = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: true },
  { key: 'todo', label: 'Todo', color: '#3b82f6', hidden: false },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
  { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444', hidden: true },
];

type ViewMode = 'kanban' | 'list';

export function ProjectBoard() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const setIssues = useIssuesStore((s) => s.setIssues);
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const restoreIssues = useIssuesStore((s) => s.restoreIssues);
  const moveIssueOptimistic = useIssuesStore((s) => s.moveIssueOptimistic);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPublicLink, setShowPublicLink] = useState(false);
  const [, setSearchParams] = useSearchParams();
  // Capture the initial deep-link param ONCE at mount, then forget it
  const initialIssueParam = useRef(new URLSearchParams(window.location.search).get('issue'));

  // View mode with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`baaton-view-${slug}`);
    return (saved === 'list' ? 'list' : 'kanban') as ViewMode;
  });

  useEffect(() => {
    localStorage.setItem(`baaton-view-${slug}`, viewMode);
  }, [viewMode, slug]);

  // Single composite query: project + issues + tags in one request
  const { data: boardData, isLoading: boardLoading, error: projectError } = useQuery({
    queryKey: ['project-board', slug],
    queryFn: () => apiClient.projects.getBoardBySlug(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  });

  const project = boardData?.project;
  const projectLoading = boardLoading && !boardData;
  const issuesList = boardData?.issues ?? [];
  const issuesLoading = boardLoading && !boardData;

  // Sync issues to Zustand store
  useEffect(() => {
    if (issuesList.length > 0) setIssues(issuesList);
  }, [issuesList, setIssues]);

  // ── Deep link: open drawer from ?issue=HLM-18 on initial load ONCE ──
  useEffect(() => {
    const param = initialIssueParam.current;
    if (!param || issuesList.length === 0) return;
    const found = issuesList.find(
      (i) => i.display_id.toLowerCase() === param.toLowerCase(),
    );
    if (found) {
      openDetail(found.id);
    }
    // Clear so it never fires again
    initialIssueParam.current = null;
  }, [issuesList, openDetail]);

  // When drawer opens: update URL with display_id
  useEffect(() => {
    if (isDetailOpen && selectedIssueId) {
      const issue = issuesList.find((i) => i.id === selectedIssueId);
      if (issue) {
        setSearchParams((prev) => {
          prev.set('issue', issue.display_id);
          return prev;
        }, { replace: true });
      }
    }
  }, [isDetailOpen, selectedIssueId, issuesList, setSearchParams]);

  // Wrap closeDetail to also clear URL param
  const handleCloseDetail = useCallback(() => {
    closeDetail();
    setSearchParams((prev) => {
      prev.delete('issue');
      return prev;
    }, { replace: true });
  }, [closeDetail, setSearchParams]);

  // Tags come from the composite board query
  const projectTags = boardData?.tags ?? [];

  // Mutation for updating issue position (drag & drop) — with optimistic update in both Zustand + react-query
  const positionMutation = useMutation({
    mutationFn: ({ id, status, position }: { id: string; status: string; position: number }) =>
      apiClient.issues.updatePosition(id, status, position),
    onMutate: async ({ id, status, position }) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['issues', project?.id] });
      const previousQueryData = queryClient.getQueryData<Issue[]>(['issues', project?.id]);

      // Optimistically update the react-query cache
      queryClient.setQueryData<Issue[]>(['issues', project?.id], (old) =>
        old?.map((i) => (i.id === id ? { ...i, status: status as IssueStatus, position } : i)),
      );

      // Optimistically update Zustand store (returns snapshot for rollback)
      const previousZustand = moveIssueOptimistic(id, status as IssueStatus, position);

      return { previousQueryData, previousZustand };
    },
    onError: (_err, _vars, context) => {
      // Roll back react-query cache
      if (context?.previousQueryData) {
        queryClient.setQueryData(['issues', project?.id], context.previousQueryData);
      }
      // Roll back Zustand store
      if (context?.previousZustand) {
        restoreIssues(context.previousZustand);
      }
      // Show error toast
      addNotification({
        type: 'warning',
        title: t('optimistic.moveError'),
        message: t('optimistic.moveErrorDesc'),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['project-board', slug] });
    },
  });

  const handleMoveIssue = (issueId: string, newStatus: IssueStatus, newPosition: number) => {
    positionMutation.mutate({ id: issueId, status: newStatus, position: newPosition });
  };

  // Stable list of issue IDs for keyboard navigation
  const issueIds = useMemo(() => issuesList.map((i) => i.id), [issuesList]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    issueIds,
    onNewIssue: useCallback(() => setShowCreateIssue(true), []),
    onToggleHelp: useCallback(() => setShowShortcutHelp((v) => !v), []),
  });

  // Parse project statuses (could be JSON string or array)
  const statuses: ProjectStatus[] = (() => {
    if (!project?.statuses) return DEFAULT_STATUSES;
    if (Array.isArray(project.statuses)) return project.statuses as ProjectStatus[];
    if (typeof project.statuses === 'string') {
      try {
        return JSON.parse(project.statuses as string) as ProjectStatus[];
      } catch {
        return DEFAULT_STATUSES;
      }
    }
    return DEFAULT_STATUSES;
  })();

  if (projectLoading || issuesLoading) {
    return (
      <div className="flex h-full flex-col">
        {/* Header skeleton */}
        <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3 gap-2">
          <div className="min-w-0 flex-1">
            <div className="h-5 w-40 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-56 animate-pulse rounded bg-surface-hover mt-1.5" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-20 animate-pulse rounded-md bg-surface-hover" />
            <div className="h-9 w-28 animate-pulse rounded-lg bg-surface-hover" />
          </div>
        </div>
        {/* Board skeleton based on current view mode */}
        <div className="flex-1 overflow-hidden">
          {viewMode === 'kanban' ? <KanbanBoardSkeleton /> : <ListViewSkeleton />}
        </div>
      </div>
    );
  }

  if (projectError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400">
            {projectError instanceof Error ? projectError.message : t('projectBoard.failedLoad')}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {t('projectBoard.projectNotFound', { slug })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3 gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base md:text-lg font-semibold text-primary truncate">{project?.name || slug}</h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider truncate">
            {project?.prefix} · {t('projectBoard.view', { mode: viewMode })} · {t('projectBoard.issueCount', { count: issuesList.length })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          {/* Density Toggle — hide on mobile */}
          <div className="hidden sm:block">
            <DensityToggle />
          </div>

          {/* View Toggle */}
          <div data-tour="view-toggle" className="flex items-center rounded-md border border-border bg-surface p-0.5">
            <button
              onClick={() => setViewMode('kanban')}
              className={`rounded-[5px] p-1.5 transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-surface-hover text-primary'
                  : 'text-muted hover:text-secondary'
              }`}
              title={t('projectBoard.kanbanView')}
            >
              <Kanban size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-[5px] p-1.5 transition-colors ${
                viewMode === 'list'
                  ? 'bg-surface-hover text-primary'
                  : 'text-muted hover:text-secondary'
              }`}
              title={t('projectBoard.listView')}
            >
              <List size={16} />
            </button>
          </div>

          <button
            onClick={() => setShowPublicLink(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 md:px-3 py-1.5 text-xs font-medium text-secondary hover:bg-surface-hover transition-colors min-h-[36px]"
          >
            <Link2 size={14} />
            <span className="hidden sm:inline">Public link</span>
          </button>

          <button
            data-tour="create-issue"
            onClick={() => setShowCreateIssue(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 md:px-3 py-1.5 text-xs font-medium text-black hover:bg-accent-hover transition-colors min-h-[36px]"
          >
            <Plus size={14} strokeWidth={2.5} />
            <span className="hidden sm:inline">{t('projectBoard.newIssue')}</span>
          </button>
        </div>
      </div>

      {/* Board or List */}
      <div data-tour="board-area" className="flex-1 overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            statuses={statuses}
            issues={issuesList}
            onMoveIssue={handleMoveIssue}
            onIssueClick={(issue) => openDetail(issue.id)}
            onCreateIssue={() => setShowCreateIssue(true)}
            projectTags={projectTags}
          />
        ) : (
          <ListView
            statuses={statuses}
            issues={issuesList}
            onIssueClick={(issue) => openDetail(issue.id)}
            projectTags={projectTags}
          />
        )}
      </div>

      {/* Issue Detail Drawer */}
      {isDetailOpen && selectedIssueId && (
        <IssueDrawer
          issueId={selectedIssueId}
          statuses={statuses}
          projectId={project?.id}
          onClose={handleCloseDetail}
        />
      )}

      {/* Create Issue Modal */}
      {showCreateIssue && project && (
        <CreateIssueModal
          project={project}
          projectTags={projectTags}
          onClose={() => setShowCreateIssue(false)}
        />
      )}

      {showPublicLink && project && (
        <PublicLinkModal
          project={project}
          onClose={() => setShowPublicLink(false)}
        />
      )}

      {/* Keyboard Shortcut Help Overlay */}
      {showShortcutHelp && (
        <ShortcutHelp onClose={() => setShowShortcutHelp(false)} />
      )}
    </div>
  );
}

/* ── Density Toggle ─────────────────────────────── */

const DENSITY_CONFIG: { key: BoardDensity; icon: typeof Rows3; titleKey: string }[] = [
  { key: 'compact', icon: Rows4, titleKey: 'projectBoard.compactDensity' },
  { key: 'default', icon: Rows3, titleKey: 'projectBoard.defaultDensity' },
  { key: 'spacious', icon: StretchHorizontal, titleKey: 'projectBoard.spaciousDensity' },
];

function DensityToggle() {
  const { t } = useTranslation();
  const density = useUIStore((s) => s.density);
  const setDensity = useUIStore((s) => s.setDensity);

  return (
    <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
      {DENSITY_CONFIG.map(({ key, icon: Icon, titleKey }) => (
        <button
          key={key}
          onClick={() => setDensity(key)}
          className={cn(
            'rounded-[5px] p-1.5 transition-colors',
            density === key
              ? 'bg-surface-hover text-primary'
              : 'text-muted hover:text-secondary',
          )}
          title={t(titleKey)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

export default ProjectBoard;
