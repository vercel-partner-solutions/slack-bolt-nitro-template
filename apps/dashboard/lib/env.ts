// Load environment variables from monorepo root
// This ensures env vars are available at runtime in server components and API routes
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root
config({ path: resolve(process.cwd(), "../../.env") });

