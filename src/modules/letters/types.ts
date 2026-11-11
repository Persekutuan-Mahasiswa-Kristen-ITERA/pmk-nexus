// Contract between the Letters backend (src/lib/picore/letters.ts, src/modules/letters/server) and the UI
// (src/modules/letters/ui, src/app). Written 2026-11-09 by the backend engineer.
// Change it only after telling the tech lead: both sides depend on it.
//
// Spec:     docs/modules/letters.md (APPROVED 2026-11-09 incl. the "Ambil nomor" amendment G1; F1-F9,
//           4.1-4.4, R1-R20, A-LT1..A-LT24, LT-01..LT-52). Decisions: D-024, D-025.
// Design:   docs/design/letters.md (APPROVED 2026-11-09; screens 1-13, P1-P15, G1-G18). Copy quoted below
//           comes from there or from the owner's approval of 2026-11-09 ("owner"); where neither has a
//           text the generic text is used and the case is listed in src/modules/letters/README.md.
// Database: supabase/migrations/20261110100000_nexus_letters.sql (the 27 public nexus.letter_* functions)
//           and 20261110100100_nexus_letters_storage.sql (bucket nexus-letter-files). Reference:
//           supabase/README.md section 3.2 (decisions D1-D10, hint codes).
//
// Pure and isomorphic: safe to import from Server Components, Client Components and route handlers.
// Stored values are the database's English identifiers; Indonesian labels are in section 9.
// No type here holds email, phone, NIM, NIP or auth user ids (access control L4). PI-CORE member ids
// the database returns (requester_member_id) are read by the server but NOT exposed: `isOwn` covers
// what the UI needs. Storage paths of SAVED files are never exposed either; links come from
// getLetterFileLink(). Only the path of the caller's own fresh upload travels (upload -> save).
// Zod issue messages in this file are machine codes (LetterErrorCode), never shown to people. The server
// turns the FIRST issue into an error: a message that is a known code keeps that code (with the issue
// path's first key as `field`; payload fields such as `count` or `ref` are filled as section 8 says);
// any other message (zod's own, e.g. a failed discriminated union) becomes invalid_input for that field.

import { z } from "zod";
import type { AccessState } from "@/lib/auth/types";

// =============================================================================================
// 1. Limits (mirror the database CHECKs and functions; the database checks again). A-LT18, L8, L10.
// =============================================================================================

export const LETTER_LIMITS = {
  /** Perihal (letters and requests). */
  subject: 200,
  /** Pengirim / Ditujukan kepada of a register letter, and the request's "Ditujukan kepada". */
  counterpart: 150,
  addressee: 150,
  /** "Nomor surat dari pengirim" (incoming only). */
  counterpartNumber: 60,
  /** "Nomor lama" typed from an old letter (L7 b). */
  legacyNumber: 60,
  /** Catatan of a letter, processor notes, void / withdraw / cancel / numbering reasons. */
  notes: 500,
  note: 500,
  reason: 500,
  /** Request "Keperluan". */
  purpose: 1000,
  /** Request "Atas nama". */
  onBehalfOf: 120,
  /** Stored number text (letters.number_text CHECK). */
  numberText: 80,
  /** Original file name stored with a file (1..200, no control characters). */
  fileName: 200,
  /** Visible (not withdrawn) files per letter, and attachments per request (L8 b, G4). */
  filesPerParent: 3,
  /** Bucket and database limit per file: 4 MiB (4194304 bytes), lowered for the Vercel 4.5 MB request cap. */
  fileMaxBytes: 4_194_304,
  /** Uploads not yet attached to a saved letter or request, per member, last 24 hours (A-LT13). The 11th is refused. */
  unattachedUploadsPer24h: 10,
  /** L10 b: open = Diajukan or Diproses; daily = per Jakarta day. */
  openRequestsPerMember: 5,
  requestsPerDay: 10,
  /** Dates before this are refused by the database. */
  minDate: "2000-01-01",
  /** Number year bounds (letter_number_counters CHECK). */
  yearMin: 2000,
  yearMax: 2999,
  /** Numbering format (letter_numbering_settings CHECKs). */
  prefix: 30,
  typeCode: 10,
  seqDigitsMin: 1,
  seqDigitsMax: 6,
  /** "Atur nomor berikutnya": 1..9999999 (letter_numbering_set_next). */
  nextSeqMax: 9_999_999,
} as const;

/** Rows per page on screen (A-LT15) and the hard server maximum (refused, never clamped). */
export const LETTER_PAGE_SIZE_DEFAULT = 20;
export const LETTER_PAGE_SIZE_MAX = 50;
/** Search: max length after trimming and collapsing spaces; raw input above 480 is refused first. */
export const LETTER_SEARCH_MAX_LENGTH = 120;
export const LETTER_SEARCH_RAW_MAX_LENGTH = 480;

/**
 * Query parameter names of the module's addresses (short English names, like Data Anggota and
 * Inventory). Values: period "active" | "all"; status "all" | "active" | "voided"; nofile "1" = on;
 * view = LetterQueueView; filter = MyRequestsFilter; dates "YYYY-MM-DD"; again = the request id that
 * "Ajukan lagi" prefills from (P14); notice = a one-time success notice (values owned by the UI).
 * The address is user-editable: the UI falls back to defaults, the server validates again.
 */
export const LETTER_PARAMS = {
  search: "q",
  period: "period",
  year: "year",
  status: "status",
  withoutFiles: "nofile",
  page: "page",
  view: "view",
  from: "from",
  to: "to",
  filter: "filter",
  again: "again",
  notice: "notice",
} as const;

// =============================================================================================
// 2. Enums (exactly the values stored or accepted by the database)
// =============================================================================================

/** incoming = Surat Masuk (SM), outgoing = Surat Keluar (SK). */
export const letterTypeSchema = z.enum(["incoming", "outgoing"], { message: "invalid_input" });
export type LetterType = z.infer<typeof letterTypeSchema>;

/** Register status (L5): active = Aktif, voided = Dibatalkan ("Batalkan nomor", never restored, A-LT8). */
export const letterStatusSchema = z.enum(["active", "voided"]);
export type LetterStatus = z.infer<typeof letterStatusSchema>;

/** Register "Status" filter (design 5.1). */
export const letterStatusFilterSchema = z.enum(["all", "active", "voided"], { message: "invalid_input" });
export type LetterStatusFilter = z.infer<typeof letterStatusFilterSchema>;

/** Register "Periode" filter: only the active period or all periods (design G8; no single old period). */
export const letterPeriodFilterSchema = z.enum(["active", "all"], { message: "invalid_input" });
export type LetterPeriodFilter = z.infer<typeof letterPeriodFilterSchema>;

/** Request status (spec 4.2). "Menunggu file final", "Lewat tanggal", "Nomor dibatalkan" are derived, never a status. */
export const letterRequestStatusSchema = z.enum(["submitted", "processing", "issued", "rejected", "cancelled"]);
export type LetterRequestStatus = z.infer<typeof letterRequestStatusSchema>;
/** Open = still waiting for a secretary (counts toward the cap of 5, L10). */
export const OPEN_LETTER_REQUEST_STATUSES = ["submitted", "processing"] as const satisfies readonly LetterRequestStatus[];

/** Request timeline events. number_taken = "Ambil nomor" (no status change). */
export const letterRequestEventSchema = z.enum(["submitted", "processing", "number_taken", "issued", "rejected", "cancelled"]);
export type LetterRequestEvent = z.infer<typeof letterRequestEventSchema>;

/** Letter history kinds (design 6.3 Riwayat). */
export const letterHistoryKindSchema = z.enum(["registered", "edited", "file_added", "file_withdrawn", "voided"]);
export type LetterHistoryKind = z.infer<typeof letterHistoryKindSchema>;

/**
 * Antrean views (design 11.1, database _lt_queue_rows):
 * submitted = Menunggu (Diajukan, all periods, oldest first); processing = Sedang diproses (Diproses, no
 * number yet, oldest first); awaiting_file = Menunggu file final (Diproses with a number, oldest number
 * first); closed = Selesai (Diterbitkan, Ditolak, Dibatalkan, all periods, newest change first);
 * all = everything of the ACTIVE period, newest first (empty without one); open_all_periods = handover
 * list (Diajukan + Diproses of every period, oldest period first, A-LT21).
 */
export const letterQueueViewSchema = z.enum(["submitted", "processing", "awaiting_file", "closed", "all", "open_all_periods"], {
  message: "invalid_input",
});
export type LetterQueueView = z.infer<typeof letterQueueViewSchema>;

/** "Permohonan Saya" filter (design 10.1): open = Berjalan, closed = Selesai, all = Semua (default, see below). */
export const myLetterRequestsFilterSchema = z.enum(["open", "closed", "all"], { message: "invalid_input" });
export type MyLetterRequestsFilter = z.infer<typeof myLetterRequestsFilterSchema>;
/**
 * Default "all" (the database default): open requests are listed first anyway, and an ISSUED request
 * (the one with the file to download) is "closed", so "open" as default would hide it.
 */
export const MY_LETTER_REQUESTS_FILTER_DEFAULT: MyLetterRequestsFilter = "all";

/** Export formats (D-020, same three as Data Anggota and Inventory). */
export const letterExportFormatSchema = z.enum(["xlsx", "csv", "pdf"], { message: "invalid_input" });
export type LetterExportFormat = z.infer<typeof letterExportFormatSchema>;

/** Numbering change kinds (letter_numbering_changes). */
export const numberingChangeKindSchema = z.enum(["format", "next_sequence"]);
export type NumberingChangeKind = z.infer<typeof numberingChangeKindSchema>;

/** Number separator: exactly one of these (letter_numbering_settings CHECK). */
export const NUMBER_SEPARATORS = ["/", "-", "."] as const;
export const numberSeparatorSchema = z.enum(NUMBER_SEPARATORS, { message: "invalid_number_format" });
export type NumberSeparator = z.infer<typeof numberSeparatorSchema>;

// =============================================================================================
// 3. Small shared schemas
// =============================================================================================

/** Code points, like Postgres char_length (JS .length would count an emoji twice). */
function charLength(text: string): number {
  return [...text].length;
}

/** nexus ids. z.guid() (not z.uuid()) like the other modules; the database accepts any 8-4-4-4-12 hex. */
const idSchema = z.guid({ message: "invalid_input" });

/** Optimistic-lock version from the last read; a mismatch answers state_changed ("Data sudah berubah"). */
const versionSchema = z.number({ message: "invalid_input" }).int({ message: "invalid_input" }).min(1, { message: "invalid_input" });

/** letter_files.id (bigint identity; safe as a JS number far beyond any real count). */
const fileIdSchema = z
  .number({ message: "invalid_input" })
  .int({ message: "invalid_input" })
  .min(1, { message: "invalid_input" })
  .max(Number.MAX_SAFE_INTEGER, { message: "invalid_input" });

