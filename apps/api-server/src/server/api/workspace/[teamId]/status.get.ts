import { eventHandler, createError, getRouterParam } from 'h3';
import { validateInternalRequest } from '../../../../bolt/middleware/validate-internal-request';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../../db';

/**
 * Check if the bot is installed in a workspace
 * Returns installation status and details
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
    // Check if bot is installed and active
    const installation = await db.query.workspaceInstallations.findFirst({
      where: and(
        eq(schema.workspaceInstallations.teamId, teamId),
        eq(schema.workspaceInstallations.isActive, true)
      ),
      columns: {
        teamId: true,
        teamName: true,
        teamUrl: true,
        botUserId: true,
        scopes: true,
        installedAt: true,
        installedBy: true,
      },
    });
    
    if (!installation) {
      return {
        success: true,
        installed: false,
      };
    }
    
    return {
      success: true,
      installed: true,
      data: {
        teamId: installation.teamId,
        teamName: installation.teamName,
        teamUrl: installation.teamUrl,
        botUserId: installation.botUserId,
        scopes: installation.scopes.split(','),
        installedAt: installation.installedAt,
        installedBy: installation.installedBy,
      },
    };
  } catch (error) {
    console.error('Error checking installation status:', error);
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to check installation status',
    });
  }
});

