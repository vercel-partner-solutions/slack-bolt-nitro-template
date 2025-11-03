import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * User configuration table
 * Stores both user settings and Slack identity mapping (WorkOS user ID → Slack user ID)
 * Auth is handled by WorkOS - this table stores user preferences and Slack mapping
 */
export const userConfig = pgTable("user_config", {
	// WorkOS user ID (primary key)
	userId: text("user_id").primaryKey(),
	
	// Slack identity mapping (for linking WorkOS users to Slack users)
	slackUserId: text("slack_user_id"),
	slackTeamId: text("slack_team_id"),
	
	// User configuration settings
	sendingDomain: text("sending_domain"),
	shouldShowFullEmail: boolean("should_show_full_email").notNull().default(false),
	inboundApiKey: text("inbound_api_key"),
	
	// Timestamps
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

