"use server";

// Load env vars from root first
import "@/lib/env";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function addToWaitlist(email: string) {
  try {
    await resend.contacts.create({
      email: email,
      unsubscribed: false,
      audienceId: process.env.RESEND_AUDIENCE_ID!,
    });

    return { success: true };
  } catch (error) {
    console.error("Error adding to waitlist:", error);
    return { success: false, error: "Failed to join waitlist" };
  }
}

