import type { CookieOptionsWithName } from "@supabase/ssr";

/** @supabase/ssr default lifetime. The refresh token inside lives as long as the cookie (spec F9). */
export const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * One set of options for every Supabase auth cookie, whoever writes it (browser, proxy, Server Action).
 * httpOnly stays false on purpose: the browser client must read and replace the session after sign-in.
 * Secure in production (spec 8.7, AUTH-13); localhost keeps working in development.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  maxAge: AUTH_COOKIE_MAX_AGE,
};

/** Supabase session cookie names: `sb-<project-ref>-auth-token`, optionally chunked as `.0`, `.1`, ... */
const AUTH_COOKIE_NAME = /^sb-.+-auth-token(\.\d+)?$/;

export function isAuthCookieName(name: string): boolean {
  return AUTH_COOKIE_NAME.test(name);
}
