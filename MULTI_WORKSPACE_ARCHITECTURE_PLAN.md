# Multi-Workspace Slack Bot Architecture Plan

## Executive Summary

After evaluating the `SLACK_AUTH_ARCHITECTURE.md` document and researching Slack's multi-workspace capabilities, **the proposed architecture is fundamentally sound** but requires several enhancements to fully support multi-workspace/multi-organization deployments. This document provides a comprehensive plan addressing gaps and edge cases.

---

## Current Architecture Evaluation

### ✅ What's Correct in the Current Plan

1. **Separation of Concerns**: Correctly separates user OAuth (better-auth) from bot OAuth (custom flow)
2. **InstallationStore Pattern**: Using Bolt's `InstallationStore` is the right approach
3. **Team ID Routing**: Correctly identifies that `team_id` in events routes to correct bot token
4. **Multi-Workspace Foundation**: Database schema correctly stores one bot token per workspace

### ⚠️ Gaps and Considerations

The current plan has several gaps that need addressing for production-ready multi-workspace support:

#### 1. **Enterprise Grid Support**
- **Issue**: The plan doesn't account for Enterprise Grid organizations
- **Impact**: Enterprise Grid workspaces have `enterprise_id` in addition to `team_id`
- **Solution**: Need to handle both `team_id` and `enterprise_id` in installation storage

#### 2. **Shared Channels**
- **Issue**: Shared channels exist across workspaces - bot may be installed in one workspace but not another
- **Impact**: Events from shared channels may come from workspaces where bot isn't installed
- **Solution**: Need authorization checks before processing events

#### 3. **Token Refresh & Expiration**
- **Issue**: Bot tokens can expire (if using user tokens) or be revoked
- **Impact**: Need refresh token handling and error recovery
- **Solution**: Store refresh tokens, implement token refresh logic

#### 4. **Workspace-Specific Configuration**
- **Issue**: Current inbound email integration uses hardcoded `INBOUND_SLACK_CHANNEL_ID`
- **Impact**: Each workspace needs its own channel configuration
- **Solution**: Store workspace-level configuration (channels, settings)

#### 5. **Event Source Identification**
- **Issue**: Need to verify which workspace an event comes from
- **Impact**: Security - prevent cross-workspace data leakage
- **Solution**: Always validate `team_id` matches installation

#### 6. **Uninstallation Handling**
- **Issue**: What happens when a workspace uninstalls the bot?
- **Impact**: Need cleanup and graceful degradation
- **Solution**: Implement `deleteInstallation` and cleanup handlers

---

## Comprehensive Multi-Workspace Architecture

### Phase 1: Database Schema Design

#### Core Tables

```typescript
// Workspace Installations Table
export const workspaceInstallations = pgTable("workspace_installations", {
  id: text("id").primaryKey(), // UUID
  teamId: text("team_id").notNull().unique(), // Workspace ID (T123456)
  enterpriseId: text("enterprise_id"), // Enterprise Grid ID (E123456) - nullable
  teamName: text("team_name").notNull(),
  teamUrl: text("team_url"), // e.g., "https://acme.slack.com"
  
  // Bot credentials
  botUserId: text("bot_user_id").notNull(), // Bot user ID (U123456)
  botAccessToken: text("bot_access_token").notNull(), // xoxb- token (encrypted)
  botRefreshToken: text("bot_refresh_token"), // Refresh token if applicable
  botTokenExpiresAt: timestamp("bot_token_expires_at"), // Token expiration
  
  // Installation metadata
  scopes: text("scopes").notNull(), // Comma-separated scopes
  installedBy: text("installed_by").notNull(), // User ID from better-auth
  installedAt: timestamp("installed_at").notNull(),
  uninstalledAt: timestamp("uninstalled_at"), // Soft delete for audit
  
  // Workspace state
  isActive: boolean("is_active").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// Workspace Configuration Table
export const workspaceConfig = pgTable("workspace_config", {
  teamId: text("team_id").primaryKey()
    .references(() => workspaceInstallations.teamId),
  
  // Email integration settings
  inboundChannelId: text("inbound_channel_id"), // Default channel for emails
  inboundChannelName: text("inbound_channel_name"), // For display
  
  // Feature flags
  emailIntegrationEnabled: boolean("email_integration_enabled").notNull().default(true),
  
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// Index for fast lookups
// CREATE INDEX idx_workspace_installations_team_id ON workspace_installations(team_id);
// CREATE INDEX idx_workspace_installations_active ON workspace_installations(is_active) WHERE is_active = true;
```

**Key Design Decisions:**

