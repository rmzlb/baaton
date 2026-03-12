import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { RefreshCw, Plus, Trash2, Loader2, Play, ToggleLeft, ToggleRight } from 'lucide-react';
import type { RecurringIssue, IssuePriority, IssueType } from '@/lib/types';

const PRIORITIES: Array<IssuePriority | ''> = ['', 'urgent', 'high', 'medium', 'low'];
const TYPES: Array<IssueType | ''> = ['', 'bug', 'feature', 'improvement', 'question'];

interface RecurringForm {
  title: string;
  description: string;
  priority: IssuePriority | '';
  issue_type: IssueType | '';
  cron_expression: string;
}

const EMPTY_FORM: RecurringForm = {
  title: '',
  description: '',
  priority: '',
  issue_type: '',
  cron_expression: '',
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString();
}

function RecurringRow({ rec, projectId }: { rec: RecurringIssue; projectId: string }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [triggering, setTriggering] = useState(false);
  const [triggered, setTriggered] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: () => apiClient.patch(`/recurring/${rec.id}`, { enabled: !rec.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring', projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.del(`/recurring/${rec.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring', projectId] }),
  });

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await apiClient.post(`/recurring/${rec.id}/trigger`, {});
      setTriggered(true);
      setTimeout(() => setTriggered(false), 3000);
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  };

  const handleDelete = () => {
    if (confirm(t('recurring.deleteConfirm', { name: rec.title }))) {
      deleteMutation.mutate();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <RefreshCw size={15} className={cn('mt-0.5 shrink-0', rec.enabled ? 'text-accent' : 'text-muted')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-primary">{rec.title}</span>
            {rec.priority && (
              <span className={cn(
                'text-[10px] font-medium capitalize',
                rec.priority === 'urgent' ? 'text-red-400' :
                rec.priority === 'high' ? 'text-orange-400' :
                rec.priority === 'medium' ? 'text-yellow-400' : 'text-muted',
              )}>{rec.priority}</span>
            )}
            {rec.issue_type && (
              <span className="text-[10px] text-muted">{rec.issue_type}</span>
            )}
          </div>
          <code className="text-[11px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            {rec.cron_expression}
          </code>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-muted">
            <span>
              {t('recurring.nextRun')}: {formatDate(rec.next_run_at) ?? t('recurring.never')}
            </span>
            <span>
              {t('recurring.lastRun')}: {formatDate(rec.last_run_at) ?? t('recurring.never')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {triggered && (
            <span className="text-xs text-green-400">{t('recurring.triggered')}</span>
          )}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="rounded-md p-1.5 text-muted hover:text-green-400 hover:bg-green-500/10 transition-colors"
            title={t('recurring.trigger')}
          >
            {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
          <button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              rec.enabled ? 'text-accent hover:bg-accent/10' : 'text-muted hover:bg-surface-hover',
            )}
            title={rec.enabled ? t('recurring.enabled') : t('recurring.disabled')}
          >
            {rec.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title={t('recurring.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecurringSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<RecurringForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: recurrings = [], isLoading } = useQuery({
    queryKey: ['recurring', projectId],
    queryFn: () => apiClient.get<RecurringIssue[]>(`/projects/${projectId}/recurring`),
    staleTime: 60_000,
    enabled: !!projectId,
  });

  const set = (key: keyof RecurringForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(t('recurring.name') + ' required'); return; }
    if (!form.cron_expression.trim()) { setError('Cron expression required'); return; }
    setSaving(true);
    try {
      await apiClient.post(`/projects/${projectId}/recurring`, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority || null,
        issue_type: form.issue_type || null,
        cron_expression: form.cron_expression.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ['recurring', projectId] });
      setShowCreate(false);
      setForm(EMPTY_FORM);
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
            <RefreshCw size={15} className="text-accent" />
            {t('recurring.title')}
          </h3>
          <p className="text-xs text-secondary mt-0.5">{t('recurring.emptyDesc')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:text-primary hover:border-accent/50 transition-colors"
        >
          <Plus size={13} />
          {t('recurring.create')}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-accent/30 bg-surface p-4">
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">{t('recurring.name')}</label>
              <input
                autoFocus
                value={form.title}
                onChange={(e) => { set('title', e.target.value); setError(''); }}
                placeholder={t('recurring.namePlaceholder')}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('recurring.priority')}</label>
                <select
                  value={form.priority}
                  onChange={(e) => set('priority', e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p || t('common.none')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('recurring.type')}</label>
                <select
                  value={form.issue_type}
                  onChange={(e) => set('issue_type', e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {TYPES.map((tp) => <option key={tp} value={tp}>{tp || t('common.none')}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1">
                {t('recurring.cron')}
              </label>
              <input
                value={form.cron_expression}
                onChange={(e) => { set('cron_expression', e.target.value); setError(''); }}
                placeholder={t('recurring.cronPlaceholder')}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted font-mono focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-1 text-[11px] text-muted">{t('recurring.cronHint')}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1">{t('recurring.description')}</label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={t('recurring.descriptionPlaceholder')}
                rows={3}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setError(''); }}
                className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
              >
                {t('recurring.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? t('recurring.creating') : t('recurring.save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted py-4">
          <Loader2 size={16} className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : recurrings.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center">
          <RefreshCw size={32} className="text-muted mx-auto mb-2" />
          <p className="text-sm text-muted">{t('recurring.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recurrings.map((rec) => (
            <RecurringRow key={rec.id} rec={rec} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
