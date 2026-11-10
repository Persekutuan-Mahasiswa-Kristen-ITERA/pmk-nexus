// Finance contract (src/modules/finance/types.ts): money parsing and formatting, the Rp 0 opening rule,
// record/void/proof schemas, database answer parsing, hint mapping, copy and the capability matrix.
// Expected values come from docs/modules/finance.md (4.2, 7, 11 FN-08/FN-08a, K1-K6, A-FN1) and
// supabase/README.md 3.4, not from the code.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";
import {
  checkRupiahAmount,
  financeCapabilities,
  financeCorrectionPrefill,
  financeEntryDetailDbSchema,
  financeEntryListDbSchema,
  financeErrorFromDb,
  financeErrorFromZod,
  financeErrorMessage,
  financeErrorStatus,
  financeExportDbSchema,
  financeExportFileName,
  financeListFiltersSchema,
  financeRecordSchema,
  financeRerecordPath,
  financeRerecordPrefill,
  financeSummaryDbSchema,
  financeVoidSchema,
  formatEntryAmount,
  formatRupiah,
  groupRupiahDigits,
  isOutsideFinancePeriod,
  jakartaToday,
  normaliseRupiahInput,
  openingAmountFromPrevious,
  rupiahInputDisplay,
  rupiahToSafeInteger,
  buildFinancePage,
  FINANCE_DB_HINTS,
  FINANCE_ERROR_COPY,
  type FinanceEntryDetail,
  type FinanceErrorCode,
} from "@/modules/finance/types";

const ID = "11111111-2222-3333-4444-555555555555";
const ID2 = "aaaaaaaa-2222-3333-4444-555555555555";
const MEMBER = "bbbbbbbb-2222-3333-4444-555555555555";
const KEY = "cccccccc-2222-3333-4444-555555555555";
const PATH = `${MEMBER}/dddddddd-2222-3333-4444-555555555555.jpg`;

/** The contract error of an input that MUST fail (asserts the failure, so no check passes vacuously). */
function zodError(schema: z.ZodType, input: unknown) {
  const r = schema.safeParse(input);
  expect(r.success).toBe(false);
  return r.success ? null : financeErrorFromZod(r.error);
}

describe("checkRupiahAmount mirrors finance_entry_record (FN-08, owner 2026-11-10)", () => {
  it("accepts 1..9999999999 for income and expense, 0..9999999999 for Saldo awal", () => {
    for (const type of ["income", "expense", "opening"] as const) {
      expect(checkRupiahAmount("1", type)).toBe("ok");
      expect(checkRupiahAmount("1250000", type)).toBe("ok");
      expect(checkRupiahAmount("9999999999", type)).toBe("ok");
    }
    expect(checkRupiahAmount("0", "opening")).toBe("ok");
  });
  it("refuses Rp 0 for income and expense", () => {
    expect(checkRupiahAmount("0", "income")).toBe("invalid_amount");
    expect(checkRupiahAmount("0", "expense")).toBe("invalid_amount");
  });
  it("10.000.000.000 and longer are too large for every type", () => {
    for (const type of ["income", "expense", "opening"] as const) {
      expect(checkRupiahAmount("10000000000", type)).toBe("amount_too_large");
      expect(checkRupiahAmount("99999999999999999999999999", type)).toBe("amount_too_large");
    }
  });
  it("refuses everything that is not plain digits, for every type (also Saldo awal)", () => {
    const bad = ["", " ", "00", "007", "-0", "+0", "0.0", "-5", "+5", "12.5", "1e3", "1.000", "1,000", "1 000",
      " 5", "5 ", "abc", "١٢٣", "１２３", "Rp 5", "0000000000000"];
    for (const type of ["income", "expense", "opening"] as const) {
      for (const value of bad) expect(checkRupiahAmount(value, type), `${type} ${JSON.stringify(value)}`).toBe("invalid_amount");
    }
    expect(checkRupiahAmount(5, "income")).toBe("invalid_amount"); // a JS number is never accepted
    expect(checkRupiahAmount(null, "opening")).toBe("invalid_amount");
  });
});

