// Meeting Minutes contract (src/modules/minutes/types.ts): zod limits and cleaning, unit scopes per persona,
// database hint mapping, zod error mapping, copy, helpers.
// Expected values are written from the spec (docs/modules/meeting-minutes.md sections 2, 4, 5, 7, 9, 11)
// and the migration 20261111100100_nexus_minutes.sql (CHECKs, hints, M1-M7), not copied from the code.
import { describe, expect, it } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";
import {
  cleanMinuteFileName,
  cleanMinuteLine,
  cleanMinuteLongText,
  formatMinuteCopy,
  isDefaultMinuteFilters,
  isOutsideMinutePeriod,
  isValidMinuteDate,
  jakartaToday,
  MINUTE_DB_HINTS,
  MINUTE_ERROR_COPY,
  MINUTE_LIMITS,
  minuteAddFilesSchema,
  minuteCapabilities,
  minuteDetailPath,
  minuteEditPath,
  minuteErrorFromDb,
  minuteErrorFromZod,
  minuteErrorMessage,
  minuteErrorStatus,
  minuteExportFileName,
  minuteExportSchema,
  minuteFilePath,
  minuteListFiltersSchema,
  minuteListQuerySchema,
  minuteRecordSchema,
  minuteScopeIncludes,
  minuteUnitLabel,
  minuteUpdateSchema,
  minuteUploadFileSchema,
  minuteVoidSchema,
  minuteWithdrawFileSchema,
  readableMinuteUnits,
  recordableMinuteUnits,
  sniffMinuteFileType,
  type MinuteErrorCode,
  type MinuteUnitOption,
} from "@/modules/minutes/types";

const ID = "11111111-2222-3333-4444-555555555555";
const MEMBER = "aaaaaaaa-2222-3333-4444-555555555555";
const U_INT = "cccccccc-0000-0000-0000-000000000001"; // Departemen Internal
const U_EXT = "cccccccc-0000-0000-0000-000000000002"; // Departemen Eksternal
const PATH = `${MEMBER}/bbbbbbbb-2222-3333-4444-555555555555.pdf`;
const PATH2 = `${MEMBER}/dddddddd-2222-3333-4444-555555555555.png`;

const validRecord = {
  unitId: U_INT,
  meetingDate: "2026-11-09",
  title: "Rapat evaluasi",
  topic: "Evaluasi bulanan",
  content: "Poin 1",
};

function firstError(result: { success: boolean; error?: unknown }) {
  expect(result.success).toBe(false);
  return minuteErrorFromZod(result.error as never);
}

describe("text cleaning mirrors the database (M2)", () => {
  it("title and topic: whitespace incl. line breaks collapses to one space, then trimmed", () => {
    expect(cleanMinuteLine("  Rapat\n\t evaluasi   bulanan ")).toBe("Rapat evaluasi bulanan");
  });
  it("content and decision: CRLF -> LF, inner line breaks kept, outer whitespace trimmed", () => {
    expect(cleanMinuteLongText("\r\n  Poin 1\r\n\r\nPoin 2  \n")).toBe("Poin 1\n\nPoin 2");
  });
  it("record schema returns the cleaned values the server sends to the RPC", () => {
    const parsed = minuteRecordSchema.parse({ ...validRecord, unitId: ` ${U_INT.toUpperCase()} `, title: " A \n B ", decision: "   " });
    expect(parsed.unitId).toBe(U_INT);
    expect(parsed.title).toBe("A B");
    expect(parsed.decision).toBeNull(); // optional, blank = null (A-MN2)
    expect(parsed.files).toEqual([]);
  });
});

