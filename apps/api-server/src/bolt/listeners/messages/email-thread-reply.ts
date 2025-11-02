import { Inbound } from '@inboundemail/sdk';
import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { createHash } from 'node:crypto';
import { getInboundApiKey } from '../../utils/config';
import { convertSlackEmojisToEmojis } from '../../utils/slack-emoji-converter';
import { threadStorage } from '../../utils/thread-storage';
import { db, schema } from '../../../server/db';
import { eq } from 'drizzle-orm';

/**
 * Helper function to map Slack file types to MIME types
 */
function getContentTypeFromFiletype(filetype: string): string {
  const typeMap: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    txt: 'text/plain',
    csv: 'text/csv',
    // Archives
    zip: 'application/zip',
    tar: 'application/x-tar',
  };

  return typeMap[filetype.toLowerCase()] || 'application/octet-stream';
}

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

    // Ignore bot messages and messages with subtypes (except for threaded_replies and file_share)
    // file_share subtype indicates a file was shared in the message
    if (event.subtype && event.subtype !== 'thread_broadcast' && event.subtype !== 'file_share') {
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

    // Extract subject from parent message (first message in thread usually has subject)
    let subject = '(No Subject)';
    try {
      const channel = 'channel' in event ? event.channel : '';
      const threadInfo = await client.conversations.replies({
        channel,
        ts: event.thread_ts,
        limit: 1,
        inclusive: true,
      });
      const parentMsg = threadInfo.messages?.[0];
      if (parentMsg?.text) {
        // Extract subject if it's in the format "**Subject**\n\nBody" (first message format)
        const lines = parentMsg.text.split('\n');
        if (lines.length > 0 && lines[0].startsWith('**') && lines[0].endsWith('**')) {
          subject = lines[0].replace(/^\*\*|\*\*$/g, '');
        } else {
          // Fallback: use threadId as identifier
          subject = `Thread ${inboundThreadId.substring(0, 10)}`;
        }
      }
    } catch (error) {
      logger.warn('Could not fetch subject from parent message, using fallback:', error);
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
    
    // Process file attachments from Slack
    const attachments: Array<{
      filename: string;
      content: string;
      contentType: string;
    }> = [];

    // Check if message has files attached
    // Files can be in the event directly (for file_share subtype) or we may need to fetch them
    const eventWithFiles = event as typeof event & {
      files?: Array<{
        id: string;
        name?: string;
        mimetype?: string;
        filetype?: string;
        size?: number;
        url_private?: string;
        url_private_download?: string;
      }>;
    };
    
    if (eventWithFiles.files && eventWithFiles.files.length > 0) {
      logger.info(`Processing ${eventWithFiles.files.length} file attachment(s) from Slack`);
      
      for (const file of eventWithFiles.files) {
        try {
          // If file object already has full details (from file_share subtype), use them directly
          // Otherwise, fetch file info from Slack API
          let fileData: {
            id: string;
            name?: string;
            mimetype?: string;
            filetype?: string;
            size?: number;
            url_private?: string;
            url_private_download?: string;
          };

          if (file.url_private || file.url_private_download) {
            // File object already has all the info we need
            fileData = file;
          } else {
            // Need to fetch file info from Slack API
            const fileInfo = await client.files.info({ file: file.id });
            if (!fileInfo.file || !fileInfo.file.id) {
              logger.warn(`File ${file.id} not found`);
              continue;
            }
            // Map Slack File type to our expected structure
            const slackFile = fileInfo.file;
            fileData = {
              id: slackFile.id || file.id, // Use original file.id as fallback
              name: slackFile.name,
              mimetype: slackFile.mimetype,
              filetype: slackFile.filetype,
              size: slackFile.size,
              url_private: slackFile.url_private,
              url_private_download: slackFile.url_private_download,
            };
          }

          // Skip files that are too large (Inbound has size limits)
          const fileSize = fileData.size || 0;
          const maxSize = 25 * 1024 * 1024; // 25MB limit
          if (fileSize > maxSize) {
            logger.warn(`File ${fileData.name} is too large (${fileSize} bytes), skipping`);
            continue;
          }

          // Get download URL - prefer url_private, fallback to url_private_download
          const downloadUrl = fileData.url_private || fileData.url_private_download;
          if (!downloadUrl) {
            logger.warn(`No download URL available for file ${fileData.name || fileData.id}`);
            continue;
          }

          logger.info(`Downloading file: ${fileData.name || fileData.id} (${fileSize} bytes)`);
          
          // Download file from Slack using bot token
          // Slack's private URLs require authentication with the bot token
          const token = process.env.SLACK_BOT_TOKEN;
          if (!token) {
            throw new Error('SLACK_BOT_TOKEN not configured');
          }

          const downloadResponse = await fetch(downloadUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!downloadResponse.ok) {
            throw new Error(`Failed to download file: ${downloadResponse.statusText}`);
          }

          const downloadedData = await downloadResponse.arrayBuffer();

          // Convert to base64
          const base64Content = Buffer.from(downloadedData).toString('base64');
          
          // Determine content type
          const mimetype = fileData.mimetype || 
            (fileData.filetype ? getContentTypeFromFiletype(fileData.filetype) : 'application/octet-stream');
          
          // Get filename
          const filename = fileData.name || `attachment-${fileData.id}`;

          attachments.push({
            filename,
            content: base64Content,
            contentType: mimetype,
          });

          logger.info(`✅ Processed attachment: ${filename} (${mimetype})`);
        } catch (error) {
          logger.error(`Error processing file attachment ${file.id}:`, error);
          // Continue processing other files even if one fails
        }
      }
    }

    // If no text and no attachments, skip
    if (!messageText && attachments.length === 0) {
      logger.info('No text or attachments in message, skipping');
      return;
    }

    // Convert Slack emoji syntax to Unicode emojis
    if (messageText) {
      messageText = await convertSlackEmojisToEmojis(messageText, client, 'html');
    } else {
      messageText = ''; // Set empty string if no text
    }

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
    let teamId = eventWithTeam.team || eventWithTeam.team_id;
    
    // If teamId is not in event (common with file_share subtype), try multiple fallback strategies
    if (!teamId) {
      // Strategy 1: Extract from file's user_team field (fastest, no API call)
      const eventWithFilesForTeam = event as typeof event & {
        files?: Array<{ user_team?: string }>;
      };
      if (eventWithFilesForTeam.files && eventWithFilesForTeam.files.length > 0) {
        const fileTeamId = eventWithFilesForTeam.files[0]?.user_team;
        if (fileTeamId) {
          teamId = fileTeamId;
          logger.debug(`Extracted teamId from file: ${teamId}`);
        }
      }
      
      // Strategy 2: Get from channel info (requires API call but very reliable)
      if (!teamId && 'channel' in event && event.channel) {
        try {
          const channelInfo = await client.conversations.info({ channel: event.channel });
          // biome-ignore lint/suspicious/noExplicitAny: Slack API types may not include context
          const contextTeamId = (channelInfo.channel as any)?.context_team_id || 
                                (channelInfo.channel as any)?.shared_team_id;
          if (contextTeamId) {
            teamId = contextTeamId;
            logger.debug(`Extracted teamId from channel info: ${teamId}`);
          }
        } catch (error) {
          logger.warn('Could not fetch channel info to get teamId:', error);
        }
      }
    
    }
    
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
        logger.debug(`Sending domain: ${sendingDomain}`);
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
      attachments?: Array<{
        filename: string;
        content: string;
        contentType: string;
      }>;
    } = {
      html: messageText || '', // Use HTML format to support inline images for custom emojis
      text: messageText ? messageText.replace(/<img[^>]*>/g, '') : 'Email with attachments', // Fallback plain text without img tags
      from: generatedEmail,
    };

    // Add attachments if any were processed
    if (attachments.length > 0) {
      replyOptions.attachments = attachments;
    }

    // Add recipients if we have them (reply-all functionality)
    if (replyTo.length > 0) {
      replyOptions.to = replyTo;
    }
    if (replyCc.length > 0) {
      replyOptions.cc = replyCc;
    }

    const response = await inbound.reply(emailId, replyOptions);

    logger.info(`Email reply sent successfully: ${response.data?.id}`);

    // Track this email as sent by us to prevent processing it when it comes back via webhook
    // Generate fingerprint the same way as inbound.post.ts does
    const contentHash = createHash('sha256')
      .update((messageText || '').replace(/<img[^>]*>/g, '') + (subject || ''))
      .digest('hex')
      .substring(0, 16);
    
    // Try to get AWS Message-ID from response (this is what comes back in webhooks)
    // biome-ignore lint/suspicious/noExplicitAny: Inbound SDK types may not include awsMessageId
    const awsMessageId = (response.data as any)?.awsMessageId;
    
    if (awsMessageId) {
      // AWS Message-IDs don't have angle brackets, but normalize just in case
      const normalizedMessageId = awsMessageId.replace(/^<|>$/g, '').trim();
      const fingerprint = `msgid:${normalizedMessageId}`;
      await threadStorage.markEmailSentByUs(fingerprint);
      logger.info(`Marked sent email as ours (AWS Message-ID): ${fingerprint}`);
    } else {
      // Fallback: use composite fingerprint (same logic as inbound.post.ts)
      const timestamp = new Date().toISOString().slice(0, 16);
      const composite = `${inboundThreadId}|${senderEmailAddress}|${subject || '(No Subject)'}|${contentHash}|${timestamp}`;
      const fingerprint = `composite:${createHash('sha256').update(composite).digest('hex').substring(0, 16)}`;
      await threadStorage.markEmailSentByUs(fingerprint);
      logger.info(`Marked sent email as ours (composite): ${fingerprint}`);
    }

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