describe("formatting is string based (spec 4.2)", () => {
  it("groups thousands with dots", () => {
    expect(groupRupiahDigits("0")).toBe("0");
    expect(groupRupiahDigits("999")).toBe("999");
    expect(groupRupiahDigits("1000")).toBe("1.000");
    expect(groupRupiahDigits("1234567")).toBe("1.234.567");
    expect(groupRupiahDigits("9999999999")).toBe("9.999.999.999");
    expect(groupRupiahDigits("10000000000")).toBe("10.000.000.000");
    expect(() => groupRupiahDigits("12.5")).toThrow(RangeError);
  });
  it("formatRupiah: Rp prefix, minus before Rp, zero without sign", () => {
    expect(formatRupiah("1234567")).toBe("Rp 1.234.567");
    expect(formatRupiah("0")).toBe("Rp 0");
    expect(formatRupiah("-250000")).toBe("-Rp 250.000");
    expect(formatRupiah(BigInt("9999999999"))).toBe("Rp 9.999.999.999");
    // Beyond 2^53: still exact, because nothing goes through a float.
    expect(formatRupiah("90071992547409931")).toBe("Rp 90.071.992.547.409.931");
    for (const bad of ["-0", "007", "1.5", "", "Rp 1"]) expect(() => formatRupiah(bad)).toThrow(RangeError);
  });
  it("formatEntryAmount: + income, - expense, no sign for Saldo awal (also Rp 0)", () => {
    expect(formatEntryAmount("income", "4500000")).toBe("+Rp 4.500.000");
    expect(formatEntryAmount("expense", "1250000")).toBe("-Rp 1.250.000");
    expect(formatEntryAmount("opening", "0")).toBe("Rp 0");
    expect(formatEntryAmount("opening", "500000")).toBe("Rp 500.000");
  });
});

describe("normaliseRupiahInput: only dots in thousands positions are removed", () => {
  it("removes grouping dots and an Rp prefix", () => {
    expect(normaliseRupiahInput("1.234.567")).toBe("1234567");
    expect(normaliseRupiahInput("Rp 1.234.567")).toBe("1234567");
    expect(normaliseRupiahInput("rp1.000")).toBe("1000");
    expect(normaliseRupiahInput(" 9.999.999.999 ")).toBe("9999999999");
    expect(normaliseRupiahInput("10.000.000.000")).toBe("10000000000");
    expect(normaliseRupiahInput("0")).toBe("0");
  });
  it("leaves anything ambiguous unchanged so the schema refuses it", () => {
    for (const raw of ["12.5", "1.00", "1,5", "1.234,50", "-5", "1e3", "abc", "1.2345"]) {
      const out = normaliseRupiahInput(raw);
      expect(out).toBe(raw);
      expect(checkRupiahAmount(out, "opening")).toBe("invalid_amount");
    }
    expect(normaliseRupiahInput("007")).toBe("007"); // kept, then refused (no silent change)
    expect(checkRupiahAmount(normaliseRupiahInput("0.000"), "opening")).toBe("invalid_amount");
  });
  it("round trip: what the field shows normalises to the digits typed", () => {
    for (const digits of ["1", "0", "1000", "1234567", "9999999999"]) {
      expect(normaliseRupiahInput(rupiahInputDisplay(digits))).toBe(digits);
    }
  });
});

describe("rupiahInputDisplay: dots while typing, never a silently different number", () => {
  it("regroups digits, drops leading zeros, keeps a single 0", () => {
    expect(rupiahInputDisplay("")).toBe("");
    expect(rupiahInputDisplay("0")).toBe("0");
    expect(rupiahInputDisplay("05")).toBe("5");
    expect(rupiahInputDisplay("1.2345")).toBe("12.345");
    expect(rupiahInputDisplay("Rp 1234567")).toBe("1.234.567");
  });
  it("caps at 13 digits (enough to show the too-large error)", () => {
    expect(rupiahInputDisplay("12345678901234567")).toBe("1.234.567.890.123");
  });
  it("returns comma, minus or letters unchanged", () => {
    expect(rupiahInputDisplay("1.234,50")).toBe("1.234,50");
    expect(rupiahInputDisplay("-5")).toBe("-5");
    expect(rupiahInputDisplay("5a")).toBe("5a");
  });
});

describe("rupiahToSafeInteger (export writers only)", () => {
  it("is exact within the safe range and refuses beyond it", () => {
    expect(rupiahToSafeInteger("9999999999")).toBe(9_999_999_999);
    expect(rupiahToSafeInteger("-250000")).toBe(-250_000);
    expect(rupiahToSafeInteger("0")).toBe(0);
    expect(() => rupiahToSafeInteger("9007199254740993")).toThrow(RangeError);
    expect(() => rupiahToSafeInteger("1.5")).toThrow(RangeError);
  });
});

