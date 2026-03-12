import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import {
  Workflow, Plus, Trash2, Loader2, X, ArrowRight,
  ArrowLeftRight, AlertTriangle, UserPlus, Tag, Clock,
  CheckCircle, User, Globe, MessageSquare, FolderOpen,
  Zap, ChevronRight, Layers, PlusCircle, Bot,
} from 'lucide-react';
import type { Automation, Project } from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  'issue_created',
  'status_changed',
  'priority_changed',
  'assignee_changed',
  'label_added',
  'comment_added',
  'due_date_passed',
] as const;

const ACTION_TYPES = [
  'set_status',
  'set_priority',
  'add_label',
  'assign_user',
  'send_webhook',
  'add_comment',
  'run_agent',
] as const;

type TriggerType = typeof TRIGGER_TYPES[number];
type ActionType = typeof ACTION_TYPES[number];

interface FormState {
  name: string;
  trigger_type: TriggerType;
  condition_value: string;
  action_type: ActionType;
  action_value: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  trigger_type: 'status_changed',
  condition_value: '',
  action_type: 'set_status',
  action_value: '',
};

// ─── Meta ────────────────────────────────────────────────────────────────────

interface TriggerMeta { Icon: LucideIcon; color: string; bg: string; border: string }
interface ActionMeta  { Icon: LucideIcon; color: string; bg: string; border: string }

