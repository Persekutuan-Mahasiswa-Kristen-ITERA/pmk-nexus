import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "./cookies";

/**
 * Browser client. Used for sign-in only, so Supabase Auth rate-limits by the member's own IP
 * (spec 8.6). Do not read data with it: data reads go through server code and src/lib/picore/.
 */
export function createClient() {
  const { url, publishableKey } = supabasePublicEnv();
  return createBrowserClient(url, publishableKey, { cookieOptions: AUTH_COOKIE_OPTIONS });
}