const recordBase = {
  entryDate: "2026-11-10",
  description: "  Persembahan   ibadah  ",
  notes: "baris 1\r\nbaris 2\n",
  submitKey: KEY,
};

describe("financeRecordSchema (F2, F3, F5)", () => {
  it("income and expense keep the amount as text; text is cleaned like the database", () => {
    const r = financeRecordSchema.safeParse({ ...recordBase, entryType: "income", amount: "1250000" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.amount).toBe("1250000");
    expect(typeof r.data.amount).toBe("string");
    expect(r.data.description).toBe("Persembahan ibadah");
    expect(r.data.notes).toBe("baris 1\nbaris 2");
    expect(r.data.files).toEqual([]);
    expect(r.data.correctsEntryId).toBeNull();
  });
  it("Saldo awal accepts Rp 0; income and expense refuse it (invalid_amount on amount)", () => {
    expect(financeRecordSchema.safeParse({ ...recordBase, entryType: "opening", amount: "0" }).success).toBe(true);
    for (const entryType of ["income", "expense"] as const) {
      expect(zodError(financeRecordSchema, { ...recordBase, entryType, amount: "0" })).toEqual({ code: "invalid_amount", field: "amount" });
    }
  });
  it("9.999.999.999 passes, 10.000.000.000 is amount_too_large", () => {
    expect(financeRecordSchema.safeParse({ ...recordBase, entryType: "expense", amount: "9999999999" }).success).toBe(true);
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "opening", amount: "10000000000" })).toEqual({ code: "amount_too_large", field: "amount" });
  });
  it("refuses a number, a formatted value and odd digit strings", () => {
    for (const amount of [1250000, "1.250.000", "00", "007", "-0", "+0", "0.0", "12.5"]) {
      expect(zodError(financeRecordSchema, { ...recordBase, entryType: "opening", amount })?.code, JSON.stringify(amount)).toBe(
        "invalid_amount",
      );
    }
  });
  it("the first issue follows the form order (date before amount before Keterangan)", () => {
    const all = { ...recordBase, entryType: "income", entryDate: "", amount: "0", description: "" };
    expect(zodError(financeRecordSchema, all)).toEqual({ code: "date_required", field: "entryDate" });
    expect(zodError(financeRecordSchema, { ...all, entryDate: "2026-11-10" })).toEqual({ code: "invalid_amount", field: "amount" });
  });
  it("Keterangan required and at most 200 code points; Catatan 500", () => {
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "income", amount: "1", description: "   " })).toEqual({ code: "text_required", field: "description" });
    expect(financeRecordSchema.safeParse({ ...recordBase, entryType: "income", amount: "1", description: "😀".repeat(200) }).success).toBe(true);
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "income", amount: "1", description: "a".repeat(201) })).toEqual({ code: "text_too_long", field: "description" });
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "income", amount: "1", notes: "a".repeat(501) })).toEqual({ code: "text_too_long", field: "notes" });
  });
  it("submit key is required (double-save guard) and must be a uuid", () => {
    const { submitKey: _omit, ...noKey } = recordBase;
    void _omit;
    expect(zodError(financeRecordSchema, { ...noKey, entryType: "income", amount: "1" })).toEqual({ code: "invalid_input", field: "submitKey" });
    expect(financeRecordSchema.safeParse({ ...recordBase, entryType: "income", amount: "1", submitKey: "abc" }).success).toBe(false);
  });
  it("a correction link is allowed on income/expense, never on Saldo awal", () => {
    const ok = financeRecordSchema.safeParse({ ...recordBase, entryType: "expense", amount: "5", correctsEntryId: ID });
    expect(ok.success && ok.data.correctsEntryId).toBe(ID);
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "opening", amount: "5", correctsEntryId: ID })).toEqual({ code: "invalid_correction", field: "correctsEntryId" });
  });
  it("unknown entry type is invalid_input on entryType; future dates are left to the server", () => {
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "transfer", amount: "1" })).toEqual({ code: "invalid_input", field: "entryType" });
    expect(financeRecordSchema.safeParse({ ...recordBase, entryType: "income", amount: "1", entryDate: "2999-01-01" }).success).toBe(true);
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "income", amount: "1", entryDate: "1999-12-31" })).toEqual({ code: "invalid_dates", field: "entryDate" });
  });
  it("files: up to 3, each path once", () => {
    const file = { path: PATH, name: "nota.jpg" };
    const four = [0, 1, 2, 3].map((i) => ({ path: `${MEMBER}/dddddddd-2222-3333-4444-55555555555${i}.jpg`, name: "n.jpg" }));
    expect(zodError(financeRecordSchema, { ...recordBase, entryType: "income", amount: "1", files: four })).toEqual({ code: "file_count", field: "files", count: 3 });
    const dup = financeRecordSchema.safeParse({ ...recordBase, entryType: "income", amount: "1", files: [file, file] });
    expect(dup.success).toBe(false);
  });
});

