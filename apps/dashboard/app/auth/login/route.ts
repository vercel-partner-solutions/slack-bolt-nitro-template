import { getSignInUrl } from '@/lib/workos-auth';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Login endpoint - redirects users to WorkOS sign-in with Slack provider
 * Used when WorkOS detects login didn't originate from the app
 */
export const GET = async (request: NextRequest) => {
  // Get the return path from query params, default to /dashboard
  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get('returnTo') || '/dashboard';
  
  const signInUrl = await getSignInUrl();
  
  // Add the return path to the sign-in URL
  const urlWithReturn = new URL(signInUrl);
  urlWithReturn.searchParams.set('returnPathname', returnTo);
  
  return NextResponse.redirect(urlWithReturn.toString());
};