/** Optional text: trimmed, blank -> null, then the length cap (same order as nexus._lt_text). */
function optionalTextSchema(max: number) {
  return z
    .string({ message: "invalid_input" })
    .nullish()
    .transform((raw) => {
      const trimmed = (raw ?? "").trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine((text) => text === null || charLength(text) <= max, { message: "text_too_long" });
}

/** Required text: trimmed, then not blank and within the cap. `missing` is the code a blank answers. */
function requiredTextSchema(max: number, missing: "text_required" | "reason_required" | "note_required" = "text_required") {
  return z
    .string({ message: missing })
    .transform((raw) => raw.trim())
    .refine((text) => text !== "", { message: missing })
    .refine((text) => charLength(text) <= max, { message: "text_too_long" });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

/** A real "YYYY-MM-DD" date, not before 2000-01-01 (the database refuses earlier dates). */
export function isValidLetterDate(date: string): boolean {
  return ISO_DATE.test(date) && isRealDate(date) && date >= LETTER_LIMITS.minDate;
}

/** A real calendar date as "YYYY-MM-DD" (Asia/Jakarta calendar day, R16), not before 2000-01-01. */
export const isoDateSchema = z
  .string({ message: "invalid_dates" })
  .refine(isValidLetterDate, { message: "invalid_dates" });

/**
 * Required date field of a form: blank or missing = date_required ("Pilih tanggal ..."), malformed =
 * invalid_dates. "Not after today" (date_in_future) is checked by the SERVER with jakartaToday() before
 * the RPC (and by the database), not here: a schema must not depend on the clock of the device.
 */
const requiredDateSchema = z.string({ message: "date_required" }).superRefine((value, ctx) => {
  if (value.trim() === "") ctx.addIssue({ code: "custom", message: "date_required" });
  else if (!isValidLetterDate(value)) ctx.addIssue({ code: "custom", message: "invalid_dates" });
});

/** Optional date field: blank or missing = null; otherwise a valid date. */
const optionalDateSchema = z
  .string({ message: "invalid_dates" })
  .nullish()
  .transform((raw) => {
    const trimmed = (raw ?? "").trim();
    return trimmed === "" ? null : trimmed;
  })
  .refine((date) => date === null || isValidLetterDate(date), { message: "invalid_dates" });

/** Year in the number ("Tahun nomor" filter; "Atur nomor berikutnya"). */
const yearSchema = z
  .number({ message: "invalid_input" })
  .int({ message: "invalid_input" })
  .min(LETTER_LIMITS.yearMin, { message: "invalid_input" })
  .max(LETTER_LIMITS.yearMax, { message: "invalid_input" });

/** Search: same cleaning and caps as nexus._lt_search_pattern. Blank = no search (null). */
export const letterSearchSchema = z
  .string({ message: "invalid_input" })
  .refine((raw) => charLength(raw) <= LETTER_SEARCH_RAW_MAX_LENGTH, { message: "search_too_long" })
  .transform((raw) => raw.trim().replace(/\s+/g, " "))
  .refine((clean) => charLength(clean) <= LETTER_SEARCH_MAX_LENGTH, { message: "search_too_long" })
  .transform((clean) => (clean === "" ? null : clean));

const pageSchema = z.number({ message: "invalid_page" }).int({ message: "invalid_page" }).min(1, { message: "invalid_page" });
const pageSizeSchema = z
  .number({ message: "invalid_page_size" })
  .int({ message: "invalid_page_size" })
  .min(1, { message: "invalid_page_size" })
  .max(LETTER_PAGE_SIZE_MAX, { message: "invalid_page_size" });

/** Both dates or none; end not before start. */
function checkOptionalRange(from: string | null, to: string | null, toPath: string, ctx: z.RefinementCtx): void {
  if ((from === null) !== (to === null) || (from !== null && to !== null && to < from)) {
    ctx.addIssue({ code: "custom", message: "invalid_dates", path: [toPath] });
  }
}

// =============================================================================================
// 4. Files (spec 4.4, L8 b, A-LT13; database decision D3; storage migration 20261110100100)
// =============================================================================================

/** Private bucket. Only the path is stored; people get short-lived signed URLs (CLAUDE.md 11). */
export const LETTER_FILE_BUCKET = "nexus-letter-files";
export const LETTER_FILE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type LetterFileMimeType = (typeof LETTER_FILE_MIME_TYPES)[number];
export const LETTER_FILE_EXTENSION: Record<LetterFileMimeType, "pdf" | "jpg" | "png"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
/** 4 MiB, the bucket and database limit. Over it: "Berkas terlalu besar. Batasnya 4 MB. ..." (design 3.3). */
export const LETTER_FILE_MAX_BYTES = LETTER_LIMITS.fileMaxBytes;
export const LETTER_FILE_MAX_MB = 4;
/** Lifetime of a signed file link (A-LT13, same as A-IB51). Made when "Lihat"/"Unduh" is pressed. */
export const LETTER_FILE_SIGNED_URL_TTL_SECONDS = 300;
/**
 * Browser resize of IMAGES before upload (design 3.3, G14 assumption): long side about 2000 px, quality
 * lowered in steps until the file is under LETTER_FILE_MAX_BYTES. PDF is never resized. Client hint only.
 */
export const LETTER_IMAGE_RESIZE_LONG_SIDE_PX = 2000;

/**
 * Upload goes through the NEXUS route, never straight from the browser to Storage: the server checks the
 * file's real type from its first bytes (magic bytes) against the declared type (LT-26), then uploads
 * with the USER's client (bucket policy letter_file_can_upload checks the folder, the active period and
 * the 10-per-24-hours cap again). Upload when the file is picked (design 3.3), BEFORE the letter or
 * request exists; the save action attaches it.
 */
export const LETTER_FILE_UPLOAD_ROUTE = "/api/letters/files";
/** Multipart field names of the upload route: exactly one file, nothing else. */
export const LETTER_FILE_UPLOAD_FIELDS = { file: "file" } as const;

/**
 * Same pattern as the database: "<uploader members.id>/<random uuid>.<pdf|jpg|jpeg|png>", lowercase
 * (decision D3: the uploader's OWN folder; a save attaches only the caller's own uploads). NEXUS itself
 * writes only pdf, jpg and png.
 */
export const LETTER_FILE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/;
export const letterFilePathSchema = z.string({ message: "invalid_file" }).regex(LETTER_FILE_PATH_PATTERN, { message: "invalid_file" });

/** Builds the storage path of a new upload. `fileId` is a fresh random uuid (crypto.randomUUID()). */
export function letterFilePath(memberId: string, fileId: string, type: LetterFileMimeType): string {
  return `${memberId.toLowerCase()}/${fileId.toLowerCase()}.${LETTER_FILE_EXTENSION[type]}`;
}

/**
 * The file's real type from its first bytes, or null. PDF "%PDF-" (25 50 44 46 2D) at offset 0,
 * JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A. The upload route refuses a file whose real type is null
 * or differs from the declared type (invalid_file). The browser may use it for early feedback.
 */
export function sniffLetterFileType(bytes: Uint8Array): LetterFileMimeType | null {
  const at = (sig: readonly number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  // Also drop invisible and bidi-override characters, so a name cannot display as "scan_fdp.exe".
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * The original file name as stored (1..200 code points, no control characters, as _lt_check_files).
 * Control characters are dropped, spaces trimmed, the name cut to 200 code points; an empty result
 * becomes "berkas.<ext>". The upload route returns this cleaned name; the UI sends it back unchanged.
 */
export function cleanLetterFileName(raw: string, type: LetterFileMimeType): string {
  const kept = [...raw].filter((ch) => !isControlChar(ch)).join("").trim();
  const cut = [...kept].slice(0, LETTER_LIMITS.fileName).join("").trim();
  return cut === "" ? `berkas.${LETTER_FILE_EXTENSION[type]}` : cut;
}

/** The declared file the browser sends (AFTER resizing images). The route also sniffs the bytes. */
export const letterUploadFileSchema = z.object({
  type: z.enum(LETTER_FILE_MIME_TYPES, { message: "invalid_file" }),
  size: z
    .number({ message: "invalid_file" })
    .int({ message: "invalid_file" })
    .min(1, { message: "invalid_file" })
    .max(LETTER_FILE_MAX_BYTES, { message: "file_too_large" }),
});

/** A just-uploaded file passed to a save action (the upload route's answer: path + cleaned name). */
export const letterFileRefSchema = z.object({
  path: letterFilePathSchema,
  name: z
    .string({ message: "invalid_file" })
    .transform((raw) => raw.trim())
    .refine((name) => name !== "" && charLength(name) <= LETTER_LIMITS.fileName && ![...name].some(isControlChar), {
      message: "invalid_file",
    }),
});

/**
 * A list of just-uploaded files, `min`..`max`, each path once. Too few = file_required, too many =
 * file_count (the server fills `count` with the bound). The database checks again: own folder, not
 * attached before (file_already_attached), really uploaded (file_missing), size and type.
 */
function fileListSchema(min: number, max: number) {
  return z
    .array(letterFileRefSchema, { message: "invalid_file" })
    .min(min, { message: "file_required" })
    .max(max, { message: "file_count" })
    .refine((files) => new Set(files.map((f) => f.path)).size === files.length, { message: "invalid_file" });
}

export type LetterFileRefInput = z.input<typeof letterFileRefSchema>;
export type LetterUploadFileInput = z.input<typeof letterUploadFileSchema>;

// =============================================================================================
// 5. Read inputs (lists, filters, settings history)
// =============================================================================================

/**
 * Register filters (F1, design screen 2), shared by the list and the export (R15: the export never
 * shows more than the screen). `type` comes from the tab (Surat Masuk / Surat Keluar), the rest from
 * the address (LETTER_PARAMS). year = the year IN THE NUMBER (a "Nomor lama" has none, so a year filter
 * hides them); withoutFiles = "Tanpa berkas" (no visible file).
 */
export const letterListFiltersSchema = z.object({
  type: letterTypeSchema,
  search: letterSearchSchema.nullable().default(null),
  period: letterPeriodFilterSchema.default("active"),
  year: yearSchema.nullable().default(null),
  status: letterStatusFilterSchema.default("all"),
  withoutFiles: z.boolean({ message: "invalid_input" }).default(false),
});

export const letterListQuerySchema = z.object({
  filters: letterListFiltersSchema,
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(LETTER_PAGE_SIZE_DEFAULT),
});

export const myLetterRequestsQuerySchema = z.object({
  filter: myLetterRequestsFilterSchema.default(MY_LETTER_REQUESTS_FILTER_DEFAULT),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(LETTER_PAGE_SIZE_DEFAULT),
});

/**
 * Antrean filters (F6, design 11.1). Search matches requester name or Perihal only. Dates: both or none,
 * the request's submit date (Jakarta) within [from, to]; past dates allowed. No period filter: the views
 * define the periods (open views span all periods, L7).
 */
export const letterQueueFiltersSchema = z
  .object({
    view: letterQueueViewSchema.default("submitted"),
    search: letterSearchSchema.nullable().default(null),
    from: isoDateSchema.nullable().default(null),
    to: isoDateSchema.nullable().default(null),
  })
  .superRefine((f, ctx) => checkOptionalRange(f.from, f.to, "to", ctx));

export const letterQueueQuerySchema = z.object({
  filters: letterQueueFiltersSchema.prefault({}),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(LETTER_PAGE_SIZE_DEFAULT),
});

/** "Riwayat perubahan" of the numbering settings, newest first. */
export const numberingHistoryQuerySchema = z.object({
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(LETTER_PAGE_SIZE_DEFAULT),
});

/** Export body: the validated filters the screen shows (incl. the tab's type), plus the format (F8). */
export const letterExportSchema = z.object({ format: letterExportFormatSchema, filters: letterListFiltersSchema });

/** "Lihat" / "Unduh" on a file: which parent screen it was shown on, and the file. */
export const letterFileLinkSchema = z.discriminatedUnion("parent", [
  z.object({ parent: z.literal("letter"), letterId: idSchema, fileId: fileIdSchema }),
  z.object({ parent: z.literal("request"), requestId: idSchema, fileId: fileIdSchema }),
]);

export type LetterListFiltersInput = z.input<typeof letterListFiltersSchema>;
export type LetterListFilters = z.output<typeof letterListFiltersSchema>;
export type LetterListQueryInput = z.input<typeof letterListQuerySchema>;
export type MyLetterRequestsQueryInput = z.input<typeof myLetterRequestsQuerySchema>;
export type LetterQueueFiltersInput = z.input<typeof letterQueueFiltersSchema>;
export type LetterQueueFilters = z.output<typeof letterQueueFiltersSchema>;
export type LetterQueueQueryInput = z.input<typeof letterQueueQuerySchema>;
export type NumberingHistoryQueryInput = z.input<typeof numberingHistoryQuerySchema>;
export type LetterExportInput = z.input<typeof letterExportSchema>;
export type LetterFileLinkInput = z.input<typeof letterFileLinkSchema>;

// =============================================================================================
// 6. Write inputs. Every letter and request action sends the `version` the screen read. The actor,
//    the requester and the period are ALWAYS taken from the session by the database, never inputs.
//    Date rules the schema cannot know (they depend on today in Asia/Jakarta) are checked by the server
//    with jakartaToday() BEFORE the RPC, and by the database again:
//      letterDate, receivedDate: not after today -> date_in_future (field = that date);
//      neededBy: not before today -> date_in_past.
// =============================================================================================

/** "Nomor lama" (L7 b, G7, P9): trimmed, inner whitespace collapsed (as the database), blank = null. */
const legacyNumberSchema = z
  .string({ message: "invalid_input" })
  .nullish()
  .transform((raw) => {
    const clean = (raw ?? "").trim().replace(/\s+/g, " ");
    return clean === "" ? null : clean;
  })
  .refine((text) => text === null || charLength(text) <= LETTER_LIMITS.legacyNumber, { message: "text_too_long" });

const letterCommonFields = {
  subject: requiredTextSchema(LETTER_LIMITS.subject),
  /** incoming = Pengirim, outgoing = Ditujukan kepada (LETTER_COUNTERPART_LABEL). */
  counterpart: requiredTextSchema(LETTER_LIMITS.counterpart),
  notes: optionalTextSchema(LETTER_LIMITS.notes),
};

/**
 * "Catat Surat Masuk" / "Catat Surat Keluar" (F2, F3, design screen 4). The number is assigned by the
 * database at save; legacyNumber set = "Surat lama" checked: the typed number is stored as is, must be
 * new for this type (duplicate_number), and never moves the counter. Files are optional (0..3).
 * Needs letters.manage and an active period.
 */
export const letterRegisterSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("incoming"),
    ...letterCommonFields,
    receivedDate: requiredDateSchema,
    letterDate: optionalDateSchema,
    counterpartNumber: optionalTextSchema(LETTER_LIMITS.counterpartNumber),
    legacyNumber: legacyNumberSchema,
    files: fileListSchema(0, LETTER_LIMITS.filesPerParent).default([]),
  }),
  z.object({
    type: z.literal("outgoing"),
    ...letterCommonFields,
    letterDate: requiredDateSchema,
    legacyNumber: legacyNumberSchema,
    files: fileListSchema(0, LETTER_LIMITS.filesPerParent).default([]),
  }),
]);

/**
 * "Ubah rincian" (F4.1, L6, G3): an Aktif letter of the ACTIVE period (else letter_voided /
 * closed_period). Send `type` = detail.type and every field as shown on the form; an unchanged form
 * writes nothing (`changed: false`, the UI shows "Belum ada yang diubah."). Number, type and year are
 * never editable. Allowed also while the letter's request is Diproses (database decision D4).
 */
export const letterUpdateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("incoming"),
    letterId: idSchema,
    version: versionSchema,
    ...letterCommonFields,
    receivedDate: requiredDateSchema,
    letterDate: optionalDateSchema,
    counterpartNumber: optionalTextSchema(LETTER_LIMITS.counterpartNumber),
  }),
  z.object({
    type: z.literal("outgoing"),
    letterId: idSchema,
    version: versionSchema,
    ...letterCommonFields,
    letterDate: requiredDateSchema,
  }),
]);

