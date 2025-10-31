import { eventHandler, createError, getRouterParam } from 'h3';
import { validateInternalRequest } from '../../../../bolt/middleware/validate-internal-request';
import { installationStore } from '../../../../bolt/utils/installation-store';
import { WebClient } from '@slack/web-api';

/**
 * Get Slack channels for a workspace using the bot token
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
    // Check if bot is installed in this workspace
    let installation;
    try {
      installation = await installationStore.fetchInstallation({ teamId });
    } catch (error) {
      // Bot not installed
      return {
        success: false,
        error: 'bot_not_installed',
        message: 'SlackBound bot is not installed in this workspace. Please install it first.',
      };
    }
    
    // Use bot token to fetch channels
    const client = new WebClient(installation.bot.token);
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
    });
    
    if (!result.ok) {
      throw createError({
        statusCode: 500,
        message: result.error || 'Failed to fetch channels from Slack',
      });
    }
    
    const channels = (result.channels || [])
      .filter((channel) => channel.id && channel.name)
      .map((channel) => ({
        id: channel.id!,
        name: channel.name!,
        isPrivate: channel.is_private || false,
        isMember: channel.is_member || false,
        numMembers: channel.num_members || 0,
      }));
    
    return {
      success: true,
      data: channels,
    };
  } catch (error) {
    console.error('Error fetching workspace channels:', error);
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to fetch channels',
    });
  }
});

