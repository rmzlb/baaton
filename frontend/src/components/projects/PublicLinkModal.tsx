import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Link, KeyRound, RotateCw, X, Shield, Globe, CheckCircle2, Plus, Trash2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useOrganization } from '@clerk/clerk-react';
import { useApi } from '@/hooks/useApi';
import { useNotificationStore } from '@/stores/notifications';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import type { Project, ApiKey } from '@/lib/types';
import { cn } from '@/lib/utils';

export function PublicLinkModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { membership } = useOrganization();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const isAdmin = membership?.role === 'org:admin';

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

  // API Keys (org-level)
  const { data: apiKeys = [] } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.apiKeys.list(),
    enabled: isAdmin,
    retry: false,
  });

  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);

  const createKeyMutation = useMutation({
    mutationFn: (name: string) => apiClient.apiKeys.create({ name }),
    onSuccess: (data) => {
      setNewKeySecret(data.key);
      setNewKeyName('');
      setShowCreateKey(false);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const enabled = data?.enabled ?? false;
  const token = data?.token ?? '';
  const publicUrl = token ? `https://baaton.dev/s/${token}` : '';

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      addNotification({ type: 'warning', title: 'Copy failed', message: 'Unable to copy to clipboard' });
    }
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createKeyMutation.mutate(newKeyName.trim());
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-bg shadow-2xl p-5 max-h-[90vh] overflow-y-auto">
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

                  <div className="flex items-center justify-end">
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

            {/* ── Section 2: API Access (org-level keys — admin only) ── */}
            {isAdmin && (
              <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound size={15} className="text-accent" />
                    <span className="text-xs font-semibold text-primary">{t('projectAccess.apiAccess')}</span>
                  </div>
                </div>

                <p className="text-[10px] text-muted leading-relaxed">
                  {t('projectAccess.apiAccessDesc')}
                </p>

                {/* Warning */}
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Shield size={11} className="text-amber-400" />
                    <span className="text-[10px] font-medium text-amber-200">{t('projectAccess.apiAccessWarning')}</span>
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    {t('projectAccess.apiAccessWarningDesc')}
                  </p>
                </div>

                {/* New key secret banner */}
                {newKeySecret && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-amber-200">{t('settings.copyWarning')}</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <code className="flex-1 rounded-md bg-bg px-2 py-1 text-[10px] font-mono text-primary border border-border truncate min-w-0">
                            {newKeySecret}
                          </code>
                          <button
                            onClick={() => handleCopy(newKeySecret, 'newkey')}
                            className="shrink-0 text-secondary hover:text-primary"
                          >
                            {copiedField === 'newkey' ? <CheckCircle2 size={13} className="text-green-400" /> : <Copy size={13} />}
                          </button>
                        </div>
                        <button
                          onClick={() => setNewKeySecret(null)}
                          className="mt-1.5 text-[10px] text-amber-400 hover:underline"
                        >
                          {t('settings.dismiss')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Create form */}
                {showCreateKey ? (
                  <form onSubmit={handleCreateKey} className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] text-muted mb-1">{t('settings.keyName')}</label>
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder={t('settings.keyNamePlaceholder')}
                        className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-[11px] text-primary placeholder-secondary focus:border-accent focus:outline-none"
                        autoFocus
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!newKeyName.trim() || createKeyMutation.isPending}
                      className="rounded-md bg-accent px-3 py-1.5 text-[10px] font-medium text-black hover:bg-accent-hover disabled:opacity-40"
                    >
                      {createKeyMutation.isPending ? t('settings.creatingKey') : t('settings.createKey')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCreateKey(false); setNewKeyName(''); }}
                      className="rounded-md px-2 py-1.5 text-[10px] text-secondary hover:text-primary"
                    >
                      {t('common.cancel')}
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowCreateKey(true)}
                    className="flex items-center gap-1.5 w-full justify-center rounded-md border border-dashed border-border px-3 py-2 text-[10px] text-secondary hover:border-accent hover:text-accent transition-colors"
                  >
                    <Plus size={12} />
                    {t('settings.generateKey')}
                  </button>
                )}

                {/* Existing keys list */}
                {apiKeys.length > 0 && (
                  <div className="space-y-1.5">
                    {apiKeys.map((key) => (
                      <ApiKeyCompactRow
                        key={key.id}
                        apiKey={key}
                        onDelete={() => {
                          if (confirm(t('settings.revokeConfirm', { name: key.name }))) {
                            deleteKeyMutation.mutate(key.id);
                          }
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Usage hint */}
                <div className="rounded-md border border-border bg-bg p-2.5 space-y-1 text-[10px] font-mono text-muted">
                  <p className="text-secondary">curl -H &quot;Authorization: Bearer baa_...&quot; \</p>
                  <p className="text-secondary pl-4">https://api.baaton.dev/api/v1/issues</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ApiKeyCompactRow({ apiKey, onDelete }: { apiKey: ApiKey; onDelete: () => void }) {
  const { t } = useTranslation();
  const [showPrefix, setShowPrefix] = useState(false);

  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <KeyRound size={12} className="text-secondary shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-primary truncate">{apiKey.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <button
              onClick={() => setShowPrefix(!showPrefix)}
              className="text-[9px] font-mono text-muted hover:text-secondary flex items-center gap-0.5"
            >
              {showPrefix ? <><EyeOff size={8} />{apiKey.key_prefix}</> : <><Eye size={8} />••••••••</>}
            </button>
            <span className="text-[9px] text-muted">
              · {t('settings.created', { time: timeAgo(apiKey.created_at) })}
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="rounded p-1 text-muted hover:bg-red-500/10 hover:text-red-400 transition-all shrink-0"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
