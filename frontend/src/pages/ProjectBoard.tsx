import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ListView } from '@/components/list/ListView';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { Plus, X, Kanban, List, Rows3, Rows4, StretchHorizontal } from 'lucide-react';
import { useUIStore, type BoardDensity } from '@/stores/ui';
import { cn } from '@/lib/utils';
import type { IssueStatus, IssueType, IssuePriority, ProjectStatus, Project, ProjectTag } from '@/lib/types';

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
  const { slug } = useParams<{ slug: string }>();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const setIssues = useIssuesStore((s) => s.setIssues);
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const [showCreateIssue, setShowCreateIssue] = useState(false);

  // View mode with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`baaton-view-${slug}`);
    return (saved === 'list' ? 'list' : 'kanban') as ViewMode;
  });

  useEffect(() => {
    localStorage.setItem(`baaton-view-${slug}`, viewMode);
  }, [viewMode, slug]);

  // Fetch project by slug
  const { data: project, isLoading: projectLoading, error: projectError } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => apiClient.projects.getBySlug(slug!),
    enabled: !!slug,
  });

  // Fetch issues for this project
  const { data: issues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ['issues', project?.id],
    queryFn: async () => {
      const result = await apiClient.issues.listByProject(project!.id);
      setIssues(result);
      return result;
    },
    enabled: !!project?.id,
  });

  // Fetch project tags
  const { data: projectTags = [] } = useQuery({
    queryKey: ['project-tags', project?.id],
    queryFn: () => apiClient.tags.listByProject(project!.id),
    enabled: !!project?.id,
  });

  // Mutation for updating issue position (drag & drop)
  const positionMutation = useMutation({
    mutationFn: ({ id, status, position }: { id: string; status: string; position: number }) =>
      apiClient.issues.updatePosition(id, status, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', project?.id] });
    },
  });

  const handleMoveIssue = (issueId: string, newStatus: IssueStatus, newPosition: number) => {
    positionMutation.mutate({ id: issueId, status: newStatus, position: newPosition });
  };

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
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        Loading board…
      </div>
    );
  }

  if (projectError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400">
            {projectError instanceof Error ? projectError.message : 'Failed to load project'}
          </p>
          <p className="mt-1 text-xs text-secondary">
            Project "{slug}" may not exist or you don't have access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-primary truncate">{project?.name || slug}</h1>
          <p className="text-xs text-secondary font-mono uppercase tracking-wider">
            {project?.prefix} · {viewMode} view · {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Density Toggle */}
          <DensityToggle />

          {/* View Toggle */}
          <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
            <button
              onClick={() => setViewMode('kanban')}
              className={`rounded-[5px] p-1.5 transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-surface-hover text-primary'
                  : 'text-muted hover:text-secondary'
              }`}
              title="Kanban view"
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
              title="List view"
            >
              <List size={16} />
            </button>
          </div>

          <button
            onClick={() => setShowCreateIssue(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:bg-accent-hover transition-colors min-h-[36px]"
          >
            <Plus size={14} strokeWidth={2.5} />
            <span className="hidden sm:inline">New Issue</span>
          </button>
        </div>
      </div>

      {/* Board or List */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            statuses={statuses}
            issues={issues}
            onMoveIssue={handleMoveIssue}
            onIssueClick={(issue) => openDetail(issue.id)}
            onCreateIssue={() => setShowCreateIssue(true)}
            projectTags={projectTags}
          />
        ) : (
          <ListView
            statuses={statuses}
            issues={issues}
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
          onClose={closeDetail}
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
    </div>
  );
}

function CreateIssueModal({
  project,
  projectTags,
  onClose,
}: {
  project: Project;
  projectTags: ProjectTag[];
  onClose: () => void;
}) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>('feature');
  const [priority, setPriority] = useState<IssuePriority | ''>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [error, setError] = useState('');

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.issues.create({
        project_id: project.id,
        title,
        description: description || undefined,
        type,
        priority: priority || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', project.id] });
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setError('');
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-primary">
            New Issue
            <span className="ml-2 text-xs font-mono text-secondary">{project.prefix}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-secondary mb-1.5">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the issue"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description (markdown supported)"
              rows={4}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none resize-none transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-secondary mb-1.5">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as IssueType)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary focus:border-accent focus:outline-none transition-colors"
              >
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
                <option value="improvement">Improvement</option>
                <option value="question">Question</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority | '')}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary focus:border-accent focus:outline-none transition-colors"
              >
                <option value="">None</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          {projectTags.length > 0 && (
            <div>
              <label className="block text-xs text-secondary mb-1.5">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedTags.map((tag) => {
                  const tagObj = projectTags.find((t) => t.name === tag);
                  const color = tagObj?.color || '#6b7280';
                  return (
                    <span
                      key={tag}
                      className="rounded-full px-2 py-0.5 text-[10px] font-medium border cursor-pointer hover:opacity-80"
                      style={{
                        backgroundColor: `${color}20`,
                        borderColor: `${color}40`,
                        color: color,
                      }}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag} ×
                    </span>
                  );
                })}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTagDropdown(!showTagDropdown)}
                  className="w-full text-left rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted hover:border-border transition-colors"
                >
                  Select tags…
                </button>
                {showTagDropdown && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-border bg-surface py-1 shadow-xl max-h-40 overflow-y-auto">
                    {projectTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.name)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                          selectedTags.includes(tag.name) ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                        {selectedTags.includes(tag.name) && (
                          <span className="ml-auto text-accent">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Density Toggle ─────────────────────────────── */

const DENSITY_CONFIG: { key: BoardDensity; icon: typeof Rows3; label: string; title: string }[] = [
  { key: 'compact', icon: Rows4, label: 'Compact', title: 'Compact — more tickets, less detail' },
  { key: 'default', icon: Rows3, label: 'Default', title: 'Default — balanced view' },
  { key: 'spacious', icon: StretchHorizontal, label: 'Spacious', title: 'Spacious — full details' },
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
            density === key
              ? 'bg-surface-hover text-primary'
              : 'text-muted hover:text-secondary',
          )}
          title={title}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
