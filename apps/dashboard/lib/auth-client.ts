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