describe("void and filters", () => {
  it("void needs a reason", () => {
    expect(zodError(financeVoidSchema, { entryId: ID, reason: "  " })).toEqual({ code: "reason_required", field: "reason" });
  });
  it("filters: defaults, either end of the range, end not before start", () => {
    const d = financeListFiltersSchema.parse({});
    expect(d).toEqual({ periodId: null, search: null, type: "all", from: null, to: null, includeVoided: false, withoutProof: false });
    expect(financeListFiltersSchema.safeParse({ from: "2026-01-01" }).success).toBe(true);
    expect(zodError(financeListFiltersSchema, { from: "2026-02-01", to: "2026-01-01" })).toEqual({ code: "invalid_dates", field: "to" });
    expect(zodError(financeListFiltersSchema, { search: "a".repeat(121) })).toEqual({ code: "invalid_input", field: "search" });
  });
});

describe("database answers: bigint as exact text, fail closed on odd shapes", () => {
  const summaryRow = {
    period_id: ID, period_label: "2026/2027", is_active_period: true, starts_on: "2026-08-01", ends_on: null,
    opening_amount: 0, has_opening: true, opening_entry_id: ID2, income_total: 9999999999, expense_total: 20000000000,
    balance: -10000000001, entry_count: 3, voided_count: 0, without_proof_count: 1,
    previous_period_id: null, previous_period_label: null, previous_closing_balance: null,
  };
  it("summary turns numbers into text (Rp 0 opening counts as recorded)", () => {
    const s = financeSummaryDbSchema.parse([summaryRow]);
    expect(s.openingAmount).toBe("0");
    expect(s.hasOpening).toBe(true);
    expect(s.incomeTotal).toBe("9999999999");
    expect(s.balance).toBe("-10000000001");
    expect(formatRupiah(s.balance)).toBe("-Rp 10.000.000.001");
  });
  it("refuses unsafe or fractional numbers and zero or two rows", () => {
    expect(financeSummaryDbSchema.safeParse([{ ...summaryRow, income_total: 1.5 }]).success).toBe(false);
    expect(financeSummaryDbSchema.safeParse([{ ...summaryRow, income_total: 2 ** 53 }]).success).toBe(false);
    expect(financeSummaryDbSchema.safeParse([{ ...summaryRow, opening_amount: 10000000000 }]).success).toBe(false);
    expect(financeSummaryDbSchema.safeParse([]).success).toBe(false);
    expect(financeSummaryDbSchema.safeParse([summaryRow, summaryRow]).success).toBe(false);
  });
  it("list: paging columns, empty answer", () => {
    expect(buildFinancePage(financeEntryListDbSchema.parse([]), 20)).toEqual({ rows: [], total: 0, page: 1, pageSize: 20, pageCount: 1 });
  });
  it("detail keeps storage paths out of the public detail", () => {
    const answer = financeEntryDetailDbSchema.parse({
      entry_id: ID, number_text: "KAS-0007", entry_type: "expense", amount: 1250000, entry_date: "2026-10-12",
      description: "Kabel", notes: null, status: "active", void_reason: null, voided_at: null, voided_by_name: null,
      corrects: null, corrected_by: [], period_id: ID2, period_label: "2025/2026", is_active_period: false,
      created_at: "2026-10-12T03:00:00+00:00", created_by_name: "Bendahara", proof_count: 1,
      files: [{ file_id: 4, storage_path: PATH, original_name: "nota.jpg", size_bytes: 1000, mime_type: "image/jpeg",
        attached_at: "2026-10-12T03:00:00+00:00", attached_by_name: "Bendahara", is_withdrawn: false,
        withdrawn_at: null, withdrawn_by_name: null, withdraw_reason: null }],
      history: [], actions: { can_void: false, can_add_proof: false, can_withdraw_proof: false, files_room: 0,
        can_correct: true, can_rerecord: false, can_export: true },
    });
    expect(answer.detail.amount).toBe("1250000");
    expect(JSON.stringify(answer.detail)).not.toContain(PATH);
    expect(answer.proofPaths).toEqual([{ fileId: 4, storagePath: PATH, isWithdrawn: false }]);
    const prefill = financeCorrectionPrefill(answer.detail);
    expect(prefill).toEqual({
      entryType: "income", entryDate: null, amount: "1250000", description: "Koreksi KAS-0007: ",
      notes: null, correctsEntryId: ID, correctsNumberText: "KAS-0007",
    });
    expect(financeRerecordPrefill(answer.detail)).toBeNull();
  });
  it("export: one summary for all rows; rows that disagree are refused", () => {
    const row = {
      row_no: 1, number_text: "KAS-0001", entry_date: "2026-10-01", entry_type: "opening", description: "Saldo awal",
      notes: null, amount: 0, status: "active", void_reason: null, corrects_number_text: null, has_proof: false,
      created_by_name: null, created_at: "2026-10-01T00:00:00+00:00", period_label: "2026/2027",
      summary_opening: 0, summary_income: 500000, summary_expense: 700000, summary_balance: -200000, total_count: 2,
    };
    const a = financeExportDbSchema.parse([row, { ...row, row_no: 2 }]);
    expect(a.summary).toEqual({ opening: "0", income: "500000", expense: "700000", balance: "-200000" });
    expect(a.totalCount).toBe(2);
    expect(financeExportDbSchema.parse([]).summary).toBeNull();
    expect(financeExportDbSchema.safeParse([row, { ...row, summary_balance: 1 }]).success).toBe(false);
    expect(financeExportDbSchema.safeParse([row, row, row]).success).toBe(false); // more rows than counted
  });
});

