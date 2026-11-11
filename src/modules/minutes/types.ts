// Contract between the Meeting Minutes backend (src/lib/picore/minutes.ts, src/modules/minutes/server) and
// the UI (src/modules/minutes/ui, src/app). Written 2026-11-10 by the backend engineer.
// Change it only after telling the tech lead: both sides depend on it.
//
// Spec:     docs/modules/meeting-minutes.md (APPROVED 2026-11-09, D-027: N1 b, N2 c, N3 a, N4 a, N5 a,
//           N6 a, N7 a; F1-F7, R1-R16, A-MN1..A-MN18, MN-01..MN-30). Section 7 (screens and copy) is the
//           approved design (fast mode, D-026); copy quoted below comes from there ("spec 7.x"). Texts the
//           spec does not give are marked "gap" and listed in src/modules/minutes/README.md.
// Database: supabase/migrations/20261111100000_nexus_minutes_access_rules.sql (rule D37),
//           20261111100100_nexus_minutes.sql (the 12 public nexus.minute_* functions; decisions M1-M7)
//           and 20261111100200_nexus_minutes_storage.sql (bucket nexus-minute-files).
//
// Pure and isomorphic: safe to import from Server Components, Client Components and route handlers.
// Stored values are the database's English identifiers; Indonesian labels are in section 9.
// No type here holds email, phone, NIM, NIP or auth user ids (access control L4). Storage paths of SAVED
// files are never exposed: links come from getMinuteFileLink(). Only the path of the caller's own fresh
// upload travels (upload -> save).
// Zod issue messages in this file are machine codes (MinuteErrorCode or a page/search code), never shown
// to people. minuteErrorFromZod() turns the FIRST issue into a MinuteError.
//
// Self-contained on purpose (CLAUDE.md 7): the file helpers below repeat the Letters ones instead of
// importing them, so either module can change without breaking the other.

import { z } from "zod";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";

// =============================================================================================
// 1. Limits (mirror the database CHECKs and functions; the database checks again). A-MN3, N6 a.
// =============================================================================================

export const MINUTE_LIMITS = {
  /** "Judul Rapat" (one line, A-MN3). */
  title: 150,
  /** "Topik Bahasan" (one line). */
  topic: 200,
  /** "Isi Notulensi" (line breaks kept). */
  content: 20_000,
  /** "Keputusan & Tindak Lanjut" (optional, line breaks kept, A-MN2). */
  decision: 5_000,
  /** Void and withdraw reasons (one line). */
  reason: 500,
  /** Original file name stored with a file (1..200 code points, no control characters). */
  fileName: 200,
  /** Visible (not withdrawn) files per minute (N6 a). Withdrawn files do not count. */
  filesPerMinute: 3,
  /** Bucket and database limit per file: 4 MiB (4194304 bytes), lowered for the Vercel 4.5 MB request cap. */
  fileMaxBytes: 4_194_304,
  /** Uploads not yet attached to a saved minute, per member, last 24 hours (A-MN9). The 11th is refused. */
  unattachedUploadsPer24h: 10,
  /** Dates before this are refused by the database. */
  minDate: "2000-01-01",
  /** Export row guard (spec 8, database M5): more matching rows are refused before any log row. */
  exportMaxRows: 1000,
} as const;

/** Rows per page on screen (A-MN6) and the hard server maximum (refused, never clamped). */
export const MINUTE_PAGE_SIZE_DEFAULT = 20;
export const MINUTE_PAGE_SIZE_MAX = 50;
/** Search: max length after trimming and collapsing spaces; raw input above 480 is refused first. */
export const MINUTE_SEARCH_MAX_LENGTH = 120;
export const MINUTE_SEARCH_RAW_MAX_LENGTH = 480;

/**
 * Query parameter names of the list address (short English names like the other modules). Values:
 * unit = an org unit id ("" or absent = all units the caller may read); period "active" | "all";
 * status "active" | "voided" | "all"; notice = a one-time success notice (MinuteNotice).
 * The address is user-editable: the UI falls back to defaults, the server validates again.
 */
export const MINUTE_PARAMS = {
  search: "q",
  unit: "unit",
  period: "period",
  status: "status",
  page: "page",
  notice: "notice",
} as const;

/**
 * Screens (spec 7) and route handlers. The module has no segment control (one list, no tabs), so there
 * is no segments function like letterSegments(): the drawer item "Notulensi Rapat" shows only for
 * minutes.view holders (spec 2, D-021) and every page checks again.
 */
export const MINUTE_ROUTES = {
  /** Screen 1, list. */
  list: "/notulensi",
  /** Screen 3, record form (minutes.manage + active period). */
  record: "/notulensi/catat",
  /** POST, multipart upload of one attachment (section 4). */
  fileUpload: "/api/minutes/files",
  /** POST, export of the list or of one minute (section 5). */
  export: "/api/minutes/export",
} as const;

/** Screen 2, detail. */
export function minuteDetailPath(minuteId: string): string {
  return `/notulensi/${encodeURIComponent(minuteId)}`;
}

/** Screen 4, edit form. */
export function minuteEditPath(minuteId: string): string {
  return `/notulensi/${encodeURIComponent(minuteId)}/ubah`;
}

// =============================================================================================
// 2. Enums (exactly the values stored or accepted by the database)
// =============================================================================================

/** Minute status (4.2): active = Aktif, voided = Dibatalkan (never restored, A-MN15). No draft (N3 a). */
export const minuteStatusSchema = z.enum(["active", "voided"]);
export type MinuteStatus = z.infer<typeof minuteStatusSchema>;

/** "Status" filter (F1). Default "active" (A-MN6, database _mn_status_filter). */
export const minuteStatusFilterSchema = z.enum(["active", "voided", "all"], { message: "invalid_input" });
export type MinuteStatusFilter = z.infer<typeof minuteStatusFilterSchema>;

/** "Periode" filter (F1): only the active period (default) or all periods (F7 handover helper). */
export const minutePeriodFilterSchema = z.enum(["active", "all"], { message: "invalid_input" });
export type MinutePeriodFilter = z.infer<typeof minutePeriodFilterSchema>;

/** History kinds (minute_history.kind). */
export const minuteHistoryKindSchema = z.enum(["recorded", "edited", "file_added", "file_withdrawn", "voided"]);
export type MinuteHistoryKind = z.infer<typeof minuteHistoryKindSchema>;

/** PI-CORE org_unit_type (schema report). New minutes only use the first four (N2 c, database M1). */
export const minuteUnitTypeSchema = z.enum(["organization", "bph", "department", "bureau", "division"]);
export type MinuteUnitType = z.infer<typeof minuteUnitTypeSchema>;

/** Export formats (D-020, same three as the other modules). */
export const minuteExportFormatSchema = z.enum(["xlsx", "csv", "pdf"], { message: "invalid_input" });
export type MinuteExportFormat = z.infer<typeof minuteExportFormatSchema>;

// =============================================================================================
// 3. Small shared schemas and text cleaning (same order as the database helpers)
// =============================================================================================

/** Code points, like Postgres char_length (JS .length would count an emoji twice). */
function charLength(text: string): number {
  return [...text].length;
}

/** Postgres uuid text form; like z.guid() it accepts seeded non-RFC ids. */
const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const idSchema = z.guid({ message: "invalid_input" });

/** Optimistic-lock version from the last read; a mismatch answers state_changed ("Data sudah berubah"). */
const versionSchema = z.number({ message: "invalid_input" }).int({ message: "invalid_input" }).min(1, { message: "invalid_input" });

/** minute_files.id (bigint identity; safe as a JS number far beyond any real count). */
const fileIdSchema = z
  .number({ message: "invalid_input" })
  .int({ message: "invalid_input" })
  .min(1, { message: "invalid_input" })
  .max(Number.MAX_SAFE_INTEGER, { message: "invalid_input" });

/** One-line text (title, topic, reasons; database M2 / _mn_text): whitespace incl. line breaks -> one space. */
export function cleanMinuteLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Multi-line text (content, decision; database M2 / _mn_long_text): CRLF -> LF, outer whitespace trimmed. */
export function cleanMinuteLongText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/^\s+|\s+$/g, "");
}

type RequiredCode = "text_required" | "reason_required";

/** Required text: cleaned, then not blank and within the cap. */
function requiredTextSchema(max: number, clean: (raw: string) => string, missing: RequiredCode = "text_required") {
  return z
    .string({ message: missing })
    .transform(clean)
    .refine((text) => text !== "", { message: missing })
    .refine((text) => charLength(text) <= max, { message: "text_too_long" });
}

