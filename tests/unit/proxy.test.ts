// AUTH-01, AUTH-29, AUTH-32 (proxy side): redirect rules of the coarse gate, with the session verdict mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifySession = vi.fn();
vi.mock("@/lib/supabase/claims", () => ({ verifySession: (...a: unknown[]) => verifySession(...a) }));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55431");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

import { updateSession } from "@/lib/supabase/proxy";

function req(path: string, init: { method?: string; cookie?: string } = {}) {
  return new NextRequest(`http://localhost:3100${path}`, {
    method: init.method ?? "GET",
    headers: init.cookie ? { cookie: init.cookie } : {},
  });
}

beforeEach(() => verifySession.mockReset());

describe("anonymous page requests", () => {
  beforeEach(() => verifySession.mockResolvedValue({ kind: "anonymous" }));

  it("home page -> /login with no next and no reason (F1)", async () => {
    const res = await updateSession(req("/"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/login");
  });

  it("deep link -> /login?next=<path> (F10)", async () => {
    const res = await updateSession(req("/finance/reports?year=2026"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/finance/reports?year=2026");
    expect(loc.searchParams.get("reason")).toBeNull();
  });

  it("with a stale session cookie adds reason=session_ended (AUTH-29)", async () => {
    const res = await updateSession(req("/letters", { cookie: "sb-127-auth-token=stale" }));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("next")).toBe("/letters");
    expect(loc.searchParams.get("reason")).toBe("session_ended");
  });

  it("an unrelated cookie does not add reason", async () => {
    const res = await updateSession(req("/letters", { cookie: "theme=dark" }));
    expect(new URL(res.headers.get("location")!).searchParams.get("reason")).toBeNull();
  });

  it("drops the Next.js internal _rsc value from next", async () => {
    const res = await updateSession(req("/finance?_rsc=abc123"));
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/finance");
  });

  it("a path that would be unsafe as `next` is replaced by nothing (login page itself is not a target)", async () => {
    const res = await updateSession(req("/login/x"));
    // /login/* is a public path: no redirect at all.
    expect(res.status).toBe(200);
  });

  it("a protocol-relative looking path does not become an open redirect", async () => {
    const res = await updateSession(req("//evil.example/x"));
    const loc = res.headers.get("location");
    if (loc) {
      const u = new URL(loc);
      expect(u.origin).toBe("http://localhost:3100");
      const next = u.searchParams.get("next");
      expect(next === null || (next.startsWith("/") && !next.startsWith("//"))).toBe(true);
    }
  });

  it("/login and /login/... stay public (no redirect loop)", async () => {
    expect((await updateSession(req("/login"))).status).toBe(200);
    expect((await updateSession(req("/login?next=%2Ffinance"))).status).toBe(200);
  });

  it("POST (Server Action) is not redirected: the action returns its own result (AUTH-30)", async () => {
    const res = await updateSession(req("/finance", { method: "POST" }));
    expect(res.status).toBe(200);
  });

  it("every response is private, no-store", async () => {
    expect((await updateSession(req("/"))).headers.get("cache-control")).toBe("private, no-store");
    expect((await updateSession(req("/login"))).headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("signed-in and unavailable", () => {
  it("signed in -> passes through", async () => {
    verifySession.mockResolvedValue({ kind: "signed_in", userId: "u" });
    expect((await updateSession(req("/finance"))).status).toBe(200);
  });

  it("Auth unreachable -> passes through (page shows 'gangguan'; no fake logout, AR10)", async () => {
    verifySession.mockResolvedValue({ kind: "unavailable" });
    const res = await updateSession(req("/finance", { cookie: "sb-127-auth-token=x" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