describe("field limits (A-MN3) count code points like char_length", () => {
  const cases: Array<[keyof typeof validRecord | "decision", number]> = [
    ["title", MINUTE_LIMITS.title],
    ["topic", MINUTE_LIMITS.topic],
    ["content", MINUTE_LIMITS.content],
    ["decision", MINUTE_LIMITS.decision],
  ];
  it("limits are 150 / 200 / 20000 / 5000 / reasons 500", () => {
    expect([MINUTE_LIMITS.title, MINUTE_LIMITS.topic, MINUTE_LIMITS.content, MINUTE_LIMITS.decision, MINUTE_LIMITS.reason]).toEqual([
      150, 200, 20000, 5000, 500,
    ]);
  });
  for (const [field, max] of cases) {
    it(`${field}: ${max} accepted, ${max + 1} refused with text_too_long on that field`, () => {
      expect(minuteRecordSchema.safeParse({ ...validRecord, [field]: "x".repeat(max) }).success).toBe(true);
      expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, [field]: "x".repeat(max + 1) }))).toEqual({
        code: "text_too_long",
        field,
      });
    });
  }
  it("an emoji counts as one character (150 emoji titles pass)", () => {
    expect(minuteRecordSchema.safeParse({ ...validRecord, title: "😀".repeat(150) }).success).toBe(true);
  });
  it("required fields: blank after cleaning = text_required on that field", () => {
    for (const field of ["title", "topic", "content"] as const) {
      expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, [field]: " \n " }))).toEqual({ code: "text_required", field });
    }
  });
  it("void and withdraw reasons: required, 500 max", () => {
    expect(firstError(minuteVoidSchema.safeParse({ minuteId: ID, version: 1, reason: "  " }))).toEqual({ code: "reason_required", field: "reason" });
    expect(firstError(minuteWithdrawFileSchema.safeParse({ fileId: 7, version: 1, reason: "r".repeat(501) }))).toEqual({
      code: "text_too_long",
      field: "reason",
    });
    expect(minuteWithdrawFileSchema.safeParse({ fileId: 7, version: 1, reason: "r".repeat(500) }).success).toBe(true);
  });
});

describe("unit and meeting date (F3, R9, MN-09)", () => {
  it("missing or blank unit = unit_required; a malformed id = invalid_input", () => {
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, unitId: "" }))).toEqual({ code: "unit_required", field: "unitId" });
    const { unitId: _omit, ...withoutUnit } = validRecord;
    void _omit;
    expect(firstError(minuteRecordSchema.safeParse(withoutUnit))).toEqual({ code: "unit_required", field: "unitId" });
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, unitId: "dept-internal" }))).toEqual({ code: "invalid_input", field: "unitId" });
  });
  it("meeting date: blank = date_required, not a real date or before 2000 = invalid_dates", () => {
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, meetingDate: "" }))).toEqual({ code: "date_required", field: "meetingDate" });
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, meetingDate: "2026-02-30" }))).toEqual({ code: "invalid_dates", field: "meetingDate" });
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, meetingDate: "1999-12-31" }))).toEqual({ code: "invalid_dates", field: "meetingDate" });
    expect(isValidMinuteDate("2000-01-01")).toBe(true);
  });
  it("edit has no unit or period input (A-MN4, MN-11): extra keys are dropped", () => {
    const parsed = minuteUpdateSchema.parse({ ...validRecord, minuteId: ID, version: 3, periodId: ID });
    expect(parsed).not.toHaveProperty("unitId");
    expect(parsed).not.toHaveProperty("periodId");
  });
  it("version must be a whole number from 1", () => {
    expect(firstError(minuteUpdateSchema.safeParse({ ...validRecord, minuteId: ID, version: 0 }))).toEqual({ code: "invalid_input", field: "version" });
  });
});

