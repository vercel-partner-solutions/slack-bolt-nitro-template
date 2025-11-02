"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Building2, Plus, Triangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlackIcon } from "@/components/slack-icon";
import { useAuth } from "@/lib/auth-client";
import { toast } from "sonner";
import Waitlist from "./waitlist";

export default function Home() {
  const { user, loading: isPending } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [previewShift, setPreviewShift] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const orgColors = ["#8B5CF6", "#06B6D4", "#22C55E", "#F59E0B", "#EF4444", "#0EA5E9", "#A855F7", "#10B981"] as const;
  // Use a deterministic initial color for SSR, randomize after mount to avoid hydration mismatch
  const [orgColor, setOrgColor] = useState<string>(orgColors[0]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let rafId: number | null = null;

    const updateOffset = () => {
      const isLargeScreen = window.innerWidth >= 1024;
      const maxAdditionalOffset = isLargeScreen ? 160 : 0;
      const multiplier = isLargeScreen ? 0.22 : 0;

      const additionalOffset = Math.min(window.scrollY * multiplier, maxAdditionalOffset);
      setPreviewShift(additionalOffset);
    };

    const handleScroll = () => {
      if (rafId !== null) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        updateOffset();
        rafId = null;
      });
    };

    const handleResize = () => {
      updateOffset();
    };

    updateOffset();
    // Randomize org color on client only (after mount) to prevent SSR/CSR mismatch
    setOrgColor(orgColors[Math.floor(Math.random() * orgColors.length)]);
    // Defer visibility to next frame to avoid any initial layout measurement jitter
    const visId = window.requestAnimationFrame(() => setPreviewVisible(true));

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(visId);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-transparent" />
      </div>
    );
  }

  if (!user && !isPending && process.env.NODE_ENV !== "development") {
    return <Waitlist />;
  }

  const handleSlackLogin = async () => {
    try {
      setIsLoading(true);
      // Redirect to WorkOS sign-in with Slack provider
      window.location.href = "/auth/login";
    } catch (error) {
      console.error("Login failed:", error);
      toast.error("Login failed", {
        description: "Unable to sign in with Slack. Please try again.",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 flex-col">
        <section className="relative overflow-hidden px-4 pb-24 pt-28 sm:pb-32 sm:pt-36 lg:pb-36">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute left-1/2 top-0 h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute bottom-[-12rem] left-1/2 h-[20rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          </div>
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 lg:flex-row lg:items-center">
            <div className="flex flex-1 flex-col gap-10">
              <div className="flex flex-col gap-6">
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Email, delivered inside Slack
                </span>
                <h1 className="font-outfit text-5xl font-semibold leading-tight text-foreground sm:text-6xl lg:text-7xl">
                  Keep the email thread while you stay in Slack.
                </h1>
                <p className="max-w-xl text-lg font-medium text-muted-foreground sm:text-xl">
                  Slackbound keeps every reply, attachment, and update in sync with the original email so you never break
                  your stride—or open another tab—for customer conversations.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  onClick={handleSlackLogin}
                  disabled={isLoading}
                  size="lg"
                  className="gap-2 px-8 py-5 text-base font-medium"
                >
                  {isLoading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <SlackIcon className="h-5 w-5" />
                      Get started with Slack
                    </>
                  )}
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/80 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                    Replies stay threaded
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Answer from Slack and Slackbound syncs the message straight into the original email conversation—no
                    broken threads, no copied text.
                  </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/80 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                    Feels just like Slack
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Reply with the same shortcuts, emoji, and tempo you already use. Your team keeps its rhythm while
                    customers get polished email responses.
                  </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/80 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                    Attachments just work
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Drop screenshots, decks, or PDFs like any other file. Slackbound packages them perfectly for the
                    outbound email.
                  </p>
                </div>
                <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/80 p-5 shadow-sm">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                    Channel email addresses
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Spin up addresses like <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">&lt;channel&gt;@domain.com</code>
                    for support, sales, or QA. Every message lands where your team already hangs out.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-1 justify-center lg:justify-end">
              <div className="relative w-full max-w-[36rem] sm:max-w-[46rem] lg:max-w-[60rem] xl:max-w-[72rem]">
                <div
                  className={`transition-opacity transition-transform duration-500 ease-out will-change-transform ${
                    previewVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                  }`}
                >
                  <div className="lg:translate-x-[120px]" style={{ transform: `translateX(${previewShift}px)` }}>
                    <div className="relative overflow-hidden rounded-md bg-[#3A063B] shadow-[0_28px_96px_rgba(15,23,42,0.14)] ring-1 ring-white/10">
                  <div className="flex h-8 items-center gap-2 px-3">
                    <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
                    <span className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
                    <span className="h-3 w-3 rounded-full bg-[#28C840]" />
                  </div>
                  <div className="flex gap-2 px-2 pb-2">
                    <div className="flex w-12 shrink-0 flex-col items-center gap-4 rounded-md bg-black/5 p-1">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl ring-2 ring-white/20" style={{ backgroundColor: orgColor }}>
                        <Building2 className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black">
                        <Triangle className="h-4 w-4 text-white" fill="currentColor" />
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20">
                        <Plus className="h-5 w-5 text-white/80" />
                      </div>
                    </div>
                    <div className="relative flex-1 overflow-hidden rounded-sm border border-white/5 bg-black/5">
                      <Image
                        src="/slack-preview.png"
                        alt="Slack thread showing a customer conversation managed with Slackbound"
                        width={1248}
                        height={1426}
                        priority
                        className="h-auto w-full origin-center object-cover rounded-sm"
                      />
                    </div>
                  </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

		<section className="border-t border-border bg-muted/20 px-4 py-24 sm:py-28">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
            <div className="flex flex-col gap-4 text-center">
              <h2 className="font-outfit text-3xl font-semibold text-foreground sm:text-4xl">
						What Slackbound does best
              </h2>
              <p className="mx-auto max-w-3xl text-base text-muted-foreground">
						Map channels to email addresses and keep identity clear in every thread—so conversations stay simple for your team and your customers.
              </p>
            </div>
				<div className="grid gap-6 md:grid-cols-2">
					<div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-sm">
						<span className="text-xs font-semibold uppercase tracking-wide text-primary">Channels</span>
						<h3 className="text-lg font-semibold text-foreground">Map channels to email</h3>
						<p className="text-sm text-muted-foreground">
							Create channels mapped to email addresses like
							{" "}
							<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">#channel</code>
							{" "}
							→
							{" "}
							<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">channel@domain.com</code>.
						</p>
					</div>
					<div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-sm">
						<span className="text-xs font-semibold uppercase tracking-wide text-primary">Identity</span>
						<h3 className="text-lg font-semibold text-foreground">Clear identity in threads</h3>
						<p className="text-sm text-muted-foreground">
							When you reply in threads, Slackbound uses a unique email address to identify you so end users have clarity.
						</p>
					</div>
				</div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto w-full max-w-5xl px-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="/images/slackbound-icon.png"
                alt="Slackbound icon"
                width={24}
                height={24}
                className="h-6 w-6"
                priority
              />
              <span className="font-outfit font-semibold text-foreground">slackbound</span>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              © {new Date().getFullYear()} Slackbound. Email management made simple.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