/**
 * "Tambah berkas" (F4.2, design 8.3): 1..actions.filesRoom files. Refused for a voided or old-period
 * letter and while the letter's request is Diproses (request_open, A-LT24).
 */
export const letterAddFilesSchema = z.object({
  letterId: idSchema,
  version: versionSchema,
  files: fileListSchema(1, LETTER_LIMITS.filesPerParent),
});

/**
 * "Tarik berkas" (F4.2, A-LT9, G4, design 8.2). `version` = the LETTER's version. Reason required.
 * The last visible file of a letter made from a request is refused (last_issued_file).
 */
export const letterWithdrawFileSchema = z.object({
  fileId: fileIdSchema,
  version: versionSchema,
  reason: requiredTextSchema(LETTER_LIMITS.reason, "reason_required"),
});

/** "Batalkan nomor" (F4.3, design 8.1). Reason required. Refused while the request is Diproses (request_open). */
export const letterVoidSchema = z.object({
  letterId: idSchema,
  version: versionSchema,
  reason: requiredTextSchema(LETTER_LIMITS.reason, "reason_required"),
});

/**
 * "Ajukan Surat" (F5, L3 b, design screen 6). Any active member, for themselves; needs an active period.
 * neededBy ("Dibutuhkan paling lambat") is only a hint (G16), not before today. Attachments 0..3.
 * Caps (L10 b, database): 5 open (too_many_open_requests), 10 per Jakarta day (daily_request_limit).
 */
export const letterRequestCreateSchema = z.object({
  subject: requiredTextSchema(LETTER_LIMITS.subject),
  addressee: requiredTextSchema(LETTER_LIMITS.addressee),
  purpose: requiredTextSchema(LETTER_LIMITS.purpose),
  onBehalfOf: optionalTextSchema(LETTER_LIMITS.onBehalfOf),
  neededBy: optionalDateSchema,
  files: fileListSchema(0, LETTER_LIMITS.filesPerParent).default([]),
});

/** "Batalkan permohonan" (F7.3): the requester only, only while Diajukan (A-LT6). Reason optional. */
export const letterRequestCancelSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  reason: optionalTextSchema(LETTER_LIMITS.reason),
});

/** "Proses permohonan" (F6.3): Diajukan -> Diproses, letter_requests.process, never own (L6). Note optional. */
export const letterRequestProcessSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  note: optionalTextSchema(LETTER_LIMITS.note),
});

/**
 * "Ambil nomor" (F6.4, G1, LT-13): Diproses without a number, never own. One transaction: the next SK
 * number and the linked Surat Keluar row (Aktif, no file, ACTIVE period, letter date today). Status
 * stays Diproses. A second press (or a second secretary) answers state_changed; exactly one number is used.
 */
export const letterRequestTakeNumberSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
});

/**
 * "Terbitkan Surat" (F6.5, A-LT23, design 12.3): Diproses WITH a number (else number_not_taken), never
 * own. 1..3 final files attached to the existing register row; Perihal, addressee and letter date may
 * be corrected (history row), never the number. Prefill from the detail's `letter` (the register row's
 * CURRENT values: subject, counterpart, letterDate), not from the request, so an edit made through the
 * register (database D4) is kept. `version` = detail.version (the request), `letterVersion` =
 * detail.letter.version: if the register row changed since the page loaded the answer is state_changed.
 * note = "Catatan untuk pemohon" (optional).
 */
export const letterRequestIssueSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  letterVersion: versionSchema,
  subject: requiredTextSchema(LETTER_LIMITS.subject),
  addressee: requiredTextSchema(LETTER_LIMITS.addressee),
  letterDate: requiredDateSchema,
  files: fileListSchema(1, LETTER_LIMITS.filesPerParent),
  note: optionalTextSchema(LETTER_LIMITS.note),
});

/**
 * "Tolak permohonan" (F6.6, design 12.2): Diajukan or Diproses, never own. Note required. If a number
 * was taken, the same transaction voids the register row with this note as the reason (LT-15a).
 */
export const letterRequestRejectSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  note: requiredTextSchema(LETTER_LIMITS.note, "note_required"),
});

const numberingPartSchema = (max: number) =>
  z
    .string({ message: "text_required" })
    .transform((raw) => raw.trim())
    .refine((text) => text !== "", { message: "text_required" })
    .refine((text) => new RegExp(`^[A-Za-z0-9/.-]{1,${max}}$`).test(text), { message: "invalid_number_format" });

/**
 * "Simpan format" (P11, design 13.1-13.3): System Admin only. `version` from getNumberingSettings().
 * The year is ALWAYS part of the number (owner 2026-11-09, database D2): there is NO include-year input;
 * the server always sends true. Same values = `changed: false`. Refused when the next number of a type
 * would repeat an existing number (format_collision). reason is optional (the design's sheet has none).
 */
export const numberingFormatUpdateSchema = z
  .object({
    version: versionSchema,
    prefix: numberingPartSchema(LETTER_LIMITS.prefix),
    incomingCode: numberingPartSchema(LETTER_LIMITS.typeCode),
    outgoingCode: numberingPartSchema(LETTER_LIMITS.typeCode),
    seqDigits: z
      .number({ message: "invalid_number_format" })
      .int({ message: "invalid_number_format" })
      .min(LETTER_LIMITS.seqDigitsMin, { message: "invalid_number_format" })
      .max(LETTER_LIMITS.seqDigitsMax, { message: "invalid_number_format" }),
    separator: numberSeparatorSchema,
    reason: optionalTextSchema(LETTER_LIMITS.reason),
  })
  .refine((f) => f.incomingCode.toLowerCase() !== f.outgoingCode.toLowerCase(), {
    message: "invalid_number_format",
    path: ["codes"],
  });

/**
 * "Atur nomor berikutnya" (L7 a, P11, G6, LT-51): System Admin only, CURRENT Jakarta year only (send
 * settings.year; a stale year answers year_not_current), reason required, nextSeq higher than the last
 * used (sequence_not_higher). Exactly last + 1 is allowed (records that the start was checked, D9).
 */
export const numberingSetNextSchema = z.object({
  type: letterTypeSchema,
  year: yearSchema,
  nextSeq: z
    .number({ message: "invalid_input" })
    .int({ message: "invalid_input" })
    .min(1, { message: "invalid_input" })
    .max(LETTER_LIMITS.nextSeqMax, { message: "invalid_input" }),
  reason: requiredTextSchema(LETTER_LIMITS.reason, "reason_required"),
});

export type LetterRegisterInput = z.input<typeof letterRegisterSchema>;
export type LetterUpdateInput = z.input<typeof letterUpdateSchema>;
export type LetterAddFilesInput = z.input<typeof letterAddFilesSchema>;
export type LetterWithdrawFileInput = z.input<typeof letterWithdrawFileSchema>;
export type LetterVoidInput = z.input<typeof letterVoidSchema>;
export type LetterRequestCreateInput = z.input<typeof letterRequestCreateSchema>;
export type LetterRequestCancelInput = z.input<typeof letterRequestCancelSchema>;
export type LetterRequestProcessInput = z.input<typeof letterRequestProcessSchema>;
export type LetterRequestTakeNumberInput = z.input<typeof letterRequestTakeNumberSchema>;
export type LetterRequestIssueInput = z.input<typeof letterRequestIssueSchema>;
export type LetterRequestRejectInput = z.input<typeof letterRequestRejectSchema>;
export type NumberingFormatUpdateInput = z.input<typeof numberingFormatUpdateSchema>;
export type NumberingSetNextInput = z.input<typeof numberingSetNextSchema>;

// =============================================================================================
// 7. Output types (camelCase of the RPC columns / JSON keys; nothing the database does not return)
// =============================================================================================

/** Dates are "YYYY-MM-DD" (Jakarta calendar days); timestamps are ISO 8601 strings (UTC, show in WIB). */
type IsoDate = string;
type IsoTimestamp = string;

export type LetterPaged<T> = {
  rows: T[];
  total: number;
  /** The page actually returned: a page past the end returns the last page. */
  page: number;
  pageSize: number;
  /** max(1, ceil(total / pageSize)). */
  pageCount: number;
};

// ---- Files ----

/**
 * A stored file the caller may read (database _lt_files_json; the database already left out what the
 * caller may not see). No storage path: "Lihat"/"Unduh" calls getLetterFileLink().
 */
export type LetterFile = {
  fileId: number;
  /** Original file name (shown, breaks at words). */
  name: string;
  /** null only where Storage was not installed when it was attached. */
  sizeBytes: number | null;
  mimeType: LetterFileMimeType;
  attachedAt: IsoTimestamp;
  attachedByName: string | null;
  /** "Ditarik" (managers only ever receive withdrawn files, A-LT9). */
  isWithdrawn: boolean;
  withdrawnAt: IsoTimestamp | null;
  withdrawnByName: string | null;
  withdrawReason: string | null;
};

/** A signed, short-lived link to one file (LETTER_FILE_SIGNED_URL_TTL_SECONDS). Opened in a new tab. */
export type LetterFileLink = { fileId: number; url: string; expiresAt: IsoTimestamp };

/** Answer of the upload route: send `{ path, name }` in the save action's `files`. */
export type LetterFileUploadResult = { path: string; name: string; sizeBytes: number; mimeType: LetterFileMimeType };

// ---- Register ----

/** nexus.letter_list() row (register card / table row). */
export type LetterRow = {
  rowNo: number;
  letterId: string;
  type: LetterType;
  /** The stored text, never recomputed (design 3.2). */
  numberText: string;
  /** "Nomor lama" chip. */
  isLegacyNumber: boolean;
  /** Year in the number; null for a "Nomor lama". */
  numberYear: number | null;
  /** Outgoing: always set. Incoming: optional. */
  letterDate: IsoDate | null;
  /** Incoming only ("Diterima {tanggal}"). */
  receivedDate: IsoDate | null;
  /** Pengirim (incoming) or Ditujukan kepada (outgoing). */
  counterpart: string;
  /** Incoming only: the sender's own number. */
  counterpartNumber: string | null;
  subject: string;
  status: LetterStatus;
  periodId: string;
  periodLabel: string | null;
  /** "Dari permohonan" (made by "Ambil nomor"). */
  fromRequest: boolean;
  /** Its request is still Diproses: file mark "Menunggu file final" instead of "Belum ada berkas". */
  awaitingFinalFile: boolean;
  /** Visible (not withdrawn) files. */
  fileCount: number;
  createdAt: IsoTimestamp;
  version: number;
};

export type LetterPage = LetterPaged<LetterRow> & {
  /** The validated filters the rows were read with (send these, not raw URL values, to the export). */
  filters: LetterListFilters;
};

/** One changed field of an "edited" history row (before/after of the database, keys mapped). */
export type LetterEditableField = "subject" | "counterpart" | "counterpartNumber" | "notes" | "letterDate" | "receivedDate";
export type LetterFieldChange = { field: LetterEditableField; before: string | null; after: string | null };

/**
 * One "Riwayat" entry of a letter, newest first (design 6.3). changes: only for `edited` (in the order of
 * LetterEditableField; unknown keys are ignored). fileName: file_added / file_withdrawn. note: the reason
 * of file_withdrawn and voided. numberText: the number recorded at `registered`.
 */
export type LetterHistoryEntry = {
  historyId: number;
  at: IsoTimestamp;
  kind: LetterHistoryKind;
  actorName: string | null;
  changes: LetterFieldChange[];
  fileName: string | null;
  note: string | null;
  numberText: string | null;
};