describe("files (N6 a, MN-17, MN-19)", () => {
  const file = (path: string) => ({ path, name: "notulen.pdf" });
  it("record: 0..3 files; a fourth = file_count with the bound", () => {
    expect(minuteRecordSchema.safeParse({ ...validRecord, files: [file(PATH)] }).success).toBe(true);
    const four = [PATH, PATH2, `${MEMBER}/eeeeeeee-2222-3333-4444-555555555555.jpg`, `${MEMBER}/ffffffff-2222-3333-4444-555555555555.jpeg`];
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, files: four.map(file) }))).toEqual({ code: "file_count", field: "files", count: 3 });
  });
  it("Tambah lampiran: at least one file", () => {
    expect(firstError(minuteAddFilesSchema.safeParse({ minuteId: ID, version: 1, files: [] }))).toEqual({ code: "file_required", field: "files", count: 1 });
  });
  it("the same path twice, an uppercase path or another folder shape = invalid_file", () => {
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, files: [file(PATH), file(PATH)] })).code).toBe("invalid_file");
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, files: [file(PATH.toUpperCase())] })).code).toBe("invalid_file");
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, files: [file(`x/${PATH}`)] })).code).toBe("invalid_file");
    expect(firstError(minuteRecordSchema.safeParse({ ...validRecord, files: [file(PATH.replace(".pdf", ".docx"))] })).code).toBe("invalid_file");
  });
  it("upload: PDF, JPG, PNG only, 5 MB max (5242880 bytes)", () => {
    expect(minuteUploadFileSchema.safeParse({ type: "application/pdf", size: 5_242_880 }).success).toBe(true);
    expect(firstError(minuteUploadFileSchema.safeParse({ type: "image/png", size: 5_242_881 }))).toEqual({
      code: "file_too_large",
      field: "request",
      ref: null,
      maxMb: 5,
    });
    expect(firstError(minuteUploadFileSchema.safeParse({ type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 })).code).toBe(
      "invalid_file",
    );
  });
  it("magic bytes decide the real type", () => {
    expect(sniffMinuteFileType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe("application/pdf");
    expect(sniffMinuteFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMinuteFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMinuteFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // DOCX/ZIP
    expect(sniffMinuteFileType(new Uint8Array([0x25, 0x50]))).toBeNull();
  });
  it("file path is the uploader's own lowercase folder; names lose control and bidi characters", () => {
    expect(minuteFilePath(MEMBER.toUpperCase(), "BBBBBBBB-2222-3333-4444-555555555555", "image/jpeg")).toBe(
      `${MEMBER}/bbbbbbbb-2222-3333-4444-555555555555.jpg`,
    );
    expect(cleanMinuteFileName("scan‮fdp.exe", "application/pdf")).toBe("scanfdp.exe");
    expect(cleanMinuteFileName("\u0000​  ", "image/png")).toBe("berkas.png");
    expect([...cleanMinuteFileName("a".repeat(250), "application/pdf")].length).toBe(200);
  });
});

describe("list filters and export body (F1, F6, A-MN6, R13)", () => {
  it("defaults: period active, status active, no unit, no search, page 1 of 20", () => {
    const q = minuteListQuerySchema.parse({});
    expect(q).toEqual({ filters: { search: null, unitId: null, period: "active", status: "active" }, page: 1, pageSize: 20 });
    expect(isDefaultMinuteFilters(q.filters)).toBe(true);
    expect(isDefaultMinuteFilters(minuteListFiltersSchema.parse({ status: "all" }))).toBe(false);
  });
  it("unit filter: blank = all units, an id is lowercased, junk = invalid_input on unitId", () => {
    expect(minuteListFiltersSchema.parse({ unitId: "" }).unitId).toBeNull();
    expect(minuteListFiltersSchema.parse({ unitId: U_EXT.toUpperCase() }).unitId).toBe(U_EXT);
    expect(firstError(minuteListQuerySchema.safeParse({ filters: { unitId: "semua" } }))).toEqual({ code: "invalid_input", field: "unitId" });
  });
  it("status and period accept only the database values", () => {
    expect(firstError(minuteListFiltersSchema.safeParse({ status: "draft" }))).toEqual({ code: "invalid_input", field: "status" });
    expect(firstError(minuteListFiltersSchema.safeParse({ period: "old" }))).toEqual({ code: "invalid_input", field: "period" });
  });
  it("search: 120 after cleaning, raw 480; too long = invalid_input on search (nested path)", () => {
    expect(minuteListFiltersSchema.parse({ search: `  ${"s".repeat(120)}  ` }).search).toHaveLength(120);
    expect(firstError(minuteListQuerySchema.safeParse({ filters: { search: "s".repeat(121) } }))).toEqual({ code: "invalid_input", field: "search" });
    expect(firstError(minuteListQuerySchema.safeParse({ filters: { search: " ".repeat(481) } }))).toEqual({ code: "invalid_input", field: "search" });
    expect(minuteListFiltersSchema.parse({ search: "   " }).search).toBeNull();
  });
  it("page size 1..50, refused (not clamped) above", () => {
    expect(firstError(minuteListQuerySchema.safeParse({ pageSize: 51 }))).toEqual({ code: "invalid_input", field: "pageSize" });
    expect(firstError(minuteListQuerySchema.safeParse({ page: 0 }))).toEqual({ code: "invalid_input", field: "page" });
  });
  it("export: list with filters, or one minute; formats xlsx/csv/pdf only", () => {
    expect(minuteExportSchema.parse({ kind: "list", format: "csv" })).toMatchObject({ kind: "list", filters: { status: "active" } });
    expect(minuteExportSchema.parse({ kind: "single", format: "pdf", minuteId: ID })).toEqual({ kind: "single", format: "pdf", minuteId: ID });
    expect(firstError(minuteExportSchema.safeParse({ kind: "list", format: "docx" }))).toEqual({ code: "invalid_input", field: "format" });
    expect(minuteExportSchema.safeParse({ kind: "all", format: "csv" }).success).toBe(false);
  });
});

