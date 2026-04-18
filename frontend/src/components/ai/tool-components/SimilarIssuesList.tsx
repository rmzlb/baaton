import { Copy, Archive, Circle, Clock, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Candidate {
  display_id?: string;
  title: string;
  status?: string;
  similarity_score?: number;
}

interface SimilarIssuesData {
  reference_title?: string;
  candidates?: Candidate[];
}

interface SimilarIssuesListProps {
  data: SimilarIssuesData;
}

const STATUS_ICON: Record<string, React.ElementType> = {
  backlog: Archive, todo: Circle, in_progress: Clock,
  in_review: Eye, done: CheckCircle2, cancelled: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  backlog: 'text-[--color-muted]',
  todo: 'text-blue-400',
  in_progress: 'text-amber-400',
  in_review: 'text-purple-400',
  done: 'text-emerald-400',
  cancelled: 'text-red-400',
};

export default function SimilarIssuesList({ data }: SimilarIssuesListProps) {
  const candidates = data?.candidates ?? [];
  const refTitle = data?.reference_title;

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4">
        {refTitle && (
          <div className="flex items-center gap-2 text-xs text-[--color-muted] mb-2">
            <Copy size={12} />
            <span>Similaires à : <span className="text-[--color-primary] font-medium">{refTitle}</span></span>
          </div>
        )}
        <p className="text-xs text-[--color-muted]">Aucune issue similaire trouvée.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-4 space-y-3">
      {refTitle && (
        <div className="flex items-center gap-2 text-xs text-[--color-muted]">
          <Copy size={12} />
          <span>Similaires à : <span className="text-[--color-primary] font-medium">{refTitle}</span></span>
        </div>
      )}

      <ul className="space-y-1.5">
        {candidates.map((c, i) => {
          const score = c.similarity_score ?? 0;
          const pct = Math.round(score * 100);
          const StatusIcon = STATUS_ICON[c.status ?? ''] ?? Circle;
          const statusColor = STATUS_COLOR[c.status ?? ''] ?? 'text-[--color-muted]';

          return (
            <li
              key={c.display_id ?? i}
              className="flex items-center gap-3 rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 hover:border-amber-500/30 transition-colors"
            >
              <span className="font-mono text-[11px] text-[--color-muted] shrink-0 w-16">
                {c.display_id ?? '—'}
              </span>
              <span className="text-[13px] text-[--color-primary] truncate flex-1 min-w-0">
                {c.title}
              </span>
              <span className={cn('flex items-center gap-1 text-[11px] shrink-0', statusColor)}>
                <StatusIcon size={11} />
                {c.status?.replace('_', ' ') ?? '—'}
              </span>
              <div className="flex items-center gap-1.5 shrink-0 w-20">
                <div className="h-1.5 flex-1 rounded-full bg-[--color-border] overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      pct >= 70 ? 'bg-amber-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-zinc-400',
                    )}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <span className="text-[10px] text-[--color-muted] font-mono w-7 text-right">
                  {pct}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
