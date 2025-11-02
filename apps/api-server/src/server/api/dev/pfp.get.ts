import { eventHandler, createError } from 'h3';
import { app } from '../../../bolt/app';
import { getInboundEmailChannelId } from '../../../bolt/utils/config';

/**
 * Test endpoint to verify chat:write.customize scope is working
 * GET /api/dev/pfp
 * 
 * SECURITY: Only available in development environment
 */
export default eventHandler(async (event) => {
  // Only allow in development environment
  if (process.env.NODE_ENV === 'production' || !process.env.NODE_ENV || process.env.NODE_ENV === 'test') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    });
  }

  try {
    const channelId = getInboundEmailChannelId();

    // Test 1: Custom username + inbound.new avatar API
    const testEmail = 'test@example.com';
    const testName = 'Test User';
    const avatarUrl = `https://inbound.new/api/avatar?${new URLSearchParams({ email: testEmail, name: testName }).toString()}`;

    const response1 = await app.client.chat.postMessage({
      channel: channelId,
      text: '🧪 Test message with custom username and avatar',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🧪 *Test Message #1*\n\nIf you see this with a custom username ("Test User") and avatar from inbound.new, then `chat:write.customize` is working!',
          },
        },
      ],
      username: testName,
      icon_url: avatarUrl,
      unfurl_links: false,
      unfurl_media: false,
    });

    // Test 2: Different user with emoji
    const response2 = await app.client.chat.postMessage({
      channel: channelId,
      text: '🧪 Test message with emoji icon',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🧪 *Test Message #2*\n\nIf you see this with username "Email Bot" and a 📧 emoji icon, the scope is working!',
          },
        },
      ],
      username: 'Email Bot',
      icon_emoji: ':email:',
      unfurl_links: false,
      unfurl_media: false,
    });

    return {
      success: true,
      message: 'Test messages posted successfully',
      messages: [
        {
          ts: response1.ts,
          username: testName,
          icon_url: avatarUrl,
        },
        {
          ts: response2.ts,
          username: 'Email Bot',
          icon_emoji: ':email:',
        },
      ],
      instructions: [
        '✅ If both messages show custom usernames/icons: chat:write.customize is working!',
        '❌ If messages show "inbound - dev": You need to reinstall the app',
      ],
    };
  } catch (error) {
    console.error('Error posting test message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      instructions: [
        'Check that SLACK_BOT_TOKEN is set correctly',
        'Verify the bot is in the channel',
        'Make sure chat:write.customize scope is in the app manifest',
      ],
    };
  }
});