/**
 * Which buttons exist for THIS caller now (database answer; every write function re-checks). All false
 * for non-managers, for a voided letter, for a letter of an old period and without an active period.
 * canAddFiles / canWithdrawFiles / canVoid are also false while the letter's request is Diproses (A-LT24).
 */
export type LetterActions = {
  canEdit: boolean;
  canAddFiles: boolean;
  canWithdrawFiles: boolean;
  canVoid: boolean;
  /** 3 - visible files, never below 0 ("Boleh menambah {n} berkas lagi."). */
  filesRoom: number;
};

/** The request behind a letter: only for letter_requests.view_all holders, else null. */
export type LetterSourceRequest = {
  requestId: string;
  subject: string;
  status: LetterRequestStatus;
  requesterName: string | null;
};

/** nexus.letter_detail() (design screen 3). Needs letters.view; an unknown id answers not_found "letter". */
export type LetterDetail = {
  letterId: string;
  type: LetterType;
  numberText: string;
  isLegacyNumber: boolean;
  numberYear: number | null;
  letterDate: IsoDate | null;
  receivedDate: IsoDate | null;
  counterpart: string;
  counterpartNumber: string | null;
  subject: string;
  notes: string | null;
  status: LetterStatus;
  voidReason: string | null;
  voidedAt: IsoTimestamp | null;
  voidedByName: string | null;
  periodId: string;
  periodLabel: string | null;
  /** false = "Surat dari periode {label}. Hanya bisa dibaca." */
  isActivePeriod: boolean;
  createdAt: IsoTimestamp;
  createdByName: string | null;
  updatedAt: IsoTimestamp;
  updatedByName: string | null;
  version: number;
  fromRequest: boolean;
  /** Its request is still Diproses (banner of design 6.2; add file and void are absent). */
  awaitingFinalFile: boolean;
  request: LetterSourceRequest | null;
  /** Visible files (withdrawn ones not counted). */
  fileCount: number;
  /** Files the caller may read, oldest first; withdrawn ones only for letters.manage. */
  files: LetterFile[];
  history: LetterHistoryEntry[];
  actions: LetterActions;
};

/**
 * nexus.letter_dashboard_counts(): Dashboard card (design 15, L11) and the header tiles (design 3.1).
 * letters.view only. Counts of the ACTIVE period; periodId null = no active period (card absent).
 */
export type LetterDashboardCounts = {
  periodId: string | null;
  periodLabel: string | null;
  /** Aktif letters only (G9). */
  incomingCount: number;
  outgoingCount: number;
  /** For the tile note "{n} dibatalkan" (only when above 0). */
  incomingVoidedCount: number;
  outgoingVoidedCount: number;
  /** Diajukan requests of ALL periods; null unless the caller holds letter_requests.view_all (D8). */
  waitingRequestCount: number | null;
};

/**
 * nexus.letter_export() row (server-side, for the file writer). Same rows and order as the register
 * list of that tab and filters, all pages. No file contents and no links (LT-36).
 */
export type LetterExportRow = {
  rowNo: number;
  numberText: string;
  type: LetterType;
  isLegacyNumber: boolean;
  letterDate: IsoDate | null;
  receivedDate: IsoDate | null;
  counterpart: string;
  counterpartNumber: string | null;
  subject: string;
  notes: string | null;
  status: LetterStatus;
  voidReason: string | null;
  fromRequest: boolean;
  periodLabel: string | null;
  createdByName: string | null;
  createdAt: IsoTimestamp;
  fileCount: number;
};

// ---- Requests ----

/**
 * nexus.letter_my_requests() row: OWN requests only (L9). Open first, then closed, newest first.
 * numberText: from "Ambil nomor" on (Diproses) and for Diterbitkan; null after a rejection (G5).
 */
export type MyLetterRequestRow = {
  rowNo: number;
  requestId: string;
  status: LetterRequestStatus;
  version: number;
  periodLabel: string | null;
  subject: string;
  addressee: string;
  onBehalfOf: string | null;
  neededBy: IsoDate | null;
  createdAt: IsoTimestamp;
  /** "Sedang disiapkan oleh {nama}." (G11). */
  processedByName: string | null;
  numberText: string | null;
  /** Diterbitkan but the letter was voided: chip "Nomor dibatalkan", no file (A-LT11, G5). */
  numberVoided: boolean;
  /** "Berkas siap diunduh." (Diterbitkan, letter Aktif, a visible file exists). */
  hasIssuedFile: boolean;
  attachmentCount: number;
  /** Latest processor note (Proses, Terbitkan or Tolak) and who wrote it. */
  note: string | null;
  noteByName: string | null;
  noteAt: IsoTimestamp | null;
};

export type MyLetterRequestsPage = LetterPaged<MyLetterRequestRow> & { filter: MyLetterRequestsFilter };

/**
 * nexus.letter_my_request_caps(): the caller's own request caps (L10 b), same definition as the check
 * inside letter_request_create. Header box "Permohonan {openCount} berjalan", the cap alert above the
 * request form (design 3.4: open cap first, then the daily cap) and the lone-processor hint (needs an
 * open request of the viewer's own).
 */
export type LetterRequestCaps = {
  /** Own Diajukan + Diproses requests. */
  openCount: number;
  /** 5. */
  openLimit: number;
  /** Own requests created on the current Jakarta day. */
  todayCount: number;
  /** 10. */
  dailyLimit: number;
  hasActivePeriod: boolean;
  /** Active period and both counts under their limit. The submit re-checks under its lock. */
  canSubmit: boolean;
};

/** nexus.letter_request_queue() row (letter_requests.view_all). */
export type LetterQueueRow = {
  rowNo: number;
  requestId: string;
  status: LetterRequestStatus;
  version: number;
  periodId: string;
  periodLabel: string | null;
  /** Current PI-CORE name. */
  requesterName: string | null;
  /** false = info marker "Pemohon sudah tidak aktif." (G12). */
  requesterIsActive: boolean;
  /** The caller's own request ("Pengajuanmu"): the review page has no buttons (L6). */
  isOwn: boolean;
  subject: string;
  addressee: string;
  onBehalfOf: string | null;
  neededBy: IsoDate | null;
  /** "Lewat tanggal" (P15): needed-by date before today (Jakarta) and still Diajukan or Diproses. */
  isPastDue: boolean;
  /** "(lewat {n} hari)"; 0 when not past due. */
  daysPastDue: number;
  attachmentCount: number;
  /**
   * The taken number. For a Ditolak request it is the (voided) number that was taken; show it only for
   * Diproses and Diterbitkan.
   */
  numberText: string | null;
  /** "Diambil {tanggal} oleh {nama}". */
  numberTakenAt: IsoTimestamp | null;
  numberTakenByName: string | null;
  /** Status of the linked register letter; null without a number. */
  letterStatus: LetterStatus | null;
  /** Diterbitkan and the letter voided: chip "Nomor dibatalkan" (only possible under "Selesai"). */
  numberVoided: boolean;
  processedByName: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /**
   * Rows of the WHOLE filtered result in this row's period (not only the page): the handover group
   * header "Periode {label} ({n})" (design 11.3).
   */
  periodTotalCount: number;
};

export type LetterQueuePage = LetterPaged<LetterQueueRow> & { filters: LetterQueueFilters };

/** nexus.letter_request_queue_counts() (letter_requests.view_all). Counts only, never names. */
export type LetterQueueCounts = {
  /** "Menunggu ({n})": Diajukan, all periods. Also the "Permohonan menunggu" tile for view_all-only callers. */
  submitted: number;
  processing: number;
  awaitingFile: number;
  openAllPeriods: number;
  /** "Antrean (n)": Diajukan of all periods that are NOT the caller's own; 0 unless the caller holds process. */
  actionNeeded: number;
  /** Members holding letter_requests.process now (lone-processor hint, A-n9). */
  processHolderCount: number;
};

/** Timeline entry of a request, oldest first (design 10.2 shows it newest first: reverse in the UI). */
export type LetterRequestTimelineEntry = {
  at: IsoTimestamp;
  event: LetterRequestEvent;
  fromStatus: LetterRequestStatus | null;
  toStatus: LetterRequestStatus;
  /** PI-CORE name (G11: also shown to the requester). */
  actorName: string | null;
  /** Proses / Terbitkan / Tolak note, or the cancel reason. */
  note: string | null;
  /** Only on number_taken: the number taken ("Nomor {nomor}"); kept after a rejection (design 10.3). */
  numberText: string | null;
};

/** Which buttons exist for THIS caller now (database answer; the write functions re-check all). */
export type LetterRequestActions = {
  /** Own request, Diajukan, active period. */
  canCancel: boolean;
  /** "Proses permohonan": process key, not own, Diajukan, active period. */
  canProcess: boolean;
  /** "Ambil nomor": Diproses without a number. */
  canTakeNumber: boolean;
  /** "Terbitkan surat": Diproses with a number. */
  canIssue: boolean;
  /** "Tolak permohonan": Diajukan or Diproses. */
  canReject: boolean;
};

/**
 * The register letter behind a request with its CURRENT values (view_all only; null without a number).
 * The Terbitkan form prefills from it and sends `version` as letterVersion.
 */
export type LetterRequestLinkedLetter = {
  letterId: string;
  numberText: string;
  status: LetterStatus;
  subject: string;
  /** The addressee as it stands in the register (prefills "Ditujukan kepada"). */
  counterpart: string;
  letterDate: IsoDate | null;
  /** Visible files. */
  fileCount: number;
  version: number;
  periodId: string;
};

/**
 * nexus.letter_request_detail() (design screens 7 and 9). Visible to the requester and to
 * letter_requests.view_all holders; anyone else, and an unknown id, answers not_found "request".
 * The fields marked "view_all" are null for a requester without that key.
 */
export type LetterRequestDetail = {
  requestId: string;
  status: LetterRequestStatus;
  version: number;
  periodId: string;
  periodLabel: string | null;
  /** false = "Permohonan ini dari periode {label}. ..." (design 12.1, 12.3). */
  isActivePeriod: boolean;
  requesterName: string | null;
  /** view_all only (G12). */
  requesterIsActive: boolean | null;
  isOwn: boolean;
  subject: string;
  addressee: string;
  purpose: string;
  onBehalfOf: string | null;
  neededBy: IsoDate | null;
  createdAt: IsoTimestamp;
  /** view_all only (P15). */
  isPastDue: boolean | null;
  daysPastDue: number | null;
  processedAt: IsoTimestamp | null;
  processedByName: string | null;
  /** Number plate: set while Diproses with a number and for Diterbitkan; null otherwise (also after Ditolak). */
  numberText: string | null;
  numberTakenAt: IsoTimestamp | null;
  numberTakenByName: string | null;
  /** Diterbitkan and the letter was voided (chip "Nomor dibatalkan", warning alert, no file card). */
  numberVoided: boolean;
  /** The register letter (view_all only): link "Lihat di register" for letters.view holders. */
  letterId: string | null;
  /** The register letter's current values (view_all only; null without a number): Terbitkan prefill. */
  letter: LetterRequestLinkedLetter | null;
  decidedAt: IsoTimestamp | null;
  decidedByName: string | null;
  /** "Catatan dari sekretaris" (latest processor note). */
  note: string | null;
  noteByName: string | null;
  noteAt: IsoTimestamp | null;
  /** The requester's own attachments ("Lampiran"). */
  attachments: LetterFile[];
  /**
   * Files of the issued letter ("Berkas surat"). The requester gets them only while Diterbitkan and the
   * letter is Aktif (G5); view_all holders always (D5). Empty otherwise.
   */
  letterFiles: LetterFile[];
  timeline: LetterRequestTimelineEntry[];
  /**
   * A-n9 hint: OTHER members holding letter_requests.process now (count only). Set only while the request
   * is open and the caller is a processor or the requester; else null. 0 = "waits for another secretary".
   */
  otherProcessorCount: number | null;
  actions: LetterRequestActions;
};

// ---- Numbering ----

/** The format part of the settings (and of a "format" history row). includeYear is always true (D2). */
export type NumberingFormatValues = {
  prefix: string;
  incomingCode: string;
  outgoingCode: string;
  seqDigits: number;
  separator: NumberSeparator;
  includeYear: boolean;
};

/** Per type, for the CURRENT Jakarta year ("Nomor berikutnya" card, design 13.1). */
export type NumberingTypeState = {
  type: LetterType;
  code: string;
  /** "Terakhir dipakai"; null = "belum ada". */
  lastUsed: number | null;
  /** The sequence the next letter gets (skips a text that already exists, decision D1). */
  nextSeq: number;
  /** Its full text, e.g. "PMK/NEX/SM/2026/046". */
  nextNumber: string;
  /** false = never set and no number issued this year: first-use hints (design 7.6, 13.5). */
  startSet: boolean;
};

