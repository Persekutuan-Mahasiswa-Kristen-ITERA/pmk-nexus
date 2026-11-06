// AUTH-18, AUTH-20 (order side), AUTH-41: getAccessState ordering and fail-closed behaviour.
// Evaluation order (D-015): anonymous > error > no_access > password_pending > member.
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifySession = vi.fn();
const readMyContext = vi.fn();
const readPasswordChangePending = vi.fn();
const readMyPermissions = vi.fn();
const createClient = vi.fn();

// React's cache() memoizes per request. Tests need a fresh evaluation each call.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: (...a: unknown[]) => createClient(...a) }));
vi.mock("@/lib/supabase/claims", () => ({ verifySession: (...a: unknown[]) => verifySession(...a) }));
vi.mock("@/lib/picore/context", () => ({
  readMyContext: (...a: unknown[]) => readMyContext(...a),
  readPasswordChangePending: (...a: unknown[]) => readPasswordChangePending(...a),
  readMyPermissions: (...a: unknown[]) => readMyPermissions(...a),
}));

import { getAccessState } from "@/lib/auth/session";

const member = {
  memberId: "m1",
  fullName: "Budi",
  memberType: "student",
  isSystemAdmin: false,
  activePeriodId: null,
  activePeriodLabel: null,
};
const grants = [{ key: "inventory.view", scope: "all", unitIds: [], isSensitive: false }];

const ok = <T>(data: T) => ({ ok: true as const, data });
const bad = { ok: false as const };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const m of [verifySession, readMyContext, readPasswordChangePending, readMyPermissions, createClient]) m.mockReset();
  createClient.mockResolvedValue({ fake: "client" });
  verifySession.mockResolvedValue({ kind: "signed_in", userId: "u1" });
  readMyContext.mockResolvedValue(ok(member));
  readPasswordChangePending.mockResolvedValue(ok(false));
  readMyPermissions.mockResolvedValue(ok(grants));
});

describe("getAccessState", () => {
  it("anonymous session -> anonymous, and the database is never asked", async () => {
    verifySession.mockResolvedValue({ kind: "anonymous" });
    expect(await getAccessState()).toEqual({ kind: "anonymous" });
    expect(readMyContext).not.toHaveBeenCalled();
    expect(readPasswordChangePending).not.toHaveBeenCalled();
    expect(readMyPermissions).not.toHaveBeenCalled();
  });

  it("Auth unreachable (unavailable) -> error, not anonymous (the session is kept, AR10)", async () => {
    verifySession.mockResolvedValue({ kind: "unavailable" });
    expect(await getAccessState()).toEqual({ kind: "error" });
    expect(readMyContext).not.toHaveBeenCalled();
  });

  it("client cannot be created (missing env) -> error", async () => {
    createClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));
    expect(await getAccessState()).toEqual({ kind: "error" });
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("my_context failed -> error (AUTH-18), not no_access", async () => {
    readMyContext.mockResolvedValue(bad);
    expect(await getAccessState()).toEqual({ kind: "error" });
    expect(readMyPermissions).not.toHaveBeenCalled();
  });

  it("pending-flag read failed -> error, even for an active member (never a silent 'not pending')", async () => {
    readPasswordChangePending.mockResolvedValue(bad);
    expect(await getAccessState()).toEqual({ kind: "error" });
  });

  it("error outranks no_access: zero rows + failed pending check -> error", async () => {
    readMyContext.mockResolvedValue(ok(null));
    readPasswordChangePending.mockResolvedValue(bad);
    expect(await getAccessState()).toEqual({ kind: "error" });
  });

  it("zero rows -> no_access and permissions are not requested", async () => {
    readMyContext.mockResolvedValue(ok(null));
    expect(await getAccessState()).toEqual({ kind: "no_access" });
    expect(readMyPermissions).not.toHaveBeenCalled();
  });

  it("no_access outranks password_pending (unlinked user must not see the PI-CORE gate)", async () => {
    readMyContext.mockResolvedValue(ok(null));
    readPasswordChangePending.mockResolvedValue(ok(true));
    expect(await getAccessState()).toEqual({ kind: "no_access" });
  });

  it("pending flag true on an active member -> password_pending, no permissions loaded (AUTH-20)", async () => {
    readPasswordChangePending.mockResolvedValue(ok(true));
    expect(await getAccessState()).toEqual({ kind: "password_pending" });
    expect(readMyPermissions).not.toHaveBeenCalled();
  });

  it("permissions failed -> error, never a member without checking rights", async () => {
    readMyPermissions.mockResolvedValue(bad);
    expect(await getAccessState()).toEqual({ kind: "error" });
  });

  it("everything fine -> member with context and permissions", async () => {
    expect(await getAccessState()).toEqual({ kind: "member", member, permissions: grants });
  });

  it("a member with no permissions is still a member (F11), not no_access", async () => {
    readMyPermissions.mockResolvedValue(ok([]));
    expect(await getAccessState()).toEqual({ kind: "member", member, permissions: [] });
  });

  it("uses the same user client for every read (RLS applies as the caller)", async () => {
    await getAccessState();
    const client = { fake: "client" };
    expect(readMyContext).toHaveBeenCalledWith(client);
    expect(readPasswordChangePending).toHaveBeenCalledWith(client);
    expect(readMyPermissions).toHaveBeenCalledWith(client);
  });
});
