import type { Metadata } from "next";
import { Geist, Outfit } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { Toaster } from "sonner";
import { Providers } from "@/components/providers";
import "./globals.css";
// Root layout must remain a Server Component. Avoid client-only hooks here.

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: "500",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: "600",
});

export const metadata: Metadata = {
  title: "Slackbound - Email Management in Slack",
  description: "Send and manage your email entirely in Slack. Simple, powerful, and seamlessly integrated.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geist.variable} ${GeistSans.variable} ${outfit.variable} antialiased`}
      >
        <Providers>
        {children}
        <Toaster />
        </Providers>
      </body>
    </html>
  );
}
