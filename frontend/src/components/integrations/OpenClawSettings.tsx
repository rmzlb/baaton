import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, CheckCircle2, XCircle, Trash2, Wifi, WifiOff, Save,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';

export function OpenClawSettings() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [initialized, setInitialized] = useState(false);

  const { data: connection, isLoading, error: fetchError } = useQuery({
    queryKey: ['openclaw-connection'],
    queryFn: () => apiClient.openclaw.get(),
    retry: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: { onSuccess: undefined } as any,
  });

  // Populate form when connection loads
  if (connection && !initialized) {
    setName(connection.name);
    setApiUrl(connection.api_url);
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.openclaw.save({ name: name || 'My OpenClaw', api_url: apiUrl, api_token: apiToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openclaw-connection'] });
      setApiToken('');
      setTestResult(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiClient.openclaw.test({ api_url: apiUrl, api_token: apiToken }),
    onSuccess: (data) => setTestResult(data),
    onError: () => setTestResult({ ok: false, error: 'Network error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.openclaw.delete(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openclaw-connection'] });
      setName('');
      setApiUrl('');
      setApiToken('');
      setInitialized(false);
      setTestResult(null);
    },
  });

  const handleTest = () => {
    if (!apiUrl || !apiToken) return;
    setTestResult(null);
    testMutation.mutate();
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiUrl || !apiToken) return;
    saveMutation.mutate();
  };

  const handleDelete = () => {
    if (confirm(t('settings.openclawDeleteConfirm'))) {
      deleteMutation.mutate();
    }
  };

  const isConnected = connection && connection.status === 'connected';
  const hasError = connection && connection.status === 'error';
  const hasConnection = !!connection && !fetchError;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent text-lg">
          🦞
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-primary">{t('settings.openclaw')}</h3>
          <p className="text-xs text-secondary">{t('settings.openclawDesc')}</p>
        </div>
        {/* Status badge */}
        <div className="ml-auto">
          {isLoading ? (
            <Loader2 size={16} className="animate-spin text-muted" />
          ) : isConnected ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 text-emerald-400 px-2.5 py-1 text-xs font-medium">
              <Wifi size={12} />
              {t('settings.connected')}
            </span>
          ) : hasError ? (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 text-red-400 px-2.5 py-1 text-xs font-medium">
              <WifiOff size={12} />
              {t('settings.connectionError')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-surface-hover text-muted px-2.5 py-1 text-xs font-medium">
              <WifiOff size={12} />
              {t('settings.disconnected')}
            </span>
          )}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-3 border-t border-border pt-4">
        {/* Name */}
        <div>
          <label className="block text-xs text-secondary mb-1">{t('settings.openclawName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.openclawNamePlaceholder')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* API URL */}
        <div>
          <label className="block text-xs text-secondary mb-1">{t('settings.openclawUrl')}</label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder={t('settings.openclawUrlPlaceholder')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
            required
          />
        </div>

        {/* API Token */}
        <div>
          <label className="block text-xs text-secondary mb-1">
            {t('settings.openclawToken')}
            {hasConnection && (
              <span className="text-muted ml-1">(leave blank to keep current)</span>
            )}
          </label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={t('settings.openclawTokenPlaceholder')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
            required={!hasConnection}
          />
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-red-500/30 bg-red-500/10 text-red-400'
            }`}
          >
            {testResult.ok ? (
              <>
                <CheckCircle2 size={14} />
                {t('settings.connectionSuccess')}
              </>
            ) : (
              <>
                <XCircle size={14} />
                {t('settings.connectionFailed')}
                {testResult.error && `: ${testResult.error}`}
              </>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={!apiUrl || !apiToken || testMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testMutation.isPending ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t('settings.testingConnection')}
              </>
            ) : (
              <>
                <Wifi size={12} />
                {t('settings.testConnection')}
              </>
            )}
          </button>

          <button
            type="submit"
            disabled={!apiUrl || (!apiToken && !hasConnection) || saveMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t('settings.openclawSaving')}
              </>
            ) : (
              <>
                <Save size={12} />
                {t('settings.openclawSave')}
              </>
            )}
          </button>

          {hasConnection && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} />
              {t('settings.openclawDelete')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
