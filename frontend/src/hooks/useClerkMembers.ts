import { useCallback } from 'react';
import { useOrganization } from '@clerk/clerk-react';

/**
 * Hook to resolve Clerk user IDs → display names using org membership data.
 * Falls back to stored name, then truncated ID.
 */
export function useClerkMembers() {
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const orgMembers = memberships?.data ?? [];

  const resolveUserName = useCallback(
    (userId?: string | null, fallbackName?: string | null): string => {
      if (fallbackName) return fallbackName;
      if (!userId) return '?';
      const member = orgMembers.find(
        (m: any) => m.publicUserData?.userId === userId,
      );
      if (member) {
        const name = `${member.publicUserData?.firstName || ''} ${member.publicUserData?.lastName || ''}`.trim();
        if (name) return name;
      }
      return userId.slice(0, 12);
    },
    [orgMembers],
  );

  const resolveUserAvatar = useCallback(
    (userId?: string | null): string | null => {
      if (!userId) return null;
      const member = orgMembers.find(
        (m: any) => m.publicUserData?.userId === userId,
      );
      return member?.publicUserData?.imageUrl || null;
    },
    [orgMembers],
  );

  return { orgMembers, resolveUserName, resolveUserAvatar };
}
