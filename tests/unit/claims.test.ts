// AUTH-18 / AUTH-29 (unit side): verifySession separates "session is over" (anonymous) from
// "could not find out" (unavailable). Only a definite verdict may send a person to /login.
import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { verifySession } from "@/lib/supabase/claims";

function client(result: () => unknown) {
  return { auth: { getClaims: async () => result() } } as unknown as SupabaseClient;
}

describe("verifySession", () => {
  it("valid claims with a subject -> signed_in", async () => {
    const c = client(() => ({ data: { claims: { sub: "user-1" } }, error: null }));
    expect(await verifySession(c)).toEqual({ kind: "signed_in", userId: "user-1" });
  });

  it("no data and no error (no session) -> anonymous", async () => {
    expect(await verifySession(client(() => ({ data: null, error: null })))).toEqual({ kind: "anonymous" });
  });

  it("an anonymous Supabase user is not a PI-CORE account -> anonymous", async () => {
    const c = client(() => ({ data: { claims: { sub: "u", is_anonymous: true } }, error: null }));
    expect(await verifySession(c)).toEqual({ kind: "anonymous" });
  });

  it.each([
    ["missing sub", {}],
    ["empty sub", { sub: "" }],
    ["numeric sub", { sub: 5 }],
  ])("claims without a usable subject fail closed -> unavailable (%s)", async (_l, claims) => {
    expect(await verifySession(client(() => ({ data: { claims }, error: null })))).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["session missing", new AuthSessionMissingError()],
    ["invalid JWT", new AuthInvalidJwtError("bad jwt")],
    ["refresh refused 400 (revoked / banned)", new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found")],
    ["401", new AuthApiError("nope", 401, "bad_jwt")],
    ["403 user banned", new AuthApiError("User banned", 403, "user_banned")],
    ["404 user deleted", new AuthApiError("User not found", 404, "user_not_found")],
  ])("definitely over -> anonymous (%s)", async (_l, error) => {
    expect(await verifySession(client(() => ({ data: null, error })))).toEqual({ kind: "anonymous" });
  });

  it.each([
    ["network failure", new AuthRetryableFetchError("Failed to fetch", 0)],
    ["502", new AuthRetryableFetchError("bad gateway", 502)],
    ["Auth 500", new AuthApiError("boom", 500, "unexpected_failure")],
    ["Auth 503", new AuthApiError("down", 503, "unexpected_failure")],
    ["429 refresh rate-limited", new AuthApiError("slow down", 429, "over_request_rate_limit")],
    ["unknown Auth error", new AuthUnknownError("weird", new Error("x"))],
  ])("could not find out -> unavailable, session NOT dropped (%s)", async (_l, error) => {
    expect(await verifySession(client(() => ({ data: null, error })))).toEqual({ kind: "unavailable" });
  });

  it("a thrown Auth session-missing error -> anonymous", async () => {
    const c = client(() => {
      throw new AuthSessionMissingError();
    });
    expect(await verifySession(c)).toEqual({ kind: "anonymous" });
  });

  it("a thrown non-Auth error -> unavailable (fail closed, no logout)", async () => {
    const c = client(() => {
      throw new TypeError("boom");
    });
    expect(await verifySession(c)).toEqual({ kind: "unavailable" });
  });

  it("a plain Error returned in `error` -> unavailable", async () => {
    expect(await verifySession(client(() => ({ data: null, error: new Error("x") })))).toEqual({ kind: "unavailable" });
  });
});