const TRIGGER_META: Record<TriggerType, TriggerMeta> = {
  issue_created:   { Icon: PlusCircle,     color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  status_changed:  { Icon: ArrowLeftRight, color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  priority_changed:{ Icon: AlertTriangle,  color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  assignee_changed:{ Icon: UserPlus,       color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  label_added:     { Icon: Tag,            color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  comment_added:   { Icon: MessageSquare,  color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20' },
  due_date_passed: { Icon: Clock,          color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
};

const ACTION_META: Record<ActionType, ActionMeta> = {
  set_status:   { Icon: CheckCircle,   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  set_priority: { Icon: AlertTriangle, color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20' },
  add_label:    { Icon: Tag,           color: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20' },
  assign_user:  { Icon: User,          color: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20' },
  send_webhook: { Icon: Globe,         color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/20' },
  add_comment:  { Icon: MessageSquare, color: 'text-pink-400',    bg: 'bg-pink-500/10',    border: 'border-pink-500/20' },
  run_agent:    { Icon: Bot,           color: 'text-accent',      bg: 'bg-accent/10',      border: 'border-accent/20' },
};

const STATUS_OPTIONS: string[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const PRIORITY_OPTIONS: string[] = ['none', 'low', 'medium', 'high', 'urgent'];

// ─── Templates ───────────────────────────────────────────────────────────────

interface Template {
  id: string;
  nameKey: string;
  descKey: string;
  Icon: LucideIcon;
  iconColor: string;
  defaults: Omit<FormState, 'name'>;
  nameSuggestionKey: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'auto-close',
    nameKey: 'automations.template.autoClose.name',
    descKey: 'automations.template.autoClose.desc',
    Icon: Clock,
    iconColor: 'text-red-400',
    nameSuggestionKey: 'automations.template.autoClose.name',
    defaults: { trigger_type: 'due_date_passed', condition_value: '', action_type: 'set_status', action_value: 'done' },
  },
  {
    id: 'escalate-urgent',
    nameKey: 'automations.template.escalateUrgent.name',
    descKey: 'automations.template.escalateUrgent.desc',
    Icon: AlertTriangle,
    iconColor: 'text-yellow-400',
    nameSuggestionKey: 'automations.template.escalateUrgent.name',
    defaults: { trigger_type: 'priority_changed', condition_value: 'urgent', action_type: 'set_priority', action_value: 'high' },
  },
  {
    id: 'auto-assign',
    nameKey: 'automations.template.autoAssign.name',
    descKey: 'automations.template.autoAssign.desc',
    Icon: UserPlus,
    iconColor: 'text-green-400',
    nameSuggestionKey: 'automations.template.autoAssign.name',
    defaults: { trigger_type: 'status_changed', condition_value: 'in_progress', action_type: 'assign_user', action_value: '' },
  },
  {
    id: 'label-backlog',
    nameKey: 'automations.template.labelBacklog.name',
    descKey: 'automations.template.labelBacklog.desc',
    Icon: Tag,
    iconColor: 'text-purple-400',
    nameSuggestionKey: 'automations.template.labelBacklog.name',
    defaults: { trigger_type: 'status_changed', condition_value: '', action_type: 'add_label', action_value: 'needs-triage' },
  },
  {
    id: 'notify-completion',
    nameKey: 'automations.template.notifyCompletion.name',
    descKey: 'automations.template.notifyCompletion.desc',
    Icon: MessageSquare,
    iconColor: 'text-pink-400',
    nameSuggestionKey: 'automations.template.notifyCompletion.name',
    defaults: { trigger_type: 'status_changed', condition_value: 'done', action_type: 'add_comment', action_value: '✅ Issue completed!' },
  },
  {
    id: 'weekly-stale',
    nameKey: 'automations.template.weeklyStale.name',
    descKey: 'automations.template.weeklyStale.desc',
    Icon: Layers,
    iconColor: 'text-orange-400',
    nameSuggestionKey: 'automations.template.weeklyStale.name',
    defaults: { trigger_type: 'due_date_passed', condition_value: '', action_type: 'add_label', action_value: 'stale' },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTriggerConfig(trigger_type: TriggerType, condition_value: string): Record<string, unknown> {
  if (!condition_value.trim()) return {};
  switch (trigger_type) {
    case 'status_changed':  return { status: condition_value };
    case 'priority_changed':return { priority: condition_value };
    case 'assignee_changed':return { assignee: condition_value };
    case 'label_added':     return { label: condition_value };
    default: return {};
  }
}

function buildActionConfig(action_type: ActionType, action_value: string): Record<string, unknown> {
  if (!action_value.trim()) return {};
  if (action_type === 'send_webhook') return { url: action_value };
  return { value: action_value };
}

function getConditionFromConfig(trigger_type: TriggerType, config?: Record<string, unknown> | null): string {
  if (!config) return '';
  switch (trigger_type) {
    case 'status_changed':  return (config.status   as string) ?? '';
    case 'priority_changed':return (config.priority as string) ?? '';
    case 'assignee_changed':return (config.assignee as string) ?? '';
    case 'label_added':     return (config.label    as string) ?? '';
    default: return '';
  }
}

function getActionValueFromConfig(action_type: ActionType, config?: Record<string, unknown> | null): string {
  if (!config) return '';
  if (action_type === 'send_webhook') return (config.url   as string) ?? '';
  return                                      (config.value as string) ?? '';
}

/** Normalize backend Automation → add computed trigger_type, action_type, etc. */
function normalizeAutomation(a: Automation): Automation & { trigger_type: string; action_type: string; action_config: Record<string, unknown> } {
  const trigger_type = a.trigger || a.trigger_type || 'status_changed';
  const firstAction = Array.isArray(a.actions) && a.actions.length > 0 ? a.actions[0] : null;
  const action_type = (firstAction?.type as string) || a.action_type || 'set_status';
  // Build action_config from actions array for backward compat
  const action_config: Record<string, unknown> = firstAction
    ? (firstAction.type === 'send_webhook' ? { url: firstAction.value } : { value: firstAction.value })
    : (a.action_config || {});
  // Build trigger_config from conditions array
  const trigger_config: Record<string, unknown> = {};
  if (Array.isArray(a.conditions)) {
    for (const c of a.conditions) {
      if (c.field && c.value) trigger_config[c.field as string] = c.value;
    }
  }
  return { ...a, trigger_type, action_type, trigger_config, action_config };
}

function automationToForm(a: Automation): FormState {
  const n = normalizeAutomation(a);
  return {
    name: n.name,
    trigger_type: n.trigger_type as TriggerType,
    condition_value: getConditionFromConfig(n.trigger_type as TriggerType, n.trigger_config),
    action_type: n.action_type as ActionType,
    action_value: getActionValueFromConfig(n.action_type as ActionType, n.action_config),
  };
}

function formatRelative(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins  < 2)  return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return '';
  }
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled = false }: {
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

// ─── Chip Badge ───────────────────────────────────────────────────────────────

function Chip({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
      className,
    )}>
      {label}
    </span>
  );
}

// ─── Flow Node ────────────────────────────────────────────────────────────────

function FlowNode({ Icon, label, sublabel, color, bg, border }: {
  Icon: LucideIcon;
  label: string;
  sublabel?: string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2', bg, border)}>
      <div className={cn('shrink-0', color)}>
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <div className={cn('text-xs font-medium leading-tight', color)}>{label}</div>
        {sublabel && (
          <div className="text-[10px] text-muted leading-tight truncate max-w-[120px]">{sublabel}</div>
        )}
      </div>
    </div>
  );
}

// ─── Flow Preview ─────────────────────────────────────────────────────────────

function FlowPreview({ form }: { form: FormState }) {
  const { t } = useTranslation();
  const triggerMeta = TRIGGER_META[form.trigger_type] ?? TRIGGER_META.status_changed;
  const actionMeta  = ACTION_META[form.action_type]   ?? ACTION_META.set_status;

  const triggerLabel = t(`automations.trigger.${form.trigger_type}` as any);
  const actionLabel  = t(`automations.action.${form.action_type}`   as any);
  const condLabel    = form.condition_value ? getConditionDisplayLabel(form) : null;
  const actionValLabel = form.action_value || null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-3">
        {t('automations.flowPreview')}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <FlowNode
          Icon={triggerMeta.Icon}
          label={triggerLabel}
          sublabel={condLabel ?? undefined}
          color={triggerMeta.color}
          bg={triggerMeta.bg}
          border={triggerMeta.border}
        />
        <ArrowRight size={14} className="text-muted shrink-0" />
        <FlowNode
          Icon={actionMeta.Icon}
          label={actionLabel}
          sublabel={actionValLabel ?? undefined}
          color={actionMeta.color}
          bg={actionMeta.bg}
          border={actionMeta.border}
        />
      </div>
    </div>
  );
}

function getConditionDisplayLabel(form: FormState): string {
  if (!form.condition_value) return '';
  return form.condition_value.replace(/_/g, ' ');
}

// ─── Condition Input ──────────────────────────────────────────────────────────

function ConditionInput({ form, onChange }: {
  form: FormState;
  onChange: (val: string) => void;
}) {
  const { t } = useTranslation();

  if (form.trigger_type === 'due_date_passed') return null;

  const baseClass = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors';

  switch (form.trigger_type) {
    case 'status_changed':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.condition.status')}
          </label>
          <select value={form.condition_value} onChange={e => onChange(e.target.value)} className={baseClass}>
            <option value="">{t('automations.noConditions')}</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{t(`automations.status.${s}` as any)}</option>
            ))}
          </select>
        </div>
      );
    case 'priority_changed':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.condition.priority')}
          </label>
          <select value={form.condition_value} onChange={e => onChange(e.target.value)} className={baseClass}>
            <option value="">{t('automations.noConditions')}</option>
            {PRIORITY_OPTIONS.map(p => (
              <option key={p} value={p}>{t(`automations.priority.${p}` as any)}</option>
            ))}
          </select>
        </div>
      );
    case 'assignee_changed':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.condition.assignee')}
          </label>
          <input
            type="text"
            value={form.condition_value}
            onChange={e => onChange(e.target.value)}
            placeholder={t('automations.assigneePlaceholder')}
            className={baseClass}
          />
        </div>
      );
    case 'label_added':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.condition.label')}
          </label>
          <input
            type="text"
            value={form.condition_value}
            onChange={e => onChange(e.target.value)}
            placeholder={t('automations.labelPlaceholder')}
            className={baseClass}
          />
        </div>
      );
    default:
      return null;
  }
}

// ─── Action Value Input ───────────────────────────────────────────────────────

function ActionValueInput({ form, onChange }: {
  form: FormState;
  onChange: (val: string) => void;
}) {
  const { t } = useTranslation();
  const baseClass = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors';

  switch (form.action_type) {
    case 'set_status':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.actionValue')}
          </label>
          <select value={form.action_value} onChange={e => onChange(e.target.value)} className={baseClass}>
            <option value="">{t('automations.actionValuePlaceholder')}</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{t(`automations.status.${s}` as any)}</option>
            ))}
          </select>
        </div>
      );
    case 'set_priority':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.actionValue')}
          </label>
          <select value={form.action_value} onChange={e => onChange(e.target.value)} className={baseClass}>
            <option value="">{t('automations.actionValuePlaceholder')}</option>
            {PRIORITY_OPTIONS.map(p => (
              <option key={p} value={p}>{t(`automations.priority.${p}` as any)}</option>
            ))}
          </select>
        </div>
      );
    case 'send_webhook':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.webhookUrl')}
          </label>
          <input
            type="url"
            value={form.action_value}
            onChange={e => onChange(e.target.value)}
            placeholder="https://hooks.example.com/…"
            className={baseClass}
          />
        </div>
      );
    case 'add_comment':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.actionValue')}
          </label>
          <textarea
            value={form.action_value}
            onChange={e => onChange(e.target.value)}
            rows={3}
            placeholder={t('automations.commentPlaceholder')}
            className={cn(baseClass, 'resize-none')}
          />
        </div>
      );
    case 'add_label':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.actionValue')}
          </label>
          <input
            type="text"
            value={form.action_value}
            onChange={e => onChange(e.target.value)}
            placeholder={t('automations.labelPlaceholder')}
            className={baseClass}
          />
        </div>
      );
    case 'assign_user':
      return (
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">
            {t('automations.actionValue')}
          </label>
          <input
            type="text"
            value={form.action_value}
            onChange={e => onChange(e.target.value)}
            placeholder={t('automations.assigneePlaceholder')}
            className={baseClass}
          />
        </div>
      );
    default:
      return null;
  }
}

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({ template, onUse }: { template: Template; onUse: () => void }) {
  const { t } = useTranslation();
  const { Icon, iconColor } = template;

  return (
    <div className={cn(
      'group relative flex flex-col gap-3 rounded-xl border border-border bg-surface p-4',
      'hover:border-accent/30 hover:bg-surface-hover transition-all duration-200 cursor-pointer shrink-0 w-52',
    )}
      onClick={onUse}
    >
      <div className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg',
        'bg-surface-hover group-hover:scale-105 transition-transform duration-200',
      )}>
        <Icon size={18} className={iconColor} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-primary leading-tight mb-1">
          {t(template.nameKey as any)}
        </p>
        <p className="text-xs text-secondary leading-relaxed">
          {t(template.descKey as any)}
        </p>
      </div>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onUse(); }}
        className={cn(
          'w-full rounded-lg border border-border py-1.5 text-xs font-medium text-secondary',
          'hover:border-accent/40 hover:text-accent hover:bg-accent/5 transition-all duration-150',
        )}
      >
        {t('automations.useTemplate')}
      </button>
    </div>
  );
}