/** Optional multi-line text: cleaned, blank -> null, then the cap. */
function optionalLongTextSchema(max: number) {
  return z
    .string({ message: "invalid_input" })
    .nullish()
    .transform((raw) => {
      const cleaned = cleanMinuteLongText(raw ?? "");
      return cleaned === "" ? null : cleaned;
    })
    .refine((text) => text === null || charLength(text) <= max, { message: "text_too_long" });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

/** A real "YYYY-MM-DD" date, not before 2000-01-01 (the database refuses earlier dates). */
export function isValidMinuteDate(date: string): boolean {
  return ISO_DATE.test(date) && isRealDate(date) && date >= MINUTE_LIMITS.minDate;
}

/**
 * "Tanggal Rapat": blank or missing = date_required, malformed or before 2000 = invalid_dates. "Not after
 * today" (date_in_future, R9) is checked by the SERVER with jakartaToday() before the RPC (and by the
 * database), not here: a schema must not depend on the clock of the device.
 */
const meetingDateSchema = z.string({ message: "date_required" }).superRefine((value, ctx) => {
  if (value.trim() === "") ctx.addIssue({ code: "custom", message: "date_required" });
  else if (!isValidMinuteDate(value)) ctx.addIssue({ code: "custom", message: "invalid_dates" });
});

/** Search: same cleaning and caps as nexus._mn_search_pattern. Blank = no search (null). */
export const minuteSearchSchema = z
  .string({ message: "invalid_input" })
  .refine((raw) => charLength(raw) <= MINUTE_SEARCH_RAW_MAX_LENGTH, { message: "search_too_long" })
  .transform((raw) => raw.trim().replace(/\s+/g, " "))
  .refine((clean) => charLength(clean) <= MINUTE_SEARCH_MAX_LENGTH, { message: "search_too_long" })
  .transform((clean) => (clean === "" ? null : clean));

/** Unit filter from the address: blank = all units in scope (null). A unit outside the scope = no rows (M7). */
const unitFilterSchema = z
  .string({ message: "invalid_input" })
  .nullish()
  .transform((raw) => {
    const trimmed = (raw ?? "").trim();
    return trimmed === "" ? null : trimmed.toLowerCase();
  })
  .refine((id) => id === null || GUID_PATTERN.test(id), { message: "invalid_input" });

/** The owning unit of a new minute: blank = unit_required ("Pilih unit."), malformed = invalid_input. */
const recordUnitSchema = z
  .string({ message: "unit_required" })
  .transform((raw) => raw.trim().toLowerCase())
  .superRefine((id, ctx) => {
    if (id === "") ctx.addIssue({ code: "custom", message: "unit_required" });
    else if (!GUID_PATTERN.test(id)) ctx.addIssue({ code: "custom", message: "invalid_input" });
  });

const pageSchema = z.number({ message: "invalid_page" }).int({ message: "invalid_page" }).min(1, { message: "invalid_page" });
const pageSizeSchema = z
  .number({ message: "invalid_page_size" })
  .int({ message: "invalid_page_size" })
  .min(1, { message: "invalid_page_size" })
  .max(MINUTE_PAGE_SIZE_MAX, { message: "invalid_page_size" });

// =============================================================================================
// 4. Files (spec 4.4, N6 a, A-MN9; storage migration 20261111100200; database M4)
// =============================================================================================

/** Private bucket. Only the path is stored; people get short-lived signed URLs (CLAUDE.md 11). */
export const MINUTE_FILE_BUCKET = "nexus-minute-files";
export const MINUTE_FILE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type MinuteFileMimeType = (typeof MINUTE_FILE_MIME_TYPES)[number];
export const MINUTE_FILE_EXTENSION: Record<MinuteFileMimeType, "pdf" | "jpg" | "png"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};
/** 4 MiB, the bucket and database limit. */
export const MINUTE_FILE_MAX_BYTES = MINUTE_LIMITS.fileMaxBytes;
export const MINUTE_FILE_MAX_MB = 4;
/** Lifetime of a signed file link (spec 4.4: 300 seconds). Made when "Lihat" is pressed. */
export const MINUTE_FILE_SIGNED_URL_TTL_SECONDS = 300;
/** Browser resize of IMAGES before upload (spec 4.4): long side about 2000 px. PDF never. Client hint only. */
export const MINUTE_IMAGE_RESIZE_LONG_SIDE_PX = 2000;

/** Multipart field names of the upload route: exactly one file, nothing else. */
export const MINUTE_FILE_UPLOAD_FIELDS = { file: "file" } as const;

/**
 * Same pattern as the database: "<uploader members.id>/<random uuid>.<pdf|jpg|jpeg|png>", lowercase. The
 * uploader's OWN folder; a save attaches only the caller's own uploads. NEXUS itself writes pdf, jpg, png.
 */
export const MINUTE_FILE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/;
export const minuteFilePathSchema = z.string({ message: "invalid_file" }).regex(MINUTE_FILE_PATH_PATTERN, { message: "invalid_file" });

/** Builds the storage path of a new upload. `fileId` is a fresh random uuid (crypto.randomUUID()). */
export function minuteFilePath(memberId: string, fileId: string, type: MinuteFileMimeType): string {
  return `${memberId.toLowerCase()}/${fileId.toLowerCase()}.${MINUTE_FILE_EXTENSION[type]}`;
}

/**
 * The file's real type from its first bytes, or null. PDF "%PDF-" (25 50 44 46 2D), JPEG FF D8 FF,
 * PNG 89 50 4E 47 0D 0A 1A 0A. The upload route refuses a file whose real type is null or differs from
 * the declared type (invalid_file, MN-17). The browser may use it for early feedback.
 */
export function sniffMinuteFileType(bytes: Uint8Array): MinuteFileMimeType | null {
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
 * The original file name as stored (1..200 code points, no control characters, as _mn_check_files).
 * Control characters dropped, spaces trimmed, cut to 200 code points; empty becomes "berkas.<ext>".
 * The upload route returns this cleaned name; the UI sends it back unchanged.
 */
export function cleanMinuteFileName(raw: string, type: MinuteFileMimeType): string {
  const kept = [...raw].filter((ch) => !isControlChar(ch)).join("").trim();
  const cut = [...kept].slice(0, MINUTE_LIMITS.fileName).join("").trim();
  return cut === "" ? `berkas.${MINUTE_FILE_EXTENSION[type]}` : cut;
}

/** The declared file the browser sends (AFTER resizing images). The route also sniffs the bytes. */
export const minuteUploadFileSchema = z.object({
  type: z.enum(MINUTE_FILE_MIME_TYPES, { message: "invalid_file" }),
  size: z
    .number({ message: "invalid_file" })
    .int({ message: "invalid_file" })
    .min(1, { message: "invalid_file" })
    .max(MINUTE_FILE_MAX_BYTES, { message: "file_too_large" }),
});

/** A just-uploaded file passed to a save action (the upload route's answer: path + cleaned name). */
export const minuteFileRefSchema = z.object({
  path: minuteFilePathSchema,
  name: z
    .string({ message: "invalid_file" })
    .transform((raw) => raw.trim())
    .refine((name) => name !== "" && charLength(name) <= MINUTE_LIMITS.fileName && ![...name].some(isControlChar), {
      message: "invalid_file",
    }),
});

/**
 * A list of just-uploaded files, `min`..`max`, each path once. Too few = file_required, too many =
 * file_count. The database checks again: own folder, not attached before (file_already_attached), really
 * uploaded (file_missing), size and type; "Tambah lampiran" also against the room left (3 - visible).
 */
function fileListSchema(min: number, max: number) {
  return z
    .array(minuteFileRefSchema, { message: "invalid_file" })
    .min(min, { message: "file_required" })
    .max(max, { message: "file_count" })
    .refine((files) => new Set(files.map((f) => f.path)).size === files.length, { message: "invalid_file" });
}

export type MinuteFileRefInput = z.input<typeof minuteFileRefSchema>;
export type MinuteUploadFileInput = z.input<typeof minuteUploadFileSchema>;

// =============================================================================================
// 5. Read inputs (list, export, file link)
// =============================================================================================

/**
 * List filters (F1, screen 1), shared by the list and the list export (R13: the export never shows more
 * than the screen). unitId null = every unit the caller may read; a unit outside the scope returns no
 * rows, not an error (database M7).
 */
export const minuteListFiltersSchema = z.object({
  search: minuteSearchSchema.nullable().default(null),
  unitId: unitFilterSchema.default(null),
  period: minutePeriodFilterSchema.default("active"),
  status: minuteStatusFilterSchema.default("active"),
});

export const minuteListQuerySchema = z.object({
  filters: minuteListFiltersSchema.prefault({}),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(MINUTE_PAGE_SIZE_DEFAULT),
});

/**
 * Export body (F6). "list" = all rows of the current filters inside the caller's export scope (send the
 * validated `filters` of the MinutePage, not raw URL values). "single" = one minute from the detail
 * (A-MN8, database M6: the list filters are ignored; outside the scope = not_found).
 */
export const minuteExportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), format: minuteExportFormatSchema, filters: minuteListFiltersSchema.prefault({}) }),
  z.object({ kind: z.literal("single"), format: minuteExportFormatSchema, minuteId: idSchema }),
]);

