import {
  CheckCircle2,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  Folders,
  CalendarOff,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SprintData {
  sprint_name?: string | null;
  planned?: number;
  completed?: number;
  carried_over?: number;
  blocked?: number;
  pct?: number;
  velocity_trend?: 'up' | 'down' | 'flat' | 'on_track' | 'at_risk' | 'behind' | 'N/A' | number;
  completion_rate?: number;
  project_name?: string | null;
  project_prefix?: string | null;
  scope_label?: string | null;
  no_active_sprint?: boolean;
}

interface SprintAnalysisProps {
  data: SprintData | SprintData[];
}

export default function SprintAnalysis({ data }: SprintAnalysisProps) {
  const sprint: SprintData = Array.isArray(data) ? (data[0] ?? {}) : data;

  // Project context (always show — disambiguates which project the sprint belongs to)
  const headerLabel =
    sprint.scope_label ||
    (sprint.project_prefix && sprint.project_name
      ? `[${sprint.project_prefix}] ${sprint.project_name}`
      : sprint.project_name) ||
    'Tous projets';

  // Compact empty state when there's no active sprint — saves vertical space.
  if (sprint.no_active_sprint) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2.5">
        {sprint.project_prefix ? (
          <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
            {sprint.project_prefix}
          </span>
        ) : (
          <Folders size={11} className="text-[--color-muted] shrink-0" />
        )}
        <span className="text-[12px] text-[--color-primary] truncate flex-1 min-w-0">
          {sprint.project_prefix && sprint.project_name
            ? sprint.project_name
            : headerLabel}
        </span>
        <CalendarOff size={11} className="text-[--color-muted] shrink-0" />
        <span className="text-[11px] text-[--color-muted] shrink-0">
          aucun sprint actif
        </span>
      </div>
    );
  }

  const completionRate =
    sprint.completion_rate != null
      ? sprint.completion_rate
      : sprint.pct != null
        ? sprint.pct
        : sprint.planned && sprint.planned > 0
          ? Math.round(((sprint.completed ?? 0) / sprint.planned) * 100)
          : null;

  const trend = sprint.velocity_trend;
  const trendUp = trend === 'up' || trend === 'on_track' || (typeof trend === 'number' && trend > 0);
  const trendDown =
    trend === 'down' || trend === 'behind' || (typeof trend === 'number' && trend < 0);
  const TrendIcon = trendUp ? TrendingUp : trendDown ? TrendingDown : Minus;
  const trendColor = trendUp
    ? 'text-emerald-400'
    : trendDown
      ? 'text-red-400'
      : trend === 'at_risk'
        ? 'text-amber-400'
        : 'text-[--color-muted]';
  const trendLabel =
    trend === 'on_track'
      ? 'on track'
      : trend === 'at_risk'
        ? 'at risk'
        : trend === 'behind'
          ? 'behind'
          : trend === 'N/A'
            ? 'N/A'
            : typeof trend === 'number'
              ? `${trend > 0 ? '+' : ''}${trend}`
              : (trend ?? 'N/A');

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] overflow-hidden">
      {/* ── Header (project + sprint name) ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[--color-border] bg-[--color-bg]/40">
        {sprint.project_prefix ? (
          <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
            {sprint.project_prefix}
          </span>
        ) : (
          <Folders size={11} className="text-[--color-muted] shrink-0" />
        )}
        <span className="text-[12px] font-semibold text-[--color-primary] truncate min-w-0">
          {sprint.project_prefix && sprint.project_name
            ? sprint.project_name
            : headerLabel}
        </span>
        {sprint.sprint_name && (
          <>
            <Target size={10} className="text-[--color-muted] shrink-0" />
            <span className="text-[11px] text-[--color-secondary] truncate min-w-0">
              {sprint.sprint_name}
            </span>
          </>
        )}
      </div>

      {/* ── Hero stats ── */}
      <div className="grid grid-cols-3 gap-2 px-3 py-3">
        {[
          { label: 'Planned', value: sprint.planned, color: 'text-[--color-primary]' },
          {
            label: 'Completed',
            value: sprint.completed,
            color: 'text-emerald-300',
            icon: CheckCircle2,
          },
          {
            label: 'Carried',
            value: sprint.carried_over,
            color: 'text-amber-300',
            icon: RotateCcw,
          },
        ].map(({ label, value, color, icon: Icon }) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-lg bg-[--color-surface-hover] px-2.5 py-2"
          >
            <span className="text-[9px] font-medium uppercase tracking-wider text-[--color-muted] truncate">
              {label}
            </span>
            <div className="flex items-center gap-1">
              {Icon && <Icon size={11} className={color} />}
              <span className={cn('text-lg font-semibold leading-none tabular-nums', color)}>
                {value ?? '—'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer (progress + trend, wraps cleanly) ── */}
      <div className="border-t border-[--color-border] px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        {completionRate != null && (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <div className="h-1 w-16 rounded-full bg-[--color-border] overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  completionRate >= 60
                    ? 'bg-emerald-400'
                    : completionRate >= 30
                      ? 'bg-amber-400'
                      : 'bg-red-400',
                )}
                style={{ width: `${Math.min(100, completionRate)}%` }}
              />
            </div>
            <span className="text-[--color-muted] tabular-nums">{completionRate}% done</span>
          </div>
        )}
        {trend != null && (
          <div className="flex items-center gap-1 whitespace-nowrap">
            <TrendIcon size={11} className={trendColor} />
            <span className={trendColor}>{trendLabel}</span>
          </div>
        )}
        {sprint.blocked != null && sprint.blocked > 0 && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-red-300">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden="true" />
            {sprint.blocked} blocked
          </span>
        )}
      </div>
    </div>
  );
}
