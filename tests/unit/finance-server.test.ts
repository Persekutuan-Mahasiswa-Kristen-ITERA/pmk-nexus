// Finance server layer (src/lib/picore/finance.ts, src/modules/finance/server/**): gates (finance keys have
// scope "all" only), input validation before any database call, RPC arguments (money travels as digits
// TEXT, never a number), answer mapping (no storage path leaves the server), the upload route (CSRF,
// manage-only, active period, one field, magic bytes, own folder, mixed-case boundary) and the export route
// (POST only, view + export, cut check, too_many_rows, summary block, integer money cells, CSV formula
// neutralisation). The Supabase client is faked; the real database is covered by the pgTAP tests.
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

import { mapFinanceDbError } from "@/lib/picore/finance";
import { addFinanceProof, getFinanceProofLink, recordFinanceEntry, voidFinanceEntry, withdrawFinanceProof } from "@/modules/finance/server/actions";
import { buildFinanceExportFile } from "@/modules/finance/server/export-file";
import { handleFinanceExport } from "@/modules/finance/server/export";
import { handleFinanceProofUpload } from "@/modules/finance/server/proofs";
import { getFinanceEntryDetail, getFinanceSummary, listFinanceEntries, listFinancePeriods } from "@/modules/finance/server/reads";
import type { FinanceListFilters } from "@/modules/finance/types";

// ---- Personas (spec section 2) ----

const MEMBER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const PERIOD = "44444444-4444-4444-8444-444444444444";
const KEY = "66666666-6666-4666-8666-666666666666";
const UPLOAD_PATH = `${MEMBER}/55555555-5555-4555-8555-555555555555.pdf`;

const all = (key: string): PermissionGrant => ({ key, scope: "all", unitIds: [], isSensitive: true });
const units = (key: string, ids: string[]): PermissionGrant => ({ key, scope: "units", unitIds: ids, isSensitive: true });

function member(permissions: PermissionGrant[], activePeriodId: string | null = PERIOD): AccessState {
  return {
    kind: "member",
    member: { memberId: MEMBER, fullName: "Tester", memberType: "student", isSystemAdmin: false, activePeriodId, activePeriodLabel: "2026/2027" },
    permissions,
  };
}

// Bendahara: role bendahara + bph -> view, manage, export. Ketua Umum: bph -> view, export.
const BENDAHARA = member([all("finance.view"), all("finance.manage"), all("finance.export")]);
const KETUM = member([all("finance.view"), all("finance.export")]);
const VIEW_ONLY = member([all("finance.view")]);
const EXPORT_ONLY = member([all("finance.export")]); // export without view (R15): nothing
const SCOPED = member([units("finance.view", ["x"]), units("finance.manage", ["x"])]); // a units grant is ignored
const ADMIN = member([]); // system admin without a finance rule (B18)
const NO_PERIOD = member([all("finance.view"), all("finance.manage"), all("finance.export")], null);

const ok = <T>(data: T) => ({ data, error: null });
const dbError = (code: string, hint: string, details: string | null = null) => ({ data: null, error: { code, hint, details, message: "x" } });

beforeEach(() => {
  fake.rpc.mockReset();
  fake.upload.mockReset();
  fake.createSignedUrl.mockReset();
  fake.buckets.length = 0;
  fake.rpcNames.length = 0;
  fake.state.current = BENDAHARA;
});

// ---- Fixtures (snake_case as the database returns them) ----

const summaryRow = {
  period_id: PERIOD,
  period_label: "2026/2027",
  is_active_period: true,
  starts_on: "2026-08-01",
  ends_on: "2027-07-31",
  opening_amount: 1000000,
  has_opening: true,
  opening_entry_id: ENTRY,
  income_total: 500000,
  expense_total: 200000,
  balance: 1300000,
  entry_count: 3,
  voided_count: 0,
  without_proof_count: 1,
  previous_period_id: null,
  previous_period_label: null,
  previous_closing_balance: null,
};