/** "Lihat" on an attachment of the detail page. */
export const minuteFileLinkSchema = z.object({ minuteId: idSchema, fileId: fileIdSchema });

export type MinuteListFiltersInput = z.input<typeof minuteListFiltersSchema>;
export type MinuteListFilters = z.output<typeof minuteListFiltersSchema>;
export type MinuteListQueryInput = z.input<typeof minuteListQuerySchema>;
export type MinuteExportInput = z.input<typeof minuteExportSchema>;
export type MinuteFileLinkInput = z.input<typeof minuteFileLinkSchema>;

/** The default filters: "Belum ada notulensi." (empty) vs "Tidak ada hasil..." (no match) depends on it. */
export function isDefaultMinuteFilters(filters: MinuteListFilters): boolean {
  return filters.search === null && filters.unitId === null && filters.period === "active" && filters.status === "active";
}

// =============================================================================================
// 6. Write inputs. Edit, files and void send the `version` the screen read. The actor, the period and
//    the creator are ALWAYS taken from the session by the database, never inputs (MN-09).
//    The server checks meetingDate not after jakartaToday() BEFORE the RPC (date_in_future, field
//    meetingDate), and the database checks again.
// =============================================================================================

const minuteTextFields = {
  meetingDate: meetingDateSchema,
  title: requiredTextSchema(MINUTE_LIMITS.title, cleanMinuteLine),
  topic: requiredTextSchema(MINUTE_LIMITS.topic, cleanMinuteLine),
  content: requiredTextSchema(MINUTE_LIMITS.content, cleanMinuteLongText),
  decision: optionalLongTextSchema(MINUTE_LIMITS.decision),
};

/**
 * "Simpan Notulensi" (F3, screen 3). unitId: one of minute_unit_options() with canRecord. The server
 * also checks it against the caller's minutes.manage scope before the RPC (unit_not_allowed); the
 * database checks scope (unit_not_allowed) and kind (invalid_unit: division, inactive, unknown).
 * Files are optional (0..3). Needs minutes.manage and an active period.
 */
export const minuteRecordSchema = z.object({
  unitId: recordUnitSchema,
  ...minuteTextFields,
  files: fileListSchema(0, MINUTE_LIMITS.filesPerMinute).default([]),
});

/**
 * "Simpan Perubahan" (F4, screen 4): an Aktif minute of the ACTIVE period in the caller's manage scope.
 * Send every field as shown on the form; an unchanged form writes nothing (`changed: false`). Unit and
 * period are not inputs (A-MN4, MN-11).
 */
export const minuteUpdateSchema = z.object({
  minuteId: idSchema,
  version: versionSchema,
  ...minuteTextFields,
});

/** "Tambah lampiran" (F5): 1..actions.filesRoom files. */
export const minuteAddFilesSchema = z.object({
  minuteId: idSchema,
  version: versionSchema,
  files: fileListSchema(1, MINUTE_LIMITS.filesPerMinute),
});

/** "Tarik berkas" (F5, screen 6). `version` = the MINUTE's version. Reason required (one line). */
export const minuteWithdrawFileSchema = z.object({
  fileId: fileIdSchema,
  version: versionSchema,
  reason: requiredTextSchema(MINUTE_LIMITS.reason, cleanMinuteLine, "reason_required"),
});

/** "Batalkan notulensi" (F5, screen 5). Reason required. Never restored (A-MN15). */
export const minuteVoidSchema = z.object({
  minuteId: idSchema,
  version: versionSchema,
  reason: requiredTextSchema(MINUTE_LIMITS.reason, cleanMinuteLine, "reason_required"),
});

export type MinuteRecordInput = z.input<typeof minuteRecordSchema>;
export type MinuteUpdateInput = z.input<typeof minuteUpdateSchema>;
export type MinuteAddFilesInput = z.input<typeof minuteAddFilesSchema>;
export type MinuteWithdrawFileInput = z.input<typeof minuteWithdrawFileSchema>;
export type MinuteVoidInput = z.input<typeof minuteVoidSchema>;

// =============================================================================================
// 7. Output types (camelCase of the RPC columns / JSON keys; nothing the database does not return)
// =============================================================================================

/** Dates are "YYYY-MM-DD" (Jakarta calendar days); timestamps are ISO 8601 strings (UTC, show in WIB). */
type IsoDate = string;
type IsoTimestamp = string;

export type MinutePaged<T> = {
  rows: T[];
  total: number;
  /** The page actually returned: a page past the end returns the last page. */
  page: number;
  pageSize: number;
  /** max(1, ceil(total / pageSize)). */
  pageCount: number;
};

/**
 * nexus.minute_unit_options() row: units for the "Unit" filter and the record form's "Unit" select.
 * Order: "Seluruh organisasi", BPH, then PI-CORE sort order. Show the label with minuteUnitLabel().
 */
export type MinuteUnitOption = {
  unitId: string;
  unitName: string;
  unitType: MinuteUnitType;
  isActive: boolean;
  /** In the caller's minutes.view scope (filter choice; the filter is offered when more than one). */
  canRead: boolean;
  /** Recordable (active root, BPH, department or bureau, M1) AND in the minutes.manage scope. */
  canRecord: boolean;
};

/** nexus.minute_list() row (card / table row). No content and no decision (the detail has them). */
export type MinuteRow = {
  rowNo: number;
  minuteId: string;
  unitId: string;
  /** Read live from PI-CORE (A-MN12); null only if the unit no longer exists (R8). */
  unitName: string | null;
  unitType: MinuteUnitType | null;
  meetingDate: IsoDate;
  title: string;
  topic: string;
  status: MinuteStatus;
  periodId: string;
  periodLabel: string | null;
  /** Visible (not withdrawn) files: "{n} berkas". */
  fileCount: number;
  createdAt: IsoTimestamp;
  version: number;
};

export type MinutePage = MinutePaged<MinuteRow> & {
  /** The validated filters the rows were read with (send these, not raw URL values, to the export). */
  filters: MinuteListFilters;
};

/**
 * A stored file the caller may read (withdrawn ones only for managers of the unit, A-MN7). No storage
 * path: "Lihat" calls getMinuteFileLink().
 */
export type MinuteFile = {
  fileId: number;
  name: string;
  /** null only where Storage was not installed when it was attached. */
  sizeBytes: number | null;
  mimeType: MinuteFileMimeType;
  attachedAt: IsoTimestamp;
  attachedByName: string | null;
  /** Chip "Ditarik" (managers only ever receive withdrawn files). */
  isWithdrawn: boolean;
  withdrawnAt: IsoTimestamp | null;
  withdrawnByName: string | null;
  withdrawReason: string | null;
};

/** A signed, short-lived link to one file (MINUTE_FILE_SIGNED_URL_TTL_SECONDS). Opened in a new tab. */
export type MinuteFileLink = { fileId: number; url: string; expiresAt: IsoTimestamp };

/** Answer of the upload route: send `{ path, name }` in the save action's `files`. */
export type MinuteFileUploadResult = { path: string; name: string; sizeBytes: number; mimeType: MinuteFileMimeType };

/** Fields an "edited" history row can name (database before/after keys, mapped). */
export type MinuteEditableField = "meetingDate" | "title" | "topic" | "content" | "decision";
/** Database before/after key -> field, in the order the UI lists them. */
export const MINUTE_HISTORY_FIELD_KEYS: Record<string, MinuteEditableField> = {
  meeting_date: "meetingDate",
  title: "title",
  topic: "topic",
  content: "content",
  decision: "decision",
};
export type MinuteFieldChange = { field: MinuteEditableField; before: string | null; after: string | null };

/**
 * One "Riwayat" entry, newest first (screen 2). changes: only for `edited` (order of MinuteEditableField;
 * unknown keys ignored). fileName: file_added / file_withdrawn, null when the caller may not see that
 * file (a withdrawn file for a non-manager). note: the reason of file_withdrawn and voided.
 * file_withdrawn rows reach managers of the unit only (database M3).
 */
export type MinuteHistoryEntry = {
  historyId: number;
  at: IsoTimestamp;
  kind: MinuteHistoryKind;
  actorName: string | null;
  changes: MinuteFieldChange[];
  fileName: string | null;
  note: string | null;
};

/**
 * Which buttons exist for THIS caller now (database answer; every write function re-checks). The four
 * write flags are false for non-managers of the unit, a voided minute and a minute of an old period.
 */
