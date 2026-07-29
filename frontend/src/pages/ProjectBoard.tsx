import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@clerk/clerk-react';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ListView } from '@/components/list/ListView';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { CreateIssueModal } from '@/components/issues/CreateIssueModal';
import { PublicLinkModal } from '@/components/projects/PublicLinkModal';
import { ImportModal } from '@/components/projects/ImportExportModal';
import { TemplatesSection } from '@/components/settings/TemplatesSection';
import { SlaSection } from '@/components/settings/SlaSection';
import { RecurringSection } from '@/components/settings/RecurringSection';
import { EmailIntakeSection } from '@/components/settings/EmailIntakeSection';
import { WorkflowStatusEditor } from '@/components/settings/WorkflowStatusEditor';
import { ShortcutHelp } from '@/components/shared/ShortcutHelp';
import { KanbanBoardSkeleton, ListViewSkeleton } from '@/components/shared/Skeleton';
import { useApi } from '@/hooks/useApi';
import { ApiError } from '@/lib/api';
import { useIssuesStore } from '@/stores/issues';
import { useNotificationStore } from '@/stores/notifications';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useTranslation } from '@/hooks/useTranslation';
import { Plus, Kanban, List, Rows3, Rows4, StretchHorizontal, Link2, Settings, Star, GitFork, Circle, CheckCircle2, RefreshCw, ExternalLink, X, Download, Upload, Brain } from 'lucide-react';
const Github = GitFork;
import { useUIStore, type BoardDensity } from '@/stores/ui';
import { cn } from '@/lib/utils';
import type { Issue, IssueStatus, Project, ProjectStatus } from '@/lib/types';

// Default statuses (used when project statuses aren't loaded yet)
const DEFAULT_STATUSES: ProjectStatus[] = [
  { key: 'todo', label: 'Draft', color: '#3b82f6', hidden: false },
  { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: false },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
  { key: 'not_ok', label: 'Not OK', color: '#fa6400', hidden: false },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
  { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
  { key: 'cancelled', label: 'Canceled', color: '#ef4444', hidden: true },
];

// Parse a project's statuses field (array, JSON string, or missing) into a list.
function parseStatuses(raw: unknown): ProjectStatus[] {
  if (Array.isArray(raw)) return raw as ProjectStatus[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ProjectStatus[];
    } catch {
      // fall through
    }
  }
  return DEFAULT_STATUSES;
}

type ViewMode = 'kanban' | 'list';

