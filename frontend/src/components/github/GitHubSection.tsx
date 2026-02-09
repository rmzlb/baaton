import { useQuery } from '@tanstack/react-query';
import { GitPullRequest, Loader2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { GitHubBranchCopy } from './GitHubBranchCopy';
import { GitHubPrList } from './GitHubPrList';
import { GitHubCommitTimeline } from './GitHubCommitTimeline';
import { GitHubSyncIndicator } from './GitHubSyncIndicator';

interface GitHubSectionProps {
  issueId: string;
}

export function GitHubSection({ issueId }: GitHubSectionProps) {
  const { t } = useTranslation();
  const apiClient = useApi();

  const { data, isLoading, error } = useQuery({
    queryKey: ['issue-github', issueId],
    queryFn: () => apiClient.github.getIssueData(issueId),
    staleTime: 30_000,
    retry: false,
  });

  // Don't render anything if the endpoint isn't available yet
  if (error) return null;

  if (isLoading) {
    return (
      <div className="border-t border-border pt-4 mt-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" />
          {t('github.loading')}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // If there's no data at all, show just the branch name for convenience
  const hasContent =
    data.pull_requests.length > 0 ||
    data.commits.length > 0 ||
    data.github_issue !== null;

  return (
    <div className="border-t border-border pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-secondary uppercase tracking-wider">
          <GitPullRequest size={12} />
          GitHub
        </h3>
        {data.github_issue && (
          <GitHubSyncIndicator syncStatus={data.github_issue.sync_status} />
        )}
      </div>

      <div className="space-y-3">
        {/* Branch name with copy button */}
        {data.branch_name && (
          <GitHubBranchCopy branchName={data.branch_name} />
        )}

        {/* Linked PRs */}
        <GitHubPrList prs={data.pull_requests} />

        {/* Linked Commits */}
        <GitHubCommitTimeline commits={data.commits} />

        {/* Empty state */}
        {!hasContent && data.branch_name && (
          <p className="text-xs text-muted">
            {t('github.noLinkedData')}
          </p>
        )}
      </div>
    </div>
  );
}
