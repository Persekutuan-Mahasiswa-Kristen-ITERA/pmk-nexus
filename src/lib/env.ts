// Public configuration (safe to ship to the browser). Secrets never live here: NEXUS has none.
// Each NEXT_PUBLIC_* value is written out literally so Next.js can inline it into the browser bundle.

export type SupabasePublicEnv = { url: string; publishableKey: string };

/** Reads the Supabase URL and publishable key. Lazy, so a missing value fails at use, not at import. */
export function supabasePublicEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.",
    );
  }
  assertNotSecretKey(publishableKey);
  return { url, publishableKey };
}

/**
 * Guard against the most dangerous misconfiguration: pasting the service role / secret key into the
 * public variable. That key bypasses RLS and would ship to every browser (CLAUDE.md section 11).
 */
function assertNotSecretKey(key: string): void {
  if (key.startsWith("sb_secret_") || legacyJwtRole(key) === "service_role") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Replace it with the publishable (anon) key and rotate the secret key now.",
    );
  }
}

/** Role claim of a legacy JWT-style API key, or null if the key is not a readable JWT. */
function legacyJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (payload && typeof payload === "object" && "role" in payload && typeof payload.role === "string") {
      return payload.role;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Base address of the PI-CORE app (for the "Buka PI-CORE" link, D-015). Must be an http(s) URL so a
 * bad value can never become a `javascript:` link. Returned without a trailing slash.
 */
export function picoreBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_PICORE_URL;
  if (!raw) throw new Error("Missing NEXT_PUBLIC_PICORE_URL. Copy .env.example to .env.local.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_PICORE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_PICORE_URL must start with https:// (or http:// for local development).");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
