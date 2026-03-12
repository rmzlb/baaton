import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotificationStore } from '@/stores/notifications';
import { cn, timeAgo } from '@/lib/utils';
import {
  Bot, Clock, Shield, Mail, BarChart3, Zap, Lock, Activity,
  Loader2, ChevronDown, AlertCircle, CheckCircle2, Crown, ArrowRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Project } from '@/lib/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentConfig {
  id: string;
  org_id: string;
  user_id: string;
  agent_name: string;
  heartbeat_enabled: boolean;
  heartbeat_cron: string | null;
  auto_triage_enabled: boolean;
  auto_triage_cron: string | null;
  auto_triage_auto_apply: boolean;
  email_recap_enabled: boolean;
  email_recap_cron: string | null;
  email_recap_to: string | null;
  analytics_digest_enabled: boolean;
  analytics_digest_cron: string | null;
  suggest_automations: boolean;
  allowed_project_ids: string[];
  max_actions_per_run: number;
  require_approval: boolean;
  last_heartbeat_at: string | null;
  last_triage_at: string | null;
  last_recap_at: string | null;
}

type ConfigPatch = Partial<Omit<AgentConfig, 'id' | 'org_id' | 'user_id'>>;

// ─── Constants ──────────────────────────────────────────────────────────────

const CRON_PRESETS_KEYS = [
  { labelKey: 'agentConfig.cron.preset.weekdays9am', cron: '0 9 * * 1-5' },
  { labelKey: 'agentConfig.cron.preset.monday9am',   cron: '0 9 * * 1'   },
  { labelKey: 'agentConfig.cron.preset.daily8am',    cron: '0 8 * * *'   },
  { labelKey: 'agentConfig.cron.preset.friday6pm',   cron: '0 18 * * 5'  },
] as const;

