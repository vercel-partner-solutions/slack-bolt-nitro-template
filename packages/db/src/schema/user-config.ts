import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// User configuration table
export const userConfig = pgTable("user_config", {
	userId: text("user_id").primaryKey(),
	sendingDomain: text("sending_domain"),
	shouldShowFullEmail: boolean("should_show_full_email").notNull().default(false),
	inboundApiKey: text("inbound_api_key"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

