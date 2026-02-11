import { useCallback } from 'react';
import { useOrganization } from '@clerk/clerk-react';

function extractNameFromIdentifier(identifier?: string | null): string | null {
  if (!identifier) return null;
  const local = identifier.split('@')[0]?.trim();
  if (!local) return null;

  // yacine.laieb -> "Yacine Laieb"
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function memberDisplayName(member: any, fallbackUserId?: string | null): string {
  const first = member?.publicUserData?.firstName || '';
  const last = member?.publicUserData?.lastName || '';
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;

  const fromIdentifier = extractNameFromIdentifier(member?.publicUserData?.identifier);
  if (fromIdentifier) return fromIdentifier;

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
      if (fallbackName) return fallbackName;
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
