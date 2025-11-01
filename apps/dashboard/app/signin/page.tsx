"use client";

import { useEffect, useState } from "react";
import { authClient, useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { SlackIcon } from "@/components/slack-icon";

export default function SignInPage() {
  const { data: session, isPending: isSessionPending } = useSession();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Don't trigger login if already authenticated or session is still loading
    if (isSessionPending || session) {
      return;
    }

    // Auto-trigger Slack login on page load
    const handleSlackLogin = async () => {
      try {
        setIsLoading(true);
        await authClient.signIn.social({
          provider: "slack",
          callbackURL: "/dashboard",
        });
      } catch (error) {
        console.error("Login failed:", error);
        toast.error("Login failed", {
          description: "Unable to sign in with Slack. Please try again.",
        });
        setIsLoading(false);
      }
    };

    handleSlackLogin();
  }, [session, isSessionPending]);

  // Show loading state while checking session or during login
  if (isSessionPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-transparent" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SlackIcon className="h-4 w-4" />
            <span>Signing in with Slack...</span>
          </div>
        </div>
      </div>
    );
  }

  // If already authenticated, redirect will happen via middleware or redirect
  // This should not normally be seen, but provides a fallback
  if (session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm text-muted-foreground">
            You're already signed in. Redirecting...
          </div>
        </div>
      </div>
    );
  }

  // Fallback if login didn't trigger (shouldn't normally happen)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="text-sm text-muted-foreground">
          Please wait while we redirect you to sign in...
        </div>
      </div>
    </div>
  );
}

