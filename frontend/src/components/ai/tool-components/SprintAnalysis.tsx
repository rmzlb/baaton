import { CheckCircle2, RotateCcw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SprintData {
  sprint_name?: string;
  planned?: number;
  completed?: number;
  carried_over?: number;
  velocity_trend?: 'up' | 'down' | 'flat' | number;
  completion_rate?: number;
}

interface SprintAnalysisProps {
  data: SprintData | SprintData[];
}

export default function SprintAnalysis({ data }: SprintAnalysisProps) {
  const sprint: SprintData = Array.isArray(data) ? (data[0] ?? {}) : data;

  const completionRate = sprint.completion_rate != null
    ? sprint.completion_rate
    : sprint.planned && sprint.planned > 0
      ? Math.round(((sprint.completed ?? 0) / sprint.planned) * 100)
      : null;

  const trend = sprint.velocity_trend;
  const TrendIcon =
    trend === 'up' || (typeof trend === 'number' && trend > 0) ? TrendingUp
    : trend === 'down' || (typeof trend === 'number' && trend < 0) ? TrendingDown
    : Minus;
  const trendColor =
    trend === 'up' || (typeof trend === 'number' && trend > 0) ? 'text-emerald-400'
    : trend === 'down' || (typeof trend === 'number' && trend < 0) ? 'text-red-400'
    : 'text-[--color-muted]';

  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] p-4 space-y-3">
      {sprint.sprint_name && (
        <p className="text-xs font-semibold text-[--color-secondary]">{sprint.sprint_name}</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Planned', value: sprint.planned, color: 'text-[--color-primary]' },
          { label: 'Completed', value: sprint.completed, color: 'text-emerald-400', icon: CheckCircle2 },
          { label: 'Carried Over', value: sprint.carried_over, color: 'text-amber-400', icon: RotateCcw },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="flex flex-col gap-1 rounded-md bg-[--color-surface-hover] px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-[--color-muted]">{label}</span>
            <div className="flex items-center gap-1">
              {Icon && <Icon size={12} className={color} />}
              <span className={cn('text-xl font-bold', color)}>{value ?? '—'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs pt-1">
        {completionRate != null && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-24 rounded-full bg-[--color-border] overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{ width: `${Math.min(100, completionRate)}%` }}
              />
            </div>
            <span className="text-[--color-muted]">{completionRate}% done</span>
          </div>
        )}
        {trend != null && (
          <div className="flex items-center gap-1">
            <TrendIcon size={12} className={trendColor} />
            <span className={trendColor}>
              Velocity {typeof trend === 'number'
                ? `${trend > 0 ? '+' : ''}${trend}`
                : trend}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
