# Slack Auth Architecture: User Login + Bot Installation

## Current State Analysis

### What Works Now
✅ **User Authentication**: Users can log into the dashboard via Slack OAuth
✅ **Single Workspace Bot**: API server uses one hardcoded `SLACK_BOT_TOKEN` from `.env`
✅ **User Token Storage**: better-auth stores user access tokens in `account` table

### The Problem
❌ **Bot tokens are hardcoded**: Only works for ONE workspace (yours)
❌ **No multi-workspace support**: Other workspaces can't install your bot
❌ **Bot and user tokens are mixed**: User login OAuth gives user tokens, not bot tokens

---

## Architecture Understanding

### Current Setup

```
┌─────────────────────────────────────────────────────────────┐
│ Dashboard (apps/dashboard)                                   │
│  • better-auth Slack OAuth → USER token (xoxp-)             │
│  • Stored in: account.accessToken                           │
│  • Purpose: User logs in, manages settings                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ API Server (apps/api-server)                                │
│  • Slack Bolt App → BOT token (xoxb-) from .env            │
│  • Hardcoded: process.env.SLACK_BOT_TOKEN                   │
│  • Purpose: Bot posts messages, handles events              │
└─────────────────────────────────────────────────────────────┘
```

### What You Actually Need

```
┌─────────────────────────────────────────────────────────────┐
│ TWO SEPARATE OAUTH FLOWS                                     │
│                                                              │
│ 1. USER AUTH (Dashboard Login)                              │
│    ├─ Scopes: identify, channels:read, channels:write       │
│    ├─ Returns: User token (xoxp-)                           │
│    └─ Purpose: User manages their settings                  │
│                                                              │
│ 2. BOT INSTALLATION (Workspace Install)                     │
│    ├─ Scopes: channels:read, chat:write, etc.              │
│    ├─ Returns: Bot token (xoxb-) + Team ID                  │
│    └─ Purpose: Bot can post messages to workspace           │
└─────────────────────────────────────────────────────────────┘
```

---

## Solution Options

### Option 1: ✨ **Separate OAuth Flow (Recommended)**

**How it works:**
- Keep better-auth for user login (current implementation)
- Add a SEPARATE "Add to Slack" button for bot installation
- Handle bot OAuth manually with Slack OAuth v2 API
- Store bot tokens in a new `workspace_installations` table

**Pros:**
- ✅ Clean separation of concerns
- ✅ Each workspace gets its own bot token
- ✅ Users can manage settings independent of bot installation
- ✅ Multi-workspace SaaS ready

**Cons:**
- ❌ More code to maintain
- ❌ Two OAuth flows to manage

**Implementation:**