describe("hint mapping (supabase/README.md 3.4)", () => {
  it("every documented hint is mapped; bug guards and unknown hints are unavailable", () => {
    const expected: Record<string, FinanceErrorCode> = {
      permission_required: "forbidden", not_active_member: "forbidden", closed_period: "closed_period",
      immutable_column: "unavailable", export_log_direct_insert: "unavailable", append_only: "unavailable",
      entry_not_found: "not_found", file_not_found: "not_found", no_active_period: "no_active_period",
      state_changed: "state_changed", entry_voided: "entry_voided", opening_exists: "opening_exists",
      file_missing: "file_missing", too_many_rows: "export_too_large", invalid_type: "invalid_input",
      invalid_amount: "invalid_amount", amount_too_large: "amount_too_large", invalid_input: "invalid_input",
      invalid_correction: "invalid_correction", idempotency_conflict: "idempotency_conflict",
      text_required: "text_required", text_too_long: "text_too_long", reason_required: "reason_required",
      date_required: "date_required", date_in_future: "date_in_future", invalid_dates: "invalid_dates",
      invalid_file: "invalid_file", file_too_large: "file_too_large", file_required: "file_required",
      file_count: "file_count", file_already_attached: "file_already_attached", invalid_period: "invalid_input",
      search_too_long: "invalid_input", invalid_page: "invalid_input", invalid_page_size: "invalid_input",
      invalid_format: "invalid_input",
    };
    expect(FINANCE_DB_HINTS).toEqual(expected);
    for (const hint of ["bucket_conflict", "storage_policy_unscoped", "constructor", "toString", "", null, undefined]) {
      expect(financeErrorFromDb(hint, null)).toEqual({ code: "unavailable" });
    }
  });
  it("payloads and fields", () => {
    expect(financeErrorFromDb("invalid_amount", "amount", "recordOpening")).toEqual({ code: "invalid_amount", field: "amount" });
    expect(financeErrorFromDb("text_too_long", "description", "record")).toEqual({ code: "text_too_long", field: "description" });
    expect(financeErrorFromDb("invalid_input", "idempotency_key", "record")).toEqual({ code: "invalid_input", field: "submitKey" });
    expect(financeErrorFromDb("date_in_future", "entry_date", "record")).toEqual({ code: "date_in_future", field: "entryDate" });
    expect(financeErrorFromDb("invalid_dates", null, "read")).toEqual({ code: "invalid_dates", field: "to" });
    expect(financeErrorFromDb("invalid_type", null, "record")).toEqual({ code: "invalid_input", field: "entryType" });
    expect(financeErrorFromDb("invalid_type", null, "read")).toEqual({ code: "invalid_input", field: "type" });
    expect(financeErrorFromDb("entry_not_found", null)).toEqual({ code: "not_found", entity: "entry" });
    expect(financeErrorFromDb("file_not_found", null)).toEqual({ code: "not_found", entity: "file" });
    expect(financeErrorFromDb("file_count", "2", "addProof")).toEqual({ code: "file_count", field: "files", count: 2 });
    expect(financeErrorFromDb("file_missing", PATH, "record")).toEqual({ code: "file_missing", field: "files", ref: PATH });
    expect(financeErrorFromDb("invalid_file", "../etc/passwd", "record")).toEqual({ code: "invalid_file", field: "files", ref: null });
    expect(financeErrorFromDb("too_many_rows", "1001", "export")).toEqual({ code: "export_too_large", rowCount: 1001 });
  });
  it("HTTP status", () => {
    expect(financeErrorStatus({ code: "unauthenticated" })).toBe(401);
    expect(financeErrorStatus({ code: "closed_period" })).toBe(403);
    expect(financeErrorStatus({ code: "invalid_amount", field: "amount" })).toBe(400);
    expect(financeErrorStatus({ code: "opening_exists" })).toBe(409);
    expect(financeErrorStatus({ code: "export_too_large", rowCount: null })).toBe(422);
    expect(financeErrorStatus({ code: "unavailable" })).toBe(503);
  });
});

