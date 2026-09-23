import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { formatDuration, timePerStatus, type StatusChange } from '@/lib/statusTime';

interface StatusTimeProps {
  issueId: string;
  status: string;
  statusChangedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  labelFor: (status: string) => string;
  t: (key: string, vars?: Record<string, string>) => string;
}

/**
 * "In Review for 16h (since 22 Sep, 21:28)" and the time spent in every status
 * the issue went through. Shares the activity query of the drawer's log.
 */
export function StatusTime({ issueId, status, statusChangedAt, createdAt, closedAt, labelFor, t }: StatusTimeProps) {
  const apiClient = useApi();
  const { data: activities = [] } = useQuery({
    queryKey: ['activity', issueId],
    queryFn: () => apiClient.get<StatusChange[]>(`/issues/${issueId}/activity`),
    staleTime: 15_000,
  });

  const since = statusChangedAt ?? createdAt;
  const until = closedAt ? new Date(closedAt) : new Date();
  const current = formatDuration(until.getTime() - new Date(since).getTime());
  const sinceLabel = new Date(since).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const spans = timePerStatus(activities, createdAt, status, until);

  return (
    <div className="mt-1 space-y-1">
      <p className="text-[10px] text-muted tabular-nums">
        {t('issueDrawer.inStatusFor', { status: labelFor(status), duration: current, date: sinceLabel })}
      </p>
      {spans.length > 1 && (
        <p className="text-[10px] text-muted tabular-nums flex flex-wrap items-center gap-x-1">
          {spans.map((span, index) => (
            <span key={span.status} className="whitespace-nowrap">
              {index > 0 && <span className="text-muted/60">→ </span>}
              <span className="text-secondary">{labelFor(span.status)}</span> {formatDuration(span.ms)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