/** nexus.letter_numbering_settings(): System Admin (edits) and letters.manage holders (read-only, A-LT12). */
export type NumberingSettings = NumberingFormatValues & {
  version: number;
  updatedAt: IsoTimestamp;
  updatedByName: string | null;
  /** Current Jakarta year; send it as `year` to setNextNumber. */
  year: number;
  types: NumberingTypeState[];
  /** The caller is the System Admin (fields and buttons); else the read-only variant (design 13.4). */
  canEdit: boolean;
};

/** One "Riwayat perubahan" row, newest first. Values as stored, keys mapped to camelCase. */
export type NumberingChange =
  | {
      changeId: number;
      occurredAt: IsoTimestamp;
      kind: "format";
      before: NumberingFormatValues;
      after: NumberingFormatValues;
      reason: string | null;
      actorName: string | null;
    }
  | {
      changeId: number;
      occurredAt: IsoTimestamp;
      kind: "next_sequence";
      type: LetterType;
      year: number;
      before: { lastUsed: number | null; nextSeq: number };
      after: { lastUsed: number | null; nextSeq: number };
      reason: string;
      actorName: string | null;
    };

export type NumberingHistoryPage = LetterPaged<NumberingChange>;

// ---- Write results ----

/** nexus.letter_register(): the stored number for "Surat dicatat. Nomornya {nomor}." */
export type LetterRegisterResult = { letterId: string; numberText: string; status: LetterStatus; version: number };
/** nexus.letter_update(): changed false = nothing was different (no history row). */
export type LetterUpdateResult = { letterId: string; changed: boolean; version: number };
/** nexus.letter_add_files() / letter_withdraw_file(): visible files now and the letter's new version. */
export type LetterFilesResult = { letterId: string; fileCount: number; version: number };
/** nexus.letter_void(). */
export type LetterVoidResult = { letterId: string; status: LetterStatus; version: number };
/** Every request transition (create, cancel, process, issue, reject): the new status and version. */
export type LetterRequestTransitionResult = { requestId: string; status: LetterRequestStatus; version: number };
/** nexus.letter_request_take_number(): also the new register letter and its number. */
export type LetterTakeNumberResult = LetterRequestTransitionResult & { letterId: string; numberText: string };
/** nexus.letter_numbering_update_format(). */
export type NumberingFormatResult = { changed: boolean; version: number };
/** nexus.letter_numbering_set_next(). */
export type NumberingSetNextResult = { type: LetterType; year: number; nextSeq: number; nextNumber: string };

// =============================================================================================
// 8. Errors and results
// =============================================================================================

/** Which input a refusal is about (zod path or database detail). `request` = malformed body. */
export type LetterInputField =
  | "request"
  | "type"
  | "search"
  | "period"
  | "year"
  | "status"
  | "withoutFiles"
  | "page"
  | "pageSize"
  | "format"
  | "view"
  | "filter"
  | "from"
  | "to"
  | "filters"
  | "parent"
  | "letterId"
  | "requestId"
  | "fileId"
  | "version"
  | "subject"
  | "counterpart"
  | "counterpartNumber"
  | "letterDate"
  | "receivedDate"
  | "notes"
  | "legacyNumber"
  | "files"
  | "file"
  | "reason"
  | "note"
  | "addressee"
  | "purpose"
  | "onBehalfOf"
  | "neededBy"
  | "prefix"
  | "incomingCode"
  | "outgoingCode"
  /** The two type codes are equal ("Kode surat masuk dan surat keluar tidak boleh sama."). */
  | "codes"
  | "seqDigits"
  | "separator"
  | "nextSeq";

/**
 * Database `detail` -> field (22023 hints that name a field). A detail that is a storage path
 * (file hints) becomes field "files" with `ref` = that path; a number (file_required / file_count)
 * becomes `count`. Any other detail -> field "request".
 */
export const LETTER_DB_DETAIL_FIELDS: Record<string, LetterInputField> = {
  subject: "subject",
  counterpart: "counterpart",
  counterpart_number: "counterpartNumber",
  p_counterpart_number: "counterpartNumber",
  notes: "notes",
  letter_date: "letterDate",
  received_date: "receivedDate",
  p_received_date: "receivedDate",
  legacy_number: "legacyNumber",
  reason: "reason",
  note: "note",
  addressee: "addressee",
  purpose: "purpose",
  on_behalf_of: "onBehalfOf",
  needed_by: "neededBy",
  p_files: "files",
  name: "files",
  p_next_seq: "nextSeq",
  prefix: "prefix",
  incoming_code: "incomingCode",
  outgoing_code: "outgoingCode",
  codes_equal: "codes",
  seq_digits: "seqDigits",
  separator: "separator",
};

/** Entities a not_found can be about (P0002 hints). A letter or request you may not see is also not_found. */
export type LetterEntity = "letter" | "request" | "file";

/**
 * Error union. HTTP-like meaning (route handlers): unauthenticated 401; forbidden,
 * self_processing_blocked, closed_period 403; not_found 404; input codes 400; file_too_large 413;
 * export_too_large 422; upload_limit 429; unavailable 503 (fail closed: never shown as "no access",
 * never a sign-out); every other business refusal 409. Payloads carry fields, counts, number texts and
 * paths of the caller's own uploads only, never a person.
 */
export type LetterError =
  // Session and access (L1, keys). permission_required, not_system_admin, not_active_member and
  // not_requester (42501) -> forbidden.
  | { code: "unauthenticated" }
  | { code: "forbidden" }
  | { code: "unavailable" }
  | { code: "self_processing_blocked" } // access control L6
  | { code: "closed_period" } // L7: a letter of a previous period is read-only
  // Input (22023). invalid_type, invalid_view, invalid_status, invalid_period, invalid_year,
  // search_too_long, invalid_page, invalid_page_size, invalid_format -> invalid_input with the field.
  | { code: "invalid_input"; field: LetterInputField }
  | { code: "text_required" | "text_too_long" | "reason_required" | "note_required"; field: LetterInputField }
  | { code: "date_required" | "date_in_future" | "date_in_past" | "invalid_dates"; field: LetterInputField }
  | { code: "invalid_file" | "file_already_attached" | "file_missing"; field: LetterInputField; ref: string | null }
  /** maxMb = LETTER_FILE_MAX_MB (database answer or upload route). */
  | { code: "file_too_large"; field: LetterInputField; ref: string | null; maxMb: number }
  /** count = the minimum (file_required) or the maximum allowed now (file_count). */
  | { code: "file_required" | "file_count"; field: LetterInputField; count: number | null }
  | { code: "invalid_number_format"; field: LetterInputField }
  /** The next number under the new format already exists (R5); numberText = that number. */
  | { code: "format_collision"; numberText: string | null }
  /** The page's year is no longer the current Jakarta year (New Year passed). */
  | { code: "year_not_current"; currentYear: number | null }
  /** "Atur nomor berikutnya" not above the last used sequence. */
  | { code: "sequence_not_higher"; lastUsed: number | null }
  // Duplicate (23505).
  | { code: "duplicate_number"; numberText: string | null } // "Nomor lama" already in the register
  // Not found (P0002).
  | { code: "not_found"; entity: LetterEntity }
  // Business refusals (P0001).
  | { code: "no_active_period" } // R7 / R11
  | { code: "state_changed" } // "Data sudah berubah. Muat ulang." (Terbitkan: also when the register letter changed, detail "letter")
  | { code: "letter_voided" }
  | { code: "request_open" } // A-LT24: void / add file while the request is Diproses
  | { code: "number_not_taken" } // A-LT23
  | { code: "last_issued_file" } // G4
  | { code: "too_many_open_requests"; limit: number } // L10 b: 5
  | { code: "daily_request_limit"; limit: number } // L10 b: 10 per Jakarta day
  // Server only (no database hint).
  /** Export answer cut by the API row limit (fewer rows than the database's total_count). HTTP 422. */
  | { code: "export_too_large" }
  /** Upload refused by the bucket policy with an active period: the 10-per-24-hours cap. HTTP 429. */
  | { code: "upload_limit"; limit: number };

export type LetterErrorCode = LetterError["code"];

export type LetterResult<T> = { ok: true; data: T } | { ok: false; error: LetterError };

/** JSON body of every non-2xx answer from the export and upload route handlers. */
export type LetterErrorBody = { error: LetterError };

/**
 * Database hint -> error code. Hints not listed here (and any error without a hint, network failures,
 * unexpected shapes) answer `unavailable` (fail closed). Guard hints that fire only on a bug
 * (immutable_column, invalid_transition, export_log_direct_insert, append_only), numbering_exhausted
 * (settings row missing or 10000 collisions) and year_required (the server always sends include_year
 * true) are deliberately `unavailable` too.
 */
// Look up with Object.hasOwn (a hint like "constructor" must not resolve through the prototype, BUG-MD-01).
export const LETTER_DB_HINTS: Record<string, LetterErrorCode> = {
  // 42501
  permission_required: "forbidden",
  not_system_admin: "forbidden",
  not_active_member: "forbidden",
  not_requester: "forbidden", // cancel of someone else's request: no screen offers it
  self_processing_blocked: "self_processing_blocked",
  closed_period: "closed_period",
  immutable_column: "unavailable",
  invalid_transition: "unavailable",
  export_log_direct_insert: "unavailable",
  append_only: "unavailable",
  // P0002
  letter_not_found: "not_found",
  request_not_found: "not_found",
  file_not_found: "not_found",
  // P0001
  no_active_period: "no_active_period",
  state_changed: "state_changed",
  letter_voided: "letter_voided",
  request_open: "request_open",
  number_not_taken: "number_not_taken",
  last_issued_file: "last_issued_file",
  too_many_open_requests: "too_many_open_requests",
  daily_request_limit: "daily_request_limit",
  file_missing: "file_missing",
  numbering_exhausted: "unavailable",
  // 23505
  duplicate_number: "duplicate_number",
  // 22023
  invalid_type: "invalid_input",
  invalid_input: "invalid_input",
  text_required: "text_required",
  text_too_long: "text_too_long",
  reason_required: "reason_required",
  note_required: "note_required",
  date_required: "date_required",
  date_in_future: "date_in_future",
  date_in_past: "date_in_past",
  invalid_dates: "invalid_dates",
  invalid_file: "invalid_file",
  file_too_large: "file_too_large",
  file_required: "file_required",
  file_count: "file_count",
  file_already_attached: "file_already_attached",
  invalid_view: "invalid_input",
  invalid_status: "invalid_input",
  invalid_period: "invalid_input",
  invalid_year: "invalid_input",
  year_not_current: "year_not_current",
  sequence_not_higher: "sequence_not_higher",
  invalid_number_format: "invalid_number_format",
  year_required: "unavailable",
  format_collision: "format_collision",
  search_too_long: "invalid_input",
  invalid_page: "invalid_input",
  invalid_page_size: "invalid_input",
  invalid_format: "invalid_input",
};

/** Generic texts reused by several codes (Inventory design 3.6, which letters design 3 adopts). */
const COPY_UNAVAILABLE = "Terjadi gangguan. Coba lagi sebentar lagi.";
const COPY_STATE_CHANGED = "Data sudah berubah. Muat ulang.";
const COPY_NO_PERIOD_LETTER = "Belum ada periode aktif. Surat belum bisa dicatat."; // 3.4, 7.7, 12.8
const COPY_NO_PERIOD_REQUEST = "Belum ada periode aktif. Permohonan belum bisa dibuat."; // 3.4, 9.4
const COPY_FILE_UPLOAD_FAILED = "Berkas gagal diunggah. Coba lagi."; // 3.3, 7.7, 9.4
const COPY_FILE_OPEN_FAILED = "Berkas tidak bisa dibuka. Coba lagi."; // 3.4, 6.3, 10.4
const COPY_FILE_NOT_FOUND = "Berkas tidak ditemukan. Muat ulang halaman."; // owner
const COPY_RANGE = "Tanggal akhir tidak boleh sebelum tanggal mulai."; // owner (queue date range)
/** Owner: per field, like Inventory. {Kolom} = the field's name (letterFieldName), {n} = its limit. */
const COPY_TOO_LONG = "{Kolom} terlalu panjang. Pakai paling banyak {n} karakter.";

/**
 * Indonesian copy per error code: word for word from docs/design/letters.md (section numbers in the
 * comments), or the generic text where the design has none ("gap", listed in the README). Placeholders
 * in braces are filled by letterErrorMessage(). `null` = PER FIELD or PER ACTION: the text depends on
 * the form and the field (LETTER_FIELD_ERROR_COPY) or the action; use letterErrorMessage().
 */
