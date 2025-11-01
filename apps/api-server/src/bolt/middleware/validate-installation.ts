import type { AllMiddlewareArgs, Middleware, SlackEventMiddlewareArgs } from '@slack/bolt';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../server/db';

/**
 * Middleware to validate that events come from active workspace installations
 * Rejects events from uninstalled or inactive workspaces
 */
export const validateInstallation: Middleware<SlackEventMiddlewareArgs> = async ({
  event,
  logger,
  next,
}) => {
  // Extract team_id from event
  // biome-ignore lint/suspicious/noExplicitAny: Slack event types don't expose team_id consistently
  const teamId = (event as any).team || (event as any).team_id;
  
  if (!teamId) {
    logger.warn('Event missing team_id, skipping validation');
    // Log the request in dev mode for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log('Request without team_id:', {
        event,
        eventType: (event as any).type,
        eventSubtype: (event as any).subtype,
        fullEvent: JSON.stringify(event, null, 2),
      });
    }
    // Allow event to proceed - some events might not have team_id
    return await next();
  }
  
  try {
    // Verify installation exists and is active
    const installation = await db.query.workspaceInstallations.findFirst({
      where: and(
        eq(schema.workspaceInstallations.teamId, teamId),
        eq(schema.workspaceInstallations.isActive, true)
      ),
    });
    
    if (!installation) {
      logger.warn(`Event from uninstalled or inactive workspace: ${teamId}`);
      // Don't call next() - reject the event
      return;
    }
    
    // Installation is valid, proceed with event processing
    return await next();
  } catch (error) {
    logger.error('Error validating installation:', error);
    // On error, reject the event to be safe
    return;
  }
};

