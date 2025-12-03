import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const slackInstallations = pgTable(
  "slack_installations",
  {
    id: serial("id").primaryKey(),
    teamId: varchar("team_id", { length: 255 }),
    enterpriseId: varchar("enterprise_id", { length: 255 }),
    userId: varchar("user_id", { length: 255 }),
    isEnterpriseInstall: boolean("is_enterprise_install")
      .default(false)
      .notNull(),

    // App info
    appId: varchar("app_id", { length: 255 }),
    tokenType: varchar("token_type", { length: 50 }),

    // Bot credentials
    botToken: text("bot_token"),
    botId: varchar("bot_id", { length: 255 }),
    botUserId: varchar("bot_user_id", { length: 255 }),
    botScopes: jsonb("bot_scopes").$type<string[]>(),
    botRefreshToken: text("bot_refresh_token"),
    botTokenExpiresAt: timestamp("bot_token_expires_at"),

    // User credentials (for user token installations)
    userToken: text("user_token"),
    userScopes: jsonb("user_scopes").$type<string[]>(),
    userRefreshToken: text("user_refresh_token"),
    userTokenExpiresAt: timestamp("user_token_expires_at"),

    // Team/Enterprise metadata
    teamName: varchar("team_name", { length: 255 }),
    enterpriseName: varchar("enterprise_name", { length: 255 }),
    enterpriseUrl: text("enterprise_url"),

    // Incoming webhook (if configured)
    incomingWebhookUrl: text("incoming_webhook_url"),
    incomingWebhookChannel: varchar("incoming_webhook_channel", {
      length: 255,
    }),
    incomingWebhookChannelId: varchar("incoming_webhook_channel_id", {
      length: 255,
    }),
    incomingWebhookConfigurationUrl: text("incoming_webhook_configuration_url"),

    // Timestamps
    installedAt: timestamp("installed_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint: one install per workspace (team_id is globally unique)
    uniqueTeamInstall: uniqueIndex("unique_team_install").on(table.teamId),

    // Unique constraint: one install per enterprise (enterprise_id is globally unique)
    uniqueEnterpriseInstall: uniqueIndex("unique_enterprise_install")
      .on(table.enterpriseId)
      .where(sql`is_enterprise_install = true`),
  })
);

export type SlackInstallation = typeof slackInstallations.$inferSelect;
export type NewSlackInstallation = typeof slackInstallations.$inferInsert;
