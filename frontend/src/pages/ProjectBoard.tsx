import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { Plus, X } from 'lucide-react';
import type { IssueStatus, IssueType, IssuePriority, ProjectStatus, Project } from '@/lib/types';

// Default statuses (used when project statuses aren't loaded yet)
const DEFAULT_STATUSES: ProjectStatus[] = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: true },
  { key: 'todo', label: 'Todo', color: '#3b82f6', hidden: false },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
  { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444', hidden: true },
];

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
      <div className="flex h-full items-center justify-center text-sm text-[#a1a1aa]">
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
          <p className="mt-1 text-xs text-[#a1a1aa]">
            Project "{slug}" may not exist or you don't have access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#262626] px-4 md:px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[#fafafa] truncate">{project?.name || slug}</h1>
          <p className="text-xs text-[#a1a1aa] font-mono uppercase tracking-wider">
            {project?.prefix} · kanban view · {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowCreateIssue(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#f59e0b] px-3 py-1.5 text-xs font-medium text-black hover:bg-[#d97706] transition-colors min-h-[36px]"
          >
            <Plus size={14} strokeWidth={2.5} />
            <span className="hidden sm:inline">New Issue</span>
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          statuses={statuses}
          issues={issues}
          onMoveIssue={handleMoveIssue}
          onIssueClick={(issue) => openDetail(issue.id)}
          onCreateIssue={() => setShowCreateIssue(true)}
        />
      </div>

      {/* Issue Detail Drawer */}
      {isDetailOpen && selectedIssueId && (
        <IssueDrawer
          issueId={selectedIssueId}
          statuses={statuses}
          onClose={closeDetail}
        />
      )}

      {/* Create Issue Modal */}
      {showCreateIssue && project && (
        <CreateIssueModal
          project={project}
          onClose={() => setShowCreateIssue(false)}
        />
      )}
    </div>
  );
}

function CreateIssueModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>('feature');
  const [priority, setPriority] = useState<IssuePriority | ''>('');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.issues.create({
        project_id: project.id,
        title,
        description: description || undefined,
        type,
        priority: priority || undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-[#262626] bg-[#141414] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#fafafa]">
            New Issue
            <span className="ml-2 text-xs font-mono text-[#a1a1aa]">{project.prefix}</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[#a1a1aa] hover:bg-[#1f1f1f] hover:text-[#fafafa] transition-colors"
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
            <label className="block text-xs text-[#a1a1aa] mb-1.5">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the issue"
              className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-[#a1a1aa] mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description (markdown supported)"
              rows={4}
              className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none resize-none transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#a1a1aa] mb-1.5">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as IssueType)}
                className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] focus:border-[#f59e0b] focus:outline-none transition-colors"
              >
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
                <option value="improvement">Improvement</option>
                <option value="question">Question</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#a1a1aa] mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority | '')}
                className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] focus:border-[#f59e0b] focus:outline-none transition-colors"
              >
                <option value="">None</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