export type MinuteActions = {
  canEdit: boolean;
  canVoid: boolean;
  /** Fewer than 3 visible files. */
  canAddFiles: boolean;
  /** At least one visible file. */
  canWithdrawFiles: boolean;
  /** 3 - visible files when editable, else 0. */
  filesRoom: number;
  /** minutes.export on this minute's unit: "Ekspor" on the detail (A-MN8). */
  canExport: boolean;
};

/** nexus.minute_detail() (screen 2). An unknown id or a minute outside the scope answers not_found "minute". */
export type MinuteDetail = {
  minuteId: string;
  unitId: string;
  unitName: string | null;
  unitType: MinuteUnitType | null;
  meetingDate: IsoDate;
  title: string;
  topic: string;
  /** Plain text with line breaks (R10: never HTML or Markdown). */
  content: string;
  decision: string | null;
  status: MinuteStatus;
  voidReason: string | null;
  voidedAt: IsoTimestamp | null;
  voidedByName: string | null;
  periodId: string;
  periodLabel: string | null;
  /** false = note "Notulensi periode lama hanya bisa dibaca." */
  isActivePeriod: boolean;
  createdAt: IsoTimestamp;
  createdByName: string | null;
  updatedAt: IsoTimestamp;
  updatedByName: string | null;
  version: number;
  /** Visible files (withdrawn ones not counted). */
  fileCount: number;
  /** Files the caller may read, oldest first. */
  files: MinuteFile[];
  history: MinuteHistoryEntry[];
  actions: MinuteActions;
};

/**
 * nexus.minute_dashboard_counts(): header tiles (screen 1) and the Dashboard card (screen 8, N5 a).
 * Aktif minutes of the ACTIVE period inside the caller's scope (A-MN13). Counts only, never a title.
 * periodId null = no active period (minuteCount 0). Period dates feed the soft warning of R9.
 */
export type MinuteDashboardCounts = {
  periodId: string | null;
  periodLabel: string | null;
  periodStartsOn: IsoDate | null;
  periodEndsOn: IsoDate | null;
  minuteCount: number;
  /** "Rapat terakhir"; null = "-" (tile) or no line (card). */
  latestMeetingDate: IsoDate | null;
};

/**
 * nexus.minute_export() row (server-side, for the file writer). Same rows and order as the list (or the
 * one minute), all pages. Content and decision in full; no file links (A-MN16).
 */
export type MinuteExportRow = {
  rowNo: number;
  minuteId: string;
  meetingDate: IsoDate;
  unitName: string | null;
  unitType: MinuteUnitType | null;
  title: string;
  topic: string;
  content: string;
  decision: string | null;
  status: MinuteStatus;
  voidReason: string | null;
  periodLabel: string | null;
  createdByName: string | null;
  createdAt: IsoTimestamp;
  fileCount: number;
};

// ---- Write results ----

/** nexus.minute_record(): the new minute (the UI goes to its detail page). */
export type MinuteRecordResult = { minuteId: string; version: number };
/** nexus.minute_update(): changed false = nothing was different (no history row). */
export type MinuteUpdateResult = { minuteId: string; changed: boolean; version: number };
/** nexus.minute_add_files() / minute_withdraw_file(): visible files now and the minute's new version. */
export type MinuteFilesResult = { minuteId: string; fileCount: number; version: number };
/** nexus.minute_void(). */
export type MinuteVoidResult = { minuteId: string; status: MinuteStatus; version: number };

// =============================================================================================
// 8. Errors and results
// =============================================================================================

/** Which input a refusal is about (zod path or database detail). `request` = malformed body. */
export type MinuteInputField =
  | "request"
  | "search"
  | "unitId"
  | "period"
  | "status"
  | "page"
  | "pageSize"
  | "format"
  | "kind"
  | "filters"
  | "minuteId"
  | "fileId"
  | "version"
  | "meetingDate"
  | "title"
  | "topic"
  | "content"
  | "decision"
  | "reason"
  | "files"
  | "file";

const MINUTE_INPUT_FIELDS: ReadonlySet<string> = new Set<MinuteInputField>([
  "request",
  "search",
  "unitId",
  "period",
  "status",
  "page",
  "pageSize",
  "format",
  "kind",
  "filters",
  "minuteId",
  "fileId",
  "version",
  "meetingDate",
  "title",
  "topic",
  "content",
  "decision",
  "reason",
  "files",
  "file",
]);

/**
 * Database `detail` -> field (22023 hints that name a field). A detail that is a storage path becomes
 * field "files" with `ref` = that path; a number (file_required / file_count) becomes `count`.
 */
export const MINUTE_DB_DETAIL_FIELDS: Record<string, MinuteInputField> = {
  org_unit_id: "unitId",
  meeting_date: "meetingDate",
  title: "title",
  topic: "topic",
  content: "content",
  decision: "decision",
  reason: "reason",
  p_files: "files",
  name: "files",
};

/** Hints that carry no detail but always concern one filter or paging input. */
const MINUTE_DB_HINT_FIELDS: Record<string, MinuteInputField> = {
  invalid_status: "status",
  invalid_period: "period",
  search_too_long: "search",
  invalid_page: "page",
  invalid_page_size: "pageSize",
  invalid_format: "format",
};

/** Entities a not_found can be about (P0002 hints). A minute you may not read is also not_found. */
export type MinuteEntity = "minute" | "file";

/**
 * Error union. HTTP meaning (route handlers, minuteErrorStatus): unauthenticated 401; forbidden,
 * unit_not_allowed, closed_period 403; not_found 404; input codes 400; file_too_large 413;
 * export_too_large 422; upload_limit 429; unavailable 503 (fail closed: never shown as "no access",
 * never a sign-out); every other business refusal 409. Payloads carry fields, counts and paths of the
 * caller's own uploads only, never a person.
 */
export type MinuteError =
  // Session and access (L1, keys). permission_required and not_active_member (42501) -> forbidden.
  | { code: "unauthenticated" }
  | { code: "forbidden" }
  | { code: "unavailable" }
  /** The unit is outside the caller's minutes.manage scope (MN-02, MN-07). Field is always unitId. */
  | { code: "unit_not_allowed" }
  /** L7: a minute of a previous period is read-only. */
  | { code: "closed_period" }
  // Input (22023). invalid_status, invalid_period, search_too_long, invalid_page, invalid_page_size,
  // invalid_format -> invalid_input with the field.
  | { code: "invalid_input"; field: MinuteInputField }
  /** Record form without a unit (zod only; the select always has a value when there is one unit). */
  | { code: "unit_required"; field: MinuteInputField }
  /** Division, inactive or unknown unit (database M1). */
  | { code: "invalid_unit"; field: MinuteInputField }
  | { code: "text_required" | "text_too_long" | "reason_required"; field: MinuteInputField }
  | { code: "date_required" | "date_in_future" | "invalid_dates"; field: MinuteInputField }
  | { code: "invalid_file" | "file_already_attached" | "file_missing"; field: MinuteInputField; ref: string | null }
  /** maxMb = MINUTE_FILE_MAX_MB. */
  | { code: "file_too_large"; field: MinuteInputField; ref: string | null; maxMb: number }
  /** count = the minimum (file_required) or the maximum allowed now (file_count). */
  | { code: "file_required" | "file_count"; field: MinuteInputField; count: number | null }
  // Not found (P0002).
  | { code: "not_found"; entity: MinuteEntity }
  // Business refusals (P0001).
  | { code: "no_active_period" } // R4 / R11
  | { code: "state_changed" } // R11: "Data sudah berubah. Muat ulang."
  | { code: "minute_voided" } // 4.2: a voided minute is read-only
  /**
   * Export refused: more than MINUTE_LIMITS.exportMaxRows rows match (database too_many_rows, rowCount =
   * the count) or the API cut the answer (fewer rows than total_count; rowCount null). HTTP 422.
   */
  | { code: "export_too_large"; rowCount: number | null }
  /** Upload refused by the bucket policy after the server's own checks: the 10-per-24-hours cap. HTTP 429. */
  | { code: "upload_limit"; limit: number };

export type MinuteErrorCode = MinuteError["code"];

export type MinuteResult<T> = { ok: true; data: T } | { ok: false; error: MinuteError };

/** JSON body of every non-2xx answer from the export and upload route handlers. */
export type MinuteErrorBody = { error: MinuteError };

/**
 * Database hint -> error code. Hints not listed here (and any error without a hint, network failures,
 * unexpected shapes) answer `unavailable` (fail closed). Guard hints that fire only on a bug
 * (immutable_column, export_log_direct_insert, append_only) are deliberately `unavailable` too.
 * Look up with Object.hasOwn (a hint like "constructor" must not resolve through the prototype).
 */
