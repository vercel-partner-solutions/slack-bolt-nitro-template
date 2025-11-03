import { eventHandler, createError, getRouterParam, readBody } from 'h3';
import { validateInternalRequest } from '../../../../../../bolt/middleware/validate-internal-request';
import { installationStore } from '../../../../../../bolt/utils/installation-store';
import { WebClient } from '@slack/web-api';

/**
 * Add a user to an existing Slack channel
 * Secured with internal API key validation
 */
export default eventHandler(async (event) => {
  // Validate internal API key
  await validateInternalRequest(event);
  
  const teamId = getRouterParam(event, 'teamId');
  const channelId = getRouterParam(event, 'channelId');
  
  if (!teamId) {
    throw createError({
      statusCode: 400,
      message: 'teamId is required',
    });
  }
  
  if (!channelId) {
    throw createError({
      statusCode: 400,
      message: 'channelId is required',
    });
  }
  
  try {
    const body = await readBody(event);
    const { userId } = body;
    
    if (!userId || typeof userId !== 'string') {
      throw createError({
        statusCode: 400,
        message: 'userId is required',
      });
    }
    
    // Check if bot is installed in this workspace
    let installation;
    try {
      installation = await installationStore.fetchInstallation({ teamId, isEnterpriseInstall: false, enterpriseId: undefined });
    } catch (error) {
      throw createError({
        statusCode: 500,
        message: 'Failed to fetch installation',
      });
    }
    
    // Use bot token to add user to channel
    const client = new WebClient(installation.bot?.token);
    
    let userAdded = false;
    
    try {
      const inviteResult = await client.conversations.invite({
        channel: channelId,
        users: userId,
      });
      
      if (inviteResult.ok) {
        userAdded = true;
        console.log(`[channels/members.post] ✅ Added user ${userId} to channel ${channelId}`);
      } else {
        // Check if error is because user is already in channel
        if (inviteResult.error === 'already_in_channel') {
          console.log(`[channels/members.post] ℹ️  User ${userId} already in channel ${channelId}`);
          return {
            success: true,
            userAdded: false,
            alreadyMember: true,
          };
        } else if (inviteResult.error === 'cant_invite_self') {
          console.log(`[channels/members.post] ℹ️  Cannot invite self to channel ${channelId}`);
          return {
            success: true,
            userAdded: false,
            message: 'Cannot invite yourself',
          };
        } else {
          console.warn(`[channels/members.post] ⚠️  Failed to add user to channel: ${inviteResult.error}`);
          return {
            success: false,
            error: inviteResult.error || 'Failed to add user to channel',
          };
        }
      }
    } catch (error) {
      console.error('[channels/members.post] Error adding user to channel:', error);
      // Don't fail completely - return error info
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add user to channel',
      };
    }
    
    return {
      success: true,
      userAdded,
    };
  } catch (error) {
    // If it's already a createError, re-throw it
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error;
    }
    
    console.error('Error adding user to channel:', error);
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to add user to channel',
    });
  }
});