describe("capabilities with unit scopes (spec 2, D37, MN-01..MN-08)", () => {
  const all = (key: string): PermissionGrant => ({ key, scope: "all", unitIds: [], isSensitive: false });
  const units = (key: string, ...ids: string[]): PermissionGrant => ({ key, scope: "units", unitIds: ids, isSensitive: false });
  const member = (permissions: PermissionGrant[], period: string | null = "p1", isSystemAdmin = false) =>
    ({
      kind: "member",
      member: { memberId: MEMBER, fullName: "T", memberType: "student", isSystemAdmin, activePeriodId: period, activePeriodLabel: period ? "2026/2027" : null },
      permissions,
    }) as AccessState;

  it("P-SEKJEN: view, manage, export all units; may record and upload", () => {
    const c = minuteCapabilities(member([all("minutes.view"), all("minutes.manage"), all("minutes.export")]));
    expect(c).toMatchObject({ canView: true, canManage: true, canRecord: true, canExport: true, canUploadFiles: true });
    expect(minuteScopeIncludes(c.manage, U_EXT)).toBe(true);
  });
  it("P-KETUM / P-BEND: read and export all, no record, no upload (MN-04)", () => {
    const c = minuteCapabilities(member([all("minutes.view"), all("minutes.export")]));
    expect(c).toMatchObject({ canView: true, canManage: false, canRecord: false, canExport: true, canUploadFiles: false });
  });
  it("P-SEKDEP: own unit only for view, manage and export (MN-02, MN-03)", () => {
    const c = minuteCapabilities(member([units("minutes.view", U_INT), units("minutes.manage", U_INT), units("minutes.export", U_INT)]));
    expect(c.view).toEqual({ kind: "units", unitIds: [U_INT] });
    expect(minuteScopeIncludes(c.manage, U_INT.toUpperCase())).toBe(true);
    expect(minuteScopeIncludes(c.manage, U_EXT)).toBe(false);
    expect(c).toMatchObject({ canRecord: true, canExport: true });
  });
  it("Kepala Departemen (D37): reads own unit, no manage, no export (MN-05)", () => {
    const c = minuteCapabilities(member([units("minutes.view", U_INT)]));
    expect(c).toMatchObject({ canView: true, canManage: false, canRecord: false, canExport: false, canUploadFiles: false });
    expect(c.export).toEqual({ kind: "none" });
  });
  it("two secretary assignments combine their units (MN-07, E9)", () => {
    const c = minuteCapabilities(member([units("minutes.manage", U_EXT, U_INT), units("minutes.view", U_INT), units("minutes.view", U_EXT)]));
    expect(c.view).toEqual({ kind: "units", unitIds: [U_INT, U_EXT].sort() });
    expect(minuteScopeIncludes(c.manage, U_INT) && minuteScopeIncludes(c.manage, U_EXT)).toBe(true);
  });
  it("BPH plus Sekretaris Departemen: view all, manage only the unit (E1, AC-35)", () => {
    const c = minuteCapabilities(member([all("minutes.view"), all("minutes.export"), units("minutes.manage", U_INT)]));
    expect(c.view.kind).toBe("all");
    expect(c.manage).toEqual({ kind: "units", unitIds: [U_INT] });
  });
  it("export never exceeds view (R15), even if a grant says otherwise", () => {
    const c = minuteCapabilities(member([units("minutes.view", U_INT), all("minutes.export")]));
    expect(c.export).toEqual({ kind: "units", unitIds: [U_INT] });
    expect(minuteCapabilities(member([all("minutes.export")])).canExport).toBe(false);
  });
  it("plain member, System Admin without position, other keys: nothing (MN-06, B18)", () => {
    for (const state of [member([all("inventory.view")]), member([], "p1", true)]) {
      expect(minuteCapabilities(state)).toMatchObject({ canView: false, canManage: false, canExport: false, canUploadFiles: false });
    }
  });
  it("manage without an active period: no record, no upload (R11)", () => {
    const c = minuteCapabilities(member([all("minutes.manage"), all("minutes.view")], null));
    expect(c).toMatchObject({ canManage: true, canRecord: false, canUploadFiles: false, hasActivePeriod: false });
  });
  it("non-member states get nothing", () => {
    for (const state of [{ kind: "anonymous" }, { kind: "no_access" }, { kind: "password_pending" }, { kind: "error" }] as AccessState[]) {
      expect(minuteCapabilities(state)).toMatchObject({ canView: false, canManage: false, canRecord: false, canExport: false });
    }
  });
});

