import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  Workflow, Plus, Trash2, Loader2, X, ToggleLeft, ToggleRight,
  ChevronRight, Zap, ArrowRight,
} from 'lucide-react';
import type { Automation, Project } from '@/lib/types';

const TRIGGER_TYPES = [
  'status_changed',
  'priority_changed',
  'assignee_changed',
  'label_added',
  'due_date_passed',
] as const;

const ACTION_TYPES = [
  'set_status',
  'set_priority',
  'add_label',
  'assign_user',
  'send_webhook',
  'add_comment',
] as const;

interface AutomationForm {
  name: string;
  trigger_type: string;
  action_type: string;
  trigger_config: string;
  action_config: string;
}

const EMPTY_FORM: AutomationForm = {
  name: '',
  trigger_type: 'status_changed',
  action_type: 'set_status',
  trigger_config: '{}',
  action_config: '{}',
};

function AutomationRow({ automation, onDelete, onToggle }: {
  automation: Automation;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Zap size={15} className={cn('mt-0.5 shrink-0', automation.enabled ? 'text-accent' : 'text-muted')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-primary">{automation.name}</span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              automation.enabled ? 'bg-green-500/15 text-green-400' : 'bg-surface-hover text-muted',
            )}>
              {automation.enabled ? t('automations.enabled') : t('automations.disabled')}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 rounded-lg bg-blue-500/10 border border-blue-500/20 px-2 py-1 text-xs text-blue-400">
              <ChevronRight size={11} />
              {t(`automations.trigger.${automation.trigger_type}` as any) ?? automation.trigger_type}
            </span>
            <ArrowRight size={13} className="text-muted" />
            <span className="flex items-center gap-1 rounded-lg bg-purple-500/10 border border-purple-500/20 px-2 py-1 text-xs text-purple-400">
              <Zap size={11} />
              {t(`automations.action.${automation.action_type}` as any) ?? automation.action_type}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggle}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              automation.enabled ? 'text-accent hover:bg-accent/10' : 'text-muted hover:bg-surface-hover',
            )}
            title={automation.enabled ? t('automations.enabled') : t('automations.disabled')}
          >
            {automation.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={t('automations.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Automations() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<AutomationForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Get project by slug
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const project = projects.find((p: Project) => p.slug === slug);

  const { data: automations = [], isLoading } = useQuery({
    queryKey: ['automations', project?.id],
    queryFn: () => apiClient.get<Automation[]>(`/projects/${project!.id}/automations`),
    enabled: !!project?.id,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/automations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations', project?.id] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.patch(`/automations/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations', project?.id] }),
  });

  const set = (key: keyof AutomationForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('automations.nameRequired')); return; }
    if (!project) return;

    let triggerConfig: Record<string, unknown> = {};
    let actionConfig: Record<string, unknown> = {};
    try {
      triggerConfig = JSON.parse(form.trigger_config || '{}');
      actionConfig = JSON.parse(form.action_config || '{}');
    } catch {
      setError('Invalid JSON in config fields');
      return;
    }

    setSaving(true);
    try {
      await apiClient.post(`/projects/${project.id}/automations`, {
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        action_type: form.action_type,
        trigger_config: triggerConfig,
        action_config: actionConfig,
      });
      queryClient.invalidateQueries({ queryKey: ['automations', project.id] });
      setShowCreate(false);
      setForm(EMPTY_FORM);
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (automation: Automation) => {
    if (confirm(t('automations.deleteConfirm', { name: automation.name }))) {
      deleteMutation.mutate(automation.id);
    }
  };

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
            <Workflow size={18} className="text-accent" />
            {t('automations.title')}
            {project && <span className="text-sm font-normal text-muted">— {project.name}</span>}
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider">
            {t('automations.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">{t('automations.create')}</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* Create Form */}
        {showCreate && (
          <div className="rounded-xl border border-accent/30 bg-surface p-4 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-primary">{t('automations.create')}</h3>
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setError(''); }}
                className="p-1 text-muted hover:text-secondary">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('automations.name')}</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => { set('name', e.target.value); setError(''); }}
                  placeholder={t('automations.namePlaceholder')}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">{t('automations.triggerType')}</label>
                  <select
                    value={form.trigger_type}
                    onChange={(e) => set('trigger_type', e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {TRIGGER_TYPES.map((tt) => (
                      <option key={tt} value={tt}>
                        {t(`automations.trigger.${tt}` as any)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">{t('automations.actionType')}</label>
                  <select
                    value={form.action_type}
                    onChange={(e) => set('action_type', e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {ACTION_TYPES.map((at) => (
                      <option key={at} value={at}>
                        {t(`automations.action.${at}` as any)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">{t('automations.triggerConfig')}</label>
                  <textarea
                    value={form.trigger_config}
                    onChange={(e) => set('trigger_config', e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">{t('automations.actionConfig')}</label>
                  <textarea
                    value={form.action_config}
                    onChange={(e) => set('action_config', e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setError(''); }}
                  className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
                >
                  {t('automations.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {saving ? t('automations.creating') : t('automations.save')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* List */}
        {automations.length === 0 && !showCreate ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Workflow size={48} className="text-muted mb-4" />
            <h2 className="text-lg font-medium text-primary mb-2">{t('automations.empty')}</h2>
            <p className="text-sm text-secondary max-w-xs">{t('automations.emptyDesc')}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              <Plus size={16} />
              {t('automations.create')}
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {automations.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                onDelete={() => handleDelete(automation)}
                onToggle={() => toggleMutation.mutate({ id: automation.id, enabled: !automation.enabled })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Automations;
