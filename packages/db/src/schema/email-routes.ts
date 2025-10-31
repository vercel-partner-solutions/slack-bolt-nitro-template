import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { workspaceInstallations } from "./workspace-installations";

export const emailRoutes = pgTable("email_routes", {
  // UUID primary key
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Email address to route (e.g., support@domain.com)
  emailAddress: text("email_address").notNull().unique(),
  
  // Target workspace
  teamId: text("team_id")
    .notNull()
    .references(() => workspaceInstallations.teamId),
  
  // Target channel (for channel routing)
  channelId: text("channel_id"),
  channelName: text("channel_name"),
  
  // Target user (for DM routing - alternative to channel)
  userId: text("user_id"),
  
  // Route state
  isActive: boolean("is_active").notNull().default(true),
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