export const MINUTE_DB_HINTS: Record<string, MinuteErrorCode> = {
  // 42501
  permission_required: "forbidden",
  not_active_member: "forbidden",
  unit_not_allowed: "unit_not_allowed",
  closed_period: "closed_period",
  immutable_column: "unavailable",
  export_log_direct_insert: "unavailable",
  append_only: "unavailable",
  // P0002
  minute_not_found: "not_found",
  file_not_found: "not_found",
  // P0001
  no_active_period: "no_active_period",
  state_changed: "state_changed",
  minute_voided: "minute_voided",
  file_missing: "file_missing",
  too_many_rows: "export_too_large",
  // 22023
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

function parseCount(detail: string | null | undefined): number | null {
  if (detail === null || detail === undefined || !/^\d{1,9}$/.test(detail)) return null;
  return Number(detail);
}

/**
 * The MinuteError for a database refusal, from its `hint` and `detail` only (the message is never read).
 * The picore layer calls it for every PostgREST error that carries a hint; no hint = unavailable.
 */
export function minuteErrorFromDb(hint: string | null | undefined, detail: string | null | undefined): MinuteError {
  const code = hint && Object.hasOwn(MINUTE_DB_HINTS, hint) ? MINUTE_DB_HINTS[hint] : "unavailable";
  const isPath = typeof detail === "string" && MINUTE_FILE_PATH_PATTERN.test(detail);
  const fieldOf = (): MinuteInputField => {
    if (hint && Object.hasOwn(MINUTE_DB_HINT_FIELDS, hint)) return MINUTE_DB_HINT_FIELDS[hint];
    if (detail && Object.hasOwn(MINUTE_DB_DETAIL_FIELDS, detail)) return MINUTE_DB_DETAIL_FIELDS[detail];
    return isPath ? "files" : "request";
  };
  switch (code) {
    case "not_found":
      return { code, entity: hint === "file_not_found" ? "file" : "minute" };
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "date_required":
    case "date_in_future":
    case "invalid_dates":
      return { code, field: fieldOf() };
    case "invalid_unit":
      return { code, field: "unitId" };
    case "invalid_file":
    case "file_already_attached":
    case "file_missing":
      return { code, field: "files", ref: isPath ? (detail as string) : null };
    case "file_too_large":
      return { code, field: "files", ref: isPath ? (detail as string) : null, maxMb: MINUTE_FILE_MAX_MB };
    case "file_required":
    case "file_count":
      return { code, field: "files", count: parseCount(detail) };
    case "export_too_large":
      return { code, rowCount: parseCount(detail) };
    case "upload_limit":
      return { code, limit: MINUTE_LIMITS.unattachedUploadsPer24h };
    case "unit_required":
      return { code, field: "unitId" };
    default:
      return { code };
  }
}

/** Zod messages that are not error codes themselves (paging and search answer invalid_input). */
const ZOD_MESSAGE_ALIASES: Record<string, MinuteErrorCode> = {
  invalid_page: "invalid_input",
  invalid_page_size: "invalid_input",
  search_too_long: "invalid_input",
};

/** The field of an issue: the deepest known key of its path (filters.search -> search; files.0.path -> files). */
function fieldOfPath(path: readonly PropertyKey[]): MinuteInputField {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const key = path[i];
    if (typeof key === "string" && MINUTE_INPUT_FIELDS.has(key)) return key as MinuteInputField;
  }
  return "request";
}

/**
 * The MinuteError for a failed safeParse of any schema in this file: the FIRST issue. A message that is
 * a known code keeps it (payloads: count = the list bound, maxMb = 5, ref null); any other message
 * (zod's own, e.g. a failed discriminated union) is invalid_input for that field.
 */
export function minuteErrorFromZod(error: z.ZodError): MinuteError {
  const issue = error.issues[0];
  if (issue === undefined) return { code: "invalid_input", field: "request" };
  const field = fieldOfPath(issue.path);
  const message = Object.hasOwn(ZOD_MESSAGE_ALIASES, issue.message) ? ZOD_MESSAGE_ALIASES[issue.message] : issue.message;
  switch (message) {
    case "unit_required":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "date_required":
    case "invalid_dates":
      return { code: message, field };
    case "invalid_file":
      return { code: message, field, ref: null };
    case "file_too_large":
      return { code: message, field, ref: null, maxMb: MINUTE_FILE_MAX_MB };
    case "file_required":
      return { code: message, field, count: 1 };
    case "file_count":
      return { code: message, field, count: MINUTE_LIMITS.filesPerMinute };
    default:
      return { code: "invalid_input", field };
  }
}

/** HTTP status for the route handlers (see MinuteError). */
export function minuteErrorStatus(error: MinuteError): number {
  switch (error.code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
    case "unit_not_allowed":
    case "closed_period":
      return 403;
    case "not_found":
      return 404;
    case "invalid_input":
    case "unit_required":
    case "invalid_unit":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "date_required":
    case "date_in_future":
    case "invalid_dates":
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
    default:
      return 409;
  }
}

// ---- Indonesian copy of the errors ----

/** Generic texts reused by several codes. */
const COPY_UNAVAILABLE = "Terjadi gangguan. Coba lagi."; // spec 3 states, 7 screen 1
const COPY_STATE_CHANGED = "Data sudah berubah. Muat ulang."; // spec 3 F4, R11
const COPY_NO_PERIOD = "Belum ada periode aktif. Notulensi belum bisa dicatat."; // spec 3 F3, 7 screen 1
const COPY_UPLOAD_FAILED = "Berkas gagal diunggah. Coba lagi."; // spec 3 states
const COPY_FILE_OPEN_FAILED = "Berkas tidak bisa dibuka. Coba lagi."; // gap: Letters design 6.3
const COPY_FILE_NOT_FOUND = "Berkas tidak ditemukan. Muat ulang halaman."; // gap: Letters (owner)
/** Spec 7 screen 3. {n} = the field's limit. */
const COPY_TOO_LONG = "Terlalu panjang (maksimal {n} karakter).";

/**
 * Indonesian copy per error code: from the spec (section numbers in the comments) or a gap text (listed
 * in the README). `null` = PER FIELD or PER ACTION: use minuteErrorMessage().
 */
export const MINUTE_ERROR_COPY: Record<MinuteErrorCode, string | null> = {
  unauthenticated: null, // no text: redirect to /login?reason=session_ended (auth-login F9)
  forbidden: "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", // spec 3 states ("Aksesmu sudah berubah..."), full text as Letters
  unavailable: COPY_UNAVAILABLE, // spec 3 states; action variants below
  unit_not_allowed: "Kamu tidak bisa mencatat notulensi untuk unit ini.", // spec 7 screen 3
  closed_period: "Notulensi periode lama hanya bisa dibaca.", // spec 7 screen 2
  invalid_input: null, // PER FIELD: search, export; else generic
  unit_required: "Pilih unit.", // gap
  invalid_unit: "Unit ini tidak bisa dipilih. Muat ulang halaman.", // gap
  text_required: null, // PER FIELD: spec 7 screen 3
  text_too_long: COPY_TOO_LONG, // spec 7 screen 3 ({n} per field)
  reason_required: null, // PER ACTION: void (spec 7 screen 5), withdraw (gap)
  date_required: "Isi tanggal rapat.", // spec 7 screen 3 (the only date field)
  date_in_future: "Tanggal rapat tidak boleh di masa depan.", // spec 7 screen 3
  invalid_dates: "Tanggal rapat tidak valid.", // gap (a date picker prevents it; before 2000)
  invalid_file: "Hanya PDF, JPG, atau PNG.", // spec 7 screen 3 (a bad saved path: generic, variant)
  file_too_large: "Berkas terlalu besar (maksimal 4 MB).", // spec 7 screen 3
  file_required: "Pilih minimal satu berkas.", // gap ("Tambah lampiran" with none)
  file_count: "Maksimal 3 berkas.", // spec 7 screen 3
  file_already_attached: "Berkas ini sudah terpasang. Pilih berkas lain.", // gap: Letters (owner)
  file_missing: COPY_UPLOAD_FAILED, // spec 3 states
  not_found: "Notulensi ini tidak ditemukan.", // gap; file: variants
  no_active_period: COPY_NO_PERIOD, // spec 3 F3
  state_changed: COPY_STATE_CHANGED, // spec 3 F4
  minute_voided: "Notulensi yang dibatalkan tidak bisa diubah.", // gap (buttons are absent then; a race)
  export_too_large: "Terlalu banyak data untuk satu file. Persempit dengan filter periode atau unit.", // spec 7 screen 7
  upload_limit: "Terlalu banyak unggahan dalam 24 jam. Coba lagi nanti.", // gap: Letters design 3.3
};

