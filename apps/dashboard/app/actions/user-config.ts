"use server";

// Load env vars from root first
import "@/lib/env";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { userConfig, account } from "@slackbound/db";
import { getAuth } from "@/lib/auth";
import { WebClient } from "@slack/web-api";

/**
 * Create Slack channel (placeholder)
 */
export async function createSlackChannel(channelName: string) {
  // TODO: Implement Slack channel creation
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { success: true, channelId: "C123456" };
}

/**
 * Create email address (placeholder)
 */
export async function createEmailAddress(emailAddress: string) {
  // TODO: Implement email address creation via Inbound API
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { success: true, emailId: "email123" };
}

/**
 * Link channel and email (placeholder)
 */
export async function linkChannelAndEmail(channelId: string, emailId: string) {
  // TODO: Implement linking channel and email
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { success: true };
}
async function getSlackUserId(): Promise<string | null> {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return null;
    }

    const db = getDb();
    const accountRecord = await db
      .select()
      .from(account)
      .where(eq(account.userId, session.user.id))
      .limit(1);

    if (accountRecord.length === 0 || accountRecord[0].providerId !== "slack") {
      return null;
    }

    return accountRecord[0].accountId;
  } catch (error) {
    console.error("Error getting Slack user ID:", error);
    return null;
  }
}

/**
 * Get Slack access token from the current user's session
 */
async function getSlackAccessToken(): Promise<string | null> {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return null;
    }

    const db = getDb();
    const accountRecord = await db
      .select()
      .from(account)
      .where(eq(account.userId, session.user.id))
      .limit(1);

    if (accountRecord.length === 0 || accountRecord[0].providerId !== "slack") {
      return null;
    }

    return accountRecord[0].accessToken || null;
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
 * Fetch user configuration from the API server
 */
export async function fetchUserConfig(slackUserId: string) {
  try {
    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:3668";
    const response = await fetch(`${backendUrl}/api/user-config/${slackUserId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.success ? data.data : null;
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
 * Update user configuration - saves to both API server and local database
 */
export async function updateUserConfig(config: {
  shouldShowFullEmail?: boolean;
  sendingDomain?: string;
  inboundApiKey?: string;
}) {
  try {
    const slackUserId = await getSlackUserId();
    if (!slackUserId) {
      return {
        success: false,
        error: "Slack user ID not found",
      };
    }

    // If sendingDomain is being updated, verify the user owns it
    if (config.sendingDomain) {
      const db = getDb();
      const localConfig = await db
        .select()
        .from(userConfig)
        .where(eq(userConfig.userId, slackUserId))
        .limit(1);

      const apiKey = localConfig[0]?.inboundApiKey;
      if (!apiKey) {
        return {
          success: false,
          error: "Inbound API key not found. Please configure your API key first.",
        };
      }

      // Verify the domain belongs to the user's account
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

    // Handle inboundApiKey update (only stored locally, not synced to API server)
    const updateData: {
      sendingDomain?: string;
      shouldShowFullEmail?: boolean;
      inboundApiKey?: string;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    // Use config values if provided, otherwise fall back to API response
    // Only include fields that are defined (omit null/undefined values)
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
    
    if (config.inboundApiKey !== undefined && config.inboundApiKey !== null) {
      updateData.inboundApiKey = config.inboundApiKey;
    }

    if (existingConfig.length === 0) {
      await db.insert(userConfig).values({
        userId: slackUserId,
        sendingDomain: config.sendingDomain || updatedConfig.sendingDomain || undefined,
        shouldShowFullEmail: config.shouldShowFullEmail ?? updatedConfig.shouldShowFullEmail ?? false,
        inboundApiKey: config.inboundApiKey || undefined,
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

      // Get existing local config to preserve inboundApiKey
      const localConfig = await getLocalUserConfig(slackUserId);
      
      if (existingConfig.length === 0) {
        await db.insert(userConfig).values({
          userId: slackUserId,
          sendingDomain: apiConfig.sendingDomain || null,
          shouldShowFullEmail: apiConfig.shouldShowFullEmail ?? false,
          inboundApiKey: localConfig?.inboundApiKey || null,
          updatedAt: new Date(),
        });
      } else {
        await db
          .update(userConfig)
          .set({
            sendingDomain: apiConfig.sendingDomain || null,
            shouldShowFullEmail: apiConfig.shouldShowFullEmail ?? false,
            // Preserve inboundApiKey if it exists locally
            inboundApiKey: localConfig?.inboundApiKey || existingConfig[0].inboundApiKey || null,
            updatedAt: new Date(),
          })
          .where(eq(userConfig.userId, slackUserId));
      }

      // Return the local config (which includes inboundApiKey) after syncing
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
export async function updateInboundApiKey(inboundApiKey: string) {
  try {
    const slackUserId = await getSlackUserId();
    if (!slackUserId) {
      return {
        success: false,
        error: "Slack user ID not found",
      };
    }

    const db = getDb();
    const existingConfig = await db
      .select()
      .from(userConfig)
      .where(eq(userConfig.userId, slackUserId))
      .limit(1);

    if (existingConfig.length === 0) {
      await db.insert(userConfig).values({
        userId: slackUserId,
        inboundApiKey,
        shouldShowFullEmail: false,
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(userConfig)
        .set({
          inboundApiKey,
          updatedAt: new Date(),
        })
        .where(eq(userConfig.userId, slackUserId));
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error updating inbound API key:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update API key",
    };
  }
}

