// Meeting Minutes server layer (src/lib/picore/minutes.ts, src/modules/minutes/server/**): gates with unit
// scopes, input validation before any database call, RPC arguments, answer mapping (no storage path
// leaves the server), the upload route (CSRF, manage-only, active period, one field, magic bytes, own
// folder, mixed-case boundary) and the export route (POST only, export scope, cut check, too_many_rows,
// CSV formula neutralisation, single-minute arguments). The Supabase client is faked; the real database
// is covered by the pgTAP tests and the manual smoke test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";

const fake = vi.hoisted(() => {
  const rpc = vi.fn();
  const upload = vi.fn();
  const createSignedUrl = vi.fn();
  const buckets: string[] = [];
  const rpcNames: string[] = [];
  const client = {
    schema: (name: string) => {
      if (name !== "nexus") throw new Error("wrong schema");
      return {
        rpc: (fn: string, args?: unknown) => {
          rpcNames.push(fn);
          return rpc(fn, args);
        },
      };
    },
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return { upload, createSignedUrl };
      },
    },
  };
  return { rpc, upload, createSignedUrl, buckets, rpcNames, client, state: { current: null as unknown } };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
vi.mock("@/lib/auth/session", () => ({ getAccessState: async () => fake.state.current }));

import { mapMinuteDbError } from "@/lib/picore/minutes";
import { addMinuteFiles, recordMinute, updateMinute, voidMinute, withdrawMinuteFile } from "@/modules/minutes/server/actions";
import { handleMinuteExport } from "@/modules/minutes/server/export";
import { getMinuteFileLink } from "@/modules/minutes/server/file-actions";
import { handleMinuteFileUpload } from "@/modules/minutes/server/files";
import { getMinuteDashboardCounts, getMinuteDetail, listMinutes, listMinuteUnits } from "@/modules/minutes/server/minutes";

// ---- Personas (seed: docs/modules/meeting-minutes.md section 2) ----

const MEMBER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const UNIT_A = "11111111-1111-4111-8111-111111111111";
const UNIT_B = "22222222-2222-4222-8222-222222222222";
const MINUTE = "33333333-3333-4333-8333-333333333333";
const PERIOD = "44444444-4444-4444-8444-444444444444";
const UPLOAD_PATH = `${MEMBER}/55555555-5555-4555-8555-555555555555.pdf`;

const all = (key: string): PermissionGrant => ({ key, scope: "all", unitIds: [], isSensitive: false });
const units = (key: string, ids: string[]): PermissionGrant => ({ key, scope: "units", unitIds: ids, isSensitive: false });

function member(permissions: PermissionGrant[], activePeriodId: string | null = PERIOD): AccessState {
  return {
    kind: "member",
    member: { memberId: MEMBER, fullName: "Tester", memberType: "student", isSystemAdmin: false, activePeriodId, activePeriodLabel: "2026/2027" },
    permissions,
  };
}

const SEKJEN = member([all("minutes.view"), all("minutes.manage"), all("minutes.export")]);
const SEKDEP = member([units("minutes.view", [UNIT_A]), units("minutes.manage", [UNIT_A]), units("minutes.export", [UNIT_A])]);
const KADEP = member([units("minutes.view", [UNIT_A])]);
const KETUM = member([all("minutes.view"), all("minutes.export")]);
const REGULAR = member([]);

const ok = <T>(data: T) => ({ data, error: null });
const dbError = (code: string, hint: string, details: string | null = null) => ({ data: null, error: { code, hint, details, message: "x" } });

beforeEach(() => {
  fake.rpc.mockReset();
  fake.upload.mockReset();
  fake.createSignedUrl.mockReset();
  fake.buckets.length = 0;
  fake.rpcNames.length = 0;
  fake.state.current = SEKJEN;
});

// ---- Fixtures ----

const listRow = {
  row_no: 1,
  minute_id: MINUTE,
  org_unit_id: UNIT_A,
  unit_name: "Departemen Internal",
  unit_type: "department",
  meeting_date: "2026-10-17",
  title: "Rapat evaluasi",
  topic: "Evaluasi",
  status: "active",
  period_id: PERIOD,
  period_label: "2026/2027",
  file_count: 1,
  created_at: "2026-10-17T05:00:00+00:00",
  version: 2,
  total_count: 1,
  page: 1,
  page_size: 20,
};