export const LETTER_ERROR_COPY: Record<LetterErrorCode, string | null> = {
  unauthenticated: null, // no text: redirect to /login?reason=session_ended (auth-login F9)
  forbidden: "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", // 9.4 (pages: ForbiddenScreen)
  unavailable: COPY_UNAVAILABLE, // 7.7; action variants below
  self_processing_blocked: "Tidak bisa memproses permohonanmu sendiri. Sekretaris lain yang memutuskan.", // 3.4
  closed_period: "Surat ini tidak bisa diubah.", // 7.7
  invalid_input: null, // PER FIELD: search 5.2, export 14.2 (Data Anggota text); else generic (gap)
  text_required: null, // PER FIELD: 7.4, 9.2, 12.6, 13.2
  text_too_long: null, // PER FIELD: 7.4, 9.2, 12.6; else COPY_TOO_LONG with the field (owner)
  reason_required: null, // PER ACTION: void 8.1, withdraw 8.2, set next 13.3
  note_required: "Tulis alasan penolakan, supaya pemohon tahu.", // 12.2 (only "Tolak" requires a note)
  date_required: null, // PER FIELD: 7.4, 12.6
  date_in_future: null, // PER FIELD: 7.4, 12.6
  date_in_past: "Tanggal tidak boleh sebelum hari ini.", // 9.2 (only "Dibutuhkan paling lambat")
  invalid_dates: COPY_RANGE, // owner (queue range "from"/"to"); a malformed single date: generic (gap)
  invalid_file: "Format tidak didukung. Pakai PDF, JPG, atau PNG.", // 3.3 (a bad saved path: generic, variant)
  file_too_large: "Berkas terlalu besar. Batasnya 4 MB. Perkecil dulu atau pilih berkas lain.", // 3.3
  file_required: "Tambahkan minimal satu berkas surat.", // 12.6 (also used for "Tambah berkas" with none)
  file_count: "Maksimal 3 berkas.", // 3.3
  file_already_attached: "Berkas ini sudah terpasang. Pilih berkas lain.", // owner
  file_missing: COPY_FILE_UPLOAD_FAILED, // 3.3
  invalid_number_format: null, // PER FIELD: 13.2
  format_collision: "Format ini menghasilkan nomor yang sudah dipakai ({nomor}). Ubah formatnya.", // 13.2
  year_not_current: COPY_STATE_CHANGED, // gap: the page shows last year's settings
  sequence_not_higher: "Isi angka bulat yang lebih besar dari {nomor}.", // 13.3 ("{nomor terakhir}")
  duplicate_number: "Nomor ini sudah ada di register.", // 7.4
  not_found: "Surat ini tidak ditemukan.", // 6.1/6.4; request and file: variants
  no_active_period: COPY_NO_PERIOD_LETTER, // 3.4; request form: variant
  state_changed: COPY_STATE_CHANGED, // 3.4
  letter_voided: "Surat ini tidak bisa diubah.", // 7.7
  request_open: COPY_STATE_CHANGED, // gap: the buttons are absent then (6.2); a race means the page is stale
  number_not_taken: "Ambil nomor dulu sebelum menerbitkan surat.", // 12.3
  last_issued_file: "Ini satu-satunya berkas yang dilihat pemohon. Tambahkan berkas pengganti dulu, lalu tarik yang salah.", // 8.2
  too_many_open_requests:
    "Kamu sudah punya {n} permohonan yang berjalan. Tunggu salah satunya selesai atau batalkan dulu.", // 3.4 ({n} = 5)
  daily_request_limit: "Batas permohonan hari ini sudah tercapai ({n}). Coba lagi besok.", // 3.4 ({n} = 10)
  export_too_large: "Hasil terlalu banyak untuk satu file. Persempit filter, lalu coba lagi.", // gap: Inventory text (tech lead 2026-11-08)
  upload_limit: "Terlalu banyak unggahan dalam 24 jam. Coba lagi nanti.", // 3.3
};

/** Action variants of the codes whose text depends on what the person was doing. */
export const LETTER_ERROR_COPY_VARIANTS = {
  notFound: {
    letter: "Surat ini tidak ditemukan.", // 6.4
    request: "Permohonan ini tidak ditemukan.", // 10.5 (same answer for someone else's request)
    /** "Lihat"/"Unduh" of a file that is gone or no longer readable. */
    fileOpen: COPY_FILE_OPEN_FAILED, // 6.3
    /** A file id that no longer matches (e.g. "Tarik berkas" on a stale page). */
    file: COPY_FILE_NOT_FOUND, // owner
  },
  noActivePeriod: {
    request: COPY_NO_PERIOD_REQUEST, // 3.4, 9.4
    letter: COPY_NO_PERIOD_LETTER, // 3.4, 7.7, 12.8
  },
  unavailable: {
    takeNumber: "Nomor belum diambil. Tidak ada nomor yang terpakai. Coba lagi.", // 12.2
    issue: "Surat belum terbit. Berkas belum tersimpan, nomor tetap milik permohonan ini. Coba lagi.", // 12.7
    openFile: COPY_FILE_OPEN_FAILED, // 6.3
    upload: COPY_FILE_UPLOAD_FAILED, // 3.3
  },
  invalidInput: {
    search: "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.", // 5.2
    export: "Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi.", // 14.2 (Data Anggota)
  },
  reasonRequired: {
    void: "Tulis alasan pembatalan.", // 8.1
    withdrawFile: "Tulis kenapa berkas ini ditarik.", // 8.2
    numberingSetNext: "Tulis alasannya.", // 13.3
  },
  /** A malformed saved path or a non-upload file problem: the browser built it, so it is a bug. */
  invalidFileSaved: COPY_UNAVAILABLE,
} as const;

/** The form a field error belongs to (picks the per-field text). */
export type LetterForm =
  | "letterIncoming"
  | "letterOutgoing"
  | "request"
  | "issue"
  | "numberingFormat"
  | "numberingSetNext";

type FieldErrorCode =
  | "text_required"
  | "text_too_long"
  | "date_required"
  | "date_in_future"
  | "date_in_past"
  | "invalid_input"
  | "invalid_number_format";

const SUBJECT_TOO_LONG = "Perihal terlalu panjang. Pakai paling banyak 200 karakter."; // 7.4, 9.2
const TOO_LONG_150 = "Terlalu panjang. Pakai paling banyak 150 karakter."; // 7.4, 9.2
const TOO_LONG_60 = "Terlalu panjang. Pakai paling banyak 60 karakter."; // 7.4
const NOTES_TOO_LONG = "Catatan terlalu panjang. Pakai paling banyak 500 karakter."; // 7.4, 12.6
const LETTER_DATE_COPY = {
  date_required: "Pilih tanggal surat.", // 7.4, 12.6
  date_in_future: "Tanggal surat tidak boleh setelah hari ini.", // 7.4, 12.6
} as const;
const NUMBER_CHARS = "Pakai huruf, angka, garis miring, titik, atau tanda hubung."; // 13.2

/**
 * Per-field texts of the forms, word for word from the design (7.4, 9.2, 12.6, 13.2, 13.3). A field or
 * code missing here falls back to LETTER_ERROR_COPY or the generic text (see letterErrorMessage).
 * Placeholders: {max} = LETTER_LIMITS.seqDigitsMax; {nomor} = the last used sequence.
 */
export const LETTER_FIELD_ERROR_COPY: Record<
  LetterForm,
  Partial<Record<LetterInputField, Partial<Record<FieldErrorCode, string>>>>
> = {
  letterIncoming: {
    legacyNumber: { text_required: "Isi nomor lama.", text_too_long: TOO_LONG_60 },
    receivedDate: {
      date_required: "Pilih tanggal diterima.",
      date_in_future: "Tanggal diterima tidak boleh setelah hari ini.",
    },
    letterDate: LETTER_DATE_COPY,
    counterpart: { text_required: "Isi pengirim.", text_too_long: "Pengirim terlalu panjang. Pakai paling banyak 150 karakter." },
    subject: { text_required: "Isi perihal.", text_too_long: SUBJECT_TOO_LONG },
    counterpartNumber: { text_too_long: TOO_LONG_60 },
    notes: { text_too_long: NOTES_TOO_LONG },
  },
  letterOutgoing: {
    legacyNumber: { text_required: "Isi nomor lama.", text_too_long: TOO_LONG_60 },
    letterDate: LETTER_DATE_COPY,
    counterpart: { text_required: "Isi tujuan surat.", text_too_long: TOO_LONG_150 },
    subject: { text_required: "Isi perihal.", text_too_long: SUBJECT_TOO_LONG },
    notes: { text_too_long: NOTES_TOO_LONG },
  },
  request: {
    subject: { text_required: "Isi perihal surat.", text_too_long: SUBJECT_TOO_LONG },
    addressee: { text_required: "Isi tujuan surat.", text_too_long: TOO_LONG_150 },
    purpose: {
      text_required: "Isi keperluannya supaya sekretaris tahu apa yang ditulis.",
      text_too_long: "Keperluan terlalu panjang. Pakai paling banyak 1000 karakter.",
    },
    onBehalfOf: { text_too_long: "Terlalu panjang. Pakai paling banyak 120 karakter." },
    neededBy: { date_in_past: "Tanggal tidak boleh sebelum hari ini." },
  },
  issue: {
    subject: { text_required: "Isi perihal surat.", text_too_long: SUBJECT_TOO_LONG },
    addressee: { text_required: "Isi tujuan surat.", text_too_long: TOO_LONG_150 },
    letterDate: LETTER_DATE_COPY,
    note: { text_too_long: NOTES_TOO_LONG },
  },
  numberingFormat: {
    prefix: { text_required: "Isi awalan.", invalid_number_format: NUMBER_CHARS },
    incomingCode: { text_required: "Isi kode.", invalid_number_format: NUMBER_CHARS },
    outgoingCode: { text_required: "Isi kode.", invalid_number_format: NUMBER_CHARS },
    codes: { invalid_number_format: "Kode surat masuk dan surat keluar tidak boleh sama." },
    seqDigits: { invalid_number_format: "Isi angka bulat, 1 sampai {max}." },
    separator: { invalid_number_format: "Isi satu tanda pemisah." },
  },
  numberingSetNext: {
    nextSeq: { invalid_input: "Isi angka bulat yang lebih besar dari {nomor}." },
  },
};

/** The action that produced an error; picks the copy variant and the per-field form. */
export type LetterAction =
  | "read"
  | "export"
  | "openFile"
  /** Upload from the register form, "Tambah berkas" or Terbitkan. */
  | "uploadLetterFile"
  /** Upload from the request form ("Lampiran"). */
  | "uploadRequestFile"
  | "register"
  | "edit"
  | "addFiles"
  | "withdrawFile"
  | "void"
  | "submitRequest"
  | "cancelRequest"
  | "processRequest"
  | "takeNumber"
  | "issue"
  | "reject"
  | "numberingFormat"
  | "numberingSetNext";

function formOfAction(action: LetterAction, letterType: LetterType | undefined): LetterForm | null {
  switch (action) {
    case "register":
    case "edit":
      return letterType === "outgoing" ? "letterOutgoing" : letterType === "incoming" ? "letterIncoming" : null;
    case "submitRequest":
      return "request";
    case "issue":
      return "issue";
    case "numberingFormat":
      return "numberingFormat";
    case "numberingSetNext":
      return "numberingSetNext";
    default:
      return null;
  }
}

/** Zero-padded sequence as the settings show it ("045"); longer sequences stay as they are. */
export function padLetterSequence(seq: number, digits: number): string {
  const text = String(seq);
  return text.length >= digits ? text : text.padStart(digits, "0");
}

/**
 * The text to show for an error, or null only for `unauthenticated` (redirect to login). Never throws.
 * extra.letterType: the type of the register / edit form (picks "Pengirim" vs "Ditujukan kepada" texts).
 * extra.seqDigits: pads {nomor} in the numbering texts like the settings ("045").
 * extra.lastUsed: the last used sequence for a zod-level nextSeq error (from settings.types).
 */
