"use server";

// Load env vars from root first
import "@/lib/env";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { userConfig, workspaceConfig, emailRoutes, workspaceInstallations } from "@slackbound/db";
import { withAuth } from "@/lib/workos-auth";
import { WebClient } from "@slack/web-api";
import { createDecipheriv, scryptSync } from 'node:crypto';
import { getOrganizationByTeamId, addUserToOrganization } from "@/lib/workos-organizations";
import { workos } from "@/lib/workos-client";

// Encryption utilities for decrypting bot tokens
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  return key;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

function decrypt(encryptedText: string): string {
  const password = getEncryptionKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted text format');
  }
  const salt = Buffer.from(parts[0], 'hex');
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = parts[3];
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Get workspace's inbound API key
 */
async function getWorkspaceInboundApiKey(teamId: string): Promise<string | null> {
  try {
    const db = getDb();
    const config = await db
      .select()
      .from(workspaceConfig)
      .where(eq(workspaceConfig.teamId, teamId))
      .limit(1);
    
    return config[0]?.inboundApiKey || null;
  } catch (error) {
    console.error("Error getting workspace inbound API key:", error);
    return null;
  }
}

/**
 * Check if a SlackBound endpoint exists for the workspace
 */
async function doesSlackboundEndpointExist(teamId: string): Promise<{ exists: boolean; endpointId?: string }> {
  try {
    const db = getDb();
    
    const config = await db
      .select()
      .from(workspaceConfig)
      .where(eq(workspaceConfig.teamId, teamId))
      .limit(1);
    
    if (config.length === 0 || !config[0].inboundEndpointId) {
      return { exists: false };
    }
    
    return { exists: true, endpointId: config[0].inboundEndpointId };
  } catch (error) {
    console.error("Error checking SlackBound endpoint:", error);
    return { exists: false };
  }
}

/**
 * Create or get SlackBound webhook endpoint for the workspace
 */
