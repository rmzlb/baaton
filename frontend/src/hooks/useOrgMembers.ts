import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';

export interface OrgMember {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  image_url: string;
  role: string;
}

/**
 * Fetch members for a specific org via backend (Clerk server-side).
 * Use this instead of useClerkMembers when you need members for an org
 * that may differ from the currently active org (e.g., cross-org triage).
 */
export function useOrgMembers(orgId: string | undefined | null) {
  const apiClient = useApi();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      // api.get auto-unwraps .data from { data: [...] } responses
      return apiClient.get<OrgMember[]>(`/orgs/${orgId}/members`);
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 min cache — org members don't change often
  });

  const resolveUserName = useCallback(
    (userId?: string | null): string => {
      if (!userId) return '?';
      const member = members.find((m) => m.user_id === userId);
      if (member) {
        const name = `${member.first_name} ${member.last_name}`.trim();
        return name || member.email || userId.slice(0, 12);
      }
      return userId.slice(0, 12);
    },
    [members],
  );

  const resolveUserAvatar = useCallback(
    (userId?: string | null): string | null => {
      if (!userId) return null;
      const member = members.find((m) => m.user_id === userId);
      return member?.image_url || null;
    },
    [members],
  );

  return { members, isLoading, resolveUserName, resolveUserAvatar };
}
