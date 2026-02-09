import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Kanban, ArrowRight, Trash2, X } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { timeAgo } from '@/lib/utils';

export function ProjectList() {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.projects.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[#fafafa]">Projects</h1>
          <p className="mt-1 text-sm text-[#a1a1aa]">
            Manage your projects and boards
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] transition-colors min-h-[40px]"
        >
          <Plus size={16} strokeWidth={2.5} />
          <span className="hidden sm:inline">New Project</span>
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load projects: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-sm text-[#a1a1aa]">
          Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#262626] py-24">
          <Kanban size={48} className="text-[#a1a1aa] mb-4" />
          <p className="text-sm text-[#a1a1aa]">No projects yet</p>
          <p className="mt-1 text-xs text-[#a1a1aa]">
            Create your first project to start collecting issues
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] transition-colors"
          >
            <Plus size={16} strokeWidth={2.5} />
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.slug}`}
              className="group rounded-xl border border-[#262626] bg-[#141414] p-5 transition-all hover:border-[#333] hover:bg-[#1a1a1a] min-h-[44px]"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1f1f1f] text-sm font-bold font-mono text-[#f59e0b] group-hover:bg-[#262626]">
                  {project.prefix}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(project.id);
                      }
                    }}
                    className="rounded-md p-1.5 text-[#a1a1aa] opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ArrowRight
                    size={16}
                    className="text-[#a1a1aa] opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </div>
              </div>
              <h3 className="text-base font-semibold text-[#fafafa]">{project.name}</h3>
              {project.description && (
                <p className="mt-1 text-xs text-[#a1a1aa] line-clamp-2">{project.description}</p>
              )}
              <div className="mt-3 flex items-center gap-3 text-[10px] text-[#a1a1aa]">
                <span className="font-mono">{project.slug}</span>
                <span>·</span>
                <span>{timeAgo(project.created_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.projects.create({
        name,
        slug,
        prefix: prefix.toUpperCase() || name.slice(0, 3).toUpperCase(),
        description: description || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    setError('');
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-[#262626] bg-[#141414] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#fafafa]">Create Project</h2>
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
            <label className="block text-xs text-[#a1a1aa] mb-1.5">Project Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none transition-colors"
              autoFocus
            />
            {slug && (
              <p className="mt-1 text-[10px] text-[#a1a1aa] font-mono">
                Slug: {slug}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-[#a1a1aa] mb-1.5">
              Prefix <span className="text-[#666]">(for issue IDs like BAA-1)</span>
            </label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 5))}
              placeholder={name.slice(0, 3).toUpperCase() || 'PRJ'}
              maxLength={5}
              className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#a1a1aa] font-mono uppercase focus:border-[#f59e0b] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-[#a1a1aa] mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={3}
              className="w-full rounded-lg border border-[#262626] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none resize-none transition-colors"
            />
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
              disabled={!name.trim() || createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
