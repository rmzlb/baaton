import { useState } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/shared/Skeleton';

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

// ─── Recap switch (BAA-40) ───────────────────────────────────────────────────

/**
 * The person's recap switch: the same state the one-click link in every recap
 * turns off, so this is also where they turn it back on.
 */
function RecapToggle() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const recapCacheKey = [...apiClient.notificationPrefs.cacheScope, 'email-recap'];

  const { data, isLoading, isError } = useQuery({
    queryKey: recapCacheKey,
    queryFn: () => apiClient.notificationPrefs.getEmailRecap(),
    staleTime: 60_000,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => apiClient.notificationPrefs.setEmailRecap(enabled),
    onSuccess: (setting) => queryClient.setQueryData(recapCacheKey, setting),
  });

  if (isLoading) return <Skeleton className="h-10 rounded-lg" />;
  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        <AlertTriangle size={13} />
        {t('notifPrefs.channels.loadError', { defaultValue: 'Failed to load channels. Refresh to retry.' })}
      </div>
    );
  }

  const enabled = mutation.isPending && mutation.variables !== undefined ? mutation.variables : data.enabled;
  const label = t('integrations.email.recap.toggle', { defaultValue: 'Receive the email recap' });

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium text-primary">{label}</p>
        <p className="text-[11px] text-muted mt-0.5">
          {enabled
            ? t('integrations.email.recap.toggleOn', {
                defaultValue: 'On. Every recap has a one-click unsubscribe link.',
              })
            : t('integrations.email.recap.toggleOff', {
                defaultValue: 'Off: no recap is sent. @mentions still arrive by email.',
              })}
        </p>
        {mutation.isError && (
          <p className="text-[11px] text-red-400 mt-1">
            {t('integrations.email.recap.toggleError', { defaultValue: 'Could not save. Try again.' })}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(!enabled)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus:ring-2 focus:ring-amber-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? 'bg-accent' : 'bg-surface-hover'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-surface ring-1 ring-border transition-transform duration-150 ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

// ─── Step 2 – What arrives by email ──────────────────────────────────────────

/** Describes the email recap (BAA-38): one mail per person at fixed times. */
function EmailRecapStep({ hasChannel }: { hasChannel: boolean }) {
  const { t } = useTranslation();
  const rules = [
    t('integrations.email.recap.schedule', {
      defaultValue: 'One recap email at 08:00, 12:00, 16:00 and 20:00 (Paris time), only when something new happened. All your projects in one email, grouped by project and ticket.',
    }),
    t('integrations.email.recap.content', {
      defaultValue: 'It holds what your role asks for on each project, your own tickets included. Without a role: tickets you created, are assigned to or requested, and the projects you follow.',
    }),
    t('integrations.email.recap.immediate', {
      defaultValue: '@mentions arrive right away. Your own actions, including those of your API keys, never send you an email.',
    }),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StepBadge n={2} done={hasChannel} />
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
          {t('integrations.email.recap.title', { defaultValue: 'What you receive' })}
        </p>
      </div>
      <RecapToggle />
      <ul className="space-y-1.5 text-xs text-secondary list-disc pl-4">
        {rules.map((rule) => <li key={rule}>{rule}</li>)}
      </ul>
      <Link
        to="/settings"
        className="inline-block text-xs text-accent underline underline-offset-2 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
      >
        {t('integrations.email.recap.manage', { defaultValue: 'Choose the projects you follow' })}
      </Link>
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

      {/* Step 2 – What arrives */}
      <div className="border-t border-border pt-5">
        <EmailRecapStep hasChannel={Boolean(emailChannel?.verified)} />
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
