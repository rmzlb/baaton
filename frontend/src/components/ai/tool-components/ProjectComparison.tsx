import { BarChart3, Zap, Bug, CheckCircle2, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProjectMetrics {
  project_id?: string;
  name?: string;
  prefix?: string;
  total?: number;
  open?: number;
  done?: number;
  velocity_14d?: number;
  bug_ratio?: number;
  completion_ratio?: number;
}

interface CompareData {
  projects?: ProjectMetrics[];
}

interface ProjectComparisonProps {
  data: CompareData;
}

type MetricKey = 'velocity_14d' | 'completion_ratio' | 'bug_ratio' | 'total';

function bestForMetric(projects: ProjectMetrics[], key: MetricKey, lower = false): string | undefined {
  if (projects.length === 0) return undefined;
  const sorted = [...projects].sort((a, b) => {
    const va = (a[key] as number) ?? 0;
    const vb = (b[key] as number) ?? 0;
    return lower ? va - vb : vb - va;
  });
  return sorted[0]?.project_id;
}

function MetricRow({
  icon: Icon, label, value, highlight,
}: { icon: React.ElementType; label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-1.5 text-[11px] text-[--color-muted]">
        <Icon size={11} />
        {label}
      </div>
      <span className={cn(
        'text-[13px] font-semibold',
        highlight ? 'text-amber-400' : 'text-[--color-primary]',
      )}>
        {value}
      </span>
    </div>
  );
}

export default function ProjectComparison({ data }: ProjectComparisonProps) {
  const projects = data?.projects ?? [];

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4">
        <p className="text-xs text-[--color-muted]">Aucun projet à comparer.</p>
      </div>
    );
  }

  const bestVelocity = bestForMetric(projects, 'velocity_14d');
  const bestCompletion = bestForMetric(projects, 'completion_ratio');
  const bestBugRatio = bestForMetric(projects, 'bug_ratio', true);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-[--color-secondary] font-medium">
        <BarChart3 size={13} />
        Comparaison de {projects.length} projets
      </div>

      <div className={cn(
        'grid gap-3',
        projects.length <= 2 ? 'grid-cols-2' : projects.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
      )}>
        {projects.map((p) => {
          const id = p.project_id ?? p.prefix ?? '?';
          return (
            <div
              key={id}
              className="rounded-xl border border-[--color-border] bg-[--color-surface] p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-amber-400/80 bg-amber-400/10 rounded px-1.5 py-0.5">
                  {p.prefix ?? '?'}
                </span>
                <span className="text-[13px] font-medium text-[--color-primary] truncate">
                  {p.name ?? id}
                </span>
              </div>

              <div className="space-y-0.5 border-t border-[--color-border] pt-2">
                <MetricRow icon={Layers} label="Total" value={p.total ?? 0} />
                <MetricRow icon={Layers} label="Open" value={p.open ?? 0} />
                <MetricRow icon={CheckCircle2} label="Done" value={p.done ?? 0} />
                <MetricRow
                  icon={Zap}
                  label="Velocity (14d)"
                  value={p.velocity_14d ?? 0}
                  highlight={id === bestVelocity}
                />
                <MetricRow
                  icon={Bug}
                  label="Bug ratio"
                  value={p.bug_ratio != null ? `${Math.round(p.bug_ratio * 100)}%` : '—'}
                  highlight={id === bestBugRatio}
                />
                <MetricRow
                  icon={CheckCircle2}
                  label="Completion"
                  value={p.completion_ratio != null ? `${Math.round(p.completion_ratio * 100)}%` : '—'}
                  highlight={id === bestCompletion}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
