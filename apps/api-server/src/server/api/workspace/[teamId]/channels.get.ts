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
      installation = await installationStore.fetchInstallation({ teamId, isEnterpriseInstall: false, enterpriseId: undefined });
    } catch (error) {
      // Bot not installed
      console.error(`[channels.get] Installation not found for team ${teamId}:`, error);
      return {
        success: false,
        error: 'bot_not_installed',
        message: 'SlackBound bot is not installed in this workspace. Please install it first.',
      };
    }
    
    // Validate bot token exists
    if (!installation.bot || !installation.bot.token) {
      console.error(`[channels.get] Bot token missing for team ${teamId}`);
      return {
        success: false,
        error: 'bot_not_installed',
        message: 'SlackBound bot token not found. Please reinstall the bot.',
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
    console.error(`[channels.get] Error fetching channels for team ${teamId}:`, error);
    
    // If it's a known error, return it as a proper response
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error;
    }
    
    // Log full error details for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[channels.get] Full error details:', { errorMessage, errorStack });
    
    throw createError({
      statusCode: 500,
      message: errorMessage || 'Failed to fetch channels',
    });
  }
});

