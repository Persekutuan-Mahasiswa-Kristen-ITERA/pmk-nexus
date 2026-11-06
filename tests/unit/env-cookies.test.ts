// AUTH-13, AUTH-40, AR3: cookie options, cookie-name matching, and the secret-key guards in env.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_OPTIONS, isAuthCookieName } from "@/lib/supabase/cookies";
import { picoreBaseUrl, supabasePublicEnv } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

function jwtWithRole(role: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ role })}.sig`;
}

describe("auth cookie options", () => {
  it("SameSite=Lax, path /, 400 days, readable by the browser client", () => {
    expect(AUTH_COOKIE_OPTIONS).toMatchObject({ path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60 });
    expect(AUTH_COOKIE_MAX_AGE).toBe(34_560_000);
  });
});

describe("isAuthCookieName", () => {
  it.each(["sb-127-auth-token", "sb-abcdef-auth-token", "sb-abc-auth-token.0", "sb-abc-auth-token.12"])("%s is a session cookie", (n) => {
    expect(isAuthCookieName(n)).toBe(true);
  });
  it.each(["sb-abc-auth-token-code-verifier", "session", "sb-auth-token", "xsb-a-auth-token", "sb-a-auth-token.x", "theme", ""])(
    "%j is not",
    (n) => expect(isAuthCookieName(n)).toBe(false),
  );
});

describe("supabasePublicEnv (AR3: never a secret key in the public variable)", () => {
  it("returns url and key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55431");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
    expect(supabasePublicEnv()).toEqual({ url: "http://127.0.0.1:55431", publishableKey: "sb_publishable_abc" });
  });
  it.each([
    ["url", "", "sb_publishable_abc"],
    ["key", "http://x", ""],
  ])("missing %s throws", (_l, url, key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    expect(() => supabasePublicEnv()).toThrow(/Missing/);
  });
  it("refuses an sb_secret_ key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_abc");
    expect(() => supabasePublicEnv()).toThrow(/SECRET/);
  });
  it("refuses a legacy service_role JWT", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", jwtWithRole("service_role"));
    expect(() => supabasePublicEnv()).toThrow(/SECRET/);
  });
  it("accepts a legacy anon JWT", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", jwtWithRole("anon"));
    expect(supabasePublicEnv().publishableKey).toContain(".");
  });
});

describe("picoreBaseUrl", () => {
  it.each([
    ["https://pi-core-v2.vercel.app", "https://pi-core-v2.vercel.app"],
    ["https://pi-core-v2.vercel.app/", "https://pi-core-v2.vercel.app"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["https://example.org/pi/", "https://example.org/pi"],
  ])("%s -> %s", (raw, expected) => {
    vi.stubEnv("NEXT_PUBLIC_PICORE_URL", raw);
    expect(picoreBaseUrl()).toBe(expected);
  });
  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://x.y", "not a url", ""])("rejects %j", (raw) => {
    vi.stubEnv("NEXT_PUBLIC_PICORE_URL", raw);
    expect(() => picoreBaseUrl()).toThrow();
  });
});