// ─── Condition Pills ──────────────────────────────────────────────────────────

function ConditionPills({ triggerType, triggerConfig }: {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const tt = triggerType as TriggerType;
  const val = getConditionFromConfig(tt, triggerConfig);

  if (!val) {
    return (
      <Chip
        label={t('automations.noConditionPill')}
        className="bg-surface-hover text-muted border border-border"
      />
    );
  }

  const label = val.replace(/_/g, ' ');
  const meta = TRIGGER_META[tt];

  return (
    <Chip
      label={label}
      className={cn('border', meta?.bg ?? 'bg-surface-hover', meta?.color ?? 'text-secondary', meta?.border ?? 'border-border')}
    />
  );
}

// ─── Automation Card ──────────────────────────────────────────────────────────

function AutomationCard({ automation, onEdit, onDelete, onToggle, isDeleting, isToggling }: {
  automation: Automation;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  isDeleting: boolean;
  isToggling: boolean;
}) {
  const { t } = useTranslation();
  const tt = automation.trigger_type as TriggerType;
  const at = automation.action_type  as ActionType;
  const triggerMeta = TRIGGER_META[tt] ?? TRIGGER_META.status_changed;
  const actionMeta  = ACTION_META[at]  ?? ACTION_META.set_status;
  const { Icon: TIcon } = triggerMeta;
  const { Icon: AIcon } = actionMeta;

  const actionVal = getActionValueFromConfig(at, automation.action_config);

  return (
    <div
      className={cn(
        'group rounded-xl border border-border bg-surface p-4',
        'hover:border-accent/20 hover:bg-surface-hover/50 transition-all duration-200',
        !automation.enabled && 'opacity-60',
      )}
    >
      {/* Top row: flow + controls */}
      <div className="flex items-start justify-between gap-3">
        {/* Left: name + flow */}
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-semibold text-primary mb-2 truncate group-hover:text-accent transition-colors">
            {automation.name}
          </p>
          {/* Flow row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Trigger */}
            <div className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5',
              triggerMeta.bg, triggerMeta.border,
            )}>
              <TIcon size={12} className={triggerMeta.color} />
              <span className={cn('text-xs font-medium', triggerMeta.color)}>
                {t(`automations.trigger.${automation.trigger_type}` as any)}
              </span>
            </div>
            <ArrowRight size={12} className="text-muted shrink-0" />
            {/* Action */}
            <div className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5',
              actionMeta.bg, actionMeta.border,
            )}>
              <AIcon size={12} className={actionMeta.color} />
              <span className={cn('text-xs font-medium', actionMeta.color)}>
                {t(`automations.action.${automation.action_type}` as any)}
              </span>
              {actionVal && (
                <span className="text-[10px] text-muted ml-0.5 truncate max-w-[80px]">
                  → {actionVal}
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Right: toggle + delete */}
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <ToggleSwitch
            checked={automation.enabled}
            onChange={onToggle}
            disabled={isToggling}
          />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            disabled={isDeleting}
            className={cn(
              'rounded-md p-1.5 text-muted transition-colors',
              'hover:text-red-400 hover:bg-red-500/10',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
            title={t('automations.delete')}
          >
            {isDeleting
              ? <Loader2 size={14} className="animate-spin" />
              : <Trash2 size={14} />
            }
          </button>
        </div>
      </div>

      {/* Bottom: condition pills + timestamp */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted mr-1">{t('automations.conditionsLabel')}:</span>
          <ConditionPills
            triggerType={automation.trigger_type}
            triggerConfig={automation.trigger_config}
          />
        </div>
        <span className="text-[10px] text-muted shrink-0">
          {t('automations.createdAt')} {formatRelative(automation.created_at)}
        </span>
      </div>
    </div>
  );
}



// ─── Project Selector ─────────────────────────────────────────────────────────

function ProjectSelector({ projects }: { projects: Project[] }) {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-primary mb-1">{t('automations.selectProject')}</h2>
        <p className="text-sm text-secondary">{t('automations.selectProjectDesc')}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {projects.map(p => (
          <a
            key={p.id}
            href={`/projects/${p.slug}/automations`}
            className={cn(
              'flex items-center gap-3 rounded-xl border border-border bg-surface p-4',
              'hover:border-accent/30 hover:bg-surface-hover transition-all duration-200',
            )}
          >
            <div className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-surface-hover">
              <FolderOpen size={16} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary truncate">{p.name}</p>
              <p className="text-xs text-muted">{p.slug}</p>
            </div>
            <ChevronRight size={14} className="text-muted ml-auto shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Automations() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug?: string }>();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const project = projects.find((p: Project) => p.slug === slug);

  const { data: rawAutomations = [], isLoading: loadingAutomations } = useQuery({
    queryKey: ['automations', project?.id],
    queryFn: () => apiClient.automations.list(project!.id),
    enabled: !!project?.id,
    staleTime: 30_000,
  });
  const automations = rawAutomations.map(normalizeAutomation);

  // ── Mutations ───────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof apiClient.automations.create>[1]) =>
      apiClient.automations.create(project!.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', project?.id] });
      setModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof apiClient.automations.update>[2] }) =>
      apiClient.automations.update(project!.id, id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', project?.id] });
      setModalOpen(false);
      setEditingAutomation(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.automations.toggle(project!.id, id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', project?.id] });
    },
    onSettled: () => setTogglingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.automations.delete(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations', project?.id] });
    },
    onSettled: () => setDeletingId(null),
  });

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSave = (form: FormState) => {
    // Build conditions array from trigger type + condition value
    const conditions: Record<string, unknown>[] = [];
    if (form.condition_value.trim()) {
      const fieldMap: Record<string, string> = {
        status_changed: 'status', priority_changed: 'priority',
        assignee_changed: 'assignee', label_added: 'label',
      };
      const field = fieldMap[form.trigger_type];
      if (field) conditions.push({ field, operator: 'equals', value: form.condition_value });
    }

    // Build actions array: [{type, value}]
    const actions = [{ type: form.action_type, value: form.action_value.trim() }];

    const payload = {
      name: form.name.trim(),
      trigger: form.trigger_type,
      conditions,
      actions,
    };

    if (editingAutomation) {
      updateMutation.mutate({ id: editingAutomation.id, body: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleOpenCreate = () => {
    setEditingAutomation(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (automation: Automation) => {
    setEditingAutomation(automation);
    setModalOpen(true);
  };

  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingAutomation(null);
    setPendingTemplate(null);
  };

  const handleDelete = (automation: Automation) => {
    setDeletingId(automation.id);
    deleteMutation.mutate(automation.id);
  };

  const handleToggle = (automation: Automation) => {
    setTogglingId(automation.id);
    toggleMutation.mutate({ id: automation.id, enabled: !automation.enabled });
  };

  // ── Loading states ──────────────────────────────────────────────────────────

  if (loadingProjects) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  // No slug → project selector
  if (!slug || !project) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center border-b border-border px-4 md:px-6 py-3">
          <h1 className="text-base md:text-lg font-semibold text-primary flex items-center gap-2">
            <Workflow size={18} className="text-accent" />
            {t('automations.title')}
          </h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ProjectSelector projects={projects} />
        </div>
      </div>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const enabledCount = automations.filter((a: Automation) => a.enabled).length;

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
        <div>
          <h1 className="text-base md:text-lg font-semibold text-primary flex items-center gap-2">
            <Workflow size={18} className="text-accent" />
            {t('automations.title')}
            <span className="text-sm font-normal text-muted">— {project.name}</span>
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider">
            {t('automations.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {automations.length > 0 && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted">
              <Zap size={12} className="text-accent" />
              {enabledCount} {t('automations.activeRules')}
            </span>
          )}
          <button
            onClick={handleOpenCreate}
            className={cn(
              'flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white',
              'hover:bg-accent/90 transition-colors',
            )}
          >
            <Plus size={16} />
            <span className="hidden sm:inline">{t('automations.create')}</span>
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 max-w-5xl">

          {/* ── Section 1: Template Gallery ─────────────────────────────────── */}
          <div className="mb-8">
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-sm font-semibold text-primary">{t('automations.templates')}</h2>
              <span className="text-xs text-muted">{t('automations.templatesDesc')}</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent -mx-1 px-1">
              {TEMPLATES.map(tmpl => (
                <TemplateCard
                  key={tmpl.id}
                  template={tmpl}
                  onUse={() => {
                    setEditingAutomation(null);
                    setPendingTemplate(tmpl);
                    setModalOpen(true);
                  }}
                />
              ))}
            </div>
          </div>

          {/* ── Section 2: Active Automations ───────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-primary">
                {t('automations.activeRules')}
                {automations.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted">({automations.length})</span>
                )}
              </h2>
            </div>

            {loadingAutomations ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-muted" />
              </div>
            ) : automations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                  <Zap size={28} className="text-muted" />
                </div>
                <h3 className="text-base font-semibold text-primary mb-2">{t('automations.empty')}</h3>
                <p className="text-sm text-secondary max-w-xs mb-6">{t('automations.emptyDesc')}</p>
                <button
                  onClick={handleOpenCreate}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
                >
                  <Plus size={16} />
                  {t('automations.create')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {automations.map((automation: Automation) => (
                  <AutomationCard
                    key={automation.id}
                    automation={automation}
                    onEdit={() => handleOpenEdit(automation)}
                    onDelete={() => handleDelete(automation)}
                    onToggle={() => handleToggle(automation)}
                    isDeleting={deletingId === automation.id}
                    isToggling={togglingId === automation.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: Modal ────────────────────────────────────────────────── */}
      <AutomationModalWithTemplate
        isOpen={modalOpen}
        onClose={handleModalClose}
        onSave={handleSave}
        editAutomation={editingAutomation}
        pendingTemplate={pendingTemplate}
        isSaving={isSaving}
      />
    </div>
  );
}

// ─── Modal with template injection ───────────────────────────────────────────
// Separate wrapper so useEffect runs cleanly when template changes

function AutomationModalWithTemplate({ isOpen, onClose, onSave, editAutomation, pendingTemplate, isSaving }: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (form: FormState) => void;
  editAutomation: Automation | null;
  pendingTemplate: Template | null;
  isSaving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const isEditing = !!editAutomation;

  // Sync form
  useEffect(() => {
    if (isOpen) {
      if (editAutomation) {
        setForm(automationToForm(editAutomation));
      } else if (pendingTemplate) {
        setForm({
          name: t(pendingTemplate.nameSuggestionKey as any),
          ...pendingTemplate.defaults,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setError('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [isOpen, editAutomation, pendingTemplate]);

  const setTrigger = (tt: TriggerType) => setForm(f => ({ ...f, trigger_type: tt, condition_value: '' }));
  const setAction  = (at: ActionType)  => setForm(f => ({ ...f, action_type: at, action_value: '' }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('automations.nameRequired')); return; }
    setError('');
    onSave(form);
  };

  if (!isOpen) return null;

  const baseSelectClass = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-primary">
              {isEditing ? t('automations.editAutomation') : t('automations.createNew')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="max-h-[80vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                {t('automations.name')}
              </label>
              <input
                ref={nameRef}
                value={form.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setError(''); }}
                placeholder={t('automations.namePlaceholder')}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
              />
            </div>

            {/* Trigger type */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                {t('automations.triggerType')}
              </label>
              <select
                value={form.trigger_type}
                onChange={e => setTrigger(e.target.value as TriggerType)}
                className={baseSelectClass}
              >
                {TRIGGER_TYPES.map(tt => (
                  <option key={tt} value={tt}>
                    {t(`automations.trigger.${tt}` as any)}
                  </option>
                ))}
              </select>
              {/* Visual picker */}
              <div className="flex gap-1.5 flex-wrap mt-2">
                {TRIGGER_TYPES.map(tt => {
                  const meta = TRIGGER_META[tt];
                  const active = form.trigger_type === tt;
                  return (
                    <button
                      key={tt}
                      type="button"
                      onClick={() => setTrigger(tt)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all duration-150',
                        active
                          ? cn(meta.bg, meta.border, meta.color)
                          : 'border-border bg-transparent text-muted hover:bg-surface-hover',
                      )}
                    >
                      <meta.Icon size={10} />
                      {t(`automations.trigger.${tt}` as any)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Condition input */}
            <ConditionInput
              form={form}
              onChange={val => setForm(f => ({ ...f, condition_value: val }))}
            />

            {/* Action type */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                {t('automations.actionType')}
              </label>
              <select
                value={form.action_type}
                onChange={e => setAction(e.target.value as ActionType)}
                className={baseSelectClass}
              >
                {ACTION_TYPES.map(at => (
                  <option key={at} value={at}>
                    {t(`automations.action.${at}` as any)}
                  </option>
                ))}
              </select>
              {/* Visual picker */}
              <div className="flex gap-1.5 flex-wrap mt-2">
                {ACTION_TYPES.map(at => {
                  const meta = ACTION_META[at];
                  const active = form.action_type === at;
                  return (
                    <button
                      key={at}
                      type="button"
                      onClick={() => setAction(at)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all duration-150',
                        active
                          ? cn(meta.bg, meta.border, meta.color)
                          : 'border-border bg-transparent text-muted hover:bg-surface-hover',
                      )}
                    >
                      <meta.Icon size={10} />
                      {t(`automations.action.${at}` as any)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action value input */}
            <ActionValueInput
              form={form}
              onChange={val => setForm(f => ({ ...f, action_value: val }))}
            />

            {/* Flow Preview */}
            <FlowPreview form={form} />

            {/* Error */}
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {/* Footer buttons */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
              >
                {t('automations.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving && <Loader2 size={14} className="animate-spin" />}
                {isSaving
                  ? (isEditing ? t('automations.updating') : t('automations.creating'))
                  : (isEditing ? t('automations.update')   : t('automations.save'))}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Automations;
