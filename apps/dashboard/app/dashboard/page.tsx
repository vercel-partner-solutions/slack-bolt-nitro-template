"use client";

import { useState, useEffect } from "react";
import { signOut, useSession } from "@/lib/auth-client";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Lato } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import {
  getCurrentUserConfig,
  updateUserConfig,
  updateInboundApiKey,
  fetchInboundDomains,
  fetchSlackChannels,
  getSlackWorkspaceInfo,
  checkBotInstallation,
} from "@/app/actions/user-config";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LottieIcon } from "@/components/lotties/lottie-icon";
import slackLogoAnimation from "@/components/lotties/slack-logo.json";
import configIconAnimation from "@/components/lotties/config-icon.json";
import developerIconAnimation from "@/components/lotties/developer-icon.json";
import { CommandPalette } from "@/components/command-palette";
import { redirect } from "next/navigation";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700"] });

export default function DashboardPage() {
  const { data: session, isPending } = useSession();

  const user = session?.user;
  const userName = user?.name ?? "";
  const userEmail = user?.email ?? "";
  const userImage = user?.image ?? "";
  const [identityMode, setIdentityMode] = useState<"name-email" | "name-only">(
    "name-email"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inboundApiKey, setInboundApiKey] = useState<string>("");
  const [inboundApiKeyInput, setInboundApiKeyInput] = useState<string>("");
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [domains, setDomains] = useState<
    Array<{ id: string; domain: string; status: string }>
  >([]);
  const [isLoadingDomains, setIsLoadingDomains] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [slackChannels, setSlackChannels] = useState<
    Array<{
      id: string;
      name: string;
      isPrivate: boolean;
      isMember: boolean;
      numMembers: number;
    }>
  >([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<{
    teamId: string;
    teamName: string;
    teamUrl: string;
    userId: string;
    userName: string;
  } | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [botInstalled, setBotInstalled] = useState<boolean | null>(null);
  const [isCheckingBot, setIsCheckingBot] = useState(false);
  // Mock channel mappings data with different colors
  const colors = ["bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500"];
  const [channelMappings, setChannelMappings] = useState<
    Array<{
      channelName: string;
      emailAddress: string;
      conversations: number;
      messages: number;
      color: string;
    }>
  >([
    {
      channelName: "#inb-ext-support",
      emailAddress: "support@slackbound.com",
      conversations: 24,
      messages: 142,
      color: colors[0],
    },
    {
      channelName: "#inb-ext-sales-team",
      emailAddress: "sales@slackbound.com",
      conversations: 8,
      messages: 39,
      color: colors[1],
    },
  ]);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Handle channel creation (UI only for now)
  const handleChannelCreate = (channelName: string, emailAddress: string) => {
    const color = colors[channelMappings.length % colors.length];
    setChannelMappings([
      ...channelMappings,
      {
        channelName: `#inb-ext-${channelName}`,
        emailAddress,
        conversations: 0,
        messages: 0,
        color,
      },
    ]);
  };

  const fallbackInitials = (userName || userEmail || "U")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Fetch domains from Inbound.new
  const fetchDomains = async (apiKey: string) => {
    if (!apiKey) return;

    setIsLoadingDomains(true);
    const result = await fetchInboundDomains(apiKey);
    setIsLoadingDomains(false);

    if (result.success && result.data) {
      setDomains(result.data);
    } else {
      console.error("Failed to fetch domains:", result.error);
    }
  };

  // Fetch Slack channels
  const loadSlackChannels = async () => {
    setIsLoadingChannels(true);
    setChannelsError(null);
    const result = await fetchSlackChannels();
    setIsLoadingChannels(false);

    if (result.success && result.data) {
      setSlackChannels(result.data);
    } else {
      // Store both error code and message for better UI handling
      if (result.error === "bot_not_installed") {
        setChannelsError("bot_not_installed");
      } else {
        setChannelsError(result.error || result.message || "Failed to load channels");
      }
    }
  };

  // Fetch Slack workspace info
  const loadWorkspaceInfo = async () => {
    setIsLoadingWorkspace(true);
    const result = await getSlackWorkspaceInfo();
    setIsLoadingWorkspace(false);

    if (result.success && result.data) {
      setWorkspaceInfo(result.data);
    }
  };

  // Check bot installation status
  const loadBotStatus = async () => {
    setIsCheckingBot(true);
    const result = await checkBotInstallation();
    setIsCheckingBot(false);

    if (result.success && 'installed' in result) {
      setBotInstalled(result.installed);
    }
  };

  // Fetch initial config
  useEffect(() => {
    if (!isPending && user) {
      setIsInitialLoading(true);
      getCurrentUserConfig()
        .then((config) => {
          if (config) {
            setIdentityMode(
              config.shouldShowFullEmail ? "name-email" : "name-only"
            );
            if (config.inboundApiKey) {
              setInboundApiKey(config.inboundApiKey);
              // Fetch domains when API key is available
              fetchDomains(config.inboundApiKey);
            }
            if (config.sendingDomain) {
              setSelectedDomain(config.sendingDomain);
            }
          }
        })
        .catch((err) => {
          console.error("Error fetching config:", err);
          setError("Failed to load configuration");
        })
        .finally(() => {
          setIsInitialLoading(false);
        });

      // Load Slack channels, workspace info, and bot status
      loadSlackChannels();
      loadWorkspaceInfo();
      loadBotStatus();
    }
  }, [isPending, user]);

  // Handle saving inbound API key
  const handleSaveApiKey = async () => {
    if (!inboundApiKeyInput.trim()) {
      setError("Please enter an API key");
      return;
    }

    setIsSavingApiKey(true);
    setError(null);

    const result = await updateInboundApiKey(inboundApiKeyInput.trim());

    setIsSavingApiKey(false);

    if (result.success) {
      setInboundApiKey(inboundApiKeyInput.trim());
      setInboundApiKeyInput("");
      // Fetch domains after saving API key
      await fetchDomains(inboundApiKeyInput.trim());
    } else {
      setError(result.error || "Failed to save API key");
    }
  };

  // Handle domain selection
  const handleDomainChange = async (domainId: string) => {
    const domain = domains.find((d) => d.id === domainId);
    if (!domain) return;

    setSelectedDomain(domain.domain);
    setIsLoading(true);
    const result = await updateUserConfig({
      sendingDomain: domain.domain,
    });
    setIsLoading(false);

    if (!result.success) {
      setError(result.error || "Failed to save domain selection");
    }
  };

  // Handle radio button change
  const handleIdentityModeChange = async (value: string) => {
    const newMode = value as "name-email" | "name-only";
    const previousMode = identityMode;
    setIdentityMode(newMode);
    setError(null);

    setIsLoading(true);
    const result = await updateUserConfig({
      shouldShowFullEmail: newMode === "name-email",
    });

    setIsLoading(false);

    if (!result.success) {
      setError(result.error || "Failed to save configuration");
      // Revert to previous value
      setIdentityMode(previousMode);
    }
  };

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
              ) : channelsError ? (
                channelsError === "bot_not_installed" ? (
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
                    <p className="text-sm text-destructive">{channelsError}</p>
                  </div>
                )
              ) : slackChannels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No channels found.
                </p>
              ) : (
                <div className="-mx-2 divide-y divide-border">
                  {slackChannels.map((channel) => (
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
                  ))}
                </div>
              )}
            </div>

            {/* Channels Card */}
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="h-[1.25em] w-[1.25em]">
                  <LottieIcon animationData={slackLogoAnimation} />
                </span>
                Channels
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Link Slack channels to email addresses. Emails sent to these addresses will be available in the channels.
              </p>
              <hr className="my-6 border-border" />
              <div className="-mx-2 divide-y divide-border">
                {channelMappings.map((mapping, index) => (
                  <div key={index} className="flex items-center justify-between px-2 py-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {mapping.channelName}
                      </span>
                      <span className="text-xs text-muted-foreground">→</span>
                      <span className="text-sm text-muted-foreground truncate">
                        {mapping.emailAddress}
                      </span>
                    </div>
                    <div className="ml-4 flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {mapping.conversations} conv{mapping.conversations !== 1 ? "s" : ""}
                      </span>
                      <span className="text-border">•</span>
                      <span>
                        {mapping.messages} msgs
                      </span>
                      <button
                        type="button"
                        className="ml-3 underline hover:text-destructive"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Developer Card */}
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
                      <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3">
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
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No workspace information available.
                </p>
              )}
            </div>

            {/* Configuration Card */}
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="h-[1.25em] w-[1.25em]">
                  <LottieIcon animationData={configIconAnimation} />
                </span>
                Configuration
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                These settings control how your identity appears in Slack and
                which channel is linked to an email address.
              </p>
              <hr className="my-6 border-border" />
              <div className="space-y-5 w-full">
                {/* Message identity selector */}
                <div className="grid-cols-2 gap-2 grid items-start">
                  <span className="text-sm font-medium text-foreground col-span-1">
                    Message identity
                  </span>
                  <div className="col-span-1">
                    <RadioGroup
                      value={identityMode}
                      onValueChange={handleIdentityModeChange}
                      disabled={isLoading || isInitialLoading}
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
                    {isLoading ? (
                      <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Saving...
                      </p>
                    ) : error ? (
                      <p className="mt-1 text-xs text-red-600">{error}</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Changes saved automatically.
                      </p>
                    )}
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
                          {identityMode === "name-email" && (
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
              </div>
              <hr className="my-6 border-border" />
              <div className="space-y-5 w-full">
                {/* Domain Configuration */}
                <div className="grid-cols-2 gap-2 grid items-start">
                  <span className="text-sm font-medium text-foreground col-span-1">
                    Domain configuration
                  </span>
                  <div className="col-span-1 space-y-4">
                    {!inboundApiKey ? (
                      <div className="space-y-2">
                        <div className="space-y-2">
                          <label
                            htmlFor="inbound-api-key"
                            className="text-sm text-foreground block"
                          >
                            Inbound API Key
                          </label>
                          <div className="flex gap-2">
                            <Input
                              id="inbound-api-key"
                              type="password"
                              placeholder="Paste your Inbound API key"
                              value={inboundApiKeyInput}
                              onChange={(e) => setInboundApiKeyInput(e.target.value)}
                              disabled={isSavingApiKey}
                              className="flex-1 h-9 rounded-md text-xs focus-visible:ring-1 focus-visible:ring-offset-1"
                            />
                            <button
                              type="button"
                              onClick={handleSaveApiKey}
                              disabled={isSavingApiKey || !inboundApiKeyInput.trim()}
                              className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isSavingApiKey ? (
                                <>
                                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                                  Saving...
                                </>
                              ) : (
                                "Save"
                              )}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Enter your Inbound.new API key to configure domain settings.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="space-y-2">
                          <label
                            htmlFor="domain-select"
                            className="text-sm text-foreground block"
                          >
                            Select Domain
                          </label>
                          <div>
                            {isLoadingDomains ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Loading domains...
                              </div>
                            ) : domains.length > 0 ? (
                              <Select
                                value={
                                  domains.find((d) => d.domain === selectedDomain)?.id || ""
                                }
                                onValueChange={handleDomainChange}
                                disabled={isLoading}
                              >
                                <SelectTrigger id="domain-select" className="h-9 text-xs w-full">
                                  <SelectValue placeholder="Select a domain" />
                                </SelectTrigger>
                                <SelectContent>
                                  {domains.map((domain) => (
                                    <SelectItem key={domain.id} value={domain.id}>
                                      {domain.domain}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                No verified domains found. Please verify your domains in
                                Inbound.new.
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            {selectedDomain
                              ? `Selected: ${selectedDomain}`
                              : "Select a domain to use for email addresses"}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setInboundApiKey("");
                              setInboundApiKeyInput("");
                              setDomains([]);
                              setSelectedDomain("");
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            Change API key
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <CommandPalette
          open={isCommandPaletteOpen}
          onOpenChange={setIsCommandPaletteOpen}
          domains={domains}
          onChannelCreate={handleChannelCreate}
        />
      </main>
    </div>
  );
}
