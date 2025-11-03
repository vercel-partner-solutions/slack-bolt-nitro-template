import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const workspaceInstallations = pgTable("workspace_installations", {
  // Primary identifier - Slack workspace ID
  teamId: text("team_id").primaryKey(),
  
  // Enterprise Grid support
  enterpriseId: text("enterprise_id"),
  
  // Workspace identification
  teamName: text("team_name").notNull(),
  teamUrl: text("team_url"),
  
  // WorkOS organization ID for this workspace
  workosOrganizationId: text("workos_organization_id"),
  
  // Bot credentials (botAccessToken will be encrypted)
  botUserId: text("bot_user_id").notNull(),
  botAccessToken: text("bot_access_token").notNull(), // Encrypted xoxb- token
  botRefreshToken: text("bot_refresh_token"),
  
  // Installation metadata
  scopes: text("scopes").notNull(), // Comma-separated bot scopes
  installedBy: text("installed_by").notNull(), // WorkOS user ID (no FK constraint)
  installedAt: timestamp("installed_at").notNull(),
  uninstalledAt: timestamp("uninstalled_at"), // Soft delete timestamp
  
  // Workspace state
  isActive: boolean("is_active").notNull().default(true),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

