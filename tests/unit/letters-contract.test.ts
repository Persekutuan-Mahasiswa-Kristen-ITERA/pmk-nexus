// Letters contract (src/modules/letters/types.ts), input validation (src/modules/letters/server/validation.ts) and error mapping
// (src/lib/picore/letters.ts). Expected values are written from the spec (docs/modules/letters.md sections 2, 4, 5, 11), not copied
// from the code: A-LT18 limits, L8 files, L10 caps, D-024 number format, access rules per persona.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";
import { buildLetterError, mapLetterDbError } from "@/lib/picore/letters";
import { inputError, parseInput } from "@/modules/letters/server/validation";
import {
  cleanLetterFileName,
  defaultLetterQueueView,
  formatLetterCopy,
  formatLetterNumber,
  isLastIssuedFile,
  isValidLetterDate,
  jakartaToday,
  LETTER_DB_HINTS,
  LETTER_ERROR_COPY,
  LETTER_FILE_MAX_BYTES,
  LETTER_FILE_PATH_PATTERN,
  LETTER_FILE_SIGNED_URL_TTL_SECONDS,
  LETTER_LIMITS,
  LETTER_STATUS_LABEL,
  letterAddFilesSchema,
  letterCapabilities,
  letterErrorMessage,
  letterExportFileName,
  letterExportSchema,
  letterFieldName,
  letterFilePath,
  letterListQuerySchema,
  letterQueueQuerySchema,
  letterRegisterSchema,
  letterRequestCreateSchema,
  letterRequestIssueSchema,
  letterRequestRejectSchema,
  letterRequestStage,
  letterSearchSchema,
  letterSegments,
  letterUpdateSchema,
  letterUploadFileSchema,
  letterVoidSchema,
  letterWithdrawFileSchema,
  numberingFormatUpdateSchema,
  numberingSetNextSchema,
  padLetterSequence,
  sniffLetterFileType,
  type LetterErrorCode,
} from "@/modules/letters/types";

const ID = "11111111-2222-3333-4444-555555555555";
const OWNER = "aaaaaaaa-2222-3333-4444-555555555555";
const FILE_UUID = "bbbbbbbb-2222-3333-4444-555555555555";
const PATH = `${OWNER}/${FILE_UUID}.pdf`;
const FILE = { path: PATH, name: "surat.pdf" };
const path = (n: number) => `${OWNER}/${n.toString(16).padStart(8, "0")}-2222-3333-4444-555555555555.pdf`;

const grant = (key: string, scope: "all" | "units" = "all"): PermissionGrant => ({ key, scope, unitIds: scope === "units" ? ["u1"] : [], isSensitive: true });
const member = (keys: string[], opts: { admin?: boolean; period?: boolean } = {}): AccessState => ({
  kind: "member",
  member: {
    memberId: "m",
    fullName: "Tester",
    memberType: "student",
    isSystemAdmin: opts.admin ?? false,
    activePeriodId: opts.period === false ? null : "p",
    activePeriodLabel: opts.period === false ? null : "2026/2027",
  },
  permissions: keys.map((k) => grant(k)),
});

/** First error code of a zod parse (what the server turns into the contract error). */
function firstMessage<S extends z.ZodType>(schema: S, input: unknown): string | null {
  const parsed = schema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}
const ok = (schema: z.ZodType, input: unknown) => expect(schema.safeParse(input).success).toBe(true);

