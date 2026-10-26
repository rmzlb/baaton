import { useEffect, useRef, useState } from 'react';
import { useOrganization } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/shared/Skeleton';
import { RoleDefinitionsEditor, useRoleLabel, type RoleStatusOption } from '@/components/notifications/RoleDefinitionsEditor';
import type { NotificationRole, OrgNotificationRoles, Project } from '@/lib/types';

/** Statuses an org role can name: every status of the org's projects. */
function orgStatuses(projects: Project[], orgId: string): RoleStatusOption[] {
  const out: RoleStatusOption[] = [];
  for (const p of projects) {
    if (p.org_id !== orgId) continue;
    for (const s of p.statuses) {
      if (!out.some((o) => o.key === s.key)) out.push({ key: s.key, label: s.label, color: s.color });
    }
  }
  return out;
}

/**
 * The organization's notification roles, defined once: every project follows
 * them unless it is customised, and a member's org role applies on every
 * project. Only an org admin can change them; others see them read-only.
 */
export function OrgNotificationRolesSection() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const roleLabel = useRoleLabel();
  const { organization, membership } = useOrganization();
  const { orgMembers, resolveUserName } = useClerkMembers();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const orgId = organization?.id ?? '';
  const isAdmin = membership?.role === 'org:admin';
  const queryKey = ['org-notification-roles', orgId];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => apiClient.orgs.getNotificationRoles(orgId),
    enabled: Boolean(orgId),
    staleTime: 30_000,
    retry: false,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Reached from a project's "Edit the organization's roles" link.
  useEffect(() => {
    if (data && window.location.hash === '#notification-roles') ref.current?.scrollIntoView({ block: 'start' });
  }, [data]);

  const onError = (err: unknown) => setError(err instanceof ApiError && err.message
    ? err.message
    : t('notificationRoles.saveError', { defaultValue: 'Could not save. Your previous settings are unchanged.' }));
  const onSuccess = (view: OrgNotificationRoles) => {
    setError(null);
    queryClient.setQueryData(queryKey, view);
    // Projects that inherit now show the new definitions.
    queryClient.invalidateQueries({ queryKey: ['project-notification-roles'] });
    queryClient.invalidateQueries({ queryKey: [...apiClient.notificationPrefs.cacheScope, 'summary'] });
  };
  const rolesMutation = useMutation({
    mutationFn: (roles: NotificationRole[]) => apiClient.orgs.updateNotificationRoles(orgId, roles),
    onSuccess, onError,
  });
  const assignMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string | null }) =>
      apiClient.orgs.assignNotificationRole(orgId, userId, role),
    onSuccess, onError,
  });
  const pending = rolesMutation.isPending || assignMutation.isPending;

  if (!organization) return null;

  const header = (
    <div className="flex items-start gap-3 mb-4">
      <Users size={20} className="text-accent shrink-0 mt-0.5" />
      <div>
        <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
          {t('orgRoles.title', { defaultValue: 'Notification roles' })}
        </h2>
        <p className="text-xs text-secondary mt-1 leading-relaxed">
          {t('orgRoles.desc', { defaultValue: 'Defined once for the organization. Every project follows these roles unless it is customised, and a member’s role here applies on every project, including projects created later.' })}
        </p>
      </div>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div id="notification-roles" ref={ref} className="rounded-xl border border-border bg-surface p-4 md:p-6 scroll-mt-4">
      {header}
      {body}
    </div>
  );

  if (isLoading) return shell(<><Skeleton className="h-20 rounded-md mb-3" /><Skeleton className="h-24 rounded-md" /></>);
  if (isError || !data) {
    return shell(
      <p role="alert" className="text-xs text-danger">
        {t('notificationRoles.loadError', { defaultValue: 'Could not load notification roles. Reopen this page to retry.' })}
      </p>,
    );
  }

  const roleOf = (userId: string) => data.assignments.find((a) => a.user_id === userId)?.role ?? '';
  const members = orgMembers
    .map((m: any) => m.publicUserData?.userId as string | undefined)
    .filter((id): id is string => Boolean(id));
  const memberIds = new Set(members);
  const holdersOf = (key: string) => data.assignments.filter((a) => a.role === key && memberIds.has(a.user_id)).length;

  return shell(
    <>
      {!isAdmin && (
        <p className="mb-4 rounded-md border border-border px-3 py-2 text-xs text-muted">
          {t('orgRoles.adminOnly', { defaultValue: 'Only an admin of the organization can change these roles.' })}
        </p>
      )}

      <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-2">
        {t('notificationRoles.members', { defaultValue: 'Members' })}
      </p>
      {members.length === 0 ? (
        <p className="text-xs text-muted">{t('notificationRoles.noMembers', { defaultValue: 'No members found in this organization.' })}</p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {members.map((userId, i) => (
            <div key={userId} className="flex items-center justify-between gap-3 px-3 py-2 animate-row-in" style={{ '--row-index': i } as React.CSSProperties}>
              <span className="text-xs text-primary truncate">{resolveUserName(userId)}</span>
              <select
                aria-label={t('notificationRoles.roleFor', { name: resolveUserName(userId), defaultValue: 'Role for {{name}}' })}
                value={roleOf(userId)}
                disabled={!isAdmin || pending}
                onChange={(e) => assignMutation.mutate({ userId, role: e.target.value || null })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">{t('notificationRoles.none', { defaultValue: 'No role' })}</option>
                {data.roles.map((role) => (
                  <option key={role.key} value={role.key}>{roleLabel(role)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border mt-5 pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">
          {t('notificationRoles.roles', { defaultValue: 'Roles' })}
        </p>
        <p className="text-xs text-muted mb-3">
          {t('orgRoles.rolesDesc', { defaultValue: 'What each role hears, on every ticket, the member’s own included. A member without a role hears about the tickets they created, are assigned to or requested. A status a project does not have is simply never sent there.' })}
        </p>
        <RoleDefinitionsEditor
          roles={data.roles}
          statuses={orgStatuses(projects, orgId)}
          holdersOf={holdersOf}
          onChange={(roles, done) => rolesMutation.mutate(roles, { onSuccess: done })}
          onError={setError}
          pending={pending}
          readOnly={!isAdmin}
        />
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    </>,
  );
}
