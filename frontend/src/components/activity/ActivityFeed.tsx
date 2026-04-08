import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo, cn } from '@/lib/utils';
import type { ActivityEntry } from '@/lib/types';

/* ── Action → dot color mapping ────────────────── */

const DOT_COLORS: Record<string, string> = {
  created:          'bg-emerald-500',
  issue_created:    'bg-emerald-500',
  issue_closed:     'bg-emerald-500',
  issue_archived:   'bg-emerald-500',
  commented:        'bg-orange-400',
  comment_added:    'bg-orange-400',
  status_changed:   'bg-blue-500',
  priority_changed: 'bg-blue-500',
  updated:          'bg-blue-500',
  assigned:         'bg-cyan-500',
  assignee_changed: 'bg-cyan-500',
  tagged:           'bg-pink-500',
  tag_added:        'bg-pink-500',
  github_push:      'bg-gray-400',
  github_pr_opened: 'bg-violet-500',
  github_pr_merged: 'bg-emerald-500',
};

/* ── Action label ──────────────────────────────── */

function actionVerb(action: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    created: 'created', issue_created: 'created',
    issue_closed: 'closed', issue_archived: 'archived',
    commented: 'commented on', comment_added: 'commented on',
    status_changed: 'updated status of', priority_changed: 'updated priority of',
    updated: 'updated', assigned: 'assigned', assignee_changed: 'reassigned',
    tagged: 'tagged', tag_added: 'tagged',
    github_push: 'pushed to', github_pr_opened: 'opened PR for',
    github_pr_merged: 'merged PR for',
  };
  return map[action] || t('activity.updated') || 'updated';
}

/* ── Props ─────────────────────────────────────── */

interface ActivityFeedProps {
  issueId?: string;
  limit?: number;
  compact?: boolean;
  entries?: ActivityEntry[] | null;
  onIssueClick?: (displayId: string, orgId: string | null) => void;
}

/* ── Component ─────────────────────────────────── */

export function ActivityFeed({ issueId, limit = 20, entries: providedEntries, onIssueClick }: ActivityFeedProps) {
  const { t } = useTranslation();
  const apiClient = useApi();

  const { data: queriedEntries = [], isLoading: queryLoading } = useQuery({
    queryKey: issueId ? ['activity', issueId] : ['activity'],
    queryFn: () => issueId ? apiClient.activity.listByIssue(issueId) : apiClient.activity.listRecent(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: providedEntries === undefined,
  });

  const isLoading = providedEntries === null ? true : queryLoading;
  const entries = providedEntries ?? queriedEntries;
  const items = entries.slice(0, limit);
  const handleItemIssueClick = onIssueClick;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted">
        <div className="h-3 w-3 rounded-full border-2 border-muted border-t-transparent animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Activity size={20} className="text-muted mb-1.5" />
        <p className="text-xs text-muted">{t('activity.empty')}</p>
      </div>
    );
  }

  return (
    <div className="relative pl-3">
      {/* Continuous vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

      <div className="space-y-5">
        {items.map((entry) => (
          <TimelineItem key={entry.id} entry={entry} t={t} onIssueClick={handleItemIssueClick} />
        ))}
      </div>
    </div>
  );
}

/* ── Timeline Item ─────────────────────────────── */

function TimelineItem({ entry, t, onIssueClick }: { entry: ActivityEntry; t: (k: string) => string; onIssueClick?: (displayId: string, orgId: string | null) => void }) {
  const navigate = useNavigate();
  const dotColor = DOT_COLORS[entry.action] || 'bg-gray-400';
  const verb = actionVerb(entry.action, t);

  const displayName = entry.user_name
    ? entry.user_name.replace(/^@/, '')
    : entry.user_id.startsWith('github:')
      ? entry.user_id.slice(7)
      : entry.user_id.startsWith('apikey:')
        ? 'agent'
        : entry.user_id.slice(0, 12);

  const handleIssueClick = () => {
    if (!entry.issue_display_id) return;
    if (onIssueClick) {
      onIssueClick(entry.issue_display_id, entry.org_id ?? null);
    } else {
      navigate(`/all-issues?issue=${entry.issue_display_id}`);
    }
  };

  return (
    <div className="relative flex gap-3.5 group">
      {/* Dot with ring */}
      <div className={cn(
        'w-2.5 h-2.5 rounded-full ring-4 ring-surface mt-1.5 shrink-0 relative z-10',
        dotColor,
      )} />

      {/* Content */}
      <div className="flex-1 min-w-0 pb-0.5">
        <p className="text-sm text-primary leading-snug">
          <span className="font-medium">{displayName}</span>
          {' '}{verb}{' '}
          {entry.issue_display_id && (
            <button
              onClick={handleIssueClick}
              className="text-muted font-medium hover:text-accent transition-colors"
            >
              {entry.issue_display_id}
            </button>
          )}
        </p>

        {/* Metadata snippet (status change, commit message) */}
        {entry.new_value && entry.action !== 'created' && entry.action !== 'issue_created' &&
         entry.action !== 'commented' && entry.action !== 'comment_added' && (
          <div className="mt-1.5 px-2.5 py-1.5 bg-surface-hover border border-border rounded text-xs text-secondary line-clamp-1">
            {entry.old_value ? (
              <><span className="text-muted line-through">{entry.old_value}</span> → <span>{entry.new_value}</span></>
            ) : entry.new_value}
          </div>
        )}

        {entry.action === 'github_push' && typeof entry.metadata?.message === 'string' && (
          <div className="mt-1.5 px-2.5 py-1.5 bg-surface-hover border border-border rounded text-xs text-secondary font-mono line-clamp-1">
            {(entry.metadata.message as string).split('\n')[0]}
          </div>
        )}

        <p className="text-xs text-muted mt-1">{timeAgo(entry.created_at)}</p>
      </div>
    </div>
  );
}