const detailJson = {
  minute_id: MINUTE,
  org_unit_id: UNIT_A,
  unit_name: "Departemen Internal",
  unit_type: "department",
  meeting_date: "2026-10-17",
  title: "Rapat evaluasi",
  topic: "Evaluasi",
  content: "Baris 1\nBaris 2",
  decision: null,
  status: "active",
  void_reason: null,
  voided_at: null,
  voided_by_name: null,
  period_id: PERIOD,
  period_label: "2026/2027",
  is_active_period: true,
  created_at: "2026-10-17T05:00:00+00:00",
  created_by_name: "Sekjen",
  updated_at: "2026-10-18T05:00:00+00:00",
  updated_by_name: "Sekjen",
  version: 3,
  file_count: 1,
  files: [
    {
      file_id: 7,
      storage_path: UPLOAD_PATH,
      original_name: "notulen.pdf",
      size_bytes: 1234,
      mime_type: "application/pdf",
      attached_at: "2026-10-17T05:00:00+00:00",
      attached_by_name: "Sekjen",
      is_withdrawn: false,
      withdrawn_at: null,
      withdrawn_by_name: null,
      withdraw_reason: null,
    },
  ],
  history: [
    {
      history_id: 3,
      at: "2026-10-18T05:00:00+00:00",
      kind: "edited",
      actor_name: "Sekjen",
      before: { title: "Rapat lama", decision: null, constructor: 1 },
      after: { title: "Rapat evaluasi", decision: "Lanjut", unknown_key: "x" },
      note: null,
      file_name: null,
    },
    { history_id: 2, at: "2026-10-17T05:00:00+00:00", kind: "file_added", actor_name: "Sekjen", before: null, after: null, note: null, file_name: "notulen.pdf" },
    { history_id: 1, at: "2026-10-17T05:00:00+00:00", kind: "recorded", actor_name: "Sekjen", before: null, after: null, note: null, file_name: null },
  ],
  actions: { can_edit: true, can_void: true, can_add_files: true, can_withdraw_files: true, files_room: 2, can_export: true },
};

const exportRow = (n: number, title = "Rapat") => ({
  row_no: n,
  minute_id: MINUTE,
  meeting_date: "2026-10-17",
  unit_name: "PMK ITERA",
  unit_type: "organization",
  title,
  topic: "Topik",
  content: "Isi\nbaris dua",
  decision: null,
  status: n === 2 ? "voided" : "active",
  void_reason: n === 2 ? "Salah unit" : null,
  period_label: "2026/2027",
  created_by_name: "Sekjen",
  created_at: "2026-10-17T05:00:00+00:00",
  file_count: 0,
  total_count: 2,
});

const recordInput = (unitId: string, meetingDate = "2026-10-17") => ({
  unitId,
  meetingDate,
  title: "  Rapat   evaluasi ",
  topic: "Evaluasi",
  content: "Isi\r\nbaris",
  decision: "   ",
  files: [{ path: UPLOAD_PATH, name: "notulen.pdf", extra: "dropped" }],
});

// =============================================================================================

describe("error mapping fails closed", () => {
  it("only the module's SQLSTATEs with a known hint map to a business code", () => {
    expect(mapMinuteDbError({ code: "42501", hint: "unit_not_allowed" })).toEqual({ code: "unit_not_allowed" });
    expect(mapMinuteDbError({ code: "P0001", hint: "too_many_rows", details: "1500" })).toEqual({ code: "export_too_large", rowCount: 1500 });
    expect(mapMinuteDbError({ code: "22023", hint: "text_required", details: "title" })).toEqual({ code: "text_required", field: "title" });
    expect(mapMinuteDbError({ code: "42501", hint: undefined })).toEqual({ code: "unavailable" }); // missing grant
    expect(mapMinuteDbError({ code: "PGRST202", hint: "minute_not_found" })).toEqual({ code: "unavailable" });
    expect(mapMinuteDbError({ code: "P0001", hint: "constructor" })).toEqual({ code: "unavailable" });
  });
});

