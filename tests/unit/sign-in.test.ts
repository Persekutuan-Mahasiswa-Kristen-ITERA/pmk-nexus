// AUTH-07..AUTH-12, AUTH-43, AUTH-44: browser sign-in helper and its error mapping.
// The Supabase browser client and the finalizeSignIn Server Action are mocked.
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPasswordMock = vi.fn();
const finalizeSignInMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: signInWithPasswordMock } }),
}));
vi.mock("@/lib/auth/actions", () => ({ finalizeSignIn: (...args: unknown[]) => finalizeSignInMock(...args) }));

import { signInWithPassword } from "@/lib/auth/sign-in";

const goodSession = { data: { session: { access_token: "t" }, user: {} }, error: null };

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  finalizeSignInMock.mockReset();
  finalizeSignInMock.mockResolvedValue({ redirectTo: "/" });
  vi.unstubAllGlobals();
});

describe("empty fields (AUTH-09): no request is sent", () => {
  it.each([
    ["", ""],
    ["   ", "secret"],
    ["a@b.c", ""],
    ["", "secret"],
  ])("email %j / password %j", async (email, password) => {
    const result = await signInWithPassword(email, password, null);
    expect(result).toEqual({ ok: false, error: "empty_fields" });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(finalizeSignInMock).not.toHaveBeenCalled();
  });

  it("non-string input is treated as empty", async () => {
    const result = await signInWithPassword(undefined as unknown as string, null as unknown as string, null);
    expect(result).toEqual({ ok: false, error: "empty_fields" });
  });
});

describe("credentials sent to Supabase", () => {
  it("trims the email but not the password", async () => {
    signInWithPasswordMock.mockResolvedValue(goodSession);
    await signInWithPassword("  a@b.c  ", " pa ss ", null);
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "a@b.c", password: " pa ss " });
  });

  it("a whitespace-only password is NOT empty (spaces can be real)", async () => {
    signInWithPasswordMock.mockResolvedValue(goodSession);
    const result = await signInWithPassword("a@b.c", "   ", null);
    expect(signInWithPasswordMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe("error mapping (AUTH-07, AUTH-08, AUTH-10, AUTH-11)", () => {
  const authApi = (message: string, status: number, code: string) => new AuthApiError(message, status, code);

  it.each([
    ["wrong password / unknown email (400 invalid_credentials)", authApi("Invalid login credentials", 400, "invalid_credentials"), "invalid_credentials"],
    ["banned user (400 user_banned)", authApi("User is banned", 400, "user_banned"), "invalid_credentials"],
    ["banned user (403)", authApi("User is banned", 403, "user_banned"), "invalid_credentials"],
    ["unconfirmed email (400)", authApi("Email not confirmed", 400, "email_not_confirmed"), "invalid_credentials"],
    ["401", authApi("nope", 401, "bad_jwt"), "invalid_credentials"],
    ["422 validation", authApi("Unable to validate email address", 422, "validation_failed"), "invalid_credentials"],
    ["429 status", authApi("Too many", 429, "unexpected_failure"), "rate_limited"],
    ["over_request_rate_limit code with other status", authApi("Rate", 400, "over_request_rate_limit"), "rate_limited"],
    ["429 over_request_rate_limit", authApi("Rate", 429, "over_request_rate_limit"), "rate_limited"],
    ["500", authApi("boom", 500, "unexpected_failure"), "server"],
    ["503", authApi("down", 503, "unexpected_failure"), "server"],
    ["retryable fetch error, status 502", new AuthRetryableFetchError("bad gateway", 502), "server"],
    ["retryable fetch error, status 0 (network)", new AuthRetryableFetchError("Failed to fetch", 0), "network"],
    ["unknown auth error", new AuthUnknownError("weird", new Error("x")), "server"],
  ])("%s -> %s", async (_label, error, code) => {
    signInWithPasswordMock.mockResolvedValue({ data: { session: null, user: null }, error });
    const result = await signInWithPassword("a@b.c", "secret", null);
    expect(result).toEqual({ ok: false, error: code });
    expect(finalizeSignInMock).not.toHaveBeenCalled();
  });

  it("a plain Error from the client is a server problem, never wrong credentials (AUTH-11)", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { session: null, user: null }, error: new Error("TypeError") });
    expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: false, error: "server" });
  });

  it("a thrown exception is a server problem", async () => {
    signInWithPasswordMock.mockRejectedValue(new Error("boom"));
    expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: false, error: "server" });
  });

  it("success without a session is a server problem, not success", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { session: null, user: null }, error: null });
    expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: false, error: "server" });
  });

  it("the same code is returned for unknown email and wrong password (AUTH-07)", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null, user: null },
      error: authApi("Invalid login credentials", 400, "invalid_credentials"),
    });
    const wrongPassword = await signInWithPassword("known@b.c", "bad", null);
    const unknownEmail = await signInWithPassword("nobody@b.c", "bad", null);
    expect(wrongPassword).toEqual(unknownEmail);
  });
});

describe("offline", () => {
  it("navigator.onLine === false reports network and sends no request", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: false, error: "network" });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("an exception while offline is reported as network", async () => {
    let online = true;
    vi.stubGlobal("navigator", {
      get onLine() {
        return online;
      },
    });
    signInWithPasswordMock.mockImplementation(async () => {
      online = false;
      throw new TypeError("Failed to fetch");
    });
    expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: false, error: "network" });
  });
});

describe("after a successful sign-in", () => {
  it("passes `next` to the server action and returns the safe path it answers with", async () => {
    signInWithPasswordMock.mockResolvedValue(goodSession);
    finalizeSignInMock.mockResolvedValue({ redirectTo: "/finance" });
    const result = await signInWithPassword("a@b.c", "secret", "/finance");
    expect(finalizeSignInMock).toHaveBeenCalledWith("/finance");
    expect(result).toEqual({ ok: true, redirectTo: "/finance" });
  });

  it("never sends the password to the server action (AUTH-44)", async () => {
    signInWithPasswordMock.mockResolvedValue(goodSession);
    await signInWithPassword("a@b.c", "TopSecret99", "/x");
    expect(JSON.stringify(finalizeSignInMock.mock.calls)).not.toContain("TopSecret99");
  });

  it("re-checks the path from the server and falls back to / when it is unsafe", async () => {
    signInWithPasswordMock.mockResolvedValue(goodSession);
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/login"]) {
      finalizeSignInMock.mockResolvedValue({ redirectTo: bad });
      expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: true, redirectTo: "/" });
    }
  });

  it("a failing server step is reported as server (and not as wrong credentials)", async () => {
    signInWithPasswordMock.mockResolvedValue(goodSession);
    finalizeSignInMock.mockRejectedValue(new Error("action failed"));
    expect(await signInWithPassword("a@b.c", "secret", null)).toEqual({ ok: false, error: "server" });
  });
});

describe("AUTH-12: sign-in is a browser-side call", () => {
  it("is a client module that calls the Supabase browser client, not a server function", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/auth/sign-in.ts", "utf8");
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
    expect(source).toContain("@/lib/supabase/client");
    expect(source).not.toContain("@/lib/supabase/server");
  });
});
