import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, CheckCircle2, AlertTriangle, Loader2, Trash2,
  Link2, ExternalLink, ChevronDown, ChevronUp, Settings2,
  RotateCcw,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import type {
  UserNotificationChannel,
  ProjectSubscription,
  NotificationChannel,
} from '@/lib/types';

// ─── Local ToggleSwitch (same pattern as Automations.tsx) ─────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-hover',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ─── Channels Section ─────────────────────────────────────────────────────────

const SUPPORTED_CHANNELS: { key: NotificationChannel; labelKey: string; placeholderKey: string }[] = [
  { key: 'telegram', labelKey: 'notifPrefs.channels.telegram.label', placeholderKey: 'notifPrefs.channels.telegram.manualPlaceholder' },
  { key: 'slack', labelKey: 'notifPrefs.channels.slack.label', placeholderKey: 'notifPrefs.channels.slack.placeholder' },
  { key: 'discord', labelKey: 'notifPrefs.channels.discord.label', placeholderKey: 'notifPrefs.channels.discord.placeholder' },
  { key: 'email', labelKey: 'notifPrefs.channels.email.label', placeholderKey: 'notifPrefs.channels.email.placeholder' },
];

function ChannelIcon({ channel }: { channel: NotificationChannel }) {
  const emojis: Record<NotificationChannel, string> = {
    telegram: '✈️',
    slack: '💬',
    discord: '🎮',
    email: '✉️',
  };
  return <span className="text-base leading-none">{emojis[channel]}</span>;
}

