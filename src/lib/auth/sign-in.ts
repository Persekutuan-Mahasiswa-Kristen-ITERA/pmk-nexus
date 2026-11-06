"use client";

// Sign-in runs in the BROWSER so Supabase Auth rate-limits by the member's own IP, not by Vercel's few
// server IPs (spec 8.6, AUTH-12). The password goes only to Supabase Auth: never to a NEXUS server
// function, a URL, or a log (AR12, AUTH-44).
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { finalizeSignIn } from "./actions";
import { safeRedirectPath } from "./redirect";
import type { SignInErrorCode, SignInResult } from "./types";

export async function signInWithPassword(
  email: string,
  password: string,
  next: string | null,
): Promise<SignInResult> {
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const pass = typeof password === "string" ? password : "";
  // Checked here first so no request is sent (AUTH-09). The password is not trimmed: spaces may be real.
  if (trimmedEmail === "" || pass === "") return failure("empty_fields");
  if (isOffline()) return failure("network");

  try {
    const { data, error } = await createClient().auth.signInWithPassword({ email: trimmedEmail, password: pass });
    if (error) return failure(signInErrorCode(error));
    if (!data.session) return failure("server");
  } catch {
    return failure(isOffline() ? "network" : "server");
  }

  try {
    const { redirectTo } = await finalizeSignIn(next);
    // Checked again here: the value came over the network.
    return { ok: true, redirectTo: safeRedirectPath(redirectTo) };
  } catch {
    // The browser holds a session, but the server step failed. Report it; signing in again is harmless.
    return failure(isOffline() ? "network" : "server");
  }
}

/**
 * One code for every "these credentials do not open an account" answer: wrong password, unknown email,
 * banned (deactivated) user, unconfirmed email. Never reveal which (AR5, AUTH-07, AUTH-08).
 */
function signInErrorCode(error: unknown): SignInErrorCode {
  if (isAuthRetryableFetchError(error)) return error.status === 0 ? "network" : "server";
  if (isAuthError(error) && error.code === "over_request_rate_limit") return "rate_limited";
  if (isAuthError(error) && typeof error.status === "number") {
    if (error.status === 429) return "rate_limited";
    if (error.status >= 400 && error.status < 500) return "invalid_credentials";
  }
  // 5xx, unknown Auth errors, anything unexpected: a server problem, never "wrong password" (AUTH-11).
  return "server";
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function failure(error: SignInErrorCode): SignInResult {
  return { ok: false, error };
}
