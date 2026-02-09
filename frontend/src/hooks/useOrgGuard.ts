/**
 * Auto-selects the first organization if none is active.
 * Clerk only sends org_id in JWT when an org is explicitly set active.
 * This hook ensures the user always has an active org.
 */
import { useEffect, useRef } from 'react';
import { useOrganizationList, useOrganization } from '@clerk/clerk-react';

export function useOrgGuard() {
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { userMemberships, isLoaded: listLoaded, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const didSet = useRef(false);

  useEffect(() => {
    if (!orgLoaded || !listLoaded || didSet.current) return;

    const memberships = userMemberships?.data;

    // If no active org but user has orgs → auto-select the first one
    if (!organization && memberships && memberships.length > 0) {
      didSet.current = true;
      const firstOrg = memberships[0].organization;
      setActive?.({ organization: firstOrg.id }).catch(console.error);
    }
  }, [orgLoaded, listLoaded, organization, userMemberships?.data, setActive]);

  const memberships = userMemberships?.data;
  const hasOrgs = (memberships?.length ?? 0) > 0;

  return {
    isReady: orgLoaded && listLoaded && (!!organization || !hasOrgs),
    organization,
    hasOrgs,
  };
}
