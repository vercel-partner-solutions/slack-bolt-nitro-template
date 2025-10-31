import { pgTable, text, timestamp, serial } from "drizzle-orm/pg-core";

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

