import type { InboundWebhookPayload } from '@inboundemail/sdk';
import { eventHandler, readBody } from 'h3';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { WebClient } from '@slack/web-api';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { getInboundApiKey } from '../../bolt/utils/config';
import { parseEmailContent } from '../../bolt/utils/email-parser';
import { threadStorage } from '../../bolt/utils/thread-storage';
import { installationStore } from '../../bolt/utils/installation-store';

// Development mode - saves POST payloads to .data/requests/ for replay testing
const LOCAL_DEV = true;

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

    // Atomic idempotency check: Check and mark as processed in one operation
    // Skip idempotency check in LOCAL_DEV mode to allow replaying requests
    if (!LOCAL_DEV) {
      console.log('[INBOUND] 🔍 Checking idempotency...');
      const alreadyProcessed = await threadStorage.checkAndMarkEmailProcessed(email.id);
      if (alreadyProcessed) {
        console.log(`[IDEMPOTENCY] ⏭️  Email ${email.id} already processed, skipping duplicate webhook`);
        console.log(`  Thread ID: ${email.threadId || 'none'}`);
        console.log(`  Subject: ${email.subject || '(No Subject)'}`);
        return {
          success: true,
          skipped: true,
          reason: 'duplicate',
          emailId: email.id,
        };
      }
      console.log(`[IDEMPOTENCY] ✅ Processing email ${email.id} for the first time`);
    } else {
      console.log('[LOCAL_DEV] ⚠️  Idempotency check SKIPPED for testing');
    }

    const fromAddress = email.from?.addresses?.[0];
    const fromName = fromAddress?.name || fromAddress?.address || 'Unknown';
    const fromEmail = fromAddress?.address || '';
    const subject = email.subject || '(No Subject)';

    // Parse email content with HTML conversion and image extraction
    console.log('[INBOUND] 📝 Parsing email content...');
    const { text: cleanedText, images } = parseEmailContent(email);
    console.log(`[INBOUND] 📝 Parsed ${cleanedText.length} chars, ${images.length} images`);

    // Check if this email is part of an existing thread
    const inboundThreadId = email.threadId;
    const threadPosition = email.threadPosition || 1;
    let slackThreadTs: string | undefined;

    console.log('[INBOUND] 🧵 Checking for existing thread...');
    if (inboundThreadId) {
      // Try to find existing Slack thread
      const existingThreadTs = await threadStorage.getSlackThreadTs(inboundThreadId);
      if (existingThreadTs) {
        slackThreadTs = existingThreadTs;
        console.log(`[INBOUND] ✅ Found existing thread: ${inboundThreadId} -> ${slackThreadTs}`);
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

    // Look up email route to determine workspace and channel
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

    const routes = await db.query.emailRoutes.findMany({
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

    // Post to each matching route (usually just one)
    const responses = [];
    for (const route of routes) {
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
        const target = route.channelId || route.userId;
        if (!target) {
          console.error(`[INBOUND] ❌ Route has no channelId or userId for team: ${route.teamId}`);
          continue;
        }

        console.log(
          `[INBOUND] 📤 Posting to ${route.channelId ? 'channel' : 'user'}: ${target}${slackThreadTs ? ` (thread: ${slackThreadTs})` : ''}`,
        );
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
        
        responses.push({
          teamId: route.teamId,
          channelId: target,
          messageTs: response.ts,
        });

        // Store thread mapping if this is the first message in a thread
        if (inboundThreadId && response.ts && !slackThreadTs) {
          console.log('[INBOUND] 💾 Storing new thread mapping...');
          await threadStorage.set(inboundThreadId, response.ts, email.id);
          console.log(`[THREAD MAPPING] ✅ Created new: ${inboundThreadId} -> ${response.ts}`);
          console.log(`  Email ID: ${email.id}`);
        } else if (inboundThreadId && slackThreadTs) {
          console.log(`[THREAD MAPPING] ℹ️  Using existing: ${inboundThreadId} -> ${slackThreadTs}`);
          console.log(`  Email ID: ${email.id}`);
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
