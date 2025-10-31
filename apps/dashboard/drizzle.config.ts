import { defineConfig } from "drizzle-kit";
import { load } from "dotenv-mono";
import { resolve } from "node:path";

// Load .env from monorepo root automatically
load();

export default defineConfig({
  schema: resolve(__dirname, "../../packages/db/src/schema/index.ts"),
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});