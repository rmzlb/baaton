import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Trash2, Info,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/shared/Skeleton';
import type { NotificationChannel } from '@/lib/types';
import {
  ChannelRow,
  SubscriptionsSection,
} from '@/components/settings/NotificationPreferencesSection';

// ─── Telegram logo SVG ────────────────────────────────────────────────────────

function TelegramIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        d="M5.49 11.74l11.57-4.46c.54-.19 1.01.13.83.94l-1.97 9.28c-.15.66-.54.82-1.08.51l-3-2.21-1.45 1.39c-.16.16-.3.3-.6.3l.21-3.05 5.56-5.02c.24-.21-.05-.33-.37-.12l-6.87 4.33-2.96-.93c-.64-.2-.66-.64.14-.95z"
        fill="white"
      />
    </svg>
  );
}

// ─── Telegram channel config ───────────────────────────────────────────────────

const TELEGRAM_CHANNEL_CFG: { key: NotificationChannel; labelKey: string; placeholderKey: string } = {
  key: 'telegram',
  labelKey: 'notifPrefs.channels.telegram.label',
  placeholderKey: 'notifPrefs.channels.telegram.manualPlaceholder',
};

// ─── Step number badge ────────────────────────────────────────────────────────

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
      done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-border bg-surface-hover text-muted'
    }`}>
      {done ? <CheckCircle2 size={11} /> : n}
    </span>
  );
}

// ─── Step 1 – Bot ─────────────────────────────────────────────────────────────

function TelegramBotStep() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const botCacheKey = [...apiClient.notificationPrefs.cacheScope, 'telegram-bot'];

  const [token, setToken] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showBYO, setShowBYO] = useState(false);

  const { data: botData, isLoading, isError } = useQuery({
    queryKey: botCacheKey,
    queryFn: () => apiClient.telegramBot.get(),
    staleTime: 60_000,
    retry: false,
  });

  const registerMutation = useMutation({
    mutationFn: (tok: string) => apiClient.telegramBot.set(tok),
    onSuccess: () => {
      setToken('');
      setSaveError('');
      setShowBYO(false);
      queryClient.invalidateQueries({ queryKey: botCacheKey });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else {
        setSaveError(t('integrations.telegram.bot.errorGeneric', { defaultValue: 'Could not register bot. Try again.' }));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.telegramBot.remove(),
    onSuccess: () => {
      setToken('');
      setSaveError('');
      queryClient.invalidateQueries({ queryKey: botCacheKey });
    },
  });

  const botReady = !isLoading && !isError && !!botData && botData.webhook_registered;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StepBadge n={1} done={botReady} />
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            {t('integrations.telegram.bot.title', { defaultValue: 'Bot' })}
          </p>
          <p className="text-xs text-secondary mt-0.5">
            {t('integrations.telegram.bot.desc', { defaultValue: 'The bot Baaton uses to send your Telegram notifications.' })}
          </p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-14 rounded-lg" />}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('integrations.telegram.bot.loadError', { defaultValue: 'Could not load bot status.' })}
        </div>
      )}

      {!isLoading && !isError && botData && (
        <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-sm font-mono font-medium text-accent">
                @{botData.bot_username}
              </span>
              {botData.source === 'personal' ? (
                <span className="text-[11px] text-muted">
                  {t('integrations.telegram.bot.owned', { defaultValue: 'Your bot' })}
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                  <Info size={9} />
                  {t('integrations.telegram.bot.sharedInstance', { defaultValue: 'Shared bot' })}
                </span>
              )}
            </div>
            {botData.source === 'personal' && (
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm(t('integrations.telegram.bot.deleteConfirm', { defaultValue: 'Remove this bot? Telegram notifications will stop immediately.' }))) {
                    deleteMutation.mutate();
                  }
                }}
                className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                aria-label={t('integrations.telegram.bot.deleteConfirm', { defaultValue: 'Remove bot' })}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {/* Webhook status */}
          {botData.webhook_registered ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle2 size={11} />
              {t('integrations.telegram.bot.webhookOk', { defaultValue: 'Webhook active' })}
            </div>
          ) : (
            <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{t('integrations.telegram.bot.webhookDead', { defaultValue: 'Webhook not registered — Telegram cannot deliver messages. Re-register your bot to fix.' })}</span>
            </div>
          )}

          {botData.source === 'instance' && (
            <p className="text-[11px] text-muted">
              {t('integrations.telegram.bot.sharedInstanceHint', { defaultValue: 'Using a shared bot. Register your own token for dedicated control.' })}
            </p>
          )}
        </div>
      )}

      {/* BYO bot form — progressive disclosure */}
      {!isLoading && !isError && (!botData || botData.source === 'instance') && (
        <div>
          <button
            type="button"
            onClick={() => setShowBYO(!showBYO)}
            className="flex items-center gap-1 text-xs text-muted hover:text-secondary transition-colors"
            aria-expanded={showBYO}
          >
            {showBYO ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {botData
              ? t('integrations.telegram.bot.useYourOwn', { defaultValue: 'Use your own bot instead' })
              : t('integrations.telegram.bot.noBotHint', { defaultValue: 'Register your own bot' })}
          </button>

          {showBYO && (
            <div className="mt-2 space-y-2 pl-3 border-l-2 border-border">
              <p className="text-xs text-muted">
                {t('integrations.telegram.bot.byoDesc', { defaultValue: 'Create a bot on @BotFather and paste its token. Baaton registers the webhook automatically.' })}
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t('integrations.telegram.bot.tokenPlaceholder', { defaultValue: '123456:ABC-...' })}
                  autoComplete="new-password"
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
                />
                <button
                  type="button"
                  disabled={registerMutation.isPending || !token.trim()}
                  onClick={() => registerMutation.mutate(token.trim())}
                  className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors whitespace-nowrap"
                  aria-label={t('integrations.telegram.bot.save', { defaultValue: 'Register' })}
                >
                  {t('integrations.telegram.bot.save', { defaultValue: 'Register' })}
                </button>
              </div>
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 2 – Destination ─────────────────────────────────────────────────────

type DestType = 'dm' | 'group';

function TelegramDestinationStep({ botAvailable }: { botAvailable: boolean }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const channelsCacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];

  const { data: channels = [], isLoading, isError } = useQuery({
    queryKey: channelsCacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const telegramChannel = channels.find((c) => c.channel === 'telegram');
  const refresh = () => queryClient.invalidateQueries({ queryKey: channelsCacheKey });
  const hasChannel = Boolean(telegramChannel);

  const [changing, setChanging] = useState(false);
  const [destType, setDestType] = useState<DestType>('dm');
  const [address, setAddress] = useState('');
  const [threadId, setThreadId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [testState, setTestState] = useState<'idle' | 'sent' | 'error'>('idle');

  const testMutation = useMutation({
    mutationFn: () => apiClient.notificationPrefs.testTelegramNotification(),
    onSuccess: () => {
      setTestState('sent');
      setTimeout(() => setTestState('idle'), 2000);
    },
    onError: () => setTestState('error'),
  });

  const setDestMutation = useMutation({
    mutationFn: () => {
      const tid = threadId.trim() ? parseInt(threadId.trim(), 10) : undefined;
      return apiClient.notificationPrefs.setChannel('telegram', address.trim(), tid);
    },
    onSuccess: () => {
      setSubmitError('');
      setChanging(false);
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Could not save destination. Try again.');
      }
    },
  });

  const showForm = !hasChannel || changing;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StepBadge n={2} done={hasChannel} />
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            {t('integrations.telegram.channel.title', { defaultValue: 'Destination' })}
          </p>
          <p className="text-xs text-secondary mt-0.5">
            {t('integrations.telegram.channel.desc', { defaultValue: 'Link your Telegram account so Baaton knows where to send your notifications.' })}
          </p>
        </div>
      </div>

      {/* Guard: bot must be configured first */}
      {!botAvailable && (
        <p className="text-xs text-muted italic">
          {t('integrations.telegram.channel.needsBot', { defaultValue: 'A bot must be configured first (step 1) before you can link your account.' })}
        </p>
      )}

      {botAvailable && isLoading && <Skeleton className="h-14 rounded-lg" />}

      {botAvailable && isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.loadError', { defaultValue: 'Failed to load channels. Refresh to retry.' })}
        </div>
      )}

      {botAvailable && !isLoading && !isError && (
        <>
          {/* ── Destination déjà liée ── */}
          {hasChannel && !changing && (
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
              <TelegramIcon size={14} />
              {telegramChannel?.telegram_thread_id ? (
                <span className="font-mono text-secondary">
                  {telegramChannel.address_masked} · #{telegramChannel.telegram_thread_id}
                </span>
              ) : (
                <>
                  <span className="text-muted">
                    {t('integrations.telegram.channel.viaBot', { defaultValue: 'via' })}
                  </span>
                  <span className="font-mono text-secondary">
                    @{telegramChannel?.telegram_bot_username}
                  </span>
                </>
              )}
              <span className="text-muted">·</span>
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 size={11} />
                {t('notifPrefs.channels.verified', { defaultValue: 'Verified' })}
              </span>
              <button
                type="button"
                disabled={testMutation.isPending}
                onClick={() => { setTestState('idle'); testMutation.mutate(); }}
                className="ml-1 inline-flex items-center gap-1 rounded-md border border-border bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-secondary hover:border-accent hover:text-primary disabled:opacity-50 transition-colors"
              >
                {testMutation.isPending ? (
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                ) : testState === 'sent' ? '✓ Sent!' : '🔔 Send test'}
              </button>
              {testState === 'error' && (
                <span className="text-[11px] text-red-400">
                  {t('integrations.telegram.test.error', { defaultValue: 'Failed to send — check your bot is active' })}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setChanging(true);
                  setDestType('dm');
                  setAddress('');
                  setThreadId('');
                  setSubmitError('');
                }}
                className="ml-1 text-[11px] text-muted hover:text-secondary underline underline-offset-2 transition-colors"
              >
                Change
              </button>
            </div>
          )}

          {/* ── Formulaire de choix ── */}
          {showForm && (
            <div className="space-y-3">
              {/* Sélecteur DM / Groupe */}
              <div className="flex gap-2">
                {(['dm', 'group'] as DestType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDestType(type)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      destType === type
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-bg text-muted hover:text-secondary'
                    }`}
                  >
                    {type === 'dm' ? 'DM (auto)' : 'Groupe / Channel'}
                  </button>
                ))}
              </div>

              {/* DM : flow /start existant */}
              {destType === 'dm' && (
                <ChannelRow
                  config={TELEGRAM_CHANNEL_CFG}
                  existing={telegramChannel}
                  onRefresh={refresh}
                  hideAddress
                />
              )}

              {/* Groupe/Channel : formulaire manuel */}
              {destType === 'group' && (
                <div className="space-y-2 pl-3 border-l-2 border-border">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted">Group username or ID</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="@mygroup or -1001234567890"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted">
                      Thread ID{' '}
                      <span className="opacity-60">(optional, forum supergroups only)</span>
                    </label>
                    <input
                      type="number"
                      value={threadId}
                      onChange={(e) => setThreadId(e.target.value)}
                      placeholder="12345"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
                    />
                    {submitError && /forum|supergroup/i.test(submitError) && (
                      <p className="text-xs text-red-400">{submitError}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={setDestMutation.isPending || !address.trim()}
                    onClick={() => { setSubmitError(''); setDestMutation.mutate(); }}
                    className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors"
                  >
                    {setDestMutation.isPending ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent inline-block" />
                    ) : 'Set destination'}
                  </button>
                  {submitError && !/forum|supergroup/i.test(submitError) && (
                    <p className="text-xs text-red-400">{submitError}</p>
                  )}
                </div>
              )}

              {changing && (
                <button
                  type="button"
                  onClick={() => setChanging(false)}
                  className="text-[11px] text-muted hover:text-secondary underline underline-offset-2 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Step 3 – Subscriptions ───────────────────────────────────────────────────

function TelegramSubscriptionsStep({ hasChannel }: { hasChannel: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {/* No desc here — SubscriptionsSection already has its own */}
      <div className="flex items-center gap-2">
        <StepBadge n={3} done={false} />
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
          {t('integrations.telegram.subs.title', { defaultValue: 'Projects & events' })}
        </p>
      </div>

      {!hasChannel ? (
        <p className="text-xs text-muted italic">
          {t('integrations.telegram.subs.needsChannel', { defaultValue: 'Connect your Telegram destination first (step 2 above).' })}
        </p>
      ) : (
        <SubscriptionsSection />
      )}
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export function TelegramCardContent() {
  const apiClient = useApi();
  const channelsCacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];
  const botCacheKey = [...apiClient.notificationPrefs.cacheScope, 'telegram-bot'];

  // Shared with TelegramBotStep — React Query deduplicates.
  const { data: botData } = useQuery({
    queryKey: botCacheKey,
    queryFn: () => apiClient.telegramBot.get(),
    staleTime: 60_000,
    retry: false,
  });

  // Shared with TelegramDestinationStep — React Query deduplicates.
  const { data: channels = [] } = useQuery({
    queryKey: channelsCacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const botAvailable = Boolean(botData);
  const telegramChannel = channels.find((c) => c.channel === 'telegram');

  return (
    <div className="space-y-5">
      {/* Step 1 – Bot */}
      <TelegramBotStep />

      {/* Step 2 – Destination */}
      <div className="border-t border-border pt-5">
        <TelegramDestinationStep botAvailable={botAvailable} />
      </div>

      {/* Step 3 – Subscriptions */}
      <div className="border-t border-border pt-5">
        <TelegramSubscriptionsStep hasChannel={Boolean(telegramChannel?.verified)} />
      </div>
    </div>
  );
}

// ─── Status helper (for Integrations page) ────────────────────────────────────

export function useTelegramStatus() {
  const apiClient = useApi();
  const channelsCacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];

  const { data: channels = [] } = useQuery({
    queryKey: channelsCacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const telegramChannel = channels.find((c) => c.channel === 'telegram');
  return telegramChannel?.verified ? 'connected' : 'disconnected';
}
