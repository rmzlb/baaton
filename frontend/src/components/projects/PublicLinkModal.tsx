import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Copy, Link, KeyRound, RotateCw, X, ExternalLink, Shield, Globe, CheckCircle2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useNotificationStore } from '@/stores/notifications';
import { useTranslation } from '@/hooks/useTranslation';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

export function PublicLinkModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const apiClient = useApi();
  const { t } = useTranslation();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['project-public-submit', project.id],
    queryFn: () => apiClient.projects.getPublicSubmit(project.id),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { enabled?: boolean; rotate_token?: boolean }) =>
      apiClient.projects.updatePublicSubmit(project.id, payload),
    onSuccess: () => {
      refetch();
    },
  });

  const enabled = data?.enabled ?? false;
  const token = data?.token ?? '';
  const publicUrl = token ? `https://baaton.dev/submit/${data?.slug}?token=${token}` : '';

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      addNotification({ type: 'warning', title: 'Copy failed', message: 'Unable to copy to clipboard' });
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-bg shadow-2xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-primary">{t('projectAccess.title')}</h3>
            <p className="text-[11px] text-muted">{project.name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted hover:text-secondary">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted py-4">{t('projectAccess.loading')}</div>
        ) : (
          <div className="space-y-4">
            {/* ── Section 1: Public Link (issue submission only) ── */}
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-accent" />
                  <span className="text-xs font-semibold text-primary">{t('projectAccess.publicLink')}</span>
                </div>
                <button
                  onClick={() => updateMutation.mutate({ enabled: !enabled })}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', enabled ? 'bg-emerald-400' : 'bg-red-400')} />
                  {enabled ? t('projectAccess.enabled') : t('projectAccess.disabled')}
                </button>
              </div>

              <p className="text-[10px] text-muted leading-relaxed">
                {t('projectAccess.publicLinkDesc')}
              </p>

              {enabled && (
                <>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
                    <Link size={13} className="text-muted shrink-0" />
                    <input
                      readOnly
                      value={publicUrl}
                      className="flex-1 bg-transparent text-[11px] text-secondary outline-none min-w-0"
                    />
                    <button
                      onClick={() => handleCopy(publicUrl, 'url')}
                      className="text-xs text-accent hover:text-accent-hover shrink-0"
                    >
                      {copiedField === 'url' ? <CheckCircle2 size={13} className="text-green-400" /> : <Copy size={13} />}
                    </button>
                  </div>

                  {/* Rotate token */}
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted">
                      {t('projectAccess.publicEndpoint')}: <code className="text-secondary">/api/v1/public/{data?.slug}/submit</code>
                    </p>
                    <button
                      onClick={() => updateMutation.mutate({ rotate_token: true })}
                      disabled={updateMutation.isPending}
                      className="flex items-center gap-1 text-[10px] text-muted hover:text-secondary transition-colors disabled:opacity-50"
                      title={t('projectAccess.rotateToken')}
                    >
                      <RotateCw size={11} />
                      {t('projectAccess.rotateToken')}
                    </button>
                  </div>
                </>
              )}

              {!enabled && (
                <p className="text-[10px] text-muted italic">
                  {t('projectAccess.publicLinkDisabledHint')}
                </p>
              )}
            </div>

            {/* ── Section 2: API Access (team / agents — org-level keys) ── */}
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-accent" />
                <span className="text-xs font-semibold text-primary">{t('projectAccess.apiAccess')}</span>
              </div>

              <p className="text-[10px] text-muted leading-relaxed">
                {t('projectAccess.apiAccessDesc')}
              </p>

              <div className="rounded-md border border-border bg-bg p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Shield size={11} className="text-amber-400" />
                  <span className="text-[10px] font-medium text-secondary">{t('projectAccess.apiAccessWarning')}</span>
                </div>
                <p className="text-[10px] text-muted leading-relaxed">
                  {t('projectAccess.apiAccessWarningDesc')}
                </p>
              </div>

              <div className="space-y-1.5 text-[10px] text-muted font-mono">
                <p className="text-secondary">curl -H &quot;Authorization: Bearer baa_...&quot; \</p>
                <p className="text-secondary pl-4">https://api.baaton.dev/api/v1/projects</p>
              </div>

              <a
                href="/settings"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:text-accent-hover transition-colors"
              >
                <ExternalLink size={12} />
                {t('projectAccess.manageApiKeys')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
