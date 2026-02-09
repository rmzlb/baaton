import { useState } from 'react';
import { GitBranch, Copy, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface GitHubBranchCopyProps {
  branchName: string;
}

export function GitHubBranchCopy({ branchName }: GitHubBranchCopyProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`git checkout -b ${branchName}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-hover">
      <GitBranch size={14} className="text-secondary shrink-0" />
      <code className="text-xs text-primary font-mono truncate flex-1">
        {branchName}
      </code>
      <button
        onClick={handleCopy}
        className={cn(
          'p-1 rounded-md transition-colors shrink-0',
          copied
            ? 'text-green-500'
            : 'text-secondary hover:text-primary hover:bg-surface',
        )}
        title={copied ? t('github.copied') : t('github.copyBranch')}
      >
        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
