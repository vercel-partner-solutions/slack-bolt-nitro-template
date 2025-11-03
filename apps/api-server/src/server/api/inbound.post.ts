import type { InboundWebhookPayload } from '@inboundemail/sdk';
import { eventHandler, readBody } from 'h3';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebClient } from '@slack/web-api';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { getInboundApiKey } from '../../bolt/utils/config';
import { parseEmailContent } from '../../bolt/utils/email-parser';
import { threadStorage, type EmailRecipients } from '../../bolt/utils/thread-storage';
import { installationStore } from '../../bolt/utils/installation-store';

// Development mode - saves POST payloads to .data/requests/ for replay testing
const LOCAL_DEV = false;

/**
 * Generate an avatar URL using inbound.new avatar API
 */
function getAvatarUrl(name: string, email: string): string {
  const params = new URLSearchParams({
    email: email,
    name: name,
  });

  return `https://inbound.new/api/avatar?${params.toString()}`;
}

/**
 * Extract Message-ID from email headers without parsing content.
 * Returns normalized Message-ID fingerprint if available, null otherwise.
 */
function extractMessageIdFingerprint(email: InboundWebhookPayload['email']): string | null {
  // biome-ignore lint/suspicious/noExplicitAny: Inbound SDK types may not include messageId
  const messageId = (email as any).messageId || (email as any).headers?.['message-id'] || (email as any).headers?.['Message-ID'];
  
  if (messageId) {
    // Normalize Message-ID (remove angle brackets, whitespace, and domain)
    // AWS SES adds domain like @us-east-2.amazonses.com to Message-IDs
    let normalizedMessageId = messageId.replace(/^<|>$/g, '').trim();
    // Strip domain if present (everything after @) to match awsMessageId from API
    normalizedMessageId = normalizedMessageId.split('@')[0];
    return `msgid:${normalizedMessageId}`;
  }
  
  return null;
}

/**
 * Generate a unique fingerprint for an email to detect duplicates across reply-all scenarios.
 * 
 * The fingerprint is based on:
 * 1. Message-ID header (if available) - standard email identifier that persists across recipients
 * 2. Fallback: threadId + from address + subject + content hash + timestamp (rounded to nearest minute)
 * 
 * This ensures that when reply-all includes multiple SlackBound addresses, we only process
 * the email once even if Inbound sends separate webhooks with different email.id values.
 */
function generateEmailFingerprint(email: InboundWebhookPayload['email'], contentHash: string): string {
  // Try to use Message-ID header if available (most reliable)
  const messageIdFingerprint = extractMessageIdFingerprint(email);
  if (messageIdFingerprint) {
    return messageIdFingerprint;
  }
  
  // Fallback fingerprint based on email characteristics
  // Round timestamp to nearest minute to handle slight timing differences
  const timestamp = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  
  const fromAddress = email.from?.addresses?.[0]?.address || 'unknown';
  const threadId = email.threadId || 'no-thread';
  const subject = email.subject || '(No Subject)';
  
  // Create a composite key: thread + from + subject + content hash + timestamp
  const composite = `${threadId}|${fromAddress}|${subject}|${contentHash}|${timestamp}`;
  
  // Hash it for consistent length and to avoid issues with special characters
  return `composite:${createHash('sha256').update(composite).digest('hex').substring(0, 16)}`;
}

