import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface GitHubSyncIndicatorProps {
  syncStatus: string;
  className?: string;
}

const statusConfig: Record<string, { color: string; label: string }> = {
  synced: { color: 'bg-green-500', label: 'github.syncStatusSynced' },
  pending_push: { color: 'bg-yellow-400', label: 'github.syncStatusPending' },
  pending_pull: { color: 'bg-yellow-400', label: 'github.syncStatusPending' },
  conflict: { color: 'bg-red-500', label: 'github.syncStatusConflict' },
  error: { color: 'bg-red-500', label: 'github.syncStatusError' },
};

export function GitHubSyncIndicator({ syncStatus, className }: GitHubSyncIndicatorProps) {
  const { t } = useTranslation();
  const config = statusConfig[syncStatus] || statusConfig.synced;

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={t(config.label)}
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', config.color)} />
      <span className="text-[10px] text-muted">{t(config.label)}</span>
    </span>
  );
}
