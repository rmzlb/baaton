import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { TrendingUp, TrendingDown, Minus, Users, CheckCircle2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProjectGamificationStats } from '@/lib/types';

// ─── Mini Heatmap (30-day, project-scoped) ────────────

function MiniHeatmap({ data }: { data: Array<{ date: string; count: number }> }) {
  const today = new Date();
  const countMap = new Map(data.map((d) => [d.date, d.count]));

  // Build 30-day grid — 5 weeks × 7 days
  const dates: { date: Date; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dates.push({ date: d, count: countMap.get(key) ?? 0 });
  }

  // Group into weeks
  const weeks: { date: Date; count: number }[][] = [];
  let week: { date: Date; count: number }[] = [];
  for (const day of dates) {
    const dow = day.date.getDay();
    const monIdx = dow === 0 ? 6 : dow - 1;
    if (monIdx === 0 && week.length > 0) { weeks.push(week); week = []; }
    week.push(day);
  }
  if (week.length > 0) weeks.push(week);

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const level = (n: number) => {
    if (n === 0) return 0;
    if (n <= maxCount * 0.25) return 1;
    if (n <= maxCount * 0.5) return 2;
    if (n <= maxCount * 0.75) return 3;
    return 4;
  };
  const colors = [
    'bg-surface-hover',
    'bg-amber-900/40',
    'bg-amber-700/50',
    'bg-amber-500/60',
    'bg-amber-400',
  ];

  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="flex gap-[3px]" style={{ minWidth: `${weeks.length * 13}px` }}>
        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {wi === 0 && Array.from({ length: 7 - wk.length }).map((_, pi) => (
              <div key={`pad-${pi}`} className="w-[10px] h-[10px]" />
            ))}
            {wk.map((day, di) => (
              <div
                key={di}
                title={`${day.date.toISOString().slice(0, 10)}: ${day.count} actions`}
                className={cn('w-[10px] h-[10px] rounded-[2px]', colors[level(day.count)])}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────

function StatPill({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1.5">
      <Icon size={12} style={color ? { color } : undefined} className={!color ? 'text-muted' : ''} />
      <div>
        <span className="text-xs font-semibold tabular-nums text-primary">{value}</span>
        <span className="text-[10px] text-muted ml-1">{label}</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────

interface ProjectGamificationProps {
  projectId: string;
}

export function ProjectGamification({ projectId }: ProjectGamificationProps) {
  const { t } = useTranslation();
  const apiClient = useApi();

  const { data, isLoading } = useQuery({
    queryKey: ['project-gamification', projectId],
    queryFn: () => apiClient.projects.getGamification(projectId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3 animate-pulse">
        <div className="h-3 w-24 rounded bg-surface-hover" />
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded bg-surface-hover" />)}
        </div>
        <div className="h-12 rounded bg-surface-hover" />
      </div>
    );
  }

  if (!data) return null;

  const g: ProjectGamificationStats = data;
  const completionPct = Math.round(g.completion_rate * 100);

  const VelocityIcon = g.velocity_7d > 0.5 ? TrendingUp : g.velocity_7d === 0 ? Minus : TrendingDown;
  const velocityColor = g.velocity_7d > 0.5 ? '#22c55e' : g.velocity_7d === 0 ? undefined : '#f59e0b';

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
          {t('gamification.projectActivity')}
        </h3>
        {g.contributor_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted">
            <Users size={10} />
            {t('gamification.contributors', { count: g.contributor_count })}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <StatPill
          icon={VelocityIcon}
          value={`${g.velocity_7d.toFixed(1)}/d`}
          label={t('gamification.velocity')}
          color={velocityColor}
        />
        <StatPill
          icon={CheckCircle2}
          value={`${completionPct}%`}
          label={t('gamification.done')}
          color={completionPct >= 70 ? '#22c55e' : completionPct >= 40 ? '#f59e0b' : undefined}
        />
        <StatPill
          icon={Zap}
          value={g.issues_created_7d}
          label={t('gamification.created7d')}
        />
        <StatPill
          icon={CheckCircle2}
          value={g.issues_closed_7d}
          label={t('gamification.closed7d')}
          color="#22c55e"
        />
      </div>

      {/* Top contributors */}
      {g.top_contributors.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
            {t('gamification.topContributors')}
          </p>
          <div className="space-y-1">
            {g.top_contributors.slice(0, 3).map((c) => (
              <div key={c.user_id} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-surface-hover flex items-center justify-center text-[9px] font-bold text-primary uppercase">
                    {(c.user_name ?? c.user_id).slice(0, 2)}
                  </div>
                  <span className="text-[11px] text-secondary truncate max-w-[120px]">
                    {c.user_name ?? c.user_id}
                  </span>
                </div>
                <span className="text-[10px] tabular-nums text-muted">
                  {c.action_count} {t('gamification.actions')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 30-day activity heatmap */}
      {g.heatmap_30d.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
            {t('gamification.last30days')}
          </p>
          <MiniHeatmap data={g.heatmap_30d} />
        </div>
      )}
    </div>
  );
}
