"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-client";
import { SlackIcon } from "@/components/slack-icon";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const { user, loading: isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If already authenticated, redirect to dashboard
    if (user) {
      router.push("/dashboard");
      return;
    }

    // If not loading and no user, redirect to WorkOS sign-in
    if (!isLoading && !user) {
      window.location.href = "/auth/login";
    }
  }, [user, isLoading, router]);

  // Show loading state
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-transparent" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SlackIcon className="h-4 w-4" />
          <span>{user ? "Redirecting to dashboard..." : "Signing in with Slack..."}</span>
        </div>
      </div>
    </div>
  );
}

