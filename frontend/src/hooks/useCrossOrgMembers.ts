import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import type { OrgMember } from '@/hooks/useOrgMembers';

/**
 * Resolves user names/avatars across multiple orgs.
 * Used in AllIssues where issues come from different orgs
 * and the active Clerk org only covers one.
 */
export function useCrossOrgMembers(orgIds: string[]) {
  const apiClient = useApi();

  // Deduplicate + stabilize
  const uniqueOrgIds = useMemo(() => {
    const ids = [...new Set(orgIds.filter(Boolean))];
    ids.sort();
    return ids;
  }, [orgIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const queries = useQueries({
    queries: uniqueOrgIds.map((orgId) => ({
      queryKey: ['org-members', orgId],
      queryFn: () => apiClient.get<OrgMember[]>(`/orgs/${orgId}/members`),
      staleTime: 5 * 60_000,
      enabled: !!orgId,
    })),
  });

  // Merge all members into a single map (userId → member)
  const memberMap = useMemo(() => {
    const map = new Map<string, OrgMember>();
    for (const q of queries) {
      if (!q.data) continue;
      for (const m of q.data) {
        if (!map.has(m.user_id)) map.set(m.user_id, m);
      }
    }
    return map;
  }, [queries.map((q) => q.dataUpdatedAt).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveUserName = useCallback(
    (userId?: string | null): string => {
      if (!userId) return '?';
      const member = memberMap.get(userId);
      if (member) {
        const name = `${member.first_name} ${member.last_name}`.trim();
        return name || member.email || userId.slice(0, 12);
      }
      return userId.slice(0, 12);
    },
    [memberMap],
  );

  const resolveUserAvatar = useCallback(
    (userId?: string | null): string | null => {
      if (!userId) return null;
      const member = memberMap.get(userId);
      return member?.image_url || null;
    },
    [memberMap],
  );

  const isLoading = queries.some((q) => q.isLoading);

  return { resolveUserName, resolveUserAvatar, isLoading, memberMap };
}
