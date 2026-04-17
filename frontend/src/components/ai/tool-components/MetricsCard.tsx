import { TrendingUp, CheckCircle2, Circle, Bug, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricsData {
  total?: number;
  open?: number;
  in_progress?: number;
  done?: number;
  velocity?: number;
  bug_ratio?: number;
  project_name?: string;
}

interface MetricsCardProps {
  data: MetricsData | MetricsData[];
}

function Stat({
  label, value, sub, color,
}: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[--color-muted]">{label}</span>
      <span className={cn('text-lg font-semibold text-[--color-primary]', color)}>
        {value}
        {sub && <span className="text-xs font-normal text-[--color-muted] ml-1">{sub}</span>}
      </span>
    </div>
  );
}

export default function MetricsCard({ data }: MetricsCardProps) {
  const metrics: MetricsData = Array.isArray(data) ? (data[0] ?? {}) : data;

  const bugPct = metrics.bug_ratio != null
    ? `${Math.round(metrics.bug_ratio * 100)}%`
    : '—';

  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] p-4 space-y-4">
      {metrics.project_name && (
        <div className="flex items-center gap-2 text-xs text-[--color-secondary] font-medium">
          <TrendingUp size={13} />
          {metrics.project_name}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Total" value={metrics.total ?? '—'} />
        <Stat
          label="Open"
          value={metrics.open ?? '—'}
          color="text-blue-400"
        />
        <Stat
          label="In Progress"
          value={metrics.in_progress ?? '—'}
          color="text-amber-400"
        />
        <Stat
          label="Done"
          value={metrics.done ?? '—'}
          color="text-emerald-400"
        />
      </div>

      <div className="border-t border-[--color-border] pt-3 flex items-center gap-6">
        {metrics.velocity != null && (
          <div className="flex items-center gap-1.5 text-xs">
            <Zap size={12} className="text-amber-400" />
            <span className="text-[--color-muted]">Velocity</span>
            <span className="font-semibold text-[--color-primary]">{metrics.velocity}</span>
            <span className="text-[--color-muted]">pts/sprint</span>
          </div>
        )}
        {metrics.bug_ratio != null && (
          <div className="flex items-center gap-1.5 text-xs">
            <Bug size={12} className="text-red-400" />
            <span className="text-[--color-muted]">Bug ratio</span>
            <span className="font-semibold text-[--color-primary]">{bugPct}</span>
          </div>
        )}
        {metrics.done != null && metrics.total != null && metrics.total > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span className="text-[--color-muted]">Completion</span>
            <span className="font-semibold text-emerald-400">
              {Math.round((metrics.done / metrics.total) * 100)}%
            </span>
          </div>
        )}
        {metrics.open != null && metrics.total != null && metrics.total > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <Circle size={12} className="text-blue-400" />
            <span className="text-[--color-muted]">Remaining</span>
            <span className="font-semibold text-blue-400">
              {Math.round((metrics.open / metrics.total) * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