describe("reads: gate first, then one RPC; answers mapped", () => {
  it("listMinutes refuses without minutes.view and never calls the database", async () => {
    fake.state.current = REGULAR;
    expect(await listMinutes()).toEqual({ ok: false, error: { code: "forbidden" } });
    fake.state.current = { kind: "anonymous" };
    expect(await listMinutes()).toEqual({ ok: false, error: { code: "unauthenticated" } });
    fake.state.current = { kind: "error" };
    expect(await listMinutes()).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("listMinutes sends validated filters (unit lowercased) and maps a page", async () => {
    fake.state.current = KADEP;
    fake.rpc.mockResolvedValueOnce(ok([listRow]));
    const result = await listMinutes({ filters: { search: "  rapat  ", unitId: UNIT_A.toUpperCase() } });
    expect(fake.rpc).toHaveBeenCalledWith("minute_list", {
      p_search: "rapat",
      p_unit_id: UNIT_A,
      p_period: "active",
      p_status: "active",
      p_page: 1,
      p_page_size: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ total: 1, page: 1, pageCount: 1, filters: { unitId: UNIT_A } });
      expect(result.data.rows[0]).toMatchObject({ minuteId: MINUTE, unitId: UNIT_A, unitType: "department", fileCount: 1 });
    }
  });

  it("an empty answer is page 1 of 1; an odd shape is unavailable", async () => {
    fake.rpc.mockResolvedValueOnce(ok([]));
    expect(await listMinutes()).toMatchObject({ ok: true, data: { rows: [], total: 0, page: 1, pageCount: 1 } });
    fake.rpc.mockResolvedValueOnce(ok([{ ...listRow, status: "draft" }]));
    expect(await listMinutes()).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("a page size above 50 is refused before the database", async () => {
    expect(await listMinutes({ pageSize: 51 })).toEqual({ ok: false, error: { code: "invalid_input", field: "pageSize" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("getMinuteDetail: malformed id = not_found minute; the storage path never leaves the server", async () => {
    expect(await getMinuteDetail("../etc")).toEqual({ ok: false, error: { code: "not_found", entity: "minute" } });
    expect(fake.rpc).not.toHaveBeenCalled();

    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    const result = await getMinuteDetail(MINUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.data)).not.toContain(UPLOAD_PATH);
    expect(result.data.files[0]).toEqual(expect.objectContaining({ fileId: 7, name: "notulen.pdf" }));
    expect(result.data.history[0].changes).toEqual([
      { field: "title", before: "Rapat lama", after: "Rapat evaluasi" },
      { field: "decision", before: null, after: "Lanjut" },
    ]);
    expect(result.data.history[1].fileName).toBe("notulen.pdf");
    expect(result.data.actions).toEqual({ canEdit: true, canVoid: true, canAddFiles: true, canWithdrawFiles: true, filesRoom: 2, canExport: true });
  });

  it("a minute outside the scope answers not_found (database hint)", async () => {
    fake.rpc.mockResolvedValueOnce(dbError("P0002", "minute_not_found"));
    expect(await getMinuteDetail(MINUTE)).toEqual({ ok: false, error: { code: "not_found", entity: "minute" } });
  });

  it("unit options and dashboard counts map their rows", async () => {
    fake.rpc.mockResolvedValueOnce(
      ok([{ unit_id: UNIT_A, unit_name: "Dept", unit_type: "department", sort_order: 3, is_active: true, can_read: true, can_record: false }]),
    );
    expect(await listMinuteUnits()).toEqual({
      ok: true,
      data: [{ unitId: UNIT_A, unitName: "Dept", unitType: "department", isActive: true, canRead: true, canRecord: false }],
    });
    fake.rpc.mockResolvedValueOnce(
      ok([{ period_id: null, period_label: null, period_starts_on: null, period_ends_on: null, minute_count: 0, latest_meeting_date: null }]),
    );
    expect(await getMinuteDashboardCounts()).toMatchObject({ ok: true, data: { periodId: null, minuteCount: 0 } });
  });
});

describe("writes: manage gate, unit scope, date check, then one RPC", () => {
  it("readers without minutes.manage are refused (Kepala Departemen, Ketua Umum, regular)", async () => {
    for (const persona of [KADEP, KETUM, REGULAR]) {
      fake.state.current = persona;
      expect(await recordMinute(recordInput(UNIT_A))).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await voidMinute({ minuteId: MINUTE, version: 1, reason: "x" })).toEqual({ ok: false, error: { code: "forbidden" } });
    }
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("a department secretary cannot record for another unit (server check, no RPC)", async () => {
    fake.state.current = SEKDEP;
    expect(await recordMinute(recordInput(UNIT_B))).toEqual({ ok: false, error: { code: "unit_not_allowed" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("a meeting date after today (Jakarta) is refused before the RPC", async () => {
    const result = await recordMinute(recordInput(UNIT_A, "2999-01-01"));
    expect(result).toEqual({ ok: false, error: { code: "date_in_future", field: "meetingDate" } });
    const edit = await updateMinute({ minuteId: MINUTE, version: 1, meetingDate: "2999-01-01", title: "a", topic: "b", content: "c" });
    expect(edit).toEqual({ ok: false, error: { code: "date_in_future", field: "meetingDate" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("no active period answers no_active_period", async () => {
    fake.state.current = member([all("minutes.manage"), all("minutes.view")], null);
    expect(await recordMinute(recordInput(UNIT_A))).toEqual({ ok: false, error: { code: "no_active_period" } });
  });

  it("own unit: cleaned values and only path + name of each file are sent", async () => {
    fake.state.current = SEKDEP;
    fake.rpc.mockResolvedValueOnce(ok([{ minute_id: MINUTE, version: 1 }]));
    const result = await recordMinute(recordInput(UNIT_A.toUpperCase()));
    expect(result).toEqual({ ok: true, data: { minuteId: MINUTE, version: 1 } });
    expect(fake.rpc).toHaveBeenCalledWith("minute_record", {
      p_org_unit_id: UNIT_A,
      p_meeting_date: "2026-10-17",
      p_title: "Rapat evaluasi",
      p_topic: "Evaluasi",
      p_content: "Isi\nbaris",
      p_decision: null,
      p_files: [{ path: UPLOAD_PATH, name: "notulen.pdf" }],
    });
  });

  it("zod refusals keep the field; database refusals map through the hints", async () => {
    expect(await recordMinute({ ...recordInput(UNIT_A), title: "   " })).toEqual({ ok: false, error: { code: "text_required", field: "title" } });
    expect(await addMinuteFiles({ minuteId: MINUTE, version: 1, files: [] })).toEqual({
      ok: false,
      error: { code: "file_required", field: "files", count: 1 },
    });
    fake.rpc.mockResolvedValueOnce(dbError("P0001", "state_changed"));
    expect(await withdrawMinuteFile({ fileId: 7, version: 1, reason: "salah berkas" })).toEqual({ ok: false, error: { code: "state_changed" } });
    expect(fake.rpc).toHaveBeenCalledWith("minute_withdraw_file", { p_file_id: 7, p_version: 1, p_reason: "salah berkas" });
    fake.rpc.mockResolvedValueOnce(dbError("42501", "closed_period"));
    expect(await voidMinute({ minuteId: MINUTE, version: 1, reason: "dobel" })).toEqual({ ok: false, error: { code: "closed_period" } });
  });
});

describe("getMinuteFileLink", () => {
  it("signs only a file the database listed for this caller, for 300 seconds", async () => {
    fake.state.current = KADEP;
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    fake.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "http://x/signed" }, error: null });
    const result = await getMinuteFileLink({ minuteId: MINUTE, fileId: 7 });
    expect(result).toMatchObject({ ok: true, data: { fileId: 7, url: "http://x/signed" } });
    expect(fake.createSignedUrl).toHaveBeenCalledWith(UPLOAD_PATH, 300);
    expect(fake.buckets).toEqual(["nexus-minute-files"]);
  });

  it("a file id not in the detail (e.g. withdrawn, non-manager) is not_found file; a policy refusal too", async () => {
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    expect(await getMinuteFileLink({ minuteId: MINUTE, fileId: 8 })).toEqual({ ok: false, error: { code: "not_found", entity: "file" } });
    expect(fake.createSignedUrl).not.toHaveBeenCalled();
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    fake.createSignedUrl.mockResolvedValueOnce({ data: null, error: { status: 400, message: "Object not found" } });
    expect(await getMinuteFileLink({ minuteId: MINUTE, fileId: 7 })).toEqual({ ok: false, error: { code: "not_found", entity: "file" } });
  });

  it("no minutes.view = forbidden", async () => {
    fake.state.current = REGULAR;
    expect(await getMinuteFileLink({ minuteId: MINUTE, fileId: 7 })).toEqual({ ok: false, error: { code: "forbidden" } });
  });
});

// =============================================================================================
// Route handlers
// =============================================================================================

const BOUNDARY = "----WebKitFormBoundaryAbC123xYz";
const PDF = new TextEncoder().encode("%PDF-1.4\n%test\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

function multipart(parts: { name: string; value: string | Uint8Array; filename?: string; type?: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    let head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename) head += `; filename="${p.filename}"`;
    head += "\r\n";
    if (p.type) head += `Content-Type: ${p.type}\r\n`;
    head += "\r\n";
    chunks.push(enc.encode(head), typeof p.value === "string" ? enc.encode(p.value) : p.value, enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${BOUNDARY}--\r\n`));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function post(url: string, body: BodyInit | Uint8Array, contentType: string, origin = "http://localhost:3100"): Request {
  return new Request(url, {
    method: "POST",
    headers: { origin, host: "localhost:3100", "sec-fetch-site": "same-origin", "content-type": contentType },
    body: body as BodyInit,
  });
}

const UPLOAD_URL = "http://localhost:3100/api/minutes/files";
const EXPORT_URL = "http://localhost:3100/api/minutes/export";
const upload = (parts: Parameters<typeof multipart>[0], origin?: string) =>
  post(UPLOAD_URL, multipart(parts), `multipart/form-data; boundary=${BOUNDARY}`, origin);
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("POST /api/minutes/files", () => {
  beforeEach(() => {
    fake.upload.mockImplementation(async (path: string) => ({ data: { path }, error: null }));
  });

  it("a manager (own unit) uploads a PDF into their own folder under a random name (mixed-case boundary)", async () => {
    const res = await handleMinuteFileUpload(upload([{ name: "file", value: PDF, filename: "Notulen‮fdp.exe", type: "application/pdf" }]), async () => SEKDEP);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { path: string; name: string; mimeType: string };
    expect(body.path).toMatch(new RegExp(`^${MEMBER}/[0-9a-f-]{36}\\.pdf$`));
    expect(body.name).toBe("Notulenfdp.exe"); // bidi override removed
    expect(fake.upload).toHaveBeenCalledWith(body.path, expect.any(Uint8Array), expect.objectContaining({ upsert: false, contentType: "application/pdf" }));
    expect(fake.buckets).toEqual(["nexus-minute-files"]);
  });

  it("refuses cross-site, readers without manage, and no active period, before reading the body", async () => {
    const parts = [{ name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" }];
    expect((await handleMinuteFileUpload(upload(parts, "https://evil.example"), async () => SEKJEN)).status).toBe(403);
    for (const persona of [KADEP, KETUM, REGULAR]) {
      const res = await handleMinuteFileUpload(upload(parts), async () => persona);
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("forbidden");
    }
    const res = await handleMinuteFileUpload(upload(parts), async () => ({ kind: "anonymous" }));
    expect(res.status).toBe(401);
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("refuses a declared type the bytes do not confirm, extra fields and two files", async () => {
    let res = await handleMinuteFileUpload(upload([{ name: "file", value: JPEG, filename: "a.pdf", type: "application/pdf" }]), async () => SEKJEN);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_file");
    res = await handleMinuteFileUpload(upload([{ name: "file", value: PDF, filename: "a.pdf", type: "text/html" }]), async () => SEKJEN);
    expect(await errorCode(res)).toBe("invalid_file");
    res = await handleMinuteFileUpload(
      upload([
        { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" },
        { name: "folder", value: "someone-else" },
      ]),
      async () => SEKJEN,
    );
    expect(res.status).toBe(400);
    res = await handleMinuteFileUpload(
      upload([
        { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" },
        { name: "file", value: PDF, filename: "b.pdf", type: "application/pdf" },
      ]),
      async () => SEKJEN,
    );
    expect(res.status).toBe(400);
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("a body over the cap is file_too_large (413); a policy refusal is upload_limit (429)", async () => {
    const big = new Uint8Array(5_242_880 + 20_000);
    big.set(PDF);
    let res = await handleMinuteFileUpload(upload([{ name: "file", value: big, filename: "a.pdf", type: "application/pdf" }]), async () => SEKJEN);
    expect(res.status).toBe(413);
    fake.upload.mockResolvedValueOnce({ data: null, error: { statusCode: "403", message: "new row violates row-level security policy" } });
    res = await handleMinuteFileUpload(upload([{ name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" }]), async () => SEKJEN);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "upload_limit", limit: 10 } });
  });

  it("other methods: 405", async () => {
    const res = await handleMinuteFileUpload(new Request(UPLOAD_URL, { method: "GET" }), async () => SEKJEN);
    expect(res.status).toBe(405);
  });
});

describe("POST /api/minutes/export", () => {
  const json = (body: unknown, origin?: string) => post(EXPORT_URL, JSON.stringify(body), "application/json", origin);

  it("a list export sends the filters, writes the CSV with formulas neutralized and no-store", async () => {
    fake.rpc.mockResolvedValueOnce(ok([exportRow(1, "=HYPERLINK(\"x\")"), exportRow(2)]));
    const res = await handleMinuteExport(json({ kind: "list", format: "csv", filters: { status: "all", unitId: null, search: null } }), async () => KETUM);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="notulensi-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(fake.rpc).toHaveBeenCalledWith("minute_export", { p_format: "csv", p_search: null, p_unit_id: null, p_period: "active", p_status: "all" });
    const text = await res.text();
    expect(text).toContain("No,Tanggal rapat,Unit,Judul rapat");
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("Seluruh organisasi");
    expect(text).toContain("Dibatalkan");
    expect(text).toContain("Salah unit");
  });

  it("a single export sends only the format and the minute id; the file name has the meeting date", async () => {
    fake.rpc.mockResolvedValueOnce(ok([{ ...exportRow(1), total_count: 1 }]));
    const res = await handleMinuteExport(json({ kind: "single", format: "pdf", minuteId: MINUTE }), async () => SEKDEP);
    expect(res.status).toBe(200);
    expect(fake.rpc).toHaveBeenCalledWith("minute_export", { p_format: "pdf", p_minute_id: MINUTE });
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="notulensi-rapat-2026-10-17.pdf"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("pdf with no rows and with several rows (voided, long text) builds", async () => {
    fake.rpc.mockResolvedValueOnce(ok([]));
    let res = await handleMinuteExport(json({ kind: "list", format: "pdf", filters: { period: "all", status: "all" } }), async () => SEKDEP);
    expect(res.status, await res.clone().text()).toBe(200);
    const long = { ...exportRow(1), content: "Paragraf panjang. ".repeat(600) + "\n\nPenutup\ttab", total_count: 3 };
    fake.rpc.mockResolvedValueOnce(ok([long, { ...exportRow(2), total_count: 3 }, { ...exportRow(3), unit_name: null, unit_type: null, total_count: 3 }]));
    res = await handleMinuteExport(json({ kind: "list", format: "pdf", filters: { unitId: UNIT_A } }), async () => SEKJEN);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  it("xlsx is a zip workbook", async () => {
    fake.rpc.mockResolvedValueOnce(ok([exportRow(1), exportRow(2)]));
    const res = await handleMinuteExport(json({ kind: "list", format: "xlsx", filters: {} }), async () => SEKJEN);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("refuses without minutes.export (Kepala Departemen holds view only) and cross-site", async () => {
    let res = await handleMinuteExport(json({ kind: "list", format: "csv", filters: {} }), async () => KADEP);
    expect(res.status).toBe(403);
    res = await handleMinuteExport(json({ kind: "list", format: "csv", filters: {} }), async () => REGULAR);
    expect(res.status).toBe(403);
    res = await handleMinuteExport(json({ kind: "list", format: "csv", filters: {} }, "https://evil.example"), async () => SEKJEN);
    expect(res.status).toBe(403);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("a cut answer and too_many_rows are export_too_large (422); a bad body is 400", async () => {
    fake.rpc.mockResolvedValueOnce(ok([{ ...exportRow(1), total_count: 1001 }]));
    let res = await handleMinuteExport(json({ kind: "list", format: "csv", filters: {} }), async () => SEKJEN);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "export_too_large", rowCount: null } });
    fake.rpc.mockResolvedValueOnce(dbError("P0001", "too_many_rows", "1500"));
    res = await handleMinuteExport(json({ kind: "list", format: "csv", filters: {} }), async () => SEKJEN);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "export_too_large", rowCount: 1500 } });
    res = await handleMinuteExport(json({ kind: "list", format: "docx", filters: {} }), async () => SEKJEN);
    expect(res.status).toBe(400);
    res = await handleMinuteExport(json({ kind: "single", format: "csv", minuteId: "nope" }), async () => SEKJEN);
    expect(res.status).toBe(400);
  });

  it("the form fallback (mixed-case multipart boundary) is read; GET is 405", async () => {
    fake.rpc.mockResolvedValueOnce(ok([]));
    const body = multipart([
      { name: "kind", value: "list" },
      { name: "format", value: "csv" },
      { name: "period", value: "all" },
    ]);
    const res = await handleMinuteExport(post(EXPORT_URL, body, `multipart/form-data; boundary=${BOUNDARY}`), async () => SEKJEN);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(fake.rpc).toHaveBeenCalledWith("minute_export", { p_format: "csv", p_search: null, p_unit_id: null, p_period: "all", p_status: "active" });
    expect((await handleMinuteExport(new Request(EXPORT_URL, { method: "GET" }), async () => SEKJEN)).status).toBe(405);
  });
});
