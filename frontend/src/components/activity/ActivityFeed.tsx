import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  PlusCircle,
  MessageSquare,
  ArrowRightLeft,
  UserPlus,
  Tag,
  Pencil,
  Activity,
  Clock,
  GitCommit,
  GitPullRequest,
  ExternalLink,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { ActivityEntry } from '@/lib/types';

/* ── Action config ─────────────────────────────── */

const ACTION_CONFIG: Record<string, {
  icon: typeof PlusCircle;
  color: string;
  labelKey: string;
}> = {
  created:          { icon: PlusCircle,      color: 'text-green-400',  labelKey: 'activity.created' },
  issue_created:    { icon: PlusCircle,      color: 'text-green-400',  labelKey: 'activity.created' },
  updated:          { icon: Pencil,          color: 'text-blue-400',   labelKey: 'activity.updated' },
  commented:        { icon: MessageSquare,   color: 'text-purple-400', labelKey: 'activity.commented' },
  comment_added:    { icon: MessageSquare,   color: 'text-purple-400', labelKey: 'activity.commented' },
  status_changed:   { icon: ArrowRightLeft,  color: 'text-amber-400',  labelKey: 'activity.statusChanged' },
  priority_changed: { icon: ArrowRightLeft,  color: 'text-orange-400', labelKey: 'activity.updated' },
  assigned:         { icon: UserPlus,        color: 'text-cyan-400',   labelKey: 'activity.assigned' },
  assignee_changed: { icon: UserPlus,        color: 'text-cyan-400',   labelKey: 'activity.assigned' },
  tagged:           { icon: Tag,             color: 'text-pink-400',   labelKey: 'activity.tagged' },
  tag_added:        { icon: Tag,             color: 'text-pink-400',   labelKey: 'activity.tagged' },
  github_push:      { icon: GitCommit,       color: 'text-gray-400',   labelKey: 'activity.githubPush' },
  github_pr_opened: { icon: GitPullRequest,  color: 'text-violet-400', labelKey: 'activity.githubPrOpened' },
  github_pr_merged: { icon: GitPullRequest,  color: 'text-green-400',  labelKey: 'activity.githubPrMerged' },
};

/* ── Props ─────────────────────────────────────── */

interface ActivityFeedProps {
  /** If provided, show activity for a specific issue */
  issueId?: string;
  /** Maximum entries to show */
  limit?: number;
  /** Compact mode for sidebar/cards */
  compact?: boolean;
}

/* ── Component ─────────────────────────────────── */

export function ActivityFeed({ issueId, limit = 20, compact = false }: ActivityFeedProps) {
  const { t } = useTranslation();
  const apiClient = useApi();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: issueId ? ['activity', issueId] : ['activity'],
    queryFn: () =>
      issueId
        ? apiClient.activity.listByIssue(issueId)
        : apiClient.activity.listRecent(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const displayEntries = entries.slice(0, limit);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted">
        <div className="h-3 w-3 rounded-full border-2 border-muted border-t-transparent animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (displayEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Activity size={20} className="text-muted mb-1.5" />
        <p className="text-xs text-muted">{t('activity.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {displayEntries.map((entry, idx) => (
        <ActivityItem
          key={entry.id}
          entry={entry}
          isLast={idx === displayEntries.length - 1}
          compact={compact}
          t={t}
        />
      ))}
    </div>
  );
}

/* ── Single Activity Item ──────────────────────── */

function ActivityItem({
  entry,
  isLast,
  compact,
  t,
}: {
  entry: ActivityEntry;
  isLast: boolean;
  compact: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const navigate = useNavigate();

  const config = ACTION_CONFIG[entry.action] || {
    icon: Activity,
    color: 'text-muted',
    labelKey: 'activity.updated',
  };
  const Icon = config.icon;
  const actionLabel = t(config.labelKey);

  const displayName = entry.user_name
    ? entry.user_name.replace(/^@/, '')
    : entry.user_id.startsWith('github:')
      ? entry.user_id.slice(7)
      : entry.user_id.slice(0, 12);

  const isGitHub = entry.user_id.startsWith('github:');

  // Navigate to the issue via /all-issues?issue=BAA-42
  const handleClick = () => {
    if (!entry.issue_display_id) return;
    navigate(`/all-issues?issue=${entry.issue_display_id}`);
  };

  const isClickable = !!entry.issue_display_id;

  return (
    <div className="flex gap-2.5 group">
      {/* Timeline line + icon */}
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface',
          config.color,
        )}>
          <Icon size={compact ? 10 : 12} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-border min-h-[16px]" />
        )}
      </div>

      {/* Content */}
      <div className={cn('flex-1 min-w-0', compact ? 'pb-2' : 'pb-3')}>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {/* Author */}
          <span className={cn(
            'text-[11px] font-medium text-primary truncate max-w-[120px]',
            isGitHub && 'text-gray-400',
          )}>
            {displayName}
          </span>
          <span className="text-[11px] text-secondary">{actionLabel}</span>
          {entry.field && entry.action !== 'commented' && entry.action !== 'comment_added' && (
            <span className="text-[10px] text-muted font-mono">{entry.field}</span>
          )}
        </div>

        {/* Issue link — the main value-add */}
        {entry.issue_display_id && (
          <button
            onClick={handleClick}
            className={cn(
              'mt-0.5 flex items-center gap-1 group/link',
              isClickable && 'cursor-pointer',
            )}
            title={entry.issue_title ?? entry.issue_display_id}
          >
            <span className="text-[10px] font-mono text-amber-500/80 group-hover/link:text-amber-400 transition-colors">
              {entry.issue_display_id}
            </span>
            {entry.issue_title && (
              <span className="text-[10px] text-muted truncate max-w-[160px] group-hover/link:text-secondary transition-colors">
                {entry.issue_title}
              </span>
            )}
            <ExternalLink size={8} className="text-muted/50 group-hover/link:text-muted shrink-0" />
          </button>
        )}

        {/* Field change detail */}
        {entry.new_value && entry.action !== 'created' && entry.action !== 'issue_created' &&
         entry.action !== 'commented' && entry.action !== 'comment_added' &&
         !entry.action.startsWith('github_') && (
          <div className="mt-0.5 text-[10px] text-muted truncate">
            {entry.old_value ? (
              <>
                <span className="line-through">{entry.old_value}</span>
                <span className="mx-1">→</span>
                <span className="text-secondary">{entry.new_value}</span>
              </>
            ) : (
              <span className="text-secondary">{entry.new_value}</span>
            )}
          </div>
        )}

        {/* GitHub metadata preview */}
        {entry.action === 'github_push' && typeof entry.metadata?.message === 'string' && (
          <div className="mt-0.5 text-[10px] text-muted font-mono truncate max-w-[200px]">
            {(entry.metadata.message as string).split('\n')[0]}
          </div>
        )}

        {/* Timestamp */}
        <div className="flex items-center gap-1 mt-0.5">
          <Clock size={9} className="text-muted" />
          <span className="text-[9px] text-muted">{timeAgo(entry.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
