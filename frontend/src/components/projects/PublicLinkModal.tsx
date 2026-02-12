import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Copy, Link, RotateCw, X } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useNotificationStore } from '@/stores/notifications';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

export function PublicLinkModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const apiClient = useApi();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [copied, setCopied] = useState(false);

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

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      addNotification({ type: 'warning', title: 'Copy failed', message: 'Unable to copy to clipboard' });
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-bg shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-primary">Public Issue Intake</h3>
            <p className="text-[11px] text-muted">Project: {project.name}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted hover:text-secondary">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', enabled ? 'bg-emerald-400' : 'bg-red-400')} />
                <span className="text-xs text-secondary">{enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <button
                onClick={() => updateMutation.mutate({ enabled: !enabled })}
                className="rounded-md border border-border px-2 py-1 text-[10px] text-secondary hover:bg-surface-hover"
              >
                {enabled ? 'Disable' : 'Enable'}
              </button>
            </div>

            {enabled && (
              <>
                <div className="space-y-2">
                  <div className="text-[10px] text-muted">Public link (share)</div>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                    <Link size={14} className="text-muted" />
                    <input
                      readOnly
                      value={publicUrl}
                      className="flex-1 bg-transparent text-[11px] text-secondary outline-none"
                    />
                    <button
                      onClick={() => handleCopy(publicUrl)}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      {copied ? 'Copied' : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] text-muted">Project API key (integrations)</div>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                    <input
                      readOnly
                      value={token}
                      className="flex-1 bg-transparent text-[11px] text-secondary outline-none"
                    />
                    <button
                      onClick={() => handleCopy(token)}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      {copied ? 'Copied' : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => updateMutation.mutate({ rotate_token: true })}
                      className="text-xs text-muted hover:text-secondary"
                      title="Rotate key"
                    >
                      <RotateCw size={14} />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted">Endpoint: https://api.baaton.dev/api/v1/public/{data?.slug}/submit</p>
                </div>
              </>
            )}

            {!enabled && (
              <p className="text-[11px] text-muted">Enable to generate a public link and API key.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
