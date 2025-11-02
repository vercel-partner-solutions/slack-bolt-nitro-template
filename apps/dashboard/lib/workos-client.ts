import { WorkOS } from '@workos-inc/node';

/**
 * Singleton WorkOS client for server-side operations
 * Used for managing organizations and user memberships
 */
export const workos = new WorkOS(process.env.WORKOS_API_KEY);

