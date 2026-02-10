import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Trash2, Wifi, WifiOff, Save, ExternalLink, Settings2,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  type OpenClawConfig,
  getOpenClawConfig,
  saveOpenClawConfig,
  clearOpenClawConfig,
  testOpenClawConnection,
} from '@/lib/openclaw-engine';

export function OpenClawSettings() {
  const { t } = useTranslation();

  const [name, setName] = useState('My OpenClaw');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState<'pending' | 'connected' | 'error'>('pending');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const config = getOpenClawConfig();
    if (config) {
      setName(config.name);
      setGatewayUrl(config.gatewayUrl);
      setApiToken(config.apiToken);
      setAgentId(config.agentId || '');
      setStatus(config.status);
    }
  }, []);

  // Test connection to OpenClaw
  const handleTestConnection = useCallback(async () => {
    if (!gatewayUrl || !apiToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testOpenClawConnection({ gatewayUrl, apiToken });
      setTestResult(result);
      setStatus(result.ok ? 'connected' : 'error');
    } catch {
      setTestResult({ ok: false, error: 'Unexpected error' });
      setStatus('error');
    } finally {
      setTesting(false);
    }
  }, [gatewayUrl, apiToken]);

  // Save to localStorage
  const handleSave = () => {
    const config: OpenClawConfig = {
      name,
      gatewayUrl,
      apiToken,
      agentId: agentId || undefined,
      status,
      lastPingAt: new Date().toISOString(),
    };
    saveOpenClawConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Delete connection
  const handleDelete = () => {
    if (!confirm(t('settings.openclawDeleteConfirm'))) return;
    clearOpenClawConfig();
    setName('My OpenClaw');
    setGatewayUrl('');
    setApiToken('');
    setAgentId('');
    setStatus('pending');
    setTestResult(null);
  };

  const isConfigured = !!gatewayUrl && !!apiToken;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 text-lg">
          🦞
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-primary flex items-center gap-2">
            {t('settings.openclaw')}
            {status === 'connected' && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                <Wifi className="w-3 h-3" /> {t('settings.connected')}
              </span>
            )}
            {status === 'error' && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                <WifiOff className="w-3 h-3" /> {t('settings.disconnected')}
              </span>
            )}
          </h3>
          <p className="text-xs text-secondary mt-0.5">
            {t('settings.openclawDesc')}
          </p>
        </div>
        <a
          href="https://docs.openclaw.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-secondary hover:text-primary flex items-center gap-1 transition-colors"
        >
          Docs <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Form */}
      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">
            {t('settings.openclawName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.openclawNamePlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-primary text-sm
                       focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          />
        </div>

        {/* Gateway URL */}
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">
            {t('settings.openclawUrl')}
          </label>
          <input
            type="url"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            placeholder={t('settings.openclawUrlPlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-primary text-sm
                       placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          />
        </div>

        {/* API Token */}
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">
            {t('settings.openclawToken')}
          </label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={t('settings.openclawTokenPlaceholder')}
            className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-primary text-sm
                       placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          />
        </div>

        {/* Agent ID (optional, advanced) */}
        <details className="group">
          <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-muted hover:text-secondary transition-colors">
            <Settings2 size={12} />
            {t('settings.openclawAdvanced')}
          </summary>
          <div className="mt-2">
            <label className="block text-xs font-medium text-secondary mb-1">
              {t('settings.openclawAgentId')}
            </label>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder={t('settings.openclawAgentIdPlaceholder')}
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-primary text-sm
                         placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
            />
            <p className="text-[10px] text-muted mt-1">{t('settings.openclawAgentIdHint')}</p>
          </div>
        </details>

        {/* Test Result */}
        {testResult && (
          <div className={cn(
            'flex items-center gap-2 text-sm px-3 py-2 rounded-lg',
            testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          )}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {testResult.ok ? t('settings.openclawTestSuccess') : `${t('settings.openclawTestError')}: ${testResult.error}`}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleTestConnection}
            disabled={!isConfigured || testing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-bg border border-border text-primary hover:bg-surface-hover
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {t('settings.testConnection')}
          </button>

          <button
            onClick={handleSave}
            disabled={!isConfigured}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              saved
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-accent text-black hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? t('settings.openclawSaved') : t('settings.openclawSave')}
          </button>

          {isConfigured && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {t('settings.openclawDelete')}
            </button>
          )}
        </div>
      </div>

      {/* Per-user isolation info */}
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/10 px-3 py-2">
        <span className="text-blue-400 text-xs mt-0.5">🔒</span>
        <p className="text-[11px] text-blue-300/80">
          {t('settings.openclawPerUserInfo')}
        </p>
      </div>

      {/* How to connect */}
      <div className="mt-4 bg-bg border border-border rounded-lg p-4 text-xs text-secondary space-y-2">
        <p className="font-medium text-primary text-sm">💡 {t('settings.openclawHow')}</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>{t('settings.openclawStep1')}</li>
          <li>{t('settings.openclawStep2')}</li>
          <li>{t('settings.openclawStep3')}</li>
          <li>{t('settings.openclawStep4')}</li>
        </ol>
      </div>
    </div>
  );
}
