/**
 * IssueActivitySummary — compact contributor + timing block for IssueDrawer.
 * Derived client-side from the existing activity feed data (no extra endpoint).
 * Only renders when there's meaningful data (>1 activity entry).
 */
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceStrict } from 'date-fns';
import type { ActivityEntry } from '@/lib/types';

interface IssueActivitySummaryProps {
  issueId: string;
  createdAt: string;
  closedAt: string | null;
}

interface ContributorStat {
  user_id: string;
  user_name: string | null;
  actions: number;
}

function deriveStats(entries: ActivityEntry[], createdAt: string) {
  // Contributor map
  const byUser = new Map<string, ContributorStat>();
  for (const e of entries) {
    if (e.user_id.startsWith('apikey:')) continue;
    const existing = byUser.get(e.user_id);
    if (existing) {
      existing.actions++;
    } else {
      byUser.set(e.user_id, {
        user_id: e.user_id,
        user_name: e.user_name,
        actions: 1,
      });
    }
  }

  const contributors = [...byUser.values()].sort((a, b) => b.actions - a.actions);

  // First response: first entry that is NOT the creator and is a comment or status change
  const firstResponse = entries
    .slice()
    .reverse()
    .find(
      (e) =>
        e.created_at > createdAt &&
        (e.action === 'comment_added' || e.action === 'commented' || e.action === 'status_changed'),
    );

  return { contributors, firstResponse };
}

export function IssueActivitySummary({
  issueId,
  createdAt,
  closedAt,
}: IssueActivitySummaryProps) {
  const { t } = useTranslation();
  const apiClient = useApi();

  const { data: entries = [] } = useQuery({
    queryKey: ['activity', issueId],
    queryFn: () => apiClient.activity.listByIssue(issueId),
    staleTime: 30_000,
  });

  // Only show when there's meaningful activity (>1 entry)
  if (entries.length <= 1) return null;

  const { contributors, firstResponse } = deriveStats(entries, createdAt);

  const createdDate  = new Date(createdAt);
  const closedDate   = closedAt ? new Date(closedAt) : null;
  const responseDate = firstResponse ? new Date(firstResponse.created_at) : null;

  const timeToResponse = responseDate
    ? formatDistanceStrict(responseDate, createdDate)
    : null;
  const timeToClose = closedDate
    ? formatDistanceStrict(closedDate, createdDate)
    : null;

  if (contributors.length === 0 && !timeToResponse && !timeToClose) return null;

  return (
    <div className="mb-3 rounded-lg border border-border/60 bg-surface-hover/50 p-2.5 space-y-2">
      {/* Contributors */}
      {contributors.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            <Users size={9} className="text-muted" />
            <span className="text-[9px] text-muted uppercase tracking-wider font-medium">
              {t('issueDrawer.contributors')}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {contributors.slice(0, 5).map((c) => (
              <div
                key={c.user_id}
                title={`${c.user_name ?? c.user_id} — ${c.actions} ${t('gamification.actions')}`}
                className={cn(
                  'relative flex items-center justify-center',
                  'w-6 h-6 rounded-full bg-surface border border-border',
                  'text-[9px] font-bold text-primary uppercase cursor-default',
                )}
              >
                {(c.user_name ?? c.user_id).slice(0, 2)}
                {/* action count badge */}
                {c.actions > 1 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 text-[7px] font-bold text-black leading-none">
                    {c.actions > 9 ? '9+' : c.actions}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timing */}
      {(timeToResponse || timeToClose) && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 mb-1">
            <Clock size={9} className="text-muted" />
            <span className="text-[9px] text-muted uppercase tracking-wider font-medium">
              {t('issueDrawer.timeline')}
            </span>
          </div>
          {timeToResponse && (
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-blue-400 shrink-0" />
              <span className="text-[10px] text-muted">
                {t('issueDrawer.firstResponse')}
                <span className="text-secondary ml-1">{timeToResponse}</span>
              </span>
            </div>
          )}
          {timeToClose && (
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-green-400 shrink-0" />
              <span className="text-[10px] text-muted">
                {t('issueDrawer.timeToClose')}
                <span className="text-secondary ml-1">{timeToClose}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
