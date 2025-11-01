import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { workspaceInstallations } from "./workspace-installations";

export const workspaceConfig = pgTable("workspace_config", {
  // Primary key references workspace installation
  teamId: text("team_id")
    .primaryKey()
    .references(() => workspaceInstallations.teamId),
  
  // Default channel for inbound emails
  defaultChannelId: text("default_channel_id"),
  defaultChannelName: text("default_channel_name"),
  
  // Inbound.new endpoint ID for this workspace
  inboundEndpointId: text("inbound_endpoint_id"),
  
  // Feature flags
  emailIntegrationEnabled: boolean("email_integration_enabled").notNull().default(true),
  
  // Message identity setting
  shouldShowFullEmail: boolean("should_show_full_email").notNull().default(false),
  
  // Email sending domain for replies
  sendingDomain: text("sending_domain"),
  
  // Channel name prefix for new channels (default: "ext-inbd-*")
  channelNamePrefix: text("channel_name_prefix"),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

