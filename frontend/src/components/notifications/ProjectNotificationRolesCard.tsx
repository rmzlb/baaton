import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, RotateCcw, SlidersHorizontal, Users } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/shared/Skeleton';
import { ALL_STATUSES, RoleDefinitionsEditor, useRoleLabel } from '@/components/notifications/RoleDefinitionsEditor';
import type { NotificationRole, Project, ProjectNotificationRoles } from '@/lib/types';

/** Select values that are not role keys (role keys are `[a-z0-9_-]`). */
const FOLLOW_ORG = ':org';
const NO_ROLE = ':none';

const buttonClass = 'flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-secondary hover:bg-surface-hover hover:text-primary transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Who hears what on this project. Roles are defined once for the organization
 * and read at send time; the project follows them unless someone customises
 * it, and each member keeps their org role unless the project gives them
 * another one (or none).
 */
export function ProjectNotificationRolesCard({ project }: { project: Project }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const roleLabel = useRoleLabel();
  const { orgMembers, resolveUserName } = useClerkMembers();
  const [error, setError] = useState<string | null>(null);
  const queryKey = ['project-notification-roles', project.id];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => apiClient.projects.getNotificationRoles(project.id),
    staleTime: 30_000,
    retry: false,
  });

  const onError = (err: unknown) => setError(err instanceof ApiError && err.message
    ? err.message
    : t('notificationRoles.saveError', { defaultValue: 'Could not save. Your previous settings are unchanged.' }));
  const onSuccess = (view: ProjectNotificationRoles) => {
    setError(null);
    queryClient.setQueryData(queryKey, view);
    queryClient.invalidateQueries({ queryKey: [...apiClient.notificationPrefs.cacheScope, 'summary'] });
  };

  const rolesMutation = useMutation({
    mutationFn: (roles: NotificationRole[]) => apiClient.projects.updateNotificationRoles(project.id, roles),
    onSuccess, onError,
  });
  const resetMutation = useMutation({
    mutationFn: () => apiClient.projects.resetNotificationRoles(project.id),
    onSuccess, onError,
  });
  const memberMutation = useMutation({
    mutationFn: ({ userId, value }: { userId: string; value: string }) => value === FOLLOW_ORG
      ? apiClient.projects.clearNotificationRole(project.id, userId)
      : apiClient.projects.assignNotificationRole(project.id, userId, value === NO_ROLE ? null : value),
    onSuccess, onError,
  });
  const pending = rolesMutation.isPending || resetMutation.isPending || memberMutation.isPending;

  const header = (
    <div className="flex items-center gap-2 mb-4">
      <Users size={15} className="text-accent shrink-0" />
      <div>
        <h2 className="text-sm font-semibold text-primary">
          {t('notificationRoles.title', { defaultValue: 'Members & notifications' })}
        </h2>
        <p className="text-xs text-secondary mt-0.5">
          {t('notificationRoles.desc', { defaultValue: 'Give each member a role: they receive what the role asks for, by email and Telegram, without configuring anything. Their own notification settings still win.' })}
        </p>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 md:p-5">
        {header}
        <Skeleton className="h-8 rounded-md mb-3" />
        <Skeleton className="h-24 rounded-md" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 md:p-5">
        {header}
        <p role="alert" className="text-xs text-danger">
          {t('notificationRoles.loadError', { defaultValue: 'Could not load notification roles. Reopen this page to retry.' })}
        </p>
      </div>
    );
  }

  const statusKeys = new Set(project.statuses.map((s) => s.key));
  // Customising starts from the org's roles, keeping only statuses this
  // workflow has, so the first save is accepted as is.
  const customise = () => rolesMutation.mutate(data.org_roles.map((r) => ({
    ...r,
    notify_statuses: r.notify_statuses.filter((s) => s === ALL_STATUSES || statusKeys.has(s)),
  })));
  const revert = () => {
    if (!window.confirm(t('notificationRoles.revertConfirm', {
      defaultValue: 'Use the organization’s roles on this project again? This project’s own role definitions will be deleted.',
    }))) return;
    resetMutation.mutate();
  };

  const assignment = (userId: string) => data.assignments.find((a) => a.user_id === userId);
  const holdersOf = (key: string) => {
    const ids = new Set(orgMembers.map((m: any) => m.publicUserData?.userId as string | undefined));
    return data.assignments.filter((a) => a.role === key && ids.has(a.user_id)).length;
  };
  const roleName = (key: string | null) => {
    if (!key) return t('notificationRoles.none', { defaultValue: 'No role' });
    const role = data.roles.find((r) => r.key === key) ?? data.org_roles.find((r) => r.key === key);
    return role ? roleLabel(role) : key;
  };
  const members = orgMembers
    .map((m: any) => m.publicUserData?.userId as string | undefined)
    .filter((id): id is string => Boolean(id));

  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-5">
      {header}

      {/* Where the definitions come from */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <div className="flex items-start gap-2 min-w-0">
          {data.inherited
            ? <Building2 size={13} className="text-muted mt-0.5 shrink-0" />
            : <SlidersHorizontal size={13} className="text-accent mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary">
              {data.inherited
                ? t('notificationRoles.inherited', { defaultValue: 'Roles inherited from the organization' })
                : t('notificationRoles.customised', { defaultValue: 'Roles customised for this project' })}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              {data.inherited
                ? t('notificationRoles.inheritedHint', { defaultValue: 'A change to the organization’s roles applies here at once.' })
                : t('notificationRoles.customisedHint', { defaultValue: 'Changes to the organization’s roles no longer apply here.' })}
            </p>
          </div>
        </div>
        {data.inherited ? (
          <div className="flex items-center gap-2">
            <Link to="/settings#notification-roles" className={buttonClass}>
              {t('notificationRoles.editOrg', { defaultValue: 'Edit the organization’s roles' })}
            </Link>
            <button type="button" onClick={customise} disabled={pending} className={buttonClass}>
              <SlidersHorizontal size={12} />
              {t('notificationRoles.customise', { defaultValue: 'Customise for this project' })}
            </button>
          </div>
        ) : (
          <button type="button" onClick={revert} disabled={pending} className={buttonClass}>
            <RotateCcw size={12} />
            {t('notificationRoles.revert', { defaultValue: 'Back to the organization’s roles' })}
          </button>
        )}
      </div>

      {/* Members */}
      <div className="border-t border-border mt-5 pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">
          {t('notificationRoles.members', { defaultValue: 'Members' })}
        </p>
        <p className="text-xs text-muted mb-3">
          {t('notificationRoles.membersDesc', { defaultValue: 'Each member keeps their organization role here unless you give them another one on this project.' })}
        </p>
        {members.length === 0 ? (
          <p className="text-xs text-muted">{t('notificationRoles.noMembers', { defaultValue: 'No members found in this organization.' })}</p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {members.map((userId, i) => {
              const a = assignment(userId);
              const orgRole = a?.org_role ?? null;
              const value = !a?.overridden ? FOLLOW_ORG : (a.role ?? NO_ROLE);
              return (
                <div key={userId} className="flex items-center justify-between gap-3 px-3 py-2 animate-row-in" style={{ '--row-index': i } as React.CSSProperties}>
                  <div className="min-w-0">
                    <p className="text-xs text-primary truncate">{resolveUserName(userId)}</p>
                    <p className="text-[11px] text-muted truncate">
                      {t('notificationRoles.orgRoleOf', { role: roleName(orgRole), defaultValue: 'Organization: {{role}}' })}
                      {a?.overridden && (
                        <span className="ml-1.5 text-accent">
                          {t('notificationRoles.overridden', { defaultValue: '· changed on this project' })}
                        </span>
                      )}
                    </p>
                  </div>
                  <select
                    aria-label={t('notificationRoles.roleFor', { name: resolveUserName(userId), defaultValue: 'Role for {{name}}' })}
                    value={value}
                    disabled={pending}
                    onChange={(e) => memberMutation.mutate({ userId, value: e.target.value })}
                    className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value={FOLLOW_ORG}>
                      {t('notificationRoles.followOrg', { role: roleName(orgRole), defaultValue: 'Organization role ({{role}})' })}
                    </option>
                    <option value={NO_ROLE}>{t('notificationRoles.noneHere', { defaultValue: 'No role on this project' })}</option>
                    {data.roles.map((role) => (
                      <option key={role.key} value={role.key}>{roleLabel(role)}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Roles */}
      <div className="border-t border-border mt-5 pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">
          {t('notificationRoles.roles', { defaultValue: 'Roles' })}
        </p>
        <p className="text-xs text-muted mb-3">
          {t('notificationRoles.rolesDesc', { defaultValue: 'What each role hears on this project, on every ticket, the member’s own included. A member without a role hears about the tickets they created, are assigned to or requested. By email, everything arrives in one recap at 08:00, 12:00, 16:00 and 20:00 (Paris time).' })}
        </p>
        <RoleDefinitionsEditor
          roles={data.roles}
          statuses={project.statuses.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
          holdersOf={holdersOf}
          onChange={(roles, done) => rolesMutation.mutate(roles, { onSuccess: done })}
          onError={setError}
          pending={pending}
          readOnly={data.inherited}
        />
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
