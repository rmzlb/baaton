import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Trash2, Wifi, WifiOff, Save, ExternalLink,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

// Per-user localStorage key (no backend needed for MVP)
const STORAGE_KEY = 'baaton-openclaw-connection';

interface OpenClawConfig {
  name: string;
  apiUrl: string;
  apiToken: string;
  status: 'pending' | 'connected' | 'error';
  lastPingAt?: string;
}

function loadConfig(): OpenClawConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(config: OpenClawConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function deleteConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export function OpenClawSettings() {
  const { t } = useTranslation();

  const [name, setName] = useState('My OpenClaw');
  const [apiUrl, setApiUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [status, setStatus] = useState<'pending' | 'connected' | 'error'>('pending');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const config = loadConfig();
    if (config) {
      setName(config.name);
      setApiUrl(config.apiUrl);
      setApiToken(config.apiToken);
      setStatus(config.status);
    }
  }, []);

  // Test connection to OpenClaw
  const testConnection = useCallback(async () => {
    if (!apiUrl || !apiToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        setTestResult({ ok: true });
        setStatus('connected');
      } else {
        setTestResult({ ok: false, error: `HTTP ${res.status}` });
        setStatus('error');
      }
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
      setStatus('error');
    } finally {
      setTesting(false);
    }
  }, [apiUrl, apiToken]);

  // Save to localStorage
  const handleSave = () => {
    saveConfig({ name, apiUrl, apiToken, status, lastPingAt: new Date().toISOString() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Delete connection
  const handleDelete = () => {
    deleteConfig();
    setName('My OpenClaw');
    setApiUrl('');
    setApiToken('');
    setStatus('pending');
    setTestResult(null);
  };

  const isConfigured = !!apiUrl && !!apiToken;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
            🦞 OpenClaw
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
          <p className="text-sm text-secondary mt-1">
            {t('settings.openclawDesc')}
          </p>
        </div>
        <a
          href="https://docs.openclaw.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-secondary hover:text-primary flex items-center gap-1"
        >
          Docs <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Form */}
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            {t('settings.openclawName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My OpenClaw"
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-primary text-sm
                       focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* API URL */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            {t('settings.openclawUrl')}
          </label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://your-gateway.openclaw.ai"
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-primary text-sm
                       placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* API Token */}
        <div>
          <label className="block text-sm font-medium text-secondary mb-1">
            {t('settings.openclawToken')}
          </label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="gw_xxxxxxxxxxxxx"
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-primary text-sm
                       placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Test Result */}
        {testResult && (
          <div className={cn(
            'flex items-center gap-2 text-sm px-3 py-2 rounded-lg',
            testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          )}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {testResult.ok ? 'Connected successfully!' : `Error: ${testResult.error}`}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={testConnection}
            disabled={!isConfigured || testing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-surface border border-border text-primary hover:bg-surface-hover
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
            {saved ? 'Saved!' : t('settings.save')}
          </button>

          {isConfigured && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {t('settings.disconnect')}
            </button>
          )}
        </div>
      </div>

      {/* Info box */}
      <div className="bg-surface border border-border rounded-lg p-4 text-xs text-secondary space-y-2">
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

/** Helper: get the current user's OpenClaw config */
export function getOpenClawConfig(): OpenClawConfig | null {
  return loadConfig();
}
