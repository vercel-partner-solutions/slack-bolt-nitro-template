import { eventHandler, createError, getRouterParam, readBody } from 'h3';
import { validateInternalRequest } from '../../../../bolt/middleware/validate-internal-request';
import { installationStore } from '../../../../bolt/utils/installation-store';
import { WebClient } from '@slack/web-api';

/**
 * Create a Slack channel in a workspace using the bot token
 * Secured with internal API key validation
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
    const body = await readBody(event);
    const { name, isPrivate, userId } = body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw createError({
        statusCode: 400,
        message: 'Channel name is required',
      });
    }
    
    // Validate channel name (Slack requirements)
    const channelName = name.trim().toLowerCase();
    if (channelName.length < 1 || channelName.length > 80) {
      throw createError({
        statusCode: 400,
        message: 'Channel name must be between 1 and 80 characters',
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
    
    // Use bot token to create channel
    const client = new WebClient(installation.bot?.token);
    const result = await client?.conversations.create({
      name: channelName,
      is_private: Boolean(isPrivate),
    });
    
    if (!result.ok) {
      // Handle specific Slack errors
      if (result.error === 'name_taken') {
        return {
          success: false,
          error: 'name_taken',
          message: `A channel named #${channelName} already exists`,
        };
      }
      
      throw createError({
        statusCode: 500,
        message: result.error || 'Failed to create channel in Slack',
      });
    }
    
    if (!result.channel) {
      throw createError({
        statusCode: 500,
        message: 'Channel creation succeeded but no channel data returned',
      });
    }
    
    const channelId = result.channel.id!;
    let userAdded = false;
    
    // Add the user to the channel if userId is provided
    if (userId && typeof userId === 'string') {
      try {
        const inviteResult = await client.conversations.invite({
          channel: channelId,
          users: userId,
        });
        
        if (inviteResult.ok) {
          userAdded = true;
          console.log(`[channels.post] ✅ Added user ${userId} to channel ${channelName}`);
        } else {
          // Log but don't fail - user might already be in channel or invite might have failed
          console.warn(`[channels.post] ⚠️  Failed to add user to channel: ${inviteResult.error}`);
        }
      } catch (error) {
        // Log but don't fail - channel was created successfully
        console.warn(`[channels.post] ⚠️  Error adding user to channel:`, error);
      }
    }
    
    return {
      success: true,
      data: {
        id: channelId,
        name: result.channel.name,
        isPrivate: result.channel.is_private || false,
        userAdded,
      },
    };
  } catch (error) {
    // If it's already a createError, re-throw it
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error;
    }
    
    console.error('Error creating workspace channel:', error);
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to create channel',
    });
  }
});

