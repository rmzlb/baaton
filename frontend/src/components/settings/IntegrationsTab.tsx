import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Github, Plus, AlertTriangle, Loader2, Unplug } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { GitHubConnectionStatus } from '@/components/github/GitHubConnectionStatus';
import { GitHubInstallButton } from '@/components/github/GitHubInstallButton';
import { GitHubRepoMappingCard } from '@/components/github/GitHubRepoMappingCard';
import { GitHubRepoSelector } from '@/components/github/GitHubRepoSelector';
import { OpenClawSettings } from '@/components/integrations/OpenClawSettings';
import type { GitHubRepository } from '@/lib/types';

export function IntegrationsTab() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showAddMapping, setShowAddMapping] = useState(false);

  const { data: installation, isLoading: installLoading, error: installError } = useQuery({
    queryKey: ['github-installation'],
    queryFn: () => apiClient.github.getInstallation(),
    retry: false,
  });

  const { data: mappings = [], isLoading: mappingsLoading } = useQuery({
    queryKey: ['github-mappings'],
    queryFn: () => apiClient.github.listMappings(),
    enabled: !!installation && installation.status === 'active',
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiClient.github.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-installation'] });
      queryClient.invalidateQueries({ queryKey: ['github-mappings'] });
    },
  });

  const handleDisconnect = () => {
    if (confirm(t('github.disconnectConfirm'))) {
      disconnectMutation.mutate();
    }
  };

  // If GitHub integration endpoints aren't available yet, show a coming-soon state
  if (installError) {
    return (
      <div className="space-y-6">
        <SectionHeader />
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-3 mb-4">
            <Github size={24} className="text-primary" />
            <div>
              <h3 className="font-semibold text-primary">GitHub</h3>
              <p className="text-xs text-secondary">
                {t('github.description')}
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-bg p-4 text-center">
            <p className="text-sm text-muted">{t('github.comingSoon')}</p>
          </div>
        </div>
      </div>
    );
  }

  const isConnected = installation && installation.status === 'active';
  const existingRepoIds = mappings.map((m) => m.github_repo_id);

  return (
    <div className="space-y-6">
      <SectionHeader />

      {/* OpenClaw Card */}
      <OpenClawSettings />

      {/* GitHub Card */}
      <div className="rounded-xl border border-border bg-surface p-6">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-4">
          <Github size={24} className="text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold text-primary">GitHub</h3>
            <p className="text-xs text-secondary">
              {t('github.description')}
            </p>
          </div>
          <div className="ml-auto">
            {installLoading ? (
              <Loader2 size={16} className="animate-spin text-muted" />
            ) : isConnected ? (
              <GitHubConnectionStatus installation={installation} />
            ) : (
              <GitHubInstallButton />
            )}
          </div>
        </div>

        {/* Connected state: show mappings */}
        {isConnected && (
          <>
            {/* Repo Mappings */}
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-primary">
                  {t('github.repoMappings')}
                </h4>
                <button
                  onClick={() => setShowAddMapping(!showAddMapping)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-secondary hover:border-accent hover:text-accent transition-colors"
                >
                  <Plus size={12} />
                  {t('github.addMapping')}
                </button>
              </div>

              {/* Add Mapping Form */}
              {showAddMapping && (
                <AddMappingForm
                  excludeRepoIds={existingRepoIds}
                  onClose={() => setShowAddMapping(false)}
                />
              )}

              {/* Mapping List */}
              {mappingsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={16} className="animate-spin text-muted" />
                </div>
              ) : mappings.length === 0 ? (
                <div className="text-center py-6 rounded-lg border border-dashed border-border">
                  <p className="text-sm text-muted">{t('github.noMappings')}</p>
                  <p className="text-xs text-muted mt-1">{t('github.noMappingsHint')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mappings.map((mapping) => (
                    <GitHubRepoMappingCard key={mapping.id} mapping={mapping} />
                  ))}
                </div>
              )}
            </div>

            {/* Disconnect */}
            <div className="border-t border-border pt-4 mt-4">
              <button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                <Unplug size={12} />
                {disconnectMutation.isPending ? t('github.disconnecting') : t('github.disconnect')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader() {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-lg font-semibold text-primary">{t('github.integrationsTitle')}</h2>
      <p className="text-sm text-secondary mt-1">
        {t('github.integrationsDesc')}
      </p>
    </div>
  );
}

function AddMappingForm({
  excludeRepoIds,
  onClose,
}: {
  excludeRepoIds: number[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.github.createMapping({
        project_id: selectedProjectId,
        github_repo_id: selectedRepo!.github_repo_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-mappings'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !selectedProjectId) return;
    createMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-accent/30 bg-accent/5 p-4 mb-3 space-y-3">
      <div>
        <label className="text-xs text-muted mb-1 block">{t('github.repository')}</label>
        <GitHubRepoSelector
          selectedRepoId={selectedRepo?.github_repo_id ?? null}
          onSelect={setSelectedRepo}
          excludeRepoIds={excludeRepoIds}
        />
      </div>

      <div>
        <label className="text-xs text-muted mb-1 block">{t('github.project')}</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary outline-none focus:border-accent transition-colors"
        >
          <option value="">{t('github.selectProject')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {createMutation.isError && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle size={12} />
          {t('github.createMappingError')}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-primary transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={!selectedRepo || !selectedProjectId || createMutation.isPending}
          className="px-4 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {createMutation.isPending ? t('common.loading') : t('github.createMapping')}
        </button>
      </div>
    </form>
  );
}
