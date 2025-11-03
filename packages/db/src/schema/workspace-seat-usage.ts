import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tracks which users occupy seats in each workspace for billing purposes
 * Each unique user who replies to an email thread counts as one seat
 */
export const workspaceSeatUsage = pgTable("workspace_seat_usage", {
	// UUID primary key
	id: uuid("id").primaryKey().defaultRandom(),
	
	// WorkOS organization ID (links to workspace via workspace_installations.workosOrganizationId)
	workosOrganizationId: text("workos_organization_id").notNull(),
	
	// WorkOS user ID (authenticated user in the dashboard)
	workosUserId: text("workos_user_id").notNull(),
	
	// Slack user ID (the user who replied in Slack)
	slackUserId: text("slack_user_id").notNull(),
	
	// User information for display
	slackUserName: text("slack_user_name"),
	slackUserEmail: text("slack_user_email"),
	
	// When this user first replied (claimed the seat)
	firstReplyAt: timestamp("first_reply_at").notNull(),
	
	// Timestamps
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

