"use server";

// The only Server Actions that run without a member check (spec 8.1): each touches nothing but the
// caller's own session. Server Actions are POST-only with Next.js's origin check, so neither can be
// triggered by a cross-site link (spec 8.7).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/supabase/claims";
import { AUTH_COOKIE_OPTIONS, isAuthCookieName } from "@/lib/supabase/cookies";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "./redirect";

/**
 * Runs right after the browser sign-in. Re-issues the Supabase auth cookies from a server response so
 * Safari's 7-day cap on script-written cookies does not log out installed iOS apps (A-AUTH-3). The
 * values do not change, only who writes them. Returns a safe return path; `next` is untrusted input.
 */
export async function finalizeSignIn(next: string | null): Promise<{ redirectTo: string }> {
  const redirectTo = safeRedirectPath(typeof next === "string" ? next : null);
  try {
    const supabase = await createClient();
    // Only re-issue a session that is really valid; this may also refresh it (written via setAll).
    const session = await verifySession(supabase);
    if (session.kind !== "signed_in") return { redirectTo };

    const store = await cookies();
    for (const cookie of store.getAll()) {
      // Skip empty values: those are chunks @supabase/ssr just deleted; re-setting them would revive them.
      if (isAuthCookieName(cookie.name) && cookie.value !== "") {
        store.set(cookie.name, cookie.value, AUTH_COOKIE_OPTIONS);
      }
    }
  } catch {
    // Best effort only. The browser already holds the session; the pages re-check everything.
    console.error("[auth] finalizeSignIn could not re-issue the session cookies");
  }
  return { redirectTo };
}

/** Ends THIS browser's NEXUS session only (local scope, A-AUTH-6; PI-CORE stays signed in) and goes to /login. */
export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) await clearAuthCookies();
  } catch {
    await clearAuthCookies();
  }
  redirect("/login");
}

/** Fallback when Auth is unreachable: drop the cookies ourselves so logout always works on this device. */
async function clearAuthCookies(): Promise<void> {
  try {
    const store = await cookies();
    for (const cookie of store.getAll()) {
      if (isAuthCookieName(cookie.name)) store.delete({ name: cookie.name, path: "/" });
    }
  } catch {
    // Nothing more we can do; the redirect below still leaves the protected page.
  }
}
