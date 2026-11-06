// AUTH-16, AUTH-18, AUTH-22, AUTH-41 (shape side): the PI-CORE readers validate every answer and fail closed.
// The Supabase client is a hand-written fake: `.schema("nexus").rpc(name)` returns what each test says.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMyContext, readMyPermissions, readPasswordChangePending } from "@/lib/picore/context";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

type RpcAnswer = { data?: unknown; error?: { code?: string; message?: string } | null };

function fakeClient(answer: RpcAnswer | (() => Promise<RpcAnswer>)) {
  const rpc = vi.fn(async () => (typeof answer === "function" ? answer() : { data: null, error: null, ...answer }));
  const schema = vi.fn(() => ({ rpc }));
  return { client: { schema } as unknown as SupabaseClient, rpc, schema };
}

const validContext = {
  member_id: ID,
  full_name: "Budi Santoso",
  member_type: "student",
  is_system_admin: false,
  active_period_id: ID2,
  active_period_label: "2026/2027",
};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("readMyContext", () => {
  it("calls only nexus.my_context() through the nexus schema, with no arguments", async () => {
    const { client, rpc, schema } = fakeClient({ data: [validContext] });
    await readMyContext(client);
    expect(schema).toHaveBeenCalledWith("nexus");
    expect(rpc).toHaveBeenCalledWith("my_context");
  });

  it("maps one valid row to a MemberContext (camelCase, no extra fields)", async () => {
    const { client } = fakeClient({ data: [validContext] });
    expect(await readMyContext(client)).toEqual({
      ok: true,
      data: {
        memberId: ID,
        fullName: "Budi Santoso",
        memberType: "student",
        isSystemAdmin: false,
        activePeriodId: ID2,
        activePeriodLabel: "2026/2027",
      },
    });
  });

  it("does not leak unknown columns (email, phone, nim) into the result", async () => {
    const { client } = fakeClient({ data: [{ ...validContext, email: "x@y.z", phone: "08", nim: "123" }] });
    const result = await readMyContext(client);
    expect(JSON.stringify(result)).not.toMatch(/x@y\.z|"phone"|"nim"|"email"/);
  });

  it("accepts no active period (null id and label, F12)", async () => {
    const { client } = fakeClient({ data: [{ ...validContext, active_period_id: null, active_period_label: null }] });
    const result = await readMyContext(client);
    expect(result).toMatchObject({ ok: true, data: { activePeriodId: null, activePeriodLabel: null } });
  });

  it("accepts a lecturer and a system admin", async () => {
    const { client } = fakeClient({ data: [{ ...validContext, member_type: "lecturer", is_system_admin: true }] });
    expect(await readMyContext(client)).toMatchObject({ ok: true, data: { memberType: "lecturer", isSystemAdmin: true } });
  });

  it("zero rows = ok with data null (No access, not an error)", async () => {
    const { client } = fakeClient({ data: [] });
    expect(await readMyContext(client)).toEqual({ ok: true, data: null });
  });

  it("two rows = fail closed (error, never a member)", async () => {
    const { client } = fakeClient({ data: [validContext, validContext] });
    expect(await readMyContext(client)).toEqual({ ok: false });
  });

  it.each([
    ["null (not an array)", null],
    ["a bare object", validContext],
    ["a string", "yes"],
    ["a number", 1],
    ["missing member_id", [{ ...validContext, member_id: undefined }]],
    ["member_id not a uuid", [{ ...validContext, member_id: "1" }]],
    ["empty member_id", [{ ...validContext, member_id: "" }]],
    ["unknown member_type", [{ ...validContext, member_type: "guest" }]],
    ["is_system_admin as string 'true'", [{ ...validContext, is_system_admin: "true" }]],
    ["is_system_admin missing", [{ ...validContext, is_system_admin: undefined }]],
    ["full_name null", [{ ...validContext, full_name: null }]],
    ["active_period_id not a uuid", [{ ...validContext, active_period_id: "now" }]],
    ["active_period_label number", [{ ...validContext, active_period_label: 2026 }]],
  ])("unexpected shape -> error (%s)", async (_label, data) => {
    const { client } = fakeClient({ data });
    expect(await readMyContext(client)).toEqual({ ok: false });
  });

  it.each([
    ["PGRST106 (nexus not exposed)", "PGRST106"],
    ["42501 (permission denied)", "42501"],
    ["PGRST301 (JWT)", "PGRST301"],
    ["no code", undefined],
  ])("an RPC error is an error, never No access (%s)", async (_label, code) => {
    const { client } = fakeClient({ data: null, error: { code, message: "boom with secret detail" } });
    expect(await readMyContext(client)).toEqual({ ok: false });
  });

  it("an error wins even if data is also present (never grants)", async () => {
    const { client } = fakeClient({ data: [validContext], error: { code: "500" } });
    expect(await readMyContext(client)).toEqual({ ok: false });
  });

  it("a network exception (rejected promise) is an error, not a throw", async () => {
    const { client } = fakeClient(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(readMyContext(client)).resolves.toEqual({ ok: false });
  });

  it("a throwing client.schema() is an error, not a throw", async () => {
    const client = {
      schema: () => {
        throw new Error("no client");
      },
    } as unknown as SupabaseClient;
    await expect(readMyContext(client)).resolves.toEqual({ ok: false });
  });

  it("logs only the function name and a code: no row data, ids or names", async () => {
    const { client } = fakeClient({ data: [{ ...validContext, member_type: "guest" }] });
    await readMyContext(client);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("my_context");
    expect(logged).not.toContain("Budi");
    expect(logged).not.toContain(ID);
  });
});

describe("readPasswordChangePending (AUTH-22)", () => {
  it("calls only nexus.my_password_change_pending()", async () => {
    const { client, rpc } = fakeClient({ data: true });
    await readPasswordChangePending(client);
    expect(rpc).toHaveBeenCalledWith("my_password_change_pending");
  });

  it.each([true, false])("accepts exactly %s", async (value) => {
    const { client } = fakeClient({ data: value });
    expect(await readPasswordChangePending(client)).toEqual({ ok: true, data: value });
  });

  it.each([
    ["null", null],
    ["string 'false'", "false"],
    ["number 0", 0],
    ["number 1", 1],
    ["array [false]", [false]],
    ["object", { pending: false }],
    ["undefined", undefined],
  ])("anything other than a boolean is an error, never 'not pending' (%s)", async (_label, data) => {
    const { client } = fakeClient({ data });
    expect(await readPasswordChangePending(client)).toEqual({ ok: false });
  });

  it("an RPC error is an error (a failed check must not let a temp-password user in)", async () => {
    const { client } = fakeClient({ data: false, error: { code: "42501" } });
    expect(await readPasswordChangePending(client)).toEqual({ ok: false });
  });
});

describe("readMyPermissions", () => {
  const all = { permission_key: "inventory.view", scope: "all", unit_ids: [], is_sensitive: false };
  const units = { permission_key: "finance.view", scope: "units", unit_ids: [ID], is_sensitive: true };

  it("calls only nexus.my_permissions()", async () => {
    const { client, rpc } = fakeClient({ data: [] });
    await readMyPermissions(client);
    expect(rpc).toHaveBeenCalledWith("my_permissions");
  });

  it("maps rows and accepts an empty list", async () => {
    expect(await readMyPermissions(fakeClient({ data: [] }).client)).toEqual({ ok: true, data: [] });
    expect(await readMyPermissions(fakeClient({ data: [all, units] }).client)).toEqual({
      ok: true,
      data: [
        { key: "inventory.view", scope: "all", unitIds: [], isSensitive: false },
        { key: "finance.view", scope: "units", unitIds: [ID], isSensitive: true },
      ],
    });
  });

  it.each([
    ["scope 'all' with unit ids", [{ ...all, unit_ids: [ID] }]],
    ["scope 'units' without unit ids", [{ ...units, unit_ids: [] }]],
    ["unknown scope", [{ ...all, scope: "some" }]],
    ["empty permission key", [{ ...all, permission_key: "" }]],
    ["unit id not a uuid", [{ ...units, unit_ids: ["x"] }]],
    ["is_sensitive missing", [{ ...all, is_sensitive: undefined }]],
    ["one good row and one bad row", [all, { ...all, scope: "x" }]],
    ["not an array", { permission_key: "x" }],
    ["null", null],
  ])("unexpected shape -> error, nothing granted (%s)", async (_label, data) => {
    expect(await readMyPermissions(fakeClient({ data }).client)).toEqual({ ok: false });
  });

  it("an RPC error is an error", async () => {
    expect(await readMyPermissions(fakeClient({ error: { code: "PGRST106" } }).client)).toEqual({ ok: false });
  });
});