describe("copy (spec 7, tech lead 2026-11-10)", () => {
  it("amount texts depend on the form", () => {
    const e = { code: "invalid_amount", field: "amount" } as const;
    expect(financeErrorMessage(e, "record")).toBe("Isi jumlah dengan angka bulat, minimal Rp 1.");
    expect(financeErrorMessage(e, "recordOpening")).toBe("Isi jumlah dengan angka bulat, 0 atau lebih.");
    expect(financeErrorMessage({ code: "amount_too_large", field: "amount" }, "recordOpening")).toBe(
      "Jumlah terlalu besar (maksimal Rp 9.999.999.999).",
    );
  });
  it("other key texts", () => {
    expect(financeErrorMessage({ code: "unauthenticated" }, "read")).toBeNull();
    expect(financeErrorMessage({ code: "text_too_long", field: "notes" }, "record")).toBe("Terlalu panjang (maksimal 500 karakter).");
    expect(financeErrorMessage({ code: "closed_period" }, "void")).toBe(
      "Transaksi periode lama tidak bisa dibatalkan. Catat koreksi di periode aktif.",
    );
    expect(financeErrorMessage({ code: "file_count", field: "files", count: 3 }, "record")).toBe("Maksimal 3 berkas.");
    expect(financeErrorMessage({ code: "file_count", field: "files", count: 1 }, "addProof")).toBe("Boleh menambah 1 berkas lagi.");
    expect(financeErrorMessage({ code: "opening_exists" }, "recordOpening")).toBe(
      "Saldo awal periode ini sudah dicatat. Batalkan yang lama kalau angkanya salah.",
    );
    expect(financeErrorMessage({ code: "no_active_period" }, "record")).toBe("Belum ada periode aktif. Transaksi belum bisa dicatat.");
    for (const text of Object.values(FINANCE_ERROR_COPY)) if (text !== null) expect(text).not.toMatch(/[–—]/);
  });
});