export default eventHandler(async (event) => {
  console.log('[INBOUND] 📬 Received webhook request');

  try {
    const payload: InboundWebhookPayload = await readBody(event);

    // Save payload to file in LOCAL_DEV mode for replay testing
    if (LOCAL_DEV) {
      const requestsDir = join(process.cwd(), '.data', 'requests');
      await mkdir(requestsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `request-${timestamp}.json`;
      const filepath = join(requestsDir, filename);

      await writeFile(filepath, JSON.stringify(payload, null, 2));
      console.log(`[LOCAL_DEV] 💾 Saved request to: ${filename}`);
    }

    // Extract email data
    const { email } = payload;

    // Verify webhook authenticity using Inbound API via a GET request to the /v2/api/emails/{emailId} endpoint
    const emailId = email.id;
    const emailResponse = await fetch(`https://inbound.new/api/v2/emails/${emailId}`, {
      headers: {
        'Authorization': `Bearer ${getInboundApiKey()}`,
      },
    });
    if (!emailResponse.ok) {
      console.log(`[INBOUND] ❌ Failed to verify webhook authenticity: ${emailResponse.statusText}`);
      return {  
        success: false,
        message: 'Unauthorized',
      };
    }
    const emailData = (await emailResponse.json()) as { id: string };
    if (emailData.id !== emailId) {
      console.log(`[INBOUND] ❌ Failed to verify webhook authenticity: email ID mismatch`);
      return {
        success: false,
        message: 'Unauthorized',
      };
    }

    console.log('[INBOUND] ✉️  Processing email:');
    console.log(`  ID: ${email.id}`);
    console.log(`  Thread ID: ${email.threadId || 'none'}`);
    console.log(`  From: ${email.from?.addresses?.[0]?.name || email.from?.addresses?.[0]?.address || 'unknown'}`);
    console.log(`  Subject: ${email.subject || '(No Subject)'}`);
    console.log(`  Thread Position: ${email.threadPosition || 1}`);

    // Log attachments if present
    const attachments = email.parsedData?.attachments;
    if (attachments && attachments.length > 0) {
      console.log('[INBOUND] 📎 Attachments:');
      console.log(JSON.stringify(attachments, null, 2));
    } else {
      console.log('[INBOUND] 📎 No attachments');
    }

    const fromAddress = email.from?.addresses?.[0];
    const fromName = fromAddress?.name || fromAddress?.address || 'Unknown';
    const fromEmail = fromAddress?.address || '';
    const subject = email.subject || '(No Subject)';

    // OPTIMIZATION: Try to check if email was sent by us BEFORE parsing content
    // Most emails we send have Message-ID which we can check without expensive parsing
    const messageIdFingerprint = extractMessageIdFingerprint(email);
    if (messageIdFingerprint) {
      console.log(`[INBOUND] 🔑 Message-ID fingerprint: ${messageIdFingerprint}`);
      const sentByUs = await threadStorage.wasEmailSentByUs(messageIdFingerprint);
      if (sentByUs) {
        console.log(`[INBOUND] 🔄 Email was sent by us (from Slack), skipping to avoid loop`);
        console.log(`  Email ID: ${email.id}`);
        console.log(`  Fingerprint: ${messageIdFingerprint}`);
        console.log(`  Thread ID: ${email.threadId || 'none'}`);
        console.log(`  Subject: ${email.subject || '(No Subject)'}`);
        // Mark as processed to avoid future checks
        await threadStorage.markEmailProcessed(email.id);
        return {
          success: true,
          skipped: true,
          reason: 'sent_by_us',
          emailId: email.id,
          fingerprint: messageIdFingerprint,
        };
      }
    }

    // Parse email content (needed for composite fingerprint or if Message-ID check didn't skip)
    console.log('[INBOUND] 📝 Parsing email content...');
    const { text: cleanedText, images } = parseEmailContent(email);
    console.log(`[INBOUND] 📝 Parsed ${cleanedText.length} chars, ${images.length} images`);

    // Generate content hash for fingerprinting (use cleaned text + subject for consistency)
    const contentHash = createHash('sha256')
      .update(cleanedText + subject)
      .digest('hex')
      .substring(0, 16);

    // Generate email fingerprint for duplicate detection (handles reply-all scenarios)
    // If Message-ID fingerprint exists, this will return it; otherwise composite fingerprint
    const emailFingerprint = generateEmailFingerprint(email, contentHash);
    console.log(`[INBOUND] 🔑 Email fingerprint: ${emailFingerprint}`);

    // Check again if this email was sent by us (in case it uses composite fingerprint)
    // This handles cases where Message-ID wasn't available in the initial check
    if (!messageIdFingerprint) {
      const sentByUs = await threadStorage.wasEmailSentByUs(emailFingerprint);
      if (sentByUs) {
        console.log(`[INBOUND] 🔄 Email was sent by us (from Slack), skipping to avoid loop`);
        console.log(`  Email ID: ${email.id}`);
        console.log(`  Fingerprint: ${emailFingerprint}`);
        console.log(`  Thread ID: ${email.threadId || 'none'}`);
        console.log(`  Subject: ${email.subject || '(No Subject)'}`);
        // Mark as processed to avoid future checks
        await threadStorage.markEmailProcessed(email.id);
        return {
          success: true,
          skipped: true,
          reason: 'sent_by_us',
          emailId: email.id,
          fingerprint: emailFingerprint,
        };
      }
    }

    // Dual idempotency check: both email.id and fingerprint
    console.log('[INBOUND] 🔍 Checking idempotency...');
    
    // Check by email ID (fast path - existing mechanism)
    // In LOCAL_DEV mode, skip email.id check to allow request replays from .data/requests/
    if (!LOCAL_DEV) {
      const alreadyProcessedById = await threadStorage.checkAndMarkEmailProcessed(email.id);
      if (alreadyProcessedById) {
        console.log(`[IDEMPOTENCY] ⏭️  Email ${email.id} already processed (by ID), skipping duplicate webhook`);
        console.log(`  Thread ID: ${email.threadId || 'none'}`);
        console.log(`  Subject: ${email.subject || '(No Subject)'}`);
        return {
          success: true,
          skipped: true,
          reason: 'duplicate',
          emailId: email.id,
        };
      }
    } else {
      console.log('[LOCAL_DEV] ⚠️  Email ID check SKIPPED (allows request replay for testing)');
    }
    
    // ALWAYS check by fingerprint (handles reply-all duplicates with different email.id)
    // This runs even in LOCAL_DEV to prevent duplicate messages in Slack
    const alreadyProcessedByFingerprint = await threadStorage.checkAndMarkEmailFingerprint(emailFingerprint);
    if (alreadyProcessedByFingerprint) {
      console.log(`[IDEMPOTENCY] ⏭️  Email already processed (by fingerprint), skipping duplicate reply-all`);
      console.log(`  Email ID: ${email.id}`);
      console.log(`  Fingerprint: ${emailFingerprint}`);
      console.log(`  Thread ID: ${email.threadId || 'none'}`);
      console.log(`  Subject: ${email.subject || '(No Subject)'}`);
      // Also mark the email.id as processed to avoid future checks
      if (!LOCAL_DEV) {
        await threadStorage.markEmailProcessed(email.id);
      }
      return {
        success: true,
        skipped: true,
        reason: 'duplicate_fingerprint',
        emailId: email.id,
        fingerprint: emailFingerprint,
      };
    }
    
    console.log(`[IDEMPOTENCY] ✅ Processing email ${email.id} for the first time`);

    // Extract recipient information for reply-all functionality
    const recipients: EmailRecipients = {
      to: email.to?.addresses?.map((addr) => ({
        name: addr.name ?? undefined,
        address: addr.address ?? '',
      })).filter((addr) => addr.address) || [],
      // biome-ignore lint/suspicious/noExplicitAny: Inbound SDK types may not include cc
      cc: (email as any).cc?.addresses?.map((addr: any) => ({
        name: addr.name ?? undefined,
        address: addr.address ?? '',
      })).filter((addr: { address: string }) => addr.address),
      from: fromAddress
        ? {
            name: fromAddress.name ?? undefined,
            address: fromAddress.address ?? '',
          }
        : undefined,
    };

    console.log(`[INBOUND] 📧 Recipients - To: ${recipients.to.length}, CC: ${recipients.cc?.length || 0}`);

    // Check if this email is part of an existing thread
    const inboundThreadId = email.threadId;
    const threadPosition = email.threadPosition || 1;
    let slackThreadTs: string | undefined;

    console.log('[INBOUND] 🧵 Checking for existing thread...');
    let storedChannelId: string | null = null;
    if (inboundThreadId) {
      // Try to find existing Slack thread
      const existingThreadTs = await threadStorage.getSlackThreadTs(inboundThreadId);
      if (existingThreadTs) {
        slackThreadTs = existingThreadTs;
        // Retrieve the channel ID where this thread exists
        storedChannelId = await threadStorage.getChannelId(inboundThreadId);
        console.log(`[INBOUND] ✅ Found existing thread: ${inboundThreadId} -> ${slackThreadTs}`);
        if (storedChannelId) {
          console.log(`[INBOUND] 📍 Thread exists in channel: ${storedChannelId}`);
        } else {
          console.log(`[INBOUND] ⚠️  No channel ID stored for thread (may be from old data)`);
        }
      } else {
        console.log(`[INBOUND] 🆕 No existing thread found for ${inboundThreadId}, will create new`);
      }
    } else {
      console.log('[INBOUND] 🆕 No threadId in email, will create new thread');
    }

    // Build Slack message blocks
    // biome-ignore lint/suspicious/noExplicitAny: Slack Block Kit types are complex, using any for flexibility
    const blocks: any[] = [];

    // For first message in thread (threadPosition 1), show subject and message
    // For replies (threadPosition > 1), just show the cleaned message
    if (threadPosition === 1 || !slackThreadTs) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${subject}*\n\n${cleanedText}`,
        },
      });
    } else {
      // Thread reply - just show the message content
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: cleanedText,
        },
      });
    }

    // Add image blocks for any extracted images (inline images from HTML)
    for (const imageUrl of images) {
      blocks.push({
        type: 'image',
        image_url: imageUrl,
        alt_text: 'Email image',
      });
    }

    // Note: File attachments are uploaded separately to the channel (not as blocks)

    // Generate avatar URL using inbound.new avatar API
    const avatarUrl = getAvatarUrl(fromName, fromEmail);
    
    // Download and store attachments locally, serve via our API
    // This allows images and files to appear in the message with custom username/icon
    const imageUrls: Array<{ url: string; filename: string }> = [];
    const fileLinks: Array<{ url: string; filename: string }> = [];

    if (attachments && attachments.length > 0) {
      console.log(`[INBOUND] 📎 Processing ${attachments.length} attachment(s)...`);
      const inboundApiKey = getInboundApiKey();

      // Ensure attachments directory exists
      const attachmentsDir = join(process.cwd(), '.data', 'attachments');
      await mkdir(attachmentsDir, { recursive: true });

      // Separate image and non-image attachments
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

      for (const attachment of attachments) {
        try {
          if (!attachment.filename) {
            console.error('[INBOUND] ⚠️  Skipping attachment without filename');
            continue;
          }

          console.log(`[INBOUND] ⬇️  Downloading: ${attachment.filename} (${attachment.size} bytes)`);

          // Download attachment from inbound.new
          const downloadResponse = await fetch(attachment.downloadUrl, {
            headers: {
              'Authorization': `Bearer ${inboundApiKey}`,
            },
          });

          if (!downloadResponse.ok) {
            throw new Error(`Failed to download attachment: ${downloadResponse.statusText}`);
          }

          const fileBuffer = await downloadResponse.arrayBuffer();
          console.log(`[INBOUND] ✅ Downloaded ${attachment.filename}`);

          // Generate unique filename using email ID to avoid collisions
          const uniqueFilename = `${email.id}-${attachment.filename}`;
          const filePath = join(attachmentsDir, uniqueFilename);

          // Save file locally
          await writeFile(filePath, Buffer.from(fileBuffer));
          console.log(`[INBOUND] 💾 Saved to: ${filePath}`);

          // Generate public URL for the attachment
          const baseUrl = process.env.PUBLIC_URL!;
          // URL-encode the filename to handle spaces and special characters
          const encodedFilename = encodeURIComponent(uniqueFilename);
          const attachmentUrl = `${baseUrl}/api/attachment/${encodedFilename}`;
          console.log(`[INBOUND] 🔗 Generated attachment URL: ${attachmentUrl}`);

          // Check if it's an image
          const ext = attachment.filename.split('.').pop()?.toLowerCase();
          const isImage = ext && imageExtensions.includes(ext);

          if (isImage) {
            imageUrls.push({ url: attachmentUrl, filename: attachment.filename });
            console.log(`[INBOUND] 🖼️  Image will be displayed inline: ${attachment.filename}`);
          } else {
            fileLinks.push({ url: attachmentUrl, filename: attachment.filename });
            console.log(`[INBOUND] 📄 File will be linked: ${attachment.filename}`);
          }
        } catch (error) {
          console.error(`[INBOUND] ❌ Failed to process attachment ${attachment.filename}:`, error);
          // Continue with other attachments even if one fails
        }
      }

      console.log(`[INBOUND] 📎 Processed ${imageUrls.length + fileLinks.length}/${attachments.length} attachments`);
      console.log(`[INBOUND] 🖼️  ${imageUrls.length} image(s) will appear inline`);
      console.log(`[INBOUND] 📄 ${fileLinks.length} file(s) will be linked`);
    }

    // Add image blocks for attachment images (will appear inline with custom username/icon)
    for (const image of imageUrls) {
      blocks.push({
        type: 'image',
        image_url: image.url,
        alt_text: image.filename,
      });
    }

    // Add file links for non-image attachments
    if (fileLinks.length > 0) {
      const fileLinksText = fileLinks
        .map((file) => `📎 <${file.url}|${file.filename}>`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Attachments:*\n${fileLinksText}`,
        },
      });
    }

    console.log('[INBOUND] 👤 Bot appearance:');
    console.log(`  Avatar: ${avatarUrl}`);

    // For thread replies, we use the stored channel ID instead of route lookup
    // For new threads, we look up the route based on recipient email
    let routes: Array<typeof schema.emailRoutes.$inferSelect> = [];
    
    if (slackThreadTs && storedChannelId) {
      // This is a reply to an existing thread - we need to find the route for the stored channel
      // We need to find which workspace/route this channel belongs to
      console.log(`[INBOUND] 🔄 Thread reply detected - looking up route for stored channel: ${storedChannelId}`);
      
      // Find route that matches this channel
      const channelRoutes = await db.query.emailRoutes.findMany({
        where: eq(schema.emailRoutes.channelId, storedChannelId),
      });
      
      if (channelRoutes.length > 0) {
        routes = channelRoutes;
        console.log(`[INBOUND] ✅ Found ${routes.length} route(s) for thread channel: ${storedChannelId}`);
      } else {
        console.error(`[INBOUND] ❌ No route found for stored channel: ${storedChannelId}`);
        // Fall back to recipient-based lookup
        const toEmail = email.to?.addresses?.[0]?.address;
        if (toEmail) {
          console.log(`[INBOUND] 🔄 Falling back to recipient-based route lookup for: ${toEmail}`);
          const normalizedEmail = toEmail.toLowerCase();
          routes = await db.query.emailRoutes.findMany({
            where: eq(schema.emailRoutes.emailAddress, normalizedEmail),
          });
          if (routes.length === 0) {
            console.error(`[INBOUND] ❌ No route found for email (fallback): ${toEmail}`);
          }
        }
      }
    } else {
      // New thread - look up route based on recipient email
    const toEmail = email.to?.addresses?.[0]?.address;
    if (!toEmail) {
      console.error('[INBOUND] ❌ No destination email address found');
      return {
        success: false,
        error: 'No destination email address',
      };
    }

    // Normalize email to lowercase for case-insensitive lookup
    // (emails are stored in lowercase, but we normalize here for safety)
    const normalizedEmail = toEmail.toLowerCase();
    console.log(`[INBOUND] 🔍 Looking up route for: ${normalizedEmail}`);

      routes = await db.query.emailRoutes.findMany({
      where: eq(schema.emailRoutes.emailAddress, normalizedEmail),
    });

    if (routes.length === 0) {
      console.error(`[INBOUND] ❌ No route found for email: ${toEmail}`);
      return {
        success: false,
        error: `No route configured for ${toEmail}`,
      };
    }

    console.log(`[INBOUND] ✅ Found ${routes.length} route(s) for ${toEmail}`);
    }

    // Ensure we have routes to post to
    if (routes.length === 0) {
      console.error('[INBOUND] ❌ No routes found after all lookup attempts');
      return {
        success: false,
        error: 'No route configured for this email',
      };
    }

    // For thread replies, only use the first route to avoid posting the same message
    // multiple times when multiple email addresses route to the same channel
    const routesToPost = slackThreadTs ? [routes[0]] : routes;
    if (slackThreadTs && routes.length > 1) {
      console.log(`[INBOUND] ℹ️  Thread reply - using first route only (${routes.length} routes found)`);
    }

    // Post to each matching route (usually just one)
    const responses = [];
    for (const route of routesToPost) {
      if (!route.isActive) {
        console.log(`[INBOUND] ⏭️  Skipping inactive route for team: ${route.teamId}`);
        continue;
      }

      try {
        console.log(`[INBOUND] 📤 Posting to workspace: ${route.teamId}`);

        // Get workspace installation and token
        const installation = await installationStore.fetchInstallation({
          teamId: route.teamId,
          isEnterpriseInstall: false,
          enterpriseId: undefined,
        });

        // Create workspace-specific client
        const workspaceClient = new WebClient(installation.bot?.token!);

        // Fetch workspace config to determine username format
        const workspaceConfig = await db
          .select()
          .from(schema.workspaceConfig)
          .where(eq(schema.workspaceConfig.teamId, route.teamId))
          .limit(1);
        
        const shouldShowFullEmail = workspaceConfig[0]?.shouldShowFullEmail ?? false;
        const fullUsername = shouldShowFullEmail ? `${fromName} <${fromEmail}>` : fromName;

        // Determine target (channel or DM)
        // For thread replies, use stored channel ID; for new threads, use route channel
        const target = (slackThreadTs && storedChannelId) ? storedChannelId : (route.channelId || route.userId);
        if (!target) {
          console.error(`[INBOUND] ❌ Route has no channelId or userId for team: ${route.teamId}`);
          continue;
        }

        if (slackThreadTs && storedChannelId) {
          console.log(`[INBOUND] 📤 Posting thread reply to stored channel: ${target} (thread: ${slackThreadTs})`);
        } else {
        console.log(
          `[INBOUND] 📤 Posting to ${route.channelId ? 'channel' : 'user'}: ${target}${slackThreadTs ? ` (thread: ${slackThreadTs})` : ''}`,
        );
        }
        console.log(`[INBOUND] 👤 Username format: ${shouldShowFullEmail ? 'full email' : 'name only'}`);

        const totalAttachments = imageUrls.length + fileLinks.length;
        if (totalAttachments > 0) {
          console.log(`[INBOUND] 📎 ${totalAttachments} attachment(s) will appear with custom sender identity`);
        }

        // Debug: Log the blocks being sent to Slack
        console.log('[INBOUND] 🔍 Blocks being sent to Slack:');
        console.log(JSON.stringify(blocks, null, 2));

        const response = await workspaceClient.chat.postMessage({
          channel: target,
          text: cleanedText,
          blocks, // Message blocks (includes images and file links)
          unfurl_links: false,
          unfurl_media: false,
          username: fullUsername, // Display sender's name and email as the bot username
          icon_url: avatarUrl, // Use inbound.new avatar API
          ...(slackThreadTs && { thread_ts: slackThreadTs }),
          // Note: Attachments are served via /api/attachment and included as image blocks or links
          // This allows them to appear with custom username/icon (solving Slack API limitation)
        });

        console.log(`[INBOUND] ✅ Posted to workspace ${route.teamId} successfully! Message TS: ${response.ts}`);
        
        // Store email ID -> team ID mapping for attachment authorization
        await threadStorage.setEmailWorkspace(email.id, route.teamId);
        
        responses.push({
          teamId: route.teamId,
          channelId: target,
          messageTs: response.ts,
        });

        // Store thread mapping if this is the first message in a thread
        const finalSlackThreadTs = response.ts || slackThreadTs;
        if (inboundThreadId && finalSlackThreadTs && !slackThreadTs) {
          console.log('[INBOUND] 💾 Storing new thread mapping...');
          // Store channel ID with thread mapping
          await threadStorage.set(inboundThreadId, finalSlackThreadTs, email.id, target);
          // Store recipients for reply-all functionality
          await threadStorage.setEmailRecipients(finalSlackThreadTs, recipients);
          console.log(`[THREAD MAPPING] ✅ Created new: ${inboundThreadId} -> ${finalSlackThreadTs}`);
          console.log(`  Email ID: ${email.id}`);
          console.log(`  Channel ID: ${target}`);
          console.log(`  Recipients stored: To=${recipients.to.length}, CC=${recipients.cc?.length || 0}`);
        } else if (inboundThreadId && slackThreadTs) {
          // Update recipients for existing thread (in case this is a new message with different recipients)
          await threadStorage.setEmailRecipients(slackThreadTs, recipients);
          console.log(`[THREAD MAPPING] ℹ️  Using existing: ${inboundThreadId} -> ${slackThreadTs}`);
          console.log(`  Email ID: ${email.id}`);
          console.log(`  Channel ID: ${target}`);
          console.log(`  Recipients updated: To=${recipients.to.length}, CC=${recipients.cc?.length || 0}`);
        }
      } catch (error) {
        console.error(`[INBOUND] ❌ Error posting to workspace ${route.teamId}:`, error);
        // Continue with other routes even if one fails
      }
    }

    if (responses.length === 0) {
      console.error('[INBOUND] ❌ Failed to post to any workspace');
      return {
        success: false,
        error: 'Failed to post to any workspace',
      };
    }

    // Note: Email is already marked as processed by the atomic check at the beginning

    console.log('[INBOUND] 🎉 Successfully processed email!');
    console.log('--------------------------------\n');

    return {
      success: true,
      emailId: email.id,
      threadId: inboundThreadId,
      workspaces: responses,
    };
  } catch (error) {
    console.error('[INBOUND] ❌ ERROR processing webhook:');
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    console.log('--------------------------------\n');

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});
