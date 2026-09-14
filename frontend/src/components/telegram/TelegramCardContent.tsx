import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Loader2, Trash2, Info,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { ApiError } from '@/lib/api';
import type { NotificationChannel } from '@/lib/types';
import {
  ChannelRow,
  SubscriptionsSection,
} from '@/components/settings/NotificationPreferencesSection';

// ─── Telegram channel config (mirrors SUPPORTED_CHANNELS[0]) ──────────────────

const TELEGRAM_CHANNEL_CFG: { key: NotificationChannel; labelKey: string; placeholderKey: string } = {
  key: 'telegram',
  labelKey: 'notifPrefs.channels.telegram.label',
  placeholderKey: 'notifPrefs.channels.telegram.manualPlaceholder',
};

// ─── Step 1 – Bot ─────────────────────────────────────────────────────────────

function TelegramBotStep() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [saveError, setSaveError] = useState('');

  const { data: botData, isLoading, isError } = useQuery({
    queryKey: ['me-telegram-bot'],
    queryFn: () => apiClient.telegramBot.get(),
    staleTime: 60_000,
    retry: false,
  });

  const registerMutation = useMutation({
    mutationFn: (tok: string) => apiClient.telegramBot.set(tok),
    onSuccess: () => {
      setToken('');
      setSaveError('');
      queryClient.invalidateQueries({ queryKey: ['me-telegram-bot'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else {
        setSaveError(t('integrations.telegram.bot.errorGeneric'));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.telegramBot.remove(),
    onSuccess: () => {
      setToken('');
      setSaveError('');
      queryClient.invalidateQueries({ queryKey: ['me-telegram-bot'] });
    },
  });

  const showTokenForm = !isLoading && !isError && (!botData || !botData.owned);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
          {t('integrations.telegram.bot.title')}
        </p>
        <p className="text-xs text-secondary mt-0.5">
          {t('integrations.telegram.bot.desc')}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={13} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('integrations.telegram.bot.loadError')}
        </div>
      )}

      {!isLoading && !isError && botData && (
        <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-sm font-mono font-medium text-accent">
                @{botData.bot_username}
              </span>
              {botData.owned ? (
                <span className="text-[11px] text-muted">
                  {t('integrations.telegram.bot.owned')}
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                  <Info size={9} />
                  {t('integrations.telegram.bot.sharedInstance')}
                </span>
              )}
            </div>
            {botData.owned && (
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm(t('integrations.telegram.bot.deleteConfirm'))) {
                    deleteMutation.mutate();
                  }
                }}
                className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                title={t('integrations.telegram.bot.deleteConfirm')}
              >
                {deleteMutation.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            )}
          </div>

          {/* Webhook status */}
          {botData.webhook_registered ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle2 size={11} />
              {t('integrations.telegram.bot.webhookOk')}
            </div>
          ) : (
            <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{t('integrations.telegram.bot.webhookDead')}</span>
            </div>
          )}

          {/* Shared instance hint */}
          {!botData.owned && (
            <p className="text-[11px] text-muted">
              {t('integrations.telegram.bot.sharedInstanceHint')}
            </p>
          )}
        </div>
      )}

      {/* Token form — when no bot at all, or only a shared bot */}
      {showTokenForm && (
        <div className="space-y-2">
          {!botData && (
            <p className="text-xs text-muted">{t('integrations.telegram.bot.noBotHint')}</p>
          )}
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('integrations.telegram.bot.tokenPlaceholder')}
              autoComplete="new-password"
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
            />
            <button
              type="button"
              disabled={registerMutation.isPending || !token.trim()}
              onClick={() => registerMutation.mutate(token.trim())}
              className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {registerMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                t('integrations.telegram.bot.save')
              )}
            </button>
          </div>
          {saveError && (
            <p className="text-xs text-red-400">{saveError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 2 – Channel ──────────────────────────────────────────────────────────

function TelegramChannelStep() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const { data: channels = [], isLoading, isError } = useQuery({
    queryKey: ['me-notification-channels'],
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const telegramChannel = channels.find((c) => c.channel === 'telegram');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['me-notification-channels'] });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
          {t('integrations.telegram.channel.title')}
        </p>
        <p className="text-xs text-secondary mt-0.5">
          {t('integrations.telegram.channel.desc')}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={13} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.loadError')}
        </div>
      )}

      {!isLoading && !isError && (
        <ChannelRow
          config={TELEGRAM_CHANNEL_CFG}
          existing={telegramChannel}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

// ─── Step 3 – Subscriptions ────────────────────────────────────────────────────

function TelegramSubscriptionsStep({ hasChannel }: { hasChannel: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
          {t('integrations.telegram.subs.title')}
        </p>
        <p className="text-xs text-secondary mt-0.5">
          {t('integrations.telegram.subs.desc')}
        </p>
      </div>

      {!hasChannel ? (
        <p className="text-xs text-muted italic">
          {t('integrations.telegram.subs.needsChannel')}
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

  // Only used to determine whether to enable step 3.
  // React Query deduplicates with the TelegramChannelStep query.
  const { data: channels = [] } = useQuery({
    queryKey: ['me-notification-channels'],
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const telegramChannel = channels.find((c) => c.channel === 'telegram');

  return (
    <div className="space-y-5">
      {/* Step 1 */}
      <TelegramBotStep />

      {/* Step 2 */}
      <div className="border-t border-border pt-5">
        <TelegramChannelStep />
      </div>

      {/* Step 3 */}
      <div className="border-t border-border pt-5">
        <TelegramSubscriptionsStep hasChannel={Boolean(telegramChannel)} />
      </div>
    </div>
  );
}

// ─── Status helper (for Integrations page) ────────────────────────────────────

export function useTelegramStatus() {
  const apiClient = useApi();

  const { data: channels = [] } = useQuery({
    queryKey: ['me-notification-channels'],
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const telegramChannel = channels.find((c) => c.channel === 'telegram');
  return telegramChannel?.verified ? 'connected' : 'disconnected';
}
