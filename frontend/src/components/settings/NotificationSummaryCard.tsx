import { useQuery } from '@tanstack/react-query';
import { AtSign, Eye, Inbox, Mail, Send } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/shared/Skeleton';
import type { NotificationRuleSource, NotificationSummaryProject } from '@/lib/types';

const CHANNEL_LABELS: Record<string, string> = { email: 'Email', telegram: 'Telegram', slack: 'Slack', discord: 'Discord' };

function pad(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * "What you receive": per project, the rules delivery will actually apply to
 * the signed-in person and why, from `/me/notification-summary`, which runs
 * the same routing as the send path. Nothing is computed here.
 */
export function NotificationSummaryCard() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const { data, isLoading, isError } = useQuery({
    queryKey: [...apiClient.notificationPrefs.cacheScope, 'summary'],
    queryFn: () => apiClient.notificationPrefs.getSummary(),
    staleTime: 15_000,
    retry: false,
  });

  const header = (
    <div className="flex items-center gap-3 px-4 md:px-6 py-4">
      <Inbox size={20} className="text-accent shrink-0" />
      <div>
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
          {t('notifSummary.title', { defaultValue: 'What you receive' })}
        </h2>
        <p className="text-xs text-secondary mt-0.5">
          {t('notifSummary.desc', { defaultValue: 'Computed by the same rules as the notifications themselves, project by project.' })}
        </p>
      </div>
    </div>
  );
  const sectionTitle = (icon: React.ReactNode, label: string) => (
    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted mb-2">
      {icon}
      {label}
    </p>
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        {header}
        <div className="border-t border-border" />
        <div className="px-4 md:px-6 py-3 space-y-2">
          <Skeleton className="h-4 w-2/3 rounded-md" />
          <Skeleton className="h-4 w-1/2 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        {header}
        <div className="border-t border-border" />
        <p role="alert" className="px-4 md:px-6 py-3 text-xs text-danger">
          {t('notifSummary.loadError', { defaultValue: 'Could not load what you receive. Reopen this page to retry.' })}
        </p>
      </div>
    );
  }

  const hours = data.email.recap_hours.map(pad).join(', ');
  const sourceLabel = (source: NotificationRuleSource | null, project: NotificationSummaryProject) => {
    switch (source) {
      case 'personal':
        return t('notifSummary.source.personal', { defaultValue: 'your setting' });
      case 'role':
        return project.role?.assigned_in === 'project'
          ? t('notifSummary.source.roleProject', { role: project.role.label, defaultValue: 'role {{role}} on this project' })
          : t('notifSummary.source.roleOrg', { role: project.role?.label ?? '', defaultValue: 'role {{role}} of the organization' });
      case 'project_default':
        return t('notifSummary.source.projectDefault', { defaultValue: 'project default, through your subscription' });
      default:
        return null;
    }
  };
  const line = (label: string, value: string, source: string | null, received: boolean) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className={cn(received ? 'text-primary' : 'text-muted')}>
        {value}
        {source && <span className="text-muted"> · {source}</span>}
      </span>
    </div>
  );
  const yes = t('notifSummary.yes', { defaultValue: 'Yes' });
  const no = t('notifSummary.no', { defaultValue: 'No' });

  return (
    <div className="rounded-xl border border-border bg-surface">
      {header}

      {/* Channels */}
      <div className="border-t border-border" />
      <div className="px-4 md:px-6 py-3 space-y-1.5">
        {sectionTitle(<Send size={11} />, t('notifSummary.channels', { defaultValue: 'Channels' }))}
        <p className="flex items-start gap-2 text-xs text-primary">
          <Mail size={13} className="text-muted mt-0.5 shrink-0" />
          {!data.email.recap_enabled ? (
            <span className="text-amber-300">
              {t('notifSummary.emailRecapOff', { defaultValue: 'Email recap turned off: no recap is sent. @mentions and your tickets reaching In Review still arrive. Turn it back on in the Email card.' })}
            </span>
          ) : data.email.address ? (
            <span>
              {t('notifSummary.emailRecap', { address: data.email.address, hours, defaultValue: 'Email recap to {{address}}, at {{hours}} (Paris time), only when something happened.' })}
              {data.email.source === 'account' && (
                <span className="text-muted"> {t('notifSummary.emailAccount', { defaultValue: '(your account email, used for roles and your own tickets)' })}</span>
              )}
            </span>
          ) : (
            <span className="text-amber-300">
              {data.email.unverified
                ? t('notifSummary.emailUnverified', { defaultValue: 'Your email address is not confirmed yet: no recap is sent until it is.' })
                : t('notifSummary.emailNone', { defaultValue: 'No usable email address: no recap is sent.' })}
            </span>
          )}
        </p>
        <p className="flex items-start gap-2 text-xs text-primary">
          <Send size={13} className="text-muted mt-0.5 shrink-0" />
          {data.telegram_connected
            ? t('notifSummary.telegramOn', { defaultValue: 'Telegram: each notification arrives right away.' })
            : <span className="text-muted">{t('notifSummary.telegramOff', { defaultValue: 'Telegram: not connected.' })}</span>}
        </p>
        <p className="flex items-start gap-2 text-xs text-primary">
          <AtSign size={13} className="text-muted mt-0.5 shrink-0" />
          {t('notifSummary.mentions', { defaultValue: '@mentions: emailed within minutes, outside the recap.' })}
        </p>
        <p className="flex items-start gap-2 text-xs text-primary">
          <Eye size={13} className="text-muted mt-0.5 shrink-0" />
          {t('notifSummary.inReview', { defaultValue: 'Your tickets reaching In Review (created or requested by you): emailed right away, outside the recap, whatever your settings.' })}
        </p>
      </div>

      {/* Projects */}
      <div className="border-t border-border" />
      <div className="px-4 md:px-6 py-3">
        {sectionTitle(<Inbox size={11} />, t('notifSummary.projects', { defaultValue: 'Projects' }))}
        {data.projects.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted">
            <Inbox size={14} />
            {t('notifSummary.noProjects', { defaultValue: 'No project yet: nothing to receive.' })}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.projects.map((p, i) => {
              const statuses = p.all_statuses
                ? t('notifSummary.allStatuses', { defaultValue: 'Every status' })
                : p.statuses.value.map((s) => s.label).join(', ');
              const nothing = !p.statuses.value.length && !p.comments.value && !p.issue_created.value && !p.own_tickets;
              return (
                <div key={p.project_id} className="py-2.5 space-y-1 animate-row-in" style={{ '--row-index': i } as React.CSSProperties}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-primary">{p.project_name}</span>
                    <span className="text-[11px] text-muted">{p.org_name}</span>
                    {p.role && p.role.defined && (
                      <span className="rounded-full px-2.5 py-1 text-[11px] bg-accent/10 text-accent">
                        {p.role.label}
                        {' · '}
                        {p.role.assigned_in === 'org'
                          ? t('notifSummary.roleFromOrg', { defaultValue: 'organization' })
                          : t('notifSummary.roleFromProject', { defaultValue: 'this project' })}
                      </span>
                    )}
                    {p.subscription === 'unsubscribed' && (
                      <span className="rounded-full px-2.5 py-1 text-[11px] bg-red-500/10 text-red-300">
                        {t('notifSummary.unsubscribed', { defaultValue: 'Unsubscribed' })}
                      </span>
                    )}
                  </div>
                  {nothing ? (
                    <p className="text-xs text-muted">{t('notifSummary.nothing', { defaultValue: 'Nothing from this project.' })}</p>
                  ) : (
                    <>
                      {line(t('notifSummary.statuses', { defaultValue: 'Statuses' }), statuses || no, sourceLabel(p.statuses.source, p), p.statuses.value.length > 0)}
                      {line(t('notifSummary.comments', { defaultValue: 'Comments' }), p.comments.value ? yes : no, sourceLabel(p.comments.source, p), p.comments.value)}
                      {line(t('notifSummary.created', { defaultValue: 'New tickets' }), p.issue_created.value ? yes : no, sourceLabel(p.issue_created.source, p), p.issue_created.value)}
                      {p.own_tickets && line(
                        t('notifSummary.ownTickets', { defaultValue: 'Your tickets' }),
                        t('notifSummary.ownTicketsValue', { defaultValue: 'Every status change and comment on tickets you created, requested or are assigned to' }),
                        null,
                        true,
                      )}
                      {line(
                        t('notifSummary.via', { defaultValue: 'Via' }),
                        [...new Set([...p.channels, ...p.own_tickets_channels])].map((c) => CHANNEL_LABELS[c] ?? c).join(', ')
                          || t('notifSummary.noChannel', { defaultValue: 'No channel can reach you' }),
                        null,
                        p.channels.length + p.own_tickets_channels.length > 0,
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