/** Action variants of the codes whose text depends on what the person was doing. */
export const MINUTE_ERROR_COPY_VARIANTS = {
  notFound: {
    minute: "Notulensi ini tidak ditemukan.", // gap
    /** "Lihat" on a file that is gone or no longer readable. */
    fileOpen: COPY_FILE_OPEN_FAILED,
    /** A file id that no longer matches (e.g. "Tarik berkas" on a stale page). */
    file: COPY_FILE_NOT_FOUND,
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
    void: "Tulis alasan pembatalan.", // spec 7 screen 5
    withdrawFile: "Tulis kenapa berkas ini ditarik.", // gap: Letters design 8.2
  },
  /** A malformed saved path: the browser built it, so it is a bug. */
  invalidFileSaved: COPY_UNAVAILABLE,
} as const;

/** Per-field texts of the record and edit forms (spec 7 screen 3). */
export const MINUTE_FIELD_ERROR_COPY: Partial<Record<MinuteInputField, Partial<Record<"text_required", string>>>> = {
  title: { text_required: "Judul wajib diisi." },
  topic: { text_required: "Topik wajib diisi." },
  content: { text_required: "Isi notulensi wajib diisi." },
};

/** The action that produced an error; picks the copy variant. */
export type MinuteAction =
  | "read"
  | "export"
  | "openFile"
  | "upload"
  | "record"
  | "edit"
  | "addFiles"
  | "withdrawFile"
  | "void";

/** Character limit per field, for "{n}". */
const FIELD_MAX: Partial<Record<MinuteInputField, number>> = {
  title: MINUTE_LIMITS.title,
  topic: MINUTE_LIMITS.topic,
  content: MINUTE_LIMITS.content,
  decision: MINUTE_LIMITS.decision,
  reason: MINUTE_LIMITS.reason,
  search: MINUTE_SEARCH_MAX_LENGTH,
};

/** The text to show for an error, or null only for `unauthenticated` (redirect to login). Never throws. */
export function minuteErrorMessage(error: MinuteError, action: MinuteAction): string | null {
  const v = MINUTE_ERROR_COPY_VARIANTS;
  switch (error.code) {
    case "unauthenticated":
      return null;
    case "not_found":
      if (error.entity === "file") return action === "openFile" ? v.notFound.fileOpen : v.notFound.file;
      return v.notFound.minute;
    case "unavailable":
      if (action === "openFile") return v.unavailable.openFile;
      if (action === "upload") return v.unavailable.upload;
      return COPY_UNAVAILABLE;
    case "invalid_file":
      return action === "upload" ? (MINUTE_ERROR_COPY.invalid_file ?? COPY_UNAVAILABLE) : v.invalidFileSaved;
    case "invalid_input":
      if (error.field === "search") return v.invalidInput.search;
      if (action === "export") return v.invalidInput.export;
      return COPY_UNAVAILABLE; // the screens never send a malformed id, page or filter
    case "reason_required":
      if (action === "void") return v.reasonRequired.void;
      if (action === "withdrawFile") return v.reasonRequired.withdrawFile;
      return COPY_UNAVAILABLE;
    case "text_required":
      return MINUTE_FIELD_ERROR_COPY[error.field]?.text_required ?? COPY_UNAVAILABLE;
    case "text_too_long": {
      const max = FIELD_MAX[error.field];
      return max === undefined ? COPY_UNAVAILABLE : formatMinuteCopy(COPY_TOO_LONG, { n: max });
    }
    default:
      return MINUTE_ERROR_COPY[error.code] ?? COPY_UNAVAILABLE;
  }
}


/** Fills "{n}", "{nama}", ... in a copy string. Unknown placeholders stay as they are. */
export function formatMinuteCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
}

// =============================================================================================
// 9. Screen copy and labels (stored value -> Indonesian), shared by the screens and the export files.
//    Word for word from spec section 7 ("7.n" = screen n) unless marked "gap" (README lists them).
// =============================================================================================

export const MINUTE_STATUS_LABEL: Record<MinuteStatus, string> = { active: "Aktif", voided: "Dibatalkan" };
export const MINUTE_STATUS_FILTER_LABEL: Record<MinuteStatusFilter, string> = {
  active: "Aktif",
  voided: "Dibatalkan",
  all: "Semua",
};
export const MINUTE_PERIOD_FILTER_LABEL: Record<MinutePeriodFilter, string> = {
  active: "Periode aktif",
  all: "Semua periode",
};
export const MINUTE_EXPORT_FORMAT_LABEL: Record<MinuteExportFormat, string> = { xlsx: "Excel", csv: "CSV", pdf: "PDF" };

/** Detail and history field names (7.2, 7.3). */
export const MINUTE_FIELD_LABEL: Record<MinuteEditableField, string> = {
  meetingDate: "Tanggal rapat",
  title: "Judul rapat",
  topic: "Topik bahasan",
  content: "Isi notulensi",
  decision: "Keputusan dan tindak lanjut",
};

/** "Riwayat" lines (7.2). {nama} = actorName. Second line of file rows: the file name; of withdraw/void: "Alasan: {alasan}". */
export const MINUTE_HISTORY_LABEL: Record<MinuteHistoryKind, string> = {
  recorded: "Dicatat oleh {nama}", // 7.2
  edited: "Diubah oleh {nama}", // 7.2 (tap for before and after)
  file_added: "Lampiran ditambahkan oleh {nama}", // gap
  file_withdrawn: "Lampiran ditarik oleh {nama}", // gap
  voided: "Dibatalkan oleh {nama}", // 7.2
};

