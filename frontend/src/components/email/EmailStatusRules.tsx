import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { Skeleton } from '@/components/shared/Skeleton';
import { ApiError } from '@/lib/api';
import type { ProjectSubscription } from '@/lib/types';

export function emailStatusUpdate(sub: ProjectSubscription, key: string) {
  const selected = sub.email_notify_statuses ?? [];
  return {
    enabled: sub.enabled, // Never turn on/off this project's Telegram subscription.
    email_notify_statuses: selected.includes(key)
      ? selected.filter((s) => s !== key)
      : [...selected, key],
  };
}

/** Creator review reminders by default; additional status emails are explicit per project. */
export function EmailStatusRules() {
  const api = useApi();
  const client = useQueryClient();
  const { t } = useTranslation();
  const key = [...api.notificationPrefs.cacheScope, 'subscriptions'];
  const [error, setError] = useState('');
  const { data: subscriptions = [], isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => api.notificationPrefs.listSubscriptions(),
    staleTime: 30_000,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({ sub, status }: { sub: ProjectSubscription; status: string }) =>
      api.notificationPrefs.updateSubscription(sub.project_id, emailStatusUpdate(sub, status)),
    onMutate: () => setError(''),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t('integrations.email.rules.saveError', {
      defaultValue: 'Could not save email rules. Your previous choices are unchanged.',
    })),
  });
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-primary">{t('integrations.email.rules.creatorTitle', {
          defaultValue: 'Your tickets: ready for review',
        })}</p>
        <p className="text-xs text-secondary">{t('integrations.email.rules.creatorDesc', {
          defaultValue: 'One email when someone else moves a ticket you created to In Review. No creation confirmations or comment emails. Remove your email address to stop these reminders.',
        })}</p>
      </div>
      <div className="border-t border-border pt-3 space-y-3">
        <p className="text-xs font-medium text-primary">{t('integrations.email.rules.additional', {
          defaultValue: 'Additional status emails — optional',
        })}</p>
        <p className="text-xs text-muted">{t('integrations.email.rules.independent', {
          defaultValue: 'Off by default. Select only the project statuses you want by email. These choices do not change Telegram notifications. No emails for your own changes or your API keys’ changes.',
        })}</p>
        {isLoading && <Skeleton className="h-16 rounded-md" />}
        {isError && <p role="alert" className="text-xs text-destructive">{t('integrations.email.rules.loadError', { defaultValue: 'Could not load email rules. Try reopening this panel.' })}</p>}
        {!isLoading && !isError && subscriptions.length === 0 && <p className="text-xs text-muted">{t('integrations.email.rules.noProjects', { defaultValue: 'Join or create a project to choose additional status emails.' })}</p>}
        {subscriptions.map((sub) => (
          <div key={sub.project_id} className="border-t border-border pt-3 space-y-2">
            <p className="text-xs text-secondary">{sub.org_name} <span aria-hidden="true">/</span> <span className="font-medium text-primary">{sub.project_name}</span></p>
            {sub.email_notify_statuses === undefined ? (
              <p className="text-xs text-muted">{t('integrations.email.rules.backendPending', { defaultValue: 'Email-specific rules are not available on this API revision yet.' })}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sub.statuses.map((status) => {
                  const selected = sub.email_notify_statuses?.includes(status.key) ?? false;
                  return <button key={status.key} type="button" aria-pressed={selected}
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ sub, status: status.key })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors active:scale-[0.98] focus:ring-2 focus:ring-accent/30 disabled:opacity-50 disabled:cursor-not-allowed ${selected ? 'border-accent bg-accent/10 text-accent' : 'border-border text-secondary hover:bg-surface-hover'}`}>
                    {status.label}
                  </button>;
                })}
              </div>
            )}
          </div>
        ))}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
