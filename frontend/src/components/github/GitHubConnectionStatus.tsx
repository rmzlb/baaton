import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { GitHubInstallation } from '@/lib/types';

interface GitHubConnectionStatusProps {
  installation: GitHubInstallation | null;
  className?: string;
}

export function GitHubConnectionStatus({ installation, className }: GitHubConnectionStatusProps) {
  const { t } = useTranslation();

  if (!installation || installation.status === 'removed') {
    return (
      <span className={cn('flex items-center gap-1.5 text-xs text-muted', className)}>
        <span className="h-2 w-2 rounded-full bg-gray-400" />
        {t('github.disconnected')}
      </span>
    );
  }

  if (installation.status === 'suspended') {
    return (
      <span className={cn('flex items-center gap-1.5 text-xs text-yellow-400', className)}>
        <span className="h-2 w-2 rounded-full bg-yellow-400" />
        {t('github.suspended')}
      </span>
    );
  }

  return (
    <span className={cn('flex items-center gap-1.5 text-xs text-green-500', className)}>
      <span className="h-2 w-2 rounded-full bg-green-500" />
      {t('github.connectedTo', { account: installation.github_account_login })}
    </span>
  );
}
