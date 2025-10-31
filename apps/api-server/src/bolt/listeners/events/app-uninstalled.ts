import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../server/db';

/**
 * Handle app_uninstalled event to mark workspace as inactive
 */
export const appUninstalled = async ({
  event,
  logger,
}: AllMiddlewareArgs & SlackEventMiddlewareArgs<'app_uninstalled'>) => {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: Event type doesn't expose team_id
    const teamId = (event as any).team_id;
    
    if (!teamId) {
      logger.warn('app_uninstalled event missing team_id');
      return;
    }
    
    logger.info(`Processing app uninstallation for team: ${teamId}`);
    
    // Soft delete - mark installation as inactive
    await db
      .update(schema.workspaceInstallations)
      .set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaceInstallations.teamId, teamId));
    
    logger.info(`Marked workspace ${teamId} as uninstalled`);
    
    // TODO: Optionally notify the installer via email
    // const installation = await db.query.workspaceInstallations.findFirst({
    //   where: eq(schema.workspaceInstallations.teamId, teamId),
    // });
    // if (installation?.installedBy) {
    //   // Send notification email
    // }
  } catch (error) {
    logger.error('Error handling app_uninstalled event:', error);
  }
};

