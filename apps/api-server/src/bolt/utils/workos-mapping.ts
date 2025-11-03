import { WorkOS } from '@workos-inc/node';
import { db, schema } from '../../server/db';
import { eq } from 'drizzle-orm';

/**
 * Get WorkOS API key from environment
 */
function getWorkOsApiKey(): string {
	const apiKey = process.env.WORKOS_API_KEY;
	if (!apiKey) {
		throw new Error('WORKOS_API_KEY environment variable is not set');
	}
	return apiKey;
}

/**
 * Initialize WorkOS client
 */
function getWorkOsClient(): WorkOS {
	return new WorkOS(getWorkOsApiKey());
}

/**
 * Check if a Slack user is authorized to use the bot
 * 
 * For now, this checks if the workspace has the bot installed and is active.
 * In the future, this can be enhanced to require individual user authentication
 * by checking if the Slack user has a linked WorkOS account.
 * 
 * @param slackUserId - Slack user ID (e.g., U01234567)
 * @param teamId - Slack workspace team ID (e.g., T01234567)
 * @returns Object with authentication status and WorkOS organization ID
 */
export async function getWorkOsUserFromSlackUser(
	slackUserId: string,
	teamId: string,
): Promise<{
	isAuthenticated: boolean;
	workosOrganizationId: string | null;
	workosUserId: string | null;
	reason?: string;
}> {
	try {
		// Look up workspace installation
		const installations = await db
			.select()
			.from(schema.workspaceInstallations)
			.where(eq(schema.workspaceInstallations.teamId, teamId))
			.limit(1);

		if (installations.length === 0) {
			return {
				isAuthenticated: false,
				workosOrganizationId: null,
				workosUserId: null,
				reason: 'workspace_not_installed',
			};
		}

		const installation = installations[0];

		// Check if installation is active
		if (!installation.isActive || installation.uninstalledAt) {
			return {
				isAuthenticated: false,
				workosOrganizationId: null,
				workosUserId: null,
				reason: 'workspace_inactive',
			};
		}

		// Check if workspace has WorkOS organization
		if (!installation.workosOrganizationId) {
			return {
				isAuthenticated: false,
				workosOrganizationId: null,
				workosUserId: null,
				reason: 'no_workos_organization',
			};
		}

		// TODO: In the future, enhance this to check if the specific Slack user
		// has authenticated individually with WorkOS. For now, we assume all users
		// in an installed workspace are authenticated.
		
		// For now, use the installer's WorkOS user ID as a proxy
		// In a full implementation, each Slack user would need to authenticate
		// individually and we'd store their Slack user ID → WorkOS user ID mapping
		const workosUserId = installation.installedBy;

		return {
			isAuthenticated: true,
			workosOrganizationId: installation.workosOrganizationId,
			workosUserId,
		};
	} catch (error) {
		console.error('[WorkOS] Error checking user authentication:', error);
		return {
			isAuthenticated: false,
			workosOrganizationId: null,
			workosUserId: null,
			reason: 'error',
		};
	}
}

/**
 * Get WorkOS organization members
 * 
 * @param organizationId - WorkOS organization ID
 * @returns List of organization members
 */
export async function getOrganizationMembers(organizationId: string) {
	try {
		const workos = getWorkOsClient();
		const members = await workos.userManagement.listOrganizationMemberships({
			organizationId,
		});
		return members.data;
	} catch (error) {
		console.error('[WorkOS] Error getting organization members:', error);
		throw error;
	}
}

/**
 * Check if a user is an admin of the organization
 * 
 * @param workosUserId - WorkOS user ID
 * @param organizationId - WorkOS organization ID
 * @returns True if user is an admin
 */
export async function isUserAdmin(
	workosUserId: string,
	organizationId: string,
): Promise<boolean> {
	try {
		const members = await getOrganizationMembers(organizationId);
		const member = members.find((m) => m.userId === workosUserId);
		return member?.role?.slug === 'admin';
	} catch (error) {
		console.error('[WorkOS] Error checking admin status:', error);
		return false;
	}
}

