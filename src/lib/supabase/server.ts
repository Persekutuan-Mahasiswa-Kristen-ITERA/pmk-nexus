import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "./cookies";

/**
 * Per-request client that acts AS the signed-in user: every query runs under RLS with their token.
 * Publishable key only. NEXUS never holds the service role key and never calls auth.admin (AR3).
 */
export async function createClient() {
  const { url, publishableKey } = supabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. The proxy refreshes the session on every request,
          // so the cookies it writes are the source of truth. Server Actions can write and do.
        }
      },
    },
  });
}
