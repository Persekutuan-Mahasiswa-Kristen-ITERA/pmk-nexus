"use client";

// Ends THIS browser's NEXUS session without navigating (spec 6.2). Runs in the browser on purpose:
// a Server Action that changes cookies makes Next.js re-render the route, which would send the person
// to /login before they can read the No-access message. Local scope: PI-CORE sessions are untouched.
import { createClient } from "@/lib/supabase/client";

export async function dropLocalSession(): Promise<void> {
  try {
    await createClient().auth.signOut({ scope: "local" });
  } catch {
    // Harmless if it fails: RLS already denies this account everything, and "Keluar" still works.
  }
}
