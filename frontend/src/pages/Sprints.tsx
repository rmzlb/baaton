import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Zap, Calendar, Trash2, X, ChevronDown, ChevronRight,
  Play, CheckCircle2, Clock,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Sprint, SprintStatus, Issue } from '@/lib/types';

/* ── Status config ──────────────────────────── */

const STATUS_STYLES: Record<SprintStatus, { bg: string; text: string; dot: string; icon: typeof Play }> = {
  planning: {
    bg: 'bg-gray-50 dark:bg-gray-500/10',
    text: 'text-gray-700 dark:text-gray-400',
    dot: 'bg-gray-400',
    icon: Clock,
  },
  active: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
    icon: Play,
  },
  completed: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
};

/* ── Main Component ─────────────────────────── */

export default function Sprints() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [expandedSprints, setExpandedSprints] = useState<Set<string>>(new Set());

  // Form state
  const [formName, setFormName] = useState('');
  const [formGoal, setFormGoal] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formStatus, setFormStatus] = useState<SprintStatus>('planning');

  // Fetch project
  const { data: project } = useQuery({
    queryKey: ['project-by-slug', slug],
    queryFn: () => apiClient.projects.getBySlug(slug!),
    enabled: !!slug,
  });

  // Fetch sprints
  const { data: sprints = [], isLoading } = useQuery({
    queryKey: ['sprints', project?.id],
    queryFn: () => apiClient.sprints.listByProject(project!.id),
    enabled: !!project?.id,
  });

  // Fetch all project issues
  const { data: allIssues = [] } = useQuery({
    queryKey: ['issues', project?.id],
    queryFn: () => apiClient.issues.listByProject(project!.id),
    enabled: !!project?.id,
  });

  const activeSprint = useMemo(() => sprints.find(s => s.status === 'active'), [sprints]);

  const sprintIssues = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const sprint of sprints) {
      map[sprint.id] = allIssues.filter(i => i.sprint_id === sprint.id);
    }
    return map;
  }, [sprints, allIssues]);

  const toggleExpand = (id: string) => {
    setExpandedSprints(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: () => apiClient.sprints.create(project!.id, {
      name: formName,
      goal: formGoal || undefined,
      start_date: formStartDate || undefined,
      end_date: formEndDate || undefined,
      status: formStatus,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', project?.id] });
      setShowCreate(false);
      setFormName('');
      setFormGoal('');
      setFormStartDate('');
      setFormEndDate('');
      setFormStatus('planning');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.sprints.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', project?.id] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.sprints.update(id, { status: status as SprintStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', project?.id] });
    },
  });

  if (!project) return null;

  const sortedSprints = [...sprints].sort((a, b) => {
    // Active first, then planning, then completed
    const order: Record<string, number> = { active: 0, planning: 1, completed: 2 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <Zap size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-primary">{t('sprints.title')}</h1>
            <p className="text-xs text-secondary">{project.name}</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover transition-colors"
        >
          <Plus size={16} />
          {t('sprints.create')}
        </button>
      </div>

      {/* Active Sprint Highlight */}
      {activeSprint && (
        <div className="mb-6 rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Play size={16} className="text-blue-400" />
              <h2 className="text-lg font-semibold text-primary">{activeSprint.name}</h2>
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                {t('sprints.active')}
              </span>
            </div>
            <div className="text-xs text-secondary">
              {activeSprint.start_date && activeSprint.end_date && (
                <span>{activeSprint.start_date} → {activeSprint.end_date}</span>
              )}
            </div>
          </div>
          {activeSprint.goal && (
            <p className="text-sm text-secondary mb-3">{activeSprint.goal}</p>
          )}
          <SprintProgress issues={sprintIssues[activeSprint.id] || []} t={t} />
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="mb-6 rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-primary">{t('sprints.newSprint')}</h3>
            <button onClick={() => setShowCreate(false)} className="text-secondary hover:text-primary">
              <X size={16} />
            </button>
          </div>
          <input
            type="text"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder={t('sprints.namePlaceholder')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none"
            autoFocus
          />
          <input
            type="text"
            value={formGoal}
            onChange={e => setFormGoal(e.target.value)}
            placeholder={t('sprints.goalPlaceholder')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-secondary mb-1">{t('sprints.startDate')}</label>
              <input type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">{t('sprints.endDate')}</label>
              <input type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(['planning', 'active', 'completed'] as SprintStatus[]).map(s => {
              const style = STATUS_STYLES[s];
              return (
                <button key={s} onClick={() => setFormStatus(s)}
                  className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                    formStatus === s ? 'ring-2 ring-accent/40' : 'border-border text-secondary hover:bg-surface-hover'
                  )}
                >
                  {t(`sprints.status.${s}`)}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!formName.trim() || createMutation.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            {createMutation.isPending ? t('sprints.creating') : t('sprints.create')}
          </button>
        </div>
      )}

      {/* Sprint List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-accent" />
        </div>
      ) : sortedSprints.length === 0 ? (
        <div className="text-center py-20">
          <Zap size={40} className="mx-auto text-secondary/30 mb-3" />
          <p className="text-secondary text-sm">{t('sprints.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedSprints.map(sprint => {
            const style = STATUS_STYLES[sprint.status as SprintStatus] || STATUS_STYLES.planning;
            const StatusIcon = style.icon;
            const issues = sprintIssues[sprint.id] || [];
            const isExpanded = expandedSprints.has(sprint.id);
            const isActive = sprint.status === 'active';

            return (
              <div key={sprint.id} className={cn(
                'rounded-xl border bg-surface transition-all',
                isActive ? 'border-blue-500/30' : 'border-border',
              )}>
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => toggleExpand(sprint.id)}>
                  {isExpanded ? <ChevronDown size={14} className="text-secondary" /> : <ChevronRight size={14} className="text-secondary" />}
                  <StatusIcon size={14} className={style.text} />
                  <span className="text-sm font-medium text-primary flex-1">{sprint.name}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', style.bg, style.text)}>
                    {t(`sprints.status.${sprint.status}`)}
                  </span>
                  <span className="text-xs text-secondary">
                    {issues.length} {t('sprints.issues')}
                  </span>
                  {sprint.start_date && (
                    <span className="text-[10px] text-muted flex items-center gap-1">
                      <Calendar size={10} />
                      {sprint.start_date}{sprint.end_date ? ` → ${sprint.end_date}` : ''}
                    </span>
                  )}
                  <div className="flex items-center gap-1 ml-2">
                    {sprint.status === 'planning' && (
                      <button onClick={e => { e.stopPropagation(); updateStatusMutation.mutate({ id: sprint.id, status: 'active' }); }}
                        className="rounded p-1 text-blue-400 hover:bg-blue-500/10" title={t('sprints.start')}>
                        <Play size={12} />
                      </button>
                    )}
                    {sprint.status === 'active' && (
                      <button onClick={e => { e.stopPropagation(); updateStatusMutation.mutate({ id: sprint.id, status: 'completed' }); }}
                        className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10" title={t('sprints.complete')}>
                        <CheckCircle2 size={12} />
                      </button>
                    )}
                    <button onClick={e => { e.stopPropagation(); deleteMutation.mutate(sprint.id); }}
                      className="rounded p-1 text-red-400 hover:bg-red-500/10" title={t('sprints.delete')}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3">
                    {sprint.goal && <p className="text-xs text-secondary mb-3">{sprint.goal}</p>}
                    <SprintProgress issues={issues} t={t} />
                    {issues.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {issues.map(issue => (
                          <div key={issue.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-hover">
                            <span className={cn('h-2 w-2 rounded-full shrink-0',
                              issue.status === 'done' ? 'bg-emerald-500' :
                              issue.status === 'in_progress' ? 'bg-amber-500' :
                              issue.status === 'cancelled' ? 'bg-red-500' : 'bg-gray-400'
                            )} />
                            <span className="text-muted font-mono">{issue.display_id}</span>
                            <span className="text-primary truncate flex-1">{issue.title}</span>
                            {issue.estimate && (
                              <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-secondary font-mono">
                                {estimateLabel(issue.estimate)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted mt-2">{t('sprints.noIssues')}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Sprint Progress Bar ─────────────────────── */

function SprintProgress({ issues, t }: { issues: Issue[]; t: (key: string) => string }) {
  const total = issues.length;
  const done = issues.filter(i => i.status === 'done').length;
  const inProgress = issues.filter(i => i.status === 'in_progress' || i.status === 'in_review').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const totalPoints = issues.reduce((sum, i) => sum + (i.estimate || 0), 0);
  const donePoints = issues.filter(i => i.status === 'done').reduce((sum, i) => sum + (i.estimate || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-secondary mb-1.5">
        <span>{done}/{total} {t('sprints.completed')} ({pct}%)</span>
        {totalPoints > 0 && (
          <span>{t('sprints.velocity')}: {donePoints}/{totalPoints} {t('sprints.points')}</span>
        )}
      </div>
      <div className="h-2 rounded-full bg-surface-hover overflow-hidden flex">
        {total > 0 && (
          <>
            <div className="bg-emerald-500 transition-all" style={{ width: `${(done / total) * 100}%` }} />
            <div className="bg-amber-500 transition-all" style={{ width: `${(inProgress / total) * 100}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

/* ── Estimate helpers ────────────────────────── */

export function estimateLabel(value: number | null | undefined): string {
  if (!value) return '';
  const map: Record<number, string> = { 1: 'XS', 2: 'S', 3: 'M', 5: 'L', 8: 'XL' };
  return map[value] || `${value}pt`;
}

export const ESTIMATE_OPTIONS = [
  { value: 1, label: 'XS' },
  { value: 2, label: 'S' },
  { value: 3, label: 'M' },
  { value: 5, label: 'L' },
  { value: 8, label: 'XL' },
];
