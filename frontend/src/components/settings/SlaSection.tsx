import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { Shield, Plus, Trash2, Loader2, BarChart2 } from 'lucide-react';
import type { SlaRule, SlaStats } from '@/lib/types';

const PRIORITY_OPTIONS = ['urgent', 'high', 'medium', 'low'];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-muted',
};

export function SlaSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [newPriority, setNewPriority] = useState('urgent');
  const [newHours, setNewHours] = useState('24');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['sla-rules', projectId],
    queryFn: () => apiClient.get<SlaRule[]>(`/projects/${projectId}/sla-rules`),
    staleTime: 60_000,
    enabled: !!projectId,
  });

  const { data: stats } = useQuery({
    queryKey: ['sla-stats', projectId],
    queryFn: () => apiClient.get<SlaStats>(`/projects/${projectId}/sla-stats`),
    staleTime: 60_000,
    enabled: !!projectId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/sla-rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sla-rules', projectId] }),
  });

  const handleAdd = async () => {
    const hours = parseInt(newHours, 10);
    if (!newPriority || isNaN(hours) || hours <= 0) return;
    setSaving(true);
    try {
      const result = await apiClient.post<SlaRule>(`/projects/${projectId}/sla-rules`, {
        priority: newPriority,
        deadline_hours: hours,
      });
      queryClient.invalidateQueries({ queryKey: ['sla-rules', projectId] });
      setSavedId(result.id);
      setTimeout(() => setSavedId(null), 2000);
      // Reset to next unused priority
      const usedPriorities = new Set([...rules.map((r) => r.priority), newPriority]);
      const next = PRIORITY_OPTIONS.find((p) => !usedPriorities.has(p));
      if (next) setNewPriority(next);
      setNewHours('24');
    } finally {
      setSaving(false);
    }
  };

  const usedPriorities = new Set(rules.map((r) => r.priority));
  const availablePriorities = PRIORITY_OPTIONS.filter((p) => !usedPriorities.has(p));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
          <Shield size={15} className="text-accent" />
          {t('slaRules.title')}
        </h3>
        <p className="text-xs text-secondary mt-0.5">{t('slaRules.subtitle')}</p>
      </div>

      {/* SLA Stats */}
      {stats && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BarChart2 size={12} />
            {t('slaRules.stats')}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center">
              <div className="text-2xl font-bold text-accent tabular-nums">{stats.achievement_pct}%</div>
              <div className="text-[10px] text-muted mt-0.5">{t('slaRules.achievement')}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400 tabular-nums">{stats.on_time}</div>
              <div className="text-[10px] text-muted mt-0.5">{t('slaRules.onTime')}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400 tabular-nums">{stats.breached}</div>
              <div className="text-[10px] text-muted mt-0.5">{t('slaRules.breached')}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary tabular-nums">{stats.total}</div>
              <div className="text-[10px] text-muted mt-0.5">{t('slaRules.total')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Rules Table */}
      {rulesLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted py-4">
          <Loader2 size={16} className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : (
        <>
          {rules.length === 0 ? (
            <p className="text-sm text-muted italic">{t('slaRules.noRules')}</p>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                      {t('slaRules.priority')}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                      {t('slaRules.deadlineHours')}
                    </th>
                    <th className="px-4 py-2 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="border-b border-border last:border-0 hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className={`text-sm font-medium capitalize ${PRIORITY_COLORS[rule.priority] ?? 'text-primary'}`}>
                          {rule.priority}
                        </span>
                        {savedId === rule.id && (
                          <span className="ml-2 text-[10px] text-green-400">{t('slaRules.saved')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-primary tabular-nums">{rule.deadline_hours}h</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteMutation.mutate(rule.id)}
                          disabled={deleteMutation.isPending}
                          className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title={t('slaRules.delete')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Rule */}
          {availablePriorities.length > 0 && (
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('slaRules.priority')}</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {availablePriorities.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">{t('slaRules.deadlineHours')}</label>
                <input
                  type="number"
                  min="1"
                  value={newHours}
                  onChange={(e) => setNewHours(e.target.value)}
                  className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {t('slaRules.add')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
