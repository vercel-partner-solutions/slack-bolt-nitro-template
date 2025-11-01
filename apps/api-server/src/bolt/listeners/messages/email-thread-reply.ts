import { Inbound } from '@inboundemail/sdk';
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { getInboundApiKey } from '../../utils/config';
import { convertSlackEmojisToEmojis } from '../../utils/slack-emoji-converter';
import { threadStorage } from '../../utils/thread-storage';
import { db, schema } from '../../../server/db';
import { eq } from 'drizzle-orm';

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
    
    // Get teamId from event to fetch workspace config
    // Slack event types don't expose team_id in the type definition, but it exists at runtime
    // Use type-safe access instead of any
    const eventWithTeam = event as typeof event & { team?: string; team_id?: string };
    const teamId = eventWithTeam.team || eventWithTeam.team_id;
    
    // Fetch workspace config to get sending domain
    let sendingDomain = 'inbound.new'; // Default fallback
    if (teamId) {
      try {
        const workspaceConfig = await db
          .select()
          .from(schema.workspaceConfig)
          .where(eq(schema.workspaceConfig.teamId, teamId))
          .limit(1);
        
        if (workspaceConfig.length > 0 && workspaceConfig[0].sendingDomain) {
          sendingDomain = workspaceConfig[0].sendingDomain;
        }
      } catch (error) {
        logger.warn('Could not fetch workspace config for sending domain, using default:', error);
      }
    }
    
    const senderEmailAddress = `${generatedUsername}@${sendingDomain}`;
    const generatedEmail = `${realName} <${senderEmailAddress}>`;

    logger.info(`Sending email from: ${generatedEmail} (domain: ${sendingDomain})`);

    // Ensure sender's email route exists (auto-create if missing)
    if (teamId) {
      try {
        const normalizedSenderEmail = senderEmailAddress.toLowerCase();
        const existingRoute = await db
          .select()
          .from(schema.emailRoutes)
          .where(eq(schema.emailRoutes.emailAddress, normalizedSenderEmail))
          .limit(1);

        if (existingRoute.length === 0) {
          logger.info(`No email route found for ${senderEmailAddress}, auto-creating...`);
          
          // Get workspace config to find endpoint ID
          const workspaceConfig = await db
            .select()
            .from(schema.workspaceConfig)
            .where(eq(schema.workspaceConfig.teamId, teamId))
            .limit(1);

          const endpointId = workspaceConfig[0]?.inboundEndpointId;
          if (!endpointId) {
            logger.warn(`No endpoint ID found for workspace ${teamId}, cannot auto-create email route`);
          } else {
            // Get channel ID from event
            const channelId = 'channel' in event ? event.channel : null;
            
            // Parse email to get domain
            const emailParts = senderEmailAddress.split('@');
            if (emailParts.length === 2) {
              const domain = emailParts[1];
              const inboundApiKey = getInboundApiKey();

              // Get domain ID from Inbound API
              const domainsResponse = await fetch('https://inbound.new/api/v2/domains', {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${inboundApiKey}`,
                  'Content-Type': 'application/json',
                },
              });

              if (domainsResponse.ok) {
                const domainsData = (await domainsResponse.json()) as { data?: Array<{ domain: string; id: string }> };
                const domainInfo = domainsData.data?.find((d: { domain: string }) => d.domain === domain);

                if (domainInfo?.id) {
                  // Create email address in Inbound.new
                  const emailResponse = await fetch('https://inbound.new/api/v2/email-addresses', {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${inboundApiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      address: senderEmailAddress,
                      domainId: domainInfo.id,
                      endpointId,
                      isActive: true,
                    }),
                  });

                  if (emailResponse.ok) {
                    // Create route in database
                    await db.insert(schema.emailRoutes).values({
                      emailAddress: normalizedSenderEmail,
                      teamId,
                      channelId: channelId || null,
                      isActive: true,
                    });

                    logger.info(`✅ Auto-created email route for ${senderEmailAddress}`);
                  } else {
                    const errorData = (await emailResponse.json().catch(() => ({}))) as { error?: string };
                    logger.warn(`Failed to create email address in Inbound.new: ${errorData.error || emailResponse.statusText}`);
                  }
                } else {
                  logger.warn(`Domain ${domain} not found in Inbound.new account`);
                }
              } else {
                logger.warn('Failed to fetch domains from Inbound.new');
              }
            }
          }
        } else {
          logger.info(`Email route already exists for ${senderEmailAddress}`);
        }
      } catch (error) {
        logger.warn('Error checking/creating email route:', error);
        // Continue with reply even if route creation fails
      }
    }

    // Retrieve original email recipients for reply-all
    const recipients = await threadStorage.getEmailRecipients(event.thread_ts);
    
    // Build reply-all recipient list
    // In reply-all: original sender goes to "to", all original to/cc recipients go to "to" and "cc"
    let replyTo: string[] = [];
    let replyCc: string[] = [];

    if (recipients) {
      // Original sender should be in "to"
      if (recipients.from?.address) {
        replyTo.push(recipients.from.address);
      }

      // All original "to" recipients (excluding sender) go to "to"
      for (const toRecipient of recipients.to) {
        if (toRecipient.address !== recipients.from?.address) {
          replyTo.push(toRecipient.address);
        }
      }

      // All original "cc" recipients go to "cc"
      if (recipients.cc) {
        for (const ccRecipient of recipients.cc) {
          if (ccRecipient.address !== recipients.from?.address) {
            replyCc.push(ccRecipient.address);
          }
        }
      }

      logger.info(`Reply-all recipients - To: ${replyTo.length}, CC: ${replyCc.length}`);
    } else {
      logger.info('No recipient information found, sending simple reply');
    }

    // Send reply via Inbound
    const inbound = new Inbound(getInboundApiKey());

    logger.info(`Sending email reply to thread ${inboundThreadId} (email ${emailId})`);

    // Build reply options with recipients for reply-all
    const replyOptions: {
      html: string;
      text: string;
      from: string;
      to?: string[];
      cc?: string[];
    } = {
      html: messageText, // Use HTML format to support inline images for custom emojis
      text: messageText.replace(/<img[^>]*>/g, ''), // Fallback plain text without img tags
      from: generatedEmail,
    };

    // Add recipients if we have them (reply-all functionality)
    if (replyTo.length > 0) {
      replyOptions.to = replyTo;
    }
    if (replyCc.length > 0) {
      replyOptions.cc = replyCc;
    }

    const response = await inbound.reply(emailId, replyOptions);

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
