import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Copy, Eye, EyeOff, CheckCircle2, AlertTriangle, BookOpen, RefreshCw } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import type { ApiKey } from '@/lib/types';

export function ApiKeys() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.apiKeys.list(),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.apiKeys.create({ name }),
    onSuccess: (data) => {
      setNewKeySecret(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const regenerateMutation = useMutation({
    mutationFn: (id: string) => apiClient.apiKeys.regenerate(id),
    onSuccess: (data) => {
      setNewKeySecret(data.key);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createMutation.mutate(newKeyName.trim());
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary">{t('apiKeys.title')}</h1>
          <p className="mt-1 text-sm text-secondary">{t('apiKeys.description')}</p>
        </div>
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t('settings.keyNamePlaceholder')}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:border-accent focus:outline-none w-40"
          />
          <button
            type="submit"
            disabled={!newKeyName.trim() || createMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black hover:bg-accent-hover disabled:opacity-40 transition-colors font-mono"
          >
            <Plus size={16} />
            {t('apiKeys.create')}
          </button>
        </form>
      </div>

      {/* New Key Banner */}
      {newKeySecret && (
        <div className="mb-6 space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-200">{t('settings.copyWarning')}</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-bg px-3 py-2 text-sm font-mono text-primary border border-border truncate">
                    {newKeySecret}
                  </code>
                  <button onClick={() => handleCopy(newKeySecret, 'new')} className="shrink-0 p-2 rounded-lg bg-surface-hover text-secondary hover:text-primary">
                    {copied === 'new' ? <CheckCircle2 size={16} className="text-green-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Agent Quick Start */}
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-5">
            <h3 className="text-sm font-semibold text-accent mb-3">🚀 {t('apiKeys.agentQuickStart')}</h3>
            <div className="space-y-3 text-xs font-mono">
              <div>
                <p className="text-secondary mb-1 font-sans text-xs">{t('apiKeys.qs.env')}</p>
                <pre className="rounded-lg bg-bg border border-border p-3 text-primary whitespace-pre-wrap break-all">
{`BAATON_API_KEY=${newKeySecret}
BAATON_BASE_URL=https://api.baaton.dev/api/v1`}
                </pre>
              </div>
              <div>
                <p className="text-secondary mb-1 font-sans text-xs">{t('apiKeys.qs.getDocs')}</p>
                <pre className="rounded-lg bg-bg border border-border p-3 text-primary whitespace-pre-wrap break-all">
{`curl -s https://api.baaton.dev/api/v1/public/docs`}
                </pre>
              </div>
              <div>
                <p className="text-secondary mb-1 font-sans text-xs">{t('apiKeys.qs.createIssue')}</p>
                <pre className="rounded-lg bg-bg border border-border p-3 text-primary whitespace-pre-wrap break-all">
{`curl -X POST https://api.baaton.dev/api/v1/issues \\
  -H "Authorization: Bearer ${newKeySecret}" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id":"...","title":"Fix bug","priority":"high"}'`}
                </pre>
              </div>
            </div>
            <Link to="/docs" className="inline-flex items-center gap-1 mt-4 text-sm text-accent hover:underline">
              <BookOpen size={14} /> {t('apiKeys.qs.viewDocs')}
            </Link>
          </div>

          <button onClick={() => setNewKeySecret(null)} className="text-xs text-muted hover:text-secondary">
            {t('settings.dismiss')}
          </button>
        </div>
      )}

      {/* Keys Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">{t('apiKeys.col.name')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden sm:table-cell">{t('apiKeys.col.scope')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">{t('apiKeys.col.key')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden md:table-cell">{t('apiKeys.col.lastUsed')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wider hidden md:table-cell">{t('apiKeys.col.created')}</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">{t('settings.loadingKeys')}</td></tr>
            ) : apiKeys.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">{t('settings.noKeys')}</td></tr>
            ) : (
              apiKeys.map((key) => (
                <ApiKeyTableRow
                  key={key.id}
                  apiKey={key}
                  copied={copied}
                  onCopy={handleCopy}
                  onRegenerate={() => {
                    if (confirm(t('apiKeys.regenerateConfirm', { name: key.name }))) {
                      regenerateMutation.mutate(key.id);
                    }
                  }}
                  onDelete={() => {
                    if (confirm(t('settings.revokeConfirm', { name: key.name }))) {
                      deleteMutation.mutate(key.id);
                    }
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApiKeyTableRow({ apiKey, onRegenerate, onDelete }: {
  apiKey: ApiKey;
  copied?: string | null;
  onCopy?: (text: string, id: string) => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const [showPrefix, setShowPrefix] = useState(false);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-hover/50 transition-colors">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-primary">{apiKey.name}</span>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className="text-xs text-secondary">Org</span>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => setShowPrefix(!showPrefix)}
          className="flex items-center gap-1.5 text-xs font-mono text-secondary hover:text-primary transition-colors"
        >
          {showPrefix ? (
            <><EyeOff size={12} /><span>{apiKey.key_prefix}••••••••</span></>
          ) : (
            <><Eye size={12} /><span>••••••••••••••••</span></>
          )}
        </button>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-xs text-muted">
          {apiKey.last_used_at ? timeAgo(apiKey.last_used_at) : '—'}
        </span>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-xs text-muted">{timeAgo(apiKey.created_at)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button onClick={onRegenerate} className="rounded-md p-1.5 text-muted hover:bg-accent/10 hover:text-accent transition-all" title="Regenerate key">
            <RefreshCw size={14} />
          </button>
          <button onClick={onDelete} className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400 transition-all" title="Revoke key">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default ApiKeys;
