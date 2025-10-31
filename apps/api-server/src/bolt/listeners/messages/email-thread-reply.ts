import { Inbound } from '@inboundemail/sdk';
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { getInboundApiKey } from '../../utils/config';
import { convertSlackEmojisToEmojis } from '../../utils/slack-emoji-converter';
import { threadStorage } from '../../utils/thread-storage';

/**
 * Handles when a user replies in a Slack thread to send an email reply via Inbound
 */
export const emailThreadReply = async ({
  event,
  client,
  logger,
}: AllMiddlewareArgs & SlackEventMiddlewareArgs<'message'>) => {
  try {
    // Only process messages in threads (thread_ts exists and it's not the parent message)
    if (!('thread_ts' in event) || !event.thread_ts || event.thread_ts === event.ts) {
      return;
    }

    // Ignore bot messages and messages with subtypes (except for threaded_replies)
    if (event.subtype && event.subtype !== 'thread_broadcast') {
      return;
    }

    // Atomic idempotency check: Check and mark as processed in one operation
    const alreadyProcessed = await threadStorage.checkAndMarkSlackMessageProcessed(event.ts);
    if (alreadyProcessed) {
      logger.info(`Message ${event.ts} already processed, skipping duplicate`);
      return;
    }

    // Get the Inbound thread ID from storage
    const inboundThreadId = await threadStorage.getInboundThreadId(event.thread_ts);
    if (!inboundThreadId) {
      // Fetch thread parent message for debugging
      let parentMessageInfo = 'unknown';
      try {
        const channel = 'channel' in event ? event.channel : '';
        const threadInfo = await client.conversations.replies({
          channel,
          ts: event.thread_ts,
          limit: 1,
          inclusive: true,
        });
        const parentMsg = threadInfo.messages?.[0];
        if (parentMsg) {
          const previewText = parentMsg.text?.substring(0, 50) || '';
          // biome-ignore lint/suspicious/noExplicitAny: Slack API types don't include username
          const username =
            (parentMsg as any).username || parentMsg.bot_id || (parentMsg.user ? `user ${parentMsg.user}` : 'unknown');
          parentMessageInfo = `"${previewText}..." by ${username}`;
        }
      } catch (debugError) {
        logger.warn('Could not fetch thread parent for debugging:', debugError);
      }

      logger.info(
        'No Inbound thread found for this Slack thread, skipping.\n' +
          `  Thread TS: ${event.thread_ts}\n` +
          `  Channel: ${'channel' in event ? event.channel : 'unknown'}\n` +
          `  Parent message: ${parentMessageInfo}\n` +
          '  This thread may have been created before the email integration was set up.',
      );
      return;
    }

    // Get the original email ID
    const emailId = await threadStorage.getEmailId(event.thread_ts);
    if (!emailId) {
      logger.warn(
        'No email ID found for thread, cannot send reply.\n' +
          `  Thread TS: ${event.thread_ts}\n` +
          `  Inbound Thread ID: ${inboundThreadId}\n` +
          '  This may indicate a storage inconsistency.',
      );
      return;
    }

    // Get message text
    let messageText = 'text' in event ? event.text : '';
    if (!messageText) {
      logger.info('No text in message, skipping');
      return;
    }

    // Convert Slack emoji syntax to Unicode emojis
    messageText = await convertSlackEmojisToEmojis(messageText, client, 'html');

    // Get user info for the sender
    const userId = 'user' in event ? event.user : undefined;
    let realName = 'Slack User';

    if (userId) {
      try {
        const userInfo = await client.users.info({ user: userId });
        realName = userInfo.user?.real_name || userInfo.user?.name || realName;
        console.log('users real name:', realName);
      } catch (error) {
        logger.warn('Could not fetch user info:', error);
      }
    } 

    // Generate email username from real name
    // Convert to lowercase, replace spaces with dots, only keep alphanumeric and dots
    const generateUsername = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/\s+/g, '.') // Replace spaces with dots
        .replace(/[^a-z0-9.]/g, ''); // Remove non-alphanumeric except dots
    };

    const generatedUsername = generateUsername(realName);
    const sendingDomain = 'inbound.new'; // THIS IS HARDCODED FOR NOW WILL NEED TO UPDATE THIS
    const generatedEmail = `${generatedUsername}@${sendingDomain}`;

    logger.info(`Sending email from: ${generatedEmail}`);

    // Send reply via Inbound
    const inbound = new Inbound(getInboundApiKey());

    logger.info(`Sending email reply to thread ${inboundThreadId} (email ${emailId})`);

    const response = await inbound.reply(emailId, {
      html: messageText, // Use HTML format to support inline images for custom emojis
      text: messageText.replace(/<img[^>]*>/g, ''), // Fallback plain text without img tags
      from: generatedEmail,
    });

    logger.info(`Email reply sent successfully: ${response.data?.id}`);

    // Note: Message is already marked as processed by the atomic check at the beginning

    // React to the message to confirm it was sent
    await client.reactions.add({
      channel: 'channel' in event ? event.channel : '',
      timestamp: event.ts,
      name: 'white_check_mark',
    });
  } catch (error) {
    logger.error('Error handling email thread reply:', error);

    // React with error emoji
    try {
      await client.reactions.add({
        channel: 'channel' in event ? event.channel : '',
        timestamp: event.ts,
        name: 'x',
      });
    } catch (reactionError) {
      logger.error('Could not add error reaction:', reactionError);
    }
  }
};
