import { workos } from './workos-client';

/**
 * Get or create a WorkOS organization for a Slack workspace
 * Stores teamId in organization externalId for lookup
 * 
 * @param teamId - Slack workspace team ID
 * @param teamName - Slack workspace name
 * @returns WorkOS organization object
 */
export async function getOrCreateOrganization(teamId: string, teamName: string) {
  // Check if organization exists by external ID (teamId)
  try {
    const org = await workos.organizations.getOrganizationByExternalId(teamId);
    console.log(`[WorkOS] Found existing organization for team ${teamId}:`, org.id);
    return org;
  } catch (error) {
    // Organization doesn't exist, create it
    console.log(`[WorkOS] Creating new organization for team ${teamId}:`, teamName);
    const org = await workos.organizations.createOrganization({
      name: teamName,
      externalId: teamId,
      metadata: {
        slackTeamId: teamId,
        slackTeamName: teamName,
      },
    });
    console.log(`[WorkOS] Created organization:`, org.id);
    return org;
  }
}

/**
 * Add a user to an organization
 * Checks if membership already exists before creating
 * 
 * @param workosUserId - WorkOS user ID
 * @param organizationId - WorkOS organization ID
 * @param role - Role slug ('admin' or 'member'), defaults to 'member'
 * @returns Organization membership object
 */
export async function addUserToOrganization(
  workosUserId: string,
  organizationId: string,
  role: 'admin' | 'member' = 'member'
) {
  // Check if membership already exists
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId: workosUserId,
    organizationId,
  });

  if (memberships.data.length > 0) {
    console.log(`[WorkOS] User ${workosUserId} already member of org ${organizationId}`);
    return memberships.data[0]; // Already a member
  }

  // Create membership with specified role
  console.log(`[WorkOS] Adding user ${workosUserId} to org ${organizationId} as ${role}`);
  const membership = await workos.userManagement.createOrganizationMembership({
    userId: workosUserId,
    organizationId,
    roleSlug: role,
  });
  
  console.log(`[WorkOS] Created membership:`, membership.id, `with role:`, role);
  return membership;
}

/**
 * Get organization by Slack team ID
 * 
 * @param teamId - Slack workspace team ID
 * @returns WorkOS organization object or null if not found
 */
export async function getOrganizationByTeamId(teamId: string) {
  try {
    return await workos.organizations.getOrganizationByExternalId(teamId);
  } catch (error) {
    console.log(`[WorkOS] Organization not found for team ${teamId}`);
    return null;
  }
}

