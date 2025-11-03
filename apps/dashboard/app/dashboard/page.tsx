"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signOut, useAuth } from "@/lib/auth-client";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lato } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import {
  getWorkspaceConfig,
  updateWorkspaceConfig,
  fetchInboundDomains,
  fetchSlackChannels,
  getSlackWorkspaceInfo,
  checkBotInstallation,
  createSlackChannel,
  fetchEmailRoutes,
  deleteEmailRoute,
  getLocalUserConfig,
  ensureUserInOrganization,
  getCurrentUserRole,
} from "@/app/actions/user-config";
import { Input } from "@/components/ui/input";
import { LottieIcon } from "@/components/lotties/lottie-icon";
import slackLogoAnimation from "@/components/lotties/slack-logo.json";
import configIconAnimation from "@/components/lotties/config-icon.json";
import developerIconAnimation from "@/components/lotties/developer-icon.json";
import { CommandPalette } from "@/components/command-palette";
import { MemberManagementCard } from "@/components/member-management-card";
import ArrowTriangleLineRight from "@/components/icons/arrow-triangle-line-right";
import { redirect } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700"] });

export default function DashboardPage() {
  const { user, loading: isPending } = useAuth();
  const queryClient = useQueryClient();

  const userName = user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.firstName || "";
  const userEmail = user?.email ?? "";
  const userImage = user?.profilePictureUrl ?? "";

  // Get current user's role to check if they're admin
  const { data: roleData } = useQuery({
    queryKey: ["currentUserRole"],
    queryFn: getCurrentUserRole,
    enabled: !!user,
  });

  const currentUserRole = roleData?.success ? roleData.data?.role : null;
  const isAdmin = currentUserRole === "admin";

  // Fetch workspace config - only for admins
  const {
    data: workspaceConfigResult,
    isLoading: isInitialLoading,
    error: configError,
  } = useQuery({
    queryKey: ["workspaceConfig"],
    queryFn: getWorkspaceConfig,
    enabled: !!user && isAdmin,
    select: (result) => result.success ? result.data : null,
  });

  // Sync identity mode from server
  useEffect(() => {
    if (workspaceConfigResult?.shouldShowFullEmail !== undefined) {
      setIdentityModeLocal(workspaceConfigResult.shouldShowFullEmail ? "name-email" : "name-only");
    }
  }, [workspaceConfigResult?.shouldShowFullEmail]);

  // Ensure user is added to their workspace's WorkOS organization
  // This handles users who sign in after the bot is installed
  const { data: orgCheck } = useQuery({
    queryKey: ["organizationCheck"],
    queryFn: ensureUserInOrganization,
    enabled: !!user,
    retry: false,
  });

  // Sync sendingDomain state with query data
  useEffect(() => {
    if (workspaceConfigResult?.sendingDomain !== undefined) {
      setSendingDomain(workspaceConfigResult.sendingDomain || "");
    }
  }, [workspaceConfigResult?.sendingDomain]);

  // Track if channelNamePrefix has been initialized to avoid debounce on initial load
  const channelNamePrefixInitializedRef = useRef(false);

  // Sync channelNamePrefix state with query data
  useEffect(() => {
    if (workspaceConfigResult?.channelNamePrefix !== undefined) {
      setChannelNamePrefix(workspaceConfigResult.channelNamePrefix || "ext-inbd-*");
      channelNamePrefixInitializedRef.current = true;
    }
  }, [workspaceConfigResult?.channelNamePrefix]);

  // Sync inboundApiKey state with query data
  useEffect(() => {
    if (workspaceConfigResult?.inboundApiKey !== undefined) {
      setInboundApiKeyInput(workspaceConfigResult.inboundApiKey || "");
    }
  }, [workspaceConfigResult?.inboundApiKey]);

  // Get inbound API key from workspace config
  const inboundApiKey = workspaceConfigResult?.inboundApiKey ?? "";

  // Fetch domains for CommandPalette and sending domain dropdown
  const {
    data: domainsData,
    isLoading: isLoadingDomains,
  } = useQuery({
    queryKey: ["domains", inboundApiKey],
    queryFn: () => fetchInboundDomains(inboundApiKey),
    enabled: !!user && !!inboundApiKey,
    select: (result) => (result.success ? result.data : []),
  });
  const domains = domainsData ?? [];

  // Fetch Slack channels
  const {
    data: channelsResult,
    isLoading: isLoadingChannels,
  } = useQuery({
    queryKey: ["slackChannels"],
    queryFn: fetchSlackChannels,
    enabled: !!user,
  });
  const slackChannels = channelsResult?.success ? (channelsResult.data ?? []) : [];
  const channelsError = channelsResult?.success === false ? channelsResult : null;

  // Fetch workspace info
  const {
    data: workspaceResult,
    isLoading: isLoadingWorkspace,
  } = useQuery({
    queryKey: ["workspaceInfo"],
    queryFn: getSlackWorkspaceInfo,
    enabled: !!user,
  });
  const workspaceInfo = workspaceResult?.success ? workspaceResult.data : null;

  // Check bot installation
  const {
    data: botInstallationData,
    isLoading: isCheckingBot,
  } = useQuery({
    queryKey: ["botInstallation"],
    queryFn: checkBotInstallation,
    enabled: !!user,
  });
  const botInstalled =
    botInstallationData?.success && "installed" in botInstallationData
      ? botInstallationData.installed
      : null;

  // Mutations
  const updateWorkspaceConfigMutation = useMutation({
    mutationFn: updateWorkspaceConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceConfig"] });
    },
  });

  const createChannelMutation = useMutation({
    mutationFn: ({ name, isPrivate }: { name: string; isPrivate: boolean }) =>
      createSlackChannel(name, isPrivate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slackChannels"] });
      setTestChannelName("");
      setTestChannelIsPrivate(false);
    },
  });

  // Fetch email routes
  const {
    data: emailRoutesResult,
    isLoading: isLoadingRoutes,
  } = useQuery({
    queryKey: ["emailRoutes"],
    queryFn: fetchEmailRoutes,
    enabled: !!user,
    select: (result: Awaited<ReturnType<typeof fetchEmailRoutes>>) =>
      result.success ? (result.data ?? []) : [],
  });
  const emailRoutes = emailRoutesResult ?? [];

  // Delete email route mutation with optimistic updates
  const deleteRouteMutation = useMutation({
    mutationFn: deleteEmailRoute,
    // Optimistically update the cache before the mutation completes
    onMutate: async (emailAddress: string) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ["emailRoutes"] });

      // Snapshot the previous value for rollback
      const previousRoutes = queryClient.getQueryData<Awaited<ReturnType<typeof fetchEmailRoutes>>>(
        ["emailRoutes"]
      );

      // Optimistically update the cache by removing the route
      queryClient.setQueryData<Awaited<ReturnType<typeof fetchEmailRoutes>>>(
        ["emailRoutes"],
        (old) => {
          if (!old || !old.success || !old.data) return old;
          
          return {
            success: true,
            data: old.data.filter(
              (route) => route.emailAddress.toLowerCase() !== emailAddress.toLowerCase()
            ),
          };
        }
      );

      // Close the dialog immediately
      setEmailToDelete(null);

      // Return context with the previous value for rollback
      return { previousRoutes };
    },
    // If the mutation fails, roll back to the previous value
    onError: (err, emailAddress, context) => {
      if (context?.previousRoutes) {
        queryClient.setQueryData(["emailRoutes"], context.previousRoutes);
      }
    },
    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["emailRoutes"] });
    },
  });

  // Local state for UI
  const [error, setError] = useState<string | null>(null);
  const [sendingDomain, setSendingDomain] = useState<string>("");
  const [channelNamePrefix, setChannelNamePrefix] = useState<string>("");
  const [inboundApiKeyInput, setInboundApiKeyInput] = useState<string>("");
  const [identityModeLocal, setIdentityModeLocal] = useState<"name-email" | "name-only">("name-only");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [createRouteInitialStep, setCreateRouteInitialStep] = useState<"root" | "email-address" | "channel-name" | "channel-exists" | "creating" | undefined>(undefined);
  const [channelSearchQuery, setChannelSearchQuery] = useState<string>("");
  const [hasScrollableChannels, setHasScrollableChannels] = useState(false);
  const channelsListRef = useRef<HTMLDivElement>(null);
  const [emailToDelete, setEmailToDelete] = useState<string | null>(null);

  // Track which email is currently being deleted
  const deletingEmail = deleteRouteMutation.isPending ? emailToDelete : null;
  
  // Channel creation test state
  const [testChannelName, setTestChannelName] = useState("");
  const [testChannelIsPrivate, setTestChannelIsPrivate] = useState(false);

  // Filter channels based on search
  const filteredChannels = slackChannels.filter((channel) =>
    channel.name.toLowerCase().includes(channelSearchQuery.toLowerCase())
  );

  // Check if there's scrollable content
  useEffect(() => {
    if (channelsListRef.current) {
      const hasOverflow = channelsListRef.current.scrollHeight > channelsListRef.current.clientHeight;
      const isAtBottom = channelsListRef.current.scrollHeight - channelsListRef.current.scrollTop <= channelsListRef.current.clientHeight + 1;
      setHasScrollableChannels(hasOverflow && !isAtBottom);
    }
  }, [filteredChannels.length, channelSearchQuery]);

  // Handle channel creation - invalidate routes query to refresh list
  const handleChannelCreate = (channelName: string, emailAddress: string) => {
    queryClient.invalidateQueries({ queryKey: ["emailRoutes"] });
  };

  // Handle route deletion
  const handleDeleteRoute = (emailAddress: string) => {
    setEmailToDelete(emailAddress);
  };

  const handleConfirmDelete = async () => {
    if (emailToDelete) {
      await deleteRouteMutation.mutateAsync(emailToDelete);
    }
  };

  const fallbackInitials = (userName || userEmail || "U")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Handle radio button change - just update local state
  const handleIdentityModeChange = (value: string) => {
    const newMode = value as "name-email" | "name-only";
    setIdentityModeLocal(newMode);
    setHasUnsavedChanges(true);
    setError(null);
  };

  // Handle sending domain change - just update local state
  const handleSendingDomainChange = (value: string) => {
    setSendingDomain(value);
    setHasUnsavedChanges(true);
    setError(null);
  };

  // Handle channel name prefix change - just update local state
  const handleChannelNamePrefixChange = (value: string) => {
    setChannelNamePrefix(value);
    setHasUnsavedChanges(true);
    setError(null);
  };

  // Handle inbound API key change - just update local state
  const handleInboundApiKeyChange = (value: string) => {
    setInboundApiKeyInput(value);
    setHasUnsavedChanges(true);
    setError(null);
  };

  // Save all configuration changes
  const handleSaveConfiguration = async () => {
    setError(null);

    const result = await updateWorkspaceConfigMutation.mutateAsync({
      shouldShowFullEmail: identityModeLocal === "name-email",
      sendingDomain: sendingDomain.trim() || null,
      channelNamePrefix: channelNamePrefix.trim() || null,
      inboundApiKey: inboundApiKeyInput.trim() || null,
    });

    if (result.success) {
      setHasUnsavedChanges(false);
    } else {
      setError(result.error || "Failed to save configuration");
    }
  };

  // Extract error message from channels query
  const channelsErrorMessage = channelsError?.error === "bot_not_installed"
    ? "bot_not_installed"
    : channelsError?.error || channelsError?.message || null;

  if (!user && !isPending) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/">
            <h1 className="font-outfit text-2xl font-semibold text-foreground flex items-center gap-2">
              <Image
                src="/images/slackbound-icon.png"
                alt="Logo"
                width={25}
                height={25}
              />
              Dashboard
            </h1>
          </Link>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden min-w-0 sm:block text-right">
                  <p className="truncate text-sm font-medium text-foreground">
                    {userName || "—"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {userEmail || "—"}
                  </p>
                </div>
                {userImage ? (
                  <img
                    src={userImage}
                    alt={userName ? `${userName}'s avatar` : "User avatar"}
                    className="h-8 w-8 rounded-full ring-1 ring-border object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-1 ring-border">
                    {fallbackInitials}
                  </div>
                )}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/40"
            >
              Sign out
            </button>
          </div>
        </div>

        {isPending && user ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span className="text-sm text-muted-foreground">
              Loading session…
            </span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Slack Channels Card */}
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="h-[1.25em] w-[1.25em]">
                  <LottieIcon animationData={slackLogoAnimation} />
                </span>
                Available Slack Channels
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                All available channels in your Slack workspace.
              </p>
              <hr className="my-6 border-border" />
              {isLoadingChannels ? (
                <div className="flex items-center gap-3 py-4">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span className="text-sm text-muted-foreground">
                    Loading channels...
                  </span>
                </div>
              ) : channelsErrorMessage ? (
                channelsErrorMessage === "bot_not_installed" ? (
                  <div className="rounded-md border border-orange-500/50 bg-orange-500/10 p-4">
                    <p className="text-sm font-medium text-orange-700 mb-3">
                      Bot Not Installed
                    </p>
                    <p className="text-sm text-orange-600 mb-4">
                      The SlackBound bot needs to be installed in your workspace to manage channels. 
                      Please install it using the button in the Developer section above.
                    </p>
                    <Link
                      href="/nextjs/api/slack/install"
                      className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 transition-colors"
                    >
                      Install Bot Now
                    </Link>
                  </div>
                ) : (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
                    <p className="text-sm text-destructive">
                      {typeof channelsErrorMessage === "string"
                        ? channelsErrorMessage
                        : "Failed to load channels"}
                    </p>
                  </div>
                )
              ) : slackChannels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No channels found.
                </p>
              ) : (
                <div className="space-y-3">
                  {/* Search Input */}
                  <Input
                    type="text"
                    placeholder="Search channels..."
                    value={channelSearchQuery}
                    onChange={(e) => setChannelSearchQuery(e.target.value)}
                    className="h-9 text-xs"
                  />
                  
                  {/* Scrollable Channel List with fade */}
                  <div className="relative">
                    <div 
                      ref={channelsListRef}
                      className="-mx-2 divide-y divide-border max-h-[180px] overflow-y-auto"
                      onScroll={() => {
                        if (channelsListRef.current) {
                          const hasOverflow = channelsListRef.current.scrollHeight > channelsListRef.current.clientHeight;
                          const isAtBottom = channelsListRef.current.scrollHeight - channelsListRef.current.scrollTop <= channelsListRef.current.clientHeight + 1;
                          setHasScrollableChannels(hasOverflow && !isAtBottom);
                        }
                      }}
                    >
                      {filteredChannels.length === 0 ? (
                        <div className="px-2 py-4 text-center">
                          <p className="text-sm text-muted-foreground">
                            No channels match "{channelSearchQuery}"
                          </p>
                        </div>
                      ) : (
                        filteredChannels.map((channel) => (
                    <div
                      key={channel.id}
                      className="flex items-center justify-between px-2 py-3"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          #{channel.name}
                        </span>
                        {channel.isPrivate && (
                          <span className="text-xs text-muted-foreground">
                            (Private)
                          </span>
                        )}
                        {channel.isMember && (
                          <span className="text-xs text-muted-foreground">
                            (Member)
                          </span>
                        )}
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span>{channel.numMembers} members</span>
                      </div>
                    </div>
                        ))
                      )}
                    </div>
                    {/* Fade effect at bottom when there's more content to scroll */}
                    {hasScrollableChannels && (
                      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />
                    )}
                  </div>
                  {channelSearchQuery && filteredChannels.length > 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                      {filteredChannels.length} channel{filteredChannels.length !== 1 ? "s" : ""} found
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Email Routes Card */}
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="h-[1.25em] w-[1.25em]">
                  <LottieIcon animationData={slackLogoAnimation} />
                </span>
                Email Routes
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Slack channels linked to email addresses. Emails sent to these addresses will be posted in the corresponding channels.
              </p>
              <hr className="my-6 border-border" />
              {isLoadingRoutes ? (
                <div className="flex items-center gap-3 py-4">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span className="text-sm text-muted-foreground">
                    Loading routes...
                  </span>
                </div>
              ) : emailRoutes.length === 0 ? (
                <div className="py-8 text-center space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">
                      No email routes configured yet.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Use the command palette (⌘K) to create a channel and email route.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateRouteInitialStep("email-address");
                      setIsCommandPaletteOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/40"
                  >
                    <span>+</span>
                    Create Route
                  </button>
                </div>
              ) : (
              <div className="-mx-2 divide-y divide-border">
                  {emailRoutes.map((route) => (
                    <div key={route.id} className="flex items-center justify-between px-2 py-3">
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        {/* Email Address - Click to Copy */}
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(route.emailAddress);
                            toast.success("Email address copied to clipboard", {
                              description: "You can now paste it into your email client.",
                              icon: <CheckCircle className="h-4 w-4" />,
                            });
                          }}
                          className="flex items-center gap-1.5 min-w-0 group hover:underline"
                          title="Click to copy email address"
                        >
                          <span className="text-xs text-muted-foreground">📧</span>
                          <span className="text-sm font-medium text-foreground truncate group-hover:text-primary">
                            {route.emailAddress}
                          </span>
                        </button>
                        
                        {/* Arrow indicator */}
                        <ArrowTriangleLineRight className="text-muted-foreground flex-shrink-0" />
                        
                        {/* Channel - Slack Deeplink */}
                        {route.channelId ? (
                          <a
                            href={`https://slack.com/app_redirect?channel=${route.channelId}${workspaceInfo?.teamId ? `&team=${workspaceInfo.teamId}` : ''}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 min-w-0 group hover:underline"
                            title="Open channel in Slack"
                          >
                            <span className="text-xs text-muted-foreground">#</span>
                            <span className="text-sm font-medium text-foreground truncate group-hover:text-primary">
                              {route.channelName || route.channelId}
                            </span>
                          </a>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-muted-foreground">#</span>
                            <span className="text-sm font-medium text-foreground truncate">
                              {route.channelName || "Unknown"}
                            </span>
                          </div>
                        )}
                        
                        {/* Status indicator */}
                        {route.isActive ? (
                          <span className="flex-shrink-0 h-2 w-2 rounded-full bg-green-500" title="Active" />
                        ) : (
                          <span className="flex-shrink-0 h-2 w-2 rounded-full bg-gray-400" title="Inactive" />
                        )}
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                          onClick={() => handleDeleteRoute(route.emailAddress)}
                          disabled={deleteRouteMutation.isPending && deletingEmail === route.emailAddress}
                          className="text-xs underline text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          {deletingEmail === route.emailAddress ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>

            {/* Member Management Card */}
            <MemberManagementCard />

            {/* Developer Card - Only visible in development */}
            {process.env.NODE_ENV === 'development' && (
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="h-[1.25em] w-[1.25em]">
                  <LottieIcon animationData={developerIconAnimation} />
                </span>
                Developer
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Workspace information and development tools.
              </p>
              <hr className="my-6 border-border" />
              {isLoadingWorkspace ? (
                <div className="flex items-center gap-3 py-4">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span className="text-sm text-muted-foreground">
                    Loading workspace info...
                  </span>
                </div>
              ) : workspaceInfo ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Workspace</p>
                      <p className="text-sm font-medium text-foreground">
                        {workspaceInfo.teamName}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Workspace ID</p>
                      <p className="text-sm font-mono text-foreground">
                        {workspaceInfo.teamId}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">User</p>
                      <p className="text-sm font-medium text-foreground">
                        {workspaceInfo.userName}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">User ID</p>
                      <p className="text-sm font-mono text-foreground">
                        {workspaceInfo.userId}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Workspace URL</p>
                    <a
                      href={workspaceInfo.teamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline break-all"
                    >
                      {workspaceInfo.teamUrl}
                    </a>
                  </div>
                  <hr className="my-6 border-border" />
                  <div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Bot Installation Status
                    </p>
                    {isCheckingBot ? (
                      <div className="flex items-center gap-2 py-2">
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span className="text-xs text-muted-foreground">
                          Checking installation...
                        </span>
                      </div>
                    ) : botInstalled === true ? (
                      <div>
                        <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <p className="text-sm font-medium text-green-700">
                            Bot Installed
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-green-600">
                          The bot is active in your workspace
                        </p>
                        </div>
                        <Link
                          href="/nextjs/api/slack/install"
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 54 54"
                            className="h-5 w-5"
                            fill="currentColor"
                          >
                            <path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386" />
                            <path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387" />
                            <path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386" />
                            <path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336 0v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387" />
                          </svg>
                          Re-install Bot
                        </Link>
                      </div>
                    ) : botInstalled === false ? (
                      <div>
                        <div className="rounded-md border border-orange-500/50 bg-orange-500/10 p-3 mb-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-orange-500" />
                            <p className="text-sm font-medium text-orange-700">
                              Not Installed
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-orange-600">
                            Install the bot to enable full functionality
                          </p>
                        </div>
                        <Link
                          href="/nextjs/api/slack/install"
                          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 54 54"
                            className="h-5 w-5"
                            fill="currentColor"
                          >
                            <path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386" />
                            <path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387" />
                            <path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386" />
                            <path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336 0v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387" />
                          </svg>
                          Add Bot to Workspace
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  
                  {/* Channel Creation Test Section */}
                  <hr className="my-6 border-border" />
                  <div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Channel Creation Test
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Test channel creation using the bot token. Requires the bot to be installed.
                    </p>
                    {botInstalled !== true ? (
                      <div className="rounded-md border border-orange-500/50 bg-orange-500/10 p-3">
                        <p className="text-xs text-orange-700">
                          Install the bot first to test channel creation.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label
                            htmlFor="test-channel-name"
                            className="text-xs font-medium text-foreground block"
                          >
                            Channel Name
                          </label>
                          <Input
                            id="test-channel-name"
                            type="text"
                            placeholder="test-channel"
                            value={testChannelName}
                            onChange={(e) => setTestChannelName(e.target.value)}
                            disabled={createChannelMutation.isPending}
                            className="h-9 text-xs"
                          />
                          <p className="text-xs text-muted-foreground">
                            Channel names must be lowercase and 1-80 characters.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="test-channel-private"
                            checked={testChannelIsPrivate}
                            onChange={(e) => setTestChannelIsPrivate(e.target.checked)}
                            disabled={createChannelMutation.isPending}
                            className="h-4 w-4 rounded border-border"
                          />
                          <label
                            htmlFor="test-channel-private"
                            className="text-xs text-foreground cursor-pointer"
                          >
                            Private channel
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!testChannelName.trim()) {
                              return;
                            }
                            await createChannelMutation.mutateAsync({
                              name: testChannelName.trim(),
                              isPrivate: testChannelIsPrivate,
                            });
                          }}
                          disabled={
                            createChannelMutation.isPending ||
                            !testChannelName.trim()
                          }
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {createChannelMutation.isPending ? (
                            <>
                              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                              Creating...
                            </>
                          ) : (
                            "Create Channel"
                          )}
                        </button>
                        {createChannelMutation.isSuccess &&
                          createChannelMutation.data?.success &&
                          createChannelMutation.data.data && (
                            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3">
                              <p className="text-xs font-medium text-green-700 mb-1">
                                Channel Created Successfully
                              </p>
                              <p className="text-xs text-green-600">
                                Channel ID: {createChannelMutation.data.data.id}
                              </p>
                              <p className="text-xs text-green-600">
                                Channel Name: #{createChannelMutation.data.data.name}
                              </p>
                              {createChannelMutation.data.data.userAdded !== undefined && (
                                <p className="text-xs text-green-600 mt-1">
                                  {createChannelMutation.data.data.userAdded
                                    ? "✓ You have been added to the channel"
                                    : "⚠ Could not add you to the channel automatically"}
                                </p>
                              )}
                            </div>
                          )}
                        {createChannelMutation.isError ||
                        (createChannelMutation.data &&
                          !createChannelMutation.data.success) ? (
                          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                            <p className="text-xs text-destructive">
                              {createChannelMutation.data?.message ||
                                createChannelMutation.data?.error ||
                                "Failed to create channel"}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No workspace information available.
                </p>
              )}
            </div>
            )}

            {/* Workspace Configuration Card - Only visible to admins */}
            {isAdmin && (
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="h-[1.25em] w-[1.25em]">
                  <LottieIcon animationData={configIconAnimation} />
                </span>
                Workspace Configuration
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                These settings control how messages appear in Slack for all users in your workspace.
              </p>
              <hr className="my-6 border-border" />
              <div className="space-y-5 w-full">
                {/* Inbound API key configuration */}
                <div className="grid-cols-2 gap-2 grid items-start">
                  <div className="col-span-1">
                    <label
                      htmlFor="inbound-api-key"
                      className="text-sm font-medium text-foreground block mb-1"
                    >
                      Inbound.new API key
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Required for email integration. Get your API key from{" "}
                      <a
                        href="https://inbound.new/settings/api"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Inbound.new
                      </a>
                    </p>
                  </div>
                  <div className="col-span-1">
                    <Input
                      id="inbound-api-key"
                      type="password"
                      value={inboundApiKeyInput}
                      onChange={(e) => handleInboundApiKeyChange(e.target.value)}
                      disabled={updateWorkspaceConfigMutation.isPending || isInitialLoading}
                      placeholder="Enter your Inbound API key"
                      className="h-9 text-xs font-mono"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Required for email integration features
                    </p>
                  </div>
                </div>

                {/* Message identity selector */}
                <div className="grid-cols-2 gap-2 grid items-start">
                  <div className="col-span-1">
                    <label className="text-sm font-medium text-foreground block mb-1">
                      Message identity
                    </label>
                    <p className="text-xs text-muted-foreground">
                      How your name and email appear in Slack messages. See preview below.
                    </p>
                  </div>
                  <div className="col-span-1">
                    <RadioGroup
                      value={identityModeLocal}
                      onValueChange={handleIdentityModeChange}
                      disabled={updateWorkspaceConfigMutation.isPending || isInitialLoading}
                      className="gap-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label
                          htmlFor="identity-name-email"
                          className="text-sm text-foreground"
                        >
                          Show name and email
                        </label>
                        <RadioGroupItem
                          value="name-email"
                          id="identity-name-email"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <label
                          htmlFor="identity-name-only"
                          className="text-sm text-foreground"
                        >
                          Show name only
                        </label>
                        <RadioGroupItem
                          value="name-only"
                          id="identity-name-only"
                        />
                      </div>
                    </RadioGroup>
                  </div>
                </div>

                {/* Live Slack-style preview */}
                <div
                  className={`rounded-lg border border-zinc-200 bg-white p-4 ${lato.className}`}
                >
                  <div className="flex items-start gap-3">
                    {userImage ? (
                      <img
                        src={userImage}
                        alt={userName ? `${userName}'s avatar` : "User avatar"}
                        className="h-9 w-9 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded bg-zinc-200 text-[10px] font-semibold text-zinc-700">
                        {fallbackInitials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="truncate text-[15px] font-semibold text-zinc-900 gap-x-1 flex items-center">
                          <span>{userName || "Your Name"}</span>
                          {identityModeLocal === "name-email" && (
                            <>
                              <span>
                                &lt;{userEmail || "you@example.com"}&gt;
                              </span>
                            </>
                          )}
                        </span>
                        <span className="text-[12px] text-zinc-400">now</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[15px] leading-6 text-zinc-800">
                        This is a preview of how your messages will appear in
                        Slack.
                        {"\n"}
                        Reply inline, attach files, and keep email threads in
                        sync.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sending domain configuration */}
                <div className="grid-cols-2 gap-2 grid items-start">
                  <div className="col-span-1">
                    <label
                      htmlFor="sending-domain"
                      className="text-sm font-medium text-foreground block mb-1"
                    >
                      Sending & reply domain
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Domain used for email replies. Users will appear as{" "}
                      <span className="font-mono text-xs">Name &lt;name@domain.com&gt;</span>
                    </p>
                  </div>
                  <div className="col-span-1">
                    {!inboundApiKey ? (
                      <p className="text-xs text-muted-foreground">
                        Add your Inbound API key to see available domains
                      </p>
                    ) : isLoadingDomains ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Loading domains...
                      </p>
                    ) : domains.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No verified domains found
                      </p>
                    ) : (
                      <Select
                        value={sendingDomain || undefined}
                        onValueChange={handleSendingDomainChange}
                        disabled={updateWorkspaceConfigMutation.isPending || isInitialLoading}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a domain" />
                        </SelectTrigger>
                        <SelectContent>
                          {domains.map((domain: { domain: string; status: string; canReceiveEmails: boolean }) => (
                            <SelectItem key={domain.domain} value={domain.domain}>
                              {domain.domain}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                {/* Channel name prefix configuration */}
                <div className="grid-cols-2 gap-2 grid items-start">
                  <div className="col-span-1">
                    <label
                      htmlFor="channel-name-prefix"
                      className="text-sm font-medium text-foreground block mb-1"
                    >
                      Channel name prefix
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Prefix applied to all new channels created. Use <span className="font-mono text-xs">*</span> as a placeholder for the channel name.
                    </p>
                  </div>
                  <div className="col-span-1">
                    <Input
                      id="channel-name-prefix"
                      type="text"
                      value={channelNamePrefix}
                      onChange={(e) => handleChannelNamePrefixChange(e.target.value)}
                      disabled={updateWorkspaceConfigMutation.isPending || isInitialLoading}
                      placeholder="ext-inbd-*"
                      className="h-9 text-xs font-mono"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Example: Creating "support" with prefix "ext-inbd-*" results in "ext-inbd-support"
                    </p>
                  </div>
                </div>

                {/* Save button */}
                <div className="flex items-center justify-end gap-3 pt-4">
                  {error && (
                    <p className="text-xs text-red-600">{error}</p>
                  )}
                  {updateWorkspaceConfigMutation.isPending ? (
                    <button
                      disabled
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed flex items-center gap-2"
                    >
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Saving...
                    </button>
                  ) : (
                    <button
                      onClick={handleSaveConfiguration}
                      disabled={!hasUnsavedChanges}
                      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                        hasUnsavedChanges
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                      }`}
                    >
                      Save Changes
                    </button>
                  )}
                </div>

                
              </div>
            </div>
            )}
          </div>
        )}
        <CommandPalette
          open={isCommandPaletteOpen}
          onOpenChange={(open) => {
            setIsCommandPaletteOpen(open);
            if (!open) {
              // Reset when closing
              setCreateRouteInitialStep(undefined);
            }
          }}
          domains={domains}
          onChannelCreate={handleChannelCreate}
          initialStep={createRouteInitialStep}
          channels={slackChannels}
          workspaceConfig={workspaceConfigResult}
          emailRoutes={emailRoutes}
        />
        <AlertDialog open={emailToDelete !== null} onOpenChange={(open) => !open && setEmailToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove email route</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove the route for <strong>{emailToDelete}</strong>? The email address will be deleted from Inbound.new, but the Slack channel will remain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteRouteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={deleteRouteMutation.isPending}
                className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              >
                {deleteRouteMutation.isPending ? "Removing..." : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