// ---------------------------------------------------------------------------------------------
describe("dates are Jakarta calendar days (R16, LT-47)", () => {
  it("jakartaToday flips at 17:00 UTC; 23:30 UTC is already the next Jakarta day; year ends and leap days", () => {
    expect(jakartaToday(new Date("2026-11-08T16:59:59Z"))).toBe("2026-11-08");
    expect(jakartaToday(new Date("2026-11-08T17:00:00Z"))).toBe("2026-11-09");
    expect(jakartaToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(jakartaToday(new Date("2026-12-31T16:59:59Z"))).toBe("2026-12-31");
    expect(jakartaToday(new Date("2028-02-28T18:00:00Z"))).toBe("2028-02-29");
  });
  it("isValidLetterDate: real calendar dates from 2000-01-01 only", () => {
    for (const good of ["2000-01-01", "2026-11-10", "2028-02-29", "2999-12-31"]) expect(isValidLetterDate(good), good).toBe(true);
    for (const bad of ["1999-12-31", "2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-1-5", "26-01-01", "2026/01/01", "", " 2026-01-01", "2026-01-01 ", "2026-01-01T00:00:00Z", "abcd-ef-gh"]) {
      expect(isValidLetterDate(bad), JSON.stringify(bad)).toBe(false);
    }
  });
  it("export file name uses the Jakarta date and the tab: surat-masuk / surat-keluar", () => {
    const at = new Date("2026-12-31T20:00:00Z"); // 1 Jan 2027 in Jakarta
    expect(letterExportFileName("incoming", "xlsx", at)).toBe("surat-masuk-2027-01-01.xlsx");
    expect(letterExportFileName("outgoing", "csv", at)).toBe("surat-keluar-2027-01-01.csv");
    expect(letterExportFileName("outgoing", "pdf", new Date("2026-11-09T05:00:00Z"))).toBe("surat-keluar-2026-11-09.pdf");
  });
});

describe("number format PMK/NEX/SM|SK/YYYY/NNN (D-024, LT-17)", () => {
  const format = { prefix: "PMK/NEX", seqDigits: 3, separator: "/" } as const;
  it("pads to three digits and simply grows past them", () => {
    expect(padLetterSequence(1, 3)).toBe("001");
    expect(padLetterSequence(45, 3)).toBe("045");
    expect(padLetterSequence(999, 3)).toBe("999");
    expect(padLetterSequence(1000, 3)).toBe("1000");
    expect(padLetterSequence(12345, 3)).toBe("12345");
    expect(padLetterSequence(7, 1)).toBe("7");
    expect(padLetterSequence(7, 6)).toBe("000007");
  });
  it("formats from the stored settings, not from code: prefix, code, year, sequence joined by the separator", () => {
    // The seeded settings keep the whole "PMK/NEX" as the prefix: the parts are prefix, code, year, sequence.
    expect(formatLetterNumber({ prefix: "PMK/NEX", seqDigits: 3, separator: "/" }, "SK", 2026, 1)).toBe("PMK/NEX/SK/2026/001");
    expect(formatLetterNumber(format, "SM", 2027, 1234)).toBe("PMK/NEX/SM/2027/1234");
    expect(formatLetterNumber({ prefix: "PMK", seqDigits: 4, separator: "-" }, "SK", 2026, 7)).toBe("PMK-SK-2026-0007");
    expect(formatLetterNumber({ prefix: "X", seqDigits: 2, separator: "." }, "SM", 2026, 3)).toBe("X.SM.2026.03");
  });
});

// ---------------------------------------------------------------------------------------------
describe("files: type by the real bytes, names, paths (A-LT13, L8, LT-26)", () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  it("magic bytes: PDF, JPEG and PNG are recognised, everything else is null", () => {
    expect(sniffLetterFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(sniffLetterFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("image/jpeg");
    expect(sniffLetterFileType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(sniffLetterFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe("image/png");
    expect(sniffLetterFileType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    for (const [label, data] of [
      ["empty", bytes()],
      ["too short for a PDF", bytes(0x25, 0x50, 0x44, 0x46)],
      ["PDF without the dash", new TextEncoder().encode("%PDF1.4")],
      ["PDF not at offset 0", new TextEncoder().encode(" %PDF-1.4")],
      ["JPEG with two bytes", bytes(0xff, 0xd8)],
      ["PNG with a wrong tail", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b)],
      ["GIF", new TextEncoder().encode("GIF89a")],
      ["zip / docx", bytes(0x50, 0x4b, 0x03, 0x04)],
      ["Windows executable", bytes(0x4d, 0x5a, 0x90, 0x00)],
      ["HTML", new TextEncoder().encode("<html><script>")],
      ["SVG", new TextEncoder().encode("<svg xmlns=")],
    ] as const) {
      expect(sniffLetterFileType(data), label).toBeNull();
    }
  });

  it("cleanLetterFileName drops control characters, bidi overrides and zero-width characters (the tech lead's fix 5f5874a)", () => {
    // U+202E (right-to-left override) would make "scan<RLO>fdp.exe.pdf" DISPLAY as "scan" + reversed text, hiding the real extension
    expect(cleanLetterFileName("scan‮fdp.exe.pdf", "application/pdf")).toBe("scanfdp.exe.pdf");
    // the whole families named in the fix: U+200B-200F, U+202A-202E, U+2066-2069
    for (let cp = 0x200b; cp <= 0x200f; cp++) expect(cleanLetterFileName(`a${String.fromCodePoint(cp)}b.pdf`, "application/pdf"), `U+${cp.toString(16)}`).toBe("ab.pdf");
    for (let cp = 0x202a; cp <= 0x202e; cp++) expect(cleanLetterFileName(`a${String.fromCodePoint(cp)}b.pdf`, "application/pdf"), `U+${cp.toString(16)}`).toBe("ab.pdf");
    for (let cp = 0x2066; cp <= 0x2069; cp++) expect(cleanLetterFileName(`a${String.fromCodePoint(cp)}b.pdf`, "application/pdf"), `U+${cp.toString(16)}`).toBe("ab.pdf");
    // C0 and C1 control characters
    expect(cleanLetterFileName("a\u0000b\u0007c\u001fd\u007fe\u0085f\u009fg.pdf", "application/pdf")).toBe("abcdefg.pdf");
    expect(cleanLetterFileName("baris\nbaru\r\ntab\t.pdf", "application/pdf")).toBe("barisbarutab.pdf");
    // ordinary names, spaces and non-ASCII letters survive; a ZWJ-free emoji and accents stay
    expect(cleanLetterFileName("  Surat Izin Kegiatan (final).pdf  ", "application/pdf")).toBe("Surat Izin Kegiatan (final).pdf");
    expect(cleanLetterFileName("Ünïcødé 文件 🙏.png", "image/png")).toBe("Ünïcødé 文件 🙏.png");
    // nothing left -> a fallback with the right extension
    expect(cleanLetterFileName("", "application/pdf")).toBe("berkas.pdf");
    expect(cleanLetterFileName("‮​\u0000", "image/png")).toBe("berkas.png");
    expect(cleanLetterFileName("   ", "image/jpeg")).toBe("berkas.jpg");
  });
  it("cleanLetterFileName cuts at 200 code points (an emoji is one), never in the middle of a character", () => {
    const long = `${"n".repeat(300)}.pdf`;
    expect([...cleanLetterFileName(long, "application/pdf")]).toHaveLength(200);
    const emoji = "🙏".repeat(250);
    const cut = cleanLetterFileName(emoji, "application/pdf");
    expect([...cut]).toHaveLength(200);
    expect(cut).not.toContain("�");
  });

  it("the upload path is '<uploader members.id>/<random uuid>.<ext>', lower-case, built from the session, never from a name", () => {
    const built = letterFilePath(OWNER.toUpperCase(), FILE_UUID.toUpperCase(), "image/jpeg");
    expect(built).toBe(`${OWNER}/${FILE_UUID}.jpg`);
    expect(LETTER_FILE_PATH_PATTERN.test(built)).toBe(true);
    expect(letterFilePath(OWNER, FILE_UUID, "application/pdf")).toMatch(/\.pdf$/);
    expect(letterFilePath(OWNER, FILE_UUID, "image/png")).toMatch(/\.png$/);
    for (const bad of [
      "surat.pdf",
      `../${PATH}`,
      `${OWNER}/../${FILE_UUID}.pdf`,
      `${OWNER}/${FILE_UUID}.exe`,
      `${OWNER}/${FILE_UUID}.pdf.exe`,
      `${OWNER}/${FILE_UUID}`,
      `${OWNER.toUpperCase()}/${FILE_UUID}.pdf`,
      `${OWNER}/${FILE_UUID}.PDF`,
      `${OWNER}/x/${FILE_UUID}.pdf`,
      `/${OWNER}/${FILE_UUID}.pdf`,
      `${PATH}\n`,
      ` ${PATH}`,
      `${OWNER}/${FILE_UUID}.pdf?x=1`,
    ]) {
      expect(LETTER_FILE_PATH_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("declared file: only PDF, JPEG and PNG, between 1 byte and exactly 5 MiB (the limit is 5 MiB = 5242880 bytes)", () => {
    expect(LETTER_FILE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(LETTER_FILE_SIGNED_URL_TTL_SECONDS).toBe(300);
    for (const type of ["application/pdf", "image/jpeg", "image/png"]) ok(letterUploadFileSchema, { type, size: 1 });
    ok(letterUploadFileSchema, { type: "application/pdf", size: 5_242_880 });
    expect(firstMessage(letterUploadFileSchema, { type: "application/pdf", size: 5_242_881 })).toBe("file_too_large");
    for (const size of [0, -1, 1.5, Number.NaN, "100", null]) expect(firstMessage(letterUploadFileSchema, { type: "application/pdf", size }), String(size)).toBe("invalid_file");
    for (const type of ["image/gif", "image/svg+xml", "text/plain", "application/zip", "application/msword", "application/octet-stream", "", "APPLICATION/PDF", "application/pdf "]) {
      expect(firstMessage(letterUploadFileSchema, { type, size: 100 }), JSON.stringify(type)).toBe("invalid_file");
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("limits (A-LT18, L8, L10) and field rules of the input schemas", () => {
  it("the limits are exactly the spec's", () => {
    expect(LETTER_LIMITS).toMatchObject({ subject: 200, counterpart: 150, addressee: 150, notes: 500, note: 500, reason: 500, purpose: 1000, onBehalfOf: 120, counterpartNumber: 60, legacyNumber: 60, filesPerParent: 3, openRequestsPerMember: 5, requestsPerDay: 10, unattachedUploadsPer24h: 10 });
  });

  const incoming = { type: "incoming", subject: "Undangan", counterpart: "Biro", receivedDate: "2026-11-10" };
  const outgoing = { type: "outgoing", subject: "Permohonan", counterpart: "Rektor", letterDate: "2026-11-10" };

  it("register: required fields per type, defaults, blank -> required code", () => {
    ok(letterRegisterSchema, incoming);
    ok(letterRegisterSchema, outgoing);
    expect(firstMessage(letterRegisterSchema, { ...incoming, subject: "" })).toBe("text_required");
    expect(firstMessage(letterRegisterSchema, { ...incoming, subject: "   \n\t " })).toBe("text_required");
    expect(firstMessage(letterRegisterSchema, { ...incoming, counterpart: "" })).toBe("text_required");
    expect(firstMessage(letterRegisterSchema, { ...incoming, counterpart: undefined })).toBe("text_required");
    expect(firstMessage(letterRegisterSchema, { ...incoming, receivedDate: "" })).toBe("date_required");
    expect(firstMessage(letterRegisterSchema, { ...incoming, receivedDate: undefined })).toBe("date_required");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, letterDate: "" })).toBe("date_required");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, letterDate: "2026-02-30" })).toBe("invalid_dates");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, letterDate: "1999-12-31" })).toBe("invalid_dates");
    expect(firstMessage(letterRegisterSchema, { ...incoming, letterDate: "31-12-2026" })).toBe("invalid_dates");
    // an unknown or missing type is never guessed
    expect(letterRegisterSchema.safeParse({ ...incoming, type: "diary" }).success).toBe(false);
    expect(letterRegisterSchema.safeParse({ subject: "x", counterpart: "y" }).success).toBe(false);
    // incoming letter date is optional, notes optional, files default to none
    const parsed = letterRegisterSchema.parse({ ...incoming, letterDate: "", notes: "  " });
    expect(parsed).toMatchObject({ letterDate: null, notes: null, files: [] });
  });

  it("register trims text, keeps the content, counts characters (an emoji is one) and refuses one over the limit", () => {
    expect(letterRegisterSchema.parse({ ...incoming, subject: "  Rapat  " })).toMatchObject({ subject: "Rapat" });
    ok(letterRegisterSchema, { ...incoming, subject: "s".repeat(200), counterpart: "c".repeat(150), notes: "n".repeat(500), counterpartNumber: "9".repeat(60) });
    ok(letterRegisterSchema, { ...incoming, subject: "🙏".repeat(200) }); // 200 characters, 400 UTF-16 units
    ok(letterRegisterSchema, { ...incoming, subject: "  " + "s".repeat(200) + "  " }); // spaces around do not count
    expect(firstMessage(letterRegisterSchema, { ...incoming, subject: "s".repeat(201) })).toBe("text_too_long");
    expect(firstMessage(letterRegisterSchema, { ...incoming, subject: "🙏".repeat(201) })).toBe("text_too_long");
    expect(firstMessage(letterRegisterSchema, { ...incoming, counterpart: "c".repeat(151) })).toBe("text_too_long");
    expect(firstMessage(letterRegisterSchema, { ...incoming, notes: "n".repeat(501) })).toBe("text_too_long");
    expect(firstMessage(letterRegisterSchema, { ...incoming, counterpartNumber: "9".repeat(61) })).toBe("text_too_long");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, legacyNumber: "L".repeat(61) })).toBe("text_too_long");
    // a very long text of 100 000 characters is refused, not truncated, and quickly
    expect(firstMessage(letterRegisterSchema, { ...incoming, subject: "x".repeat(100_000) })).toBe("text_too_long");
    // non-string values are not coerced
    for (const value of [123, true, {}, []]) expect(letterRegisterSchema.safeParse({ ...incoming, subject: value }).success, JSON.stringify(value)).toBe(false);
  });

  it("'Nomor lama' is trimmed and its inner whitespace collapsed; blank means 'not a legacy letter'", () => {
    expect(letterRegisterSchema.parse({ ...outgoing, legacyNumber: "  045 /  PMK   /SK  " })).toMatchObject({ legacyNumber: "045 / PMK /SK" });
    expect(letterRegisterSchema.parse({ ...outgoing, legacyNumber: "   " })).toMatchObject({ legacyNumber: null });
    expect(letterRegisterSchema.parse({ ...outgoing })).toMatchObject({ legacyNumber: null });
  });

  it("files: 0..3 on register, 1..3 on 'Tambah berkas', each path once, names 1..200 without control characters", () => {
    ok(letterRegisterSchema, { ...outgoing, files: [] });
    ok(letterRegisterSchema, { ...outgoing, files: [FILE, { path: path(1), name: "b.pdf" }, { path: path(2), name: "c.pdf" }] });
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [1, 2, 3, 4].map((n) => ({ path: path(n), name: `${n}.pdf` })) })).toBe("file_count");
    expect(firstMessage(letterAddFilesSchema, { letterId: ID, version: 1, files: [] })).toBe("file_required");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [FILE, FILE] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: "surat.pdf", name: "a.pdf" }] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "" }] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "   " }] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "n".repeat(201) }] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "a\u0007.pdf" }] })).toBe("invalid_file");
    // bidi overrides are refused in a name that is sent back from the browser too (the route already cleaned the real upload's name)
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "scan‮fdp.exe.pdf" }] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "a​b.pdf" }] })).toBe("invalid_file");
    expect(firstMessage(letterRegisterSchema, { ...outgoing, files: "surat.pdf" })).toBe("invalid_file");
    ok(letterRegisterSchema, { ...outgoing, files: [{ path: PATH, name: "n".repeat(200) }] });
  });

  it("update: version required and positive, the number and type are never inputs", () => {
    const upd = { type: "incoming", letterId: ID, version: 2, subject: "x", counterpart: "y", receivedDate: "2026-11-10" };
    ok(letterUpdateSchema, upd);
    for (const version of [0, -1, 1.5, "2", null, undefined]) expect(letterUpdateSchema.safeParse({ ...upd, version }).success, String(version)).toBe(false);
    expect(letterUpdateSchema.safeParse({ ...upd, letterId: "not-a-uuid" }).success).toBe(false);
    // unknown keys are dropped, so a client cannot smuggle numberText / letterType / periodId into the call
    const parsed = letterUpdateSchema.parse({ ...upd, numberText: "PMK/NEX/SK/2026/999", number: "x", periodId: ID, status: "voided" });
    expect(Object.keys(parsed)).not.toEqual(expect.arrayContaining(["numberText", "number", "periodId", "status"]));
  });

  it("void and withdraw need a reason (blank refused, 500 allowed, 501 refused); reject needs a note", () => {
    ok(letterVoidSchema, { letterId: ID, version: 1, reason: "Salah catat" });
    expect(firstMessage(letterVoidSchema, { letterId: ID, version: 1, reason: "" })).toBe("reason_required");
    expect(firstMessage(letterVoidSchema, { letterId: ID, version: 1, reason: "  \n " })).toBe("reason_required");
    expect(firstMessage(letterVoidSchema, { letterId: ID, version: 1 })).toBe("reason_required");
    ok(letterVoidSchema, { letterId: ID, version: 1, reason: "r".repeat(500) });
    expect(firstMessage(letterVoidSchema, { letterId: ID, version: 1, reason: "r".repeat(501) })).toBe("text_too_long");
    expect(firstMessage(letterWithdrawFileSchema, { fileId: 7, version: 1, reason: "" })).toBe("reason_required");
    for (const fileId of [0, -3, 1.2, "7", Number.MAX_SAFE_INTEGER + 1]) expect(letterWithdrawFileSchema.safeParse({ fileId, version: 1, reason: "x" }).success, String(fileId)).toBe(false);
    ok(letterWithdrawFileSchema, { fileId: 7, version: 1, reason: "Salah berkas" });
    expect(firstMessage(letterRequestRejectSchema, { requestId: ID, version: 1, note: "" })).toBe("note_required");
    expect(firstMessage(letterRequestRejectSchema, { requestId: ID, version: 1, note: "   " })).toBe("note_required");
    expect(firstMessage(letterRequestRejectSchema, { requestId: ID, version: 1, note: "n".repeat(501) })).toBe("text_too_long");
    ok(letterRequestRejectSchema, { requestId: ID, version: 1, note: "Kegiatan dibatalkan" });
  });

  it("request: three required fields, the optional ones, up to 3 attachments; the requester and period are not inputs (LT-07)", () => {
    const req = { subject: "Izin aula", addressee: "Rektor", purpose: "Kebaktian akhir tahun" };
    ok(letterRequestCreateSchema, req);
    expect(firstMessage(letterRequestCreateSchema, { ...req, subject: "" })).toBe("text_required");
    expect(firstMessage(letterRequestCreateSchema, { ...req, addressee: " " })).toBe("text_required");
    expect(firstMessage(letterRequestCreateSchema, { ...req, purpose: "" })).toBe("text_required");
    ok(letterRequestCreateSchema, { subject: "s".repeat(200), addressee: "a".repeat(150), purpose: "p".repeat(1000), onBehalfOf: "o".repeat(120) });
    expect(firstMessage(letterRequestCreateSchema, { ...req, purpose: "p".repeat(1001) })).toBe("text_too_long");
    expect(firstMessage(letterRequestCreateSchema, { ...req, addressee: "a".repeat(151) })).toBe("text_too_long");
    expect(firstMessage(letterRequestCreateSchema, { ...req, onBehalfOf: "o".repeat(121) })).toBe("text_too_long");
    expect(firstMessage(letterRequestCreateSchema, { ...req, neededBy: "2026-02-30" })).toBe("invalid_dates");
    expect(letterRequestCreateSchema.parse({ ...req, neededBy: "" })).toMatchObject({ neededBy: null, onBehalfOf: null, files: [] });
    const parsed = letterRequestCreateSchema.parse({ ...req, requesterMemberId: ID, requester_member_id: ID, periodId: ID, status: "issued" });
    expect(JSON.stringify(parsed)).not.toContain(ID);
    expect(firstMessage(letterRequestCreateSchema, { ...req, files: [1, 2, 3, 4].map((n) => ({ path: path(n), name: `${n}.pdf` })) })).toBe("file_count");
  });

  it("Terbitkan: at least one file, the letter version is required next to the request version (LT-13)", () => {
    const issue = { requestId: ID, version: 3, letterVersion: 1, subject: "Perihal", addressee: "Tujuan", letterDate: "2026-11-10", files: [FILE] };
    ok(letterRequestIssueSchema, issue);
    expect(firstMessage(letterRequestIssueSchema, { ...issue, files: [] })).toBe("file_required");
    expect(letterRequestIssueSchema.safeParse({ ...issue, letterVersion: undefined }).success).toBe(false);
    expect(firstMessage(letterRequestIssueSchema, { ...issue, letterDate: "" })).toBe("date_required");
    expect(firstMessage(letterRequestIssueSchema, { ...issue, subject: " " })).toBe("text_required");
  });

  it("numbering format: allowed characters, 1..6 digits, one of / - . as separator, the two codes differ (case-insensitive)", () => {
    const fmt = { version: 1, prefix: "PMK/NEX", incomingCode: "SM", outgoingCode: "SK", seqDigits: 3, separator: "/" };
    ok(numberingFormatUpdateSchema, fmt);
    for (const prefix of ["", " ", "PMK NEX", "PMK|NEX", "PMK\\NEX", "PMK_NEX", "é", "<b>", "x".repeat(31)]) {
      expect(numberingFormatUpdateSchema.safeParse({ ...fmt, prefix }).success, JSON.stringify(prefix)).toBe(false);
    }
    ok(numberingFormatUpdateSchema, { ...fmt, prefix: "A.B-C/D", incomingCode: "I-1", outgoingCode: "O-1" });
    ok(numberingFormatUpdateSchema, { ...fmt, prefix: "x".repeat(30), incomingCode: "x".repeat(10), outgoingCode: "y".repeat(10) });
    expect(numberingFormatUpdateSchema.safeParse({ ...fmt, incomingCode: "x".repeat(11) }).success).toBe(false);
    for (const seqDigits of [0, 7, 2.5, -1, "3", null]) expect(numberingFormatUpdateSchema.safeParse({ ...fmt, seqDigits }).success, String(seqDigits)).toBe(false);
    for (const separator of ["|", "", "//", " ", "_", ",", "\\"]) expect(numberingFormatUpdateSchema.safeParse({ ...fmt, separator }).success, JSON.stringify(separator)).toBe(false);
    const same = numberingFormatUpdateSchema.safeParse({ ...fmt, incomingCode: "SK", outgoingCode: "sk" });
    expect(same.success).toBe(false);
    if (!same.success) expect(same.error.issues[0]).toMatchObject({ message: "invalid_number_format", path: ["codes"] });
  });

  it("'Atur nomor berikutnya': a whole number 1..9 999 999, a year 2000..2999, a reason is required (LT-51)", () => {
    const next = { type: "outgoing", year: 2026, nextSeq: 46, reason: "Melanjutkan dari buku surat" };
    ok(numberingSetNextSchema, next);
    ok(numberingSetNextSchema, { ...next, nextSeq: 9_999_999 });
    for (const nextSeq of [0, -5, 1.5, 10_000_000, "46", null, Number.NaN]) expect(numberingSetNextSchema.safeParse({ ...next, nextSeq }).success, String(nextSeq)).toBe(false);
    for (const year of [1999, 3000, 2026.5, "2026"]) expect(numberingSetNextSchema.safeParse({ ...next, year }).success, String(year)).toBe(false);
    expect(firstMessage(numberingSetNextSchema, { ...next, reason: "" })).toBe("reason_required");
    expect(firstMessage(numberingSetNextSchema, { ...next, reason: "   " })).toBe("reason_required");
    expect(numberingSetNextSchema.safeParse({ ...next, type: "x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("search and list filters (A-LT15, LT-25)", () => {
  it("search: trimmed, inner spaces collapsed, blank = no search, 120 characters allowed, 121 refused, raw above 480 refused first", () => {
    expect(letterSearchSchema.parse("  rapat   koordinasi \n")).toBe("rapat koordinasi");
    expect(letterSearchSchema.parse("   ")).toBeNull();
    expect(letterSearchSchema.parse("")).toBeNull();
    expect(letterSearchSchema.parse("x".repeat(120))).toBe("x".repeat(120));
    expect(firstMessage(letterSearchSchema, "x".repeat(121))).toBe("search_too_long");
    expect(firstMessage(letterSearchSchema, "x".repeat(481))).toBe("search_too_long");
    // 130 characters that collapse below 120 are fine, but 481 raw characters are refused even if they collapse
    expect(letterSearchSchema.parse(`${"a ".repeat(60)}${" ".repeat(5)}`)).toBe("a ".repeat(60).trim());
    expect(firstMessage(letterSearchSchema, " ".repeat(481))).toBe("search_too_long");
    // special characters are kept as typed (the database treats % and _ literally; the schema must not "clean" them)
    expect(letterSearchSchema.parse("100%_asli")).toBe("100%_asli");
    expect(letterSearchSchema.parse("'; drop table nexus.letters; --")).toBe("'; drop table nexus.letters; --");
    expect(letterSearchSchema.safeParse(42).success).toBe(false);
  });

  it("list query: defaults (page 1, 20 rows, active period, all statuses), page size at most 50 (refused, not clamped)", () => {
    const parsed = letterListQuerySchema.parse({ filters: { type: "incoming" } });
    expect(parsed).toMatchObject({ page: 1, pageSize: 20, filters: { type: "incoming", search: null, period: "active", year: null, status: "all", withoutFiles: false } });
    ok(letterListQuerySchema, { filters: { type: "outgoing" }, pageSize: 50 });
    for (const pageSize of [0, 51, 1.5, "20", -1]) expect(letterListQuerySchema.safeParse({ filters: { type: "incoming" }, pageSize }).success, String(pageSize)).toBe(false);
    for (const page of [0, -1, 1.5, "2"]) expect(letterListQuerySchema.safeParse({ filters: { type: "incoming" }, page }).success, String(page)).toBe(false);
    for (const filters of [{ type: "diary" }, { type: "incoming", period: "2025/2026" }, { type: "incoming", status: "weird" }, { type: "incoming", year: 1999 }, { type: "incoming", year: 3000 }, { type: "incoming", year: 2026.5 }, { type: "incoming", withoutFiles: "yes" }, {}]) {
      expect(letterListQuerySchema.safeParse({ filters }).success, JSON.stringify(filters)).toBe(false);
    }
  });

  it("queue query: default view, dates come as a pair and in order", () => {
    expect(letterQueueQuerySchema.parse({})).toMatchObject({ page: 1, filters: { view: "submitted", search: null, from: null, to: null } });
    ok(letterQueueQuerySchema, { filters: { view: "open_all_periods", from: "2026-01-01", to: "2026-01-01" } });
    for (const filters of [{ from: "2026-01-01" }, { to: "2026-01-01" }, { from: "2026-02-01", to: "2026-01-01" }, { view: "everything" }, { from: "2026-13-01", to: "2026-14-01" }]) {
      expect(letterQueueQuerySchema.safeParse({ filters }).success, JSON.stringify(filters)).toBe(false);
    }
    expect(defaultLetterQueueView(letterCapabilities(member(["letter_requests.process"])))).toBe("submitted");
    expect(defaultLetterQueueView(letterCapabilities(member(["letter_requests.view_all"])))).toBe("all");
  });

  it("export body: a format and the filters of the screen; nothing else needed", () => {
    ok(letterExportSchema, { format: "csv", filters: { type: "incoming" } });
    for (const format of ["xlsx", "csv", "pdf"]) ok(letterExportSchema, { format, filters: { type: "outgoing", status: "voided", year: 2026, withoutFiles: true } });
    for (const body of [{ filters: { type: "incoming" } }, { format: "docx", filters: { type: "incoming" } }, { format: "CSV", filters: { type: "incoming" } }, { format: "csv" }, { format: "csv", filters: {} }]) {
      expect(letterExportSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("server input helpers: the FIRST zod issue becomes the contract error (validation.ts)", () => {
  it("a known code keeps its code and names the field; anything else is invalid_input for the first key", () => {
    const parsed = parseInput(letterRegisterSchema, { type: "incoming", subject: "", counterpart: "x", receivedDate: "2026-11-10" });
    expect(parsed).toEqual({ ok: false, error: { code: "text_required", field: "subject" } });
    expect(parseInput(letterRegisterSchema, { type: "outgoing", subject: "s", counterpart: "c", letterDate: "" })).toEqual({ ok: false, error: { code: "date_required", field: "letterDate" } });
    expect(parseInput(letterVoidSchema, { letterId: ID, version: 1, reason: " " })).toEqual({ ok: false, error: { code: "reason_required", field: "reason" } });
    expect(parseInput(letterVoidSchema, { letterId: "nope", version: 1, reason: "x" })).toEqual({ ok: false, error: { code: "invalid_input", field: "letterId" } });
    expect(parseInput(letterRegisterSchema, { type: "diary" })).toEqual({ ok: false, error: { code: "invalid_input", field: "type" } });
    expect(parseInput(letterRegisterSchema, "not an object")).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(parseInput(letterRegisterSchema, null)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(parseInput(letterRegisterSchema, undefined)).toMatchObject({ ok: false });
  });
  it("file errors carry the count or the offending upload path (the form marks that tile)", () => {
    const many = [1, 2, 3, 4].map((n) => ({ path: path(n), name: `${n}.pdf` }));
    expect(parseInput(letterRegisterSchema, { type: "outgoing", subject: "s", counterpart: "c", letterDate: "2026-11-10", files: many })).toEqual({
      ok: false,
      error: { code: "file_count", field: "files", count: 3 },
    });
    expect(parseInput(letterAddFilesSchema, { letterId: ID, version: 1, files: [] })).toEqual({ ok: false, error: { code: "file_required", field: "files", count: 1 } });
    const dup = parseInput(letterRegisterSchema, { type: "outgoing", subject: "s", counterpart: "c", letterDate: "2026-11-10", files: [FILE, FILE] });
    expect(dup).toMatchObject({ ok: false, error: { code: "invalid_file", field: "files" } });
  });
  it("a prototype-looking message never resolves through the hint table (BUG-MD-01 pattern)", () => {
    const schema = z.object({ a: z.string().refine(() => false, { message: "constructor" }) });
    const parsed = schema.safeParse({ a: "x" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(inputError(parsed.error, { a: "x" })).toEqual({ code: "invalid_input", field: "request" });
    const toString = z.object({ a: z.string().refine(() => false, { message: "toString" }) }).safeParse({ a: "x" });
    if (!toString.success) expect(inputError(toString.error, {})).toMatchObject({ code: "invalid_input" });
  });
  it("an empty issue list is invalid_input on the request, never a crash", () => {
    expect(inputError(new z.ZodError([]), {})).toEqual({ code: "invalid_input", field: "request" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("capabilities and segments per persona (spec section 2; LT-01..LT-04, LT-46)", () => {
  // Keys exactly as my_permissions() would return them: the union with the implied keys already added.
  const PERSONA = {
    sekjen: member(["letters.view", "letters.manage", "letters.export", "letter_requests.view_all", "letter_requests.process"]),
    ketum: member(["letters.view", "letters.export", "letter_requests.view_all"]),
    sekdep: member([]),
    plain: member([]),
    admin: member([], { admin: true }),
  };
  it("BPH secretary: everything, including the numbering page read-only", () => {
    const c = letterCapabilities(PERSONA.sekjen);
    expect(c).toMatchObject({ canViewRegister: true, canManageRegister: true, canRegister: true, canExportRegister: true, canViewOwnRequests: true, canSubmitRequest: true, canViewAllRequests: true, canProcessRequests: true, canReadNumbering: true, canEditNumbering: false, canUploadFiles: true, hasActivePeriod: true });
    expect(letterSegments(c)).toEqual(["incoming", "outgoing", "mine", "queue"]);
  });
  it("other BPH (view only): register, queue and export, but no write and no processing, no numbering page", () => {
    const c = letterCapabilities(PERSONA.ketum);
    expect(c).toMatchObject({ canViewRegister: true, canManageRegister: false, canRegister: false, canExportRegister: true, canViewAllRequests: true, canProcessRequests: false, canReadNumbering: false, canEditNumbering: false });
    expect(letterSegments(c)).toEqual(["incoming", "outgoing", "mine", "queue"]);
  });
  it("department secretary, plain member, lecturer: only 'Permohonan Saya' and 'Ajukan Surat'", () => {
    for (const state of [PERSONA.sekdep, PERSONA.plain]) {
      const c = letterCapabilities(state);
      expect(c).toMatchObject({ canViewRegister: false, canManageRegister: false, canExportRegister: false, canViewAllRequests: false, canProcessRequests: false, canViewOwnRequests: true, canSubmitRequest: true, canReadNumbering: false });
      expect(letterSegments(c)).toEqual(["mine"]);
    }
  });
  it("System Admin without a position: no register, but edits the numbering (L3)", () => {
    const c = letterCapabilities(PERSONA.admin);
    expect(c).toMatchObject({ canViewRegister: false, canManageRegister: false, canReadNumbering: true, canEditNumbering: true, canSubmitRequest: true });
    expect(letterSegments(c)).toEqual(["mine"]);
  });
  it("a manager without a view key still holds the numbering read right; the export key needs the view key (R15)", () => {
    expect(letterCapabilities(member(["letters.manage"])).canReadNumbering).toBe(true);
    expect(letterCapabilities(member(["letters.export"])).canExportRegister).toBe(false);
    expect(letterCapabilities(member(["letters.view", "letters.export"])).canExportRegister).toBe(true);
  });
  it("keys limited to units count for nothing: letters carry no org unit, scope 'all' only", () => {
    const state: AccessState = { ...member([]), permissions: [grant("letters.view", "units"), grant("letters.manage", "units"), grant("letter_requests.process", "units")] } as AccessState;
    expect(letterCapabilities(state)).toMatchObject({ canViewRegister: false, canManageRegister: false, canProcessRequests: false });
  });
  it("no active period: rule-based rights are gone from the buttons, the fixed right to see own requests stays (R7, LT-31)", () => {
    const c = letterCapabilities(member(["letters.view", "letters.manage", "letter_requests.process"], { period: false }));
    expect(c).toMatchObject({ hasActivePeriod: false, canRegister: false, canSubmitRequest: false, canUploadFiles: false, canViewOwnRequests: true });
  });
  it("deactivated, unlinked, anonymous and error states get nothing at all (LT-04)", () => {
    const none = { canViewRegister: false, canManageRegister: false, canRegister: false, canExportRegister: false, canViewOwnRequests: false, canSubmitRequest: false, canViewAllRequests: false, canProcessRequests: false, canReadNumbering: false, canEditNumbering: false, canUploadFiles: false, hasActivePeriod: false };
    for (const state of [{ kind: "anonymous" }, { kind: "no_access" }, { kind: "password_pending" }, { kind: "error" }] as AccessState[]) {
      expect(letterCapabilities(state), state.kind).toEqual(none);
      expect(letterSegments(letterCapabilities(state)), state.kind).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("request stages and helpers", () => {
  it("Diproses with a number is 'waiting for the file'; Diterbitkan with a voided number is flagged; others follow the status", () => {
    expect(letterRequestStage({ status: "submitted", numberText: null })).toBe("submitted");
    expect(letterRequestStage({ status: "processing", numberText: null })).toBe("processing");
    expect(letterRequestStage({ status: "processing", numberText: "PMK/NEX/SK/2026/001" })).toBe("awaiting_file");
    expect(letterRequestStage({ status: "issued", numberText: "PMK/NEX/SK/2026/001" })).toBe("issued");
    expect(letterRequestStage({ status: "issued", numberText: "PMK/NEX/SK/2026/001", numberVoided: true })).toBe("issued_number_voided");
    expect(letterRequestStage({ status: "rejected", numberText: "PMK/NEX/SK/2026/001" })).toBe("rejected");
    expect(letterRequestStage({ status: "cancelled", numberText: null })).toBe("cancelled");
  });
  it("the last visible file of a letter that came from a request cannot be withdrawn (G4, LT-50)", () => {
    expect(isLastIssuedFile({ fromRequest: true, fileCount: 1 })).toBe(true);
    expect(isLastIssuedFile({ fromRequest: true, fileCount: 0 })).toBe(true);
    expect(isLastIssuedFile({ fromRequest: true, fileCount: 2 })).toBe(false);
    expect(isLastIssuedFile({ fromRequest: false, fileCount: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("database hints -> contract errors (fail closed) and the Indonesian copy", () => {
  it("business refusals map to their own code, with the right payloads", () => {
    expect(mapLetterDbError({ code: "P0001", hint: "state_changed" })).toEqual({ code: "state_changed" });
    expect(mapLetterDbError({ code: "P0001", hint: "no_active_period" })).toEqual({ code: "no_active_period" });
    expect(mapLetterDbError({ code: "42501", hint: "self_processing_blocked" })).toEqual({ code: "self_processing_blocked" });
    expect(mapLetterDbError({ code: "42501", hint: "closed_period" })).toEqual({ code: "closed_period" });
    expect(mapLetterDbError({ code: "42501", hint: "permission_required" })).toEqual({ code: "forbidden" });
    expect(mapLetterDbError({ code: "P0001", hint: "request_open" })).toEqual({ code: "request_open" });
    expect(mapLetterDbError({ code: "P0001", hint: "number_not_taken" })).toEqual({ code: "number_not_taken" });
    expect(mapLetterDbError({ code: "P0001", hint: "last_issued_file" })).toEqual({ code: "last_issued_file" });
    expect(mapLetterDbError({ code: "P0001", hint: "too_many_open_requests", details: "5" })).toEqual({ code: "too_many_open_requests", limit: 5 });
    expect(mapLetterDbError({ code: "P0001", hint: "daily_request_limit", details: "10" })).toEqual({ code: "daily_request_limit", limit: 10 });
    expect(mapLetterDbError({ code: "P0001", hint: "daily_request_limit" })).toEqual({ code: "daily_request_limit", limit: 10 }); // limit falls back to the owner's number
    expect(mapLetterDbError({ code: "23505", hint: "duplicate_number", details: "045/PMK/SK/X/2025" })).toEqual({ code: "duplicate_number", numberText: "045/PMK/SK/X/2025" });
    expect(mapLetterDbError({ code: "P0002", hint: "letter_not_found" })).toEqual({ code: "not_found", entity: "letter" });
    expect(mapLetterDbError({ code: "P0002", hint: "request_not_found" })).toEqual({ code: "not_found", entity: "request" });
    expect(mapLetterDbError({ code: "P0002", hint: "file_not_found" })).toEqual({ code: "not_found", entity: "file" });
  });
  it("input refusals name the field from the database detail", () => {
    expect(mapLetterDbError({ code: "22023", hint: "text_too_long", details: "subject" })).toEqual({ code: "text_too_long", field: "subject" });
    expect(mapLetterDbError({ code: "22023", hint: "date_in_future", details: "letter_date" })).toEqual({ code: "date_in_future", field: "letterDate" });
    expect(mapLetterDbError({ code: "22023", hint: "date_in_past", details: "needed_by" })).toEqual({ code: "date_in_past", field: "neededBy" });
    expect(mapLetterDbError({ code: "22023", hint: "file_count", details: "3" })).toEqual({ code: "file_count", field: "files", count: 3 });
    expect(mapLetterDbError({ code: "22023", hint: "invalid_file", details: PATH })).toEqual({ code: "invalid_file", field: "files", ref: PATH });
    // a detail that is not a well-formed upload path is never echoed
    expect(mapLetterDbError({ code: "22023", hint: "invalid_file", details: "../../etc/passwd" })).toEqual({ code: "invalid_file", field: "files", ref: null });
    expect(mapLetterDbError({ code: "22023", hint: "file_too_large", details: PATH })).toEqual({ code: "file_too_large", field: "files", ref: PATH, maxMb: 5 });
  });
  it("an unknown or missing hint, a bug-only hint, a prototype name and an unexpected SQLSTATE are 'unavailable' (never 'no access', never 'no rows')", () => {
    const unavailable = { code: "unavailable" };
    expect(mapLetterDbError({ code: "P0001", hint: "something_new" })).toEqual(unavailable);
    expect(mapLetterDbError({ code: "P0001" })).toEqual(unavailable);
    expect(mapLetterDbError({})).toEqual(unavailable);
    expect(mapLetterDbError({ code: "P0001", hint: null })).toEqual(unavailable);
    for (const hint of ["immutable_column", "invalid_transition", "export_log_direct_insert", "append_only", "numbering_exhausted", "year_required"]) {
      expect(mapLetterDbError({ code: "P0001", hint }), hint).toEqual(unavailable);
    }
    for (const hint of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) expect(mapLetterDbError({ code: "P0001", hint }), hint).toEqual(unavailable);
    for (const code of ["08006", "57P01", "PGRST301", "XX000", "42P01", "42883", "", "500"]) expect(mapLetterDbError({ code, hint: "state_changed" }), code).toEqual(unavailable);
  });
  it("buildLetterError never invents a not_found (it needs the entity)", () => {
    expect(buildLetterError("not_found", "request", null)).toBeNull();
    expect(buildLetterError("upload_limit", "request", null)).toEqual({ code: "upload_limit", limit: 10 });
  });
  it("every hint in the table leads to a code that has copy (or is explicitly per-field/per-action)", () => {
    for (const [hint, code] of Object.entries(LETTER_DB_HINTS)) {
      expect(Object.hasOwn(LETTER_ERROR_COPY, code), `${hint} -> ${code}`).toBe(true);
    }
  });
  it("copy: the owner's wording for the caps, the stale-data message, the own-request block, the number-first rule", () => {
    const msg = (code: LetterErrorCode, extra: object = {}) => letterErrorMessage({ code, ...extra } as never, "read");
    expect(msg("state_changed")).toBe("Data sudah berubah. Muat ulang.");
    expect(msg("self_processing_blocked")).toBe("Tidak bisa memproses permohonanmu sendiri. Sekretaris lain yang memutuskan.");
    expect(msg("too_many_open_requests", { limit: 5 })).toBe("Kamu sudah punya 5 permohonan yang berjalan. Tunggu salah satunya selesai atau batalkan dulu.");
    expect(msg("daily_request_limit", { limit: 10 })).toBe("Batas permohonan hari ini sudah tercapai (10). Coba lagi besok.");
    expect(msg("number_not_taken")).toBe("Ambil nomor dulu sebelum menerbitkan surat.");
    expect(msg("duplicate_number", { numberText: "x" })).toBe("Nomor ini sudah ada di register.");
    expect(msg("file_count", { field: "files", count: 3 })).toBe("Maksimal 3 berkas.");
    expect(msg("invalid_file", { field: "file", ref: null })).not.toBe(""); // a saved path that is bad is a bug: generic text
    expect(msg("file_too_large", { field: "file", ref: null, maxMb: 5 })).toBe("Berkas terlalu besar. Batasnya 5 MB. Perkecil dulu atau pilih berkas lain.");
    expect(msg("unauthenticated")).toBeNull(); // redirect to login, no text
    // No copy ever contains a raw database word or a stack
    for (const text of Object.values(LETTER_ERROR_COPY)) if (text) expect(text).not.toMatch(/nexus\.|postgres|sql|exception|undefined|\[object/i);
  });
  it("copy per action: the number taken before issuing is explained, a failed issue keeps the number", () => {
    expect(letterErrorMessage({ code: "unavailable" }, "takeNumber")).toBe("Nomor belum diambil. Tidak ada nomor yang terpakai. Coba lagi.");
    expect(letterErrorMessage({ code: "unavailable" }, "issue")).toBe("Surat belum terbit. Berkas belum tersimpan, nomor tetap milik permohonan ini. Coba lagi.");
    expect(letterErrorMessage({ code: "unavailable" }, "uploadLetterFile")).toBe("Berkas gagal diunggah. Coba lagi.");
    expect(letterErrorMessage({ code: "unavailable" }, "read")).toBe("Terjadi gangguan. Coba lagi sebentar lagi.");
    expect(letterErrorMessage({ code: "no_active_period" }, "submitRequest")).toBe("Belum ada periode aktif. Permohonan belum bisa dibuat.");
    expect(letterErrorMessage({ code: "no_active_period" }, "register")).toBe("Belum ada periode aktif. Surat belum bisa dicatat.");
    expect(letterErrorMessage({ code: "reason_required", field: "reason" }, "void")).toBe("Tulis alasan pembatalan.");
    expect(letterErrorMessage({ code: "reason_required", field: "reason" }, "withdrawFile")).toBe("Tulis kenapa berkas ini ditarik.");
    expect(letterErrorMessage({ code: "note_required", field: "note" }, "reject")).toBe("Tulis alasan penolakan, supaya pemohon tahu.");
    expect(letterErrorMessage({ code: "invalid_input", field: "search" }, "read")).toBe("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.");
  });
  it("field copy: names the right label for incoming (Pengirim) and outgoing (Ditujukan kepada), pads the sequence", () => {
    expect(letterErrorMessage({ code: "text_required", field: "counterpart" }, "register", { letterType: "incoming" })).toBe("Isi pengirim.");
    expect(letterErrorMessage({ code: "text_required", field: "counterpart" }, "register", { letterType: "outgoing" })).toBe("Isi tujuan surat.");
    expect(letterErrorMessage({ code: "text_too_long", field: "subject" }, "register", { letterType: "incoming" })).toBe("Perihal terlalu panjang. Pakai paling banyak 200 karakter.");
    expect(letterErrorMessage({ code: "text_too_long", field: "purpose" }, "submitRequest")).toBe("Keperluan terlalu panjang. Pakai paling banyak 1000 karakter.");
    expect(letterErrorMessage({ code: "sequence_not_higher", lastUsed: 45 }, "numberingSetNext", { seqDigits: 3 })).toBe("Isi angka bulat yang lebih besar dari 045.");
    expect(letterErrorMessage({ code: "sequence_not_higher", lastUsed: null }, "numberingSetNext")).toBe("Terjadi gangguan. Coba lagi sebentar lagi.");
    expect(letterErrorMessage({ code: "format_collision", numberText: "PMK/NEX/SK/2026/012" }, "numberingFormat")).toBe("Format ini menghasilkan nomor yang sudah dipakai (PMK/NEX/SK/2026/012). Ubah formatnya.");
    expect(letterFieldName("counterpart", "register", "incoming")).toBe("Pengirim");
    expect(letterFieldName("counterpart", "register", "outgoing")).toBe("Ditujukan kepada");
    expect(letterFieldName("counterpart", "register")).toBeNull();
    expect(letterFieldName("note", "reject")).toBe("Alasan penolakan");
    expect(letterFieldName("note", "issue")).toBe("Catatan");
  });
  it("formatLetterCopy fills known placeholders and leaves unknown ones, even a hostile key", () => {
    expect(formatLetterCopy("{a} dan {b}", { a: 1, b: "dua" })).toBe("1 dan dua");
    expect(formatLetterCopy("{x}", { a: 1 })).toBe("{x}");
    expect(formatLetterCopy("{constructor} {toString}", {})).toBe("{constructor} {toString}");
    expect(formatLetterCopy("{a}", { a: "$&" })).toBe("$&"); // no regex replacement patterns leak in
  });
  it("status labels are the owner's words (Aktif / Dibatalkan), not the Stitch filler", () => {
    expect(LETTER_STATUS_LABEL).toEqual({ active: "Aktif", voided: "Dibatalkan" });
  });
});
