import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AssigneeEntry {
  assignee_id?: string | null;
  is_unassigned?: boolean;
  total?: number;
  by_status?: {
    backlog?: number;
    todo?: number;
    in_progress?: number;
    in_review?: number;
    done?: number;
    cancelled?: number;
  };
}

interface WorkloadData {
  assignees?: AssigneeEntry[];
  scope?: string;
}

interface WorkloadDistributionProps {
  data: WorkloadData;
}

const STATUS_SEGMENTS: { key: keyof NonNullable<AssigneeEntry['by_status']>; color: string; label: string }[] = [
  { key: 'backlog', color: 'bg-zinc-500', label: 'Backlog' },
  { key: 'todo', color: 'bg-blue-400', label: 'Todo' },
  { key: 'in_progress', color: 'bg-amber-400', label: 'In Progress' },
  { key: 'in_review', color: 'bg-violet-400', label: 'In Review' },
];

export default function WorkloadDistribution({ data }: WorkloadDistributionProps) {
  const assignees = data?.assignees ?? [];

  if (assignees.length === 0) {
    return (
      <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4">
        <p className="text-xs text-[--color-muted]">Aucune donnée de charge.</p>
      </div>
    );
  }

  const maxTotal = Math.max(...assignees.map(a => a.total ?? 0), 1);

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[--color-secondary] font-medium">
          <Users size={13} />
          Charge par développeur
        </div>
        <div className="flex items-center gap-3">
          {STATUS_SEGMENTS.map(seg => (
            <div key={seg.key} className="flex items-center gap-1 text-[10px] text-[--color-muted]">
              <div className={cn('h-2 w-2 rounded-sm', seg.color)} />
              {seg.label}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {assignees.map((a, i) => {
          const total = a.total ?? 0;
          const barWidth = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
          const statuses = a.by_status ?? {};
          const label = a.is_unassigned ? 'Non assigné' : (a.assignee_id ?? 'Inconnu');
          const shortLabel = label.length > 20 ? `${label.slice(0, 8)}…${label.slice(-8)}` : label;

          return (
            <div key={a.assignee_id ?? `unassigned-${i}`} className="flex items-center gap-3">
              <span
                className={cn(
                  'text-[11px] shrink-0 w-28 truncate text-right',
                  a.is_unassigned ? 'text-[--color-muted] italic' : 'text-[--color-primary] font-mono',
                )}
                title={label}
              >
                {shortLabel}
              </span>

              <div className="flex-1 h-5 rounded bg-[--color-surface-hover] overflow-hidden relative">
                <div
                  className="h-full flex"
                  style={{ width: `${Math.max(barWidth, 2)}%` }}
                >
                  {STATUS_SEGMENTS.map(seg => {
                    const count = statuses[seg.key] ?? 0;
                    if (count === 0 || total === 0) return null;
                    const segPct = (count / total) * 100;
                    return (
                      <div
                        key={seg.key}
                        className={cn('h-full transition-all', seg.color)}
                        style={{ width: `${segPct}%` }}
                        title={`${seg.label}: ${count}`}
                      />
                    );
                  })}
                </div>
              </div>

              <span className="text-[11px] font-semibold text-[--color-primary] w-8 text-right shrink-0">
                {total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
