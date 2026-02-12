import { useCallback } from 'react';
import { useOrganization } from '@clerk/clerk-react';

function truncateEmail(email: string, max = 24): string {
  if (email.length <= max) return email;
  return `${email.slice(0, max - 1)}…`;
}

function memberDisplayName(member: any, fallbackUserId?: string | null): string {
  const first = member?.publicUserData?.firstName || '';
  const last = member?.publicUserData?.lastName || '';
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;

  const identifier = member?.publicUserData?.identifier;
  if (identifier && typeof identifier === 'string') {
    return truncateEmail(identifier);
  }

  const username = member?.username || member?.publicUserData?.username;
  if (username) return username;

  return fallbackUserId?.slice(0, 12) || '?';
}

/**
 * Hook to resolve Clerk user IDs → display names using org membership data.
 * Falls back to identifier (email local-part) then truncated ID.
 */
export function useClerkMembers() {
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const orgMembers = memberships?.data ?? [];

  const resolveUserName = useCallback(
    (userId?: string | null, fallbackName?: string | null): string => {
      const cleanedFallback = (fallbackName || '').trim();
      if (cleanedFallback) {
        const isUserId = cleanedFallback.startsWith('user_') || (userId && cleanedFallback === userId);
        const isEmail = cleanedFallback.includes('@');
        if (isEmail) return truncateEmail(cleanedFallback);
        if (!isUserId) return cleanedFallback;
      }

      if (!userId) return '?';
      const member = orgMembers.find(
        (m: any) => m.publicUserData?.userId === userId,
      );
      if (member) return memberDisplayName(member, userId);
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