async function getOrCreateSlackboundEndpoint(
  teamId: string,
  inboundApiKey: string
): Promise<{ success: boolean; endpointId?: string; error?: string }> {
  try {
    // Check if endpoint already exists
    const existing = await doesSlackboundEndpointExist(teamId);
    if (existing.exists && existing.endpointId) {
      return { success: true, endpointId: existing.endpointId };
    }
    
    // Get public app URL (where inbound webhook will be sent)
    // Next.js rewrites /api/* to the backend, so use the Next.js app URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const webhookUrl = `${appUrl}/api/inbound`;
    
    // Create endpoint via Inbound API
    const response = await fetch("https://inbound.new/api/v2/endpoints", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `SlackBound Webhook - ${teamId}`,
        type: "webhook",
        description: `SlackBound webhook endpoint for workspace ${teamId}`,
        config: {
          url: webhookUrl,
          timeout: 30,
          retryAttempts: 3,
        },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `Failed to create endpoint: ${response.statusText}`,
      };
    }
    
    const data = await response.json();
    const endpointId = data.id;
    
    // Save endpoint ID to database
    const db = getDb();
    
    const existingConfig = await db
      .select()
      .from(workspaceConfig)
      .where(eq(workspaceConfig.teamId, teamId))
      .limit(1);
    
    if (existingConfig.length === 0) {
      await db.insert(workspaceConfig).values({
        teamId,
        inboundEndpointId: endpointId,
        emailIntegrationEnabled: true,
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(workspaceConfig)
        .set({
          inboundEndpointId: endpointId,
          updatedAt: new Date(),
        })
        .where(eq(workspaceConfig.teamId, teamId));
    }
    
    return { success: true, endpointId };
  } catch (error) {
    console.error("Error creating/getting SlackBound endpoint:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create endpoint",
    };
  }
}

/**
 * Create email address via Inbound.new API
 */
export async function createEmailAddress(emailAddress: string) {
  try {
    // Get user's workspace team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // Get inbound API key from workspace config
    const inboundApiKey = await getWorkspaceInboundApiKey(teamId);
    if (!inboundApiKey) {
      return {
        success: false,
        error: "Inbound API key not found. Please configure your API key first.",
      };
    }
    
    // Get or create SlackBound endpoint
    const endpointResult = await getOrCreateSlackboundEndpoint(teamId, inboundApiKey);
    if (!endpointResult.success || !endpointResult.endpointId) {
      return {
        success: false,
        error: endpointResult.error || "Failed to get or create SlackBound endpoint",
      };
    }
    
    // Parse email address to get domain
    const emailParts = emailAddress.split("@");
    if (emailParts.length !== 2) {
      return {
        success: false,
        error: "Invalid email address format",
      };
    }
    
    const domain = emailParts[1];
    
    // Get domain ID from Inbound API
    const domainsResponse = await fetch("https://inbound.new/api/v2/domains", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!domainsResponse.ok) {
      return {
        success: false,
        error: "Failed to fetch domains from Inbound.new",
      };
    }
    
    const domainsData = await domainsResponse.json();
    const domainInfo = domainsData.data?.find((d: { domain: string }) => d.domain === domain);
    
    if (!domainInfo || !domainInfo.id) {
      return {
        success: false,
        error: `Domain ${domain} not found in your Inbound.new account`,
      };
    }
    
    // Create email address
    const emailResponse = await fetch("https://inbound.new/api/v2/email-addresses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address: emailAddress,
        domainId: domainInfo.id,
        endpointId: endpointResult.endpointId,
        isActive: true,
      }),
    });
    
    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      
      // If email already exists, fetch it instead of failing
      if (errorData.error === "Email address already exists" || 
          (typeof errorData.error === "string" && errorData.error.toLowerCase().includes("already exists"))) {
        console.log(`Email ${emailAddress} already exists in Inbound.new, fetching existing email...`);
        
        // Fetch all email addresses to find the existing one
        const listResponse = await fetch("https://inbound.new/api/v2/email-addresses", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${inboundApiKey}`,
            "Content-Type": "application/json",
          },
        });
        
        if (listResponse.ok) {
          const listData = await listResponse.json();
          const existingEmail = listData.data?.find(
            (e: { address: string }) => e.address.toLowerCase() === emailAddress.toLowerCase()
          );
          
          if (existingEmail && existingEmail.id) {
            console.log(`Found existing email with ID: ${existingEmail.id}`);
            return {
              success: true,
              emailId: existingEmail.id,
              data: existingEmail,
            };
          }
        }
      }
      
      return {
        success: false,
        error: errorData.error || `Failed to create email address: ${emailResponse.statusText}`,
      };
    }
    
    const emailData = await emailResponse.json();
    
    return {
      success: true,
      emailId: emailData.id,
      data: emailData,
    };
  } catch (error) {
    console.error("Error creating email address:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create email address",
    };
  }
}

/**
 * Link channel and email - saves mapping to database
 * 
 * Upgrade logic: If an auto-created route (routeType: 'auto') already exists for
 * this email address (created when a user replies to an email thread), this function
 * will upgrade it to a primary route (routeType: 'primary') by updating the existing
 * route instead of creating a new one. This ensures users can manually link channels
 * to email addresses that were previously auto-created as reply endpoints.
 */
export async function linkChannelAndEmail(
  channelId: string,
  inboundEmailId: string,
  emailAddress: string,
  channelName?: string
) {
  try {
    // Get authenticated user
    const { user } = await withAuth();
    if (!user) {
      return { success: false, error: "not_authenticated" };
    }
    
    // Get user's workspace team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // Get channel name if not provided (fetch from Slack)
    let finalChannelName = channelName;
    if (!finalChannelName) {
      try {
        const accessToken = await getSlackAccessToken();
        if (accessToken) {
          const client = new WebClient(accessToken);
          const result = await client.conversations.info({ channel: channelId });
          if (result.ok && result.channel) {
            finalChannelName = result.channel.name;
          }
        }
      } catch (error) {
        console.warn("Could not fetch channel name:", error);
      }
    }
    
    // Save to emailRoutes table using upsert pattern
    const db = getDb();
    
    // Normalize email address to lowercase for consistent storage
    const normalizedEmailAddress = emailAddress.toLowerCase();
    
    // Use INSERT ... ON CONFLICT DO UPDATE (upsert) to handle both create and update atomically
    // This prevents race conditions and handles the case where the email already exists
    await db
      .insert(emailRoutes)
      .values({
        emailAddress: normalizedEmailAddress,
        channelId,
        channelName: finalChannelName,
        teamId,
        inboundEmailId,
        routeType: 'primary',
        isActive: true,
        createdByUserId: user.id, // WorkOS user ID (no FK constraint)
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: emailRoutes.emailAddress,
        set: {
          channelId,
          channelName: finalChannelName,
          teamId,
          inboundEmailId,
          routeType: 'primary',
          isActive: true,
          // Don't update createdByUserId - preserve the original creator
          updatedAt: new Date(),
        },
      });
    
    return {
      success: true,
    };
  } catch (error) {
    console.error("Error linking channel and email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to link channel and email",
    };
  }
}

/**
 * Fetch email routes for the current workspace
 * 
 * Only returns primary routes (user-created routes). Auto-created reply endpoints
 * are excluded from this list as they are automatically generated when users reply
 * to email threads from Slack.
 * 
 * Upgrade logic: When a user manually links a channel and email, any existing
 * auto-created route for that email address is automatically upgraded to a primary
 * route via the linkChannelAndEmail function.
 */
export async function fetchEmailRoutes() {
  try {
    // Get user's workspace team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // Fetch only primary routes (user-created routes)
    // Auto-created reply endpoints (routeType: 'auto') are excluded
    const db = getDb();
    const routes = await db
      .select()
      .from(emailRoutes)
      .where(
        and(
          eq(emailRoutes.teamId, teamId),
          eq(emailRoutes.routeType, 'primary')
        )
      );
    
    return {
      success: true,
      data: routes,
    };
  } catch (error) {
    console.error("Error fetching email routes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch email routes",
      data: [],
    };
  }
}

/**
 * Delete email route - deletes email address from Inbound.new but NOT the Slack channel
 */
export async function deleteEmailRoute(emailAddress: string) {
  try {
    // Get user's workspace team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // Get inbound API key from workspace config
    const inboundApiKey = await getWorkspaceInboundApiKey(teamId);
    if (!inboundApiKey) {
      return {
        success: false,
        error: "Inbound API key not found. Please configure your API key first.",
      };
    }
    
    const db = getDb();
    
    // Get email address ID from Inbound API
    const emailResponse = await fetch(`https://inbound.new/api/v2/email-addresses?address=${encodeURIComponent(emailAddress)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!emailResponse.ok) {
      const errorData = await emailResponse.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || "Failed to find email address in Inbound.new",
      };
    }
    
    const emailData = await emailResponse.json();
    const emailAddresses = emailData.data || [];
    
    if (emailAddresses.length === 0) {
      return {
        success: false,
        error: "Email address not found in Inbound.new",
      };
    }
    
    const emailAddr = emailAddresses[0];
    
    // Delete email address from Inbound.new
    const deleteResponse = await fetch(`https://inbound.new/api/v2/email-addresses/${emailAddr.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!deleteResponse.ok) {
      const errorData = await deleteResponse.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || "Failed to delete email address from Inbound.new",
      };
    }
    
    // Remove route from database (but NOT the Slack channel)
    // Normalize email to lowercase to match how it's stored
    const normalizedEmailAddress = emailAddress.toLowerCase();
    await db
      .delete(emailRoutes)
      .where(eq(emailRoutes.emailAddress, normalizedEmailAddress));
    
    return {
      success: true,
    };
  } catch (error) {
    console.error("Error deleting email route:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete email route",
    };
  }
}
/**
 * Get Slack user ID from WorkOS user profile
 * WorkOS stores the Slack user ID in the user's raw profile data
 */
async function getSlackUserId(): Promise<string | null> {
  try {
    const { user } = await withAuth();
    if (!user) {
      return null;
    }

    // WorkOS stores the OAuth provider's user ID in rawAttributes
    // For Slack OAuth, this contains the Slack user ID
    const slackUserId = user.profilePictureUrl ? user.id : null;
    
    // TODO: Get actual Slack user ID from WorkOS profile
    // For now, we'll get it from workspace installations
    return slackUserId;
  } catch (error) {
    console.error("Error getting Slack user ID:", error);
    return null;
  }
}

/**
 * Get Slack bot access token for the workspace
 * This uses the installed bot's token, not the user's personal OAuth token
 */
async function getSlackAccessToken(): Promise<string | null> {
  try {
    const { user } = await withAuth();
    if (!user) {
      return null;
    }

    const db = getDb();
    
    // Get the workspace info to find the team ID
    // For now, we'll get the first active installation for simplicity
    // TODO: In a multi-workspace setup, we'd need to track which workspace the user is working with
    const installations = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.isActive, true))
      .limit(1);

    if (installations.length === 0) {
      return null;
    }

    const installation = installations[0];
    
    // Decrypt the bot token
    const decryptedToken = decrypt(installation.botAccessToken);
    return decryptedToken;
  } catch (error) {
    console.error("Error getting Slack access token:", error);
    return null;
  }
}

/**
 * Get Slack user info using the Slack SDK
 */
export async function getSlackUserInfo() {
  try {
    const accessToken = await getSlackAccessToken();
    if (!accessToken) {
      return {
        success: false,
        error: "Slack access token not found. Please sign in with Slack.",
      };
    }

    const client = new WebClient(accessToken);
    const result = await client.openid.connect.userInfo();
    console.log("Slack user info:", result);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error("Error getting Slack user info:", error);
    return null;
  }
}

/**
 * Get Slack workspace info using auth.test
 */
export async function getSlackWorkspaceInfo() {
  try {
    const accessToken = await getSlackAccessToken();
    if (!accessToken) {
      return {
        success: false,
        error: "Slack access token not found. Please sign in with Slack.",
      };
    }

    const client = new WebClient(accessToken);
    const result = await client.auth.test();

    if (!result.ok) {
      return {
        success: false,
        error: result.error || "Failed to get workspace info",
      };
    }

    return {
      success: true,
      data: {
        teamId: result.team_id as string,
        teamName: result.team as string,
        teamUrl: result.url as string,
        userId: result.user_id as string,
        userName: result.user as string,
      },
    };
  } catch (error) {
    console.error("Error getting Slack workspace info:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get workspace info",
    };
  }
}

/**
 * Ensure the authenticated user belongs to their workspace's organization
 * Called on dashboard load to handle users who sign in after bot is installed
 * 
 * This enables User B to automatically join the organization that User A created
 * when they installed the bot.
 */
export async function ensureUserInOrganization() {
  try {
    const { user } = await withAuth();
    if (!user) {
      return { success: false, error: "not_authenticated" };
    }

    // Get workspace info to find team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return { success: false, error: "no_workspace" };
    }

    const teamId = workspaceInfo.data.teamId;

    // Check if organization exists for this workspace
    const org = await getOrganizationByTeamId(teamId);
    
    if (!org) {
      // Organization doesn't exist - user needs to install bot first
      return { success: false, error: "bot_not_installed" };
    }
    
    // Add user to organization if not already a member
    await addUserToOrganization(user.id, org.id);
    
    console.log(`[WorkOS] User ${user.id} ensured in organization ${org.id}`);
    return { success: true, organizationId: org.id };
  } catch (error) {
    console.error("Error ensuring user in organization:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to ensure user in organization",
    };
  }
}

/**
 * Fetch Slack channels using the bot token (if installed)
 * This endpoint checks if the bot is installed in the workspace and uses bot permissions
 */
export async function fetchSlackChannels() {
  try {
    // Get user's workspace team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // Call api-server to check bot installation and fetch channels
    const { apiClient } = await import("@/lib/api-client");
    const result = await apiClient<{
      success: boolean;
      data?: Array<{
        id: string;
        name: string;
        isPrivate: boolean;
        isMember: boolean;
        numMembers: number;
      }>;
      error?: string;
      message?: string;
    }>(`/api/workspace/${teamId}/channels`);
    
    return result;
  } catch (error) {
    console.error("Error fetching Slack channels:", error);
    
    // Check if it's a 401 (bot not installed)
    if (error && typeof error === 'object' && 'data' in error) {
      const errorData = error.data as { error?: string; message?: string };
      if (errorData?.error === 'bot_not_installed') {
        return {
          success: false,
          error: "bot_not_installed",
          message: errorData.message || "Bot not installed in your workspace",
        };
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch channels",
    };
  }
}

/**
 * Check if the bot is installed in the user's workspace
 */
export async function checkBotInstallation() {
  try {
    // Get user's workspace team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // Call api-server to check installation status
    const { apiClient } = await import("@/lib/api-client");
    const result = await apiClient<{
      success: boolean;
      installed: boolean;
      data?: {
        teamId: string;
        teamName: string;
        teamUrl: string;
        botUserId: string;
        scopes: string[];
        installedAt: Date;
        installedBy: string;
      };
    }>(`/api/workspace/${teamId}/status`);
    
    return result;
  } catch (error) {
    console.error("Error checking bot installation:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to check installation",
    };
  }
}



/**
 * Add user to an existing Slack channel
 */
export async function addUserToChannel(channelId: string) {
  try {
    // Get user's workspace team_id and user_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    const userId = workspaceInfo.data.userId;
    
    // Call api-server to add user to channel
    const { apiClient } = await import("@/lib/api-client");
    const result = await apiClient<{
      success: boolean;
      userAdded?: boolean;
      error?: string;
      message?: string;
    }>(`/api/workspace/${teamId}/channels/${channelId}/members`, {
      method: 'POST',
      body: {
        userId: userId,
      },
    });
    
    return result;
  } catch (error) {
    console.error("Error adding user to channel:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add user to channel",
    };
  }
}

/**
 * Create a Slack channel using the bot token (if installed)
 */
export async function createSlackChannel(channelName: string, isPrivate: boolean = false) {
  try {
    // Get user's workspace team_id and user_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    const userId = workspaceInfo.data.userId;
    
    // Validate channel name
    if (!channelName || channelName.trim().length === 0) {
      return {
        success: false,
        error: "Channel name is required",
      };
    }
    
    const normalizedName = channelName.trim().toLowerCase();
    if (normalizedName.length < 1 || normalizedName.length > 80) {
      return {
        success: false,
        error: "Channel name must be between 1 and 80 characters",
      };
    }
    
    // Call api-server to create channel using bot token
    const { apiClient } = await import("@/lib/api-client");
    const result = await apiClient<{
      success: boolean;
      data?: {
        id: string;
        name: string;
        isPrivate: boolean;
        userAdded?: boolean;
      };
      error?: string;
      message?: string;
    }>(`/api/workspace/${teamId}/channels`, {
      method: 'POST',
      body: {
        name: normalizedName,
        isPrivate: Boolean(isPrivate),
        userId: userId,
      },
    });
    
    return result;
  } catch (error) {
    console.error("Error creating Slack channel:", error);
    
    // Check if it's a specific error from the API
    if (error && typeof error === 'object' && 'data' in error) {
      const errorData = error.data as { error?: string; message?: string };
      if (errorData?.error === 'bot_not_installed') {
        return {
          success: false,
          error: "bot_not_installed",
          message: errorData.message || "Bot not installed in your workspace",
        };
      }
      if (errorData?.error === 'name_taken') {
        return {
          success: false,
          error: "name_taken",
          message: errorData.message || "Channel name already exists",
        };
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create channel",
    };
  }
}

/**
 * Fetch user configuration from the API server
 * Uses internal API client with proper authentication
 */
export async function fetchUserConfig(slackUserId: string) {
  try {
    const { apiClient } = await import("@/lib/api-client");
    const result = await apiClient<{
      success: boolean;
      data?: {
        userId: string;
        sendingDomain: string | null;
        shouldShowFullEmail: boolean;
      };
      error?: string;
    }>(`/api/user-config/${slackUserId}`);

    return result.success && result.data ? result.data : null;
  } catch (error) {
    console.error("Error fetching user config:", error);
    return null;
  }
}

/**
 * Fetch domains from Inbound.new API
 */
export async function fetchInboundDomains(inboundApiKey: string) {
  try {
    const response = await fetch("https://inbound.new/api/v2/domains", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${inboundApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: "Failed to fetch domains from Inbound.new",
      };
    }

    const data = await response.json();
    
    // Filter only verified and active domains
    const verifiedDomains = data.data?.filter(
      (domain: { status: string; canReceiveEmails: boolean }) =>
        domain.status === "verified" && domain.canReceiveEmails === true
    ) || [];

    return {
      success: true,
      data: verifiedDomains,
    };
  } catch (error) {
    console.error("Error fetching inbound domains:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch domains",
    };
  }
}

/**
 * @deprecated This function is deprecated. Use updateWorkspaceConfig instead.
 * All configuration is now stored at the workspace level.
 */
export async function updateUserConfig(config: {
  shouldShowFullEmail?: boolean;
  sendingDomain?: string;
}) {
  try {
    const slackUserId = await getSlackUserId();
    if (!slackUserId) {
      return {
        success: false,
        error: "Slack user ID not found",
      };
    }

    // Domain verification is now handled at workspace level

    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:3668";

    // Update API server
    const apiResponse = await fetch(`${backendUrl}/api/user-config/${slackUserId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shouldShowFullEmail: config.shouldShowFullEmail,
        sendingDomain: config.sendingDomain,
      }),
    });

    if (!apiResponse.ok) {
      const errorData = await apiResponse.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || "Failed to update configuration on API server",
      };
    }

    const apiData = await apiResponse.json();
    const updatedConfig = apiData.success ? apiData.data : null;

    if (!updatedConfig) {
      return {
        success: false,
        error: "Invalid response from API server",
      };
    }

    // Update local database
    const db = getDb();
    const existingConfig = await db
      .select()
      .from(userConfig)
      .where(eq(userConfig.userId, slackUserId))
      .limit(1);

    // Update local database with API server response
    const updateData: {
      sendingDomain?: string;
      shouldShowFullEmail?: boolean;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    // Use config values if provided, otherwise fall back to API response
    if (config.sendingDomain !== undefined && config.sendingDomain !== null) {
      updateData.sendingDomain = config.sendingDomain;
    } else if (updatedConfig.sendingDomain !== undefined && updatedConfig.sendingDomain !== null) {
      updateData.sendingDomain = updatedConfig.sendingDomain;
    }
    
    if (config.shouldShowFullEmail !== undefined) {
      updateData.shouldShowFullEmail = config.shouldShowFullEmail ?? false;
    } else if (updatedConfig.shouldShowFullEmail !== undefined) {
      updateData.shouldShowFullEmail = updatedConfig.shouldShowFullEmail ?? false;
    }

    if (existingConfig.length === 0) {
      await db.insert(userConfig).values({
        userId: slackUserId,
        sendingDomain: config.sendingDomain || updatedConfig.sendingDomain || undefined,
        shouldShowFullEmail: config.shouldShowFullEmail ?? updatedConfig.shouldShowFullEmail ?? false,
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(userConfig)
        .set(updateData)
        .where(eq(userConfig.userId, slackUserId));
    }

    return {
      success: true,
      data: updatedConfig,
    };
  } catch (error) {
    console.error("Error updating user config:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update configuration",
    };
  }
}

/**
 * Get user configuration from local database
 */
export async function getLocalUserConfig(slackUserId: string) {
  try {
    const db = getDb();
    const config = await db
      .select()
      .from(userConfig)
      .where(eq(userConfig.userId, slackUserId))
      .limit(1);

    return config.length > 0 ? config[0] : null;
  } catch (error) {
    console.error("Error fetching local user config:", error);
    return null;
  }
}

/**
 * Get current user's configuration - fetches from API server first, then falls back to local database
 */
export async function getCurrentUserConfig() {
  try {
    const slackUserId = await getSlackUserId();
    if (!slackUserId) {
      return null;
    }

    // Try to fetch from API server first
    const apiConfig = await fetchUserConfig(slackUserId);
    if (apiConfig) {
      // Sync to local database
      const db = getDb();
      const existingConfig = await db
        .select()
        .from(userConfig)
        .where(eq(userConfig.userId, slackUserId))
        .limit(1);

      if (existingConfig.length === 0) {
        await db.insert(userConfig).values({
          userId: slackUserId,
          sendingDomain: apiConfig.sendingDomain || null,
          shouldShowFullEmail: apiConfig.shouldShowFullEmail ?? false,
          updatedAt: new Date(),
        });
      } else {
        await db
          .update(userConfig)
          .set({
            sendingDomain: apiConfig.sendingDomain || null,
            shouldShowFullEmail: apiConfig.shouldShowFullEmail ?? false,
            updatedAt: new Date(),
          })
          .where(eq(userConfig.userId, slackUserId));
      }

      // Return the local config after syncing
      return await getLocalUserConfig(slackUserId);
    }

    // Fallback to local database
    return await getLocalUserConfig(slackUserId);
  } catch (error) {
    console.error("Error getting current user config:", error);
    return null;
  }
}

/**
 * Update inbound API key - saves only to local database
 */
/**
 * Get workspace configuration
 */
export async function getWorkspaceConfig() {
  try {
    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:3668";
    
    const response = await fetch(`${backendUrl}/api/workspace/${teamId}/config`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY || ""}`,
      },
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || "Failed to fetch workspace configuration",
      };
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching workspace config:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch workspace configuration",
    };
  }
}

/**
 * Update workspace configuration
 */
export async function updateWorkspaceConfig(config: {
  shouldShowFullEmail?: boolean;
  sendingDomain?: string | null;
  channelNamePrefix?: string | null;
  inboundApiKey?: string | null;
}) {
  try {
    // Check if user is admin
    const roleCheck = await getCurrentUserRole();
    if (!roleCheck.success || !roleCheck.data) {
      return {
        success: false,
        error: "Permission denied. Unable to verify role.",
      };
    }

    if (roleCheck.data.role !== 'admin') {
      return {
        success: false,
        error: "Only administrators can update workspace configuration.",
      };
    }

    const workspaceInfo = await getSlackWorkspaceInfo();
    
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return {
        success: false,
        error: "Cannot determine your workspace. Please sign in with Slack.",
      };
    }
    
    const teamId = workspaceInfo.data.teamId;
    
    // If sendingDomain is being updated, verify it exists in Inbound.new
    if (config.sendingDomain) {
      // Use the API key from the request if provided, otherwise check the database
      let apiKey: string | null = null;
      
      if (config.inboundApiKey) {
        // User is providing a new API key in this request - use it
        apiKey = config.inboundApiKey;
      } else {
        // No API key in request - check if one exists in database
        apiKey = await getWorkspaceInboundApiKey(teamId);
      }
      
      if (!apiKey) {
        return {
          success: false,
          error: "Inbound API key not found. Please configure your API key first.",
        };
      }
      
      // Verify the domain belongs to the workspace's Inbound.new account
      const domainsResult = await fetchInboundDomains(apiKey);
      if (!domainsResult.success || !domainsResult.data) {
        return {
          success: false,
          error: "Failed to verify domain ownership",
        };
      }
      
      const domainExists = domainsResult.data.some(
        (domain: { domain: string; status: string; canReceiveEmails: boolean }) =>
          domain.domain === config.sendingDomain &&
          domain.status === "verified" &&
          domain.canReceiveEmails === true
      );
      
      if (!domainExists) {
        return {
          success: false,
          error: "Domain not found or not verified in your Inbound.new account",
        };
      }
    }
    
    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:3668";
    
    const response = await fetch(`${backendUrl}/api/workspace/${teamId}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY || ""}`,
      },
      body: JSON.stringify(config),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || "Failed to update workspace configuration",
      };
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error updating workspace config:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update workspace configuration",
    };
  }
}

/**
 * @deprecated This function is deprecated. Use updateWorkspaceConfig with inboundApiKey instead.
 * Inbound API key is now stored at the workspace level, not user level.
 */
export async function updateInboundApiKey(inboundApiKey: string) {
  console.warn("updateInboundApiKey is deprecated. Use updateWorkspaceConfig with inboundApiKey instead.");
  return {
    success: false,
    error: "This function is deprecated. Inbound API key is now configured at workspace level.",
  };
}

/**
 * Get current user's role in their organization
 */
export async function getCurrentUserRole() {
  try {
    const { user } = await withAuth();
    if (!user) {
      return { success: false, error: "not_authenticated" };
    }

    // Get workspace info to find team_id
    const workspaceInfo = await getSlackWorkspaceInfo();
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return { success: false, error: "no_workspace" };
    }

    const teamId = workspaceInfo.data.teamId;

    // Get organization
    const org = await getOrganizationByTeamId(teamId);
    if (!org) {
      return { success: false, error: "bot_not_installed" };
    }

    // Get user's membership
    const memberships = await workos.userManagement.listOrganizationMemberships({
      userId: user.id,
      organizationId: org.id,
    });

    if (memberships.data.length === 0) {
      return { success: false, error: "not_member" };
    }

    const membership = memberships.data[0];
    
    // Check if user is the owner (bot installer)
    const db = getDb();
    const workspace = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.teamId, teamId))
      .limit(1);

    const isOwner = workspace.length > 0 && workspace[0].installedBy === user.id;

    return {
      success: true,
      data: {
        role: membership.role?.slug || 'member',
        isOwner,
        membershipId: membership.id,
      },
    };
  } catch (error) {
    console.error("Error getting current user role:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get user role",
    };
  }
}

/**
 * List all members of the current user's organization
 * Only admins can see all members
 */
export async function listOrganizationMembers() {
  try {
    const { user } = await withAuth();
    if (!user) {
      return { success: false, error: "not_authenticated" };
    }

    // Get workspace info
    const workspaceInfo = await getSlackWorkspaceInfo();
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return { success: false, error: "no_workspace" };
    }

    const teamId = workspaceInfo.data.teamId;

    // Get organization
    const org = await getOrganizationByTeamId(teamId);
    if (!org) {
      return { success: false, error: "bot_not_installed" };
    }

    // Check user's role
    const roleCheck = await getCurrentUserRole();
    if (!roleCheck.success || !roleCheck.data) {
      return { success: false, error: "permission_denied" };
    }

    // Only admins can list all members
    if (roleCheck.data.role !== 'admin') {
      return { success: false, error: "admin_only" };
    }

    // Get all members
    const memberships = await workos.userManagement.listOrganizationMemberships({
      organizationId: org.id,
    });

    // Get workspace owner
    const db = getDb();
    const workspace = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.teamId, teamId))
      .limit(1);

    const ownerId = workspace.length > 0 ? workspace[0].installedBy : null;

    // Fetch user details for each member
    const members = await Promise.all(
      memberships.data.map(async (membership) => {
        try {
          const userDetails = await workos.userManagement.getUser(membership.userId);
          return {
            id: membership.id,
            userId: membership.userId,
            email: userDetails.email,
            firstName: userDetails.firstName || '',
            lastName: userDetails.lastName || '',
            profilePictureUrl: userDetails.profilePictureUrl || null,
            role: membership.role?.slug || 'member',
            status: membership.status,
            isOwner: membership.userId === ownerId,
            createdAt: membership.createdAt,
          };
        } catch (error) {
          console.error(`Error fetching user ${membership.userId}:`, error);
          return null;
        }
      })
    );

    return {
      success: true,
      data: members.filter((m) => m !== null),
    };
  } catch (error) {
    console.error("Error listing organization members:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to list members",
    };
  }
}

/**
 * Update a member's role
 * Only admins can update roles, and owner cannot be demoted
 */
export async function updateMemberRole(membershipId: string, newRole: 'admin' | 'member') {
  try {
    const { user } = await withAuth();
    if (!user) {
      return { success: false, error: "not_authenticated" };
    }

    // Check if current user is admin
    const roleCheck = await getCurrentUserRole();
    if (!roleCheck.success || !roleCheck.data) {
      return { success: false, error: "permission_denied" };
    }

    if (roleCheck.data.role !== 'admin') {
      return { success: false, error: "admin_only" };
    }

    // Get the membership being updated
    const membership = await workos.userManagement.getOrganizationMembership(membershipId);

    // Check if target user is the owner
    const workspaceInfo = await getSlackWorkspaceInfo();
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return { success: false, error: "no_workspace" };
    }

    const db = getDb();
    const workspace = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.teamId, workspaceInfo.data.teamId))
      .limit(1);

    const isOwner = workspace.length > 0 && workspace[0].installedBy === membership.userId;

    // Owners cannot be demoted
    if (isOwner && newRole === 'member') {
      return { success: false, error: "cannot_demote_owner" };
    }

    // Update the role
    await workos.userManagement.updateOrganizationMembership(membershipId, {
      roleSlug: newRole,
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating member role:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update role",
    };
  }
}

/**
 * Remove a member from the organization
 * Only admins can remove members, and owner cannot be removed
 */
export async function removeMember(membershipId: string) {
  try {
    const { user } = await withAuth();
    if (!user) {
      return { success: false, error: "not_authenticated" };
    }

    // Check if current user is admin
    const roleCheck = await getCurrentUserRole();
    if (!roleCheck.success || !roleCheck.data) {
      return { success: false, error: "permission_denied" };
    }

    if (roleCheck.data.role !== 'admin') {
      return { success: false, error: "admin_only" };
    }

    // Get the membership being removed
    const membership = await workos.userManagement.getOrganizationMembership(membershipId);

    // Prevent removing self
    if (membership.userId === user.id) {
      return { success: false, error: "cannot_remove_self" };
    }

    // Check if target user is the owner
    const workspaceInfo = await getSlackWorkspaceInfo();
    if (!workspaceInfo.success || !workspaceInfo.data) {
      return { success: false, error: "no_workspace" };
    }

    const db = getDb();
    const workspace = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.teamId, workspaceInfo.data.teamId))
      .limit(1);

    const isOwner = workspace.length > 0 && workspace[0].installedBy === membership.userId;

    // Owners cannot be removed
    if (isOwner) {
      return { success: false, error: "cannot_remove_owner" };
    }

    // Remove the member
    await workos.userManagement.deleteOrganizationMembership(membershipId);

    return { success: true };
  } catch (error) {
    console.error("Error removing member:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to remove member",
    };
  }
}

