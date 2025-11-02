import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

// WorkOS AuthKit proxy for handling authentication sessions
// This runs on all routes to manage user authentication state
// Pages can require authentication using withAuth({ ensureSignedIn: true })
export default authkitMiddleware();

// Match against all routes except static files
// The proxy handles session management for all routes where withAuth is called
export const config = { 
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ] 
};