function TelegramConnectPanel({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [botError, setBotError] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualError, setManualError] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const linkMutation = useMutation({
    mutationFn: () => apiClient.notificationPrefs.getTelegramLink(),
    onSuccess: (data) => {
      setDeepLink(data.deep_link);
      setExpiresAt(data.expires_at);
      setBotError(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 503) {
        setBotError(true);
      }
    },
  });

  const handleSaveManual = async () => {
    if (!manualAddress.trim()) return;
    setSavingManual(true);
    setManualError('');
    try {
      await apiClient.notificationPrefs.setChannel('telegram', manualAddress.trim());
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setManualError(t('notifPrefs.channels.invalidAddress'));
      } else {
        setManualError(t('notifPrefs.channels.saveError'));
      }
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {/* Option A: bot deep link */}
      {!deepLink && !botError && (
        <button
          type="button"
          onClick={() => linkMutation.mutate()}
          disabled={linkMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {linkMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Link2 size={14} />
          )}
          {t('notifPrefs.channels.telegram.connectBtn')}
        </button>
      )}

      {botError && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.telegram.botUnavailable')}
        </div>
      )}

      {deepLink && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
          <p className="text-xs text-secondary">{t('notifPrefs.channels.telegram.deepLinkDesc')}</p>
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <ExternalLink size={13} />
            {t('notifPrefs.channels.telegram.deepLinkOpen')}
          </a>
          {expiresAt && (
            <p className="text-[11px] text-muted">
              {t('notifPrefs.channels.telegram.deepLinkExpiry')}{' '}
              {new Date(expiresAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {/* Option B: manual chat_id */}
      <button
        type="button"
        onClick={() => setShowManual(!showManual)}
        className="flex items-center gap-1 text-xs text-muted hover:text-secondary transition-colors"
      >
        {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {t('notifPrefs.channels.telegram.manualTitle')}
      </button>

      {showManual && (
        <div className="space-y-2 pl-3 border-l-2 border-border">
          <p className="text-xs text-muted">{t('notifPrefs.channels.telegram.manualDesc')}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder={t('notifPrefs.channels.telegram.manualPlaceholder')}
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
            />
            <button
              type="button"
              onClick={handleSaveManual}
              disabled={savingManual || !manualAddress.trim()}
              className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors"
            >
              {savingManual ? <Loader2 size={14} className="animate-spin" /> : t('notifPrefs.channels.save')}
            </button>
          </div>
          {manualError && (
            <p className="text-xs text-red-400">{manualError}</p>
          )}
        </div>
      )}
    </div>
  );
}

function GenericConnectPanel({
  channel,
  placeholderKey,
  onSaved,
}: {
  channel: NotificationChannel;
  placeholderKey: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!address.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.notificationPrefs.setChannel(channel, address.trim());
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(t('notifPrefs.channels.invalidAddress'));
      } else {
        setError(t('notifPrefs.channels.saveError'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 flex gap-2">
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={t(placeholderKey as any)}
        className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !address.trim()}
        className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : t('notifPrefs.channels.save')}
      </button>
      {error && <p className="text-xs text-red-400 self-center">{error}</p>}
    </div>
  );
}

export function ChannelRow({
  config,
  existing,
  onRefresh,
}: {
  config: typeof SUPPORTED_CHANNELS[0];
  existing: UserNotificationChannel | undefined;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [removing, setRemoving] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const handleRemove = async () => {
    if (!confirm(t('notifPrefs.channels.removeConfirm'))) return;
    setRemoving(true);
    try {
      await apiClient.notificationPrefs.removeChannel(config.key);
      onRefresh();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ChannelIcon channel={config.key} />
          <span className="text-sm font-medium text-primary">{t(config.labelKey as any)}</span>
        </div>
        {existing ? (
          <div className="flex items-center gap-2 shrink-0">
            {existing.verified ? (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-400">
                <CheckCircle2 size={10} />
                {t('notifPrefs.channels.verified')}
              </span>
            ) : (
              <span
                title={t('notifPrefs.channels.unverifiedHint')}
                className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 cursor-help"
              >
                <AlertTriangle size={10} />
                {t('notifPrefs.channels.unverified')}
              </span>
            )}
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConnect(!showConnect)}
            className="text-xs text-accent hover:underline shrink-0"
          >
            {showConnect ? t('notifPrefs.channels.cancel') : t('notifPrefs.channels.connect')}
          </button>
        )}
      </div>

      {existing && (
        <p className="mt-1.5 text-xs text-muted font-mono">{existing.address_masked}</p>
      )}

      {!existing && showConnect && (
        config.key === 'telegram' ? (
          <TelegramConnectPanel onSaved={() => { setShowConnect(false); onRefresh(); }} />
        ) : (
          <GenericConnectPanel
            channel={config.key}
            placeholderKey={config.placeholderKey}
            onSaved={() => { setShowConnect(false); onRefresh(); }}
          />
        )
      )}
    </div>
  );
}

function ChannelsSection() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const { data: channels = [], isLoading, isError } = useQuery({
    queryKey: ['me-notification-channels'],
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['me-notification-channels'] });
  };

  const channelMap = new Map<string, UserNotificationChannel>(
    channels.map((c) => [c.channel, c]),
  );

  return (
    <div>
      <p className="text-xs text-secondary mb-3">{t('notifPrefs.channels.desc')}</p>

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" />
          {t('notifPrefs.loading')}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.loadError')}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-2">
          {SUPPORTED_CHANNELS.map((cfg) => (
            <ChannelRow
              key={cfg.key}
              config={cfg}
              existing={channelMap.get(cfg.key)}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inherit-or-Custom field ──────────────────────────────────────────────────

/**
 * Renders the "inherit vs explicit" control for one nullable setting.
 *
 * Design rationale:
 * - null = follow the project default (shown grayed out with the current default value)
 * - non-null = pinned to your explicit choice
 *
 * The user sees:
 *   "Suivre le projet (valeur actuelle: Oui)"  [Personnaliser]
 * or, once personalized:
 *   [toggle/buttons]  [Réinitialiser vers le projet]
 *
 * This way the user can never confuse "I chose this" vs "the project chose this".
 */
function InheritOrCustomToggle({
  label,
  desc,
  value,
  defaultValue,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  value: boolean | null;
  defaultValue: boolean;
  onChange: (v: boolean | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const isInherited = value === null;
  const effective = isInherited ? defaultValue : value;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-primary">{label}</p>
        <p className="text-xs text-muted">{desc}</p>
        {isInherited && (
          <p className="text-[11px] text-muted mt-0.5">
            {t('notifPrefs.subscriptions.inheritedFrom')}{' '}
            <span className={cn('font-medium', effective ? 'text-green-400' : 'text-secondary')}>
              {effective
                ? t('notifPrefs.subscriptions.inheritedOn')
                : t('notifPrefs.subscriptions.inheritedOff')}
            </span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isInherited ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(defaultValue)}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-primary hover:border-accent transition-colors disabled:opacity-50"
          >
            <Settings2 size={10} />
            {t('notifPrefs.subscriptions.customize')}
          </button>
        ) : (
          <>
            <ToggleSwitch
              checked={value as boolean}
              onChange={(v) => onChange(v)}
              disabled={disabled}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(null)}
              title={t('notifPrefs.subscriptions.resetToProject')}
              className="rounded p-1 text-muted hover:text-secondary transition-colors disabled:opacity-50"
            >
              <RotateCcw size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function InheritOrCustomStatuses({
  value,
  defaultValue,
  statuses,
  onChange,
  disabled,
}: {
  value: string[] | null;
  defaultValue: string[];
  statuses: Array<{ key: string; label: string; color: string }>;
  onChange: (v: string[] | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const isInherited = value === null;
  const effective = isInherited ? defaultValue : value;

  const handleToggleStatus = (key: string) => {
    const current = effective;
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-secondary uppercase tracking-wider">
          {t('notifPrefs.subscriptions.statuses')}
        </p>
        {isInherited ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted italic">{t('notifPrefs.subscriptions.inheritLabel')}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange([...defaultValue])}
              className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-primary hover:border-accent transition-colors disabled:opacity-50"
            >
              <Settings2 size={10} />
              {t('notifPrefs.subscriptions.customize')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="flex items-center gap-1 text-[11px] text-muted hover:text-secondary transition-colors disabled:opacity-50"
          >
            <RotateCcw size={10} />
            {t('notifPrefs.subscriptions.resetToProject')}
          </button>
        )}
      </div>

      <div className={cn('flex flex-wrap gap-1.5', isInherited && 'opacity-50 pointer-events-none')}>
        {statuses.length === 0 && (
          <p className="text-xs text-muted">{t('notifPrefs.subscriptions.noStatuses')}</p>
        )}
        {statuses.map((status) => {
          const active = effective.includes(status.key);
          return (
            <button
              key={status.key}
              type="button"
              disabled={disabled || isInherited}
              onClick={() => handleToggleStatus(status.key)}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all',
                'disabled:cursor-not-allowed',
                active
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-transparent text-muted hover:border-border hover:text-secondary',
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: active ? (status.color || '#64748b') : '#64748b' }}
              />
              {status.label}
              {active && <CheckCircle2 size={10} className="text-accent ml-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Project Subscription Row ─────────────────────────────────────────────────

function ProjectSubscriptionRow({
  sub,
  onUpdate,
}: {
  sub: ProjectSubscription;
  onUpdate: (projectId: string, patch: Partial<ProjectSubscription>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggleEnabled = async () => {
    setSaving(true);
    setError(null);
    try {
      await onUpdate(sub.project_id, { enabled: !sub.enabled });
      if (!sub.enabled) setExpanded(true); // auto-expand when subscribing
    } catch {
      setError(t('notifPrefs.subscriptions.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handlePatch = async (patch: Partial<{
    notify_statuses: string[] | null;
    notify_comments: boolean | null;
    notify_issue_created: boolean | null;
  }>) => {
    setSaving(true);
    setError(null);
    try {
      await onUpdate(sub.project_id, patch);
    } catch {
      setError(t('notifPrefs.subscriptions.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      sub.enabled ? 'border-border bg-bg' : 'border-border/50 bg-bg/50',
    )}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ToggleSwitch
          checked={sub.enabled}
          onChange={handleToggleEnabled}
          disabled={saving}
        />
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium truncate', sub.enabled ? 'text-primary' : 'text-muted')}>
            {sub.project_name}
          </p>
          <p className="text-[11px] text-muted">{sub.project_slug}</p>
        </div>
        {sub.enabled && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-muted hover:text-secondary transition-colors p-1"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        {saving && <Loader2 size={13} className="animate-spin text-muted shrink-0" />}
      </div>

      {/* Expanded settings — only when subscribed */}
      {sub.enabled && expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* Statuses */}
          <InheritOrCustomStatuses
            value={sub.notify_statuses}
            defaultValue={sub.project_defaults.notify_statuses}
            statuses={sub.statuses}
            onChange={(v) => handlePatch({ notify_statuses: v })}
            disabled={saving}
          />

          <div className="border-t border-border/50 pt-3 space-y-3">
            {/* notify_comments */}
            <InheritOrCustomToggle
              label={t('notifPrefs.subscriptions.comments')}
              desc={t('notifPrefs.subscriptions.commentsDesc')}
              value={sub.notify_comments}
              defaultValue={sub.project_defaults.notify_comments}
              onChange={(v) => handlePatch({ notify_comments: v })}
              disabled={saving}
            />

            {/* notify_issue_created */}
            <InheritOrCustomToggle
              label={t('notifPrefs.subscriptions.issueCreated')}
              desc={t('notifPrefs.subscriptions.issueCreatedDesc')}
              value={sub.notify_issue_created}
              defaultValue={sub.project_defaults.notify_issue_created}
              onChange={(v) => handlePatch({ notify_issue_created: v })}
              disabled={saving}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              <AlertTriangle size={13} className="shrink-0" />
              {error}
            </div>
          )}
        </div>
      )}

      {error && !expanded && (
        <div className="px-4 pb-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

// ─── Subscriptions Section ────────────────────────────────────────────────────

export function SubscriptionsSection() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const { data: subs = [], isLoading, isError } = useQuery({
    queryKey: ['me-project-subscriptions'],
    queryFn: () => apiClient.notificationPrefs.listSubscriptions(),
    staleTime: 30_000,
    retry: false,
  });

  const handleUpdate = async (
    projectId: string,
    patch: Partial<ProjectSubscription>,
  ) => {
    // Build the API body from the patch
    const body: Record<string, unknown> = {};
    if ('enabled' in patch) body.enabled = patch.enabled;
    if ('notify_statuses' in patch) body.notify_statuses = patch.notify_statuses;
    if ('notify_comments' in patch) body.notify_comments = patch.notify_comments;
    if ('notify_issue_created' in patch) body.notify_issue_created = patch.notify_issue_created;

    const updated = await apiClient.notificationPrefs.updateSubscription(projectId, body);

    // Optimistic update in cache
    queryClient.setQueryData<ProjectSubscription[]>(
      ['me-project-subscriptions'],
      (old) =>
        old?.map((s) => (s.project_id === projectId ? updated : s)) ?? [],
    );
  };

  // Group by org_id
  const byOrg = new Map<string, ProjectSubscription[]>();
  for (const sub of subs) {
    const arr = byOrg.get(sub.org_id) ?? [];
    arr.push(sub);
    byOrg.set(sub.org_id, arr);
  }
  const multiOrg = byOrg.size > 1;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        {t('notifPrefs.loading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        <AlertTriangle size={13} />
        {t('notifPrefs.subscriptions.loadError')}
      </div>
    );
  }

  if (subs.length === 0) {
    return (
      <p className="text-xs text-muted py-4 text-center">
        {t('notifPrefs.subscriptions.noProjects')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-secondary">{t('notifPrefs.subscriptions.desc')}</p>

      {Array.from(byOrg.entries()).map(([orgId, projects]) => (
        <div key={orgId}>
          {multiOrg && (
            <p className="text-[11px] text-muted uppercase tracking-wider mb-2 font-medium">
              {orgId}
            </p>
          )}
          <div className="space-y-2">
            {projects.map((sub) => (
              <ProjectSubscriptionRow
                key={sub.project_id}
                sub={sub}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function NotificationPreferencesSection() {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <Bell size={20} className="text-accent shrink-0" />
        <div>
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
            {t('notifPrefs.title')}
          </h2>
          <p className="text-xs text-secondary mt-0.5">
            {t('notifPrefs.desc')}
          </p>
        </div>
      </div>

      {/* Channels */}
      <div>
        <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">
          {t('notifPrefs.channels.title')}
        </h3>
        <ChannelsSection />
      </div>

      {/* Project subscriptions */}
      <div className="border-t border-border pt-5">
        <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">
          {t('notifPrefs.subscriptions.title')}
        </h3>
        <SubscriptionsSection />
      </div>
    </div>
  );
}
