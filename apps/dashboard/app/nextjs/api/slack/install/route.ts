import { NextResponse } from "next/server";
import { withAuth } from "@/lib/workos-auth";

/**
 * Initiate Slack OAuth flow for bot installation
 */
export async function GET() {
  try {
    // Check if user is authenticated with WorkOS
    const { user } = await withAuth();

    if (!user) {
      return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "https://dev.slackbound.com"));
    }

    // Get bot scopes from manifest - these should match your Slack app configuration
    const botScopes = [
      "channels:history",
      "channels:read",
      "chat:write",
      "chat:write.customize",
      "chat:write.public",
      "commands",
      "files:write",
      "groups:history",
      "groups:read",
      "im:history",
      "im:read",
      "im:write",
      "mpim:history",
      "mpim:read",
      "reactions:read",
      "reactions:write",
      "users:read",
    ].join(",");

    // Build Slack OAuth URL
    const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");
    slackAuthUrl.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
    slackAuthUrl.searchParams.set("scope", botScopes);
    slackAuthUrl.searchParams.set(
      "redirect_uri",
      `${process.env.NEXT_PUBLIC_APP_URL}/nextjs/api/slack/callback`
    );
    
    // Use WorkOS user ID as state for CSRF protection
    slackAuthUrl.searchParams.set("state", user.id);

    return NextResponse.redirect(slackAuthUrl.toString());
  } catch (error) {
    console.error("Error initiating Slack OAuth:", error);
    return NextResponse.json(
      { error: "Failed to initiate installation" },
      { status: 500 }
    );
  }
}

