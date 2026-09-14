import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganizationList } from '@clerk/clerk-react';
import {
  Bell, CheckCircle2, AlertTriangle, Trash2,
  Link2, ExternalLink, ChevronDown, ChevronUp,
  Search, X, Plus, RefreshCw,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { TelegramIcon } from '@/components/shared/TelegramIcon';
import { useTelegramLinkVerification, telegramDestinationFingerprint } from '@/hooks/useTelegramLinkVerification';
import { Skeleton } from '@/components/shared/Skeleton';
import type {
  UserNotificationChannel,
  ProjectSubscription,
  ProjectSubscriptionStatus,
  NotificationChannel,
} from '@/lib/types';

// ─── Toggle switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
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

// ─── Channel icon ─────────────────────────────────────────────────────────────

function ChannelIcon({ channel }: { channel: NotificationChannel }) {
  if (channel === 'telegram') return <TelegramIcon size={18} />;
  const emojis: Record<NotificationChannel, string> = {
    telegram: '',
    slack: '💬',
    discord: '🎮',
    email: '✉️',
  };
  return <span className="text-base leading-none">{emojis[channel]}</span>;
}

// ─── Telegram connect panel ───────────────────────────────────────────────────

function TelegramConnectPanel({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [mode, setMode] = useState<'dm' | 'group' | 'manual'>('dm');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [botError, setBotError] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualThread, setManualThread] = useState('');
  const [manualError, setManualError] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const linkMutation = useMutation({
    mutationFn: async (kind: 'private' | 'group') => {
      const channels = await apiClient.notificationPrefs.listChannels();
      setBaseline(telegramDestinationFingerprint(channels));
      return apiClient.notificationPrefs.getTelegramLink({ kind });
    },
    onSuccess: (data, kind) => {
      setDeepLink(data.deep_link);
      setExpiresAt(data.expires_at);
      setCommand(data.command ?? null);
      setBotError(false);
      setMode(kind === 'group' ? 'group' : 'dm');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 503) {
        setBotError(true);
      }
    },
  });

  const linkExpired = useTelegramLinkVerification({
    active: Boolean(deepLink), expiresAt, baseline, onVerified: onSaved,
  });

  const handleSaveManual = async () => {
    if (!manualAddress.trim()) return;
    setSavingManual(true);
    setManualError('');
    try {
      const threadId = manualThread.trim() ? parseInt(manualThread.trim(), 10) : undefined;
      await apiClient.notificationPrefs.setChannel('telegram', manualAddress.trim(), threadId);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setManualError(t('notifPrefs.channels.invalidAddress', { defaultValue: 'Invalid address format.' }));
      } else {
        setManualError(t('notifPrefs.channels.saveError', { defaultValue: 'Could not save. Try again.' }));
      }
    } finally {
      setSavingManual(false);
    }
  };

  const handleDmLink = () => linkMutation.mutate('private');
  const handleGroupLink = () => linkMutation.mutate('group');

  return (
    <div className="mt-3 space-y-3">
      {botError && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.telegram.botUnavailable', { defaultValue: 'Telegram bot not configured on this server.' })}
        </div>
      )}

      {/* Mode selector buttons */}
      {!deepLink && !botError && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDmLink}
            disabled={linkMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black hover:bg-accent/90 disabled:opacity-50 transition-colors"
            aria-label={t('notifPrefs.channels.telegram.connectDm', { defaultValue: 'Connect via DM' })}
          >
            <Link2 size={13} />
            {t('notifPrefs.channels.telegram.connectDm', { defaultValue: 'Connect via DM' })}
          </button>
          <button
            type="button"
            onClick={handleGroupLink}
            disabled={linkMutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors"
            aria-label={t('notifPrefs.channels.telegram.connectGroup', { defaultValue: 'Connect to a group / topic' })}
          >
            {t('notifPrefs.channels.telegram.connectGroup', { defaultValue: 'Group / topic' })}
          </button>
        </div>
      )}

      {/* Deep link result */}
      {deepLink && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
          <p className="text-xs text-secondary">
            {mode === 'group'
              ? t('notifPrefs.channels.telegram.groupLinkDesc', { defaultValue: 'Add the bot to your group or topic, then click the link below.' })
              : t('notifPrefs.channels.telegram.deepLinkDesc', { defaultValue: 'Click the link below, then press Start in the Telegram app.' })}
          </p>
          <a
            href={linkExpired ? undefined : deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <ExternalLink size={13} />
            {t('notifPrefs.channels.telegram.deepLinkOpen', { defaultValue: 'Open Telegram bot' })}
          </a>
          {command && mode === 'group' && (
            <div className="rounded bg-surface-hover px-2 py-1.5 text-[11px] font-mono text-secondary">
              <span className="text-muted mr-1">{t('notifPrefs.channels.telegram.groupCommand', { defaultValue: 'Paste in group:' })}</span>
              {command}
            </div>
          )}
          {expiresAt && (
            <p className="text-[11px] text-muted">
              {t('notifPrefs.channels.telegram.deepLinkExpiry', { defaultValue: 'Link expires at' })}{' '}
              {new Date(expiresAt).toLocaleTimeString()}
            </p>
          )}
          <button
            type="button"
            onClick={() => { setDeepLink(null); setCommand(null); }}
            className="text-[11px] text-muted hover:text-secondary transition-colors"
          >
            {t('notifPrefs.channels.telegram.tryAnother', { defaultValue: 'Try another method' })}
          </button>
        </div>
      )}

      {deepLink && (
        <p role="status" className="text-xs text-muted">
          {linkExpired
            ? t('notifPrefs.channels.telegram.linkExpired', { defaultValue: 'Link expired. Choose another method to generate a new link.' })
            : t('notifPrefs.channels.telegram.waiting', { defaultValue: 'Waiting for Telegram confirmation… This page updates automatically.' })}
        </p>
      )}

      {/* Manual entry (progressive disclosure) */}
      <button
        type="button"
        onClick={() => setShowManual(!showManual)}
        className="flex items-center gap-1 text-xs text-muted hover:text-secondary transition-colors"
      >
        {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {t('notifPrefs.channels.telegram.manualTitle', { defaultValue: 'Enter chat ID manually' })}
      </button>

      {showManual && (
        <div className="space-y-2 pl-3 border-l-2 border-border">
          <p className="text-xs text-muted">
            {t('notifPrefs.channels.telegram.manualDesc', { defaultValue: 'Send a message to @userinfobot to find your numeric chat ID.' })}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder={t('notifPrefs.channels.telegram.manualPlaceholder', { defaultValue: 'e.g. 123456789' })}
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
            />
            <button
              type="button"
              onClick={handleSaveManual}
              disabled={savingManual || !manualAddress.trim()}
              className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors"
              aria-label={t('notifPrefs.channels.save', { defaultValue: 'Save' })}
            >
              {t('notifPrefs.channels.save', { defaultValue: 'Save' })}
            </button>
          </div>
          {/* Optional thread ID for topic */}
          <input
            type="text"
            value={manualThread}
            onChange={(e) => setManualThread(e.target.value)}
            placeholder={t('notifPrefs.channels.telegram.threadIdPlaceholder', { defaultValue: 'Thread ID (optional, for topics)' })}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
          />
          {manualError && <p className="text-xs text-red-400">{manualError}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Generic connect panel ────────────────────────────────────────────────────

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
        setError(t('notifPrefs.channels.invalidAddress', { defaultValue: 'Invalid address format.' }));
      } else {
        setError(t('notifPrefs.channels.saveError', { defaultValue: 'Could not save. Try again.' }));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 flex gap-2 flex-wrap">
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={t(placeholderKey as any, { defaultValue: '' })}
        className="flex-1 min-w-0 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !address.trim()}
        className="rounded-lg bg-surface-hover border border-border px-3 py-2 text-sm font-medium text-primary hover:border-accent disabled:opacity-50 transition-colors"
        aria-label={t('notifPrefs.channels.save', { defaultValue: 'Save' })}
      >
        {t('notifPrefs.channels.save', { defaultValue: 'Save' })}
      </button>
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ─── Channel row ──────────────────────────────────────────────────────────────

const SUPPORTED_CHANNELS: { key: NotificationChannel; labelKey: string; placeholderKey: string }[] = [
  { key: 'telegram', labelKey: 'notifPrefs.channels.telegram.label', placeholderKey: 'notifPrefs.channels.telegram.manualPlaceholder' },
  { key: 'slack', labelKey: 'notifPrefs.channels.slack.label', placeholderKey: 'notifPrefs.channels.slack.placeholder' },
  { key: 'discord', labelKey: 'notifPrefs.channels.discord.label', placeholderKey: 'notifPrefs.channels.discord.placeholder' },
  { key: 'email', labelKey: 'notifPrefs.channels.email.label', placeholderKey: 'notifPrefs.channels.email.placeholder' },
];

export function ChannelRow({
  config,
  existing,
  onRefresh,
  hideAddress = false,
}: {
  config: typeof SUPPORTED_CHANNELS[0];
  existing: UserNotificationChannel | undefined;
  onRefresh: () => void;
  hideAddress?: boolean;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [removing, setRemoving] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const handleRemove = async () => {
    if (!confirm(t('notifPrefs.channels.removeConfirm', { defaultValue: 'Remove this channel?' }))) return;
    setRemoving(true);
    try {
      await apiClient.notificationPrefs.removeChannel(config.key);
      onRefresh();
    } finally {
      setRemoving(false);
    }
  };

  // Unverified: allow reconnect without forcing delete
  const handleReconnect = () => {
    setShowConnect(true);
  };

  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ChannelIcon channel={config.key} />
          <span className="text-sm font-medium text-primary">
            {t(config.labelKey as any, { defaultValue: config.key })}
          </span>
        </div>

        {existing ? (
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {existing.verified ? (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-400">
                <CheckCircle2 size={10} />
                {t('notifPrefs.channels.verified', { defaultValue: 'Verified' })}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleReconnect}
                  title={t('notifPrefs.channels.unverifiedHint', { defaultValue: 'Not verified — reconnect to verify.' })}
                  className="flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                  aria-label={t('notifPrefs.channels.reconnect', { defaultValue: 'Reconnect to verify' })}
                >
                  <AlertTriangle size={10} />
                  {t('notifPrefs.channels.unverified', { defaultValue: 'Unverified' })}
                  <RefreshCw size={9} className="ml-0.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              aria-label={t('notifPrefs.channels.remove', { defaultValue: 'Remove channel' })}
              className="rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowConnect(!showConnect)}
            className="text-xs text-accent hover:underline shrink-0"
          >
            {showConnect
              ? t('notifPrefs.channels.cancel', { defaultValue: 'Cancel' })
              : t('notifPrefs.channels.connect', { defaultValue: 'Connect' })}
          </button>
        )}
      </div>

      {existing && !hideAddress && (
        <p className="mt-1.5 text-xs text-muted font-mono">{existing.address_masked}</p>
      )}

      {/* Reconnect panel for unverified */}
      {existing && !existing.verified && showConnect && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-400 mb-2">
            {t('notifPrefs.channels.reconnectDesc', { defaultValue: 'Re-link your account to verify and restore notifications.' })}
          </p>
          {config.key === 'telegram' ? (
            <TelegramConnectPanel onSaved={() => { setShowConnect(false); onRefresh(); }} />
          ) : (
            <GenericConnectPanel
              channel={config.key}
              placeholderKey={config.placeholderKey}
              onSaved={() => { setShowConnect(false); onRefresh(); }}
            />
          )}
        </div>
      )}

      {/* Connect panel for new connection */}
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

// ─── Channels section ─────────────────────────────────────────────────────────

function ChannelsSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

function ChannelsSection() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const cacheKey = [...apiClient.notificationPrefs.cacheScope, 'channels'];

  const { data: channels = [], isLoading, isError } = useQuery({
    queryKey: cacheKey,
    queryFn: () => apiClient.notificationPrefs.listChannels(),
    staleTime: 60_000,
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: cacheKey });

  const channelMap = new Map<string, UserNotificationChannel>(
    channels.map((c) => [c.channel, c]),
  );

  return (
    <div>
      <p className="text-xs text-secondary mb-3">
        {t('notifPrefs.channels.desc', { defaultValue: 'Your personal channels — used across all your projects' })}
      </p>

      {isLoading && <ChannelsSkeleton />}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={13} />
          {t('notifPrefs.channels.loadError', { defaultValue: 'Failed to load channels. Refresh to retry.' })}
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

// ─── Project multi-select (searchable, grouped by org) ───────────────────────

interface ProjectOption {
  project_id: string;
  project_name: string;
  project_slug: string;
  org_id: string;
  org_name: string;
}

function ProjectMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: ProjectOption[];
  selected: Set<string>;
  onToggle: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter(
    (o) =>
      o.project_name.toLowerCase().includes(search.toLowerCase()) ||
      o.org_name.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by org
  const groups = new Map<string, { org_name: string; projects: ProjectOption[] }>();
  for (const o of filtered) {
    if (!groups.has(o.org_id)) groups.set(o.org_id, { org_name: o.org_name, projects: [] });
    groups.get(o.org_id)!.projects.push(o);
  }

  const selectedCount = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary',
          'hover:border-accent/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        )}
        aria-label={t('notifPrefs.subscriptions.addProject', { defaultValue: 'Select projects to follow' })}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Plus size={13} className="text-muted shrink-0" />
          <span className="text-muted truncate">
            {selectedCount > 0
              ? t('notifPrefs.subscriptions.selectedCount', { defaultValue: '{{count}} project(s) followed', count: selectedCount }).replace('{{count}}', String(selectedCount))
              : t('notifPrefs.subscriptions.addProject', { defaultValue: 'Follow projects…' })}
          </span>
        </span>
        <ChevronDown size={13} className={cn('text-muted shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={t('notifPrefs.subscriptions.addProject', { defaultValue: 'Select projects to follow' })}
          className={cn(
            'absolute z-50 mt-1 w-full min-w-[260px] rounded-xl border border-border bg-surface shadow-lg',
            'max-h-72 overflow-hidden flex flex-col',
          )}
        >
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={13} className="text-muted shrink-0" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('notifPrefs.subscriptions.search', { defaultValue: 'Search projects…' })}
              className="flex-1 bg-transparent text-sm text-primary placeholder-muted outline-none"
              aria-label={t('notifPrefs.subscriptions.search', { defaultValue: 'Search projects' })}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-muted hover:text-secondary">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Options */}
          <div className="overflow-y-auto flex-1">
            {groups.size === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted">
                {t('notifPrefs.subscriptions.noResults', { defaultValue: 'No projects match.' })}
              </p>
            )}
            {Array.from(groups.entries()).map(([orgId, { org_name, projects }]) => (
              <div key={orgId}>
                <div className="sticky top-0 bg-surface px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                  {org_name}
                </div>
                {projects.map((p) => {
                  const isSelected = selected.has(p.project_id);
                  return (
                    <button
                      key={p.project_id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => onToggle(p.project_id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                        'hover:bg-surface-hover focus:outline-none focus-visible:bg-surface-hover',
                        isSelected ? 'text-primary' : 'text-secondary',
                      )}
                    >
                      <span className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        isSelected ? 'border-accent bg-accent' : 'border-border bg-transparent',
                      )}>
                        {isSelected && <CheckCircle2 size={10} className="text-black" />}
                      </span>
                      <span className="min-w-0 truncate">{p.project_name}</span>
                      <span className="ml-auto text-[11px] text-muted font-mono shrink-0">{p.project_slug}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Global notification rule ──────────────────────────────────────────────────

interface GlobalRule {
  allProjects: boolean;
  selectedProjectIds: string[];
  statuses: string[] | null; // null = All statuses
  comments: boolean;
  issueCreated: boolean;
}

function deriveRule(subs: ProjectSubscription[]): GlobalRule {
  const enabled = subs.filter((s) => s.enabled);
  if (enabled.length === 0) {
    return { allProjects: false, selectedProjectIds: [], statuses: null, comments: false, issueCreated: false };
  }
  const first = enabled[0];
  const statuses = first.notify_statuses ?? first.project_defaults.notify_statuses;
  const allKeys = first.statuses.map((s) => s.key);
  const isAll = allKeys.length === 0 || allKeys.every((k) => statuses.includes(k));
  return {
    allProjects: enabled.length === subs.length && subs.length > 0,
    selectedProjectIds: enabled.map((s) => s.project_id),
    statuses: isAll ? null : statuses,
    comments: first.notify_comments ?? first.project_defaults.notify_comments,
    issueCreated: first.notify_issue_created ?? first.project_defaults.notify_issue_created,
  };
}

// ─── Rule summary ─────────────────────────────────────────────────────────────

function RuleSummary({ rule, subs }: { rule: GlobalRule; subs: ProjectSubscription[] }) {
  const { t } = useTranslation();
  const allStatuses = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ key: string; label: string }> = [];
    for (const sub of subs) {
      for (const s of sub.statuses) {
        if (!seen.has(s.key)) { seen.add(s.key); result.push(s); }
      }
    }
    return result;
  }, [subs]);
  const active = rule.allProjects || rule.selectedProjectIds.length > 0;
  const scopeLabel = rule.allProjects
    ? t('notifPrefs.rule.allProjects', { defaultValue: 'All projects' })
    : `${rule.selectedProjectIds.length} ${t('notifPrefs.rule.projects', { defaultValue: 'project(s)' })}`;
  const statusLabel = rule.statuses === null
    ? t('notifPrefs.rule.allStatuses', { defaultValue: 'All' })
    : (rule.statuses.map((k) => allStatuses.find((s) => s.key === k)?.label ?? k).join(', ') || '—');
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-hover border border-border px-3 py-2 text-xs flex-wrap">
      <span className={cn('h-2 w-2 rounded-full shrink-0', active ? 'bg-accent' : 'bg-border')} />
      <span className={active ? 'text-primary' : 'text-muted'}>{scopeLabel}</span>
      <span className="text-muted">·</span>
      <span className="text-secondary">
        {t('notifPrefs.rule.status', { defaultValue: 'Status:' })}{' '}
        <span className={active ? 'text-primary' : 'text-muted'}>{statusLabel}</span>
      </span>
      <span className="text-muted">·</span>
      <span className="text-secondary">
        {t('notifPrefs.rule.comments', { defaultValue: 'Comments:' })}{' '}
        <span className={rule.comments ? 'text-emerald-400' : 'text-muted'}>
          {rule.comments
            ? t('notifPrefs.rule.on', { defaultValue: 'on' })
            : t('notifPrefs.rule.off', { defaultValue: 'off' })}
        </span>
      </span>
    </div>
  );
}

// ─── Status pills ─────────────────────────────────────────────────────────────

function StatusPills({
  allStatuses,
  value,
  onChange,
  disabled,
}: {
  allStatuses: ProjectSubscriptionStatus[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const isAll = value === null;

  const handleToggleAll = () => onChange(null);

  const handleToggleStatus = useCallback((key: string) => {
    if (isAll) { onChange([key]); return; }
    const current = value ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    if (next.length === 0 || (allStatuses.length > 0 && next.length === allStatuses.length)) {
      onChange(null);
    } else {
      onChange(next);
    }
  }, [isAll, value, allStatuses.length, onChange]);

  if (allStatuses.length === 0) {
    return (
      <p className="text-xs text-muted">
        {t('notifPrefs.subscriptions.noStatuses', { defaultValue: 'No statuses defined.' })}
      </p>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1.5">
        {t('notifPrefs.subscriptions.statuses', { defaultValue: 'Status transitions' })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={handleToggleAll}
          aria-pressed={isAll}
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed',
            isAll
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border bg-transparent text-muted hover:border-border hover:text-secondary',
          )}
        >
          {t('notifPrefs.rule.allPill', { defaultValue: 'All' })}
        </button>
        {allStatuses.map((status) => {
          const active = isAll || (value ?? []).includes(status.key);
          return (
            <button
              key={status.key}
              type="button"
              disabled={disabled}
              onClick={() => handleToggleStatus(status.key)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed',
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Subscriptions section ────────────────────────────────────────────────────

function SubscriptionsSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-28 rounded-lg" />
    </div>
  );
}

export function SubscriptionsSection() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const cacheKey = [...apiClient.notificationPrefs.cacheScope, 'subscriptions'];

  const { data: subs = [], isLoading, isError } = useQuery({
    queryKey: cacheKey,
    queryFn: () => apiClient.notificationPrefs.listSubscriptions(),
    staleTime: 30_000,
    retry: false,
  });

  // Must stay before early returns (Rules of Hooks)
  const { userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const orgNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of (userMemberships?.data ?? [])) {
      m.set(mem.organization.id, mem.organization.name);
    }
    return m;
  }, [userMemberships?.data]);

  const [rule, setRule] = useState<GlobalRule>({
    allProjects: false,
    selectedProjectIds: [],
    statuses: null,
    comments: false,
    issueCreated: false,
  });
  const [ruleInitialized, setRuleInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Initialize rule once from loaded subscriptions
  useEffect(() => {
    if (!ruleInitialized && subs.length > 0) {
      setRule(deriveRule(subs));
      setRuleInitialized(true);
    }
  }, [subs, ruleInitialized]);

  // All unique statuses across projects, for the pills display
  const allStatuses = useMemo(() => {
    const seen = new Set<string>();
    const result: ProjectSubscriptionStatus[] = [];
    for (const sub of subs) {
      for (const s of sub.statuses) {
        if (!seen.has(s.key)) { seen.add(s.key); result.push(s); }
      }
    }
    return result;
  }, [subs]);

  const allOptions: ProjectOption[] = subs.map((s) => ({
    project_id: s.project_id,
    project_name: s.project_name,
    project_slug: s.project_slug,
    org_id: s.org_id,
    org_name: s.org_name || orgNamesMap.get(s.org_id) || s.org_id,
  }));

  const applyRule = useCallback(async (nextRule: GlobalRule) => {
    setSaving(true);
    setSaveError(null);
    try {
      const projectsToEnable = nextRule.allProjects
        ? subs.map((s) => s.project_id)
        : nextRule.selectedProjectIds;

      // Projects that were enabled but are no longer in scope → disable
      const toDisable = !nextRule.allProjects
        ? subs
            .filter((s) => s.enabled && !nextRule.selectedProjectIds.includes(s.project_id))
            .map((s) => s.project_id)
        : [];

      await Promise.all([
        ...projectsToEnable.map((pid) => {
          const sub = subs.find((s) => s.project_id === pid);
          const projectStatusKeys = new Set((sub?.statuses ?? []).map((s) => s.key));
          // "All" pill → full project status list; specific selection → intersect with project
          const statusesToSave: string[] | null =
            nextRule.statuses === null
              ? (projectStatusKeys.size > 0 ? Array.from(projectStatusKeys) : null)
              : nextRule.statuses.filter((k) => projectStatusKeys.has(k));
          return apiClient.notificationPrefs.updateSubscription(pid, {
            enabled: true,
            notify_statuses: statusesToSave,
            notify_comments: nextRule.comments,
            notify_issue_created: nextRule.issueCreated,
          });
        }),
        ...toDisable.map((pid) =>
          apiClient.notificationPrefs.updateSubscription(pid, { enabled: false })
        ),
      ]);

      await queryClient.invalidateQueries({ queryKey: cacheKey });
    } catch {
      setSaveError(t('notifPrefs.subscriptions.saveError', { defaultValue: 'Could not save preference.' }));
    } finally {
      setSaving(false);
    }
  }, [subs, apiClient, queryClient, cacheKey, t]);

  const patchRule = useCallback((patch: Partial<GlobalRule>) => {
    setRule((prev) => {
      const next = { ...prev, ...patch };
      applyRule(next);
      return next;
    });
  }, [applyRule]);

  if (isLoading) return <SubscriptionsSkeleton />;

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        <AlertTriangle size={13} />
        {t('notifPrefs.subscriptions.loadError', { defaultValue: 'Failed to load subscriptions. Refresh to retry.' })}
      </div>
    );
  }

  if (subs.length === 0) {
    return (
      <p className="text-xs text-muted py-4 text-center">
        {t('notifPrefs.subscriptions.noProjects', { defaultValue: 'No visible projects. Create or join a project first.' })}
      </p>
    );
  }

  const selectedProjectSet = new Set(rule.selectedProjectIds);

  return (
    <div className="space-y-4">
      {/* Summary line */}
      <RuleSummary rule={rule} subs={subs} />

      {/* Rule editor */}
      <div className="rounded-lg border border-border bg-bg p-4 space-y-5">

        {/* Scope */}
        <div className="space-y-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
            {t('notifPrefs.rule.scope', { defaultValue: 'Scope' })}
          </p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-primary">
              {t('notifPrefs.rule.allProjects', { defaultValue: 'All projects' })}
            </p>
            <ToggleSwitch
              checked={rule.allProjects}
              onChange={(v) => {
                const next: GlobalRule = { ...rule, allProjects: v };
                setRule(next);
                applyRule(next);
              }}
              disabled={saving}
              aria-label={t('notifPrefs.rule.allProjects', { defaultValue: 'All projects' })}
            />
          </div>
          {!rule.allProjects && (
            <ProjectMultiSelect
              options={allOptions}
              selected={selectedProjectSet}
              onToggle={(projectId) => {
                const next = new Set(selectedProjectSet);
                if (next.has(projectId)) next.delete(projectId);
                else next.add(projectId);
                patchRule({ selectedProjectIds: Array.from(next) });
              }}
            />
          )}
        </div>

        {/* Status pills */}
        <StatusPills
          allStatuses={allStatuses}
          value={rule.statuses}
          onChange={(v) => patchRule({ statuses: v })}
          disabled={saving}
        />

        {/* Comments */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-primary">
              {t('notifPrefs.rule.commentsFromOthers', { defaultValue: 'New comments from others' })}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              {t('notifPrefs.rule.commentsHint', { defaultValue: 'Excludes your own comments and those from your API keys.' })}
            </p>
          </div>
          <ToggleSwitch
            checked={rule.comments}
            onChange={(v) => patchRule({ comments: v })}
            disabled={saving}
            aria-label={t('notifPrefs.rule.commentsFromOthers', { defaultValue: 'New comments from others' })}
          />
        </div>

        {/* Advanced: new issues */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-muted hover:text-secondary transition-colors"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {t('common.advanced', { defaultValue: 'Advanced' })}
          </button>
          {showAdvanced && (
            <div className="mt-3 pl-3 border-l-2 border-border">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-primary min-w-0">
                  {t('notifPrefs.rule.newIssuesByOthers', { defaultValue: 'New issues created by others' })}
                </p>
                <ToggleSwitch
                  checked={rule.issueCreated}
                  onChange={(v) => patchRule({ issueCreated: v })}
                  disabled={saving}
                  aria-label={t('notifPrefs.rule.newIssuesByOthers', { defaultValue: 'New issues created by others' })}
                />
              </div>
            </div>
          )}
        </div>

        {saving && (
          <p className="text-xs text-muted animate-pulse">
            {t('notifPrefs.channels.saving', { defaultValue: 'Saving…' })}
          </p>
        )}
        {saveError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertTriangle size={13} className="shrink-0" />
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
}
// ─── Main export ──────────────────────────────────────────────────────────────

export function NotificationPreferencesSection() {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bell size={20} className="text-accent shrink-0" />
        <div>
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
            {t('notifPrefs.title', { defaultValue: 'Notification Preferences' })}
          </h2>
          <p className="text-xs text-secondary mt-0.5">
            {t('notifPrefs.desc', { defaultValue: 'Manage your personal notification channels and project subscriptions' })}
          </p>
        </div>
      </div>

      {/* Destination channels */}
      <div>
        <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">
          {t('notifPrefs.channels.title', { defaultValue: 'Notification Channels' })}
        </h3>
        <ChannelsSection />
      </div>

      {/* Project subscriptions */}
      <div className="border-t border-border pt-5">
        <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">
          {t('notifPrefs.subscriptions.title', { defaultValue: 'Project Subscriptions' })}
        </h3>
        <SubscriptionsSection />
      </div>
    </div>
  );
}