1. **Soft Deletes**: `uninstalledAt` field allows audit trail and potential re-installation
2. **Enterprise Grid**: `enterpriseId` nullable - only Enterprise Grid workspaces have this
3. **Token Security**: `botAccessToken` should be encrypted at rest (use environment key)
4. **Configuration Separation**: Workspace config separate from installation for flexibility
5. **Active Flag**: `isActive` for quick filtering without checking `uninstalledAt`

---

### Phase 2: Installation Flow Architecture

#### OAuth Flow Components

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User clicks "Add to Slack"                               │
│    → /api/slack/install                                     │
│    → Redirects to Slack OAuth                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Slack OAuth Authorization                                │
│    → User approves scopes                                    │
│    → Redirects to callback with code                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. OAuth Callback Handler                                    │
│    → /api/slack/callback                                     │
│    → Exchange code for tokens                                │
│    → Parse oauth.v2.access response                          │
│    → Store installation in DB                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Initialize Workspace                                      │
│    → Create workspace_config entry                           │
│    → Set default channel (optional)                          │
│    → Send welcome message (optional)                          │
└─────────────────────────────────────────────────────────────┘
```

#### OAuth Response Structure

```typescript
// Slack OAuth v2 Access Response
interface OAuthV2AccessResponse {
  ok: boolean;
  access_token: string; // Bot token (xoxb-...)
  token_type: "bot";
  scope: string; // Comma-separated scopes
  bot_user_id: string; // Bot's user ID
  app_id: string;
  team: {
    id: string; // team_id (T123456)
    name: string; // Workspace name
  };
  enterprise?: {
    id: string; // Enterprise Grid ID (E123456)
    name: string; // Enterprise name
  };
  authed_user?: {
    id: string; // Installing user's ID
    scope: string;
    access_token?: string; // User token (if requested)
  };
  incoming_webhook?: {
    // Webhook-specific installation
  };
}
```

**Critical Implementation Details:**

1. **State Parameter**: Use OAuth state to prevent CSRF attacks
2. **Error Handling**: Handle denial, error codes, token exchange failures
3. **Duplicate Installations**: Check if `teamId` already exists (update vs insert)
4. **User Session**: Verify user is logged in (better-auth session)
5. **Enterprise Grid Detection**: Check if `enterprise` field exists

---

### Phase 3: Bolt InstallationStore Implementation

#### Complete InstallationStore

```typescript
// apps/api-server/src/bolt/installation-store.ts

import { Installation, InstallationQuery } from '@slack/bolt';
import { eq, and } from 'drizzle-orm';
import { db } from '../server/db';
import { workspaceInstallations } from '../server/db/schema';
import { encrypt, decrypt } from './utils/encryption'; // You'll need encryption utils

