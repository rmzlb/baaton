import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  Rocket, Plus, ChevronDown, ChevronRight, Trash2, X, Loader2,
  FolderOpen, BarChart2, CheckCircle2, Archive,
} from 'lucide-react';
import type { Initiative, Project } from '@/lib/types';

function StatusBadge({ status }: { status: Initiative['status'] }) {
  const { t } = useTranslation();
  const map = {
    active: { cls: 'bg-green-500/15 text-green-400', icon: CheckCircle2 },
    completed: { cls: 'bg-blue-500/15 text-blue-400', icon: CheckCircle2 },
    archived: { cls: 'bg-surface-hover text-muted', icon: Archive },
  };
  const { cls, icon: Icon } = map[status] ?? map.active;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>
      <Icon size={10} />
      {t(`initiatives.status.${status}` as any)}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-muted tabular-nums">{pct}%</span>
    </div>
  );
}

function CreateInitiativeModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError(t('initiatives.nameRequired')); return; }
    setSaving(true);
    try {
      await apiClient.post('/initiatives', { name: name.trim(), description: description.trim() || null });
      onCreated();
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-primary flex items-center gap-2">
            <Rocket size={16} className="text-accent" />
            {t('initiatives.create')}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:text-secondary transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">{t('initiatives.name')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder={t('initiatives.namePlaceholder')}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">{t('initiatives.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('initiatives.descriptionPlaceholder')}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors">
              {t('initiatives.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? t('initiatives.creating') : t('initiatives.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InitiativeRow({ initiative, projects }: { initiative: Initiative; projects: Project[] }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [saving, setSaving] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.del(`/initiatives/${initiative.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['initiatives'] }),
  });

  const addProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiClient.post(`/initiatives/${initiative.id}/projects/${projectId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['initiatives'] });
      setAddingProject(false);
      setSelectedProjectId('');
    },
  });

  const removeProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiClient.del(`/initiatives/${initiative.id}/projects/${projectId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['initiatives'] }),
  });

  const handleDelete = () => {
    if (confirm(t('initiatives.deleteConfirm', { name: initiative.name }))) {
      deleteMutation.mutate();
    }
  };

  const handleAddProject = async () => {
    if (!selectedProjectId) return;
    setSaving(true);
    try {
      await addProjectMutation.mutateAsync(selectedProjectId);
    } finally {
      setSaving(false);
    }
  };

  const linkedProjectIds = new Set((initiative.projects ?? []).map((p) => p.project_id));
  const availableProjects = projects.filter((p) => !linkedProjectIds.has(p.id));

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setExpanded((x) => !x)}
      >
        <button className="shrink-0 text-muted">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <Rocket size={16} className="text-accent shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-primary truncate">{initiative.name}</span>
            <StatusBadge status={initiative.status} />
          </div>
          {initiative.description && (
            <p className="text-xs text-secondary truncate">{initiative.description}</p>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-4 shrink-0">
          <div className="w-32">
            <ProgressBar value={initiative.progress} />
          </div>
          <span className="text-xs text-muted w-16 text-right">
            {(initiative.projects ?? []).length} projects
          </span>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          disabled={deleteMutation.isPending}
          className="shrink-0 rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title={t('initiatives.delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Expanded: linked projects */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-bg/50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1">
              <FolderOpen size={12} />
              {t('initiatives.linkedProjects')}
            </h4>
            <button
              onClick={() => setAddingProject((x) => !x)}
              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-secondary hover:text-primary hover:border-accent/50 transition-colors"
            >
              <Plus size={12} />
              {t('initiatives.addProject')}
            </button>
          </div>

          {addingProject && (
            <div className="mb-3 flex items-center gap-2">
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">{t('global.selectProject')}</option>
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={handleAddProject}
                disabled={!selectedProjectId || saving}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {t('initiatives.addProject')}
              </button>
              <button onClick={() => setAddingProject(false)} className="p-1.5 text-muted hover:text-secondary">
                <X size={14} />
              </button>
            </div>
          )}

          {(initiative.projects ?? []).length === 0 ? (
            <p className="text-xs text-muted italic">{t('initiatives.noProjects')}</p>
          ) : (
            <div className="space-y-2">
              {(initiative.projects ?? []).map((p) => {
                const proj = projects.find((pr) => pr.id === p.project_id);
                return (
                  <div key={p.project_id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FolderOpen size={13} className="text-accent" />
                      <span className="text-sm text-primary">{proj?.name ?? p.project_id}</span>
                      {proj?.prefix && (
                        <span className="text-[10px] font-mono text-muted">{proj.prefix}</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeProjectMutation.mutate(p.project_id)}
                      disabled={removeProjectMutation.isPending}
                      className="text-xs text-muted hover:text-red-400 transition-colors"
                    >
                      {t('initiatives.removeProject')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Initiatives() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: initiatives = [], isLoading } = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => apiClient.get<Initiative[]>('/initiatives'),
    staleTime: 30_000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-accent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
        <div>
          <h1 className="text-base md:text-lg font-semibold text-primary flex items-center gap-2">
            <Rocket size={18} className="text-accent" />
            {t('initiatives.title')}
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider">
            {t('initiatives.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">{t('initiatives.create')}</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {initiatives.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <BarChart2 size={48} className="text-muted mb-4" />
            <h2 className="text-lg font-medium text-primary mb-2">{t('initiatives.empty')}</h2>
            <p className="text-sm text-secondary max-w-xs">{t('initiatives.emptyDesc')}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              <Plus size={16} />
              {t('initiatives.create')}
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {initiatives.map((initiative) => (
              <InitiativeRow
                key={initiative.id}
                initiative={initiative}
                projects={projects}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateInitiativeModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['initiatives'] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

export default Initiatives;