/** Screen copy (spec section 7). Placeholders are filled with formatMinuteCopy(). */
export const MINUTE_COPY = {
  moduleTitle: "Notulensi Rapat", // A-MN14 (drawer and H1)
  /** The root unit's name on screens and exports (N2 c). */
  wholeOrganization: "Seluruh organisasi",
  /** A unit id that no longer exists in PI-CORE (R8). */
  unknownUnit: "Unit tidak ditemukan", // gap
  unavailable: COPY_UNAVAILABLE,
  stateChanged: COPY_STATE_CHANGED,
  noActivePeriod: COPY_NO_PERIOD, // 7.1 banner (managers)

  // Screen 1, list
  list: {
    periodLine: "Periode {label}",
    tileCount: "Notulensi periode ini",
    tileLatest: "Rapat terakhir",
    tileNoDate: "-",
    searchPlaceholder: "Cari judul, topik, atau isi...",
    filterButton: "Filter",
    filterUnit: "Unit",
    filterUnitAll: "Semua unit", // gap
    filterPeriod: "Periode",
    filterStatus: "Status",
    filterReset: "Reset",
    recordButton: "Catat notulensi",
    exportButton: "Ekspor",
    /** Table from 1024 px. */
    columns: { date: "Tanggal", unit: "Unit", title: "Judul", topic: "Topik", files: "Berkas" },
    /** Card line "17 Okt 2026 · Departemen Internal". */
    cardMeta: "{tanggal} · {unit}",
    fileCount: "{n} berkas",
    empty: "Belum ada notulensi.",
    emptyManager: "Catat notulensi pertama lewat tombol di atas.",
    noMatch: "Tidak ada hasil. Ubah pencarian atau filter.",
    error: COPY_UNAVAILABLE,
  },

  // Screen 2, detail
  detail: {
    back: "Kembali ke daftar",
    title: "Detail Notulensi",
    meetingCard: "Data Pertemuan",
    meetingDate: "Tanggal rapat",
    unit: "Unit",
    period: "Periode",
    recordedBy: "Dicatat oleh {nama}, {tanggal}",
    topic: "Topik bahasan",
    content: "Isi notulensi",
    decision: "Keputusan dan tindak lanjut",
    noDecision: "Tidak ada keputusan yang dicatat.",
    filesCard: "Lampiran",
    viewFile: "Lihat",
    noFiles: "Tidak ada lampiran.",
    withdrawnChip: "Ditarik", // gap: Letters chip
    historyCard: "Riwayat",
    /** Second line of an edited entry: '{isian}: "{lama}" menjadi "{baru}"' (Letters design 6.3). */
    historyChange: '{isian}: "{lama}" menjadi "{baru}"', // gap: Letters
    /** An empty before/after value (decision added or cleared). */
    historyEmptyValue: "kosong", // gap
    historyReason: "Alasan: {alasan}", // 7.2 void block wording
    voidBlock: "Dibatalkan oleh {nama} pada {tanggal}. Alasan: {alasan}",
    oldPeriod: "Notulensi periode lama hanya bisa dibaca.",
    edit: "Ubah",
    addFiles: "Tambah lampiran",
    void: "Batalkan notulensi",
    export: "Ekspor",
    exportIntro: "Unduh notulensi ini sebagai:",
    voidedChip: "Dibatalkan",
  },

  // Screens 3 and 4, record and edit forms
  form: {
    back: "Kembali ke daftar",
    recordTitle: "Catat Notulensi",
    editTitle: "Ubah Notulensi",
    subtitle: "Catatan rapat dan keputusannya.",
    meetingCard: "Data Pertemuan",
    unit: "Unit",
    unitHint: "Sesuai jabatanmu.",
    meetingDate: "Tanggal Rapat",
    /** Soft warning, no block (R9). {periode} = period label. */
    outsidePeriod: "Tanggal ini di luar masa periode {periode}. Notulensi tetap bisa disimpan.", // gap
    title: "Judul Rapat",
    titlePlaceholder: "Contoh: Rapat evaluasi bulanan",
    topic: "Topik Bahasan",
    topicPlaceholder: "Pokok bahasan rapat",
    resultCard: "Risalah & Hasil Rapat",
    content: "Isi Notulensi",
    contentPlaceholder: "Tuliskan poin pembahasan dan catatan penting...",
    decision: "Keputusan & Tindak Lanjut (boleh kosong)",
    filesCard: "Lampiran",
    filePicker: "Ketuk untuk memilih berkas",
    fileHelp: "PDF, JPG, atau PNG. Maksimal 4 MB, sampai 3 berkas.",
    fileRemove: "Hapus",
    submitRecord: "Simpan Notulensi",
    submitEdit: "Simpan Perubahan",
    cancel: "Batal",
    unchanged: "Belum ada yang diubah.", // gap: Letters G3
    leaveTitle: "Keluar dari halaman ini?",
    leaveBody: "Perubahan belum disimpan.",
    leaveStay: "Tetap di sini",
    leaveGo: "Keluar",
  },

  // "Tambah lampiran" sheet (F5; no screen in the spec)
  addFiles: {
    title: "Tambah lampiran", // 7.2 button text
    room: "Boleh menambah {n} berkas lagi.", // gap: Letters
    submit: "Simpan lampiran", // gap
  },

  // Screen 5, void dialog
  voidDialog: {
    title: "Batalkan notulensi?",
    body: "Notulensi tetap tersimpan sebagai Dibatalkan, tidak bisa diubah, dan tidak bisa dikembalikan.",
    reason: "Alasan pembatalan",
    confirm: "Ya, batalkan",
    back: "Kembali",
  },

  // Screen 6, withdraw-file dialog
  withdrawDialog: {
    title: "Tarik berkas?",
    body: "Berkas disembunyikan dari pembaca dan hanya terlihat oleh pengelola. Berkasnya tidak dihapus.",
    reason: "Alasan",
    confirm: "Tarik berkas",
    back: "Kembali",
  },

  // Screen 7, export menu
  export: {
    listIntro: "Unduh semua hasil filter sebagai:",
    singleIntro: "Unduh notulensi ini sebagai:",
    busy: "Menyiapkan file...",
    done: "Unduhan dimulai: {file}",
    tooMany: "Terlalu banyak data untuk satu file. Persempit dengan filter periode atau unit.",
  },

  // Screen 8, Dashboard card (layout belongs to the Dashboard module)
  dashboard: {
    title: "Notulensi Rapat",
    count: "{n} notulensi di periode {label}",
    latest: "Rapat terakhir {tanggal}",
    link: "Buka notulensi",
    empty: "Belum ada notulensi di periode ini.",
    error: "Data notulensi belum bisa dimuat.",
    retry: "Coba lagi",
  },
} as const;

/** One-time success notices (?notice=...). */
export const MINUTE_NOTICES = ["recorded", "updated", "voided", "files_added", "file_withdrawn"] as const;
export type MinuteNotice = (typeof MINUTE_NOTICES)[number];
export const MINUTE_NOTICE_COPY: Record<MinuteNotice, string> = {
  recorded: "Notulensi tersimpan.", // 7.3
  updated: "Perubahan tersimpan.", // 7.4
  voided: "Notulensi dibatalkan.", // gap
  files_added: "Lampiran ditambahkan.", // gap
  file_withdrawn: "Berkas ditarik.", // gap
};

/**
 * Export columns (spec 8: meeting date, unit, title, topic, content, decision, status with void reason,
 * period, recorded by, recorded at, file count), in file order. Headers reuse the detail labels and the
 * Letters export words (gap: listed in the README).
 */
export const MINUTE_EXPORT_COLUMNS = [
  { key: "rowNo", header: "No" },
  { key: "meetingDate", header: "Tanggal rapat" },
  { key: "unit", header: "Unit" },
  { key: "title", header: "Judul rapat" },
  { key: "topic", header: "Topik bahasan" },
  { key: "content", header: "Isi notulensi" },
  { key: "decision", header: "Keputusan dan tindak lanjut" },
  { key: "status", header: "Status" },
  { key: "voidReason", header: "Alasan pembatalan" },
  { key: "period", header: "Periode" },
  { key: "createdBy", header: "Dicatat oleh" },
  { key: "createdAt", header: "Waktu dicatat" },
  { key: "fileCount", header: "Jumlah berkas" },
] as const;

// =============================================================================================
// 10. Pure helpers (screen, server and export agree)
// =============================================================================================

/** Today's calendar date in Asia/Jakarta (R14) as "YYYY-MM-DD". */
export function jakartaToday(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The unit as people read it: the root is "Seluruh organisasi" (N2 c), a vanished unit "Unit tidak
 * ditemukan" (R8), anything else its live PI-CORE name.
 */
export function minuteUnitLabel(unit: { unitName: string | null; unitType: MinuteUnitType | null }): string {
  if (unit.unitType === "organization") return MINUTE_COPY.wholeOrganization;
  return unit.unitName ?? MINUTE_COPY.unknownUnit;
}

/** Units for the "Unit" filter (F1). Offer the filter only when this returns more than one (MN-22). */
export function readableMinuteUnits(options: readonly MinuteUnitOption[]): MinuteUnitOption[] {
  return options.filter((o) => o.canRead);
}

/** Units for the record form's select. One = a read-only line with "Sesuai jabatanmu."; none = no form. */
export function recordableMinuteUnits(options: readonly MinuteUnitOption[]): MinuteUnitOption[] {
  return options.filter((o) => o.canRecord);
}

/**
 * R9 soft warning: the meeting date lies outside the active period's dates (informational in PI-CORE).
 * Missing period dates = no warning.
 */
export function isOutsideMinutePeriod(meetingDate: IsoDate, startsOn: IsoDate | null, endsOn: IsoDate | null): boolean {
  if (!isValidMinuteDate(meetingDate)) return false;
  return (startsOn !== null && meetingDate < startsOn) || (endsOn !== null && meetingDate > endsOn);
}

/**
 * Export file name (gap, same shape as the other modules): list "notulensi-YYYY-MM-DD.xlsx" (Jakarta
 * export date); single minute "notulensi-rapat-<meeting date>.pdf".
 */
export function minuteExportFileName(
  target: { kind: "list" } | { kind: "single"; meetingDate: IsoDate },
  format: MinuteExportFormat,
  now: Date = new Date(),
): string {
  return target.kind === "list" ? `notulensi-${jakartaToday(now)}.${format}` : `notulensi-rapat-${target.meetingDate}.${format}`;
}

// =============================================================================================
// 11. Capabilities (menus and buttons only; every server entry point and the database check again)
// =============================================================================================

/**
 * Where a minutes key applies. Minutes is the only module with unit scopes (access control 2.1, D-008):
 * "all" = every unit (BPH D04/D05, BPH secretaries D17/D20/D23); "units" = the units of the matching
 * assignments (secretaries D26/D27, Kepala Departemen and Kepala Biro D37). Several assignments are
 * already combined by my_permissions() (E9): one grant per key, "all" wins over units.
 */
export type MinuteScope = { kind: "none" } | { kind: "all" } | { kind: "units"; unitIds: readonly string[] };

const NO_SCOPE: MinuteScope = { kind: "none" };

function scopeOf(grants: readonly PermissionGrant[], key: string): MinuteScope {
  // Defensive union: my_permissions() returns one row per key, but two rows must still combine.
  let units: string[] = [];
  for (const grant of grants) {
    if (grant.key !== key) continue;
    if (grant.scope === "all") return { kind: "all" };
    units = units.concat(grant.unitIds.map((id) => id.toLowerCase()));
  }
  const unique = [...new Set(units)].sort();
  return unique.length === 0 ? NO_SCOPE : { kind: "units", unitIds: unique };
}

/** True when the scope covers this unit. */
export function minuteScopeIncludes(scope: MinuteScope, unitId: string): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "none") return false;
  return scope.unitIds.includes(unitId.toLowerCase());
}

