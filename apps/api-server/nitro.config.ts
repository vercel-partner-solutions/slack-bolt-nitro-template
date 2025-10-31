import { defineNitroConfig } from 'nitropack/config';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env from monorepo root
config({ path: resolve(__dirname, '../../.env') });

// https://nitro.build/config
export default defineNitroConfig({
  compatibilityDate: 'latest',
  srcDir: 'src/server',
  imports: false,
});