const listRow = {
  row_no: 1,
  entry_id: ENTRY,
  number_text: "KAS-0012",
  entry_type: "expense",
  entry_date: "2026-10-15",
  amount: 1250000,
  description: "Sewa gedung",
  status: "active",
  proof_count: 1,
  corrects_entry_id: null,
  corrects_number_text: null,
  period_id: PERIOD,
  period_label: "2026/2027",
  created_at: "2026-10-15T03:00:00Z",
  created_by_name: "Bendahara Satu",
  total_count: 1,
  page: 1,
  page_size: 20,
};

const detailJson = {
  entry_id: ENTRY,
  number_text: "KAS-0012",
  entry_type: "expense",
  amount: 1250000,
  entry_date: "2026-10-15",
  description: "Sewa gedung",
  notes: null,
  status: "active",
  void_reason: null,
  voided_at: null,
  voided_by_name: null,
  corrects: null,
  corrected_by: [],
  period_id: PERIOD,
  period_label: "2026/2027",
  is_active_period: true,
  created_at: "2026-10-15T03:00:00Z",
  created_by_name: "Bendahara Satu",
  proof_count: 1,
  files: [
    {
      file_id: 7,
      storage_path: UPLOAD_PATH,
      original_name: "nota.pdf",
      size_bytes: 1200,
      mime_type: "application/pdf",
      attached_at: "2026-10-15T03:01:00Z",
      attached_by_name: "Bendahara Satu",
      is_withdrawn: false,
      withdrawn_at: null,
      withdrawn_by_name: null,
      withdraw_reason: null,
    },
  ],
  history: [{ history_id: 1, at: "2026-10-15T03:00:00Z", kind: "recorded", actor_name: "Bendahara Satu", note: null, file_name: null }],
  actions: { can_void: true, can_add_proof: true, can_withdraw_proof: true, files_room: 2, can_correct: false, can_rerecord: false, can_export: true },
};

const exportRow = (n: number, description = "Beli spidol", extra: Record<string, unknown> = {}) => ({
  row_no: n,
  number_text: `KAS-${String(n).padStart(4, "0")}`,
  entry_date: "2026-10-15",
  entry_type: "expense",
  description,
  notes: null,
  amount: 250000,
  status: "active",
  void_reason: null,
  corrects_number_text: null,
  has_proof: false,
  created_by_name: "Bendahara Satu",
  created_at: "2026-10-15T03:00:00Z",
  period_label: "2026/2027",
  summary_opening: 1000000,
  summary_income: 500000,
  summary_expense: 1250000,
  summary_balance: -250000, // a negative balance on purpose (A-FN9)
  total_count: 2,
  ...extra,
});

// =============================================================================================
// Errors and gates
// =============================================================================================

describe("error mapping fails closed", () => {
  it("only the module's SQLSTATEs with a known hint map to a business code", () => {
    expect(mapFinanceDbError({ code: "P0001", hint: "opening_exists" })).toEqual({ code: "opening_exists" });
    expect(mapFinanceDbError({ code: "42501", hint: "permission_required" })).toEqual({ code: "forbidden" });
    // Wrong SQLSTATE, missing hint, unknown hint, prototype names: unavailable, never "no access".
    expect(mapFinanceDbError({ code: "PGRST301", hint: "permission_required" })).toEqual({ code: "unavailable" });
    expect(mapFinanceDbError({ code: "42501", hint: null })).toEqual({ code: "unavailable" });
    expect(mapFinanceDbError({ code: "P0001", hint: "constructor" })).toEqual({ code: "unavailable" });
    expect(mapFinanceDbError({})).toEqual({ code: "unavailable" });
  });

  it("Rp 0 copy depends on the action: a record error carries it through the action argument", () => {
    expect(mapFinanceDbError({ code: "22023", hint: "invalid_amount" }, "recordOpening")).toEqual({ code: "invalid_amount", field: "amount" });
  });
});