describe("unit options (N2 c, MN-22)", () => {
  const opt = (unitId: string, unitType: MinuteUnitOption["unitType"], canRead: boolean, canRecord: boolean, unitName = "X"): MinuteUnitOption => ({
    unitId,
    unitName,
    unitType,
    isActive: true,
    canRead,
    canRecord,
  });
  it("the root unit reads as Seluruh organisasi; a vanished unit has a fallback label", () => {
    expect(minuteUnitLabel({ unitName: "PMK ITERA", unitType: "organization" })).toBe("Seluruh organisasi");
    expect(minuteUnitLabel({ unitName: "Departemen Internal", unitType: "department" })).toBe("Departemen Internal");
    expect(minuteUnitLabel({ unitName: null, unitType: null })).toBe("Unit tidak ditemukan");
  });
  it("filter and select lists come from canRead and canRecord", () => {
    const options = [opt(U_INT, "department", true, true), opt(U_EXT, "department", true, false)];
    expect(readableMinuteUnits(options)).toHaveLength(2);
    expect(recordableMinuteUnits(options).map((o) => o.unitId)).toEqual([U_INT]);
  });
});

describe("database hints (migration header list) map to the contract codes", () => {
  const expected: Record<string, MinuteErrorCode> = {
    permission_required: "forbidden",
    unit_not_allowed: "unit_not_allowed",
    not_active_member: "forbidden",
    closed_period: "closed_period",
    immutable_column: "unavailable",
    export_log_direct_insert: "unavailable",
    append_only: "unavailable",
    minute_not_found: "not_found",
    file_not_found: "not_found",
    no_active_period: "no_active_period",
    state_changed: "state_changed",
    minute_voided: "minute_voided",
    file_missing: "file_missing",
    too_many_rows: "export_too_large",
    invalid_unit: "invalid_unit",
    invalid_input: "invalid_input",
    text_required: "text_required",
    text_too_long: "text_too_long",
    reason_required: "reason_required",
    date_required: "date_required",
    date_in_future: "date_in_future",
    invalid_dates: "invalid_dates",
    invalid_file: "invalid_file",
    file_too_large: "file_too_large",
    file_required: "file_required",
    file_count: "file_count",
    file_already_attached: "file_already_attached",
    invalid_status: "invalid_input",
    invalid_period: "invalid_input",
    search_too_long: "invalid_input",
    invalid_page: "invalid_input",
    invalid_page_size: "invalid_input",
    invalid_format: "invalid_input",
  };
  it("every hint the migration raises is mapped, and nothing else", () => {
    expect(MINUTE_DB_HINTS).toEqual(expected);
  });
  it("unknown, prototype-like and missing hints fail closed", () => {
    for (const hint of ["constructor", "toString", "__proto__", "something_new", "", null, undefined]) {
      expect(minuteErrorFromDb(hint, null)).toEqual({ code: "unavailable" });
    }
  });
  it("detail becomes the field, the path ref or the count", () => {
    expect(minuteErrorFromDb("text_too_long", "title")).toEqual({ code: "text_too_long", field: "title" });
    expect(minuteErrorFromDb("date_in_future", "meeting_date")).toEqual({ code: "date_in_future", field: "meetingDate" });
    expect(minuteErrorFromDb("reason_required", "reason")).toEqual({ code: "reason_required", field: "reason" });
    expect(minuteErrorFromDb("invalid_unit", "org_unit_id")).toEqual({ code: "invalid_unit", field: "unitId" });
    expect(minuteErrorFromDb("file_missing", PATH)).toEqual({ code: "file_missing", field: "files", ref: PATH });
    expect(minuteErrorFromDb("invalid_file", "p_files")).toEqual({ code: "invalid_file", field: "files", ref: null });
    expect(minuteErrorFromDb("file_too_large", PATH)).toEqual({ code: "file_too_large", field: "files", ref: PATH, maxMb: 5 });
    expect(minuteErrorFromDb("file_count", "2")).toEqual({ code: "file_count", field: "files", count: 2 });
    expect(minuteErrorFromDb("too_many_rows", "1001")).toEqual({ code: "export_too_large", rowCount: 1001 });
    expect(minuteErrorFromDb("invalid_page_size", null)).toEqual({ code: "invalid_input", field: "pageSize" });
    expect(minuteErrorFromDb("search_too_long", null)).toEqual({ code: "invalid_input", field: "search" });
    expect(minuteErrorFromDb("file_not_found", null)).toEqual({ code: "not_found", entity: "file" });
    expect(minuteErrorFromDb("minute_not_found", null)).toEqual({ code: "not_found", entity: "minute" });
    expect(minuteErrorFromDb("permission_required", "minutes.manage")).toEqual({ code: "forbidden" });
    expect(minuteErrorFromDb("text_required", "something_else")).toEqual({ code: "text_required", field: "request" });
  });
  it("HTTP status per code", () => {
    expect(minuteErrorStatus({ code: "unauthenticated" })).toBe(401);
    expect(minuteErrorStatus({ code: "unit_not_allowed" })).toBe(403);
    expect(minuteErrorStatus({ code: "not_found", entity: "minute" })).toBe(404);
    expect(minuteErrorStatus({ code: "text_required", field: "title" })).toBe(400);
    expect(minuteErrorStatus({ code: "file_too_large", field: "file", ref: null, maxMb: 5 })).toBe(413);
    expect(minuteErrorStatus({ code: "export_too_large", rowCount: null })).toBe(422);
    expect(minuteErrorStatus({ code: "upload_limit", limit: 10 })).toBe(429);
    expect(minuteErrorStatus({ code: "unavailable" })).toBe(503);
    expect(minuteErrorStatus({ code: "state_changed" })).toBe(409);
  });
});

