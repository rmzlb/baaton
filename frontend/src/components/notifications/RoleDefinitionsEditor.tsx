import { useState } from 'react';
import { CheckCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { NotificationRole } from '@/lib/types';

export const ALL_STATUSES = '*';
const DEFAULT_ROLE_LABELS: Record<string, string> = { reviewer: 'Reviewer', dev: 'Dev', everything: 'Everything' };

export interface RoleStatusOption {
  key: string;
  label: string;
  color?: string;
}

function slugifyRoleKey(label: string): string {
  return label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

/** A default role keeps its translated name until someone renames it. */
export function useRoleLabel() {
  const { t } = useTranslation();
  return (role: Pick<NotificationRole, 'key' | 'label'>) => DEFAULT_ROLE_LABELS[role.key] === role.label
    ? t(`notificationRoles.default.${role.key}`, { defaultValue: role.label })
    : role.label;
}

/**
 * Editor for a set of role definitions, shared by the organization's roles
 * (Settings) and a customised project's (Automations). `readOnly` shows the
 * same chips without letting anyone change them.
 */
export function RoleDefinitionsEditor({
  roles,
  statuses,
  holdersOf,
  onChange,
  onError,
  pending = false,
  readOnly = false,
}: {
  roles: NotificationRole[];
  statuses: RoleStatusOption[];
  holdersOf: (key: string) => number;
  onChange: (roles: NotificationRole[], onSuccess?: () => void) => void;
  onError: (message: string) => void;
  pending?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  const [newLabel, setNewLabel] = useState('');

  const saveRole = (key: string, patch: Partial<NotificationRole>) =>
    onChange(roles.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const toggleStatus = (role: NotificationRole, status: string) => {
    const has = role.notify_statuses.includes(status);
    const next = status === ALL_STATUSES
      ? (has ? [] : [ALL_STATUSES])
      : (has ? role.notify_statuses.filter((s) => s !== status)
             : [...role.notify_statuses.filter((s) => s !== ALL_STATUSES), status]);
    saveRole(role.key, { notify_statuses: next });
  };

  const addRole = () => {
    const label = newLabel.trim();
    const key = slugifyRoleKey(label);
    if (!label || !key) return;
    if (roles.some((r) => r.key === key)) {
      onError(t('notificationRoles.duplicate', { defaultValue: 'A role with this name already exists.' }));
      return;
    }
    onChange([...roles, {
      key, label, notify_statuses: [], notify_comments: false, notify_issue_created: false,
    }], () => setNewLabel(''));
  };

  const removeRole = (role: NotificationRole) => {
    const holders = holdersOf(role.key);
    if (holders > 0 && !window.confirm(t('notificationRoles.removeConfirm', {
      count: holders,
      defaultValue: 'Remove this role? {{count}} member(s) will stop receiving its notifications.',
    }))) return;
    onChange(roles.filter((r) => r.key !== role.key));
  };

  const chip = (active: boolean, locked = false) => cn(
    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium',
    'transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
    'active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed',
    locked && 'opacity-60',
    active
      ? 'border-accent/40 bg-accent/10 text-accent'
      : 'border-border bg-transparent text-muted hover:border-border hover:text-secondary',
  );
  const check = (active: boolean) => active && <CheckCircle size={11} className="text-accent ml-0.5" />;
  // Statuses a role names that this workflow does not have stay visible, so
  // nobody wonders why a role "does nothing" here.
  const known = new Set(statuses.map((s) => s.key));

  return (
    <div>
      <div className="space-y-4">
        {roles.map((role, i) => {
          const all = role.notify_statuses.includes(ALL_STATUSES);
          const foreign = role.notify_statuses.filter((s) => s !== ALL_STATUSES && !known.has(s));
          return (
            <div key={role.key} className="space-y-2 animate-row-in" style={{ '--row-index': i } as React.CSSProperties}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-primary">
                  {roleLabel(role)}
                  <span className="ml-2 text-muted tabular-nums">
                    {t('notificationRoles.holders', { count: holdersOf(role.key), defaultValue: '{{count}} member(s)' })}
                  </span>
                </span>
                {!readOnly && (
                  <button type="button" onClick={() => removeRole(role)} disabled={pending}
                    aria-label={t('notificationRoles.remove', { defaultValue: 'Remove role' })}
                    className="rounded-md p-1 text-muted hover:text-danger hover:bg-surface-hover transition-[transform,colors,background-color] duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" aria-pressed={all} disabled={readOnly}
                  onClick={() => toggleStatus(role, ALL_STATUSES)} className={chip(all)}>
                  {t('notificationRoles.allStatuses', { defaultValue: 'Every status' })}
                  {check(all)}
                </button>
                {statuses.map((status) => {
                  const active = all || role.notify_statuses.includes(status.key);
                  return (
                    <button key={status.key} type="button" aria-pressed={active} disabled={all || readOnly}
                      onClick={() => toggleStatus(role, status.key)} className={chip(active, all)}>
                      {status.color && (
                        <span className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: active ? status.color : 'var(--color-muted)' }} />
                      )}
                      {status.label}
                      {check(active && !all)}
                    </button>
                  );
                })}
                {foreign.map((key) => (
                  <span key={key} className={chip(true, true)} title={t('notificationRoles.foreignStatus', { defaultValue: 'This workflow has no such status' })}>
                    {key}
                  </span>
                ))}
                <button type="button" aria-pressed={role.notify_comments} disabled={readOnly}
                  onClick={() => saveRole(role.key, { notify_comments: !role.notify_comments })} className={chip(role.notify_comments)}>
                  {t('notificationRoles.comments', { defaultValue: 'All comments' })}
                  {check(role.notify_comments)}
                </button>
                <button type="button" aria-pressed={role.notify_issue_created} disabled={readOnly}
                  onClick={() => saveRole(role.key, { notify_issue_created: !role.notify_issue_created })} className={chip(role.notify_issue_created)}>
                  {t('notificationRoles.created', { defaultValue: 'New tickets' })}
                  {check(role.notify_issue_created)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); addRole(); }}>
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={40}
            aria-label={t('notificationRoles.newPlaceholder', { defaultValue: 'New role name' })}
            placeholder={t('notificationRoles.newPlaceholder', { defaultValue: 'New role name' })}
            className="flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
          <button type="submit" disabled={pending || !slugifyRoleKey(newLabel)}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-secondary hover:bg-surface-hover transition-[transform,colors,background-color] duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus size={12} />
            {t('notificationRoles.add', { defaultValue: 'Add role' })}
          </button>
        </form>
      )}
    </div>
  );
}
