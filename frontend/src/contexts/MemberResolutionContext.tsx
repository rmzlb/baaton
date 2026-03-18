import { createContext, useContext, type ReactNode } from 'react';

interface MemberResolution {
  resolveUserName: (userId?: string | null, fallbackName?: string | null) => string;
  resolveUserAvatar: (userId?: string | null) => string | null;
}

/**
 * Optional context for cross-org member resolution.
 * When provided (e.g., in AllIssues), children use this instead of useClerkMembers.
 * When absent, consumers fall back to useClerkMembers.
 */
export const MemberResolutionContext = createContext<MemberResolution | null>(null);

export function MemberResolutionProvider({
  resolveUserName,
  resolveUserAvatar,
  children,
}: MemberResolution & { children: ReactNode }) {
  return (
    <MemberResolutionContext.Provider value={{ resolveUserName, resolveUserAvatar }}>
      {children}
    </MemberResolutionContext.Provider>
  );
}

export function useMemberResolutionContext() {
  return useContext(MemberResolutionContext);
}