export function letterErrorMessage(
  error: LetterError,
  action: LetterAction,
  extra: { letterType?: LetterType; seqDigits?: number; lastUsed?: number | null } = {},
): string | null {
  const v = LETTER_ERROR_COPY_VARIANTS;
  const pad = (n: number) => (extra.seqDigits === undefined ? String(n) : padLetterSequence(n, extra.seqDigits));
  switch (error.code) {
    case "unauthenticated":
      return null;
    case "not_found":
      if (error.entity === "request") return v.notFound.request;
      if (error.entity === "file") return action === "openFile" ? v.notFound.fileOpen : v.notFound.file;
      return v.notFound.letter;
    case "no_active_period":
      if (action === "submitRequest" || action === "uploadRequestFile") return v.noActivePeriod.request;
      if (["register", "edit", "addFiles", "withdrawFile", "void", "takeNumber", "issue", "uploadLetterFile"].includes(action)) {
        return v.noActivePeriod.letter;
      }
      return COPY_UNAVAILABLE; // gap: cancel / process / reject (their buttons are absent without a period)
    case "unavailable":
      if (action === "takeNumber") return v.unavailable.takeNumber;
      if (action === "issue") return v.unavailable.issue;
      if (action === "openFile") return v.unavailable.openFile;
      if (action === "uploadLetterFile" || action === "uploadRequestFile") return v.unavailable.upload;
      return COPY_UNAVAILABLE;
    case "invalid_file":
      return action === "uploadLetterFile" || action === "uploadRequestFile" ? LETTER_ERROR_COPY.invalid_file : v.invalidFileSaved;
    case "too_many_open_requests":
    case "daily_request_limit":
      return formatLetterCopy(LETTER_ERROR_COPY[error.code] ?? COPY_UNAVAILABLE, { n: error.limit });
    case "sequence_not_higher":
      return error.lastUsed === null
        ? COPY_UNAVAILABLE
        : formatLetterCopy(LETTER_ERROR_COPY.sequence_not_higher ?? COPY_UNAVAILABLE, { nomor: pad(error.lastUsed) });
    case "format_collision":
      return error.numberText === null
        ? COPY_UNAVAILABLE
        : formatLetterCopy(LETTER_ERROR_COPY.format_collision ?? COPY_UNAVAILABLE, { nomor: error.numberText });
    case "reason_required":
      if (action === "void") return v.reasonRequired.void;
      if (action === "withdrawFile") return v.reasonRequired.withdrawFile;
      if (action === "numberingSetNext") return v.reasonRequired.numberingSetNext;
      return COPY_UNAVAILABLE; // gap: no other form requires a reason
    case "invalid_input":
      if (error.field === "search") return v.invalidInput.search;
      if (action === "export") return v.invalidInput.export;
      return fieldMessage(error.code, error.field, action, extra) ?? COPY_UNAVAILABLE;
    case "invalid_dates":
      return error.field === "from" || error.field === "to" ? COPY_RANGE : COPY_UNAVAILABLE; // single date: gap
    case "text_too_long":
      return fieldMessage(error.code, error.field, action, extra) ?? tooLongMessage(error.field, action, extra.letterType);
    case "text_required":
    case "note_required":
    case "date_required":
    case "date_in_future":
    case "date_in_past":
    case "invalid_number_format":
      return fieldMessage(error.code, error.field, action, extra) ?? LETTER_ERROR_COPY[error.code] ?? COPY_UNAVAILABLE;
    default:
      return LETTER_ERROR_COPY[error.code] ?? COPY_UNAVAILABLE;
  }
}

function fieldMessage(
  code: LetterErrorCode,
  field: LetterInputField,
  action: LetterAction,
  extra: { letterType?: LetterType; lastUsed?: number | null; seqDigits?: number },
): string | null {
  const form = formOfAction(action, extra.letterType);
  if (form === null) return null;
  const text = LETTER_FIELD_ERROR_COPY[form][field]?.[code as FieldErrorCode];
  if (text === undefined) return null;
  const lastUsed = extra.lastUsed ?? 0;
  const nomor = extra.seqDigits === undefined ? String(lastUsed) : padLetterSequence(lastUsed, extra.seqDigits);
  return formatLetterCopy(text, { max: LETTER_LIMITS.seqDigitsMax, nomor });
}

/**
 * Field name for "{Kolom} terlalu panjang..." (owner), from the form labels of the design (7.4, 8,
 * 9.2, 12.2, 12.6, 13.3). note: "Alasan penolakan" on Tolak, else "Catatan"; reason: "Alasan".
 */
export function letterFieldName(field: LetterInputField, action: LetterAction, letterType?: LetterType): string | null {
  switch (field) {
    case "subject":
      return "Perihal";
    case "counterpart":
      return letterType === undefined ? null : LETTER_COUNTERPART_LABEL[letterType];
    case "counterpartNumber":
      return "Nomor surat dari pengirim";
    case "legacyNumber":
      return "Nomor lama";
    case "notes":
      return "Catatan";
    case "note":
      return action === "reject" ? "Alasan penolakan" : "Catatan";
    case "reason":
      return "Alasan";
    case "addressee":
      return "Ditujukan kepada";
    case "purpose":
      return "Keperluan";
    case "onBehalfOf":
      return "Atas nama";
    default:
      return null;
  }
}

/** Character limit per field (LETTER_LIMITS), for "{n}". */
const FIELD_MAX: Partial<Record<LetterInputField, number>> = {
  subject: LETTER_LIMITS.subject,
  counterpart: LETTER_LIMITS.counterpart,
  counterpartNumber: LETTER_LIMITS.counterpartNumber,
  legacyNumber: LETTER_LIMITS.legacyNumber,
  notes: LETTER_LIMITS.notes,
  note: LETTER_LIMITS.note,
  reason: LETTER_LIMITS.reason,
  addressee: LETTER_LIMITS.addressee,
  purpose: LETTER_LIMITS.purpose,
  onBehalfOf: LETTER_LIMITS.onBehalfOf,
};

function tooLongMessage(field: LetterInputField, action: LetterAction, letterType?: LetterType): string {
  const name = letterFieldName(field, action, letterType);
  const max = FIELD_MAX[field];
  return name === null || max === undefined ? COPY_UNAVAILABLE : formatLetterCopy(COPY_TOO_LONG, { Kolom: name, n: max });
}

/** Fills "{n}", "{nomor}", "{max}" ... in a copy string. Unknown placeholders stay as they are. */
export function formatLetterCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
}

// =============================================================================================
// 9. Labels (stored value -> Indonesian), shared by the screens and the export files.
//    Sources: design 4, 5.1, 5.2, 6.3, 7.4, 10.1-10.3, 11.1, 13.1, 16 (chip set).
// =============================================================================================

export const LETTER_TYPE_LABEL: Record<LetterType, string> = { incoming: "Surat Masuk", outgoing: "Surat Keluar" };
/** Counterpart label by type (design 7.4): the same words in list, detail, form and export. */
export const LETTER_COUNTERPART_LABEL: Record<LetterType, string> = { incoming: "Pengirim", outgoing: "Ditujukan kepada" };
/** Register card date line (design 5.2). {tanggal} = the formatted received date / letter date. */
export const LETTER_DATE_LINE: Record<LetterType, string> = { incoming: "Diterima {tanggal}", outgoing: "Tanggal surat {tanggal}" };
export const LETTER_STATUS_LABEL: Record<LetterStatus, string> = { active: "Aktif", voided: "Dibatalkan" };
export const LETTER_STATUS_FILTER_LABEL: Record<LetterStatusFilter, string> = { all: "Semua", active: "Aktif", voided: "Dibatalkan" };
export const LETTER_PERIOD_FILTER_LABEL: Record<LetterPeriodFilter, string> = { active: "Periode aktif", all: "Semua periode" };
export const LETTER_REQUEST_STATUS_LABEL: Record<LetterRequestStatus, string> = {
  submitted: "Diajukan",
  processing: "Diproses",
  issued: "Diterbitkan",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};
/** Marker chips (design 16). Never a status. */
export const LETTER_CHIP_LABEL = {
  legacyNumber: "Nomor lama",
  awaitingFile: "Menunggu file",
  numberVoided: "Nomor dibatalkan",
  withdrawn: "Ditarik",
  pastDue: "Lewat tanggal",
} as const;
export const LETTER_QUEUE_VIEW_LABEL: Record<LetterQueueView, string> = {
  submitted: "Menunggu",
  processing: "Sedang diproses",
  awaiting_file: "Menunggu file final",
  closed: "Selesai",
  all: "Semua",
  open_all_periods: "Belum selesai, semua periode",
};
export const MY_LETTER_REQUESTS_FILTER_LABEL: Record<MyLetterRequestsFilter, string> = {
  open: "Berjalan",
  closed: "Selesai",
  all: "Semua",
};
/** Field names for the edit history line '{Isian}: "{lama}" menjadi "{baru}"' (design 6.3, 7.4). */
export function letterFieldLabel(field: LetterEditableField, type: LetterType): string {
  switch (field) {
    case "subject":
      return "Perihal";
    case "counterpart":
      return LETTER_COUNTERPART_LABEL[type];
    case "counterpartNumber":
      return "Nomor surat dari pengirim";
    case "notes":
      return "Catatan";
    case "letterDate":
      return "Tanggal surat";
    case "receivedDate":
      return "Tanggal diterima";
  }
}
/** Letter "Riwayat" lines (design 6.3). {nama} = actorName, {file} = fileName. */
export const LETTER_HISTORY_LABEL: Record<LetterHistoryKind, string> = {
  registered: "Dicatat oleh {nama}",
  edited: "Rincian diubah oleh {nama}",
  file_added: "Berkas ditambahkan: {file}",
  file_withdrawn: "Berkas ditarik: {file}",
  voided: "Nomor dibatalkan oleh {nama}",
};
/** Second line of an edited entry (design 6.3). */
export const LETTER_HISTORY_CHANGE_LINE = '{isian}: "{lama}" menjadi "{baru}"';
/**
 * Request timeline lines (design 10.2). {nama} = actorName. rejected and cancelled have no design text:
 * they follow the "{Status} oleh {nama}" pattern of "Diproses oleh {nama}" (copy gap, see README).
 */
export const LETTER_REQUEST_EVENT_LABEL: Record<LetterRequestEvent, string> = {
  submitted: "Diajukan",
  processing: "Diproses oleh {nama}",
  number_taken: "Nomor diambil oleh {nama}",
  issued: "Diterbitkan, dicatat {nama}",
  rejected: "Ditolak oleh {nama}",
  cancelled: "Dibatalkan oleh {nama}",
};
/** Second lines of the timeline (design 10.2). */
export const LETTER_REQUEST_EVENT_DETAIL = {
  number_taken: "Nomor {nomor}",
  issued: "Berkas dipasang pada nomor surat.",
} as const;
/** Numbering format field names (design 13.1, 13.4). */
export const NUMBERING_FIELD_LABEL: Record<Exclude<keyof NumberingFormatValues, "includeYear">, string> = {
  prefix: "Awalan",
  incomingCode: "Kode surat masuk",
  outgoingCode: "Kode surat keluar",
  seqDigits: "Jumlah angka urutan",
  separator: "Pemisah",
};
/** "Riwayat perubahan" lines (design 13.1). {jenis} = "surat masuk" / "surat keluar". */
export const NUMBERING_CHANGE_LABEL = {
  format: "Format diubah oleh {nama}",
  next_sequence: "Nomor berikutnya {jenis} {tahun} diatur ke {nomor} oleh {nama}",
  reason: "Alasan: {alasan}",
} as const;
export const NUMBERING_TYPE_WORD: Record<LetterType, string> = { incoming: "surat masuk", outgoing: "surat keluar" };

// =============================================================================================
// 10. Pure helpers (screen, server and export agree)
// =============================================================================================