export function ProjectBoard() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { organization } = useOrganization();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const setIssues = useIssuesStore((s) => s.setIssues);
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const restoreIssues = useIssuesStore((s) => s.restoreIssues);
  const moveIssueOptimistic = useIssuesStore((s) => s.moveIssueOptimistic);
  const updateIssue = useIssuesStore((s) => s.updateIssue);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPublicLink, setShowPublicLink] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const issueParam = searchParams.get('issue');
  const [showDone, setShowDone] = useState(() => {
    if (new URLSearchParams(window.location.search).get('showDone') === '1') return true;
    return localStorage.getItem(`baaton-show-done-${slug}`) === 'true';
  });

  // View mode with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`baaton-view-${slug}`);
    return (saved === 'list' ? 'list' : 'kanban') as ViewMode;
  });

  useEffect(() => {
    localStorage.setItem(`baaton-view-${slug}`, viewMode);
  }, [viewMode, slug]);

  useEffect(() => {
    localStorage.setItem(`baaton-show-done-${slug}`, String(showDone));
  }, [showDone, slug]);

  // Single composite query: project + issues + tags in one request
  const boardFetchStart = useRef(0);
  const { data: boardData, isLoading: boardLoading, error: projectError } = useQuery({
    queryKey: ['project-board', slug, organization?.id, { showDone }],
    queryFn: async () => {
      boardFetchStart.current = performance.now();
      const result = await apiClient.projects.getBoardBySlug(slug!, { excludeDone: !showDone });
      const elapsed = Math.round(performance.now() - boardFetchStart.current);
      console.info(`[perf] board loaded: ${result.issues.length} issues in ${elapsed}ms (${slug}, showDone=${showDone})`);
      return result;
    },
    enabled: !!slug && !!organization?.id,
    staleTime: 30_000,
    retry: 1,
  });

  const project = boardData?.project;
  const projectLoading = boardLoading && !boardData;
  const issuesList = boardData?.issues ?? [];
  const issuesLoading = boardLoading && !boardData;

  // Sync issues to Zustand store
  useEffect(() => {
    if (issuesList.length > 0) setIssues(issuesList);
  }, [issuesList, setIssues]);

  // ── Deep link: open drawer from ?issue=HLM-18, including same-route search jumps ──
  useEffect(() => {
    if (!issueParam) return;
    if (searchParams.get('showDone') === '1' && !showDone) {
      setShowDone(true);
      return;
    }
    if (issuesList.length === 0) return;
    const found = issuesList.find(
      (i) => i.display_id.toLowerCase() === issueParam.toLowerCase(),
    );
    if (found) {
      openDetail(found.id);
    } else if (!showDone) {
      setShowDone(true);
    }
  }, [issueParam, searchParams, showDone, issuesList, openDetail]);

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
    mutationFn: ({ id, status, rank, position }: { id: string; status: string; rank: string; position?: number }) =>
      apiClient.issues.updatePosition(id, status, rank, position),
    onMutate: async ({ id, status, rank, position }) => {
      // Cancel in-flight board query so it can't overwrite our optimistic write.
      await queryClient.cancelQueries({ queryKey: ['project-board', slug, organization?.id] });
      const boardKey = ['project-board', slug, organization?.id, { showDone }] as const;
      const previousBoard = queryClient.getQueryData<{ issues: Issue[] }>(boardKey);

      // Optimistically patch the board cache (the display source of truth).
      queryClient.setQueryData<typeof previousBoard>(boardKey, (old) =>
        old
          ? {
              ...old,
              issues: old.issues.map((i) =>
                i.id === id ? { ...i, status: status as IssueStatus, rank, ...(position != null ? { position } : {}) } : i,
              ),
            }
          : old,
      );

      // Optimistically update Zustand store (returns snapshot for rollback)
      const previousZustand = moveIssueOptimistic(id, status as IssueStatus, position ?? 0, rank);

      return { previousBoard, previousZustand };
    },
    onError: (_err, _vars, context) => {
      // Roll back board cache
      if (context?.previousBoard) {
        queryClient.setQueryData(['project-board', slug, organization?.id, { showDone }], context.previousBoard);
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
    onSuccess: (serverIssue) => {
      // Merge the authoritative server row into the board cache + store.
      // No board refetch: keeps the drop instantaneous.
      queryClient.setQueryData<{ issues: Issue[] }>(['project-board', slug, organization?.id, { showDone }], (old) =>
        old
          ? { ...old, issues: old.issues.map((i) => (i.id === serverIssue.id ? { ...i, ...serverIssue } : i)) }
          : old,
      );
      updateIssue(serverIssue.id, serverIssue);
    },
  });

  const handleMoveIssue = (issueId: string, newStatus: IssueStatus, newRank: string, newPosition?: number) => {
    positionMutation.mutate({ id: issueId, status: newStatus, rank: newRank, position: newPosition });
  };

  const handleExport = async () => {
    if (!project) return;
    setExportLoading(true);
    try {
      const data = await apiClient.get<unknown>(`/projects/${project.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.slug}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      addNotification({ type: 'success', title: t('importExport.exportSuccess'), message: '' });
    } catch {
      addNotification({ type: 'error', title: t('importExport.exportError'), message: '' });
    } finally {
      setExportLoading(false);
    }
  };

  // Stable list of issue IDs for keyboard navigation
  const issueIds = useMemo(() => issuesList.map((i) => i.id), [issuesList]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    issueIds,
    onNewIssue: useCallback(() => setShowCreateIssue(true), []),
    onToggleHelp: useCallback(() => setShowShortcutHelp((v) => !v), []),
  });

  const statuses = useMemo(() => parseStatuses(project?.statuses), [project?.statuses]);

  const setDoneVisibility = useCallback((next: boolean) => {
    setShowDone(next);
    setSearchParams((prev) => {
      if (next) prev.set('showDone', '1');
      else prev.delete('showDone');
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  const toggleDoneVisibility = () => setDoneVisibility(!showDone);

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

          <button
            onClick={toggleDoneVisibility}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[36px]',
              showDone
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-border bg-surface text-secondary hover:bg-surface-hover hover:text-primary',
            )}
            title={showDone ? 'Closed loaded' : 'Closed hidden'}
          >
            <CheckCircle2 size={14} />
            <span className="hidden lg:inline">{showDone ? 'Closed loaded' : 'Closed hidden'}</span>
          </button>

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

          <Link
            to={`/projects/${slug}/context`}
            className="rounded-lg border border-border bg-surface p-1.5 text-secondary hover:bg-surface-hover hover:text-accent transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            title="Project Context"
          >
            <Brain size={16} />
          </Link>

          <button
            onClick={() => setShowProjectSettings(true)}
            className="rounded-lg border border-border bg-surface p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            title={t('settings.title')}
          >
            <Settings size={16} />
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={exportLoading}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-hover transition-colors min-h-[36px] disabled:opacity-50"
            title={t('importExport.export')}
          >
            <Download size={14} />
            <span className="hidden lg:inline">{t('importExport.export')}</span>
          </button>

          {/* Import */}
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-hover transition-colors min-h-[36px]"
            title={t('importExport.import')}
          >
            <Upload size={14} />
            <span className="hidden lg:inline">{t('importExport.import')}</span>
          </button>

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
            doneIssuesLoaded={showDone}
            onLoadDoneIssues={() => setDoneVisibility(true)}
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

      {showProjectSettings && project && (
        <ProjectSettingsModal
          project={project}
          onClose={() => setShowProjectSettings(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['project-board', slug, organization?.id] })}
        />
      )}

      {showImport && project && (
        <ImportModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShowImport(false)}
          onSuccess={(msg) => addNotification({ type: 'success', title: msg, message: '' })}
          onError={(msg) => addNotification({ type: 'error', title: msg, message: '' })}
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

/* ── Project Settings Modal ─────────────────────── */

type SettingsTab = 'general' | 'workflow' | 'templates' | 'sla' | 'recurring' | 'email';

function ProjectSettingsModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const { organization } = useOrganization();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [githubUrl, setGithubUrl] = useState(project.github_repo_url || '');
  const [publicByDefault, setPublicByDefault] = useState(
    Boolean(project.agent_runs_public_default),
  );
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const meta = project.github_metadata;

  // Best-effort read of the org gate so we can disable the project toggle
  // when the org has turned public runs off altogether.
  const { data: orgData } = useQuery({
    queryKey: ['org-settings', organization?.id],
    enabled: !!organization?.id,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await apiClient.orgs.get(organization!.id);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
          return null;
        }
        throw err;
      }
    },
  });
  const orgGateOff = orgData ? orgData.agent_runs_public_enabled === false : false;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await apiClient.projects.update(project.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        github_repo_url: githubUrl.trim() || '',
        agent_runs_public_default: publicByDefault,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshGithub = async () => {
    setRefreshing(true);
    try {
      await apiClient.projects.refreshGithub(project.id);
      onSaved();
    } catch {
      // silent — might not have URL
    } finally {
      setRefreshing(false);
    }
  };

  const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'workflow', label: t('workflow.tab', { defaultValue: 'Workflow' }) },
    { key: 'templates', label: t('templates.title') },
    { key: 'sla', label: t('slaRules.title') },
    { key: 'recurring', label: t('recurring.title') },
    { key: 'email', label: t('emailIntake.title') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold text-primary">{t('settings.title')} — {project.name}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-6 border-b border-border overflow-x-auto shrink-0">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
                activeTab === tab.key
                  ? 'text-primary border-accent'
                  : 'text-secondary border-transparent hover:text-primary hover:border-border',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('projectList.projectName')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('projectList.description')}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary mb-1">
                  <Github size={12} className="inline mr-1" />
                  {t('settings.githubRepo')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none font-mono"
                  />
                  {project.github_repo_url && (
                    <button
                      onClick={handleRefreshGithub}
                      disabled={refreshing}
                      className="rounded-lg border border-border bg-surface-hover px-2.5 py-2 text-secondary hover:text-primary hover:bg-border transition-colors"
                      title="Refresh GitHub metadata"
                    >
                      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                  )}
                </div>
              </div>

              {meta && (
                <div className="rounded-lg border border-border bg-surface-hover p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-secondary">GitHub Info</span>
                    {meta.full_name && (
                      <a href={project.github_repo_url} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:underline flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}>
                        {meta.full_name} <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {meta.language && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
                        <Circle size={7} fill="currentColor" />{meta.language}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-secondary"><Star size={11} />{meta.stars ?? 0}</span>
                    <span className="inline-flex items-center gap-1 text-secondary"><GitFork size={11} />{meta.forks ?? 0}</span>
                    {meta.is_private
                      ? <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">Private</span>
                      : <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">Public</span>
                    }
                    {meta.default_branch && <span className="text-secondary font-mono">{meta.default_branch}</span>}
                  </div>
                  {meta.description && <p className="text-xs text-secondary">{meta.description}</p>}
                  {meta.fetched_at && <p className="text-[9px] text-muted">Last fetched: {new Date(meta.fetched_at!).toLocaleString()}</p>}
                </div>
              )}

              {/* Public agent runs by default */}
              <div className="rounded-lg border border-border bg-surface-hover p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-primary">
                      {t('settings.project.publicByDefault.title', {
                        defaultValue: 'Public agent runs by default',
                      })}
                    </p>
                    <p className="mt-1 text-[11px] text-secondary leading-relaxed">
                      {t('settings.project.publicByDefault.desc', {
                        defaultValue:
                          'New agent runs in this project are publishable. Existing runs stay private until explicitly published.',
                      })}
                    </p>
                    {orgGateOff && (
                      <p className="mt-1.5 text-[10px] text-amber-400">
                        {t('settings.project.publicByDefault.orgGate', {
                          defaultValue:
                            'Enable "Allow public agent runs" in org settings first.',
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={publicByDefault}
                    onClick={() => setPublicByDefault((v) => !v)}
                    disabled={orgGateOff}
                    title={
                      orgGateOff
                        ? t('agentRun.orgDisabled', {
                            defaultValue:
                              'Public runs are disabled for this organization. Enable in org settings.',
                          })
                        : undefined
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed ${
                      publicByDefault && !orgGateOff ? 'bg-accent' : 'bg-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-bg shadow transition-transform ${
                        publicByDefault && !orgGateOff ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-secondary hover:bg-surface-hover transition-colors">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {saving ? '...' : t('common.save')}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'workflow' && (
            <WorkflowStatusEditor
              projectId={project.id}
              statuses={parseStatuses(project.statuses)}
              onSaved={onSaved}
            />
          )}
          {activeTab === 'templates' && <TemplatesSection projectId={project.id} />}
          {activeTab === 'sla' && <SlaSection projectId={project.id} />}
          {activeTab === 'recurring' && <RecurringSection projectId={project.id} />}
          {activeTab === 'email' && <EmailIntakeSection projectSlug={project.slug} />}
        </div>
      </div>
    </div>
  );
}

export default ProjectBoard;
