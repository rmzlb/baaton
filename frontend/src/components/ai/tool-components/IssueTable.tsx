import {
  Archive, CheckCircle2, Circle, Clock, Eye, XCircle,
  ArrowDown, ArrowUp, Minus, OctagonAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Issue {
  display_id?: string;
  title: string;
  status?: string;
  priority?: string;
  category?: string;
}

interface IssueTableProps {
  data: Issue[] | { issues?: Issue[] };
}

const STATUS_COLOR: Record<string, string> = {
  backlog: 'text-[--color-muted]',
  todo: 'text-blue-400',
  in_progress: 'text-amber-400',
  in_review: 'text-purple-400',
  done: 'text-emerald-400',
  cancelled: 'text-red-400',
};

const STATUS_ICON: Record<string, React.ElementType> = {
  backlog: Archive, todo: Circle, in_progress: Clock,
  in_review: Eye, done: CheckCircle2, cancelled: XCircle,
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-400 bg-red-400/10',
  high: 'text-orange-400 bg-orange-400/10',
  medium: 'text-yellow-400 bg-yellow-400/10',
  low: 'text-gray-400 bg-gray-400/10',
};

const PRIORITY_ICON: Record<string, React.ElementType> = {
  urgent: OctagonAlert, high: ArrowUp, medium: Minus, low: ArrowDown,
};

export default function IssueTable({ data }: IssueTableProps) {
  const issues: Issue[] = Array.isArray(data)
    ? data
    : (data?.issues ?? []);

  if (issues.length === 0) {
    return (
      <p className="text-xs text-[--color-muted] py-2">No issues found.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[--color-border]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[--color-border] bg-[--color-surface-hover]">
            <th className="px-3 py-2 text-left font-medium text-[--color-muted]">ID</th>
            <th className="px-3 py-2 text-left font-medium text-[--color-muted]">Title</th>
            <th className="px-3 py-2 text-left font-medium text-[--color-muted]">Status</th>
            <th className="px-3 py-2 text-left font-medium text-[--color-muted]">Priority</th>
            <th className="px-3 py-2 text-left font-medium text-[--color-muted]">Category</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, i) => {
            const StatusIcon = STATUS_ICON[issue.status ?? ''] ?? Circle;
            const PriorityIcon = PRIORITY_ICON[issue.priority ?? ''] ?? Minus;
            return (
              <tr
                key={issue.display_id ?? i}
                className="border-b border-[--color-border]/50 last:border-0 hover:bg-[--color-surface-hover]/50 transition-colors"
              >
                <td className="px-3 py-2 font-mono text-[--color-muted] whitespace-nowrap">
                  {issue.display_id ?? '—'}
                </td>
                <td className="px-3 py-2 text-[--color-primary] max-w-[200px] truncate">
                  {issue.title}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('flex items-center gap-1', STATUS_COLOR[issue.status ?? ''] ?? 'text-[--color-muted]')}>
                    <StatusIcon size={11} />
                    {issue.status?.replace('_', ' ') ?? '—'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {issue.priority ? (
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', PRIORITY_COLOR[issue.priority] ?? '')}>
                      <PriorityIcon size={9} />
                      {issue.priority}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-[--color-secondary] capitalize">
                  {issue.category ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