/** Today's calendar date in Asia/Jakarta (R16) as "YYYY-MM-DD". */
export function jakartaToday(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The number text from its parts, exactly as nexus._lt_format_number (the year is always included,
 * D2): prefix{sep}code{sep}year{sep}seq, seq padded to `seqDigits` and simply longer past it.
 * For the live preview of the settings form (design 13.2). The database may still skip a sequence whose
 * text already exists (D1), so the saved number can differ from a preview in that rare case.
 */
export function formatLetterNumber(
  format: Pick<NumberingFormatValues, "prefix" | "seqDigits" | "separator">,
  code: string,
  year: number,
  seq: number,
): string {
  return [format.prefix, code, String(year), padLetterSequence(seq, format.seqDigits)].join(format.separator);
}

/** Where a request stands for the chips and the state line (design 10.1, 10.3, 12). */
export type LetterRequestStage =
  | "submitted"
  /** Diproses, number not taken. */
  | "processing"
  /** Diproses, number taken: "Menunggu file". */
  | "awaiting_file"
  | "issued"
  /** Diterbitkan, letter voided: "Nomor dibatalkan". */
  | "issued_number_voided"
  | "rejected"
  | "cancelled";

export function letterRequestStage(request: {
  status: LetterRequestStatus;
  numberText: string | null;
  numberVoided?: boolean;
}): LetterRequestStage {
  switch (request.status) {
    case "processing":
      return request.numberText === null ? "processing" : "awaiting_file";
    case "issued":
      return request.numberVoided === true ? "issued_number_voided" : "issued";
    default:
      return request.status;
  }
}

/** G4: "Tarik berkas" would remove the only file the requester sees (show the blocked dialog 8.2). */
export function isLastIssuedFile(detail: Pick<LetterDetail, "fromRequest" | "fileCount">): boolean {
  return detail.fromRequest && detail.fileCount <= 1;
}

/** Export file name (design 14.2): "surat-masuk-YYYY-MM-DD.xlsx" (Jakarta date). */
export function letterExportFileName(type: LetterType, format: LetterExportFormat, now: Date = new Date()): string {
  return `${type === "incoming" ? "surat-masuk" : "surat-keluar"}-${jakartaToday(now)}.${format}`;
}

// =============================================================================================
// 11. Capabilities (menus and buttons only; every server entry point and the database check again)
// =============================================================================================

export type LetterCapabilities = {
  /** letters.view (BPH D06; included in letters.manage): Surat Masuk / Surat Keluar tabs, letter detail, tiles, Dashboard card. */
  canViewRegister: boolean;
  /** letters.manage (BPH secretaries): edit, add/withdraw files, void (per letter: detail.actions). */
  canManageRegister: boolean;
  /** letters.manage AND an active period: "+ Catat Surat Masuk / Keluar". */
  canRegister: boolean;
  /** letters.export (gated on view by the engine, R15): "Ekspor" on the register tabs. */
  canExportRegister: boolean;
  /** Fixed right (L9): "Permohonan Saya" and own request details. Any active member. */
  canViewOwnRequests: boolean;
  /** Fixed right (L9) AND an active period (R11): "+ Ajukan Surat", "Ajukan lagi". Caps: getMyRequestCaps(). */
  canSubmitRequest: boolean;
  /** letter_requests.view_all (BPH D08; included in process): Antrean, every request detail. */
  canViewAllRequests: boolean;
  /** letter_requests.process (BPH secretaries): Proses, Ambil nomor, Terbitkan, Tolak (never own: detail.actions). */
  canProcessRequests: boolean;
  /** System Admin or letters.manage: "Penomoran Surat" page (read-only unless canEditNumbering). */
  canReadNumbering: boolean;
  /** System Admin only (access control L3): format and next number. Works without an active period. */
  canEditNumbering: boolean;
  /** Any active member with an active period may upload into their own folder (bucket policy). */
  canUploadFiles: boolean;
  /** false = show the "Belum ada periode aktif..." banner (design 3.4). */
  hasActivePeriod: boolean;
};

const NO_LETTER_CAPABILITIES: LetterCapabilities = {
  canViewRegister: false,
  canManageRegister: false,
  canRegister: false,
  canExportRegister: false,
  canViewOwnRequests: false,
  canSubmitRequest: false,
  canViewAllRequests: false,
  canProcessRequests: false,
  canReadNumbering: false,
  canEditNumbering: false,
  canUploadFiles: false,
  hasActivePeriod: false,
};

/**
 * Derives the capabilities from the session state. my_permissions() already returns the union of all
 * active-period assignments with implied keys added (letters.manage -> letters.view,
 * letter_requests.process -> letter_requests.view_all) and export keys gated on their view key (R15).
 * Without an active period rule-based keys match nothing (R7), so only the fixed rights remain.
 * Letter keys accept scope "all" only (spec section 2).
 */
export function letterCapabilities(state: AccessState): LetterCapabilities {
  if (state.kind !== "member") return NO_LETTER_CAPABILITIES;
  const has = (key: string) => state.permissions.some((grant) => grant.key === key && grant.scope === "all");
  const hasActivePeriod = state.member.activePeriodId !== null;
  const canViewRegister = has("letters.view");
  const canManageRegister = has("letters.manage");
  return {
    canViewRegister,
    canManageRegister,
    canRegister: canManageRegister && hasActivePeriod,
    canExportRegister: canViewRegister && has("letters.export"),
    canViewOwnRequests: true,
    canSubmitRequest: hasActivePeriod,
    canViewAllRequests: has("letter_requests.view_all"),
    canProcessRequests: has("letter_requests.process"),
    canReadNumbering: state.member.isSystemAdmin || canManageRegister,
    canEditNumbering: state.member.isSystemAdmin,
    canUploadFiles: hasActivePeriod,
    hasActivePeriod,
  };
}

/** The module segments (design K1, P1), in the order of the control. */
export type LetterSegment = "incoming" | "outgoing" | "mine" | "queue";

/**
 * Segments this person may use, in order. "/surat" redirects to the first one (G13). With one segment
 * the control is not drawn (ModuleNav hides itself). The drawer item shows for every active member (D-025).
 */
export function letterSegments(capabilities: LetterCapabilities): LetterSegment[] {
  const segments: LetterSegment[] = [];
  if (capabilities.canViewRegister) segments.push("incoming", "outgoing");
  if (capabilities.canViewOwnRequests) segments.push("mine");
  if (capabilities.canViewAllRequests) segments.push("queue");
  return segments;
}

/** Default "Tampilkan" option (design 11.1): processors -> Menunggu, view_all only -> Semua. */
export function defaultLetterQueueView(capabilities: LetterCapabilities): LetterQueueView {
  return capabilities.canProcessRequests ? "submitted" : "all";
}

/*
 * =============================================================================================
 * 12. Functions the backend will provide (signatures are part of this contract). All server only.
 *     Each one: session + capability check first (getAccessState), zod validation, then ONE call to the
 *     nexus RPC with the USER's client (the database checks again). Never throws; returns
 *     LetterResult<T>. Write functions are Server Actions ("use server"). The RPC wrappers live in
 *     src/lib/picore/letters.ts (the functions read PI-CORE names, periods and assignments; CLAUDE.md 4),
 *     including every Storage call on the bucket (upload, signed URL).
 *     A malformed id given as a page address (letterId, requestId) answers not_found for that entity.
 *     Paged reads map total_count/page/page_size to LetterPaged (0 rows: total 0, page 1, pageCount 1).
 * =============================================================================================
 *
 * src/modules/letters/server/register.ts                                   (reads)
 *   listLetters(input: LetterListQueryInput): Promise<LetterResult<LetterPage>>        (canViewRegister) letter_list
 *   listLetterYears(type: LetterType): Promise<LetterResult<number[]>>                 (canViewRegister) letter_year_list
 *     "Tahun nomor" choices, newest first.
 *   getLetterDetail(letterId: string): Promise<LetterResult<LetterDetail>>             (canViewRegister) letter_detail
 *   getLetterDashboardCounts(): Promise<LetterResult<LetterDashboardCounts>>          (canViewRegister) letter_dashboard_counts
 *     Dashboard card and the register / Antrean header tiles. A caller with view_all but without
 *     letters.view (custom rule) takes the "Permohonan menunggu" tile from getLetterQueueCounts().submitted.
 *
 * src/modules/letters/server/register-actions.ts                           ("use server"; canManageRegister)
 *   registerLetter(input: LetterRegisterInput): Promise<LetterResult<LetterRegisterResult>>   letter_register
 *     (canRegister). Server checks receivedDate / letterDate not after jakartaToday() (date_in_future).
 *   updateLetter(input: LetterUpdateInput): Promise<LetterResult<LetterUpdateResult>>         letter_update
 *     Same date check. Fields of the other type are sent as null.
 *   addLetterFiles(input: LetterAddFilesInput): Promise<LetterResult<LetterFilesResult>>      letter_add_files
 *   withdrawLetterFile(input: LetterWithdrawFileInput): Promise<LetterResult<LetterFilesResult>> letter_withdraw_file
 *   voidLetter(input: LetterVoidInput): Promise<LetterResult<LetterVoidResult>>               letter_void
 *
 * src/modules/letters/server/requests.ts                                   (reads)
 *   listMyRequests(input?: MyLetterRequestsQueryInput): Promise<LetterResult<MyLetterRequestsPage>>
 *                                                     (canViewOwnRequests)                     letter_my_requests
 *   getMyRequestCaps(): Promise<LetterResult<LetterRequestCaps>>  (canViewOwnRequests)         letter_my_request_caps
 *     Header box "Permohonan {n} berjalan", the cap alerts above the request form (design 3.4) and the
 *     lone-processor hint (needs an open request of the viewer's own).
 *   listRequestQueue(input?: LetterQueueQueryInput): Promise<LetterResult<LetterQueuePage>>
 *                                                     (canViewAllRequests)                     letter_request_queue
 *   getLetterQueueCounts(): Promise<LetterResult<LetterQueueCounts>>  (canViewAllRequests)     letter_request_queue_counts
 *   getRequestDetail(requestId: string): Promise<LetterResult<LetterRequestDetail>>
 *                                                     (own or view_all; else not_found)        letter_request_detail
 *
 * src/modules/letters/server/request-actions.ts                            ("use server")
 *   submitRequest(input: LetterRequestCreateInput): Promise<LetterResult<LetterRequestTransitionResult>>
 *                                                     (canSubmitRequest; neededBy not before jakartaToday()) letter_request_create
 *   cancelRequest(input: LetterRequestCancelInput): Promise<LetterResult<LetterRequestTransitionResult>>
 *                                                     (the requester; the database decides)    letter_request_cancel
 *   processRequest(input: LetterRequestProcessInput): Promise<LetterResult<LetterRequestTransitionResult>>
 *                                                     (canProcessRequests)                     letter_request_process
 *   takeRequestNumber(input: LetterRequestTakeNumberInput): Promise<LetterResult<LetterTakeNumberResult>>
 *                                                     (canProcessRequests)                     letter_request_take_number
 *   issueRequest(input: LetterRequestIssueInput): Promise<LetterResult<LetterRequestTransitionResult>>
 *                                                     (canProcessRequests; letterDate not after today) letter_request_issue
 *     Sends letterVersion as p_letter_version (3rd argument).
 *   rejectRequest(input: LetterRequestRejectInput): Promise<LetterResult<LetterRequestTransitionResult>>
 *                                                     (canProcessRequests)                     letter_request_reject
 *
 * src/modules/letters/server/numbering.ts                                  (reads; canReadNumbering)
 *   getNumberingSettings(): Promise<LetterResult<NumberingSettings>>                   letter_numbering_settings
 *     Also feeds the first-use hint on the register form (types[].startSet, design 7.6) for managers.
 *   listNumberingHistory(input?: NumberingHistoryQueryInput): Promise<LetterResult<NumberingHistoryPage>>
 *                                                                                      letter_numbering_history
 *
 * src/modules/letters/server/numbering-actions.ts                          ("use server"; canEditNumbering)
 *   updateNumberingFormat(input: NumberingFormatUpdateInput): Promise<LetterResult<NumberingFormatResult>>
 *     Sends p_include_year = true always.                                              letter_numbering_update_format
 *   setNextNumber(input: NumberingSetNextInput): Promise<LetterResult<NumberingSetNextResult>>
 *                                                                                      letter_numbering_set_next
 *
 * src/modules/letters/server/file-actions.ts                               ("use server")
 *   getLetterFileLink(input: LetterFileLinkInput): Promise<LetterResult<LetterFileLink>>
 *     Pressed "Lihat"/"Unduh" (design 3.3: the link is made at the press, so it never expires under an
 *     open page). Reads the parent detail (letter_detail for "letter": canViewRegister;
 *     letter_request_detail for "request": attachments AND letterFiles), finds the file among the files
 *     the database returned to THIS caller (absent = not_found "file"), then signs its path for
 *     LETTER_FILE_SIGNED_URL_TTL_SECONDS with the USER's client (bucket policy letter_file_can_read
 *     checks again; a refusal = not_found "file"). The path never leaves the server.
 *
 * POST LETTER_FILE_UPLOAD_ROUTE = /api/letters/files   (multipart: LETTER_FILE_UPLOAD_FIELDS; any active member)
 *   Same-origin check; session (401/403); active period (else no_active_period, 409); body capped near
 *   LETTER_FILE_MAX_BYTES (over: file_too_large 413, field "file", ref null, maxMb 4); declared type and
 *   size (letterUploadFileSchema) AND sniffLetterFileType(first bytes) equal to the declared type (else
 *   invalid_file 400, field "file"); then uploads with the USER's client to LETTER_FILE_BUCKET at
 *   letterFilePath(session member id, randomUUID(), type), contentType = the type, no overwrite. A Storage
 *   refusal (policy: cap of 10 unattached uploads in 24 hours) = upload_limit 429 (limit 10); anything
 *   else = unavailable 503. 200: LetterFileUploadResult (name = cleanLetterFileName(file.name, type)).
 *   Every non-2xx: LetterErrorBody. Cache-Control no-store. Other methods: 405.
 *
 * POST /api/letters/export   (form/JSON: LetterExportInput; canExportRegister)
 *   Same-origin check, body cap, ONE call to letter_export (writes the export-log row in the same
 *   transaction; no row, no file), Cache-Control no-store. 200: the file, Content-Disposition attachment
 *   letterExportFileName(type, format) (Jakarta date, design 14.2). Header: tab, period filter and export
 *   date in WIB (A-LT16); dates in WIB; Dibatalkan rows with their reason (F8.2). 401/403/400/503:
 *   LetterErrorBody. 422 export_too_large: fewer rows arrived than the database's total_count (PostgREST
 *   max_rows cut; readTotalCount/isCut of src/lib/supabase/limits.ts); no file is returned. Other methods: 405.
 *   Column headers follow spec section 8; the backend proposes their exact words when the writer is built.
 */