/** Export only where view also holds (R15). The engine already gates it; this keeps the UI honest too. */
function intersect(a: MinuteScope, b: MinuteScope): MinuteScope {
  if (a.kind === "none" || b.kind === "none") return NO_SCOPE;
  if (a.kind === "all") return b;
  if (b.kind === "all") return a;
  const units = a.unitIds.filter((id) => b.unitIds.includes(id));
  return units.length === 0 ? NO_SCOPE : { kind: "units", unitIds: units };
}

export type MinuteCapabilities = {
  /** minutes.view (manage includes it): the list, details, attachments, tiles, drawer item, Dashboard card. */
  view: MinuteScope;
  /** minutes.manage: record, edit, void, add and withdraw attachments (per minute: detail.actions). */
  manage: MinuteScope;
  /** minutes.export, limited to where view holds. Per minute: detail.actions.canExport. */
  export: MinuteScope;
  canView: boolean;
  /** Has minutes.manage somewhere (unit options and detail actions say where). */
  canManage: boolean;
  /** canManage AND an active period: "Catat notulensi". */
  canRecord: boolean;
  /** "Ekspor" on the list. */
  canExport: boolean;
  /** Only minutes.manage holders may upload (database M4), and only with an active period. */
  canUploadFiles: boolean;
  /** false = the "Belum ada periode aktif..." banner for managers. */
  hasActivePeriod: boolean;
};

const NO_MINUTE_CAPABILITIES: MinuteCapabilities = {
  view: NO_SCOPE,
  manage: NO_SCOPE,
  export: NO_SCOPE,
  canView: false,
  canManage: false,
  canRecord: false,
  canExport: false,
  canUploadFiles: false,
  hasActivePeriod: false,
};

/**
 * Derives the capabilities from the session state. my_permissions() already returns the union of all
 * active-period assignments with implied keys (minutes.manage -> minutes.view, per unit) and export gated
 * on view per unit (R15). Without an active period rule-based keys match nothing (R11). Being System
 * Admin gives no minutes right (B18).
 */
export function minuteCapabilities(state: AccessState): MinuteCapabilities {
  if (state.kind !== "member") return NO_MINUTE_CAPABILITIES;
  const view = scopeOf(state.permissions, "minutes.view");
  const manage = scopeOf(state.permissions, "minutes.manage");
  const exportScope = intersect(scopeOf(state.permissions, "minutes.export"), view);
  const hasActivePeriod = state.member.activePeriodId !== null;
  const canManage = manage.kind !== "none";
  return {
    view,
    manage,
    export: exportScope,
    canView: view.kind !== "none",
    canManage,
    canRecord: canManage && hasActivePeriod,
    canExport: exportScope.kind !== "none",
    canUploadFiles: canManage && hasActivePeriod,
    hasActivePeriod,
  };
}

/*
 * =============================================================================================
 * 12. Functions the backend will provide (signatures are part of this contract). All server only.
 *     Each one: session + capability check first (getAccessState), zod validation, then ONE call to the
 *     nexus RPC with the USER's client (the database checks again). Never throws; returns
 *     MinuteResult<T>. Write functions are Server Actions ("use server"). The RPC wrappers and every
 *     Storage call live in src/lib/picore/minutes.ts (the functions read PI-CORE names, units, periods
 *     and assignments; CLAUDE.md 4). Database errors map ONLY through minuteErrorFromDb(); zod failures
 *     through minuteErrorFromZod().
 *     A malformed id given as a page address answers not_found "minute".
 *     Paged reads map total_count/page/page_size to MinutePaged (0 rows: total 0, page 1, pageCount 1).
 * =============================================================================================
 *
 * src/modules/minutes/server/minutes.ts                                     (reads; canView)
 *   listMinutes(input?: MinuteListQueryInput): Promise<MinuteResult<MinutePage>>             minute_list
 *   listMinuteUnits(): Promise<MinuteResult<MinuteUnitOption[]>>                             minute_unit_options
 *     Unit filter (readableMinuteUnits) and the record form's select (recordableMinuteUnits).
 *   getMinuteDetail(minuteId: string): Promise<MinuteResult<MinuteDetail>>                    minute_detail
 *     The JSON's storage_path stays inside the server (getMinuteFileLink); it is not in MinuteFile.
 *   getMinuteDashboardCounts(): Promise<MinuteResult<MinuteDashboardCounts>>                  minute_dashboard_counts
 *     Header tiles, the R9 period dates for the form, and the Dashboard card.
 *
 * src/modules/minutes/server/actions.ts                                      ("use server"; canManage)
 *   recordMinute(input: MinuteRecordInput): Promise<MinuteResult<MinuteRecordResult>>        minute_record
 *     (canRecord). Server pre-checks: meetingDate not after jakartaToday() (date_in_future, field
 *     meetingDate); minuteScopeIncludes(manage, unitId) (else unit_not_allowed). Sends files as
 *     [{ path, name }] (p_files jsonb), decision null when blank.
 *   updateMinute(input: MinuteUpdateInput): Promise<MinuteResult<MinuteUpdateResult>>        minute_update
 *     Same date check.
 *   addMinuteFiles(input: MinuteAddFilesInput): Promise<MinuteResult<MinuteFilesResult>>     minute_add_files
 *   withdrawMinuteFile(input: MinuteWithdrawFileInput): Promise<MinuteResult<MinuteFilesResult>> minute_withdraw_file
 *   voidMinute(input: MinuteVoidInput): Promise<MinuteResult<MinuteVoidResult>>              minute_void
 *
 * src/modules/minutes/server/file-actions.ts                                ("use server"; canView)
 *   getMinuteFileLink(input: MinuteFileLinkInput): Promise<MinuteResult<MinuteFileLink>>
 *     Pressed "Lihat" (the link is made at the press, so it never expires under an open page). Reads
 *     minute_detail, finds the file among the files the database returned to THIS caller (absent =
 *     not_found "file"), signs its path for MINUTE_FILE_SIGNED_URL_TTL_SECONDS with the USER's client
 *     (bucket policy minute_file_can_read checks again; a refusal = not_found "file").
 *
 * src/app/(app)/notulensi/actions.ts: thin "use server" wrappers with the names above, each calls
 *   getAccessState() first (static rule AUTH-42), then the module function. Also loadMinuteUnits for
 *   Client Components.
 *
 * POST MINUTE_ROUTES.fileUpload = /api/minutes/files   (multipart: MINUTE_FILE_UPLOAD_FIELDS; canUploadFiles)
 *   Same-origin check (else 403); session (401; no_access/error as 403/503); minutes.manage in any scope
 *   (else forbidden 403, database M4); active period (else no_active_period 409); body capped near
 *   MINUTE_FILE_MAX_BYTES (over: file_too_large 413, field "file", ref null, maxMb 4); declared type and
 *   size (minuteUploadFileSchema) AND sniffMinuteFileType(first bytes) equal to the declared type (else
 *   invalid_file 400, field "file"); then uploads with the USER's client to MINUTE_FILE_BUCKET at
 *   minuteFilePath(session member id, randomUUID(), type), contentType = the type, no overwrite. A
 *   Storage refusal after these checks (policy: 10 unattached uploads in 24 hours) = upload_limit 429
 *   (limit 10); anything else = unavailable 503. 200: MinuteFileUploadResult (name =
 *   cleanMinuteFileName(file.name, type)). Every non-2xx: MinuteErrorBody. Cache-Control no-store.
 *   Other methods: 405.
 *
 * POST MINUTE_ROUTES.export = /api/minutes/export   (form/JSON: MinuteExportInput; canExport)
 *   Same-origin check, body cap, ONE call to minute_export (p_format, p_search, p_unit_id, p_period,
 *   p_status, p_minute_id; "single" sends only p_format and p_minute_id). The database refuses more than
 *   1000 matching rows (too_many_rows -> export_too_large 422 with rowCount) and writes the export-log
 *   row in the same transaction (no row, no file). The server then compares the rows received with
 *   total_count (readTotalCount/isCut of src/lib/supabase/limits.ts): a cut answer is export_too_large
 *   422 with rowCount null, no file. 200: the file, Cache-Control no-store, Content-Disposition
 *   attachment minuteExportFileName(...). Columns: MINUTE_EXPORT_COLUMNS; unit via minuteUnitLabel();
 *   status via MINUTE_STATUS_LABEL; dates and the header (period filter, export date) in WIB (A-MN16).
 *   PDF: each minute as its own block (title, meta, content, decision), not a table cell (spec 8).
 *   All user text escaped as plain text (R10, MN-16). 401/403/400/404/503: MinuteErrorBody. Other
 *   methods: 405.
 */
