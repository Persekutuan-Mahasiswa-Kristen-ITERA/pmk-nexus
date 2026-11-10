// Contract between the Finance backend (src/lib/picore/finance.ts, src/modules/finance/server) and the UI
// (src/modules/finance/ui, src/app). Written 2026-11-10 by the backend engineer.
// Change it only after telling the tech lead: both sides depend on it.
//
// Spec:     docs/modules/finance.md (APPROVED 2026-11-09, K1-K6 a, D-028; amended 2026-11-10: Saldo awal
//           may be Rp 0, A-FN1; correction link to any Aktif entry, A-FN8). Screens and copy: spec section 7.
// Database: supabase/migrations/20261111200000_nexus_finance.sql (9 public nexus.finance_* functions +
//           2 storage checks) and 20261111200100_nexus_finance_storage.sql (bucket nexus-finance-proofs).
//           Reference: supabase/README.md section 3.4 (hints, money rules).
// Access:   docs/modules/access-control.md keys finance.view / finance.manage / finance.export (scope "all"
//           only, sensitive, L12). Rules D02, D03, D24, D25.
//
// Pure and isomorphic: safe to import from Server Components, Client Components and route handlers.
// Stored values are the database's English identifiers; Indonesian labels are in section 10.
// No type here holds email, phone, NIM, NIP, auth user ids or member ids (access control L4). Storage
// paths of SAVED proofs never reach the browser: FinanceEntryDetailAnswer.proofPaths is server only and
// links come from getFinanceProofLink(). Only the path of the caller's own fresh upload travels.
//
// MONEY (spec 4.2, FN-08, FN-09; owner 2026-11-10). Amounts are whole rupiah. They travel as TEXT of ASCII
// digits end to end ("1250000"), exactly what nexus._fn_parse_amount accepts, and are never parsed into a
// JS number on the way IN. Display formatting is string based (groupRupiahDigits / formatRupiah). The
// only Number conversion is rupiahToSafeInteger() for export cells, guarded by Number.isSafeInteger.
// Database answers (bigint as JSON numbers) are checked to be safe integers and turned into text at once.
//
// Zod issue messages in this file are machine codes (FinanceErrorCode), never shown to people.
// financeErrorFromZod() turns the FIRST issue into a FinanceError; financeErrorFromDb() maps a database
// refusal by its hint only. Unknown hints, missing hints and bugs answer `unavailable` (fail closed).

import { z } from "zod";
import type { AccessState } from "@/lib/auth/types";

// =============================================================================================
// 1. Limits, addresses and routes (mirror the database CHECKs and functions; the database checks again)
// =============================================================================================

export const FINANCE_LIMITS = {
  /** Keterangan: one line, whitespace collapsed (A-FN5, _fn_text). */
  description: 200,
  /** Catatan: line breaks kept (A-FN5, _fn_long_text). */
  notes: 500,
  /** Void reason and withdraw reason (one line). */
  reason: 500,
  /** Original file name stored with a proof (1..200, no control characters). */
  fileName: 200,
  /** Visible (not withdrawn) proofs per entry (K5 a, A-FN6). */
  filesPerEntry: 3,
  /** Bucket and database limit per file: 5 MiB. */
  fileMaxBytes: 5_242_880,
  /** Unattached uploads per member in the last 24 hours (finance_proof_can_upload). The 11th is refused. */
  unattachedUploadsPer24h: 10,
  /** Dates before this are refused by the database. */
  minDate: "2000-01-01",
  /** finance_export refuses more matching rows than this (too_many_rows), before any log row. */
  exportMaxRows: 1000,
} as const;

/** Rows per page on screen (A-FN13) and the hard server maximum (refused, never clamped). */
export const FINANCE_PAGE_SIZE_DEFAULT = 20;
export const FINANCE_PAGE_SIZE_MAX = 50;
/** Search: max length after trimming and collapsing spaces; raw input above 480 is refused first. */
export const FINANCE_SEARCH_MAX_LENGTH = 120;
export const FINANCE_SEARCH_RAW_MAX_LENGTH = 480;

/**
 * Query parameter names (short English names like the other modules). The address is user-editable:
 * the UI falls back to defaults, the server validates again.
 *   period  = a period id (absent = the active period)
 *   type    = FinanceTypeFilter ("all" default)
 *   from/to = "YYYY-MM-DD", either may be absent
 *   voided  = "1": "Tampilkan yang dibatalkan"
 *   noproof = "1": "Tanpa bukti"
 *   correct = entry id: the record form opened by "Buat koreksi" (screen 5)
 *   again   = entry id: the record or opening form opened by "Catat ulang" (screen 5)
 *   notice  = a one-time success notice (FinanceNotice)
 */
export const FINANCE_PARAMS = {
  search: "q",
  period: "period",
  type: "type",
  from: "from",
  to: "to",
  includeVoided: "voided",
  withoutProof: "noproof",
  page: "page",
  correct: "correct",
  again: "again",
  notice: "notice",
} as const;

/**
 * Screens (spec 7) and route handlers. One list, no tabs, so there is no segments function: the drawer
 * item "Finance" shows only for finance.view holders (D-021) and every page checks again.
 * The base path is "/finance" as written in spec screen 1 (label "Finance", A-FN12).
 */
export const FINANCE_ROUTES = {
  /** Screen 1, list with tiles. */
  list: "/finance",
  /** Screen 3 (and 5), record income or expense: canRecord. */
  record: "/finance/catat",
  /** Screen 4, record the opening balance: canRecord. */
  opening: "/finance/saldo-awal",
  /** POST, multipart upload of one proof (section 5). */
  proofUpload: "/api/finance/proofs",
  /** POST, export (section 13). */
  export: "/api/finance/export",
} as const;

/** Drawer item (D-021): for finance.view holders only. */
export const FINANCE_NAV_ITEM = { href: FINANCE_ROUTES.list, label: "Finance" } as const;

/** Screen 2, detail. */
export function financeEntryPath(entryId: string): string {
  return `${FINANCE_ROUTES.list}/${encodeURIComponent(entryId)}`;
}

/** Screen 5 "Buat koreksi": the record form with the link to an old-period entry. */
export function financeCorrectionPath(entryId: string): string {
  return `${FINANCE_ROUTES.record}?${FINANCE_PARAMS.correct}=${encodeURIComponent(entryId)}`;
}

/** Screen 5 "Catat ulang": a copy of a voided entry; an opening goes back to the opening form. */
export function financeRerecordPath(entry: { entryId: string; entryType: FinanceEntryType }): string {
  const base = entry.entryType === "opening" ? FINANCE_ROUTES.opening : FINANCE_ROUTES.record;
  return `${base}?${FINANCE_PARAMS.again}=${encodeURIComponent(entry.entryId)}`;
}

// =============================================================================================
// 2. Enums (exactly the values stored or accepted by the database)
// =============================================================================================

/** income = Pemasukan, expense = Pengeluaran, opening = Saldo awal (one Aktif per period). */
export const FINANCE_ENTRY_TYPES = ["income", "expense", "opening"] as const;
export const financeEntryTypeSchema = z.enum(FINANCE_ENTRY_TYPES, { message: "invalid_input" });
export type FinanceEntryType = z.infer<typeof financeEntryTypeSchema>;

/** List / export "Jenis" filter. */
export const financeTypeFilterSchema = z.enum(["all", "income", "expense", "opening"], { message: "invalid_input" });
export type FinanceTypeFilter = z.infer<typeof financeTypeFilterSchema>;

/** active = Aktif, voided = Dibatalkan (never restored, R1). */
export const financeEntryStatusSchema = z.enum(["active", "voided"]);
export type FinanceEntryStatus = z.infer<typeof financeEntryStatusSchema>;

/** History kinds (FN-19). file_withdrawn rows reach finance.manage holders only. */
export const financeHistoryKindSchema = z.enum(["recorded", "file_added", "file_withdrawn", "voided"]);
export type FinanceHistoryKind = z.infer<typeof financeHistoryKindSchema>;

/** Export formats (D-020). */
export const financeExportFormatSchema = z.enum(["xlsx", "csv", "pdf"], { message: "invalid_input" });
export type FinanceExportFormat = z.infer<typeof financeExportFormatSchema>;

// =============================================================================================
// 3. Money (spec 4.2, A-FN1, FN-08, FN-09). Text of digits, never a float.
// =============================================================================================

/** Unsigned whole rupiah as ASCII digits, no leading zero ("0", "1250000"). */
export type RupiahText = string;
/** Whole rupiah that may be negative (Total Saldo, a previous closing balance): "-250000". Never "-0". */
export type SignedRupiahText = string;

/** What nexus._fn_parse_amount accepts before its length check: "0" or digits without a leading zero. */
export const RUPIAH_DIGITS_PATTERN = /^(0|[1-9][0-9]*)$/;
/** A signed value as the database can answer it (no "-0", no "+"). */
export const SIGNED_RUPIAH_PATTERN = /^(0|-?[1-9][0-9]*)$/;
/** 9.999.999.999: 10 digits (A-FN1). More digits = amount_too_large. */
export const FINANCE_AMOUNT_MAX_DIGITS = 10;
export const FINANCE_AMOUNT_MAX: RupiahText = "9999999999";
/** Digits the amount field keeps while typing: enough to show "Jumlah terlalu besar", not unbounded. */
export const RUPIAH_INPUT_MAX_DIGITS = 13;

export type AmountCheck = "ok" | "invalid_amount" | "amount_too_large";

/**
 * The amount rule of finance_entry_record, in the same order: not a digits text (decimals, exponents,
 * signs, "-0", "+0", leading zeros, separators, spaces, letters, non-ASCII digits, blank) = invalid_amount;
 * more than 10 digits = amount_too_large; "0" for income or expense = invalid_amount (owner 2026-11-10:
 * Rp 0 only for Saldo awal). The value must already be normalised (normaliseRupiahInput).
 */
export function checkRupiahAmount(value: unknown, entryType: FinanceEntryType): AmountCheck {
  if (typeof value !== "string" || !RUPIAH_DIGITS_PATTERN.test(value)) return "invalid_amount";
  if (value.length > FINANCE_AMOUNT_MAX_DIGITS) return "amount_too_large";
  if (value === "0" && entryType !== "opening") return "invalid_amount";
  return "ok";
}

/** Zod field for the amount of one entry type. Output: the same digits text (no conversion). */
function amountSchema(entryType: FinanceEntryType) {
  return z.string({ message: "invalid_amount" }).superRefine((value, ctx) => {
    const result = checkRupiahAmount(value, entryType);
    if (result !== "ok") ctx.addIssue({ code: "custom", message: result });
  });
}

/** "1234567" -> "1.234.567" (Indonesian thousands dot). String only. Throws on anything but digits. */
export function groupRupiahDigits(digits: string): string {
  if (!/^[0-9]+$/.test(digits)) throw new RangeError("groupRupiahDigits expects ASCII digits");
  const head = digits.length % 3;
  const groups: string[] = head > 0 ? [digits.slice(0, head)] : [];
  for (let i = head; i < digits.length; i += 3) groups.push(digits.slice(i, i + 3));
  return groups.join(".");
}

/**
 * "1234567" -> "Rp 1.234.567"; "-250000" -> "-Rp 250.000"; "0" -> "Rp 0" (spec 4.2, screen 1 examples).
 * Accepts the contract's text or a bigint. Values only come from the schemas below, so anything else is
 * a bug: it throws (the error boundary shows "Terjadi gangguan"), never a guessed or partial balance.
 */
export function formatRupiah(value: SignedRupiahText | bigint): string {
  const text = typeof value === "bigint" ? value.toString() : value;
  if (!SIGNED_RUPIAH_PATTERN.test(text)) throw new RangeError("formatRupiah expects whole rupiah");
  return text.startsWith("-") ? `-Rp ${groupRupiahDigits(text.slice(1))}` : `Rp ${groupRupiahDigits(text)}`;
}