const DEFAULT_CONFIG: AgentConfig = {
  id: '',
  org_id: '',
  user_id: '',
  agent_name: '',
  heartbeat_enabled: false,
  heartbeat_cron: null,
  auto_triage_enabled: false,
  auto_triage_cron: null,
  auto_triage_auto_apply: false,
  email_recap_enabled: false,
  email_recap_cron: null,
  email_recap_to: null,
  analytics_digest_enabled: false,
  analytics_digest_cron: null,
  suggest_automations: false,
  allowed_project_ids: [],
  max_actions_per_run: 10,
  require_approval: true,
  last_heartbeat_at: null,
  last_triage_at: null,
  last_recap_at: null,
};

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Accessible toggle switch */
function Toggle({
  checked,
  onChange,
  disabled,
  size = 'md',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-offset-1 focus:ring-offset-surface',
        size === 'md' ? 'h-6 w-11' : 'h-5 w-9',
        checked ? 'bg-accent' : 'bg-surface-hover border-border',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200',
          size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
          size === 'md'
            ? checked ? 'translate-x-5' : 'translate-x-0'
            : checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

/** Section card wrapper */
function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
  iconColor = 'text-accent',
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  iconColor?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover', iconColor)}>
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/** Cron preset selector — dropdown + optional custom input */
function CronSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const presets = CRON_PRESETS_KEYS.map(p => ({
    label: t(p.labelKey as any),
    cron: p.cron,
  }));

  const matchedPreset = presets.find(p => p.cron === value);
  const [selectVal, setSelectVal] = useState<string>(
    matchedPreset ? matchedPreset.cron : value !== null ? '__custom__' : presets[0].cron,
  );
  const [customVal, setCustomVal] = useState<string>(
    !matchedPreset && value !== null ? (value || '') : '',
  );

  // Sync external value changes (e.g., after server load)
  useEffect(() => {
    const match = presets.find(p => p.cron === value);
    if (match) {
      setSelectVal(match.cron);
    } else if (value !== null) {
      setSelectVal('__custom__');
      setCustomVal(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleSelect = (v: string) => {
    setSelectVal(v);
    if (v === '__custom__') {
      onChange(customVal || null);
    } else {
      onChange(v);
    }
  };

  const handleCustomInput = (v: string) => {
    setCustomVal(v);
    onChange(v || null);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <select
          value={selectVal}
          onChange={e => handleSelect(e.target.value)}
          disabled={disabled}
          className={cn(
            'w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-primary',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          {presets.map(p => (
            <option key={p.cron} value={p.cron}>{p.label}</option>
          ))}
          <option value="__custom__">{t('agentConfig.cron.custom')}</option>
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      {selectVal === '__custom__' && (
        <input
          type="text"
          value={customVal}
          onChange={e => handleCustomInput(e.target.value)}
          placeholder={t('agentConfig.cron.placeholder')}
          disabled={disabled}
          className={cn(
            'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-primary',
            'placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        />
      )}
    </div>
  );
}

/** Toggle row — label, description, and a toggle on the right */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  size = 'md',
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium text-primary', size === 'sm' && 'text-xs')}>{label}</p>
        {description && (
          <p className={cn('text-muted mt-0.5', size === 'sm' ? 'text-[11px]' : 'text-xs')}>{description}</p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} size={size} />
    </div>
  );
}

/** Scheduled task card — toggle header + collapsible cron config */
function TaskCard({
  icon: Icon,
  iconColor,
  label,
  description,
  enabled,
  cronValue,
  onToggleEnabled,
  onCronChange,
  disabled,
  children,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  description: string;
  enabled: boolean;
  cronValue: string | null;
  onToggleEnabled: (v: boolean) => void;
  onCronChange: (v: string | null) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        enabled ? 'border-accent/30 bg-accent/5' : 'border-border bg-background',
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        <div className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          enabled ? `${iconColor} bg-current/10` : 'bg-surface-hover text-muted',
        )}>
          <Icon size={17} className={enabled ? 'text-current' : 'text-muted'} style={enabled ? undefined : undefined} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-primary">{label}</p>
          <p className="text-xs text-muted mt-0.5">{description}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggleEnabled} disabled={disabled} />
      </div>

      {/* Collapsible config */}
      {enabled && (
        <div className="border-t border-border/50 px-4 pb-4 pt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              {t('agentConfig.cron.label')}
            </label>
            <CronSelect
              value={cronValue}
              onChange={onCronChange}
              disabled={disabled}
            />
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentConfig() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const addNotification = useNotificationStore(s => s.addNotification);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form state (local copy of config)
  const [form, setForm] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [initialized, setInitialized] = useState(false);

  // ─── Check plan (Agent Config = Pro+ feature) ────────────────────────────
  const { data: billingData } = useQuery({
    queryKey: ['billing'],
    queryFn: () => apiClient.billing.get(),
    staleTime: 300_000,
  });
  const userPlan = (billingData as any)?.plan || 'free';
  const isPro = userPlan === 'pro' || userPlan === 'enterprise';

  // ─── Fetch config ────────────────────────────────────────────────────────
  const { data: configData, isLoading: configLoading, isError } = useQuery({
    queryKey: ['agent-config'],
    queryFn: () => apiClient.agentConfig.get(),
    retry: false,
  });

  // Fetch projects for allowed_project_ids multi-select
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Sync server data → local state (once on load)
  useEffect(() => {
    if (configData && !initialized) {
      setForm(configData);
      setInitialized(true);
    }
  }, [configData, initialized]);

  // ─── Mutation ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (patch: ConfigPatch) =>
      apiClient.agentConfig.update(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['agent-config'], updated);
      addNotification({
        type: 'success',
        title: t('agentConfig.saved'),
        message: '',
      });
    },
    onError: () => {
      addNotification({
        type: 'warning',
        title: t('agentConfig.saveError'),
        message: '',
      });
    },
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Immediate save (for toggles) */
  const saveImmediate = useCallback(
    (patch: ConfigPatch) => {
      saveMutation.mutate(patch);
    },
    [saveMutation],
  );

  /** Debounced save (for text inputs, 800ms) */
  const saveDebounced = useCallback(
    (patch: ConfigPatch) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        saveMutation.mutate(patch);
      }, 800);
    },
    [saveMutation],
  );

  /** Toggle field handler — updates local state + saves immediately */
  const handleToggle = useCallback(
    (field: keyof AgentConfig, value: boolean) => {
      setForm(prev => ({ ...prev, [field]: value }));
      saveImmediate({ [field]: value } as ConfigPatch);
    },
    [saveImmediate],
  );

  /** Text/number field handler — updates local state + debounced save */
  const handleField = useCallback(
    (field: keyof AgentConfig, value: string | number | null) => {
      setForm(prev => ({ ...prev, [field]: value }));
      saveDebounced({ [field]: value } as ConfigPatch);
    },
    [saveDebounced],
  );

  /** Cron field handler */
  const handleCron = useCallback(
    (field: keyof AgentConfig, value: string | null) => {
      setForm(prev => ({ ...prev, [field]: value }));
      saveDebounced({ [field]: value } as ConfigPatch);
    },
    [saveDebounced],
  );

  /** Toggle project in allowed_project_ids */
  const handleProjectToggle = useCallback(
    (projectId: string, checked: boolean) => {
      setForm(prev => {
        const ids = prev.allowed_project_ids ?? [];
        const next = checked
          ? [...ids, projectId]
          : ids.filter(id => id !== projectId);
        saveImmediate({ allowed_project_ids: next });
        return { ...prev, allowed_project_ids: next };
      });
    },
    [saveImmediate],
  );

  // ─── Loading & Error states ───────────────────────────────────────────────

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 md:p-6 max-w-4xl">
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertCircle size={16} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">{t('agentConfig.loadError')}</p>
        </div>
      </div>
    );
  }

  const isSaving = saveMutation.isPending;

  // ─── Pro plan gate (show upgrade CTA for free users) ───────────────────
  const showProGate = !isPro;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-4xl">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary mb-1">
            {t('agentConfig.title')}
          </h1>
          <p className="text-sm text-muted">{t('agentConfig.subtitle')}</p>
        </div>
        {isSaving && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted shrink-0">
            <Loader2 size={12} className="animate-spin" />
            {t('agentConfig.saving')}
          </div>
        )}
      </div>

      {/* ── Pro plan gate ─────────────────────────────────────────────── */}
      {showProGate && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-accent/5 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 shrink-0">
              <Crown size={24} className="text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-primary mb-1">{t('agentConfig.proRequired')}</h3>
              <p className="text-sm text-secondary mb-4">{t('agentConfig.proDescription')}</p>
              <Link
                to="/billing"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent/90 transition-colors"
              >
                {t('agentConfig.upgradeToPro')}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className={showProGate ? 'opacity-40 pointer-events-none select-none' : 'space-y-6'}>

        {/* ── Section 1: Agent Identity ──────────────────────────────────── */}
        <SectionCard
          icon={Bot}
          iconColor="text-accent"
          title={t('agentConfig.identity.title')}
        >
          <div className="space-y-5">
            {/* Agent Name */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                {t('agentConfig.identity.name')}
              </label>
              <input
                type="text"
                value={form.agent_name}
                onChange={e => handleField('agent_name', e.target.value)}
                placeholder={t('agentConfig.identity.namePlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
              />
            </div>

            {/* Heartbeat Status */}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-hover px-4 py-3">
              <Activity size={16} className="text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-secondary">
                  {t('agentConfig.identity.lastHeartbeat')}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {form.last_heartbeat_at
                    ? timeAgo(form.last_heartbeat_at)
                    : t('agentConfig.identity.neverSeen')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {form.last_heartbeat_at ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[11px] text-green-400 font-medium">
                      {t('agentConfig.identity.online')}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-muted" />
                    <span className="text-[11px] text-muted font-medium">
                      {t('agentConfig.identity.offline')}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Section 2: Scheduled Tasks ─────────────────────────────────── */}
        <SectionCard
          icon={Clock}
          iconColor="text-blue-400"
          title={t('agentConfig.scheduled.title')}
          subtitle={t('agentConfig.scheduled.subtitle')}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Heartbeat */}
            <TaskCard
              icon={Zap}
              iconColor="text-green-400"
              label={t('agentConfig.heartbeat.label')}
              description={t('agentConfig.heartbeat.description')}
              enabled={form.heartbeat_enabled}
              cronValue={form.heartbeat_cron}
              onToggleEnabled={v => handleToggle('heartbeat_enabled', v)}
              onCronChange={v => handleCron('heartbeat_cron', v)}
              disabled={isSaving}
            />

            {/* Auto-Triage */}
            <TaskCard
              icon={BarChart3}
              iconColor="text-purple-400"
              label={t('agentConfig.triage.label')}
              description={t('agentConfig.triage.description')}
              enabled={form.auto_triage_enabled}
              cronValue={form.auto_triage_cron}
              onToggleEnabled={v => handleToggle('auto_triage_enabled', v)}
              onCronChange={v => handleCron('auto_triage_cron', v)}
              disabled={isSaving}
            >
              {/* Auto-apply sub-toggle */}
              <div className="rounded-lg border border-border/50 bg-surface/60 px-3 py-2.5">
                <ToggleRow
                  label={t('agentConfig.triage.autoApply')}
                  description={t('agentConfig.triage.autoApplyDesc')}
                  checked={form.auto_triage_auto_apply}
                  onChange={v => handleToggle('auto_triage_auto_apply', v)}
                  disabled={isSaving}
                  size="sm"
                />
              </div>
            </TaskCard>

            {/* Email Recap */}
            <TaskCard
              icon={Mail}
              iconColor="text-amber-400"
              label={t('agentConfig.recap.label')}
              description={t('agentConfig.recap.description')}
              enabled={form.email_recap_enabled}
              cronValue={form.email_recap_cron}
              onToggleEnabled={v => handleToggle('email_recap_enabled', v)}
              onCronChange={v => handleCron('email_recap_cron', v)}
              disabled={isSaving}
            >
              {/* Email recipient */}
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  {t('agentConfig.recap.emailTo')}
                </label>
                <input
                  type="email"
                  value={form.email_recap_to || ''}
                  onChange={e => handleField('email_recap_to', e.target.value || null)}
                  placeholder={t('agentConfig.recap.emailPlaceholder')}
                  disabled={isSaving}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
              </div>
            </TaskCard>

            {/* Analytics Digest */}
            <TaskCard
              icon={BarChart3}
              iconColor="text-cyan-400"
              label={t('agentConfig.digest.label')}
              description={t('agentConfig.digest.description')}
              enabled={form.analytics_digest_enabled}
              cronValue={form.analytics_digest_cron}
              onToggleEnabled={v => handleToggle('analytics_digest_enabled', v)}
              onCronChange={v => handleCron('analytics_digest_cron', v)}
              disabled={isSaving}
            />

          </div>
        </SectionCard>

        {/* ── Section 3: AI Behaviors ────────────────────────────────────── */}
        <SectionCard
          icon={Zap}
          iconColor="text-purple-400"
          title={t('agentConfig.behaviors.title')}
          subtitle={t('agentConfig.behaviors.subtitle')}
        >
          <ToggleRow
            label={t('agentConfig.suggest.label')}
            description={t('agentConfig.suggest.description')}
            checked={form.suggest_automations}
            onChange={v => handleToggle('suggest_automations', v)}
            disabled={isSaving}
          />
        </SectionCard>

        {/* ── Section 4: Security & Guardrails ──────────────────────────── */}
        <SectionCard
          icon={Shield}
          iconColor="text-red-400"
          title={t('agentConfig.security.title')}
          subtitle={t('agentConfig.security.subtitle')}
        >
          <div className="space-y-6">

            {/* Require Approval */}
            <ToggleRow
              label={t('agentConfig.approval.label')}
              description={t('agentConfig.approval.description')}
              checked={form.require_approval}
              onChange={v => handleToggle('require_approval', v)}
              disabled={isSaving}
            />

            <div className="border-t border-border" />

            {/* Max Actions Per Run */}
            <div>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-medium text-primary">
                    {t('agentConfig.maxActions.label')}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {t('agentConfig.maxActions.description')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.max_actions_per_run}
                    onChange={e => {
                      const v = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1));
                      handleField('max_actions_per_run', v);
                    }}
                    disabled={isSaving}
                    className="w-20 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-right text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                  />
                  <span className="text-xs text-muted whitespace-nowrap">/ run</span>
                </div>
              </div>
              {/* Range slider for visual feedback */}
              <input
                type="range"
                min={1}
                max={100}
                value={form.max_actions_per_run}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  handleField('max_actions_per_run', v);
                }}
                disabled={isSaving}
                className="w-full accent-accent disabled:opacity-50"
              />
              <div className="flex justify-between text-[10px] text-muted mt-1">
                <span>1</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Allowed Projects */}
            <div>
              <div className="mb-3">
                <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                  <Lock size={14} className="text-muted" />
                  {t('agentConfig.allowedProjects.label')}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {t('agentConfig.allowedProjects.description')}
                </p>
              </div>

              {projects.length === 0 ? (
                <p className="text-xs text-muted italic">
                  {t('agentConfig.allowedProjects.noProjects')}
                </p>
              ) : (
                <div className="space-y-2">
                  {/* "All projects" toggle — clear selection */}
                  <label className="flex items-center gap-3 cursor-pointer rounded-lg border border-border bg-background px-3 py-2.5 hover:bg-surface-hover transition-colors">
                    <input
                      type="checkbox"
                      checked={form.allowed_project_ids.length === 0}
                      onChange={e => {
                        if (e.target.checked) {
                          setForm(prev => ({ ...prev, allowed_project_ids: [] }));
                          saveImmediate({ allowed_project_ids: [] });
                        }
                      }}
                      className="h-4 w-4 rounded border-border accent-accent"
                    />
                    <span className="text-sm font-medium text-primary flex-1">
                      {t('agentConfig.allowedProjects.allProjects')}
                    </span>
                    {form.allowed_project_ids.length === 0 && (
                      <CheckCircle2 size={14} className="text-accent shrink-0" />
                    )}
                  </label>

                  {/* Individual projects */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                    {projects.map((project: Project) => {
                      const isChecked = form.allowed_project_ids.includes(project.id);
                      return (
                        <label
                          key={project.id}
                          className={cn(
                            'flex items-center gap-3 cursor-pointer rounded-lg border px-3 py-2 transition-colors',
                            isChecked
                              ? 'border-accent/30 bg-accent/5'
                              : 'border-border bg-background hover:bg-surface-hover',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => handleProjectToggle(project.id, e.target.checked)}
                            className="h-4 w-4 rounded border-border accent-accent"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-primary truncate block">
                              {project.name}
                            </span>
                            <span className="text-[10px] text-muted font-mono">
                              {project.prefix}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          </div>
        </SectionCard>

        {/* ── Section 5: Activity Log ────────────────────────────────────── */}
        <SectionCard
          icon={Activity}
          iconColor="text-green-400"
          title={t('agentConfig.activity.title')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                label: t('agentConfig.activity.lastHeartbeat'),
                value: form.last_heartbeat_at,
                icon: Zap,
                color: 'text-green-400',
              },
              {
                label: t('agentConfig.activity.lastTriage'),
                value: form.last_triage_at,
                icon: BarChart3,
                color: 'text-purple-400',
              },
              {
                label: t('agentConfig.activity.lastRecap'),
                value: form.last_recap_at,
                icon: Mail,
                color: 'text-amber-400',
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
              >
                <Icon size={16} className={cn('shrink-0', value ? color : 'text-muted')} />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-secondary truncate">{label}</p>
                  <p className={cn('text-xs mt-0.5', value ? 'text-primary' : 'text-muted italic')}>
                    {value ? timeAgo(value) : t('agentConfig.activity.never')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

      </div>
    </div>
  );
}

export default AgentConfig;