```typescript
// 1. Create workspace_installations table
export const workspaceInstallations = pgTable("workspace_installations", {
  id: text("id").primaryKey(),
  teamId: text("teamId").notNull().unique(),
  teamName: text("teamName").notNull(),
  botUserId: text("botUserId").notNull(),
  botAccessToken: text("botAccessToken").notNull(), // xoxb-
  scope: text("scope"),
  installedBy: text("installedBy").notNull(), // User ID who installed
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

// 2. Add "Add to Slack" button in dashboard
<a href="/api/slack/install">
  <img
    src="https://platform.slack-edge.com/img/add_to_slack.png"
    srcSet="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x"
  />
</a>

// 3. Create bot installation endpoints
// apps/dashboard/app/api/slack/install/route.ts
export async function GET() {
  const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackAuthUrl.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
  slackAuthUrl.searchParams.set("scope", "channels:read,chat:write,chat:write.public,...");
  slackAuthUrl.searchParams.set("redirect_uri", `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`);

  return Response.redirect(slackAuthUrl.toString());
}

// apps/dashboard/app/api/slack/callback/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // Exchange code for bot token
  const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/slack/callback`,
    }),
  });

  const data = await tokenResponse.json();

  // Store bot token
  await db.insert(workspaceInstallations).values({
    id: generateId(),
    teamId: data.team.id,
    teamName: data.team.name,
    botUserId: data.bot_user_id,
    botAccessToken: data.access_token, // xoxb- token
    scope: data.scope,
    installedBy: session.user.id, // from better-auth session
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return Response.redirect("/dashboard?installed=true");
}

// 4. Update API server to use workspace-specific tokens
// apps/api-server/src/bolt/app.ts
import { InstallationStore } from '@slack/bolt';

const installationStore: InstallationStore = {
  storeInstallation: async (installation) => {
    // Store in workspaceInstallations table
  },
  fetchInstallation: async (installQuery) => {
    // Fetch from workspaceInstallations table by teamId
    const workspace = await db.query.workspaceInstallations.findFirst({
      where: eq(workspaceInstallations.teamId, installQuery.teamId),
    });

    if (!workspace) throw new Error("Installation not found");

    return {
      team: { id: workspace.teamId },
      bot: {
        token: workspace.botAccessToken,
        userId: workspace.botUserId,
      },
    };
  },
  deleteInstallation: async (installQuery) => {
    // Delete from workspaceInstallations table
  },
};

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  installationStore,
  receiver,
});
```

---

### Option 2: 🔗 **better-auth Account Linking**

**How it works:**
- Use better-auth's account linking to link BOTH user and bot OAuth
- Create two Slack providers: "slack-user" and "slack-bot"
- User links both accounts to their profile

**Pros:**
- ✅ Everything managed by better-auth
- ✅ Unified account management

**Cons:**
- ❌ Confusing UX (why link Slack twice?)
- ❌ Not designed for workspace-level bot tokens
- ❌ Account linking has known bugs with generic OAuth
- ❌ Doesn't scale to multi-workspace (one bot per user, not per workspace)

**Verdict:** ⚠️ **Not Recommended** - Account linking is for personal accounts, not workspace-level bot installations.

---

### Option 3: 🔀 **Hybrid: better-auth + Custom Bot OAuth**

**How it works:**
- Use better-auth ONLY for user authentication
- Custom bot installation flow (like Option 1)
- Store bot tokens separately
- Simpler than Option 1, focuses on the essentials

**Pros:**
- ✅ Simple and focused
- ✅ Multi-workspace ready
- ✅ Keeps better-auth for what it's good at

**Cons:**
- ❌ Still need custom OAuth code

**Implementation:** Same as Option 1, but simpler database schema:

```typescript
export const workspaces = pgTable("workspaces", {
  teamId: text("teamId").primaryKey(),
  teamName: text("teamName").notNull(),
  botToken: text("botToken").notNull(), // xoxb-
  installedAt: timestamp("installedAt").notNull(),
});
```

---

## Recommended Approach

### 🎯 **Go with Option 1 (Separate OAuth Flow)**

**Why:**
1. **Correct architecture**: Bot installation is workspace-level, user auth is user-level
2. **Multi-workspace ready**: Essential for SaaS
3. **Clean separation**: Easy to understand and maintain
4. **Industry standard**: This is how Slack apps like Zapier, Notion, etc. work

**Implementation Steps:**

1. ✅ **Keep current better-auth setup** for user login
2. ✅ **Add workspace_installations table** to store bot tokens per workspace
3. ✅ **Create /api/slack/install + /api/slack/callback** endpoints for bot OAuth
4. ✅ **Update Bolt app** to use InstallationStore instead of hardcoded token
5. ✅ **Add "Add to Slack" button** in dashboard for workspace admins

**User Flow:**
```
1. User logs in with Slack (better-auth) → Gets user settings access
2. User clicks "Add to Slack" → Installs bot to their workspace
3. Bot token stored in workspace_installations table
4. API server looks up bot token by teamId when posting messages
5. Multiple workspaces can install the bot, each with their own token
```

---

## Next Steps

1. **Database Migration**:
   - Add `workspace_installations` table
   - Store team_id, bot_token, team_name, installed_by, installed_at

2. **Dashboard Changes**:
   - Add "Add to Slack" button (only show to workspace admins)
   - Show installation status in Developer card
   - List all workspaces where bot is installed

3. **API Server Changes**:
   - Replace hardcoded `SLACK_BOT_TOKEN` with `InstallationStore`
   - Look up correct bot token based on team_id from incoming events
   - Handle token refresh (if using user tokens)

4. **Slack App Config**:
   - Add OAuth redirect URLs to Slack app settings
   - Ensure bot scopes are correct: `channels:read`, `chat:write`, `chat:write.public`, etc.
   - Enable "Distribute App" if going multi-workspace

---

## Questions?

**Q: Can I use better-auth for bot installation too?**
A: Not recommended. better-auth is designed for user authentication, not workspace-level bot installations. Custom OAuth is better suited for this.

**Q: Do I need both user and bot tokens?**
A: Yes! User tokens = user settings. Bot tokens = bot posts messages. Different purposes.

**Q: What if a user is in multiple workspaces?**
A: One user account, multiple workspace installations. User can manage settings across all workspaces they're in.

**Q: How do I know which workspace a webhook is from?**
A: Slack events include `team_id` - use that to look up the correct bot token from `workspace_installations`.

---

Generated: 2025-10-30
Research: Claude Code + better-auth docs + Slack OAuth docs