/**
 * List and detail amount with its sign (spec 4.2: never colour alone): income "+Rp 4.500.000", expense
 * "-Rp 1.250.000", Saldo awal without a sign ("Rp 0", spec screen 4).
 */
export function formatEntryAmount(entryType: FinanceEntryType, amount: RupiahText): string {
  const plain = formatRupiah(amount);
  if (entryType === "income") return `+${plain}`;
  if (entryType === "expense") return `-${plain}`;
  return plain;
}

/** Strips an optional leading "Rp" / "Rp." and outer spaces. */
function stripRupiahPrefix(raw: string): string {
  return raw.trim().replace(/^rp\.?\s*/i, "");
}

/**
 * The value to SEND from what the amount field shows. Plain digits stay; a correctly grouped value
 * ("1.234.567", "Rp 1.234.567") loses its dots. Anything else is returned trimmed and unchanged, so the
 * schema refuses it ("12.5", "1,5", "1.00", "-5", "007" all stay invalid). Never Number().
 */
export function normaliseRupiahInput(raw: string): string {
  const text = stripRupiahPrefix(raw);
  if (/^[0-9]+$/.test(text)) return text;
  if (/^[0-9]{1,3}(\.[0-9]{3})+$/.test(text)) return text.replace(/\./g, "");
  return raw.trim();
}

/**
 * What the amount field shows while typing (screen 3: digits only, dots inserted while typing). Spaces,
 * an "Rp" prefix and dots are dropped and the digits regrouped; leading zeros go ("05" -> "5", "0" stays);
 * at most RUPIAH_INPUT_MAX_DIGITS digits are kept. If anything else is typed or pasted (a comma, a minus,
 * a letter) the text is returned unchanged, so the error shows instead of a silently different number
 * ("1.234,50" must never become Rp 123.450).
 */
export function rupiahInputDisplay(raw: string): string {
  const compact = stripRupiahPrefix(raw).replace(/[\s.]/g, "");
  if (compact === "") return "";
  if (!/^[0-9]+$/.test(compact)) return raw;
  const digits = compact.replace(/^0+(?=[0-9])/, "").slice(0, RUPIAH_INPUT_MAX_DIGITS);
  return groupRupiahDigits(digits);
}

/**
 * EXPORT WRITERS ONLY: a JS integer for a CSV number or an Excel integer cell (spec 8: CSV plain integers,
 * Excel integer cells). Passing money to the CSV writer as TEXT would be wrong: a negative balance text
 * "-250000" would be treated as a formula start and prefixed with an apostrophe. Exact because every value
 * is checked to be a safe integer (all finance values are far below 2^53). Throws otherwise.
 */
export function rupiahToSafeInteger(value: SignedRupiahText): number {
  if (!SIGNED_RUPIAH_PATTERN.test(value)) throw new RangeError("rupiahToSafeInteger expects whole rupiah");
  const big = BigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("rupiahToSafeInteger: value is not a safe integer");
  }
  return Number(big);
}

// =============================================================================================
// 4. Small shared schemas and text cleaning (same order as the database helpers)
// =============================================================================================

/** Code points, like Postgres char_length (JS .length would count an emoji twice). */
function charLength(text: string): number {
  return [...text].length;
}

/** One line (Keterangan, reasons), as nexus._fn_text: whitespace runs -> one space, trimmed. */
export function cleanFinanceLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Catatan, as nexus._fn_long_text: CRLF -> LF, outer whitespace trimmed, inner line breaks kept. */
export function cleanFinanceLongText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
}

/** nexus ids. z.guid() (not z.uuid()) like the other modules; the database accepts any 8-4-4-4-12 hex. */
const idSchema = z.guid({ message: "invalid_input" });

/** finance_entry_files.id (bigint identity; safe as a JS number far beyond any real count). */
const fileIdSchema = z
  .number({ message: "invalid_input" })
  .int({ message: "invalid_input" })
  .min(1, { message: "invalid_input" })
  .max(Number.MAX_SAFE_INTEGER, { message: "invalid_input" });

/** Required one-line text. `missing` is the code a blank answers. */
function requiredLineSchema(max: number, missing: "text_required" | "reason_required") {
  return z
    .string({ message: missing })
    .transform(cleanFinanceLine)
    .refine((text) => text !== "", { message: missing })
    .refine((text) => charLength(text) <= max, { message: "text_too_long" });
}

/** Optional multi-line text: blank -> null, then the cap. */
function optionalLongTextSchema(max: number) {
  return z
    .string({ message: "invalid_input" })
    .nullish()
    .transform((raw) => {
      const clean = cleanFinanceLongText(raw ?? "");
      return clean === "" ? null : clean;
    })
    .refine((text) => text === null || charLength(text) <= max, { message: "text_too_long" });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real "YYYY-MM-DD" date, not before 2000-01-01 (the database refuses earlier dates). */
export function isValidFinanceDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  const real = parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
  return real && date >= FINANCE_LIMITS.minDate;
}

/**
 * "Tanggal" of an entry: blank = date_required, malformed or before 2000 = invalid_dates. "Not after
 * today" (date_in_future) is checked by the SERVER with jakartaToday() before the RPC (and by the
 * database), not here: a schema must not depend on the device clock.
 */
const entryDateSchema = z.string({ message: "date_required" }).superRefine((value, ctx) => {
  if (value.trim() === "") ctx.addIssue({ code: "custom", message: "date_required" });
  else if (!isValidFinanceDate(value)) ctx.addIssue({ code: "custom", message: "invalid_dates" });
});

/** A filter date: blank or missing = null; otherwise a valid date. */
const filterDateSchema = z
  .string({ message: "invalid_dates" })
  .nullish()
  .transform((raw) => {
    const trimmed = (raw ?? "").trim();
    return trimmed === "" ? null : trimmed;
  })
  .refine((date) => date === null || isValidFinanceDate(date), { message: "invalid_dates" });

/** Search: same cleaning and caps as nexus._fn_search_pattern. Blank = no search (null). */
export const financeSearchSchema = z
  .string({ message: "invalid_input" })
  .refine((raw) => charLength(raw) <= FINANCE_SEARCH_RAW_MAX_LENGTH, { message: "search_too_long" })
  .transform((raw) => raw.trim().replace(/\s+/g, " "))
  .refine((clean) => charLength(clean) <= FINANCE_SEARCH_MAX_LENGTH, { message: "search_too_long" })
  .transform((clean) => (clean === "" ? null : clean));

const pageSchema = z.number({ message: "invalid_page" }).int({ message: "invalid_page" }).min(1, { message: "invalid_page" });
const pageSizeSchema = z
  .number({ message: "invalid_page_size" })
  .int({ message: "invalid_page_size" })
  .min(1, { message: "invalid_page_size" })
  .max(FINANCE_PAGE_SIZE_MAX, { message: "invalid_page_size" });

// =============================================================================================
// 5. Proof files (spec 4.4, K5 a, A-FN6; storage migration 20261111200100)
// =============================================================================================

/** Private bucket. Only the path is stored; people get short-lived signed URLs (CLAUDE.md 11). */
export const FINANCE_PROOF_BUCKET = "nexus-finance-proofs";
export const FINANCE_PROOF_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type FinanceProofMimeType = (typeof FINANCE_PROOF_MIME_TYPES)[number];
export const FINANCE_PROOF_EXTENSION: Record<FinanceProofMimeType, "pdf" | "jpg" | "png"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
export const FINANCE_PROOF_MAX_BYTES = FINANCE_LIMITS.fileMaxBytes;
export const FINANCE_PROOF_MAX_MB = 5;
/** Lifetime of a signed proof link (A-FN6). Made when "Lihat" is pressed. */
export const FINANCE_PROOF_SIGNED_URL_TTL_SECONDS = 300;
/** Browser resize of IMAGES before upload (A-FN6): long side about 2000 px. PDF is never resized. */
export const FINANCE_IMAGE_RESIZE_LONG_SIDE_PX = 2000;
/** Multipart field names of the upload route: exactly one file, nothing else. */
export const FINANCE_PROOF_UPLOAD_FIELDS = { file: "file" } as const;

/**
 * Same pattern as the database: "<uploader members.id>/<random uuid>.<pdf|jpg|jpeg|png>", lowercase
 * (the uploader's OWN folder; a save attaches only the caller's own uploads). NEXUS writes pdf, jpg, png.
 */
export const FINANCE_PROOF_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/;
export const financeProofPathSchema = z
  .string({ message: "invalid_file" })
  .regex(FINANCE_PROOF_PATH_PATTERN, { message: "invalid_file" });

/** Storage path of a new upload. `fileId` is a fresh random uuid (crypto.randomUUID()). */
export function financeProofPath(memberId: string, fileId: string, type: FinanceProofMimeType): string {
  return `${memberId.toLowerCase()}/${fileId.toLowerCase()}.${FINANCE_PROOF_EXTENSION[type]}`;
}

/**
 * The real type from the first bytes, or null: PDF "%PDF-", JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A.
 * The upload route refuses a file whose real type is null or differs from the declared type.
 */
