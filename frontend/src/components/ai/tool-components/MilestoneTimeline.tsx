import { CalendarDays, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MilestoneItem {
  name: string;
  description?: string;
  target_date?: string;
  issue_count?: number;
  issues?: Array<{ title?: string; display_id?: string }>;
  status?: 'planned' | 'in_progress' | 'done';
}

interface MilestoneTimelineProps {
  data:
    | MilestoneItem[]
    | { milestones?: MilestoneItem[]; plan?: { milestones?: MilestoneItem[] } };
}

function formatDate(d?: string) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return d;
  }
}

export default function MilestoneTimeline({ data }: MilestoneTimelineProps) {
  const milestones: MilestoneItem[] = Array.isArray(data)
    ? data
    : (
        (data as { milestones?: MilestoneItem[] }).milestones ??
        (data as { plan?: { milestones?: MilestoneItem[] } }).plan?.milestones ??
        []
      );

  if (milestones.length === 0) {
    return <p className="text-xs text-[--color-muted] py-2">No milestones.</p>;
  }

  return (
    <div className="relative space-y-0">
      {/* vertical line */}
      <div className="absolute left-[13px] top-4 bottom-4 w-px bg-[--color-border]" />

      {milestones.map((m, i) => {
        const isDone = m.status === 'done';
        const Icon = isDone ? CheckCircle2 : Circle;
        const issueCount = m.issue_count ?? m.issues?.length ?? 0;

        return (
          <div key={i} className="relative flex items-start gap-3 pb-5 last:pb-0">
            {/* node */}
            <div className="relative z-10 mt-0.5 shrink-0">
              <Icon
                size={14}
                className={cn(
                  isDone ? 'text-emerald-400' : 'text-[--color-accent]',
                  'bg-[--color-bg]',
                )}
              />
            </div>

            <div className="flex-1 rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2.5 space-y-1.5">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[--color-primary]">{m.name}</span>
                <div className="flex items-center gap-1 text-[10px] text-[--color-muted] whitespace-nowrap">
                  <CalendarDays size={10} />
                  {formatDate(m.target_date)}
                </div>
              </div>
              {m.description && (
                <p className="text-xs text-[--color-secondary]">{m.description}</p>
              )}
              {issueCount > 0 && (
                <p className="text-[10px] text-[--color-muted]">
                  {issueCount} issue{issueCount !== 1 ? 's' : ''}
                  {m.issues && m.issues.length > 0 && (
                    <span className="ml-1 text-[--color-muted]">
                      ({m.issues.slice(0, 3).map((iss) => iss.display_id ?? iss.title ?? '?').join(', ')}
                      {m.issues.length > 3 ? '…' : ''})
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
