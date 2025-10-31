import { defineConfig } from "drizzle-kit";
import { load } from "dotenv-mono";
import { resolve } from "node:path";

// Load .env from monorepo root automatically
load();

export default defineConfig({
	out: "./drizzle",
	schema: resolve(__dirname, "./src/schema/index.ts"),
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
});

