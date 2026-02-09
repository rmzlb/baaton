import { useState } from 'react';
import { OrganizationProfile } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, Copy, Eye, EyeOff, CheckCircle2, AlertTriangle, Globe } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo } from '@/lib/utils';
import type { ApiKey } from '@/lib/types';

export function Settings() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-6 space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-primary">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-secondary">
          {t('settings.description')}
        </p>
      </div>

      {/* Language Section */}
      <LanguageSection />

      {/* API Keys Section */}
      <ApiKeysSection />

      {/* Clerk Organization Profile */}
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-4">
          {t('settings.organization')}
        </h2>
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'bg-transparent shadow-none',
            },
          }}
        />
      </div>
    </div>
  );
}

function LanguageSection() {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <Globe size={20} className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
            {t('settings.language')}
          </h2>
          <p className="text-xs text-secondary mt-0.5">
            {t('settings.languageDesc')}
          </p>
        </div>
      </div>
      <select
        value={i18n.language}
        onChange={(e) => handleLanguageChange(e.target.value)}
        className="w-full max-w-xs rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary focus:border-accent focus:outline-none transition-colors"
      >
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
    </div>
  );
}

function ApiKeysSection() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: apiKeys = [], isLoading, error } = useQuery({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createMutation.mutate(newKeyName.trim());
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If the API keys endpoint returns a 404/error, the backend might not support it yet
  const endpointAvailable = !error;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <KeyRound size={20} className="text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
              {t('settings.apiKeys')}
            </h2>
            <p className="text-xs text-secondary mt-0.5">
              {t('settings.apiKeysDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* New Key Created Banner */}
      {newKeySecret && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-200">
                {t('settings.copyWarning')}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-bg px-3 py-2 text-xs font-mono text-primary border border-border truncate">
                  {newKeySecret}
                </code>
                <button
                  onClick={() => handleCopy(newKeySecret)}
                  className="shrink-0 rounded-md bg-surface-hover p-2 text-secondary hover:text-primary transition-colors"
                >
                  {copied ? <CheckCircle2 size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
              <button
                onClick={() => setNewKeySecret(null)}
                className="mt-2 text-xs text-amber-400 hover:underline"
              >
                {t('settings.dismiss')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate ? (
        <form onSubmit={handleCreate} className="mb-6 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-secondary mb-1.5">{t('settings.keyName')}</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t('settings.keyNamePlaceholder')}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!newKeyName.trim() || createMutation.isPending}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? t('settings.creatingKey') : t('settings.createKey')}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewKeyName(''); }}
            className="rounded-lg px-3 py-2.5 text-sm text-secondary hover:text-primary transition-colors"
          >
            {t('settings.cancel')}
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="mb-6 flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2.5 text-sm text-secondary hover:border-accent hover:text-accent transition-colors w-full justify-center min-h-[44px]"
        >
          <Plus size={16} />
          {t('settings.generateKey')}
        </button>
      )}

      {/* Existing Keys List */}
      {!endpointAvailable ? (
        <div className="text-center py-6 text-xs text-secondary">
          <p>{t('settings.noKeysEndpoint')}</p>
          <p className="mt-1">{t('settings.noKeysEndpointHint')}</p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-6 text-sm text-secondary">{t('settings.loadingKeys')}</div>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-6 text-xs text-secondary">
          {t('settings.noKeys')}
        </div>
      ) : (
        <div className="space-y-2">
          {apiKeys.map((key) => (
            <ApiKeyRow
              key={key.id}
              apiKey={key}
              onDelete={() => {
                if (confirm(t('settings.revokeConfirm', { name: key.name }))) {
                  deleteMutation.mutate(key.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Usage info */}
      <div className="mt-6 rounded-lg border border-border bg-bg p-4">
        <h3 className="text-xs font-semibold text-primary mb-2">{t('settings.usage')}</h3>
        <div className="space-y-2 text-xs text-secondary font-mono">
          <p>{t('settings.usageComment')}</p>
          <p className="text-primary">curl -H &quot;Authorization: Bearer baa_your_key_here&quot; \</p>
          <p className="text-primary pl-4">https://api.baaton.dev/api/v1/projects</p>
        </div>
      </div>
    </div>
  );
}

function ApiKeyRow({ apiKey, onDelete }: { apiKey: ApiKey; onDelete: () => void }) {
  const { t } = useTranslation();
  const [showPrefix, setShowPrefix] = useState(false);

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-4 py-3 min-h-[44px]">
      <div className="flex items-center gap-3 min-w-0">
        <KeyRound size={16} className="text-secondary shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary truncate">{apiKey.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <button
              onClick={() => setShowPrefix(!showPrefix)}
              className="text-[10px] font-mono text-secondary hover:text-primary transition-colors flex items-center gap-1"
            >
              {showPrefix ? (
                <>
                  <EyeOff size={10} />
                  {apiKey.key_prefix}…
                </>
              ) : (
                <>
                  <Eye size={10} />
                  ••••••••
                </>
              )}
            </button>
            <span className="text-[10px] text-secondary">
              · {t('settings.created', { time: timeAgo(apiKey.created_at) })}
            </span>
            {apiKey.last_used_at && (
              <span className="text-[10px] text-secondary hidden sm:inline">
                · {t('settings.used', { time: timeAgo(apiKey.last_used_at) })}
              </span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="rounded-md p-1.5 text-secondary hover:bg-red-500/10 hover:text-red-400 transition-all shrink-0"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
