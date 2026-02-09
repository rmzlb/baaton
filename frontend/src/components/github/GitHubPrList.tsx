import {
  GitPullRequest, GitMerge, CircleDot, GitPullRequestClosed,
  CheckCircle2, XCircle, MessageSquare, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import type { GitHubPrLink, GitHubPrState, GitHubReviewStatus } from '@/lib/types';

interface GitHubPrListProps {
  prs: GitHubPrLink[];
}

const stateConfig: Record<GitHubPrState, { icon: typeof GitPullRequest; color: string; label: string }> = {
  open: { icon: GitPullRequest, color: 'text-green-500', label: 'Open' },
  draft: { icon: CircleDot, color: 'text-gray-400', label: 'Draft' },
  merged: { icon: GitMerge, color: 'text-purple-500', label: 'Merged' },
  closed: { icon: GitPullRequestClosed, color: 'text-red-500', label: 'Closed' },
};

const reviewConfig: Partial<Record<GitHubReviewStatus, { icon: typeof CheckCircle2; color: string }>> = {
  approved: { icon: CheckCircle2, color: 'text-green-500' },
  changes_requested: { icon: XCircle, color: 'text-red-400' },
  commented: { icon: MessageSquare, color: 'text-yellow-400' },
};

export function GitHubPrList({ prs }: GitHubPrListProps) {
  const { t } = useTranslation();

  if (prs.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted uppercase tracking-wider font-medium">
        {t('github.pullRequests')}
      </p>
      {prs.map((pr) => {
        const state = stateConfig[pr.pr_state] || stateConfig.open;
        const StateIcon = state.icon;
        const review = pr.review_status ? reviewConfig[pr.review_status] : null;

        return (
          <a
            key={pr.id}
            href={pr.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-hover transition-colors group"
          >
            <StateIcon size={16} className={cn(state.color, 'shrink-0')} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-primary truncate group-hover:text-accent transition-colors">
                {pr.pr_title}
              </p>
              <p className="text-[10px] text-muted">
                #{pr.pr_number} · {pr.author_login}
                {(pr.additions != null || pr.deletions != null) && (
                  <>
                    {' · '}
                    <span className="text-green-500">+{pr.additions ?? 0}</span>
                    {' '}
                    <span className="text-red-400">-{pr.deletions ?? 0}</span>
                  </>
                )}
                {pr.merged_at && ` · ${t('github.mergedTime', { time: timeAgo(pr.merged_at) })}`}
              </p>
            </div>
            {review && (
              <review.icon size={14} className={cn(review.color, 'shrink-0')} />
            )}
            <ExternalLink size={12} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </a>
        );
      })}
    </div>
  );
}