describe("copy (spec section 7)", () => {
  it("every error code has a text or a per-field/per-action rule; only unauthenticated has none", () => {
    for (const [code, text] of Object.entries(MINUTE_ERROR_COPY)) {
      if (text === null) continue;
      expect(text, code).not.toMatch(/[—–]/); // no em or en dashes (antislop R-02)
    }
    expect(minuteErrorMessage({ code: "unauthenticated" }, "read")).toBeNull();
  });
  it("form field texts are the spec's words", () => {
    expect(minuteErrorMessage({ code: "text_required", field: "title" }, "record")).toBe("Judul wajib diisi.");
    expect(minuteErrorMessage({ code: "text_required", field: "topic" }, "edit")).toBe("Topik wajib diisi.");
    expect(minuteErrorMessage({ code: "text_required", field: "content" }, "record")).toBe("Isi notulensi wajib diisi.");
    expect(minuteErrorMessage({ code: "date_required", field: "meetingDate" }, "record")).toBe("Isi tanggal rapat.");
    expect(minuteErrorMessage({ code: "date_in_future", field: "meetingDate" }, "record")).toBe("Tanggal rapat tidak boleh di masa depan.");
    expect(minuteErrorMessage({ code: "text_too_long", field: "content" }, "record")).toBe("Terlalu panjang (maksimal 20000 karakter).");
    expect(minuteErrorMessage({ code: "unit_not_allowed" }, "record")).toBe("Kamu tidak bisa mencatat notulensi untuk unit ini.");
    expect(minuteErrorMessage({ code: "reason_required", field: "reason" }, "void")).toBe("Tulis alasan pembatalan.");
    expect(minuteErrorMessage({ code: "no_active_period" }, "record")).toBe("Belum ada periode aktif. Notulensi belum bisa dicatat.");
    expect(minuteErrorMessage({ code: "state_changed" }, "edit")).toBe("Data sudah berubah. Muat ulang.");
  });
  it("file texts: upload shows the type rule, a bad saved path the generic text", () => {
    const bad = { code: "invalid_file", field: "files", ref: null } as const;
    expect(minuteErrorMessage(bad, "upload")).toBe("Hanya PDF, JPG, atau PNG.");
    expect(minuteErrorMessage(bad, "record")).toBe("Terjadi gangguan. Coba lagi.");
    expect(minuteErrorMessage({ code: "file_too_large", field: "file", ref: null, maxMb: 5 }, "upload")).toBe("Berkas terlalu besar (maksimal 5 MB).");
    expect(minuteErrorMessage({ code: "file_count", field: "files", count: 3 }, "record")).toBe("Maksimal 3 berkas.");
    expect(minuteErrorMessage({ code: "unavailable" }, "upload")).toBe("Berkas gagal diunggah. Coba lagi.");
    expect(minuteErrorMessage({ code: "not_found", entity: "file" }, "openFile")).toBe("Berkas tidak bisa dibuka. Coba lagi.");
  });
  it("export refusal uses the spec's narrow-the-filter text", () => {
    expect(minuteErrorMessage({ code: "export_too_large", rowCount: 1500 }, "export")).toBe(
      "Terlalu banyak data untuk satu file. Persempit dengan filter periode atau unit.",
    );
  });
  it("placeholders fill and unknown ones stay", () => {
    expect(formatMinuteCopy("{n} notulensi di periode {label}", { n: 4, label: "2026/2027" })).toBe("4 notulensi di periode 2026/2027");
    expect(formatMinuteCopy("{x} {constructor}", {})).toBe("{x} {constructor}");
  });
});

