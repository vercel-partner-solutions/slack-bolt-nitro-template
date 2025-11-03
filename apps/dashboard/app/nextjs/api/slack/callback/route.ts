import { NextResponse } from "next/server";
import { withAuth } from "@/lib/workos-auth";
import { getDb } from "@/db";
import { workspaceInstallations, workspaceConfig, userConfig } from "@slackbound/db";
import { eq } from "drizzle-orm";
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { getOrCreateOrganization, addUserToOrganization } from "@/lib/workos-organizations";
import { Autumn } from 'autumn-js';

// Encryption utilities (copied from api-server for now)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment variable
 */
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

function encrypt(text: string): string {
  const password = getEncryptionKey();
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Handle Slack OAuth callback
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Handle OAuth errors
    if (error) {
      console.error("Slack OAuth error:", error);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=oauth_failed`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=invalid_callback`
      );
    }

    // Verify user is authenticated with WorkOS
    const { user } = await withAuth();

    if (!user) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=not_authenticated`
      );
    }

    // Verify state matches WorkOS user ID (CSRF protection)
    if (state !== user.id) {
      console.error("State mismatch - possible CSRF attack");
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=invalid_state`
      );
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/nextjs/api/slack/callback`,
      }),
    });

    const data = await tokenResponse.json();

    if (!data.ok) {
      console.error("Slack OAuth token exchange failed:", data);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=token_exchange_failed`
      );
    }

    // Extract installation data
    const teamId = data.team?.id;
    const teamName = data.team?.name;
    const teamUrl = data.team?.url;
    const botUserId = data.bot_user_id;
    const botAccessToken = data.access_token;
    const scopes = data.scope;
    const enterpriseId = data.enterprise?.id;
    
    // Extract the authenticated user's Slack ID (the person installing the bot)
    const authedUserId = data.authed_user?.id;

    if (!teamId || !botAccessToken || !botUserId) {
      console.error("Missing required data from Slack OAuth response");
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=incomplete_data`
      );
    }

    // Encrypt bot token
    const encryptedToken = encrypt(botAccessToken);

    // Get or create WorkOS organization for this Slack workspace
    console.log(`[WorkOS] Getting or creating organization for team ${teamId}: ${teamName}`);
    const workosOrg = await getOrCreateOrganization(teamId, teamName);
    
    // Add authenticated user to the organization as Admin (bot installer is always admin)
    console.log(`[WorkOS] Adding user ${user.id} to organization ${workosOrg.id} as admin`);
    await addUserToOrganization(user.id, workosOrg.id, 'admin');

    const db = getDb();

    // Check if workspace already installed
    const existingResults = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.teamId, teamId))
      .limit(1);
    
    const existing = existingResults.length > 0 ? existingResults[0] : null;

    const now = new Date();

    if (existing) {
      // Update existing installation
      await db
        .update(workspaceInstallations)
        .set({
          teamName,
          teamUrl: teamUrl || null,
          botUserId,
          botAccessToken: encryptedToken,
          scopes,
          enterpriseId: enterpriseId || null,
          workosOrganizationId: workosOrg.id,
          isActive: true,
          uninstalledAt: null,
          updatedAt: now,
        })
        .where(eq(workspaceInstallations.teamId, teamId));

      console.log(`Updated installation for workspace: ${teamId}`);
    } else {
      // Create new installation
      await db.insert(workspaceInstallations).values({
        teamId,
        enterpriseId: enterpriseId || null,
        teamName,
        teamUrl: teamUrl || null,
        workosOrganizationId: workosOrg.id,
        botUserId,
        botAccessToken: encryptedToken,
        botRefreshToken: null,
        scopes,
        installedBy: user.id,
        installedAt: now,
        uninstalledAt: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      // Create default workspace config
      await db.insert(workspaceConfig).values({
        teamId,
        defaultChannelId: null,
        defaultChannelName: null,
        emailIntegrationEnabled: true,
        createdAt: now,
        updatedAt: now,
      });

      console.log(`Created new installation for workspace: ${teamId}`);
    }

    // Store the authenticated user's Slack ID in userConfig for user-to-channel invitations
    if (authedUserId) {
      try {
        const existingUserConfig = await db
          .select()
          .from(userConfig)
          .where(eq(userConfig.userId, user.id))
          .limit(1);
        
        if (existingUserConfig.length > 0) {
          // Update existing user config with Slack mapping
          await db
            .update(userConfig)
            .set({
              slackUserId: authedUserId,
              slackTeamId: teamId,
              updatedAt: now,
            })
            .where(eq(userConfig.userId, user.id));
          console.log(`[UserConfig] Updated Slack mapping for WorkOS user ${user.id} → Slack user ${authedUserId}`);
        } else {
          // Create new user config with Slack mapping
          await db.insert(userConfig).values({
            userId: user.id,
            slackUserId: authedUserId,
            slackTeamId: teamId,
            shouldShowFullEmail: false,
            createdAt: now,
            updatedAt: now,
          });
          console.log(`[UserConfig] Created Slack mapping for WorkOS user ${user.id} → Slack user ${authedUserId}`);
        }
      } catch (error) {
        // Non-critical - log but don't fail installation
        console.error('[UserConfig] Error storing Slack user mapping:', error);
      }
    } else {
      console.warn('[UserConfig] No authed_user.id in Slack OAuth response - cannot map Slack user ID');
    }

    // Attach free tier product to the WorkOS organization in Autumn
    try {
      const autumnApiKey = process.env.AUTUMN_API_KEY;
      if (autumnApiKey) {
        const autumn = new Autumn({ secretKey: autumnApiKey });
        await autumn.attach({
          customer_id: workosOrg.id,
          product_id: 'free_tier',
        });
        console.log(`[Autumn] Attached free_tier product to organization ${workosOrg.id}`);
        
        // Update customer metadata for searchability in Autumn dashboard
        // This makes it easier to identify workspaces by name rather than just WorkOS org ID
        try {
          await autumn.customers.update(workosOrg.id, {
            name: teamName,
          });
          console.log(`[Autumn] Updated customer metadata for ${workosOrg.id}: ${teamName}`);
        } catch (metadataError) {
          // Non-critical - log but don't fail installation
          console.warn('[Autumn] Error updating customer metadata (non-critical):', metadataError);
        }
      } else {
        console.warn('[Autumn] AUTUMN_API_KEY not configured, skipping product attachment');
      }
    } catch (error) {
      console.error('[Autumn] Error attaching free tier product:', error);
      // Don't fail the installation if Autumn attachment fails
    }

    // Redirect to dashboard with success message
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?installed=true&team=${encodeURIComponent(teamName)}`
    );
  } catch (error) {
    console.error("Error handling Slack OAuth callback:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=callback_failed`
    );
  }
}