export function sniffFinanceProofType(bytes: Uint8Array): FinanceProofMimeType | null {
  const at = (sig: readonly number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  // Also invisible and bidi-override characters, so a name cannot display as "nota_fdp.exe".
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Original name as stored: control characters dropped, trimmed, max 200 code points, else "bukti.<ext>". */
export function cleanFinanceProofName(raw: string, type: FinanceProofMimeType): string {
  const kept = [...raw].filter((ch) => !isControlChar(ch)).join("").trim();
  const cut = [...kept].slice(0, FINANCE_LIMITS.fileName).join("").trim();
  return cut === "" ? `bukti.${FINANCE_PROOF_EXTENSION[type]}` : cut;
}

/** The declared file the browser sends (AFTER resizing images). The route also sniffs the bytes. */
export const financeUploadFileSchema = z.object({
  type: z.enum(FINANCE_PROOF_MIME_TYPES, { message: "invalid_file" }),
  size: z
    .number({ message: "invalid_file" })
    .int({ message: "invalid_file" })
    .min(1, { message: "invalid_file" })
    .max(FINANCE_PROOF_MAX_BYTES, { message: "file_too_large" }),
});

/** A just-uploaded file passed to a save action (the upload route's answer: path + cleaned name). */
export const financeProofRefSchema = z.object({
  path: financeProofPathSchema,
  name: z
    .string({ message: "invalid_file" })
    .transform((raw) => raw.trim())
    .refine((name) => name !== "" && charLength(name) <= FINANCE_LIMITS.fileName && ![...name].some(isControlChar), {
      message: "invalid_file",
    }),
});

/**
 * `min`..`max` just-uploaded files, each path once. Too few = file_required, too many = file_count. The
 * database checks again: own folder, not attached before, really uploaded, size and type.
 */
function proofListSchema(min: number, max: number) {
  return z
    .array(financeProofRefSchema, { message: "invalid_file" })
    .min(min, { message: "file_required" })
    .max(max, { message: "file_count" })
    .refine((files) => new Set(files.map((f) => f.path)).size === files.length, { message: "invalid_file" });
}

export type FinanceProofRefInput = z.input<typeof financeProofRefSchema>;
export type FinanceUploadFileInput = z.input<typeof financeUploadFileSchema>;

// =============================================================================================
// 6. Read inputs (summary, list, export, proof link)
// =============================================================================================

/**
 * List filters (F1, screen 1), shared by the list and the export (FN-29: the file holds what the screen
 * shows). periodId null = the active period. Dates: either end may be empty; when both are set the end
 * must not be before the start (invalid_dates on "to"). includeVoided = "Tampilkan yang dibatalkan"
 * (default off). withoutProof = "Tanpa bukti": entries with no visible proof (with "Tampilkan yang
 * dibatalkan" on, voided entries without proof are listed too: database _fn_rows).
 */
export const financeListFiltersSchema = z
  .object({
    periodId: idSchema.nullable().default(null),
    search: financeSearchSchema.nullable().default(null),
    type: financeTypeFilterSchema.default("all"),
    from: filterDateSchema.default(null),
    to: filterDateSchema.default(null),
    includeVoided: z.boolean({ message: "invalid_input" }).default(false),
    withoutProof: z.boolean({ message: "invalid_input" }).default(false),
  })
  .superRefine((f, ctx) => {
    if (f.from !== null && f.to !== null && f.to < f.from) {
      ctx.addIssue({ code: "custom", message: "invalid_dates", path: ["to"] });
    }
  });

export const financeListQuerySchema = z.object({
  filters: financeListFiltersSchema.prefault({}),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(FINANCE_PAGE_SIZE_DEFAULT),
});

/** Header tiles of a period (null = the active period). */
export const financeSummaryQuerySchema = z.object({ periodId: idSchema.nullable().default(null) });

/** Export body: the validated filters the screen shows, plus the format (F7). */
export const financeExportSchema = z.object({
  format: financeExportFormatSchema,
  filters: financeListFiltersSchema.prefault({}),
});

/** "Lihat" on a proof: the entry it was shown on, and the file. */
export const financeProofLinkSchema = z.object({ entryId: idSchema, fileId: fileIdSchema });

export type FinanceListFiltersInput = z.input<typeof financeListFiltersSchema>;
export type FinanceListFilters = z.output<typeof financeListFiltersSchema>;
export type FinanceListQueryInput = z.input<typeof financeListQuerySchema>;
export type FinanceSummaryQueryInput = z.input<typeof financeSummaryQuerySchema>;
export type FinanceExportInput = z.input<typeof financeExportSchema>;
export type FinanceProofLinkInput = z.input<typeof financeProofLinkSchema>;

/** True when the filters are the defaults (no "Reset" needed). The period is not a filter. */
export function isDefaultFinanceFilters(filters: FinanceListFilters): boolean {
  return (
    filters.search === null &&
    filters.type === "all" &&
    filters.from === null &&
    filters.to === null &&
    !filters.includeVoided &&
    !filters.withoutProof
  );
}

// =============================================================================================
// 7. Write inputs. There is NO edit input (K2 a): a saved entry never changes. The recorder, the period
//    and the number are ALWAYS assigned by the database from the session, never inputs. There is no
//    `version` either: entries never change, and a second void / withdraw answers state_changed.
// =============================================================================================

/**
 * Submit key (A-FN10, R8, FN-17): one NEW uuid (crypto.randomUUID()) each time the check sheet "Cek dulu"
 * opens with frozen values ("Lanjut"). "Simpan transaksi" sends it; a double tap, a retry after a timeout
 * or an `unavailable` answer resends the SAME key with the SAME values: the database returns the first
 * entry (replayed = true) and creates nothing. Going "Kembali" to change a value makes a new key at the
 * next "Lanjut" (the same key with other values is refused: idempotency_conflict).
 */
const submitKeySchema = z.guid({ message: "invalid_input" });

/** Fields after "Jumlah", in form order (screen 3). */
const recordTextAndFileFields = {
  description: requiredLineSchema(FINANCE_LIMITS.description, "text_required"),
  notes: optionalLongTextSchema(FINANCE_LIMITS.notes),
  files: proofListSchema(0, FINANCE_LIMITS.filesPerEntry).default([]),
};
const linkSchema = idSchema.nullish().transform((id) => id ?? null);

/**
 * "Catat transaksi" (F2, screen 3), "Buat koreksi" (F5) and "Catat Saldo Awal" (F3, screen 4).
 * Field order = form order, so the FIRST issue is the top-most field.
 * - income / expense: amount "1".."9999999999". correctsEntryId = "Koreksi atas {nomor}" (A-FN8: any
 *   Aktif entry of any period; the database refuses a voided or unknown target with invalid_correction).
 * - opening: amount "0".."9999999999" (owner 2026-11-10). Never a correction (invalid_correction).
 *   At most one Aktif per period (opening_exists).
 * Needs finance.manage and an active period. entryDate not after jakartaToday(): server check.
 */
export const financeRecordSchema = z.discriminatedUnion("entryType", [
  z.object({
    entryType: z.literal("income"),
    entryDate: entryDateSchema,
    amount: amountSchema("income"),
    ...recordTextAndFileFields,
    correctsEntryId: linkSchema,
    submitKey: submitKeySchema,
  }),
  z.object({
    entryType: z.literal("expense"),
    entryDate: entryDateSchema,
    amount: amountSchema("expense"),
    ...recordTextAndFileFields,
    correctsEntryId: linkSchema,
    submitKey: submitKeySchema,
  }),
  z.object({
    entryType: z.literal("opening"),
    entryDate: entryDateSchema,
    amount: amountSchema("opening"),
    ...recordTextAndFileFields,
    // Absent or null only: any id is refused as invalid_correction (the database CHECK says the same).
    correctsEntryId: z
      .null({ message: "invalid_correction" })
      .optional()
      .transform((): null => null),
    submitKey: submitKeySchema,
  }),
]);

/**
 * Key order of financeRecordSchema = form order (zod reports object keys in schema order, so the FIRST
 * issue is the top-most field). The UI may use it to focus the first invalid field.
 */
export const FINANCE_RECORD_FIELD_ORDER = [
  "entryType",
  "entryDate",
  "amount",
  "description",
  "notes",
  "files",
  "correctsEntryId",
  "submitKey",
] as const;

/** "Batalkan transaksi" (F4, screen 6): Aktif entry of the ACTIVE period, reason required. */
export const financeVoidSchema = z.object({
  entryId: idSchema,
  reason: requiredLineSchema(FINANCE_LIMITS.reason, "reason_required"),
});

/** "Tambah bukti" (F6): 1..actions.filesRoom proofs on an Aktif entry of the active period. */
export const financeAddProofSchema = z.object({
  entryId: idSchema,
  files: proofListSchema(1, FINANCE_LIMITS.filesPerEntry),
});

/** "Tarik berkas" (F6, screen 7): reason required; record and stored file stay (L5). */
export const financeWithdrawProofSchema = z.object({
  fileId: fileIdSchema,
  reason: requiredLineSchema(FINANCE_LIMITS.reason, "reason_required"),
});

export type FinanceRecordInput = z.input<typeof financeRecordSchema>;
export type FinanceRecordValues = z.output<typeof financeRecordSchema>;
export type FinanceVoidInput = z.input<typeof financeVoidSchema>;
export type FinanceAddProofInput = z.input<typeof financeAddProofSchema>;
export type FinanceWithdrawProofInput = z.input<typeof financeWithdrawProofSchema>;

// =============================================================================================
// 8. Output types (camelCase of the RPC columns / JSON keys; nothing the database does not return)
// =============================================================================================

/** "YYYY-MM-DD" (Jakarta calendar days); timestamps are ISO 8601 strings (UTC, show in WIB). */
type IsoDate = string;
type IsoTimestamp = string;

export type FinancePaged<T> = {
  rows: T[];
  /** Matching rows of the filter ("Hasil: {n} transaksi"). */
  total: number;
  /** The page actually returned: a page past the end returns the last page. */
  page: number;
  pageSize: number;
  /** max(1, ceil(total / pageSize)). */
  pageCount: number;
};

/** nexus.finance_period_list() row: the "Periode" select (active first, then newest label). */
export type FinancePeriodOption = {
  periodId: string;
  periodLabel: string | null;
  isActive: boolean;
  /** Informational dates from PI-CORE (soft warning only, R5). */
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
  /** Entries of every status. */
  entryCount: number;
};

/**
 * nexus.finance_summary(): header tiles, opening hints and the Dashboard card (A-FN20). Totals of the
 * WHOLE period, never the filter (A-FN3). balance = openingAmount + incomeTotal - expenseTotal, computed
 * by the database; may be negative (A-FN9: hint, never blocked).
 */
export type FinanceSummary = {
  periodId: string;
  periodLabel: string | null;
  /** false = banner "Periode {label} sudah selesai. Datanya hanya bisa dibaca." */
  isActivePeriod: boolean;
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
  /** The Aktif Saldo awal ("0" when none: check hasOpening). */
  openingAmount: RupiahText;
  /** false = the "Saldo awal ... belum dicatat" hints. A recorded Rp 0 is true (FN-08a). */
  hasOpening: boolean;
  openingEntryId: string | null;
  incomeTotal: RupiahText;
  expenseTotal: RupiahText;
  balance: SignedRupiahText;
  /** Aktif entries. */
  entryCount: number;
  voidedCount: number;
  /** Aktif entries without a visible proof (K5 a mark). */
  withoutProofCount: number;
  /** The period right before by label, and its live closing balance (null when it has no Aktif entry). */
  previousPeriodId: string | null;
  previousPeriodLabel: string | null;
  previousClosingBalance: SignedRupiahText | null;
};

/** nexus.finance_entry_list() row (card / table row). */
export type FinanceEntryRow = {
  rowNo: number;
  entryId: string;
  /** "KAS-0012", assigned by the database. */
  numberText: string;
  entryType: FinanceEntryType;
  entryDate: IsoDate;
  /** Always unsigned; the type gives the sign (formatEntryAmount). */
  amount: RupiahText;
  description: string;
  status: FinanceEntryStatus;
  /** Visible proofs (paperclip when > 0; "Tanpa bukti" mark when 0). */
  proofCount: number;
  correctsEntryId: string | null;
  correctsNumberText: string | null;
  periodId: string;
  periodLabel: string | null;
  createdAt: IsoTimestamp;
  createdByName: string | null;
};

export type FinanceEntryPage = FinancePaged<FinanceEntryRow> & {
  /** The validated filters the rows were read with (send these, not raw URL values, to the export). */
  filters: FinanceListFilters;
};

/** A proof the caller may read. No storage path: "Lihat" calls getFinanceProofLink(). */
export type FinanceProofFile = {
  fileId: number;
  name: string;
  /** null only where Storage was not installed when it was attached. */
  sizeBytes: number | null;
  mimeType: FinanceProofMimeType;
  attachedAt: IsoTimestamp;
  attachedByName: string | null;
  /** "Ditarik": only finance.manage holders ever receive withdrawn proofs. */
  isWithdrawn: boolean;
  withdrawnAt: IsoTimestamp | null;
  withdrawnByName: string | null;
  withdrawReason: string | null;
};

/** One "Riwayat" entry, newest first. note = the reason of voided / file_withdrawn. */
export type FinanceHistoryEntry = {
  historyId: number;
  at: IsoTimestamp;
  kind: FinanceHistoryKind;
  actorName: string | null;
  note: string | null;
  /** file_added / file_withdrawn; null when the caller may not see that proof. */
  fileName: string | null;
};

/** Which buttons exist for THIS caller now (database answer; every write re-checks). */
export type FinanceEntryActions = {
  /** "Batalkan transaksi": manager, Aktif, ACTIVE period. */
  canVoid: boolean;
  /** "Tambah bukti": as canVoid and fewer than 3 visible proofs. */
  canAddProof: boolean;
  /** "Tarik berkas": as canVoid and at least one visible proof. */
  canWithdrawProof: boolean;
  /** 3 - visible proofs when writable, else 0 ("Boleh menambah {n} berkas lagi."). */
  filesRoom: number;
  /** "Buat koreksi": manager, Aktif, OLD period, not a Saldo awal, a period is active (F5). */
  canCorrect: boolean;
  /** "Catat ulang": manager, voided, a period is active (F4). */
  canRerecord: boolean;
  /** "Ekspor" on the detail (finance.export). */
  canExport: boolean;
};

/** The entry this one corrects ("Koreksi atas {nomor}"). */
export type FinanceCorrectedEntry = {
  entryId: string;
  numberText: string;
  status: FinanceEntryStatus;
  periodLabel: string | null;
};

/** An entry that corrects this one. */
export type FinanceCorrectingEntry = { entryId: string; numberText: string; status: FinanceEntryStatus };

/** nexus.finance_entry_detail() (screen 2). Needs finance.view; an unknown id answers not_found "entry". */
export type FinanceEntryDetail = {
  entryId: string;
  numberText: string;
  entryType: FinanceEntryType;
  amount: RupiahText;
  entryDate: IsoDate;
  description: string;
  notes: string | null;
  status: FinanceEntryStatus;
  voidReason: string | null;
  voidedAt: IsoTimestamp | null;
  voidedByName: string | null;
  corrects: FinanceCorrectedEntry | null;
  correctedBy: FinanceCorrectingEntry[];
  periodId: string;
  periodLabel: string | null;
  isActivePeriod: boolean;
  createdAt: IsoTimestamp;
  createdByName: string | null;
  /** Visible proofs (withdrawn not counted). */
  proofCount: number;
  /** Proofs the caller may read, oldest first; withdrawn ones only for finance.manage. */
  files: FinanceProofFile[];
  history: FinanceHistoryEntry[];
  actions: FinanceEntryActions;
};

/**
 * SERVER ONLY. The detail plus the stored paths of its proofs, for signing in getFinanceProofLink().
 * Never pass `proofPaths` to a Client Component or a response.
 */
export type FinanceEntryDetailAnswer = {
  detail: FinanceEntryDetail;
  proofPaths: { fileId: number; storagePath: string; isWithdrawn: boolean }[];
};

/** nexus.finance_entry_record(): replayed = true when the submit key was seen before (no new entry). */
export type FinanceRecordResult = { entryId: string; numberText: string; replayed: boolean };
/** nexus.finance_entry_void(). */
export type FinanceVoidResult = { entryId: string; status: FinanceEntryStatus };
/** nexus.finance_entry_add_proof() / finance_entry_withdraw_proof(): visible proofs now. */
export type FinanceProofResult = { entryId: string; proofCount: number };

/** A signed, short-lived link to one proof (FINANCE_PROOF_SIGNED_URL_TTL_SECONDS). Opened in a new tab. */
export type FinanceProofLink = { fileId: number; url: string; expiresAt: IsoTimestamp };

/** Answer of the upload route: send `{ path, name }` in the save action's `files`. */
export type FinanceProofUploadResult = { path: string; name: string; sizeBytes: number; mimeType: FinanceProofMimeType };

/** nexus.finance_export() row (server side, for the file writer). No proof contents, no links. */
export type FinanceExportRow = {
  rowNo: number;
  numberText: string;
  entryDate: IsoDate;
  entryType: FinanceEntryType;
  description: string;
  notes: string | null;
  amount: RupiahText;
  status: FinanceEntryStatus;
  voidReason: string | null;
  correctsNumberText: string | null;
  hasProof: boolean;
  createdByName: string | null;
  createdAt: IsoTimestamp;
  periodLabel: string | null;
};

/** The whole-period summary block of an export (spec F7.2): from the SAME call as the rows. */
export type FinanceExportSummary = {
  opening: RupiahText;
  income: RupiahText;
  expense: RupiahText;
  balance: SignedRupiahText;
};

/**
 * Parsed finance_export answer. summary is null only for an empty result: the server then reads
 * finance_summary() for the block. totalCount = the database's count of the full result; fewer rows
 * than totalCount = the answer was cut (PostgREST max_rows): export_too_large, no file.
 */
export type FinanceExportAnswer = { rows: FinanceExportRow[]; summary: FinanceExportSummary | null; totalCount: number };

// ---- Database answer schemas (snake_case in, contract types out). Used by src/lib/picore/finance.ts:
//      every RPC answer is parsed with one of these; a shape mismatch is `unavailable` (fail closed).

const dbUuid = z.guid();
const dbCount = z.number().int().nonnegative();
const dbIsoDate = z.string().regex(ISO_DATE);
const dbTimestamp = z.string().min(1);
const dbOptText = z.string().nullable();
const dbPositiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** A bigint the database sends as a JSON number (or text): must be an exact, non-negative safe integer. */
const dbRupiah = z
  .union([z.number().refine((n) => Number.isSafeInteger(n) && n >= 0), z.string().regex(RUPIAH_DIGITS_PATTERN)])
  .transform((value): RupiahText => (typeof value === "number" ? String(value) : value));

/** An entry amount: as dbRupiah and within the CHECK (0..9 999 999 999). */
const dbEntryAmount = dbRupiah.refine((text) => text.length <= FINANCE_AMOUNT_MAX_DIGITS);

/** A signed bigint (Total Saldo, closing balance). */
const dbSignedRupiah = z
  .union([z.number().refine((n) => Number.isSafeInteger(n)), z.string().regex(SIGNED_RUPIAH_PATTERN)])
  .transform((value): SignedRupiahText => (typeof value === "number" ? String(value === 0 ? 0 : value) : value));

/** Exactly one row from a set-returning function (anything else is a bug: fail closed). */
function oneRow<T extends z.ZodType>(schema: T) {
  return z
    .array(schema)
    .length(1)
    .transform((rows) => rows[0] as z.output<T>);
}

export const financePeriodListDbSchema = z.array(
  z
    .object({
      period_id: dbUuid,
      period_label: dbOptText,
      is_active: z.boolean(),
      starts_on: dbIsoDate.nullable(),
      ends_on: dbIsoDate.nullable(),
      entry_count: dbCount,
    })
    .transform(
      (r): FinancePeriodOption => ({
        periodId: r.period_id,
        periodLabel: r.period_label,
        isActive: r.is_active,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        entryCount: r.entry_count,
      }),
    ),
);

export const financeSummaryDbSchema = oneRow(
  z
    .object({
      period_id: dbUuid,
      period_label: dbOptText,
      is_active_period: z.boolean(),
      starts_on: dbIsoDate.nullable(),
      ends_on: dbIsoDate.nullable(),
      opening_amount: dbEntryAmount,
      has_opening: z.boolean(),
      opening_entry_id: dbUuid.nullable(),
      income_total: dbRupiah,
      expense_total: dbRupiah,
      balance: dbSignedRupiah,
      entry_count: dbCount,
      voided_count: dbCount,
      without_proof_count: dbCount,
      previous_period_id: dbUuid.nullable(),
      previous_period_label: dbOptText,
      previous_closing_balance: dbSignedRupiah.nullable(),
    })
    .transform(
      (r): FinanceSummary => ({
        periodId: r.period_id,
        periodLabel: r.period_label,
        isActivePeriod: r.is_active_period,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        openingAmount: r.opening_amount,
        hasOpening: r.has_opening,
        openingEntryId: r.opening_entry_id,
        incomeTotal: r.income_total,
        expenseTotal: r.expense_total,
        balance: r.balance,
        entryCount: r.entry_count,
        voidedCount: r.voided_count,
        withoutProofCount: r.without_proof_count,
        previousPeriodId: r.previous_period_id,
        previousPeriodLabel: r.previous_period_label,
        previousClosingBalance: r.previous_closing_balance,
      }),
    ),
);

const entryListRowDb = z.object({
  row_no: dbCount,
  entry_id: dbUuid,
  number_text: z.string(),
  entry_type: financeEntryTypeSchema,
  entry_date: dbIsoDate,
  amount: dbEntryAmount,
  description: z.string(),
  status: financeEntryStatusSchema,
  proof_count: dbCount,
  corrects_entry_id: dbUuid.nullable(),
  corrects_number_text: dbOptText,
  period_id: dbUuid,
  period_label: dbOptText,
  created_at: dbTimestamp,
  created_by_name: dbOptText,
  total_count: dbCount,
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

/** finance_entry_list answer: rows plus the paging columns (identical on every row, else a bug). */
export const financeEntryListDbSchema = z
  .array(entryListRowDb)
  .refine((rows) => rows.every((r) => r.total_count === rows[0].total_count && r.page === rows[0].page && r.page_size === rows[0].page_size))
  .transform((rows) => ({
    rows: rows.map(
      (r): FinanceEntryRow => ({
        rowNo: r.row_no,
        entryId: r.entry_id,
        numberText: r.number_text,
        entryType: r.entry_type,
        entryDate: r.entry_date,
        amount: r.amount,
        description: r.description,
        status: r.status,
        proofCount: r.proof_count,
        correctsEntryId: r.corrects_entry_id,
        correctsNumberText: r.corrects_number_text,
        periodId: r.period_id,
        periodLabel: r.period_label,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
      }),
    ),
    total: rows.length === 0 ? 0 : rows[0].total_count,
    page: rows.length === 0 ? null : rows[0].page,
  }));

/** FinancePaged from a parsed list answer and the requested page size (0 rows: page 1, pageCount 1). */
export function buildFinancePage<T>(answer: { rows: T[]; total: number; page: number | null }, pageSize: number): FinancePaged<T> {
  return {
    rows: answer.rows,
    total: answer.total,
    page: answer.page ?? 1,
    pageSize,
    pageCount: Math.max(1, Math.ceil(answer.total / pageSize)),
  };
}

const proofFileDb = z.object({
  file_id: dbPositiveId,
  // Kept for signing only (proofPaths); never mapped into FinanceProofFile.
  storage_path: z.string(),
  original_name: z.string(),
  size_bytes: dbCount.nullable(),
  mime_type: z.enum(FINANCE_PROOF_MIME_TYPES),
  attached_at: dbTimestamp,
  attached_by_name: dbOptText,
  is_withdrawn: z.boolean(),
  withdrawn_at: dbTimestamp.nullable(),
  withdrawn_by_name: dbOptText,
  withdraw_reason: dbOptText,
});

const historyDb = z.object({
  history_id: dbPositiveId,
  at: dbTimestamp,
  kind: financeHistoryKindSchema,
  actor_name: dbOptText,
  note: dbOptText,
  file_name: dbOptText,
});

/** finance_entry_detail answer (one jsonb object). */
export const financeEntryDetailDbSchema = z
  .object({
    entry_id: dbUuid,
    number_text: z.string(),
    entry_type: financeEntryTypeSchema,
    amount: dbEntryAmount,
    entry_date: dbIsoDate,
    description: z.string(),
    notes: dbOptText,
    status: financeEntryStatusSchema,
    void_reason: dbOptText,
    voided_at: dbTimestamp.nullable(),
    voided_by_name: dbOptText,
    corrects: z
      .object({ entry_id: dbUuid, number_text: z.string(), status: financeEntryStatusSchema, period_label: dbOptText })
      .nullable(),
    corrected_by: z.array(z.object({ entry_id: dbUuid, number_text: z.string(), status: financeEntryStatusSchema })),
    period_id: dbUuid,
    period_label: dbOptText,
    is_active_period: z.boolean(),
    created_at: dbTimestamp,
    created_by_name: dbOptText,
    proof_count: dbCount,
    files: z.array(proofFileDb),
    history: z.array(historyDb),
    actions: z.object({
      can_void: z.boolean(),
      can_add_proof: z.boolean(),
      can_withdraw_proof: z.boolean(),
      files_room: dbCount,
      can_correct: z.boolean(),
      can_rerecord: z.boolean(),
      can_export: z.boolean(),
    }),
  })
  .transform(
    (d): FinanceEntryDetailAnswer => ({
      detail: {
        entryId: d.entry_id,
        numberText: d.number_text,
        entryType: d.entry_type,
        amount: d.amount,
        entryDate: d.entry_date,
        description: d.description,
        notes: d.notes,
        status: d.status,
        voidReason: d.void_reason,
        voidedAt: d.voided_at,
        voidedByName: d.voided_by_name,
        corrects:
          d.corrects === null
            ? null
            : {
                entryId: d.corrects.entry_id,
                numberText: d.corrects.number_text,
                status: d.corrects.status,
                periodLabel: d.corrects.period_label,
              },
        correctedBy: d.corrected_by.map((c) => ({ entryId: c.entry_id, numberText: c.number_text, status: c.status })),
        periodId: d.period_id,
        periodLabel: d.period_label,
        isActivePeriod: d.is_active_period,
        createdAt: d.created_at,
        createdByName: d.created_by_name,
        proofCount: d.proof_count,
        files: d.files.map((f) => ({
          fileId: f.file_id,
          name: f.original_name,
          sizeBytes: f.size_bytes,
          mimeType: f.mime_type,
          attachedAt: f.attached_at,
          attachedByName: f.attached_by_name,
          isWithdrawn: f.is_withdrawn,
          withdrawnAt: f.withdrawn_at,
          withdrawnByName: f.withdrawn_by_name,
          withdrawReason: f.withdraw_reason,
        })),
        history: d.history.map((h) => ({
          historyId: h.history_id,
          at: h.at,
          kind: h.kind,
          actorName: h.actor_name,
          note: h.note,
          fileName: h.file_name,
        })),
        actions: {
          canVoid: d.actions.can_void,
          canAddProof: d.actions.can_add_proof,
          canWithdrawProof: d.actions.can_withdraw_proof,
          filesRoom: d.actions.files_room,
          canCorrect: d.actions.can_correct,
          canRerecord: d.actions.can_rerecord,
          canExport: d.actions.can_export,
        },
      },
      proofPaths: d.files.map((f) => ({ fileId: f.file_id, storagePath: f.storage_path, isWithdrawn: f.is_withdrawn })),
    }),
  );

export const financeRecordDbSchema = oneRow(
  z
    .object({ entry_id: dbUuid, number_text: z.string().regex(/^KAS-[0-9]{4,}$/), replayed: z.boolean() })
    .transform((r): FinanceRecordResult => ({ entryId: r.entry_id, numberText: r.number_text, replayed: r.replayed })),
);

export const financeVoidDbSchema = oneRow(
  z
    .object({ entry_id: dbUuid, status: financeEntryStatusSchema })
    .transform((r): FinanceVoidResult => ({ entryId: r.entry_id, status: r.status })),
);

/** Both finance_entry_add_proof and finance_entry_withdraw_proof. */
export const financeProofDbSchema = oneRow(
  z
    .object({ entry_id: dbUuid, proof_count: dbCount })
    .transform((r): FinanceProofResult => ({ entryId: r.entry_id, proofCount: r.proof_count })),
);

const exportRowDb = z.object({
  row_no: dbCount,
  number_text: z.string(),
  entry_date: dbIsoDate,
  entry_type: financeEntryTypeSchema,
  description: z.string(),
  notes: dbOptText,
  amount: dbEntryAmount,
  status: financeEntryStatusSchema,
  void_reason: dbOptText,
  corrects_number_text: dbOptText,
  has_proof: z.boolean(),
  created_by_name: dbOptText,
  created_at: dbTimestamp,
  period_label: dbOptText,
  summary_opening: dbEntryAmount,
  summary_income: dbRupiah,
  summary_expense: dbRupiah,
  summary_balance: dbSignedRupiah,
  total_count: dbCount,
});

/**
 * finance_export answer. Every row repeats the same summary and total_count (computed in one call);
 * rows that disagree, or more rows than counted, are a bug (fail closed).
 */
export const financeExportDbSchema = z
  .array(exportRowDb)
  .refine((rows) =>
    rows.every(
      (r) =>
        r.total_count === rows[0].total_count &&
        r.summary_opening === rows[0].summary_opening &&
        r.summary_income === rows[0].summary_income &&
        r.summary_expense === rows[0].summary_expense &&
        r.summary_balance === rows[0].summary_balance,
    ),
  )
  .refine((rows) => rows.length === 0 || rows.length <= rows[0].total_count)
  .transform(
    (rows): FinanceExportAnswer => ({
      rows: rows.map((r) => ({
        rowNo: r.row_no,
        numberText: r.number_text,
        entryDate: r.entry_date,
        entryType: r.entry_type,
        description: r.description,
        notes: r.notes,
        amount: r.amount,
        status: r.status,
        voidReason: r.void_reason,
        correctsNumberText: r.corrects_number_text,
        hasProof: r.has_proof,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
        periodLabel: r.period_label,
      })),
      summary:
        rows.length === 0
          ? null
          : {
              opening: rows[0].summary_opening,
              income: rows[0].summary_income,
              expense: rows[0].summary_expense,
              balance: rows[0].summary_balance,
            },
      totalCount: rows.length === 0 ? 0 : rows[0].total_count,
    }),
  );

// =============================================================================================
// 9. Errors and results
// =============================================================================================

/** Which input a refusal is about (zod path or database detail). `request` = malformed body. */
export type FinanceInputField =
  | "request"
  | "periodId"
  | "search"
  | "type"
  | "from"
  | "to"
  | "includeVoided"
  | "withoutProof"
  | "page"
  | "pageSize"
  | "format"
  | "entryId"
  | "fileId"
  | "submitKey"
  | "entryType"
  | "entryDate"
  | "amount"
  | "description"
  | "notes"
  | "correctsEntryId"
  | "files"
  | "file"
  | "reason";

const FINANCE_INPUT_FIELDS: ReadonlySet<string> = new Set<FinanceInputField>([
  "request", "periodId", "search", "type", "from", "to", "includeVoided", "withoutProof", "page", "pageSize",
  "format", "entryId", "fileId", "submitKey", "entryType", "entryDate", "amount", "description", "notes",
  "correctsEntryId", "files", "file", "reason",
]);

/** Database `detail` -> field (22023 hints that name a field). A storage path detail -> "files". */
export const FINANCE_DB_DETAIL_FIELDS: Record<string, FinanceInputField> = {
  description: "description",
  notes: "notes",
  reason: "reason",
  entry_date: "entryDate",
  amount: "amount",
  idempotency_key: "submitKey",
  corrects_entry_id: "correctsEntryId",
  p_files: "files",
  name: "files",
};

/** Hints whose field is fixed whatever the detail says. */
const FINANCE_DB_HINT_FIELDS: Record<string, FinanceInputField> = {
  invalid_period: "periodId",
  search_too_long: "search",
  invalid_page: "page",
  invalid_page_size: "pageSize",
  invalid_format: "format",
  invalid_amount: "amount",
  amount_too_large: "amount",
  invalid_correction: "correctsEntryId",
};

/** Entities a not_found can be about (P0002 hints). */
export type FinanceEntity = "entry" | "file";

/**
 * Error union. HTTP-like meaning (financeErrorStatus): unauthenticated 401; forbidden, closed_period 403;
 * not_found 404; input codes 400; file_too_large 413; export_too_large 422; upload_limit 429; unavailable
 * 503 (fail closed: never shown as "no access", never a sign-out); every other business refusal 409.
 * Payloads carry fields, counts and paths of the caller's own uploads only: never a person, never an amount.
 */
export type FinanceError =
  // Session and access. permission_required and not_active_member (42501) -> forbidden.
  | { code: "unauthenticated" }
  | { code: "forbidden" }
  | { code: "unavailable" }
  /** Access control L7: an entry of an old period is read-only (offer "Buat koreksi"). */
  | { code: "closed_period" }
  // Input (22023). invalid_type, invalid_period, search_too_long, invalid_page, invalid_page_size,
  // invalid_format, a malformed submit key -> invalid_input with the field.
  | { code: "invalid_input"; field: FinanceInputField }
  | { code: "text_required" | "text_too_long" | "reason_required"; field: FinanceInputField }
  | { code: "date_required" | "date_in_future" | "invalid_dates"; field: FinanceInputField }
  /** Money (FN-08). field is always "amount". The text depends on the entry type (financeErrorMessage). */
  | { code: "invalid_amount" | "amount_too_large"; field: FinanceInputField }
  /** The "Koreksi atas" target is not an Aktif entry any more, or the entry is a Saldo awal. */
  | { code: "invalid_correction"; field: FinanceInputField }
  | { code: "invalid_file" | "file_already_attached" | "file_missing"; field: FinanceInputField; ref: string | null }
  | { code: "file_too_large"; field: FinanceInputField; ref: string | null; maxMb: number }
  /** count = the minimum (file_required) or the maximum allowed now (file_count). */
  | { code: "file_required" | "file_count"; field: FinanceInputField; count: number | null }
  // Not found (P0002). An entry the caller may not read never reaches this: no finance.view = forbidden.
  | { code: "not_found"; entity: FinanceEntity }
  // Business refusals (P0001, and idempotency_conflict 22023).
  | { code: "no_active_period" }
  | { code: "state_changed" } // second void / withdraw, someone was faster
  | { code: "entry_voided" } // proof change on a Dibatalkan entry
  | { code: "opening_exists" } // a second Aktif Saldo awal in the period (A-FN21)
  | { code: "idempotency_conflict" } // the same submit key with other values (a UI bug)
  /** More than 1000 matching rows (too_many_rows, rowCount = the count) or an answer cut by max_rows (null). */
  | { code: "export_too_large"; rowCount: number | null }
  /** Upload refused by the bucket policy with an active period: the 10-per-24-hours cap. */
  | { code: "upload_limit"; limit: number };

export type FinanceErrorCode = FinanceError["code"];

export type FinanceResult<T> = { ok: true; data: T } | { ok: false; error: FinanceError };

/** JSON body of every non-2xx answer from the export and upload route handlers. */
export type FinanceErrorBody = { error: FinanceError };

/**
 * Database hint -> error code (supabase/README.md 3.4). Hints not listed (also bucket_conflict and
 * storage_policy_unscoped, migration only) and any error without a hint answer `unavailable`. Guard
 * hints that fire only on a bug (immutable_column, export_log_direct_insert, append_only) are
 * deliberately `unavailable` too. Look up with Object.hasOwn (a hint like "constructor" must not resolve
 * through the prototype, BUG-MD-01).
 */
export const FINANCE_DB_HINTS: Record<string, FinanceErrorCode> = {
  // 42501
  permission_required: "forbidden",
  not_active_member: "forbidden",
  closed_period: "closed_period",
  immutable_column: "unavailable",
  export_log_direct_insert: "unavailable",
  append_only: "unavailable",
  // P0002
  entry_not_found: "not_found",
  file_not_found: "not_found",
  // P0001
  no_active_period: "no_active_period",
  state_changed: "state_changed",
  entry_voided: "entry_voided",
  opening_exists: "opening_exists",
  file_missing: "file_missing",
  too_many_rows: "export_too_large",
  // 22023
  invalid_type: "invalid_input",
  invalid_amount: "invalid_amount",
  amount_too_large: "amount_too_large",
  invalid_input: "invalid_input",
  invalid_correction: "invalid_correction",
  idempotency_conflict: "idempotency_conflict",
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
  invalid_period: "invalid_input",
  search_too_long: "invalid_input",
  invalid_page: "invalid_input",
  invalid_page_size: "invalid_input",
  invalid_format: "invalid_input",
};

function parseCount(detail: string | null | undefined): number | null {
  return typeof detail === "string" && /^[0-9]{1,9}$/.test(detail) ? Number(detail) : null;
}

/** The action that produced an error; picks the copy variant and the fields some hints leave open. */
export type FinanceAction =
  | "read"
  | "export"
  | "openFile"
  | "upload"
  /** Screen 3 / 5: Pemasukan or Pengeluaran ("Catat transaksi", "Buat koreksi", "Catat ulang"). */
  | "record"
  /** Screen 4: Saldo awal. */
  | "recordOpening"
  | "void"
  | "addProof"
  | "withdrawProof";

const RECORD_ACTIONS: ReadonlySet<FinanceAction> = new Set(["record", "recordOpening"]);

/**
 * The FinanceError for a database refusal, from its `hint` and `detail` only (the message is never read).
 * The picore layer calls it for every PostgREST error; no hint or an unknown hint = unavailable.
 * `action` fills the fields a hint leaves open: invalid_type is "entryType" on a record and "type" on a
 * read; invalid_dates without a field detail is the list range ("to").
 */
export function financeErrorFromDb(
  hint: string | null | undefined,
  detail: string | null | undefined,
  action: FinanceAction = "read",
): FinanceError {
  const code = hint && Object.hasOwn(FINANCE_DB_HINTS, hint) ? FINANCE_DB_HINTS[hint] : "unavailable";
  const isPath = typeof detail === "string" && FINANCE_PROOF_PATH_PATTERN.test(detail);
  const fieldOf = (): FinanceInputField => {
    if (hint && Object.hasOwn(FINANCE_DB_HINT_FIELDS, hint)) return FINANCE_DB_HINT_FIELDS[hint];
    if (detail && Object.hasOwn(FINANCE_DB_DETAIL_FIELDS, detail)) return FINANCE_DB_DETAIL_FIELDS[detail];
    if (hint === "invalid_type") return RECORD_ACTIONS.has(action) ? "entryType" : "type";
    if (hint === "invalid_dates") return RECORD_ACTIONS.has(action) ? "entryDate" : "to";
    return isPath ? "files" : "request";
  };
  switch (code) {
    case "not_found":
      return { code, entity: hint === "file_not_found" ? "file" : "entry" };
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "date_required":
    case "date_in_future":
    case "invalid_dates":
    case "invalid_amount":
    case "amount_too_large":
    case "invalid_correction":
      return { code, field: fieldOf() };
    case "invalid_file":
    case "file_already_attached":
    case "file_missing":
      return { code, field: "files", ref: isPath ? (detail as string) : null };
    case "file_too_large":
      return { code, field: "files", ref: isPath ? (detail as string) : null, maxMb: FINANCE_PROOF_MAX_MB };
    case "file_required":
    case "file_count":
      return { code, field: "files", count: parseCount(detail) };
    case "export_too_large":
      return { code, rowCount: parseCount(detail) };
    case "upload_limit":
      return { code, limit: FINANCE_LIMITS.unattachedUploadsPer24h };
    case "unauthenticated":
    case "forbidden":
    case "unavailable":
    case "closed_period":
    case "no_active_period":
    case "state_changed":
    case "entry_voided":
    case "opening_exists":
    case "idempotency_conflict":
      return { code };
  }
}

/** Zod messages that are not error codes themselves (paging and search answer invalid_input). */
const ZOD_MESSAGE_ALIASES: Record<string, FinanceErrorCode> = {
  invalid_page: "invalid_input",
  invalid_page_size: "invalid_input",
  search_too_long: "invalid_input",
};

/** The field of an issue: the deepest known key of its path (filters.search -> search; files.0.path -> files). */
function fieldOfPath(path: readonly PropertyKey[]): FinanceInputField {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const key = path[i];
    if (typeof key === "string" && FINANCE_INPUT_FIELDS.has(key)) return key as FinanceInputField;
  }
  return "request";
}

/**
 * The FinanceError for a failed safeParse of any schema in this file: the FIRST issue. A message that is
 * a known code keeps it (payloads: count = the list bound, maxMb = 5, ref null); any other message (zod's
 * own, e.g. an unknown entryType) is invalid_input for that field.
 */
export function financeErrorFromZod(error: z.ZodError): FinanceError {
  const issue = error.issues[0];
  if (issue === undefined) return { code: "invalid_input", field: "request" };
  const field = fieldOfPath(issue.path);
  const message = Object.hasOwn(ZOD_MESSAGE_ALIASES, issue.message) ? ZOD_MESSAGE_ALIASES[issue.message] : issue.message;
  switch (message) {
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "date_required":
    case "invalid_dates":
    case "invalid_amount":
    case "amount_too_large":
    case "invalid_correction":
      return { code: message, field };
    case "invalid_file":
      return { code: message, field, ref: null };
    case "file_too_large":
      return { code: message, field, ref: null, maxMb: FINANCE_PROOF_MAX_MB };
    case "file_required":
      return { code: message, field, count: 1 };
    case "file_count":
      return { code: message, field, count: FINANCE_LIMITS.filesPerEntry };
    default:
      return { code: "invalid_input", field };
  }
}

/** HTTP status for the route handlers (see FinanceError). */
export function financeErrorStatus(error: FinanceError): number {
  switch (error.code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
    case "closed_period":
      return 403;
    case "not_found":
      return 404;
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "date_required":
    case "date_in_future":
    case "invalid_dates":
    case "invalid_amount":
    case "amount_too_large":
    case "invalid_correction":
    case "invalid_file":
    case "file_already_attached":
    case "file_required":
    case "file_count":
      return 400;
    case "file_too_large":
      return 413;
    case "export_too_large":
      return 422;
    case "upload_limit":
      return 429;
    case "unavailable":
      return 503;
    case "no_active_period":
    case "state_changed":
    case "entry_voided":
    case "opening_exists":
    case "idempotency_conflict":
    case "file_missing":
      return 409;
  }
}

// ---- Indonesian copy of the errors ----

/** Generic texts reused by several codes. */
const COPY_UNAVAILABLE = "Terjadi gangguan. Coba lagi."; // spec 3 states, 7 screen 1
const COPY_STATE_CHANGED = "Data sudah berubah. Muat ulang."; // spec 3 states (conflict)
const COPY_NO_PERIOD = "Belum ada periode aktif. Transaksi belum bisa dicatat."; // spec F2, 7 screen 3
const COPY_UPLOAD_FAILED = "Berkas gagal diunggah. Coba lagi."; // spec 3 states
const COPY_FILE_OPEN_FAILED = "Berkas tidak bisa dibuka. Coba lagi."; // gap: Letters design 6.3
const COPY_FILE_NOT_FOUND = "Berkas tidak ditemukan. Muat ulang halaman."; // gap: Letters (owner)
const COPY_RANGE = "Tanggal akhir tidak boleh sebelum tanggal mulai."; // gap: Letters (owner)
/** Spec 7 screen 3. {n} = the field's limit. */
const COPY_TOO_LONG = "Terlalu panjang (maksimal {n} karakter).";

/**
 * Indonesian copy per error code: from the spec (section numbers in the comments) or a gap text (listed in
 * the README). `null` = PER FIELD or PER ACTION: use financeErrorMessage().
 */
export const FINANCE_ERROR_COPY: Record<FinanceErrorCode, string | null> = {
  unauthenticated: null, // no text: redirect to /login?reason=session_ended (auth-login F9)
  forbidden: "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", // spec 3 states, full text as Letters
  unavailable: COPY_UNAVAILABLE, // spec 3 states; action variants below
  closed_period: null, // PER ACTION: void (7 screen 2), proof (gap)
  invalid_input: null, // PER FIELD: search, export; else generic
  text_required: "Keterangan wajib diisi.", // 7 screen 3 (Keterangan is the only required text)
  text_too_long: COPY_TOO_LONG, // 7 screen 3 ({n} per field)
  reason_required: null, // PER ACTION: void (7 screen 6), withdraw (gap)
  date_required: "Pilih tanggal transaksi.", // gap (the form defaults to today)
  date_in_future: "Tanggal tidak boleh di masa depan.", // 7 screen 3
  invalid_dates: null, // PER FIELD: list range (gap: Letters owner text), entry date (gap)
  invalid_amount: null, // PER ACTION: 7 screen 3 (income/expense), 7 screen 4 (Saldo awal)
  amount_too_large: "Jumlah terlalu besar (maksimal Rp 9.999.999.999).", // 7 screen 3
  invalid_correction: "Transaksi yang dikoreksi sudah dibatalkan. Muat ulang halaman.", // gap
  invalid_file: "Hanya PDF, JPG, atau PNG.", // 7 screen 3 (a bad saved path: generic, variant)
  file_too_large: "Berkas terlalu besar (maksimal 5 MB).", // 7 screen 3
  file_required: "Pilih minimal satu berkas.", // gap ("Tambah bukti" with none; same as Minutes)
  file_count: null, // PER COUNT: "Maksimal 3 berkas." (7 screen 3) or the room left (gap)
  file_already_attached: "Berkas ini sudah terpasang. Pilih berkas lain.", // gap: Letters (owner)
  file_missing: COPY_UPLOAD_FAILED, // spec 3 states
  not_found: null, // PER ENTITY: entry (gap), file (variants)
  no_active_period: COPY_NO_PERIOD, // spec F2
  state_changed: COPY_STATE_CHANGED, // spec 3 states
  entry_voided: COPY_STATE_CHANGED, // spec 3 states ("entry already voided")
  opening_exists: "Saldo awal periode ini sudah dicatat. Batalkan yang lama kalau angkanya salah.", // 7 screen 4
  idempotency_conflict: COPY_STATE_CHANGED, // gap: only a UI bug reaches it
  export_too_large: "Terlalu banyak data untuk satu file. Persempit dengan filter tanggal.", // 7 screen 8
  upload_limit: "Terlalu banyak unggahan dalam 24 jam. Coba lagi nanti.", // gap: Letters design 3.3
};

/** Action variants of the codes whose text depends on what the person was doing. */
export const FINANCE_ERROR_COPY_VARIANTS = {
  invalidAmount: {
    /** Pemasukan and Pengeluaran (7 screen 3). */
    record: "Isi jumlah dengan angka bulat, minimal Rp 1.",
    /** Saldo awal (7 screen 4, [ASSUMPTION] tech lead 2026-11-10). */
    opening: "Isi jumlah dengan angka bulat, 0 atau lebih.",
  },
  closedPeriod: {
    void: "Transaksi periode lama tidak bisa dibatalkan. Catat koreksi di periode aktif.", // 7 screen 2
    proof: "Transaksi periode lama hanya bisa dibaca.", // gap
  },
  notFound: {
    entry: "Transaksi ini tidak ditemukan.", // gap
    /** "Lihat" on a proof that is gone or no longer readable. */
    fileOpen: COPY_FILE_OPEN_FAILED,
    /** A file id that no longer matches (e.g. "Tarik berkas" on a stale page). */
    file: COPY_FILE_NOT_FOUND,
  },
  fileCount: {
    /** At the limit of 3 (7 screen 3). */
    max: "Maksimal 3 berkas.",
    /** "Tambah bukti" when fewer may be added ({n} = the room left). gap: Letters "Boleh menambah {n} berkas lagi." */
    room: "Boleh menambah {n} berkas lagi.",
  },
  invalidDates: {
    range: COPY_RANGE,
    entryDate: "Tanggal transaksi tidak valid.", // gap (a date picker prevents it; before 2000)
  },
  unavailable: {
    openFile: COPY_FILE_OPEN_FAILED,
    upload: COPY_UPLOAD_FAILED, // spec 3 states
  },
  invalidInput: {
    search: "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.", // gap: Letters design 5.2
    export: "Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi.", // gap: Data Anggota
  },
  reasonRequired: {
    void: "Tulis alasan pembatalan.", // 7 screen 6
    withdrawProof: "Tulis kenapa berkas ini ditarik.", // gap: Letters design 8.2
  },
  /** A malformed saved path: the browser built it, so it is a bug. */
  invalidFileSaved: COPY_UNAVAILABLE,
} as const;

/** Character limit per field, for "{n}". */
const FIELD_MAX: Partial<Record<FinanceInputField, number>> = {
  description: FINANCE_LIMITS.description,
  notes: FINANCE_LIMITS.notes,
  reason: FINANCE_LIMITS.reason,
  search: FINANCE_SEARCH_MAX_LENGTH,
};

/** Fills "{n}", "{nomor}", ... in a copy string. Unknown placeholders stay as they are. */
export function formatFinanceCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
}

/** The text to show for an error, or null only for `unauthenticated` (redirect to login). Never throws. */
export function financeErrorMessage(error: FinanceError, action: FinanceAction): string | null {
  const v = FINANCE_ERROR_COPY_VARIANTS;
  switch (error.code) {
    case "unauthenticated":
      return null;
    case "invalid_amount":
      return action === "recordOpening" ? v.invalidAmount.opening : v.invalidAmount.record;
    case "closed_period":
      return action === "void" ? v.closedPeriod.void : v.closedPeriod.proof;
    case "not_found":
      if (error.entity === "file") return action === "openFile" ? v.notFound.fileOpen : v.notFound.file;
      return v.notFound.entry;
    case "file_count":
      return error.count !== null && error.count < FINANCE_LIMITS.filesPerEntry && error.count > 0
        ? formatFinanceCopy(v.fileCount.room, { n: error.count })
        : v.fileCount.max;
    case "invalid_dates":
      return error.field === "entryDate" ? v.invalidDates.entryDate : v.invalidDates.range;
    case "unavailable":
      if (action === "openFile") return v.unavailable.openFile;
      if (action === "upload") return v.unavailable.upload;
      return COPY_UNAVAILABLE;
    case "invalid_file":
      return action === "upload" ? (FINANCE_ERROR_COPY.invalid_file ?? COPY_UNAVAILABLE) : v.invalidFileSaved;
    case "invalid_input":
      if (error.field === "search") return v.invalidInput.search;
      if (action === "export") return v.invalidInput.export;
      return COPY_UNAVAILABLE; // the screens never send a malformed id, page, key or filter
    case "reason_required":
      if (action === "void") return v.reasonRequired.void;
      if (action === "withdrawProof") return v.reasonRequired.withdrawProof;
      return COPY_UNAVAILABLE;
    case "text_too_long": {
      const max = FIELD_MAX[error.field];
      return max === undefined ? COPY_UNAVAILABLE : formatFinanceCopy(COPY_TOO_LONG, { n: max });
    }
    default:
      return FINANCE_ERROR_COPY[error.code] ?? COPY_UNAVAILABLE;
  }
}

// =============================================================================================
// 10. Screen copy and labels (stored value -> Indonesian), shared by the screens and the export files.
//     Word for word from spec section 7 ("7.n" = screen n) unless marked "gap" (README lists them).
//     {jumlah} placeholders take formatRupiah() output unless the comment says otherwise.
// =============================================================================================

export const FINANCE_ENTRY_TYPE_LABEL: Record<FinanceEntryType, string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  opening: "Saldo awal",
};
export const FINANCE_TYPE_FILTER_LABEL: Record<FinanceTypeFilter, string> = {
  all: "Semua",
  income: "Pemasukan",
  expense: "Pengeluaran",
  opening: "Saldo awal",
};
export const FINANCE_STATUS_LABEL: Record<FinanceEntryStatus, string> = { active: "Aktif", voided: "Dibatalkan" };
export const FINANCE_EXPORT_FORMAT_LABEL: Record<FinanceExportFormat, string> = { xlsx: "Excel", csv: "CSV", pdf: "PDF" };

/** "Riwayat" lines (7 screen 2). {nama} = actorName. Withdrawn: gap (managers only see it). */
export const FINANCE_HISTORY_LABEL: Record<FinanceHistoryKind, string> = {
  recorded: "Dicatat oleh {nama}",
  file_added: "Bukti ditambahkan",
  file_withdrawn: "Bukti ditarik oleh {nama}",
  voided: "Dibatalkan oleh {nama}",
};
/** Second lines of a history entry: the file name, and the reason of voided / file_withdrawn. */
export const FINANCE_HISTORY_DETAIL = { file: "{file}", reason: "Alasan: {alasan}" } as const;

export const FINANCE_COPY = {
  // 7.1 Finance page
  page: {
    title: "Finance",
    periodLine: "Periode {label}",
    periodSelect: "Periode",
    oldPeriodBanner: "Periode {label} sudah selesai. Datanya hanya bisa dibaca.",
    noPeriodBanner: COPY_NO_PERIOD,
    record: "Catat transaksi",
    export: "Ekspor",
  },
  tiles: {
    balance: "Total Saldo",
    income: "Total Pemasukan",
    expense: "Total Pengeluaran",
    /** {jumlah} = formatRupiah(openingAmount). */
    openingLine: "Saldo awal {jumlah}",
    openingMissingManager: "Saldo awal periode ini belum dicatat.",
    openingMissingButton: "Catat saldo awal",
    openingMissingViewer: "Saldo awal belum dicatat. Saldo di bawah belum termasuk kas dari periode sebelumnya.",
    negativeBalance: "Saldo minus. Cek apakah ada pemasukan atau saldo awal yang belum dicatat.",
  },
  filters: {
    searchPlaceholder: "Cari keterangan atau nomor KAS...",
    open: "Filter",
    type: "Jenis",
    from: "Dari tanggal",
    to: "Sampai tanggal",
    includeVoided: "Tampilkan yang dibatalkan",
    withoutProof: "Tanpa bukti",
    reset: "Reset",
    resultCount: "Hasil: {n} transaksi",
  },
  list: {
    empty: "Belum ada transaksi di periode ini.",
    emptyManager: "Catat transaksi pertama lewat tombol di atas.",
    noMatch: "Tidak ada hasil. Ubah pencarian atau filter.",
    error: COPY_UNAVAILABLE,
    retry: "Coba lagi",
    /** K5 a mark on an entry without a visible proof. */
    withoutProofMark: "Tanpa bukti",
    /** Accessible name of the paperclip (gap). */
    hasProof: "Ada bukti",
    voidedChip: "Dibatalkan",
  },
  // 7.2 Detail
  detail: {
    back: "Kembali ke Finance",
    title: "Detail Transaksi",
    number: "Nomor",
    date: "Tanggal",
    type: "Jenis",
    amount: "Jumlah",
    description: "Keterangan",
    notes: "Catatan",
    correctsLink: "Koreksi atas {nomor}",
    /** An entry that corrects this one (gap). */
    correctedBy: "Dikoreksi lewat {nomor}",
    period: "Periode",
    recordedBy: "Dicatat oleh {nama}, {tanggal}",
    proofTitle: "Bukti",
    proofEmpty: "Tanpa bukti.",
    proofView: "Lihat",
    /** gap: Letters design 16 chip. */
    withdrawnChip: "Ditarik",
    proofRoom: "Boleh menambah {n} berkas lagi.", // gap: Letters
    historyTitle: "Riwayat",
    voidBlock: "Dibatalkan oleh {nama} pada {tanggal}. Alasan: {alasan}",
    addProof: "Tambah bukti",
    withdrawProof: "Tarik berkas",
    void: "Batalkan transaksi",
    rerecord: "Catat ulang",
    oldPeriodNote: "Transaksi periode lama tidak bisa dibatalkan. Catat koreksi di periode aktif.",
    correct: "Buat koreksi",
    export: "Ekspor",
  },
  // 7.3 Record form (and 7.5 correction)
  form: {
    back: "Kembali ke Finance",
    title: "Catat Transaksi",
    type: "Jenis",
    date: "Tanggal",
    amount: "Jumlah (Rp)",
    amountHelp: "Angka bulat, tanpa titik atau koma.",
    description: "Keterangan",
    descriptionHelp: "Tulis singkat dan jelas.",
    notes: "Catatan (boleh kosong)",
    proof: "Bukti (boleh kosong)",
    proofPick: "Ketuk untuk memilih berkas",
    proofHelp: "Foto nota atau bukti transfer. PDF, JPG, atau PNG, maksimal 5 MB, sampai 3 berkas.",
    next: "Lanjut",
    cancel: "Batal",
    /** 7.5: read-only line on a correction. */
    correctsLine: "Koreksi atas {nomor}",
    /** 7.5: Keterangan prefill of a correction (trailing space on purpose; trimmed on save). */
    correctionPrefix: "Koreksi {nomor}: ",
  },
  // 7.4 Opening balance form
  opening: {
    title: "Catat Saldo Awal",
    /** {jumlah} = formatRupiah(previousClosingBalance) (spec writes "Rp {jumlah}"; same output, sign-safe). */
    previousHint: "Saldo akhir periode {label}: {jumlah}.",
    usePrevious: "Pakai angka ini",
    amountHelp: "Hitung kas dan saldo bank yang benar-benar ada, lalu isi angkanya. Kalau memang kosong, isi 0.",
    descriptionDefault: "Saldo awal periode {label}",
    exists: "Saldo awal periode ini sudah dicatat. Batalkan yang lama kalau angkanya salah.",
  },
  // Check sheet (7.3, 7.4)
  check: {
    title: "Cek dulu",
    /** {Jenis} = type label; {jumlah} = groupRupiahDigits(amount) (the sentence carries "Rp"); {tanggal} = date. */
    summary: "{Jenis} Rp {jumlah} pada {tanggal}.",
    warning: "Setelah disimpan, transaksi tidak bisa diubah. Kalau salah, kamu hanya bisa membatalkannya.",
    outsidePeriod: "Tanggal ini di luar masa periode {label}. Tetap simpan?",
    save: "Simpan transaksi",
    back: "Kembali",
  },
  leave: {
    title: "Keluar dari halaman ini?",
    body: "Perubahan belum disimpan.",
    stay: "Tetap di sini",
    leave: "Keluar",
  },
  // 7.6 Void dialog
  void: {
    title: "Batalkan transaksi?",
    body: "{nomor} tetap tampil sebagai Dibatalkan dan tidak dihitung di total. Ini tidak bisa dikembalikan.",
    reason: "Alasan pembatalan",
    confirm: "Ya, batalkan transaksi",
    back: "Kembali",
  },
  // 7.7 Withdraw-proof dialog
  withdraw: {
    title: "Tarik berkas?",
    body: "Berkas disembunyikan dari pembaca dan hanya terlihat oleh pengelola. Berkasnya tidak dihapus.",
    reason: "Alasan",
    confirm: "Tarik berkas",
    back: "Kembali",
  },
  // 7.8 Export menu
  export: {
    menuTitle: "Unduh semua hasil filter sebagai:",
    busy: "Menyiapkan file...",
    done: "Unduhan dimulai: {file}",
  },
  // 7.9 Dashboard card (layout belongs to the Dashboard module)
  dashboard: {
    title: "Finance",
    periodLine: "Periode {label}",
    balance: "Total Saldo",
    income: "Pemasukan",
    expense: "Pengeluaran",
    link: "Buka Finance",
    empty: "Belum ada transaksi.",
    noPeriod: "Belum ada periode aktif.",
    error: "Data finance belum bisa dimuat.",
    retry: "Coba lagi",
  },
} as const;

/** One-time success notices (?notice=...). */
export const FINANCE_NOTICES = ["recorded", "voided", "proof_added", "proof_withdrawn"] as const;
export type FinanceNotice = (typeof FINANCE_NOTICES)[number];
export const FINANCE_NOTICE_COPY: Record<FinanceNotice, string> = {
  recorded: "Transaksi {nomor} tersimpan.", // 7.3 ({nomor} = numberText of the detail shown)
  voided: "Transaksi dibatalkan.", // 7.6
  proof_added: "Bukti ditambahkan.", // gap
  proof_withdrawn: "Berkas ditarik.", // gap (same as Minutes)
};

/**
 * Export columns (spec 8: number, date, type, Keterangan, Catatan, amount, status with void reason,
 * "koreksi atas", recorded by, recorded at, proof yes or no, period), in file order. Headers: gap.
 * Amount: CSV plain integer, Excel integer cell, PDF formatRupiah. hasProof: FINANCE_EXPORT_PROOF_LABEL.
 */
export const FINANCE_EXPORT_COLUMNS = [
  { key: "rowNo", header: "No" },
  { key: "numberText", header: "Nomor" },
  { key: "entryDate", header: "Tanggal" },
  { key: "entryType", header: "Jenis" },
  { key: "description", header: "Keterangan" },
  { key: "notes", header: "Catatan" },
  { key: "amount", header: "Jumlah (Rp)" },
  { key: "status", header: "Status" },
  { key: "voidReason", header: "Alasan pembatalan" },
  { key: "correctsNumberText", header: "Koreksi atas" },
  { key: "createdByName", header: "Dicatat oleh" },
  { key: "createdAt", header: "Waktu dicatat" },
  { key: "hasProof", header: "Bukti" },
  { key: "periodLabel", header: "Periode" },
] as const satisfies readonly { key: keyof FinanceExportRow; header: string }[];

export const FINANCE_EXPORT_PROOF_LABEL = { yes: "Ada", no: "Tidak ada" } as const; // gap

/**
 * Summary block at the top of every export (F7.2, A-FN14): the WHOLE period, then the filters used.
 * Labels: tiles words (7.1) and filter words (7.1); "Diekspor" and "Filter" are gap.
 */
export const FINANCE_EXPORT_SUMMARY_LABEL = {
  period: "Periode",
  opening: "Saldo awal",
  income: "Total Pemasukan",
  expense: "Total Pengeluaran",
  balance: "Total Saldo",
  exportedAt: "Diekspor",
  filters: "Filter",
  type: "Jenis",
  from: "Dari tanggal",
  to: "Sampai tanggal",
  includeVoided: "Tampilkan yang dibatalkan",
  withoutProof: "Tanpa bukti",
  search: "Pencarian",
  yes: "Ya",
  no: "Tidak",
} as const;

// =============================================================================================
// 11. Pure helpers (screen, server and export agree)
// =============================================================================================

/** Today's calendar date in Asia/Jakarta (R14) as "YYYY-MM-DD". */
export function jakartaToday(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Soft warning of the check sheet (R5, FN-24): the date lies outside the period's informational dates.
 * A missing start or end does not warn on that side. Never blocks saving.
 */
export function isOutsideFinancePeriod(date: IsoDate, startsOn: IsoDate | null, endsOn: IsoDate | null): boolean {
  return (startsOn !== null && date < startsOn) || (endsOn !== null && date > endsOn);
}

/** Negative Total Saldo (A-FN9): show the hint, never block. */
export function isNegativeRupiah(value: SignedRupiahText): boolean {
  return value.startsWith("-");
}

/** Values a record form opens with ("Buat koreksi", "Catat ulang"). Strings as the fields hold them. */
export type FinanceRecordPrefill = {
  entryType: FinanceEntryType;
  /** null = the form's default (today). */
  entryDate: IsoDate | null;
  /** Digits; the field shows rupiahInputDisplay(amount). */
  amount: RupiahText;
  description: string;
  notes: string | null;
  correctsEntryId: string | null;
  /** For the read-only line "Koreksi atas {nomor}". */
  correctsNumberText: string | null;
};

/**
 * "Buat koreksi" (F5, screen 5): opposite type, same amount, Keterangan "Koreksi {nomor}: ", link to the
 * old entry, date today. null when the detail does not offer it (actions.canCorrect) or it is a Saldo awal.
 */
export function financeCorrectionPrefill(detail: FinanceEntryDetail): FinanceRecordPrefill | null {
  if (!detail.actions.canCorrect || detail.entryType === "opening") return null;
  return {
    entryType: detail.entryType === "income" ? "expense" : "income",
    entryDate: null,
    amount: detail.amount,
    description: formatFinanceCopy(FINANCE_COPY.form.correctionPrefix, { nomor: detail.numberText }),
    notes: null,
    correctsEntryId: detail.entryId,
    correctsNumberText: detail.numberText,
  };
}

/**
 * "Catat ulang" (F4, screen 5): a copy of the voided entry (type, date, amount, Keterangan, Catatan), no
 * link and no proofs. A Saldo awal opens the opening form (financeRerecordPath). null unless canRerecord.
 */
export function financeRerecordPrefill(detail: FinanceEntryDetail): FinanceRecordPrefill | null {
  if (!detail.actions.canRerecord) return null;
  return {
    entryType: detail.entryType,
    entryDate: detail.entryDate,
    amount: detail.amount,
    description: detail.description,
    notes: detail.notes,
    correctsEntryId: null,
    correctsNumberText: null,
  };
}

/**
 * "Pakai angka ini" (K3 a, FN-21): the previous closing balance as digits for the amount field, only
 * when the person presses the button (never a silent prefill). null when there is none or it is
 * negative (no amount is ever negative; the hint line still shows the number).
 */
export function openingAmountFromPrevious(summary: Pick<FinanceSummary, "previousClosingBalance">): RupiahText | null {
  const value = summary.previousClosingBalance;
  return value === null || isNegativeRupiah(value) ? null : value;
}

/** Export file name: "finance-2026-2027-2026-11-10.xlsx" (period label made file-safe, Jakarta date). gap. */
export function financeExportFileName(format: FinanceExportFormat, periodLabel: string | null, now: Date = new Date()): string {
  const label = (periodLabel ?? "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `finance-${label === "" ? "" : `${label}-`}${jakartaToday(now)}.${format}`;
}

// =============================================================================================
// 12. Capabilities (menus and buttons only; every server entry point and the database check again)
// =============================================================================================

export type FinanceCapabilities = {
  /** finance.view (BPH D02; included in finance.manage D24): drawer item, list, detail, proofs, Dashboard card. */
  canView: boolean;
  /** finance.manage (Treasurers D24) AND view: manager hints and per-entry buttons (detail.actions). */
  canManage: boolean;
  /** canManage AND an active period: "Catat transaksi", "Catat saldo awal" (R11). */
  canRecord: boolean;
  /** finance.export AND view (R15; D03, D25): "Ekspor". */
  canExport: boolean;
  /** canManage AND an active period: proof upload (bucket policy finance_proof_can_upload). */
  canUploadProof: boolean;
  /** false = the "Belum ada periode aktif" banner for managers. */
  hasActivePeriod: boolean;
};

const NO_FINANCE_CAPABILITIES: FinanceCapabilities = {
  canView: false,
  canManage: false,
  canRecord: false,
  canExport: false,
  canUploadProof: false,
  hasActivePeriod: false,
};

/**
 * Derives the capabilities from the session state. my_permissions() already returns the union of all
 * active-period assignments with implied keys (finance.manage -> finance.view) and export gated on view
 * (R15). Without an active period rule-based keys match nothing (R11, E4), so Finance is closed. Finance
 * keys accept scope "all" only: a "units" grant is ignored (the database allows none). Being System Admin
 * gives nothing here (B18, AC-03): only the keys count.
 */
export function financeCapabilities(state: AccessState): FinanceCapabilities {
  if (state.kind !== "member") return NO_FINANCE_CAPABILITIES;
  const has = (key: string) => state.permissions.some((grant) => grant.key === key && grant.scope === "all");
  const hasActivePeriod = state.member.activePeriodId !== null;
  const canView = has("finance.view");
  const canManage = canView && has("finance.manage");
  return {
    canView,
    canManage,
    canRecord: canManage && hasActivePeriod,
    canExport: canView && has("finance.export"),
    canUploadProof: canManage && hasActivePeriod,
    hasActivePeriod,
  };
}

/*
 * =============================================================================================
 * 13. Functions the backend will provide (signatures are part of this contract). All server only.
 *     Each one: session + capability check first (getAccessState), zod validation
 *     (financeErrorFromZod), then ONE call to the nexus RPC with the USER's client (the database checks
 *     again), answer parsed with the section 8 schema (mismatch = unavailable), refusals mapped with
 *     financeErrorFromDb(hint, detail, action). Never throws; returns FinanceResult<T>. Write functions
 *     are Server Actions ("use server"). The RPC wrappers and every Storage call live in
 *     src/lib/picore/finance.ts (the functions read PI-CORE names and periods; CLAUDE.md 4).
 *     A malformed id given as a page address answers not_found "entry".
 * =============================================================================================
 *
 * src/modules/finance/server/reads.ts                                           (canView)
 *   listFinancePeriods(): Promise<FinanceResult<FinancePeriodOption[]>>                 finance_period_list
 *   getFinanceSummary(input?: FinanceSummaryQueryInput): Promise<FinanceResult<FinanceSummary>>
 *                                                                                       finance_summary
 *     Header tiles and hints of the selected period, the opening form's previous-closing hint, and the
 *     Dashboard card (no input = the active period; no_active_period -> card text "Belum ada periode aktif.").
 *   listFinanceEntries(input: FinanceListQueryInput): Promise<FinanceResult<FinanceEntryPage>>
 *                                                                                       finance_entry_list
 *   getFinanceEntryDetail(entryId: string): Promise<FinanceResult<FinanceEntryDetail>>  finance_entry_detail
 *     Returns `detail` only; proofPaths stay on the server.
 *
 * src/modules/finance/server/actions.ts                                         ("use server"; canManage)
 *   recordFinanceEntry(input: FinanceRecordInput): Promise<FinanceResult<FinanceRecordResult>>
 *     (canRecord) finance_entry_record. Server checks entryDate not after jakartaToday() first
 *     (date_in_future, field entryDate). Sends p_amount as the digits TEXT, p_idempotency_key = submitKey,
 *     p_corrects_entry_id, p_files = [{ path, name }]. action for errors: "recordOpening" when
 *     entryType is opening, else "record". replayed = true is a success (same notice).
 *   voidFinanceEntry(input: FinanceVoidInput): Promise<FinanceResult<FinanceVoidResult>>  finance_entry_void
 *   addFinanceProof(input: FinanceAddProofInput): Promise<FinanceResult<FinanceProofResult>>
 *                                                                                       finance_entry_add_proof
 *   withdrawFinanceProof(input: FinanceWithdrawProofInput): Promise<FinanceResult<FinanceProofResult>>
 *                                                                                       finance_entry_withdraw_proof
 *   getFinanceProofLink(input: FinanceProofLinkInput): Promise<FinanceResult<FinanceProofLink>>   (canView)
 *     Pressed "Lihat" (the link is made at the press, so it never expires under an open page). Reads
 *     finance_entry_detail for entryId, finds fileId among the proofPaths the database returned to THIS
 *     caller (absent = not_found "file"), signs it for FINANCE_PROOF_SIGNED_URL_TTL_SECONDS with the
 *     USER's client (bucket policy finance_proof_can_read checks again; refusal = not_found "file").
 *
 * POST FINANCE_ROUTES.proofUpload = /api/finance/proofs   (multipart: FINANCE_PROOF_UPLOAD_FIELDS; canUploadProof)
 *   Same-origin check; session (401/403: a non-manager gets forbidden); active period (else
 *   no_active_period, 409); body capped near FINANCE_PROOF_MAX_BYTES (over: file_too_large 413, field
 *   "file", ref null, maxMb 5); declared type and size (financeUploadFileSchema) AND
 *   sniffFinanceProofType(first bytes) equal to the declared type (else invalid_file 400, field "file");
 *   then uploads with the USER's client to FINANCE_PROOF_BUCKET at financeProofPath(session member id,
 *   randomUUID(), type), contentType = the type, no overwrite. A Storage refusal with an active period and
 *   the key = upload_limit 429 (limit 10); anything else = unavailable 503. 200: FinanceProofUploadResult
 *   (name = cleanFinanceProofName(file.name, type)). Every non-2xx: FinanceErrorBody. Cache-Control
 *   no-store. Other methods: 405.
 *
 * POST FINANCE_ROUTES.export = /api/finance/export   (form/JSON: FinanceExportInput; canExport)
 *   Same-origin check, body cap, ONE call to finance_export (writes the export-log row in the same
 *   transaction; no row, no file), parsed with financeExportDbSchema. Refusals: too_many_rows ->
 *   export_too_large 422 (rowCount); fewer rows than totalCount (max_rows cut) -> export_too_large 422
 *   (rowCount null), no file. An empty result reads finance_summary(periodId) for the summary block.
 *   200: the file, Content-Disposition attachment financeExportFileName(format, periodLabel) (Jakarta
 *   date). File: summary block first (FINANCE_EXPORT_SUMMARY_LABEL: period, Saldo awal, Total
 *   Pemasukan, Total Pengeluaran, Total Saldo, export time in WIB, the filters used), then the rows
 *   (FINANCE_EXPORT_COLUMNS) in screen order. Money: CSV plain integers and Excel integer cells via
 *   rupiahToSafeInteger (never money TEXT into the CSV writer), PDF via formatRupiah. Text cells through
 *   the formula-neutralising writers (A-FN14). Dates in WIB. No proof contents or links. Cache-Control
 *   no-store. 401/403/400/503: FinanceErrorBody. Other methods: 405.
 */