describe("helpers", () => {
  it("routes", () => {
    expect(minuteDetailPath(ID)).toBe(`/notulensi/${ID}`);
    expect(minuteEditPath(ID)).toBe(`/notulensi/${ID}/ubah`);
  });
  it("Jakarta day and export file names", () => {
    expect(jakartaToday(new Date("2026-11-09T17:00:00Z"))).toBe("2026-11-10");
    expect(minuteExportFileName({ kind: "list" }, "xlsx", new Date("2026-11-09T17:00:00Z"))).toBe("notulensi-2026-11-10.xlsx");
    expect(minuteExportFileName({ kind: "single", meetingDate: "2026-10-17" }, "pdf")).toBe("notulensi-rapat-2026-10-17.pdf");
  });
  it("R9 soft warning only outside known period dates", () => {
    expect(isOutsideMinutePeriod("2026-06-30", "2026-07-01", "2027-06-30")).toBe(true);
    expect(isOutsideMinutePeriod("2026-07-01", "2026-07-01", "2027-06-30")).toBe(false);
    expect(isOutsideMinutePeriod("2027-07-01", "2026-07-01", "2027-06-30")).toBe(true);
    expect(isOutsideMinutePeriod("2027-07-01", null, null)).toBe(false);
    expect(isOutsideMinutePeriod("junk", "2026-07-01", null)).toBe(false);
  });
});
