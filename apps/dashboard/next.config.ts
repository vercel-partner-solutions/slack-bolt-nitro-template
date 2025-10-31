import type { NextConfig } from "next";
import { resolve } from "path";
import { config } from "dotenv";

// Load .env from monorepo root
config({ path: resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.BACKEND_API_URL || "http://localhost:3668";
    
    return [
      {
        source: "/api/:path((?!auth).*)*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
