import { OctagonAlert, ArrowUp, Minus, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PriorityItem {
  display_id?: string;
  title: string;
  urgency_score?: number;
  reasons?: string[];
  current_priority?: string;
  suggested_priority?: string;
}

interface PriorityListProps {
  data: PriorityItem[] | { priorities?: PriorityItem[]; items?: PriorityItem[] };
}

const URGENCY_CONFIG = [
  { min: 0.8, label: 'Critical', color: 'text-red-400', bg: 'bg-red-400/10', Icon: OctagonAlert },
  { min: 0.6, label: 'High', color: 'text-orange-400', bg: 'bg-orange-400/10', Icon: ArrowUp },
  { min: 0.4, label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-400/10', Icon: Minus },
  { min: 0, label: 'Low', color: 'text-gray-400', bg: 'bg-gray-400/10', Icon: ArrowDown },
];

function getUrgency(score?: number) {
  if (score == null) return URGENCY_CONFIG[3];
  return URGENCY_CONFIG.find((c) => score >= c.min) ?? URGENCY_CONFIG[3];
}

export default function PriorityList({ data }: PriorityListProps) {
  const items: PriorityItem[] = Array.isArray(data)
    ? data
    : (data?.priorities ?? data?.items ?? []);

  if (items.length === 0) {
    return <p className="text-xs text-[--color-muted] py-2">No priority items.</p>;
  }

  return (
    <ol className="space-y-2">
      {items.map((item, i) => {
        const urgency = getUrgency(item.urgency_score);
        const { Icon } = urgency;
        return (
          <li
            key={item.display_id ?? i}
            className="flex items-start gap-3 rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2.5"
          >
            <span className="text-xs font-mono text-[--color-muted] min-w-[1.5rem] pt-0.5">
              {i + 1}.
            </span>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {item.display_id && (
                  <span className="font-mono text-[10px] text-[--color-muted]">{item.display_id}</span>
                )}
                <span className="text-sm font-medium text-[--color-primary] truncate">{item.title}</span>
                <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', urgency.color, urgency.bg)}>
                  <Icon size={9} />
                  {urgency.label}
                  {item.urgency_score != null && ` · ${Math.round(item.urgency_score * 100)}`}
                </span>
              </div>
              {item.reasons && item.reasons.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {item.reasons.map((r, j) => (
                    <li key={j} className="text-[10px] text-[--color-muted] bg-[--color-surface-hover] rounded px-1.5 py-0.5">
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
