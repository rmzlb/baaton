import { TrendingUp, CheckCircle2, Circle, Bug, Zap, Folders } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricsData {
  total?: number;
  open?: number;
  in_progress?: number;
  done?: number;
  velocity?: number;
  bug_ratio?: number;
  avg_cycle_time_hours?: number | null;
  project_name?: string | null;
  project_prefix?: string | null;
  scope_label?: string | null;
}

interface MetricsCardProps {
  data: MetricsData | MetricsData[];
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] font-medium uppercase tracking-wider text-[--color-muted] truncate">
        {label}
      </span>
      <span
        className={cn(
          'text-xl font-semibold leading-none tabular-nums text-[--color-primary]',
          color,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Inline({
  icon: Icon,
  label,
  value,
  iconColor,
  valueColor,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  iconColor: string;
  valueColor?: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]">
      <Icon size={11} className={iconColor} />
      <span className="text-[--color-muted]">{label}</span>
      <span className={cn('font-semibold tabular-nums', valueColor ?? 'text-[--color-primary]')}>
        {value}
      </span>
    </div>
  );
}

export default function MetricsCard({ data }: MetricsCardProps) {
  const metrics: MetricsData = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});

  const bugPct =
    metrics.bug_ratio != null ? `${Math.round(metrics.bug_ratio * 100)}%` : '—';
  const completionPct =
    metrics.done != null && metrics.total != null && metrics.total > 0
      ? `${Math.round((metrics.done / metrics.total) * 100)}%`
      : null;

  // Project header: prefer scope_label from backend, fallback to project_name, then "Tous projets".
  const headerLabel =
    metrics.scope_label ||
    (metrics.project_prefix && metrics.project_name
      ? `[${metrics.project_prefix}] ${metrics.project_name}`
      : metrics.project_name) ||
    'Tous projets';

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] overflow-hidden">
      {/* ── Header (always visible — disambiguates which project the card is about) ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[--color-border] bg-[--color-bg]/40">
        {metrics.project_prefix ? (
          <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
            {metrics.project_prefix}
          </span>
        ) : (
          <Folders size={11} className="text-[--color-muted] shrink-0" />
        )}
        <span className="text-[12px] font-semibold text-[--color-primary] truncate min-w-0">
          {metrics.project_prefix && metrics.project_name
            ? metrics.project_name
            : headerLabel}
        </span>
      </div>

      {/* ── Hero KPIs (2x2 mobile / 1x4 desktop) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-3 py-3">
        <Stat label="Total" value={metrics.total ?? '—'} />
        <Stat label="Open" value={metrics.open ?? '—'} color="text-blue-300" />
        <Stat
          label="In progress"
          value={metrics.in_progress ?? '—'}
          color="text-amber-300"
        />
        <Stat label="Done" value={metrics.done ?? '—'} color="text-emerald-300" />
      </div>

      {/* ── Footer metrics (wrap freely; no overflow on narrow panels) ── */}
      <div className="border-t border-[--color-border] px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {metrics.velocity != null && (
          <Inline
            icon={Zap}
            label="Velocity"
            value={`${metrics.velocity}/14d`}
            iconColor="text-amber-400"
          />
        )}
        {metrics.bug_ratio != null && (
          <Inline
            icon={Bug}
            label="Bug ratio"
            value={bugPct}
            iconColor="text-red-400"
            valueColor={
              metrics.bug_ratio > 0.3
                ? 'text-red-300'
                : metrics.bug_ratio > 0.15
                  ? 'text-amber-300'
                  : undefined
            }
          />
        )}
        {completionPct && (
          <Inline
            icon={CheckCircle2}
            label="Completion"
            value={completionPct}
            iconColor="text-emerald-400"
            valueColor="text-emerald-300"
          />
        )}
        {metrics.avg_cycle_time_hours != null && (
          <Inline
            icon={TrendingUp}
            label="Cycle"
            value={`${metrics.avg_cycle_time_hours}h`}
            iconColor="text-[--color-muted]"
          />
        )}
        {metrics.open != null &&
          metrics.total != null &&
          metrics.total > 0 &&
          completionPct == null && (
            <Inline
              icon={Circle}
              label="Remaining"
              value={`${Math.round((metrics.open / metrics.total) * 100)}%`}
              iconColor="text-blue-400"
              valueColor="text-blue-300"
            />
          )}
      </div>
    </div>
  );
}
