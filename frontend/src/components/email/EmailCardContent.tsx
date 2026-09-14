import { useState } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/shared/Skeleton';
import { EmailStatusRules } from './EmailStatusRules';

// ─── Step number badge ────────────────────────────────────────────────────────

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
        done
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
          : 'border-border bg-surface-hover text-muted'
      }`}
    >
      {done ? <CheckCircle2 size={11} /> : n}
    </span>
  );
}

// ─── Step 1 – Email address ───────────────────────────────────────────────────

function EmailAddressStep() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const verifiedAddresses = (user?.emailAddresses ?? []).filter((e) => e.verification?.status === 'verified');
  const queryClient = useQueryClient();
  const channelsCacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];

  const [address, setAddress] = useState('');
  const [changing, setChanging] = useState(false);
  const [saveError, setSaveError] = useState('');

  const {
    data: channels = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: channelsCacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const emailChannel = channels.find((c) => c.channel === 'email');
  const hasChannel = Boolean(emailChannel?.verified);
  const refresh = () => queryClient.invalidateQueries({ queryKey: channelsCacheKey });

  const saveMutation = useMutation({
    mutationFn: () => apiClient.notificationPrefs.setChannel('email', address.trim()),
    onSuccess: () => {
      setAddress('');
      setSaveError('');
      setChanging(false);
      refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setSaveError(err.message);
      } else {
        setSaveError(
          t('integrations.email.saveError', {
            defaultValue: 'Could not save email address. Try again.',
          }),
        );
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.notificationPrefs.removeChannel('email'),
    onSuccess: () => {
      setAddress('');
      setSaveError('');
      refresh();
    },
  });

  const showForm = !hasChannel || changing;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StepBadge n={1} done={hasChannel} />
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            {t('integrations.email.address.title', { defaultValue: 'Email address' })}
          </p>
          <p className="text-xs text-secondary mt-0.5">
            {t('integrations.email.address.desc', {
              defaultValue: 'The address where Baaton will deliver your notifications.',
            })}
          </p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-12 rounded-lg" />}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.loadError', {
            defaultValue: 'Failed to load channels. Refresh to retry.',
          })}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Address saved */}
          {hasChannel && !changing && emailChannel && (
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle2 size={11} />
                {t('notifPrefs.channels.saved', { defaultValue: 'Saved' })}
              </span>
              <span className="font-mono text-secondary">
                {emailChannel.address_masked}
              </span>
              <button
                type="button"
                onClick={() => {
                  setChanging(true);
                  setAddress('');
                  setSaveError('');
                }}
                className="text-[11px] text-muted hover:text-secondary underline underline-offset-2 transition-colors"
              >
                {t('common.change', { defaultValue: 'Change' })}
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="rounded-md p-1 text-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
                aria-label={t('integrations.email.address.remove', {
                  defaultValue: 'Remove email address',
                })}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}

          {/* Input form */}
          {showForm && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  aria-label={t('integrations.email.address.title', { defaultValue: 'Email address' })}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="flex-1 min-w-0 rounded-md border border-border bg-bg px-3 py-2 text-sm text-primary focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">{t('integrations.email.selectVerified', { defaultValue: 'Select a verified account email' })}</option>
                  {verifiedAddresses.map((e) => <option key={e.id} value={e.emailAddress}>{e.emailAddress}</option>)}
                </select>
                <button
                  type="button"
                  disabled={saveMutation.isPending || !address.trim()}
                  onClick={() => {
                    setSaveError('');
                    saveMutation.mutate();
                  }}
                  className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {saveMutation.isPending ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent inline-block" />
                  ) : (
                    t('common.save', { defaultValue: 'Save' })
                  )}
                </button>
              </div>
              <p className="text-xs text-muted">
                {t('integrations.email.verifiedOnly', { defaultValue: 'Only verified account emails can receive ticket content.' })}{' '}
                <button type="button" onClick={() => openUserProfile()} className="text-accent underline focus:ring-2 focus:ring-accent/30">
                  {t('integrations.email.manageAccount', { defaultValue: 'Manage account emails' })}
                </button>
              </p>
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              {changing && (
                <button
                  type="button"
                  onClick={() => setChanging(false)}
                  className="text-[11px] text-muted hover:text-secondary underline underline-offset-2 transition-colors"
                >
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Step 2 – Subscriptions ───────────────────────────────────────────────────

function EmailSubscriptionsStep({ hasChannel }: { hasChannel: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StepBadge n={2} done={false} />
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
          {t('integrations.email.subs.title', { defaultValue: 'Email rules' })}
        </p>
      </div>

      {!hasChannel ? (
        <p className="text-xs text-muted italic">
          {t('integrations.email.subs.needsAddress', {
            defaultValue: 'Save your email address first (step 1 above).',
          })}
        </p>
      ) : (
        <EmailStatusRules />
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function EmailCardContent() {
  const apiClient = useApi();
  const channelsCacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];

  // Shared with EmailAddressStep — React Query deduplicates.
  const { data: channels = [] } = useQuery({
    queryKey: channelsCacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const emailChannel = channels.find((c) => c.channel === 'email');

  return (
    <div className="space-y-5">
      {/* Step 1 – Address */}
      <EmailAddressStep />

      {/* Step 2 – Subscriptions */}
      <div className="border-t border-border pt-5">
        <EmailSubscriptionsStep hasChannel={Boolean(emailChannel?.verified)} />
      </div>
    </div>
  );
}

// ─── Status helper (for Integrations page) ────────────────────────────────────

export function useEmailStatus(): 'connected' | 'disconnected' {
  const apiClient = useApi();
  const channelsCacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];

  const { data: channels = [] } = useQuery({
    queryKey: channelsCacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const emailChannel = channels.find((c) => c.channel === 'email');
  return emailChannel?.verified ? 'connected' : 'disconnected';
}
