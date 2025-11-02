import { handleAuth } from '@workos-inc/authkit-nextjs';

// Handle OAuth callback from WorkOS and redirect to dashboard after successful auth
export const GET = handleAuth({
  returnPathname: '/dashboard',
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'https://dev.slackbound.com',
});

