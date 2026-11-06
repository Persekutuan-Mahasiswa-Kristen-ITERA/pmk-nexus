// POST /api/member-data/export handler with a mocked Supabase client (spec F5; MD-02, MD-10, MD-29, MD-31 (call side), MD-35).
// Real database behaviour (log row, permission inside the function) is covered by the E2E spec and the pgTAP file.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";

const rpc = vi.fn();
const schema = vi.fn(() => ({ rpc }));
const createClient = vi.fn(async () => ({ schema }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("@/lib/auth/session", () => ({ getAccessState: vi.fn() }));

import { handleMemberDataExport, isSameOriginRequest } from "@/modules/member-data/server/export";

const URL_ = "http://localhost:3100/api/member-data/export";
const UNIT = "11111111-2222-3333-4444-555555555555";

const grant = (key: string): PermissionGrant => ({ key, scope: "all", unitIds: [], isSensitive: true });
const memberState = (keys: string[], isSystemAdmin = false): AccessState => ({
  kind: "member",
  member: { memberId: "m-1", fullName: "Tester", memberType: "student", isSystemAdmin, activePeriodId: "p-1", activePeriodLabel: "2026/2027" },
  permissions: keys.map(grant),
});
const BPH = memberState(["member_data.view", "member_data.export", "member_data.view_export_log"]);
const KADEP = memberState(["member_data.view"]);

type Init = { method?: string; headers?: Record<string, string>; body?: string | FormData | null };
function req(fields: Record<string, string> | null, init: Init = {}): Request {
  const headers: Record<string, string> = {
    origin: "http://localhost:3100",
    host: "localhost:3100",
    "sec-fetch-site": "same-origin",
    "content-type": "application/x-www-form-urlencoded",
    ...init.headers,
  };
  const body = init.body !== undefined ? init.body : fields ? new URLSearchParams(fields).toString() : null;
  if (body instanceof FormData) delete headers["content-type"]; // boundary is set by the runtime
  return new Request(URL_, { method: init.method ?? "POST", headers, body });
}

// Extra columns on purpose: a database that returned more than the contract must not leak through.
const dbRows = [
  { row_no: 1, member_id: "11111111-1111-1111-1111-111111111111", full_name: "Alfa", member_type: "student", is_active: true, unit_name: "Logistik", parent_unit_name: "Departemen Operasional", position_name: "Staff", email: "alfa@nexus.test", phone: "08123456789", nim: "123451001", nip: "1980", user_id: "uuid-x", access_level: "admin" },
  { row_no: 2, member_id: "22222222-2222-2222-2222-222222222222", full_name: "Dosen", member_type: "lecturer", is_active: true, unit_name: null, parent_unit_name: null, position_name: null, email: "dosen@nexus.test" },
];

const call = (r: Request, state: AccessState | (() => Promise<AccessState>) = BPH) =>
  handleMemberDataExport(r, typeof state === "function" ? state : async () => state);

beforeEach(() => {
  rpc.mockReset();
  schema.mockClear();
  createClient.mockClear();
  rpc.mockResolvedValue({ data: dbRows, error: null });
});
afterEach(() => vi.useRealTimers());

async function errorBody(res: Response) {
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return (await res.json()) as { error: { code: string; field?: string } };
}

describe("method and cross-site guards (run before anything else)", () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    it(`${method} -> 405 with Allow: POST; no session read, no database call`, async () => {
      const readState = vi.fn(async () => BPH);
      const res = await handleMemberDataExport(new Request(URL_, { method }), readState);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(readState).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("missing Origin -> 403 (a form POST from our page always sends it)", async () => {
    const r = new Request(URL_, { method: "POST", headers: { host: "localhost:3100", "content-type": "application/x-www-form-urlencoded" }, body: "format=csv" });
    const res = await call(r);
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.code).toBe("forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("Origin 'null', another site, another port, another scheme-less value -> 403", async () => {
    for (const origin of ["null", "https://evil.example", "http://localhost:3000", "http://localhost.evil.example:3100", "localhost:3100", "not a url", "file://"]) {
      const res = await call(req({ format: "csv" }, { headers: { origin } }));
      expect(res.status, origin).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("Sec-Fetch-Site cross-site / same-site / none -> 403 even when Origin matches", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await call(req({ format: "csv" }, { headers: { "sec-fetch-site": site } }));
      expect(res.status, site).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("behind a proxy, x-forwarded-host decides (Vercel); a mismatch with it is refused", async () => {
    const ok = req({ format: "csv" }, { headers: { origin: "https://nexus.example", host: "internal:3000", "x-forwarded-host": "nexus.example" } });
    expect(isSameOriginRequest(ok)).toBe(true);
    const bad = req({ format: "csv" }, { headers: { origin: "https://nexus.example", host: "nexus.example", "x-forwarded-host": "other.example" } });
    expect(isSameOriginRequest(bad)).toBe(false);
  });
  it("host comparison is case-insensitive", () => {
    expect(isSameOriginRequest(req({}, { headers: { origin: "http://LOCALHOST:3100" } }))).toBe(true);
  });
  it("a refused cross-site request does not even read the session", async () => {
    const readState = vi.fn(async () => BPH);
    await handleMemberDataExport(req({ format: "csv" }, { headers: { origin: "https://evil.example" } }), readState);
    expect(readState).not.toHaveBeenCalled();
  });
});

describe("session and permission (MD-02, MD-03, MD-05, MD-06)", () => {
  const cases: [string, AccessState, number, string][] = [
    ["anonymous", { kind: "anonymous" }, 401, "unauthenticated"],
    ["session check error (fail closed)", { kind: "error" }, 503, "unavailable"],
    ["no access (inactive / unlinked)", { kind: "no_access" }, 403, "forbidden"],
    ["temporary password pending", { kind: "password_pending" }, 403, "forbidden"],
    ["Kepala Departemen (view only)", KADEP, 403, "forbidden"],
    ["System Admin without positions", memberState([], true), 403, "forbidden"],
    ["regular member", memberState([]), 403, "forbidden"],
    ["export key without view key", memberState(["member_data.export"]), 403, "forbidden"],
    ["export key with units scope", { ...memberState([]), permissions: [{ key: "member_data.view", scope: "all", unitIds: [], isSensitive: true }, { key: "member_data.export", scope: "units", unitIds: ["u"], isSensitive: true }] } as AccessState, 403, "forbidden"],
  ];
  for (const [label, state, status, code] of cases) {
    it(`${label} -> ${status} ${code}; no database call, no client created`, async () => {
      const res = await call(req({ format: "csv" }), state);
      expect(res.status).toBe(status);
      expect((await errorBody(res)).error.code).toBe(code);
      expect(rpc).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    });
  }
  it("permission is checked BEFORE the body: a denied caller with a bad body learns nothing about validation", async () => {
    const res = await call(req({ format: "docx", status: "zzz" }), KADEP);
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error).toEqual({ code: "forbidden" });
  });
  it("a throwing session reader -> 503 (not a crash, not a 200)", async () => {
    const res = await call(req({ format: "csv" }), async () => {
      throw new Error("boom");
    });
    expect(res.status).toBe(503);
    expect((await errorBody(res)).error.code).toBe("unavailable");
  });
  it("a failing client factory -> 503", async () => {
    createClient.mockRejectedValueOnce(new Error("no cookies"));
    const res = await call(req({ format: "csv" }));
    expect(res.status).toBe(503);
  });
});

describe("body validation is strict: 400 with the field (and no database call)", () => {
  const bad: [string, Record<string, string> | null, Init, string][] = [
    ["missing format", { status: "all" }, {}, "format"],
    ["unknown format", { format: "docx" }, {}, "format"],
    ["uppercase format", { format: "CSV" }, {}, "format"],
    ["bad status", { format: "csv", status: "Aktif" }, {}, "status"],
    ["bad unit id", { format: "csv", unit: "not-a-guid" }, {}, "unitId"],
    ["unit id with SQL", { format: "csv", unit: "1' or '1'='1" }, {}, "unitId"],
    ["121-character search", { format: "csv", q: "a".repeat(121) }, {}, "search"],
    ["481-character raw search", { format: "csv", q: " ".repeat(481) }, {}, "search"],
    ["JSON body", null, { headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "csv" }) }, "request"],
    ["no content-type", null, { headers: { "content-type": "" }, body: "format=csv" }, "request"],
    ["text/plain body", null, { headers: { "content-type": "text/plain" }, body: "format=csv" }, "request"],
    ["oversize content-length", null, { headers: { "content-length": String(9 * 1024) }, body: "format=csv" }, "request"],
    ["repeated format field", null, { body: "format=csv&format=pdf" }, "format"],
    ["repeated status field", null, { body: "format=csv&status=all&status=inactive" }, "status"],
  ];
  for (const [label, fields, init, field] of bad) {
    it(`${label} -> 400 invalid_input ${field}`, async () => {
      const res = await call(req(fields, init));
      expect(res.status).toBe(400);
      expect((await errorBody(res)).error).toEqual({ code: "invalid_input", field });
      expect(rpc).not.toHaveBeenCalled();
    });
  }
  it("a file upload in a text field -> 400", async () => {
    const form = new FormData();
    form.set("format", new Blob(["csv"], { type: "text/plain" }), "x.txt");
    const res = await call(req(null, { body: form }));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toEqual({ code: "invalid_input", field: "format" });
  });
  it("an unknown parameter such as pageSize is ignored, not forwarded (export has no paging)", async () => {
    const res = await call(req(null, { body: "format=csv&pageSize=5000&email=a@b.c" }));
    expect(res.status).toBe(200);
    expect(rpc.mock.calls[0][1]).toEqual({ p_format: "csv", p_search: null, p_unit_id: null, p_status: "active" });
  });
});

describe("success: exactly one RPC with exact arguments (MD-31 call side)", () => {
  it("calls schema('nexus').rpc('member_data_export') once with the validated filters", async () => {
    const res = await call(req({ format: "xlsx", q: "  Bulk   Anggota 11 ", unit: UNIT, status: "all" }));
    expect(res.status).toBe(200);
    expect(schema).toHaveBeenCalledTimes(1);
    expect(schema).toHaveBeenCalledWith("nexus");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("member_data_export", { p_format: "xlsx", p_search: "Bulk Anggota 11", p_unit_id: UNIT, p_status: "all" });
  });
  it("defaults: status active, no search, no unit; empty q and unit are 'none'", async () => {
    await call(req({ format: "csv", q: "", unit: "" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("member_data_export", { p_format: "csv", p_search: null, p_unit_id: null, p_status: "active" });
  });
  it("whitespace-only q is no search (not a 400)", async () => {
    await call(req({ format: "csv", q: "    " }));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_search: null });
  });
  it("multipart/form-data body works too", async () => {
    const form = new FormData();
    form.set("format", "pdf");
    form.set("status", "inactive");
    const res = await call(req(null, { body: form }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("member_data_export", { p_format: "pdf", p_search: null, p_unit_id: null, p_status: "inactive" });
  });
  it("the three formats: content type, attachment name, no-store, correct length", async () => {
    const types = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8", pdf: "application/pdf" } as const;
    for (const format of ["xlsx", "csv", "pdf"] as const) {
      const res = await call(req({ format }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(types[format]);
      expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="data-anggota-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`));
      expect(res.headers.get("cache-control")).toBe("no-store");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Number(res.headers.get("content-length"))).toBe(bytes.byteLength);
      expect(bytes.byteLength).toBeGreaterThan(50);
    }
  });
  it("file name date is the Asia/Jakarta date at 17:00Z rollover", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T17:00:00Z"));
    const res = await call(req({ format: "csv" }));
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="data-anggota-2026-11-07.csv"');
    vi.setSystemTime(new Date("2026-11-06T16:59:00Z"));
    const before = await call(req({ format: "csv" }));
    expect(before.headers.get("content-disposition")).toBe('attachment; filename="data-anggota-2026-11-06.csv"');
  });
  it("CSV body: header row plus one line per database row; extra columns (email, phone, nim, nip...) are stripped (MD-10)", async () => {
    const res = await call(req({ format: "csv" }));
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    expect(text.startsWith("﻿")).toBe(true);
    const lines = text.replace("﻿", "").trim().split("\r\n");
    expect(lines).toEqual([
      "No,Nama Lengkap,Pembina,Unit,Jabatan,Status",
      "1,Alfa,,Departemen Operasional · Logistik,Staff,Aktif",
      "2,Dosen,Ya,-,-,Aktif",
    ]);
    for (const secret of ["alfa@nexus.test", "dosen@nexus.test", "08123456789", "123451001", "1980", "uuid-x", "admin", "@nexus.test"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
  it("the xlsx and pdf bytes contain none of the stripped values either", async () => {
    for (const format of ["xlsx", "pdf"]) {
      const res = await call(req({ format }));
      const raw = Buffer.from(await res.arrayBuffer()).toString("latin1");
      expect(raw).not.toContain("08123456789");
      expect(raw).not.toContain("alfa@nexus.test");
    }
  });
  it("zero matching rows still returns a file (header only)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await call(req({ format: "csv" }));
    expect(res.status).toBe(200);
  });
});

describe("database failures: fail closed, codes only (MD-35, A-MD12)", () => {
  it("permission_required from the database -> 403 (rights changed meanwhile), no file", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", hint: "permission_required", message: "x" } });
    const res = await call(req({ format: "csv" }));
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error).toEqual({ code: "forbidden" });
  });
  it("a known input hint -> 400 with the field", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", hint: "invalid_unit", message: "x" } });
    const res = await call(req({ format: "csv" }));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toEqual({ code: "invalid_input", field: "unitId" });
  });
  it("log write failure / any other error -> 503 'unavailable' and NO database text in the answer", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", hint: "export_log_direct_insert", message: "relation nexus.member_data_export_logs secret-detail", details: "stack-trace-here" } });
    const res = await call(req({ format: "csv" }));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toBe('{"error":{"code":"unavailable"}}');
    expect(text).not.toMatch(/member_data_export_logs|secret|stack/);
  });
  it("a thrown exception from the client -> 503", async () => {
    rpc.mockRejectedValue(new Error("connection reset"));
    const res = await call(req({ format: "csv" }));
    expect(res.status).toBe(503);
  });
  it("an answer of the wrong shape -> 503, never a partial file", async () => {
    rpc.mockResolvedValue({ data: [{ row_no: "one", full_name: 5 }], error: null });
    expect((await call(req({ format: "csv" }))).status).toBe(503);
    rpc.mockResolvedValue({ data: { not: "an array" }, error: null });
    expect((await call(req({ format: "csv" }))).status).toBe(503);
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await call(req({ format: "csv" }))).status).toBe(503);
  });
  it("is never retried: one RPC call even when it fails (the call writes a log row)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await call(req({ format: "csv" }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
