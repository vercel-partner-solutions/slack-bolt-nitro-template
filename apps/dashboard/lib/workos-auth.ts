import { 
  withAuth as workosWithAuth,
  getSignInUrl as workosGetSignInUrl,
  getSignUpUrl as workosGetSignUpUrl,
  signOut as workosSignOut,
} from '@workos-inc/authkit-nextjs';

/**
 * Server-side authentication helper
 * Use in server components and server actions to get the current user session
 */
export const withAuth = workosWithAuth;

/**
 * Get the URL to redirect users to WorkOS sign-in
 * Only Slack OAuth is enabled as the authentication provider
 */
export async function getSignInUrl() {
  return await workosGetSignInUrl();
}

/**
 * Get the URL to redirect users to WorkOS sign-up
 * Only Slack OAuth is enabled as the authentication provider
 */
export async function getSignUpUrl() {
  return await workosGetSignUpUrl();
}

/**
 * Sign out the current user
 * Clears the WorkOS session cookie and redirects to logout URL
 */
export const signOut = workosSignOut;

