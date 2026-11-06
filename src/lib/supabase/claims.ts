import {
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Outcome of validating the caller's JWT.
 * - signed_in: the token is valid (signature and expiry checked by getClaims()).
 * - anonymous: no session, or the session is definitely gone (invalid/expired token, refresh refused).
 * - unavailable: we could not find out (network, Auth server 5xx, unexpected error). Callers must fail
 *   closed WITHOUT dropping the session (D-015, AR10): it may be perfectly valid.
 */
export type VerifiedSession = { kind: "signed_in"; userId: string } | { kind: "anonymous" } | { kind: "unavailable" };

/** Never trust getSession() on the server: getClaims() verifies the JWT (and refreshes when needed). */
export async function verifySession(supabase: SupabaseClient): Promise<VerifiedSession> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) return classifyAuthError(error);
    if (!data) return { kind: "anonymous" };

    const { sub, is_anonymous: isAnonymous } = data.claims;
    // Supabase anonymous sign-ins are not PI-CORE accounts (no public sign-up, D-002).
    if (isAnonymous === true) return { kind: "anonymous" };
    // A user session always carries a subject. Anything else is an unexpected shape: fail closed.
    if (typeof sub !== "string" || sub.length === 0) return { kind: "unavailable" };
    return { kind: "signed_in", userId: sub };
  } catch (error) {
    return isAuthError(error) ? classifyAuthError(error) : { kind: "unavailable" };
  }
}

function classifyAuthError(error: unknown): VerifiedSession {
  // Network failure or Auth 502/503/504: the session may still be valid. Do not treat as logged out.
  if (isAuthRetryableFetchError(error)) return { kind: "unavailable" };
  // Auth answered with a 4xx (refresh token revoked or reused, user banned or deleted, bad JWT):
  // the session is really over. Exception: 429 (refresh rate-limited) says nothing about validity.
  if (isAuthApiError(error)) {
    const over = error.status < 500 && error.status !== 429;
    return over ? { kind: "anonymous" } : { kind: "unavailable" };
  }
  // Client-side verdicts: no session at all, or an invalid / expired / badly signed JWT.
  if (isAuthSessionMissingError(error)) return { kind: "anonymous" };
  if (isAuthError(error) && error.name === "AuthInvalidJwtError") return { kind: "anonymous" };
  // Anything else (unknown Auth error, refresh discarded by a concurrent request, ...): fail closed.
  return { kind: "unavailable" };
}
