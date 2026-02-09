import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, ChevronUp, Trash2, ArrowLeftRight,
  ArrowRight, ArrowLeft, Pause, Play, Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { GitHubStatusMappingEditor } from './GitHubStatusMappingEditor';
import type { GitHubRepoMapping, GitHubSyncDirection } from '@/lib/types';

interface GitHubRepoMappingCardProps {
  mapping: GitHubRepoMapping;
}

const SYNC_ICONS: Record<GitHubSyncDirection, typeof ArrowLeftRight> = {
  bidirectional: ArrowLeftRight,
  github_to_baaton: ArrowLeft,
  baaton_to_github: ArrowRight,
};

const SYNC_LABELS: Record<GitHubSyncDirection, string> = {
  bidirectional: 'github.syncBidirectional',
  github_to_baaton: 'github.syncGitHubToBaaton',
  baaton_to_github: 'github.syncBaatonToGitHub',
};

export function GitHubRepoMappingCard({ mapping }: GitHubRepoMappingCardProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showStatusMapping, setShowStatusMapping] = useState(false);

  // Get project statuses for the status mapping editor
  const { data: project } = useQuery({
    queryKey: ['project', mapping.project_id],
    queryFn: () => apiClient.projects.get(mapping.project_id),
    enabled: expanded,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Partial<GitHubRepoMapping>) =>
      apiClient.github.updateMapping(mapping.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-mappings'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.github.deleteMapping(mapping.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-mappings'] });
    },
  });

  const SyncIcon = SYNC_ICONS[mapping.sync_direction];

  const handleToggleActive = () => {
    updateMutation.mutate({ is_active: !mapping.is_active });
  };

  const handleSyncDirectionChange = (dir: GitHubSyncDirection) => {
    updateMutation.mutate({ sync_direction: dir });
  };

  const handleToggle = (field: 'sync_issues' | 'sync_prs' | 'sync_comments' | 'auto_create_issues') => {
    updateMutation.mutate({ [field]: !mapping[field] });
  };

  const handleStatusMappingChange = (statusMapping: Record<string, string | null>) => {
    updateMutation.mutate({ status_mapping: statusMapping });
  };

  const handleDelete = () => {
    if (confirm(t('github.deleteMappingConfirm'))) {
      deleteMutation.mutate();
    }
  };

  const repoName = mapping.repo?.full_name || `repo:${mapping.github_repo_id}`;
  const projectName = mapping.project?.name || mapping.project_id;

  return (
    <div
      className={cn(
        'rounded-lg border bg-bg transition-colors',
        mapping.is_active ? 'border-border' : 'border-border/50 opacity-60',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={handleToggleActive}
          className={cn(
            'p-1 rounded-md transition-colors',
            mapping.is_active
              ? 'text-green-500 hover:bg-green-500/10'
              : 'text-muted hover:bg-surface-hover',
          )}
          title={mapping.is_active ? t('github.pauseSync') : t('github.resumeSync')}
        >
          {mapping.is_active ? <Play size={14} /> : <Pause size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-primary truncate">{repoName}</p>
          <p className="text-[10px] text-muted truncate">
            → {projectName}
          </p>
        </div>

        <span className="flex items-center gap-1 text-[10px] text-secondary">
          <SyncIcon size={12} />
          {t(SYNC_LABELS[mapping.sync_direction])}
        </span>

        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded-md text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded Config */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-4">
          {/* Sync Direction */}
          <div>
            <label className="text-xs text-muted mb-1.5 block">{t('github.syncDirection')}</label>
            <div className="flex gap-2">
              {(Object.keys(SYNC_ICONS) as GitHubSyncDirection[]).map((dir) => {
                const Icon = SYNC_ICONS[dir];
                return (
                  <button
                    key={dir}
                    onClick={() => handleSyncDirectionChange(dir)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors',
                      mapping.sync_direction === dir
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-secondary hover:border-accent/50',
                    )}
                  >
                    <Icon size={12} />
                    {t(SYNC_LABELS[dir])}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-2">
            <ToggleSwitch
              label={t('github.syncIssues')}
              checked={mapping.sync_issues}
              onChange={() => handleToggle('sync_issues')}
            />
            <ToggleSwitch
              label={t('github.syncPRs')}
              checked={mapping.sync_prs}
              onChange={() => handleToggle('sync_prs')}
            />
            <ToggleSwitch
              label={t('github.syncComments')}
              checked={mapping.sync_comments}
              onChange={() => handleToggle('sync_comments')}
            />
            <ToggleSwitch
              label={t('github.autoCreateIssues')}
              checked={mapping.auto_create_issues}
              onChange={() => handleToggle('auto_create_issues')}
            />
          </div>

          {/* Status Mapping */}
          <div>
            <button
              onClick={() => setShowStatusMapping(!showStatusMapping)}
              className="flex items-center gap-1.5 text-xs text-secondary hover:text-accent transition-colors"
            >
              <Settings2 size={12} />
              {t('github.statusMapping')}
              {showStatusMapping ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showStatusMapping && project && (
              <div className="mt-3 rounded-lg border border-border bg-surface p-4">
                <GitHubStatusMappingEditor
                  statusMapping={mapping.status_mapping}
                  projectStatuses={project.statuses}
                  onChange={handleStatusMappingChange}
                />
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="flex justify-end pt-2 border-t border-border">
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} />
              {t('github.deleteMapping')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="flex items-center gap-2 text-xs text-primary"
    >
      <div
        className={cn(
          'w-7 h-4 rounded-full transition-colors relative',
          checked ? 'bg-accent' : 'bg-border',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </div>
      {label}
    </button>
  );
}
