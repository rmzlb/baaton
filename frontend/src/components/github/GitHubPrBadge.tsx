import { GitPullRequest, GitMerge, CircleDot, GitPullRequestClosed } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GitHubPrLink } from '@/lib/types';

interface GitHubPrBadgeProps {
  prs: GitHubPrLink[];
}

const stateConfig = {
  open: { icon: GitPullRequest, color: 'text-green-500', bg: 'bg-green-500/10' },
  draft: { icon: CircleDot, color: 'text-gray-400', bg: 'bg-gray-500/10' },
  merged: { icon: GitMerge, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  closed: { icon: GitPullRequestClosed, color: 'text-red-500', bg: 'bg-red-500/10' },
} as const;

export function GitHubPrBadge({ prs }: GitHubPrBadgeProps) {
  if (prs.length === 0) return null;

  // Show the most relevant PR: merged > open > draft > closed
  const pr =
    prs.find((p) => p.pr_state === 'merged') ||
    prs.find((p) => p.pr_state === 'open') ||
    prs.find((p) => p.pr_state === 'draft') ||
    prs[0];

  const config = stateConfig[pr.pr_state] || stateConfig.open;
  const Icon = config.icon;

  return (
    <a
      href={pr.pr_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono',
        'hover:opacity-80 transition-opacity',
        config.bg,
        config.color,
      )}
      title={`PR #${pr.pr_number}: ${pr.pr_title}`}
    >
      <Icon size={12} />
      <span>#{pr.pr_number}</span>
      {prs.length > 1 && (
        <span className="text-secondary">+{prs.length - 1}</span>
      )}
    </a>
  );
}
