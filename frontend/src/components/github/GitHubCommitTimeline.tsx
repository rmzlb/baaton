import { GitCommitHorizontal } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import type { GitHubCommitLink } from '@/lib/types';

interface GitHubCommitTimelineProps {
  commits: GitHubCommitLink[];
  maxVisible?: number;
}

export function GitHubCommitTimeline({ commits, maxVisible = 5 }: GitHubCommitTimelineProps) {
  const { t } = useTranslation();

  if (commits.length === 0) return null;

  const visible = commits.slice(0, maxVisible);
  const remaining = commits.length - maxVisible;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted uppercase tracking-wider font-medium">
        {t('github.recentCommits')}
      </p>
      {visible.map((commit) => {
        // First line of commit message
        const firstLine = commit.message.split('\n')[0];

        return (
          <a
            key={commit.sha}
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface-hover transition-colors group"
          >
            <GitCommitHorizontal size={12} className="text-secondary shrink-0" />
            <p className="text-xs text-primary truncate flex-1 group-hover:text-accent transition-colors">
              {firstLine}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {commit.author_login && (
                <span className="text-[10px] text-muted hidden sm:inline">
                  {commit.author_login}
                </span>
              )}
              <code className="text-[10px] text-secondary font-mono">
                {commit.sha.slice(0, 7)}
              </code>
              <span className="text-[10px] text-muted">
                {timeAgo(commit.committed_at)}
              </span>
            </div>
          </a>
        );
      })}
      {remaining > 0 && (
        <p className="text-[10px] text-muted pl-6">
          {t('github.moreCommits', { count: remaining })}
        </p>
      )}
    </div>
  );
}
