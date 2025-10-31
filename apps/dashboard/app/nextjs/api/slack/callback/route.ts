import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { workspaceInstallations, workspaceConfig } from "@slackbound/db";
import { eq } from "drizzle-orm";
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

// Encryption utilities (copied from api-server for now)
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

function encrypt(text: string): string {
  const password = process.env.ENCRYPTION_KEY!;
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

    // Verify user is authenticated
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/?error=not_authenticated`
      );
    }

    // Verify state matches user ID (CSRF protection)
    if (state !== session.user.id) {
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

    if (!teamId || !botAccessToken || !botUserId) {
      console.error("Missing required data from Slack OAuth response");
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=incomplete_data`
      );
    }

    // Encrypt bot token
    const encryptedToken = encrypt(botAccessToken);

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
        botUserId,
        botAccessToken: encryptedToken,
        botRefreshToken: null,
        scopes,
        installedBy: session.user.id,
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

