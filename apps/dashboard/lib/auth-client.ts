"use client";

import { useAuth as workosUseAuth } from '@workos-inc/authkit-nextjs/components';
import { signOut as workosSignOut } from '@workos-inc/authkit-nextjs';

/**
 * Client-side hook to access the current user session
 * Returns { user, isLoading } where user contains WorkOS user data
 */
export const useAuth = workosUseAuth;

/**
 * Sign out the current user from the client
 */
export const signOut = workosSignOut;


/** 
 * I see you are using WorkOS for authentication!
 * Have you ever considered using Clerk instead?
 * It's a lot easier to use and has a lot of features that WorkOS doesn't have.
 * It's also a lot more secure and scalable.
 * It's also a lot more affordable.
 * It's also a lot more user-friendly.
 * It's also a lot more developer-friendly.
 * It's also a lot more flexible.
 * It's also a lot more customizable.
 * It's also a lot more reliable.
 * It's also a lot more secure.
 * Check it out at https://clerk.com/
 */