describe("helpers", () => {
  it("jakartaToday flips at 17:00 UTC (FN-12)", () => {
    expect(jakartaToday(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
    expect(jakartaToday(new Date("2026-11-10T16:59:59Z"))).toBe("2026-11-10");
  });
  it("soft period warning", () => {
    expect(isOutsideFinancePeriod("2026-07-31", "2026-08-01", null)).toBe(true);
    expect(isOutsideFinancePeriod("2026-08-01", "2026-08-01", "2027-07-31")).toBe(false);
    expect(isOutsideFinancePeriod("2027-08-01", null, "2027-07-31")).toBe(true);
    expect(isOutsideFinancePeriod("1999-01-01", null, null)).toBe(false);
  });
  it("Pakai angka ini: never a negative amount", () => {
    expect(openingAmountFromPrevious({ previousClosingBalance: "1500000" })).toBe("1500000");
    expect(openingAmountFromPrevious({ previousClosingBalance: "0" })).toBe("0");
    expect(openingAmountFromPrevious({ previousClosingBalance: "-5" })).toBeNull();
    expect(openingAmountFromPrevious({ previousClosingBalance: null })).toBeNull();
  });
  it("Catat ulang copies a voided entry without the link; an opening goes to the opening form", () => {
    const voided = {
      entryId: ID, numberText: "KAS-0003", entryType: "opening", amount: "0", entryDate: "2026-08-01",
      description: "Saldo awal periode 2026/2027", notes: null, status: "voided",
      corrects: null, actions: { canRerecord: true, canCorrect: false },
    } as unknown as FinanceEntryDetail;
    expect(financeRerecordPrefill(voided)).toEqual({
      entryType: "opening", entryDate: "2026-08-01", amount: "0", description: "Saldo awal periode 2026/2027",
      notes: null, correctsEntryId: null, correctsNumberText: null,
    });
    expect(financeRerecordPath({ entryId: ID, entryType: "opening" })).toBe(`/finance/saldo-awal?again=${ID}`);
    expect(financeRerecordPath({ entryId: ID, entryType: "income" })).toBe(`/finance/catat?again=${ID}`);
  });
  it("export file name is file-safe", () => {
    expect(financeExportFileName("xlsx", "2026/2027", new Date("2026-11-10T03:00:00Z"))).toBe("finance-2026-2027-2026-11-10.xlsx");
    expect(financeExportFileName("csv", null, new Date("2026-11-10T03:00:00Z"))).toBe("finance-2026-11-10.csv");
  });
});

// Capability matrix (spec 2, FN-01..FN-04, AC-03, B18).
function grant(key: string, scope: PermissionGrant["scope"] = "all"): PermissionGrant {
  return { key, scope, unitIds: scope === "units" ? [ID] : [], isSensitive: true };
}
function member(keys: PermissionGrant[], opts: { admin?: boolean; period?: boolean } = {}): AccessState {
  return {
    kind: "member",
    member: {
      memberId: MEMBER, fullName: "Test", memberType: "student", isSystemAdmin: opts.admin ?? false,
      activePeriodId: opts.period === false ? null : ID2, activePeriodLabel: opts.period === false ? null : "2026/2027",
    },
    permissions: keys,
  };
}

describe("financeCapabilities", () => {
  const view = grant("finance.view");
  const manage = grant("finance.manage");
  const exp = grant("finance.export");
  it("Treasurer (P-BEND): everything", () => {
    expect(financeCapabilities(member([view, manage, exp]))).toEqual({
      canView: true, canManage: true, canRecord: true, canExport: true, canUploadProof: true, hasActivePeriod: true,
    });
  });
  it("other BPH (P-KETUM, P-SEKJEN): read and export only", () => {
    expect(financeCapabilities(member([view, exp]))).toEqual({
      canView: true, canManage: false, canRecord: false, canExport: true, canUploadProof: false, hasActivePeriod: true,
    });
  });
  it("System Admin alone (P-ADMIN) and plain members get nothing", () => {
    const none = { canView: false, canManage: false, canRecord: false, canExport: false, canUploadProof: false, hasActivePeriod: true };
    expect(financeCapabilities(member([], { admin: true }))).toEqual(none);
    expect(financeCapabilities(member([grant("inventory.view")]))).toEqual(none);
  });
  it("export without view and manage without view give nothing (R15, fail closed)", () => {
    expect(financeCapabilities(member([exp])).canExport).toBe(false);
    expect(financeCapabilities(member([manage])).canManage).toBe(false);
  });
  it("unit-scoped finance grants are ignored (scope all only)", () => {
    expect(financeCapabilities(member([grant("finance.view", "units")])).canView).toBe(false);
  });
  it("no active period: a manager cannot record or upload", () => {
    const c = financeCapabilities(member([view, manage, exp], { period: false }));
    expect(c.canRecord).toBe(false);
    expect(c.canUploadProof).toBe(false);
    expect(c.hasActivePeriod).toBe(false);
  });
  it("non-member states get nothing", () => {
    for (const kind of ["anonymous", "error", "no_access", "password_pending"] as const) {
      expect(financeCapabilities({ kind }).canView).toBe(false);
    }
  });
});
