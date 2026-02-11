import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import type { Issue, Sprint } from '@/lib/types';

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function AnalyticsPM() {
  const { t } = useTranslation();
  const api = useApi();

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api.projects.list() });

  const { data: dataset, isLoading } = useQuery({
    queryKey: ['analytics-pm', projects.map((p) => p.id).join(',')],
    enabled: projects.length > 0,
    queryFn: async () => {
      const [allIssues, perProjectSprints] = await Promise.all([
        api.issues.listAll({ limit: 2000 }),
        Promise.all(projects.map((p) => api.sprints.listByProject(p.id))),
      ]);
      return {
        allIssues,
        sprints: perProjectSprints.flat(),
      };
    },
  });

  const metrics = useMemo(() => {
    const allIssues = dataset?.allIssues ?? [];
    const allSprints = (dataset?.sprints ?? []).sort((a, b) =>
      new Date(a.start_date || a.created_at).getTime() - new Date(b.start_date || b.created_at).getTime(),
    );

    const completed = allIssues.filter((i) => i.status === 'done');
    const cycleIssues = completed.filter((i) => i.updated_at);
    const avgCycleTime = cycleIssues.length > 0
      ? Math.round(cycleIssues.reduce((sum, i) => sum + daysBetween(new Date(i.created_at), new Date(i.updated_at)), 0) / cycleIssues.length)
      : 0;

    const velocity = allSprints.slice(-8).map((s) => {
      const doneCount = allIssues.filter((i) => i.sprint_id === s.id && i.status === 'done').length;
      return { label: s.name, doneCount };
    });

    const activeSprint = allSprints.find((s) => s.status === 'active');
    const sprintIssues = activeSprint ? allIssues.filter((i) => i.sprint_id === activeSprint.id) : [];
    const total = sprintIssues.length;
    const done = sprintIssues.filter((i) => i.status === 'done').length;
    const remaining = Math.max(0, total - done);

    const burnup = buildBurnup(activeSprint, sprintIssues);

    return {
      avgCycleTime,
      completedCount: completed.length,
      velocity,
      activeSprint,
      total,
      done,
      remaining,
      burnup,
    };
  }, [dataset]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary">{t('analytics.title')}</h1>
          <p className="text-xs text-secondary mt-1">{t('analytics.subtitle')}</p>
        </div>
        <BarChart3 size={20} className="text-accent" />
      </div>

      {isLoading ? (
        <div className="text-sm text-secondary text-center py-16">{t('common.loading')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card title={t('analytics.cycleTime')} value={`${metrics.avgCycleTime}d`} subtitle={t('analytics.cycleTimeDesc')} />
            <Card title={t('analytics.completedIssues')} value={String(metrics.completedCount)} subtitle={t('analytics.completedDesc')} />
            <Card
              title={t('analytics.activeSprintProgress')}
              value={metrics.activeSprint ? `${metrics.done}/${metrics.total}` : t('analytics.noActiveSprint')}
              subtitle={metrics.activeSprint?.name || t('analytics.startSprintHint')}
            />
          </div>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-primary mb-3">{t('analytics.velocity')}</h2>
            <div className="space-y-2">
              {metrics.velocity.length === 0 ? (
                <p className="text-xs text-secondary">{t('analytics.noVelocityData')}</p>
              ) : metrics.velocity.map((v) => (
                <div key={v.label} className="flex items-center gap-3">
                  <div className="w-40 text-xs text-secondary truncate">{v.label}</div>
                  <div className="flex-1 h-3 rounded-full bg-surface-hover overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.max(4, (v.doneCount / Math.max(1, Math.max(...metrics.velocity.map((x) => x.doneCount)))) * 100)}%` }}
                    />
                  </div>
                  <div className="w-8 text-xs text-primary text-right tabular-nums">{v.doneCount}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-primary mb-3">{t('analytics.burnup')}</h2>
            {!metrics.activeSprint ? (
              <p className="text-xs text-secondary">{t('analytics.noActiveSprint')}</p>
            ) : (
              <div className="space-y-2">
                {metrics.burnup.map((point, idx) => (
                  <div key={`${point.label}-${idx}`} className="grid grid-cols-[68px_1fr_1fr] gap-2 items-center">
                    <div className="text-[10px] text-muted">{point.label}</div>
                    <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${point.ideal}%` }} />
                    </div>
                    <div className="h-2 rounded-full bg-surface-hover overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${point.actual}%` }} />
                    </div>
                  </div>
                ))}
                <div className="text-[10px] text-secondary pt-1">
                  <span className="mr-3">{t('analytics.idealLine')}</span>
                  <span>{t('analytics.actualLine')}</span>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Card({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase text-muted tracking-wide">{title}</p>
      <p className="text-2xl font-bold text-primary mt-2">{value}</p>
      <p className="text-xs text-secondary mt-1">{subtitle}</p>
    </div>
  );
}

function buildBurnup(activeSprint: Sprint | undefined, sprintIssues: Issue[]) {
  if (!activeSprint) return [];
  const total = Math.max(1, sprintIssues.length);
  const start = new Date(activeSprint.start_date || activeSprint.created_at);
  const end = new Date(activeSprint.end_date || new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000));

  const checkpoints = 6;
  const points: Array<{ label: string; ideal: number; actual: number }> = [];

  for (let i = 0; i <= checkpoints; i++) {
    const ratio = i / checkpoints;
    const timestamp = new Date(start.getTime() + (end.getTime() - start.getTime()) * ratio);
    const doneUntilPoint = sprintIssues.filter((issue) => issue.status === 'done' && new Date(issue.updated_at) <= timestamp).length;

    points.push({
      label: timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ideal: ratio * 100,
      actual: (doneUntilPoint / total) * 100,
    });
  }

  return points;
}