describe("reads: gate first, then one RPC; answers mapped", () => {
  it("every read refuses without finance.view and never calls the database", async () => {
    for (const persona of [ADMIN, EXPORT_ONLY, SCOPED, NO_PERIOD_VIEWLESS()]) {
      fake.state.current = persona;
      expect(await listFinanceEntries()).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await getFinanceSummary()).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await listFinancePeriods()).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await getFinanceEntryDetail(ENTRY)).toEqual({ ok: false, error: { code: "forbidden" } });
    }
    fake.state.current = { kind: "anonymous" };
    expect(await listFinanceEntries()).toEqual({ ok: false, error: { code: "unauthenticated" } });
    fake.state.current = { kind: "error" };
    expect(await listFinanceEntries()).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("a BPH member without manage reads; the summary keeps money as text", async () => {
    fake.state.current = KETUM;
    fake.rpc.mockResolvedValueOnce(ok([summaryRow]));
    const result = await getFinanceSummary();
    expect(result).toMatchObject({ ok: true, data: { openingAmount: "1000000", incomeTotal: "500000", expenseTotal: "200000", balance: "1300000", hasOpening: true } });
    expect(fake.rpc).toHaveBeenCalledWith("finance_summary", { p_period_id: null });
  });

  it("a negative balance and an unsafe amount: negative is text, an unsafe integer is unavailable", async () => {
    fake.rpc.mockResolvedValueOnce(ok([{ ...summaryRow, balance: -250000 }]));
    expect(await getFinanceSummary()).toMatchObject({ ok: true, data: { balance: "-250000" } });
    fake.rpc.mockResolvedValueOnce(ok([{ ...summaryRow, income_total: 2 ** 60 }]));
    expect(await getFinanceSummary()).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("listFinanceEntries sends the validated filters and maps a page", async () => {
    fake.rpc.mockResolvedValueOnce(ok([listRow]));
    const result = await listFinanceEntries({ filters: { search: "  sewa   gedung ", type: "expense", from: "2026-10-01", includeVoided: true }, page: 1 });
    expect(fake.rpc).toHaveBeenCalledWith("finance_entry_list", {
      p_period_id: null,
      p_search: "sewa gedung",
      p_type: "expense",
      p_from: "2026-10-01",
      p_to: null,
      p_include_voided: true,
      p_without_proof: false,
      p_page: 1,
      p_page_size: 20,
    });
    expect(result).toMatchObject({ ok: true, data: { total: 1, page: 1, pageCount: 1, rows: [{ numberText: "KAS-0012", amount: "1250000", entryType: "expense" }] } });
  });

  it("an empty answer is page 1 of 1; an odd shape or too many rows is unavailable", async () => {
    fake.rpc.mockResolvedValueOnce(ok([]));
    expect(await listFinanceEntries()).toMatchObject({ ok: true, data: { rows: [], total: 0, page: 1, pageCount: 1 } });
    fake.rpc.mockResolvedValueOnce(ok([{ ...listRow, amount: "12.5" }]));
    expect(await listFinanceEntries()).toEqual({ ok: false, error: { code: "unavailable" } });
    fake.rpc.mockResolvedValueOnce(ok([listRow, { ...listRow, row_no: 2, entry_id: KEY }].map((r) => ({ ...r, total_count: 2 }))));
    expect(await listFinanceEntries({ pageSize: 1 })).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("refuses a bad filter before the database: a page size above 50, a reversed range", async () => {
    expect(await listFinanceEntries({ pageSize: 51 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await listFinanceEntries({ filters: { from: "2026-10-10", to: "2026-10-01" } })).toEqual({
      ok: false,
      error: { code: "invalid_dates", field: "to" },
    });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("getFinanceEntryDetail: malformed id = not_found entry; the storage path never leaves the server", async () => {
    expect(await getFinanceEntryDetail("nope")).toEqual({ ok: false, error: { code: "not_found", entity: "entry" } });
    expect(fake.rpc).not.toHaveBeenCalled();
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    const result = await getFinanceEntryDetail(ENTRY);
    expect(result).toMatchObject({ ok: true, data: { numberText: "KAS-0012", amount: "1250000", files: [{ fileId: 7, name: "nota.pdf" }] } });
    expect(JSON.stringify(result)).not.toContain(MEMBER);
    expect(JSON.stringify(result)).not.toContain("storage");
  });

  it("an unknown entry answers not_found (database hint)", async () => {
    fake.rpc.mockResolvedValueOnce(dbError("P0002", "entry_not_found"));
    expect(await getFinanceEntryDetail(ENTRY)).toEqual({ ok: false, error: { code: "not_found", entity: "entry" } });
  });

  it("period options map their rows", async () => {
    fake.rpc.mockResolvedValueOnce(
      ok([{ period_id: PERIOD, period_label: "2026/2027", is_active: true, starts_on: null, ends_on: null, entry_count: 4 }]),
    );
    expect(await listFinancePeriods()).toEqual({
      ok: true,
      data: [{ periodId: PERIOD, periodLabel: "2026/2027", isActive: true, startsOn: null, endsOn: null, entryCount: 4 }],
    });
  });
});

/** finance.view absent but the period closed: still nothing (without a period the keys match nothing in the database). */
function NO_PERIOD_VIEWLESS(): AccessState {
  return member([], null);
}

// =============================================================================================
// Writes
// =============================================================================================

const record = (over: Record<string, unknown> = {}) => ({
  entryType: "expense" as const,
  entryDate: "2026-10-15",
  amount: "1250000",
  description: "  Sewa   gedung ",
  notes: "  catatan  ",
  files: [{ path: UPLOAD_PATH, name: "nota.pdf", extra: "ignored" }],
  submitKey: KEY,
  ...over,
});

describe("writes: manage gate, date check, then one RPC", () => {
  it("everyone without finance.manage is refused and nothing reaches the database", async () => {
    for (const persona of [KETUM, VIEW_ONLY, ADMIN, SCOPED]) {
      fake.state.current = persona;
      expect(await recordFinanceEntry(record())).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await voidFinanceEntry({ entryId: ENTRY, reason: "salah" })).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await addFinanceProof({ entryId: ENTRY, files: [{ path: UPLOAD_PATH, name: "a.pdf" }] })).toEqual({ ok: false, error: { code: "forbidden" } });
      expect(await withdrawFinanceProof({ fileId: 7, reason: "salah" })).toEqual({ ok: false, error: { code: "forbidden" } });
    }
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("no active period answers no_active_period (the keys also match nothing then)", async () => {
    fake.state.current = NO_PERIOD;
    expect((await recordFinanceEntry(record())).ok).toBe(false);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("a date after today (Jakarta) is refused before the RPC", async () => {
    const result = await recordFinanceEntry(record({ entryDate: "2999-01-01" }));
    expect(result).toEqual({ ok: false, error: { code: "date_in_future", field: "entryDate" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("sends the amount as digits TEXT, cleaned text, and only path + name of each file", async () => {
    fake.rpc.mockResolvedValueOnce(ok([{ entry_id: ENTRY, number_text: "KAS-0012", replayed: false }]));
    const result = await recordFinanceEntry(record());
    expect(result).toEqual({ ok: true, data: { entryId: ENTRY, numberText: "KAS-0012", replayed: false } });
    expect(fake.rpc).toHaveBeenCalledWith("finance_entry_record", {
      p_idempotency_key: KEY,
      p_entry_type: "expense",
      p_entry_date: "2026-10-15",
      p_amount: "1250000",
      p_description: "Sewa gedung",
      p_notes: "catatan",
      p_corrects_entry_id: null,
      p_files: [{ path: UPLOAD_PATH, name: "nota.pdf" }],
    });
    const args = fake.rpc.mock.calls[0][1] as { p_amount: unknown };
    expect(typeof args.p_amount).toBe("string");
  });

  it("a replayed save is a success (double tap / retry)", async () => {
    fake.rpc.mockResolvedValueOnce(ok([{ entry_id: ENTRY, number_text: "KAS-0012", replayed: true }]));
    expect(await recordFinanceEntry(record())).toMatchObject({ ok: true, data: { replayed: true } });
  });

  it("money rules: Rp 0 only for Saldo awal; decimals, signs, separators and 11 digits are refused", async () => {
    for (const amount of ["0", "007", "-5", "+5", "12.5", "1e3", "1.250.000", "", " "]) {
      expect(await recordFinanceEntry(record({ amount }))).toMatchObject({ ok: false, error: { code: "invalid_amount", field: "amount" } });
    }
    expect(await recordFinanceEntry(record({ amount: "10000000000" }))).toMatchObject({ ok: false, error: { code: "amount_too_large" } });
    expect(fake.rpc).not.toHaveBeenCalled();

    fake.rpc.mockResolvedValueOnce(ok([{ entry_id: ENTRY, number_text: "KAS-0001", replayed: false }]));
    const opening = await recordFinanceEntry(record({ entryType: "opening", amount: "0", description: "Saldo awal", files: [] }));
    expect(opening.ok).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("finance_entry_record", expect.objectContaining({ p_entry_type: "opening", p_amount: "0" }));
  });

  it("a Saldo awal is never a correction", async () => {
    const result = await recordFinanceEntry(record({ entryType: "opening", amount: "0", correctsEntryId: ENTRY }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_correction" } });
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("zod refusals keep the field; database refusals map through the hints", async () => {
    expect(await recordFinanceEntry(record({ description: "   " }))).toEqual({ ok: false, error: { code: "text_required", field: "description" } });
    expect(await recordFinanceEntry(record({ description: "x".repeat(201) }))).toEqual({ ok: false, error: { code: "text_too_long", field: "description" } });
    expect(await recordFinanceEntry(record({ submitKey: "nope" }))).toMatchObject({ ok: false, error: { code: "invalid_input", field: "submitKey" } });
    fake.rpc.mockResolvedValueOnce(dbError("P0001", "opening_exists"));
    expect(await recordFinanceEntry(record({ entryType: "opening", amount: "5" }))).toEqual({ ok: false, error: { code: "opening_exists" } });
    fake.rpc.mockResolvedValueOnce(dbError("22023", "idempotency_conflict"));
    expect(await recordFinanceEntry(record())).toEqual({ ok: false, error: { code: "idempotency_conflict" } });
    fake.rpc.mockResolvedValueOnce(dbError("XX000", "whatever"));
    expect(await recordFinanceEntry(record())).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  it("void needs a reason and only sends the id and the reason (no actor, no period)", async () => {
    expect(await voidFinanceEntry({ entryId: ENTRY, reason: "  " })).toEqual({ ok: false, error: { code: "reason_required", field: "reason" } });
    fake.rpc.mockResolvedValueOnce(ok([{ entry_id: ENTRY, status: "voided" }]));
    expect(await voidFinanceEntry({ entryId: ENTRY, reason: " salah  input " })).toEqual({ ok: true, data: { entryId: ENTRY, status: "voided" } });
    expect(fake.rpc).toHaveBeenCalledWith("finance_entry_void", { p_entry_id: ENTRY, p_reason: "salah input" });
    fake.rpc.mockResolvedValueOnce(dbError("42501", "closed_period"));
    expect(await voidFinanceEntry({ entryId: ENTRY, reason: "x" })).toEqual({ ok: false, error: { code: "closed_period" } });
    fake.rpc.mockResolvedValueOnce(dbError("P0001", "state_changed"));
    expect(await voidFinanceEntry({ entryId: ENTRY, reason: "x" })).toEqual({ ok: false, error: { code: "state_changed" } });
  });

  it("add proof needs 1..3 files; withdraw needs a reason", async () => {
    expect(await addFinanceProof({ entryId: ENTRY, files: [] })).toMatchObject({ ok: false, error: { code: "file_required" } });
    fake.rpc.mockResolvedValueOnce(ok([{ entry_id: ENTRY, proof_count: 2 }]));
    expect(await addFinanceProof({ entryId: ENTRY, files: [{ path: UPLOAD_PATH, name: "a.pdf" }] })).toEqual({ ok: true, data: { entryId: ENTRY, proofCount: 2 } });
    expect(fake.rpc).toHaveBeenCalledWith("finance_entry_add_proof", { p_entry_id: ENTRY, p_files: [{ path: UPLOAD_PATH, name: "a.pdf" }] });

    expect(await withdrawFinanceProof({ fileId: 7, reason: "" })).toEqual({ ok: false, error: { code: "reason_required", field: "reason" } });
    fake.rpc.mockResolvedValueOnce(ok([{ entry_id: ENTRY, proof_count: 1 }]));
    expect(await withdrawFinanceProof({ fileId: 7, reason: "Salah berkas" })).toMatchObject({ ok: true, data: { proofCount: 1 } });
    expect(fake.rpc).toHaveBeenLastCalledWith("finance_entry_withdraw_proof", { p_file_id: 7, p_reason: "Salah berkas" });
  });
});

describe("getFinanceProofLink", () => {
  it("signs only a proof the database listed for this caller, for 300 seconds", async () => {
    fake.state.current = KETUM;
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    fake.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "http://x/signed" }, error: null });
    const result = await getFinanceProofLink({ entryId: ENTRY, fileId: 7 });
    expect(result).toMatchObject({ ok: true, data: { fileId: 7, url: "http://x/signed" } });
    expect(fake.createSignedUrl).toHaveBeenCalledWith(UPLOAD_PATH, 300);
    expect(fake.buckets).toEqual(["nexus-finance-proofs"]);
  });

  it("a file id not in the detail, or a policy refusal, is not_found file", async () => {
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    expect(await getFinanceProofLink({ entryId: ENTRY, fileId: 8 })).toEqual({ ok: false, error: { code: "not_found", entity: "file" } });
    expect(fake.createSignedUrl).not.toHaveBeenCalled();
    fake.rpc.mockResolvedValueOnce(ok(detailJson));
    fake.createSignedUrl.mockResolvedValueOnce({ data: null, error: { status: 400, message: "Object not found" } });
    expect(await getFinanceProofLink({ entryId: ENTRY, fileId: 7 })).toEqual({ ok: false, error: { code: "not_found", entity: "file" } });
  });

  it("no finance.view = forbidden", async () => {
    fake.state.current = ADMIN;
    expect(await getFinanceProofLink({ entryId: ENTRY, fileId: 7 })).toEqual({ ok: false, error: { code: "forbidden" } });
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

const UPLOAD_URL = "http://localhost:3100/api/finance/proofs";
const EXPORT_URL = "http://localhost:3100/api/finance/export";
const upload = (parts: Parameters<typeof multipart>[0], origin?: string) =>
  post(UPLOAD_URL, multipart(parts), `multipart/form-data; boundary=${BOUNDARY}`, origin);
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("POST /api/finance/proofs", () => {
  beforeEach(() => {
    fake.upload.mockImplementation(async (path: string) => ({ data: { path }, error: null }));
  });

  it("a Treasurer uploads a PDF into their own folder under a random name (mixed-case boundary)", async () => {
    const res = await handleFinanceProofUpload(upload([{ name: "file", value: PDF, filename: "Nota‮fdp.exe", type: "application/pdf" }]), async () => BENDAHARA);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { path: string; name: string; mimeType: string };
    expect(body.path).toMatch(new RegExp(`^${MEMBER}/[0-9a-f-]{36}\\.pdf$`));
    expect(body.name).toBe("Notafdp.exe"); // bidi override removed
    expect(fake.upload).toHaveBeenCalledWith(body.path, expect.any(Uint8Array), expect.objectContaining({ upsert: false, contentType: "application/pdf" }));
    expect(fake.buckets).toEqual(["nexus-finance-proofs"]);
  });

  it("refuses cross-site, readers without manage, and no active period, before reading the body", async () => {
    const parts = [{ name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" }];
    expect((await handleFinanceProofUpload(upload(parts, "https://evil.example"), async () => BENDAHARA)).status).toBe(403);
    for (const persona of [KETUM, VIEW_ONLY, ADMIN]) {
      const res = await handleFinanceProofUpload(upload(parts), async () => persona);
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("forbidden");
    }
    expect((await handleFinanceProofUpload(upload(parts), async () => ({ kind: "anonymous" }))).status).toBe(401);
    // Without an active period the keys match nothing in the database, so the gate stops first.
    expect((await handleFinanceProofUpload(upload(parts), async () => NO_PERIOD)).status).toBeGreaterThanOrEqual(403);
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("refuses a declared type the bytes do not confirm, extra fields and two files", async () => {
    let res = await handleFinanceProofUpload(upload([{ name: "file", value: JPEG, filename: "a.pdf", type: "application/pdf" }]), async () => BENDAHARA);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_file");
    res = await handleFinanceProofUpload(upload([{ name: "file", value: PDF, filename: "a.pdf", type: "text/html" }]), async () => BENDAHARA);
    expect(await errorCode(res)).toBe("invalid_file");
    res = await handleFinanceProofUpload(
      upload([
        { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" },
        { name: "folder", value: "someone-else" },
      ]),
      async () => BENDAHARA,
    );
    expect(res.status).toBe(400);
    res = await handleFinanceProofUpload(
      upload([
        { name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" },
        { name: "file", value: PDF, filename: "b.pdf", type: "application/pdf" },
      ]),
      async () => BENDAHARA,
    );
    expect(res.status).toBe(400);
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("a body over the cap is file_too_large (413); a policy refusal is upload_limit (429)", async () => {
    const big = new Uint8Array(5_242_880 + 20_000);
    big.set(PDF);
    let res = await handleFinanceProofUpload(upload([{ name: "file", value: big, filename: "a.pdf", type: "application/pdf" }]), async () => BENDAHARA);
    expect(res.status).toBe(413);
    fake.upload.mockResolvedValueOnce({ data: null, error: { statusCode: "403", message: "new row violates row-level security policy" } });
    res = await handleFinanceProofUpload(upload([{ name: "file", value: PDF, filename: "a.pdf", type: "application/pdf" }]), async () => BENDAHARA);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "upload_limit", limit: 10 } });
  });

  it("other methods: 405", async () => {
    expect((await handleFinanceProofUpload(new Request(UPLOAD_URL, { method: "GET" }), async () => BENDAHARA)).status).toBe(405);
  });
});

describe("POST /api/finance/export", () => {
  const json = (body: unknown, origin?: string) => post(EXPORT_URL, JSON.stringify(body), "application/json", origin);

  it("a CSV export sends the filters, writes the summary block, integer money and neutralised text", async () => {
    fake.state.current = KETUM;
    fake.rpc.mockResolvedValueOnce(ok([exportRow(1, '=HYPERLINK("x")'), exportRow(2, "-5+3")]));
    const res = await handleFinanceExport(json({ format: "csv", filters: { type: "expense", search: "spidol" } }), async () => KETUM);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="finance-2026-2027-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(fake.rpc).toHaveBeenCalledWith("finance_export", {
      p_format: "csv",
      p_period_id: null,
      p_search: "spidol",
      p_type: "expense",
      p_from: null,
      p_to: null,
      p_include_voided: false,
      p_without_proof: false,
    });
    const text = await res.text();
    // Summary first, whole period; the negative balance is a plain integer, not a quoted formula.
    expect(text.indexOf("Total Saldo,-250000")).toBeGreaterThan(-1);
    expect(text).not.toContain("'-250000");
    expect(text.indexOf("Saldo awal,1000000")).toBeLessThan(text.indexOf("No,Nomor,Tanggal"));
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'-5+3");
    expect(text).toContain("KAS-0001,2026-10-15,Pengeluaran");
    expect(text).toContain(",250000,Aktif,");
    expect(text).not.toContain("1.250.000");
  });

  it("xlsx is a zip workbook with an integer amount format; pdf starts with %PDF-", async () => {
    fake.rpc.mockResolvedValueOnce(ok([exportRow(1), exportRow(2)]));
    let res = await handleFinanceExport(json({ format: "xlsx", filters: {} }), async () => BENDAHARA);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);

    fake.rpc.mockResolvedValueOnce(ok([exportRow(1), exportRow(2, "x".repeat(150), { status: "voided", void_reason: "Salah input" })]));
    res = await handleFinanceExport(json({ format: "pdf", filters: { includeVoided: true } }), async () => BENDAHARA);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  it("an empty result reads the summary once (no second log row) and still builds", async () => {
    fake.rpc.mockResolvedValueOnce(ok([]));
    fake.rpc.mockResolvedValueOnce(ok([summaryRow]));
    const res = await handleFinanceExport(json({ format: "csv", filters: {} }), async () => BENDAHARA);
    expect(res.status).toBe(200);
    expect(fake.rpcNames).toEqual(["finance_export", "finance_summary"]);
    const text = await res.text();
    expect(text).toContain("Total Saldo,1300000");
  });

  it("refuses without finance.export AND view, and cross-site, without calling the database", async () => {
    for (const persona of [VIEW_ONLY, EXPORT_ONLY, ADMIN, SCOPED]) {
      const res = await handleFinanceExport(json({ format: "csv", filters: {} }), async () => persona);
      expect(res.status).toBe(403);
    }
    expect((await handleFinanceExport(json({ format: "csv", filters: {} }, "https://evil.example"), async () => BENDAHARA)).status).toBe(403);
    expect((await handleFinanceExport(json({ format: "csv", filters: {} }), async () => ({ kind: "anonymous" }))).status).toBe(401);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("a cut answer and too_many_rows are export_too_large (422); a bad body is 400", async () => {
    fake.rpc.mockResolvedValueOnce(ok([exportRow(1, "x", { total_count: 1001 })]));
    let res = await handleFinanceExport(json({ format: "csv", filters: {} }), async () => BENDAHARA);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "export_too_large", rowCount: null } });
    fake.rpc.mockResolvedValueOnce(dbError("P0001", "too_many_rows", "1500"));
    res = await handleFinanceExport(json({ format: "csv", filters: {} }), async () => BENDAHARA);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "export_too_large", rowCount: 1500 } });
    res = await handleFinanceExport(json({ format: "docx", filters: {} }), async () => BENDAHARA);
    expect(res.status).toBe(400);
    res = await handleFinanceExport(json({ format: "csv", filters: { from: "2026-10-10", to: "2026-10-01" } }), async () => BENDAHARA);
    expect(res.status).toBe(400);
    res = await handleFinanceExport(post(EXPORT_URL, "format=csv", "text/plain"), async () => BENDAHARA);
    expect(res.status).toBe(400);
  });

  it("the form fallback (mixed-case multipart boundary) is read; flags need 1 or true; GET is 405", async () => {
    fake.rpc.mockResolvedValueOnce(ok([]));
    fake.rpc.mockResolvedValueOnce(ok([summaryRow]));
    const body = multipart([
      { name: "format", value: "csv" },
      { name: "type", value: "income" },
      { name: "includeVoided", value: "1" },
    ]);
    const res = await handleFinanceExport(post(EXPORT_URL, body, `multipart/form-data; boundary=${BOUNDARY}`), async () => BENDAHARA);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(fake.rpc).toHaveBeenCalledWith("finance_export", expect.objectContaining({ p_format: "csv", p_type: "income", p_include_voided: true }));

    const bad = multipart([{ name: "format", value: "csv" }, { name: "includeVoided", value: "yes" }]);
    expect((await handleFinanceExport(post(EXPORT_URL, bad, `multipart/form-data; boundary=${BOUNDARY}`), async () => BENDAHARA)).status).toBe(400);
    expect((await handleFinanceExport(new Request(EXPORT_URL, { method: "GET" }), async () => BENDAHARA)).status).toBe(405);
  });
});

describe("export file writers", () => {
  const filters: FinanceListFilters = {
    periodId: null,
    search: "=cmd",
    type: "all",
    from: null,
    to: null,
    includeVoided: false,
    withoutProof: false,
  };
  const summary = { opening: "0", income: "500000", expense: "750000", balance: "-250000" };
  const rows = [
    {
      rowNo: 1,
      numberText: "KAS-0001",
      entryDate: "2026-10-15",
      entryType: "expense" as const,
      description: "Beli spidol",
      notes: null,
      amount: "750000",
      status: "active" as const,
      voidReason: null,
      correctsNumberText: null,
      hasProof: true,
      createdByName: "Bendahara Satu",
      createdAt: "2026-10-15T17:30:00Z",
      periodLabel: "2026/2027",
    },
  ];

  it("csv: WIB time, Rp 0 opening is a plain 0, a search that starts with = is neutralised", async () => {
    const file = await buildFinanceExportFile("csv", rows, summary, filters, { periodLabel: "2026/2027", exportedAt: new Date("2026-10-15T17:30:00Z") });
    const text = new TextDecoder().decode(file.bytes);
    expect(file.fileName).toBe("finance-2026-2027-2026-10-16.csv"); // 00:30 WIB next day
    expect(text).toContain("Saldo awal,0\r\n");
    expect(text).toContain("2026-10-16 00:30 WIB");
    expect(text).toContain("Pencarian: =cmd"); // the whole line starts with "Filter", so it is safe as is
    expect(text).toContain(",Ada,2026/2027");
  });
});