export const installationStore = {
  async storeInstallation(installation: Installation): Promise<void> {
    // Handle both org-wide and workspace-level installations
    const teamId = installation.team?.id;
    if (!teamId) {
      throw new Error('Installation missing team ID');
    }

    // Encrypt bot token before storage
    const encryptedToken = encrypt(installation.bot?.token || '');

    // Check if installation exists
    const existing = await db
      .select()
      .from(workspaceInstallations)
      .where(eq(workspaceInstallations.teamId, teamId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing installation
      await db
        .update(workspaceInstallations)
        .set({
          botAccessToken: encryptedToken,
          botUserId: installation.bot?.id || '',
          scopes: installation.bot?.scopes?.join(',') || '',
          enterpriseId: installation.enterprise?.id || null,
          isActive: true,
          uninstalledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(workspaceInstallations.teamId, teamId));
    } else {
      // Insert new installation
      await db.insert(workspaceInstallations).values({
        id: crypto.randomUUID(),
        teamId,
        enterpriseId: installation.enterprise?.id || null,
        teamName: installation.team?.name || 'Unknown',
        botUserId: installation.bot?.id || '',
        botAccessToken: encryptedToken,
        scopes: installation.bot?.scopes?.join(',') || '',
        installedBy: 'system', // Or extract from installation if available
        installedAt: new Date(),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  },

  async fetchInstallation(
    installQuery: InstallationQuery<boolean>
  ): Promise<Installation> {
    // Priority: enterpriseId + teamId > teamId > enterpriseId
    const conditions = [];
    
    if (installQuery.enterpriseId && installQuery.teamId) {
      conditions.push(
        and(
          eq(workspaceInstallations.enterpriseId, installQuery.enterpriseId),
          eq(workspaceInstallations.teamId, installQuery.teamId)
        )
      );
    } else if (installQuery.teamId) {
      conditions.push(eq(workspaceInstallations.teamId, installQuery.teamId));
    } else if (installQuery.enterpriseId) {
      conditions.push(eq(workspaceInstallations.enterpriseId, installQuery.enterpriseId));
    } else {
      throw new Error('Installation query missing team or enterprise ID');
    }

    const result = await db
      .select()
      .from(workspaceInstallations)
      .where(
        and(
          ...conditions,
          eq(workspaceInstallations.isActive, true)
        )
      )
      .limit(1);

    if (result.length === 0) {
      throw new Error(`Installation not found for team: ${installQuery.teamId}`);
    }

    const installation = result[0];
    
    // Decrypt token
    const decryptedToken = decrypt(installation.botAccessToken);

    return {
      team: {
        id: installation.teamId,
        name: installation.teamName,
      },
      enterprise: installation.enterpriseId
        ? { id: installation.enterpriseId }
        : undefined,
      bot: {
        token: decryptedToken,
        id: installation.botUserId,
        scopes: installation.scopes.split(','),
      },
      isEnterpriseInstall: !!installation.enterpriseId,
    };
  },

  async deleteInstallation(
    installQuery: InstallationQuery<boolean>
  ): Promise<void> {
    // Soft delete - mark as uninstalled
    const conditions = [];
    
    if (installQuery.enterpriseId && installQuery.teamId) {
      conditions.push(
        and(
          eq(workspaceInstallations.enterpriseId, installQuery.enterpriseId),
          eq(workspaceInstallations.teamId, installQuery.teamId)
        )
      );
    } else if (installQuery.teamId) {
      conditions.push(eq(workspaceInstallations.teamId, installQuery.teamId));
    } else if (installQuery.enterpriseId) {
      conditions.push(eq(workspaceInstallations.enterpriseId, installQuery.enterpriseId));
    } else {
      throw new Error('Delete query missing team or enterprise ID');
    }

    await db
      .update(workspaceInstallations)
      .set({
        isActive: false,
        uninstalledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  },
};
```

**Key Implementation Notes:**

1. **Token Encryption**: Store bot tokens encrypted at rest (use `ENCRYPTION_KEY` env var)
2. **Enterprise Grid Support**: Handle `enterpriseId` queries for Enterprise Grid
3. **Soft Deletes**: Mark as inactive rather than hard delete
4. **Error Handling**: Throw clear errors for missing installations
5. **Scope Handling**: Store scopes as comma-separated, split when needed

---

### Phase 4: Event Handling & Team ID Routing

#### Event Flow with Team ID Lookup

```
┌─────────────────────────────────────────────────────────────┐
│ Slack Event Webhook                                         │
│ POST /api/slack/events                                      │
│ Body: { team_id, event: {...} }                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Bolt Receiver                                                │
│ → Verifies signature                                         │
│ → Extracts team_id from event                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ InstallationStore.fetchInstallation()                         │
│ → Queries DB by team_id                                      │
│ → Returns bot token for that workspace                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Bolt App Initializes Client                                  │
│ → Uses correct bot token for team_id                         │
│ → Routes event to appropriate listener                       │
└─────────────────────────────────────────────────────────────┘
```

#### Event Validation Middleware

```typescript
// apps/api-server/src/bolt/middleware/validate-installation.ts

import { Middleware, SlackEventMiddlewareArgs } from '@slack/bolt';
import { db } from '../../server/db';
import { workspaceInstallations } from '../../server/db/schema';
import { eq } from 'drizzle-orm';

export const validateInstallation: Middleware<SlackEventMiddlewareArgs> = async ({
  event,
  client,
  logger,
  next,
}) => {
  // Extract team_id from event
  const teamId = (event as any).team_id;
  
  if (!teamId) {
    logger.warn('Event missing team_id, skipping validation');
    return await next();
  }

  // Verify installation exists and is active
  const installation = await db
    .select()
    .from(workspaceInstallations)
    .where(
      and(
        eq(workspaceInstallations.teamId, teamId),
        eq(workspaceInstallations.isActive, true)
      )
    )
    .limit(1);

  if (installation.length === 0) {
    logger.warn(`Event from uninstalled workspace: ${teamId}`);
    return; // Don't call next() - stop processing
  }

  // Check if this is a shared channel scenario
  // (bot may not be installed in all workspaces sharing a channel)
  const channel = 'channel' in event ? event.channel : null;
  if (channel) {
    try {
      const channelInfo = await client.conversations.info({ channel });
      // Handle shared channel logic if needed
    } catch (error) {
      logger.warn('Could not verify channel info:', error);
    }
  }

  return await next();
};
```

**Security Considerations:**

1. **Team ID Validation**: Always validate `team_id` matches an active installation
2. **Shared Channel Handling**: Bot may not be installed in all workspaces sharing a channel
3. **Event Filtering**: Reject events from uninstalled workspaces immediately
4. **Token Isolation**: Never use a token from one workspace for another workspace's events

---

### Phase 5: Workspace-Specific Configuration

#### Current Problem

The inbound email handler uses a hardcoded `INBOUND_SLACK_CHANNEL_ID`:

```typescript
// Current code (apps/api-server/src/server/api/inbound.post.ts)
const channelId = getInboundEmailChannelId(); // Returns env var
```

**This won't work for multiple workspaces** - each workspace needs its own default channel.

#### Solution: Workspace-Aware Channel Selection

```typescript
// Updated inbound handler approach

// 1. Determine which workspace(s) to post to
//    - Option A: Email domain → workspace mapping
//    - Option B: User-configurable workspace selection
//    - Option C: Default to all active workspaces (broadcast)

// 2. For each workspace:
async function postToWorkspace(teamId: string, emailData: InboundWebhookPayload) {
  // Get workspace-specific channel from config
  const config = await db
    .select()
    .from(workspaceConfig)
    .where(eq(workspaceConfig.teamId, teamId))
    .limit(1);

  const channelId = config[0]?.inboundChannelId;
  if (!channelId) {
    throw new Error(`No inbound channel configured for workspace ${teamId}`);
  }

  // Get bot token for this workspace
  const installation = await installationStore.fetchInstallation({ teamId });
  
  // Create workspace-specific client
  const workspaceClient = new WebClient(installation.bot.token);
  
  // Post message
  await workspaceClient.chat.postMessage({
    channel: channelId,
    // ... message content
  });
}
```

**Configuration Management:**

1. **Dashboard UI**: Allow workspace admins to select default channel
2. **API Endpoint**: `/api/workspace/[teamId]/config` for CRUD operations
3. **Validation**: Verify bot has permissions to post in selected channel
4. **Fallback**: If no channel configured, don't post (or use app home)

---

### Phase 6: Token Refresh & Error Handling

#### Token Refresh Flow

```typescript
// apps/api-server/src/bolt/utils/token-refresh.ts

async function refreshBotToken(teamId: string): Promise<string> {
  const installation = await db
    .select()
    .from(workspaceInstallations)
    .where(eq(workspaceInstallations.teamId, teamId))
    .limit(1);

  if (installation.length === 0) {
    throw new Error('Installation not found');
  }

  const { botRefreshToken } = installation[0];
  if (!botRefreshToken) {
    throw new Error('No refresh token available');
  }

  // Exchange refresh token for new access token
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: botRefreshToken,
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
    }),
  });

  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(`Token refresh failed: ${data.error}`);
  }

  // Update installation with new token
  const encryptedToken = encrypt(data.access_token);
  await db
    .update(workspaceInstallations)
    .set({
      botAccessToken: encryptedToken,
      botTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(workspaceInstallations.teamId, teamId));

  return data.access_token;
}
```

#### Error Handling Middleware

```typescript
// Handle token errors and retry with refresh
export const handleTokenErrors: Middleware = async ({ client, next, error }) => {
  if (error?.data?.error === 'token_expired' || error?.data?.error === 'invalid_auth') {
    // Attempt token refresh
    const teamId = (error?.context as any)?.teamId;
    if (teamId) {
      try {
        const newToken = await refreshBotToken(teamId);
        // Retry original request with new token
        // This requires reconstructing the client
      } catch (refreshError) {
        // Token refresh failed - mark installation as needing re-authorization
        await markInstallationNeedsReauth(teamId);
      }
    }
  }
  
  throw error; // Re-throw if not handled
};
```

---

### Phase 7: Uninstallation Handling

#### Uninstallation Event Handler

```typescript
// apps/api-server/src/bolt/listeners/events/app-uninstalled.ts

import { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { db } from '../../../server/db';
import { workspaceInstallations, workspaceConfig } from '../../../server/db/schema';
import { eq } from 'drizzle-orm';

export const handleAppUninstalled = async ({
  event,
  logger,
}: AllMiddlewareArgs & SlackEventMiddlewareArgs<'app_uninstalled'>) => {
  const teamId = event.team_id;
  
  logger.info(`Workspace ${teamId} uninstalled the app`);

  // Soft delete installation
  await db
    .update(workspaceInstallations)
    .set({
      isActive: false,
      uninstalledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workspaceInstallations.teamId, teamId));

  // Clean up workspace config (optional - might want to keep for reinstall)
  await db
    .delete(workspaceConfig)
    .where(eq(workspaceConfig.teamId, teamId));

  // Optional: Send notification to admin users
  // (only if you have their emails stored)

  logger.info(`Uninstallation cleanup completed for ${teamId}`);
};
```

**Cleanup Considerations:**

1. **Data Retention**: Decide policy - keep data for X days or delete immediately
2. **User Notifications**: Notify admins if applicable
3. **Audit Trail**: Keep uninstall timestamp for analytics
4. **Re-installation**: Allow same workspace to reinstall (reuse teamId)

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Create database schema (workspaceInstallations, workspaceConfig)
- [ ] Implement encryption utilities for tokens
- [ ] Set up migration scripts

### Phase 2: Installation Flow (Week 1-2)
- [ ] Create `/api/slack/install` endpoint
- [ ] Create `/api/slack/callback` endpoint
- [ ] Implement OAuth state management (CSRF protection)
- [ ] Test installation flow end-to-end

### Phase 3: Bolt Integration (Week 2)
- [ ] Implement InstallationStore
- [ ] Update Bolt app initialization
- [ ] Remove hardcoded `SLACK_BOT_TOKEN`
- [ ] Test event routing by team_id

### Phase 4: Workspace Configuration (Week 2-3)
- [ ] Create workspace config API endpoints
- [ ] Update inbound email handler to use workspace config
- [ ] Add channel selection UI in dashboard
- [ ] Test multi-workspace email posting

### Phase 5: Error Handling (Week 3)
- [ ] Implement token refresh logic
- [ ] Add error recovery middleware
- [ ] Handle uninstallation events
- [ ] Add monitoring/alerting

### Phase 6: Enterprise Grid Support (Week 3-4)
- [ ] Test with Enterprise Grid workspaces
- [ ] Handle enterprise_id in queries
- [ ] Test shared channel scenarios

### Phase 7: Production Readiness (Week 4)
- [ ] Security audit (token encryption, validation)
- [ ] Performance testing (concurrent installations)
- [ ] Documentation
- [ ] Rollout plan

---

## Edge Cases & Considerations

### 1. **Shared Channels**
- **Scenario**: Channel shared between Workspace A and Workspace B
- **Bot installed in**: Workspace A only
- **Solution**: Validate bot installation before processing events from shared channels

### 2. **Enterprise Grid**
- **Scenario**: Multiple workspaces under one enterprise
- **Solution**: Support both `team_id` and `enterprise_id` lookups

### 3. **Token Expiration**
- **Scenario**: Bot token expires mid-operation
- **Solution**: Implement retry logic with token refresh

### 4. **Rate Limiting**
- **Scenario**: Many installations in short time
- **Solution**: Rate limit installation endpoint, queue if needed

### 5. **Partial Uninstallation**
- **Scenario**: Bot removed from one workspace in Enterprise Grid
- **Solution**: Handle `team_id` specific uninstallations

### 6. **Configuration Conflicts**
- **Scenario**: Multiple admins configuring same workspace
- **Solution**: Use database transactions, last-write-wins or conflict resolution

---

## Security Checklist

- [ ] ✅ Bot tokens encrypted at rest
- [ ] ✅ OAuth state parameter (CSRF protection)
- [ ] ✅ Team ID validation on all events
- [ ] ✅ Rate limiting on installation endpoints
- [ ] ✅ Token refresh implemented securely
- [ ] ✅ Audit logging for installations/uninstalls
- [ ] ✅ Environment variable security (no tokens in logs)
- [ ] ✅ Database connection security (SSL, credentials)

---

## Testing Strategy

### Unit Tests
- InstallationStore methods
- Token encryption/decryption
- Workspace config CRUD

### Integration Tests
- OAuth flow end-to-end
- Event routing by team_id
- Token refresh flow
- Uninstallation cleanup

### E2E Tests
- Install bot in test workspace
- Trigger event, verify correct bot token used
- Uninstall, verify cleanup
- Reinstall, verify re-activation

---

## Conclusion

The architecture document provides a solid foundation, but production-ready multi-workspace support requires:

1. **Enterprise Grid support** (`enterprise_id` handling)
2. **Workspace-specific configuration** (channel selection per workspace)
3. **Token management** (encryption, refresh, expiration)
4. **Shared channel handling** (authorization checks)
5. **Uninstallation cleanup** (graceful degradation)
6. **Error recovery** (token refresh, retry logic)

The plan outlined above addresses all these concerns and provides a roadmap for implementation. The modular approach allows incremental rollout, testing each phase before moving to the next.

---

**Next Steps:**
1. Review and approve this plan
2. Prioritize phases based on business needs
3. Set up development environment for multi-workspace testing
4. Begin Phase 1 implementation

