import { eventHandler, createError, getRouterParam } from 'h3';
import { validateInternalRequest } from '../../../../bolt/middleware/validate-internal-request';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { checkSeatAvailability } from '../../../../bolt/utils/autumn-client';

/**
 * Get Autumn seat usage information for a workspace
 * Returns current usage, limit, and availability status
 */
export default eventHandler(async (event) => {
	// Validate internal API key
	await validateInternalRequest(event);
	
	const teamId = getRouterParam(event, 'teamId');
	
	if (!teamId) {
		throw createError({
			statusCode: 400,
			message: 'teamId is required',
		});
	}
	
	try {
		// Get workspace installation to find WorkOS organization ID
		const installation = await db.query.workspaceInstallations.findFirst({
			where: eq(schema.workspaceInstallations.teamId, teamId),
			columns: {
				workosOrganizationId: true,
			},
		});
		
		if (!installation?.workosOrganizationId) {
			return {
				success: false,
				error: 'Workspace organization not found',
			};
		}
		
		// Check seat availability using Autumn
		// The WorkOS organization ID is used as the Autumn customer ID
		const seatInfo = await checkSeatAvailability(installation.workosOrganizationId);
		
		return {
			success: true,
			data: {
				currentUsage: seatInfo.currentUsage,
				limit: seatInfo.limit,
				allowed: seatInfo.allowed,
				available: Math.max(0, seatInfo.limit - seatInfo.currentUsage),
			},
		};
	} catch (error) {
		console.error(`[seat-usage.get] Error fetching seat usage for team ${teamId}:`, error);
		
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw createError({
			statusCode: 500,
			message: errorMessage || 'Failed to fetch seat usage',
		});
	}
});

