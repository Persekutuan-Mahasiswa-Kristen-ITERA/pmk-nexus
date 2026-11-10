import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readTotalCount, type CountedRows } from "@/lib/supabase/limits";
import {
  LETTER_DB_DETAIL_FIELDS,
  LETTER_DB_HINTS,
  LETTER_FILE_BUCKET,
  LETTER_FILE_MAX_MB,
  LETTER_FILE_MIME_TYPES,
  LETTER_FILE_PATH_PATTERN,
  LETTER_LIMITS,
  letterHistoryKindSchema,
  letterRequestEventSchema,
  letterRequestStatusSchema,
  letterStatusSchema,
  letterTypeSchema,
  numberSeparatorSchema,
  type LetterDashboardCounts,
  type LetterDetail,
  type LetterEditableField,
  type LetterEntity,
  type LetterError,
  type LetterErrorCode,
  type LetterExportFormat,
  type LetterExportRow,
  type LetterFieldChange,
  type LetterFile,
  type LetterFileLink,
  type LetterFileMimeType,
  type LetterFileUploadResult,
  type LetterFilesResult,
  type LetterHistoryKind,
  type LetterInputField,
  type LetterListFilters,
  type LetterPage,
  type LetterPaged,
  type LetterQueueCounts,
  type LetterQueueFilters,
  type LetterQueuePage,
  type LetterRegisterResult,
  type LetterRequestCaps,
  type LetterRequestDetail,
  type LetterRequestTransitionResult,
  type LetterResult,
  type LetterTakeNumberResult,
  type LetterType,
  type LetterUpdateResult,
  type LetterVoidResult,
  type MyLetterRequestsFilter,
  type MyLetterRequestsPage,
  type NumberingChange,
  type NumberingFormatResult,
  type NumberingFormatValues,
  type NumberingHistoryPage,
  type NumberingSetNextResult,
  type NumberingSettings,
} from "@/modules/letters/types";

// Thin typed wrappers around the Letters RPCs (supabase/migrations/20261110100000_nexus_letters.sql,
// reference supabase/README.md section 3.2). These nexus functions check PI-CORE assignments
// (has_permission), read PI-CORE member names and period labels, so they are called from here and
// nowhere else (CLAUDE.md 4). The letter-file bucket is here too: its Storage policies run the same
// PI-CORE-backed checks (letter_file_can_upload / _can_read), and every `.from(` stays in this layer.
//
// Always with the USER's session client: the database checks the caller again inside every function.
// Inputs must already be validated by the caller (src/modules/letters/server). Answers are validated
// with zod; only the contract's fields survive (z.object strips anything else, so requester member ids
// and storage paths never reach the UI). Nothing here throws.
// Only src/modules/letters/server/ may import this file.

// =============================================================================================
// Error mapping (contract section 8)
// =============================================================================================

const UNAVAILABLE: LetterError = { code: "unavailable" };

/** SQLSTATEs the module raises on purpose. Anything else (also with a known hint) is unavailable. */
const KNOWN_SQLSTATES: ReadonlySet<string> = new Set(["42501", "P0001", "P0002", "22023", "23505"]);

const NOT_FOUND_ENTITY: Record<string, LetterEntity> = {
  letter_not_found: "letter",
  request_not_found: "request",
  file_not_found: "file",
};

/** Hints that always name the same input (22023 without a field detail). */
const HINT_FIELDS: Record<string, LetterInputField> = {
  invalid_type: "type",
  invalid_status: "status",
  invalid_period: "period",
  invalid_year: "year",
  search_too_long: "search",
  invalid_page: "page",
  invalid_page_size: "pageSize",
  invalid_format: "format",
};

const FILE_CODES: ReadonlySet<LetterErrorCode> = new Set([
  "invalid_file",
  "file_already_attached",
  "file_missing",
  "file_too_large",
  "file_required",
  "file_count",
]);
const DATE_CODES: ReadonlySet<LetterErrorCode> = new Set(["date_required", "date_in_future", "date_in_past", "invalid_dates"]);

/** Per-call hints for the mapper. */
export type LetterErrorContext = {
  /** Field for input errors whose detail names nothing (e.g. "letterId"). */
  field?: LetterInputField;
  /** Field for date errors without a field detail ("to" for the queue range). */
  dateField?: LetterInputField;
  /** Field for invalid_view ("view" for the queue, "filter" for Permohonan Saya). */
  viewField?: LetterInputField;
};

function lookup<T>(table: Record<string, T>, key: string | null | undefined): T | undefined {
  // Own keys only: "constructor" / "toString" must not resolve through the prototype (BUG-MD-01).
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}

const hasControlChar = (text: string) => [...text].some((ch) => {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x20 || (c >= 0x7f && c <= 0x9f);
});
const asCount = (value: string | null) => (value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null);
/** Only a well-formed upload path is echoed (it is the caller's own upload; never a person). */
const asPath = (value: string | null) => (value !== null && LETTER_FILE_PATH_PATTERN.test(value) ? value : null);
/** A number text (format collision, duplicate "Nomor lama"): short, printable. */
const asNumberText = (value: string | null) =>
  value !== null && [...value].length <= LETTER_LIMITS.numberText && !hasControlChar(value) ? value : null;

/**
 * Builds the contract error for a code. `detail` is the database detail, or the value the zod mapper
 * passes (a file path, a count). Returns null for not_found (it needs the entity; only the database
 * mapper builds it), so the caller answers unavailable: fail closed, never a made-up payload.
 */
export function buildLetterError(code: LetterErrorCode, field: LetterInputField, detail: string | null): LetterError | null {
  switch (code) {
    case "unauthenticated":
    case "forbidden":
    case "unavailable":
    case "self_processing_blocked":
    case "closed_period":
    case "no_active_period":
    case "state_changed":
    case "letter_voided":
    case "request_open":
    case "number_not_taken":
    case "last_issued_file":
    case "export_too_large":
      return { code };
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "note_required":
    case "date_required":
    case "date_in_future":
    case "date_in_past":
    case "invalid_dates":
    case "invalid_number_format":
      return { code, field };
    case "invalid_file":
    case "file_already_attached":
    case "file_missing":
      return { code, field, ref: asPath(detail) };
    case "file_too_large":
      return { code, field, ref: asPath(detail), maxMb: LETTER_FILE_MAX_MB };
    case "file_required":
    case "file_count":
      return { code, field, count: asCount(detail) };
    case "format_collision":
      return { code, numberText: asNumberText(detail) };
    case "duplicate_number":
      return { code, numberText: asNumberText(detail) };
    case "year_not_current":
      return { code, currentYear: asCount(detail) };
    case "sequence_not_higher":
      return { code, lastUsed: asCount(detail) };
    case "too_many_open_requests":
      return { code, limit: asCount(detail) ?? LETTER_LIMITS.openRequestsPerMember };
    case "daily_request_limit":
      return { code, limit: asCount(detail) ?? LETTER_LIMITS.requestsPerDay };
    case "upload_limit":
      return { code, limit: LETTER_LIMITS.unattachedUploadsPer24h };
    case "not_found":
      return null;
  }
}

type PostgrestLikeError = { code?: string; hint?: string | null; details?: string | null };

/**
 * Maps a database error to the contract's error union, ONLY through LETTER_DB_HINTS. An unknown hint,
 * a missing hint, an unexpected SQLSTATE (network, `nexus` not exposed, missing grant, 5xx) or a hint
 * the contract marks as a bug (immutable_column, numbering_exhausted, year_required, ...) is
 * `unavailable`: fail closed, never read as "no access" and never as "no rows".
 */
export function mapLetterDbError(error: PostgrestLikeError, ctx: LetterErrorContext = {}): LetterError {
  const code = lookup(LETTER_DB_HINTS, error.hint);
  if (code === undefined || code === "unavailable") return UNAVAILABLE;
  if (typeof error.code !== "string" || !KNOWN_SQLSTATES.has(error.code)) return UNAVAILABLE;
  const detail = typeof error.details === "string" && error.details !== "" ? error.details : null;

  if (code === "not_found") {
    const entity = lookup(NOT_FOUND_ENTITY, error.hint);
    return entity === undefined ? UNAVAILABLE : { code, entity };
  }

  const field =
    (error.hint === "invalid_view" ? ctx.viewField ?? "view" : undefined) ??
    lookup(HINT_FIELDS, error.hint) ??
    lookup(LETTER_DB_DETAIL_FIELDS, detail) ??
    (FILE_CODES.has(code) ? "files" : undefined) ??
    (DATE_CODES.has(code) ? ctx.dateField : undefined) ??
    ctx.field ??
    "request";
  return buildLetterError(code, field, detail) ?? UNAVAILABLE;
}

// =============================================================================================
// RPC call
// =============================================================================================

type LetterRpc =
  | "letter_list"
  | "letter_year_list"
  | "letter_detail"
  | "letter_dashboard_counts"
  | "letter_register"
  | "letter_update"
  | "letter_add_files"
  | "letter_withdraw_file"
  | "letter_void"
  | "letter_my_requests"
  | "letter_my_request_caps"
  | "letter_request_queue"
  | "letter_request_queue_counts"
  | "letter_request_detail"
  | "letter_request_create"
  | "letter_request_cancel"
  | "letter_request_process"
  | "letter_request_take_number"
  | "letter_request_issue"
  | "letter_request_reject"
  | "letter_numbering_settings"
  | "letter_numbering_history"
  | "letter_numbering_update_format"
  | "letter_numbering_set_next"
  | "letter_export";

type Failure = { ok: false; error: LetterError };

/** Calls one nexus RPC with the USER's client and validates the answer. Never throws. */
async function callRpc<T>(
  supabase: SupabaseClient,
  fn: LetterRpc,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
  ctx?: LetterErrorContext,
): Promise<LetterResult<T>> {
  try {
    const { data, error } = await supabase.schema("nexus").rpc(fn, args);
    if (error) {
      const mapped = mapLetterDbError(error, ctx);
      // Expected refusals are not logged as failures; everything else is, with the code only.
      if (mapped.code === "unavailable") logFailure(fn, `${error.code || "rpc_error"}/${error.hint || "-"}`);
      return { ok: false, error: mapped };
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) return fail(fn, "unexpected_shape");
    return { ok: true, data: parsed.data };
  } catch {
    return fail(fn, "exception");
  }
}

function fail(fn: string, reason: string): Failure {
  logFailure(fn, reason);
  return { ok: false, error: UNAVAILABLE };
}

function logFailure(fn: string, reason: string): void {
  // Function name and code only: never tokens, member ids, names, search text, paths or row data.
  console.error(`[picore] nexus.${fn}() failed: ${reason}`);
}

/** Exactly one row from a set-returning function (anything else is a bug: fail closed). */
function oneRow<T>(schema: z.ZodType<T>) {
  return z.array(schema).length(1).transform((rows) => rows[0]);
}

// =============================================================================================
// Row shapes (snake_case as returned; only these fields are read)
// =============================================================================================

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.guid(); // Postgres uuid text form; also accepts seeded non-RFC ids (as context.ts).
const count = z.number().int().nonnegative();
const int = z.number().int();
const version = z.number().int().positive();
const isoDate = z.string().regex(ISO_DATE_PATTERN);
const timestamp = z.string().min(1);
const text = z.string();
const optText = z.string().nullable();
const bool = z.boolean();
/** A jsonb object (history before/after); its keys are read one by one with type checks. */
const jsonObject = z.record(z.string(), z.unknown());

const pageColumns = { total_count: count, page: z.number().int().positive(), page_size: z.number().int().positive() };

const fileJson = z.object({
  file_id: z.number().int().positive(),
  // Kept for signing only; never mapped into a contract type. Not pattern-checked here so one odd
  // stored path cannot hide a whole detail page; the signer checks it.
  storage_path: z.string(),
  original_name: text,
  size_bytes: count.nullable(),
  mime_type: z.enum(LETTER_FILE_MIME_TYPES),
  attached_at: timestamp,
  attached_by_name: optText,
  is_withdrawn: bool,
  withdrawn_at: timestamp.nullable(),
  withdrawn_by_name: optText,
  withdraw_reason: optText,
});
type FileJson = z.infer<typeof fileJson>;

function toFile(f: FileJson): LetterFile {
  return {
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
  };
}

const letterRow = z.object({
  row_no: count,
  letter_id: uuid,
  letter_type: letterTypeSchema,
  number_text: text,
  is_legacy_number: bool,
  number_year: int.nullable(),
  letter_date: isoDate.nullable(),
  received_date: isoDate.nullable(),
  counterpart: text,
  counterpart_number: optText,
  subject: text,
  status: letterStatusSchema,
  period_id: uuid,
  period_label: optText,
  from_request: bool,
  awaiting_final_file: bool,
  file_count: count,
  created_at: timestamp,
  version,
  ...pageColumns,
});

const historyJson = z.object({
  history_id: z.number().int().positive(),
  at: timestamp,
  kind: letterHistoryKindSchema,
  actor_name: optText,
  before: jsonObject.nullable(),
  after: jsonObject.nullable(),
  note: optText,
  file_name: optText,
});

const letterDetailJson = z.object({
  letter_id: uuid,
  letter_type: letterTypeSchema,
  number_text: text,
  is_legacy_number: bool,
  number_year: int.nullable(),
  letter_date: isoDate.nullable(),
  received_date: isoDate.nullable(),
  counterpart: text,
  counterpart_number: optText,
  subject: text,
  notes: optText,
  status: letterStatusSchema,
  void_reason: optText,
  voided_at: timestamp.nullable(),
  voided_by_name: optText,
  period_id: uuid,
  period_label: optText,
  is_active_period: bool,
  created_at: timestamp,
  created_by_name: optText,
  updated_at: timestamp,
  updated_by_name: optText,
  version,
  from_request: bool,
  awaiting_final_file: bool,
  request: z
    .object({ request_id: uuid, subject: text, status: letterRequestStatusSchema, requester_name: optText })
    .nullable(),
  file_count: count,
  files: z.array(fileJson),
  history: z.array(historyJson),
  actions: z.object({
    can_edit: bool,
    can_add_files: bool,
    can_withdraw_files: bool,
    can_void: bool,
    files_room: count,
  }),
});

const dashboardRow = z.object({
  period_id: uuid.nullable(),
  period_label: optText,
  incoming_count: count,
  outgoing_count: count,
  incoming_voided_count: count,
  outgoing_voided_count: count,
  waiting_request_count: count.nullable(),
});

const myRequestRow = z.object({
  row_no: count,
  request_id: uuid,
  status: letterRequestStatusSchema,
  version,
  period_label: optText,
  subject: text,
  addressee: text,
  on_behalf_of: optText,
  needed_by: isoDate.nullable(),
  created_at: timestamp,
  processed_by_name: optText,
  number_text: optText,
  number_voided: bool,
  has_issued_file: bool,
  attachment_count: count,
  note: optText,
  note_by_name: optText,
  note_at: timestamp.nullable(),
  ...pageColumns,
});

const capsRow = z.object({
  open_count: count,
  open_limit: count,
  today_count: count,
  daily_limit: count,
  has_active_period: bool,
  can_submit: bool,
});

const queueRow = z.object({
  row_no: count,
  request_id: uuid,
  status: letterRequestStatusSchema,
  version,
  period_id: uuid,
  period_label: optText,
  // requester_member_id is returned by the database but deliberately not read (contract header).
  requester_name: optText,
  requester_is_active: bool,
  is_own: bool,
  subject: text,
  addressee: text,
  on_behalf_of: optText,
  needed_by: isoDate.nullable(),
  // NULL for an open request without a needed-by date (SQL `and` with a NULL comparison): no date
  // means not past due.
  is_past_due: bool.nullable(),
  days_past_due: count,
  attachment_count: count,
  number_text: optText,
  number_taken_at: timestamp.nullable(),
  number_taken_by_name: optText,
  letter_status: letterStatusSchema.nullable(),
  number_voided: bool,
  processed_by_name: optText,
  created_at: timestamp,
  updated_at: timestamp,
  period_total_count: count,
  ...pageColumns,
});

const queueCountsRow = z.object({
  submitted: count,
  processing: count,
  awaiting_file: count,
  open_all_periods: count,
  action_needed: count,
  process_holder_count: count,
});

const timelineJson = z.object({
  at: timestamp,
  event: letterRequestEventSchema,
  from_status: letterRequestStatusSchema.nullable(),
  to_status: letterRequestStatusSchema,
  actor_name: optText,
  note: optText,
  number_text: optText,
});

const requestDetailJson = z.object({
  request_id: uuid,
  status: letterRequestStatusSchema,
  version,
  period_id: uuid,
  period_label: optText,
  is_active_period: bool,
  requester_name: optText,
  requester_is_active: bool.nullable(),
  is_own: bool,
  subject: text,
  addressee: text,
  purpose: text,
  on_behalf_of: optText,
  needed_by: isoDate.nullable(),
  created_at: timestamp,
  is_past_due: bool.nullable(),
  days_past_due: count.nullable(),
  processed_at: timestamp.nullable(),
  processed_by_name: optText,
  number_text: optText,
  number_taken_at: timestamp.nullable(),
  number_taken_by_name: optText,
  number_voided: bool,
  letter_id: uuid.nullable(),
  decided_at: timestamp.nullable(),
  decided_by_name: optText,
  note: optText,
  note_by_name: optText,
  note_at: timestamp.nullable(),
  attachments: z.array(fileJson),
  letter_files: z.array(fileJson),
  letter: z
    .object({
      letter_id: uuid,
      number_text: text,
      status: letterStatusSchema,
      subject: text,
      counterpart: text,
      letter_date: isoDate.nullable(),
      file_count: count,
      version,
      period_id: uuid,
    })
    .nullable(),
  timeline: z.array(timelineJson),
  other_processor_count: count.nullable(),
  actions: z.object({
    can_cancel: bool,
    can_process: bool,
    can_take_number: bool,
    can_issue: bool,
    can_reject: bool,
  }),
});

const formatValuesJson = z.object({
  prefix: text,
  incoming_code: text,
  outgoing_code: text,
  seq_digits: z.number().int().positive(),
  separator: numberSeparatorSchema,
  include_year: bool,
});

function toFormatValues(v: z.infer<typeof formatValuesJson>): NumberingFormatValues {
  return {
    prefix: v.prefix,
    incomingCode: v.incoming_code,
    outgoingCode: v.outgoing_code,
    seqDigits: v.seq_digits,
    separator: v.separator,
    includeYear: v.include_year,
  };
}

const settingsJson = formatValuesJson.extend({
  version,
  updated_at: timestamp,
  updated_by_name: optText,
  year: int,
  types: z.array(
    z.object({
      letter_type: letterTypeSchema,
      code: text,
      last_used: z.number().int().positive().nullable(),
      next_seq: z.number().int().positive(),
      next_number: text,
      start_set: bool,
    }),
  ),
  can_edit: bool,
});

const sequenceJson = z.object({ last_used: z.number().int().positive().nullable(), next_seq: z.number().int().positive() });

const historyBase = {
  change_id: z.number().int().positive(),
  occurred_at: timestamp,
  actor_name: optText,
  ...pageColumns,
};
const numberingHistoryRow = z.discriminatedUnion("kind", [
  z.object({
    ...historyBase,
    kind: z.literal("format"),
    before_data: formatValuesJson,
    after_data: formatValuesJson,
    reason: optText,
  }),
  z.object({
    ...historyBase,
    kind: z.literal("next_sequence"),
    letter_type: letterTypeSchema,
    number_year: int,
    before_data: sequenceJson,
    after_data: sequenceJson,
    reason: text,
  }),
]);

const transitionRow = z.object({ request_id: uuid, status: letterRequestStatusSchema, version });

function toTransition(r: z.infer<typeof transitionRow>): LetterRequestTransitionResult {
  return { requestId: r.request_id, status: r.status, version: r.version };
}

const letterExportRow = z.object({
  row_no: count,
  number_text: text,
  letter_type: letterTypeSchema,
  is_legacy_number: bool,
  letter_date: isoDate.nullable(),
  received_date: isoDate.nullable(),
  counterpart: text,
  counterpart_number: optText,
  subject: text,
  notes: optText,
  status: letterStatusSchema,
  void_reason: optText,
  from_request: bool,
  period_label: optText,
  created_by_name: optText,
  created_at: timestamp,
  file_count: count,
  total_count: count,
});

// =============================================================================================
// Paging helper
// =============================================================================================

type PageColumns = { total_count: number; page: number; page_size: number };

/**
 * total/page/page_size repeat on every row; they must agree with each other and with the request, and
 * the page must fit (fail closed). 0 rows = nothing matches: page 1 of 1.
 */
function toPaged<R extends PageColumns, T>(fn: LetterRpc, rows: R[], pageSize: number, map: (row: R) => T): LetterResult<LetterPaged<T>> {
  if (rows.length === 0) return { ok: true, data: { rows: [], total: 0, page: 1, pageSize, pageCount: 1 } };
  const { total_count: total, page, page_size: size } = rows[0];
  const consistent = rows.every((r) => r.total_count === total && r.page === page && r.page_size === size);
  if (!consistent || size !== pageSize || rows.length > size) return fail(fn, "inconsistent_page");
  return { ok: true, data: { rows: rows.map(map), total, page, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)) } };
}

const filesArg = (files: readonly { path: string; name: string }[]) => files.map((f) => ({ path: f.path, name: f.name }));

// =============================================================================================
// Register reads
// =============================================================================================

/** nexus.letter_list(). */
export async function readLetterList(
  supabase: SupabaseClient,
  filters: LetterListFilters,
  page: number,
  pageSize: number,
): Promise<LetterResult<LetterPage>> {
  const result = await callRpc(supabase, "letter_list", z.array(letterRow), {
    p_type: filters.type,
    p_search: filters.search,
    p_period: filters.period,
    p_year: filters.year,
    p_status: filters.status,
    p_without_files: filters.withoutFiles,
    p_page: page,
    p_page_size: pageSize,
  });
  if (!result.ok) return result;
  const paged = toPaged("letter_list", result.data, pageSize, (r) => ({
    rowNo: r.row_no,
    letterId: r.letter_id,
    type: r.letter_type,
    numberText: r.number_text,
    isLegacyNumber: r.is_legacy_number,
    numberYear: r.number_year,
    letterDate: r.letter_date,
    receivedDate: r.received_date,
    counterpart: r.counterpart,
    counterpartNumber: r.counterpart_number,
    subject: r.subject,
    status: r.status,
    periodId: r.period_id,
    periodLabel: r.period_label,
    fromRequest: r.from_request,
    awaitingFinalFile: r.awaiting_final_file,
    fileCount: r.file_count,
    createdAt: r.created_at,
    version: r.version,
  }));
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filters } };
}

/** nexus.letter_year_list(): "Tahun nomor" choices, newest first. */
export async function readLetterYears(supabase: SupabaseClient, type: LetterType): Promise<LetterResult<number[]>> {
  const result = await callRpc(supabase, "letter_year_list", z.array(z.object({ number_year: int })), { p_type: type });
  if (!result.ok) return result;
  return { ok: true, data: result.data.map((r) => r.number_year) };
}

/** Edited fields in the contract's order (LetterEditableField); unknown keys are ignored. */
const EDIT_KEYS: readonly (readonly [string, LetterEditableField])[] = [
  ["subject", "subject"],
  ["counterpart", "counterpart"],
  ["counterpart_number", "counterpartNumber"],
  ["notes", "notes"],
  ["letter_date", "letterDate"],
  ["received_date", "receivedDate"],
];

const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const ownText = (obj: Record<string, unknown> | null, key: string): string | null => {
  if (obj === null || !Object.hasOwn(obj, key)) return null;
  const value = obj[key];
  return typeof value === "string" ? value : null;
};

function toChanges(kind: LetterHistoryKind, before: Record<string, unknown> | null, after: Record<string, unknown> | null): LetterFieldChange[] {
  if (kind !== "edited" || after === null) return [];
  const changes: LetterFieldChange[] = [];
  for (const [key, field] of EDIT_KEYS) {
    if (!Object.hasOwn(after, key)) continue;
    const next = after[key];
    const prev = before !== null && Object.hasOwn(before, key) ? before[key] : null;
    if (!textOrNull(next) || !textOrNull(prev)) continue;
    changes.push({ field, before: prev, after: next });
  }
  return changes;
}

function toLetterDetail(d: z.infer<typeof letterDetailJson>): LetterDetail {
  return {
    letterId: d.letter_id,
    type: d.letter_type,
    numberText: d.number_text,
    isLegacyNumber: d.is_legacy_number,
    numberYear: d.number_year,
    letterDate: d.letter_date,
    receivedDate: d.received_date,
    counterpart: d.counterpart,
    counterpartNumber: d.counterpart_number,
    subject: d.subject,
    notes: d.notes,
    status: d.status,
    voidReason: d.void_reason,
    voidedAt: d.voided_at,
    voidedByName: d.voided_by_name,
    periodId: d.period_id,
    periodLabel: d.period_label,
    isActivePeriod: d.is_active_period,
    createdAt: d.created_at,
    createdByName: d.created_by_name,
    updatedAt: d.updated_at,
    updatedByName: d.updated_by_name,
    version: d.version,
    fromRequest: d.from_request,
    awaitingFinalFile: d.awaiting_final_file,
    request:
      d.request === null
        ? null
        : { requestId: d.request.request_id, subject: d.request.subject, status: d.request.status, requesterName: d.request.requester_name },
    fileCount: d.file_count,
    files: d.files.map(toFile),
    history: d.history.map((h) => ({
      historyId: h.history_id,
      at: h.at,
      kind: h.kind,
      actorName: h.actor_name,
      changes: toChanges(h.kind, h.before, h.after),
      fileName: h.kind === "file_added" || h.kind === "file_withdrawn" ? h.file_name ?? ownText(h.after, "file_name") : null,
      note: h.note,
      numberText: h.kind === "registered" ? ownText(h.after, "number_text") : null,
    })),
    actions: {
      canEdit: d.actions.can_edit,
      canAddFiles: d.actions.can_add_files,
      canWithdrawFiles: d.actions.can_withdraw_files,
      canVoid: d.actions.can_void,
      filesRoom: d.actions.files_room,
    },
  };
}

/** nexus.letter_detail(). An unknown id answers not_found "letter". */
export async function readLetterDetail(supabase: SupabaseClient, letterId: string): Promise<LetterResult<LetterDetail>> {
  const result = await callRpc(supabase, "letter_detail", letterDetailJson, { p_letter_id: letterId }, { field: "letterId" });
  if (!result.ok) return result;
  return { ok: true, data: toLetterDetail(result.data) };
}

/** nexus.letter_dashboard_counts(): one row (counts only). */
export async function readLetterDashboardCounts(supabase: SupabaseClient): Promise<LetterResult<LetterDashboardCounts>> {
  const result = await callRpc(supabase, "letter_dashboard_counts", oneRow(dashboardRow));
  if (!result.ok) return result;
  const r = result.data;
  return {
    ok: true,
    data: {
      periodId: r.period_id,
      periodLabel: r.period_label,
      incomingCount: r.incoming_count,
      outgoingCount: r.outgoing_count,
      incomingVoidedCount: r.incoming_voided_count,
      outgoingVoidedCount: r.outgoing_voided_count,
      waitingRequestCount: r.waiting_request_count,
    },
  };
}

// =============================================================================================
// Register writes (letters.manage)
// =============================================================================================

type FileRef = { path: string; name: string };

export type LetterRegisterArgs =
  | {
      type: "incoming";
      subject: string;
      counterpart: string;
      notes: string | null;
      receivedDate: string;
      letterDate: string | null;
      counterpartNumber: string | null;
      legacyNumber: string | null;
      files: FileRef[];
    }
  | {
      type: "outgoing";
      subject: string;
      counterpart: string;
      notes: string | null;
      letterDate: string;
      legacyNumber: string | null;
      files: FileRef[];
    };

/** nexus.letter_register(). Fields of the other type are sent as null. */
export async function registerLetterRow(supabase: SupabaseClient, input: LetterRegisterArgs): Promise<LetterResult<LetterRegisterResult>> {
  const incoming = input.type === "incoming" ? input : null;
  const result = await callRpc(
    supabase,
    "letter_register",
    oneRow(z.object({ letter_id: uuid, number_text: text, status: letterStatusSchema, version })),
    {
      p_type: input.type,
      p_subject: input.subject,
      p_counterpart: input.counterpart,
      p_letter_date: input.letterDate,
      p_received_date: incoming ? incoming.receivedDate : null,
      p_counterpart_number: incoming ? incoming.counterpartNumber : null,
      p_notes: input.notes,
      p_files: filesArg(input.files),
      p_legacy_number: input.legacyNumber,
    },
  );
  if (!result.ok) return result;
  const r = result.data;
  return { ok: true, data: { letterId: r.letter_id, numberText: r.number_text, status: r.status, version: r.version } };
}

export type LetterUpdateArgs =
  | {
      type: "incoming";
      letterId: string;
      version: number;
      subject: string;
      counterpart: string;
      notes: string | null;
      receivedDate: string;
      letterDate: string | null;
      counterpartNumber: string | null;
    }
  | { type: "outgoing"; letterId: string; version: number; subject: string; counterpart: string; notes: string | null; letterDate: string };

/** nexus.letter_update(). The letter's type decides in the database; the other type's fields are null. */
export async function updateLetterRow(supabase: SupabaseClient, input: LetterUpdateArgs): Promise<LetterResult<LetterUpdateResult>> {
  const incoming = input.type === "incoming" ? input : null;
  const result = await callRpc(
    supabase,
    "letter_update",
    oneRow(z.object({ letter_id: uuid, changed: bool, version })),
    {
      p_letter_id: input.letterId,
      p_version: input.version,
      p_subject: input.subject,
      p_counterpart: input.counterpart,
      p_letter_date: input.letterDate,
      p_received_date: incoming ? incoming.receivedDate : null,
      p_counterpart_number: incoming ? incoming.counterpartNumber : null,
      p_notes: input.notes,
    },
    { field: "letterId" },
  );
  if (!result.ok) return result;
  return { ok: true, data: { letterId: result.data.letter_id, changed: result.data.changed, version: result.data.version } };
}

const filesResultRow = oneRow(z.object({ letter_id: uuid, file_count: count, version }));

/** nexus.letter_add_files(). */
export async function addLetterFileRows(
  supabase: SupabaseClient,
  input: { letterId: string; version: number; files: FileRef[] },
): Promise<LetterResult<LetterFilesResult>> {
  const result = await callRpc(
    supabase,
    "letter_add_files",
    filesResultRow,
    { p_letter_id: input.letterId, p_version: input.version, p_files: filesArg(input.files) },
    { field: "letterId" },
  );
  if (!result.ok) return result;
  return { ok: true, data: { letterId: result.data.letter_id, fileCount: result.data.file_count, version: result.data.version } };
}

/** nexus.letter_withdraw_file(). `version` is the LETTER's version. */
export async function withdrawLetterFileRow(
  supabase: SupabaseClient,
  input: { fileId: number; version: number; reason: string },
): Promise<LetterResult<LetterFilesResult>> {
  const result = await callRpc(
    supabase,
    "letter_withdraw_file",
    filesResultRow,
    { p_file_id: input.fileId, p_version: input.version, p_reason: input.reason },
    { field: "fileId" },
  );
  if (!result.ok) return result;
  return { ok: true, data: { letterId: result.data.letter_id, fileCount: result.data.file_count, version: result.data.version } };
}

/** nexus.letter_void(). */
export async function voidLetterRow(
  supabase: SupabaseClient,
  input: { letterId: string; version: number; reason: string },
): Promise<LetterResult<LetterVoidResult>> {
  const result = await callRpc(
    supabase,
    "letter_void",
    oneRow(z.object({ letter_id: uuid, status: letterStatusSchema, version })),
    { p_letter_id: input.letterId, p_version: input.version, p_reason: input.reason },
    { field: "letterId" },
  );
  if (!result.ok) return result;
  return { ok: true, data: { letterId: result.data.letter_id, status: result.data.status, version: result.data.version } };
}

// =============================================================================================
// Request reads
// =============================================================================================

/** nexus.letter_my_requests(): OWN requests only. */
export async function readMyLetterRequests(
  supabase: SupabaseClient,
  filter: MyLetterRequestsFilter,
  page: number,
  pageSize: number,
): Promise<LetterResult<MyLetterRequestsPage>> {
  const result = await callRpc(
    supabase,
    "letter_my_requests",
    z.array(myRequestRow),
    { p_filter: filter, p_page: page, p_page_size: pageSize },
    { viewField: "filter" },
  );
  if (!result.ok) return result;
  const paged = toPaged("letter_my_requests", result.data, pageSize, (r) => ({
    rowNo: r.row_no,
    requestId: r.request_id,
    status: r.status,
    version: r.version,
    periodLabel: r.period_label,
    subject: r.subject,
    addressee: r.addressee,
    onBehalfOf: r.on_behalf_of,
    neededBy: r.needed_by,
    createdAt: r.created_at,
    processedByName: r.processed_by_name,
    numberText: r.number_text,
    numberVoided: r.number_voided,
    hasIssuedFile: r.has_issued_file,
    attachmentCount: r.attachment_count,
    note: r.note,
    noteByName: r.note_by_name,
    noteAt: r.note_at,
  }));
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filter } };
}

/** nexus.letter_my_request_caps(): one row about the caller. */
export async function readMyLetterRequestCaps(supabase: SupabaseClient): Promise<LetterResult<LetterRequestCaps>> {
  const result = await callRpc(supabase, "letter_my_request_caps", oneRow(capsRow));
  if (!result.ok) return result;
  const r = result.data;
  return {
    ok: true,
    data: {
      openCount: r.open_count,
      openLimit: r.open_limit,
      todayCount: r.today_count,
      dailyLimit: r.daily_limit,
      hasActivePeriod: r.has_active_period,
      canSubmit: r.can_submit,
    },
  };
}

/** nexus.letter_request_queue() (letter_requests.view_all). */
export async function readLetterQueue(
  supabase: SupabaseClient,
  filters: LetterQueueFilters,
  page: number,
  pageSize: number,
): Promise<LetterResult<LetterQueuePage>> {
  const result = await callRpc(
    supabase,
    "letter_request_queue",
    z.array(queueRow),
    {
      p_view: filters.view,
      p_search: filters.search,
      p_from: filters.from,
      p_to: filters.to,
      p_page: page,
      p_page_size: pageSize,
    },
    { dateField: "to", viewField: "view" },
  );
  if (!result.ok) return result;
  const paged = toPaged("letter_request_queue", result.data, pageSize, (r) => ({
    rowNo: r.row_no,
    requestId: r.request_id,
    status: r.status,
    version: r.version,
    periodId: r.period_id,
    periodLabel: r.period_label,
    requesterName: r.requester_name,
    requesterIsActive: r.requester_is_active,
    isOwn: r.is_own,
    subject: r.subject,
    addressee: r.addressee,
    onBehalfOf: r.on_behalf_of,
    neededBy: r.needed_by,
    isPastDue: r.is_past_due === true,
    daysPastDue: r.days_past_due,
    attachmentCount: r.attachment_count,
    numberText: r.number_text,
    numberTakenAt: r.number_taken_at,
    numberTakenByName: r.number_taken_by_name,
    letterStatus: r.letter_status,
    numberVoided: r.number_voided,
    processedByName: r.processed_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    periodTotalCount: r.period_total_count,
  }));
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filters } };
}

/** nexus.letter_request_queue_counts(): one row, counts only. */
export async function readLetterQueueCounts(supabase: SupabaseClient): Promise<LetterResult<LetterQueueCounts>> {
  const result = await callRpc(supabase, "letter_request_queue_counts", oneRow(queueCountsRow));
  if (!result.ok) return result;
  const r = result.data;
  return {
    ok: true,
    data: {
      submitted: r.submitted,
      processing: r.processing,
      awaitingFile: r.awaiting_file,
      openAllPeriods: r.open_all_periods,
      actionNeeded: r.action_needed,
      processHolderCount: r.process_holder_count,
    },
  };
}

function toRequestDetail(d: z.infer<typeof requestDetailJson>): LetterRequestDetail {
  return {
    requestId: d.request_id,
    status: d.status,
    version: d.version,
    periodId: d.period_id,
    periodLabel: d.period_label,
    isActivePeriod: d.is_active_period,
    requesterName: d.requester_name,
    requesterIsActive: d.requester_is_active,
    isOwn: d.is_own,
    subject: d.subject,
    addressee: d.addressee,
    purpose: d.purpose,
    onBehalfOf: d.on_behalf_of,
    neededBy: d.needed_by,
    createdAt: d.created_at,
    // view_all holders get days_past_due; their is_past_due is NULL when there is no needed-by date
    // (see queueRow), which means "not past due". Requesters without view_all get null for both.
    isPastDue: d.days_past_due === null ? null : d.is_past_due === true,
    daysPastDue: d.days_past_due,
    processedAt: d.processed_at,
    processedByName: d.processed_by_name,
    numberText: d.number_text,
    numberTakenAt: d.number_taken_at,
    numberTakenByName: d.number_taken_by_name,
    numberVoided: d.number_voided,
    letterId: d.letter_id,
    letter:
      d.letter === null
        ? null
        : {
            letterId: d.letter.letter_id,
            numberText: d.letter.number_text,
            status: d.letter.status,
            subject: d.letter.subject,
            counterpart: d.letter.counterpart,
            letterDate: d.letter.letter_date,
            fileCount: d.letter.file_count,
            version: d.letter.version,
            periodId: d.letter.period_id,
          },
    decidedAt: d.decided_at,
    decidedByName: d.decided_by_name,
    note: d.note,
    noteByName: d.note_by_name,
    noteAt: d.note_at,
    attachments: d.attachments.map(toFile),
    letterFiles: d.letter_files.map(toFile),
    timeline: d.timeline.map((t) => ({
      at: t.at,
      event: t.event,
      fromStatus: t.from_status,
      toStatus: t.to_status,
      actorName: t.actor_name,
      note: t.note,
      numberText: t.event === "number_taken" ? t.number_text : null,
    })),
    otherProcessorCount: d.other_processor_count,
    actions: {
      canCancel: d.actions.can_cancel,
      canProcess: d.actions.can_process,
      canTakeNumber: d.actions.can_take_number,
      canIssue: d.actions.can_issue,
      canReject: d.actions.can_reject,
    },
  };
}

/** nexus.letter_request_detail(). Requester or view_all; anyone else and an unknown id: not_found "request". */
export async function readLetterRequestDetail(supabase: SupabaseClient, requestId: string): Promise<LetterResult<LetterRequestDetail>> {
  const result = await callRpc(supabase, "letter_request_detail", requestDetailJson, { p_request_id: requestId }, { field: "requestId" });
  if (!result.ok) return result;
  return { ok: true, data: toRequestDetail(result.data) };
}

// =============================================================================================
// Request state machine
// =============================================================================================

/** nexus.letter_request_create(): requester and period come from the session. */
export async function createLetterRequest(
  supabase: SupabaseClient,
  input: { subject: string; addressee: string; purpose: string; onBehalfOf: string | null; neededBy: string | null; files: FileRef[] },
): Promise<LetterResult<LetterRequestTransitionResult>> {
  const result = await callRpc(supabase, "letter_request_create", oneRow(transitionRow), {
    p_subject: input.subject,
    p_addressee: input.addressee,
    p_purpose: input.purpose,
    p_on_behalf_of: input.onBehalfOf,
    p_needed_by: input.neededBy,
    p_files: filesArg(input.files),
  });
  if (!result.ok) return result;
  return { ok: true, data: toTransition(result.data) };
}

async function transition(
  supabase: SupabaseClient,
  fn: "letter_request_cancel" | "letter_request_process" | "letter_request_reject",
  args: Record<string, unknown>,
): Promise<LetterResult<LetterRequestTransitionResult>> {
  const result = await callRpc(supabase, fn, oneRow(transitionRow), args, { field: "requestId" });
  if (!result.ok) return result;
  return { ok: true, data: toTransition(result.data) };
}

/** nexus.letter_request_cancel(): the requester only, Diajukan only. */
export function cancelLetterRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; reason: string | null },
): Promise<LetterResult<LetterRequestTransitionResult>> {
  return transition(supabase, "letter_request_cancel", { p_request_id: input.requestId, p_version: input.version, p_reason: input.reason });
}

/** nexus.letter_request_process(): Diajukan -> Diproses, never own. */
export function processLetterRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; note: string | null },
): Promise<LetterResult<LetterRequestTransitionResult>> {
  return transition(supabase, "letter_request_process", { p_request_id: input.requestId, p_version: input.version, p_note: input.note });
}

/** nexus.letter_request_reject(): Diajukan or Diproses -> Ditolak (voids a taken number). */
export function rejectLetterRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; note: string },
): Promise<LetterResult<LetterRequestTransitionResult>> {
  return transition(supabase, "letter_request_reject", { p_request_id: input.requestId, p_version: input.version, p_note: input.note });
}

/** nexus.letter_request_take_number(): the next SK number and the linked register row, status stays Diproses. */
export async function takeLetterRequestNumber(
  supabase: SupabaseClient,
  input: { requestId: string; version: number },
): Promise<LetterResult<LetterTakeNumberResult>> {
  const result = await callRpc(
    supabase,
    "letter_request_take_number",
    oneRow(transitionRow.extend({ letter_id: uuid, number_text: text })),
    { p_request_id: input.requestId, p_version: input.version },
    { field: "requestId" },
  );
  if (!result.ok) return result;
  const r = result.data;
  return { ok: true, data: { ...toTransition(r), letterId: r.letter_id, numberText: r.number_text } };
}

/** nexus.letter_request_issue(): p_letter_version is the register row's version from the detail. */
export async function issueLetterRequest(
  supabase: SupabaseClient,
  input: {
    requestId: string;
    version: number;
    letterVersion: number;
    subject: string;
    addressee: string;
    letterDate: string;
    files: FileRef[];
    note: string | null;
  },
): Promise<LetterResult<LetterRequestTransitionResult>> {
  const result = await callRpc(
    supabase,
    "letter_request_issue",
    oneRow(transitionRow),
    {
      p_request_id: input.requestId,
      p_version: input.version,
      p_letter_version: input.letterVersion,
      p_subject: input.subject,
      p_addressee: input.addressee,
      p_letter_date: input.letterDate,
      p_files: filesArg(input.files),
      p_note: input.note,
    },
    { field: "requestId" },
  );
  if (!result.ok) return result;
  return { ok: true, data: toTransition(result.data) };
}

// =============================================================================================
// Numbering settings
// =============================================================================================

/** nexus.letter_numbering_settings(): System Admin or letters.manage. */
export async function readNumberingSettings(supabase: SupabaseClient): Promise<LetterResult<NumberingSettings>> {
  const result = await callRpc(supabase, "letter_numbering_settings", settingsJson);
  if (!result.ok) return result;
  const s = result.data;
  return {
    ok: true,
    data: {
      ...toFormatValues(s),
      version: s.version,
      updatedAt: s.updated_at,
      updatedByName: s.updated_by_name,
      year: s.year,
      types: s.types.map((t) => ({
        type: t.letter_type,
        code: t.code,
        lastUsed: t.last_used,
        nextSeq: t.next_seq,
        nextNumber: t.next_number,
        startSet: t.start_set,
      })),
      canEdit: s.can_edit,
    },
  };
}

/** nexus.letter_numbering_history(): newest first. */
export async function readNumberingHistory(supabase: SupabaseClient, page: number, pageSize: number): Promise<LetterResult<NumberingHistoryPage>> {
  const result = await callRpc(supabase, "letter_numbering_history", z.array(numberingHistoryRow), { p_page: page, p_page_size: pageSize });
  if (!result.ok) return result;
  return toPaged("letter_numbering_history", result.data, pageSize, (r): NumberingChange =>
    r.kind === "format"
      ? {
          changeId: r.change_id,
          occurredAt: r.occurred_at,
          kind: "format",
          before: toFormatValues(r.before_data),
          after: toFormatValues(r.after_data),
          reason: r.reason,
          actorName: r.actor_name,
        }
      : {
          changeId: r.change_id,
          occurredAt: r.occurred_at,
          kind: "next_sequence",
          type: r.letter_type,
          year: r.number_year,
          before: { lastUsed: r.before_data.last_used, nextSeq: r.before_data.next_seq },
          after: { lastUsed: r.after_data.last_used, nextSeq: r.after_data.next_seq },
          reason: r.reason,
          actorName: r.actor_name,
        },
  );
}

/** nexus.letter_numbering_update_format(): System Admin. The year is always included (D2). */
export async function updateNumberingFormatRow(
  supabase: SupabaseClient,
  input: {
    version: number;
    prefix: string;
    incomingCode: string;
    outgoingCode: string;
    seqDigits: number;
    separator: string;
    reason: string | null;
  },
): Promise<LetterResult<NumberingFormatResult>> {
  const result = await callRpc(supabase, "letter_numbering_update_format", oneRow(z.object({ changed: bool, version })), {
    p_version: input.version,
    p_prefix: input.prefix,
    p_incoming_code: input.incomingCode,
    p_outgoing_code: input.outgoingCode,
    p_seq_digits: input.seqDigits,
    p_separator: input.separator,
    p_include_year: true,
    p_reason: input.reason,
  });
  if (!result.ok) return result;
  return { ok: true, data: { changed: result.data.changed, version: result.data.version } };
}

/** nexus.letter_numbering_set_next(): System Admin, current Jakarta year only. */
export async function setNumberingNextRow(
  supabase: SupabaseClient,
  input: { type: LetterType; year: number; nextSeq: number; reason: string },
): Promise<LetterResult<NumberingSetNextResult>> {
  const result = await callRpc(
    supabase,
    "letter_numbering_set_next",
    oneRow(z.object({ letter_type: letterTypeSchema, number_year: int, next_seq: z.number().int().positive(), next_number: text })),
    { p_type: input.type, p_year: input.year, p_next_seq: input.nextSeq, p_reason: input.reason },
    { field: "nextSeq" },
  );
  if (!result.ok) return result;
  const r = result.data;
  return { ok: true, data: { type: r.letter_type, year: r.number_year, nextSeq: r.next_seq, nextNumber: r.next_number } };
}

// =============================================================================================
// Export
// =============================================================================================

/**
 * nexus.letter_export(): same rows, filters and order as the register list, all pages, plus the
 * full-result count. VOLATILE (writes the export-log row): supabase-js sends it as POST. Call it
 * exactly once per export.
 */
export async function exportLetterRows(
  supabase: SupabaseClient,
  format: LetterExportFormat,
  filters: LetterListFilters,
): Promise<LetterResult<CountedRows<LetterExportRow>>> {
  const result = await callRpc(supabase, "letter_export", z.array(letterExportRow), {
    p_format: format,
    p_type: filters.type,
    p_search: filters.search,
    p_period: filters.period,
    p_year: filters.year,
    p_status: filters.status,
    p_without_files: filters.withoutFiles,
  });
  if (!result.ok) return result;
  const totalCount = readTotalCount(result.data);
  if (totalCount === null) return fail("letter_export", "inconsistent_total");
  return {
    ok: true,
    data: {
      totalCount,
      rows: result.data.map((r) => ({
        rowNo: r.row_no,
        numberText: r.number_text,
        type: r.letter_type,
        isLegacyNumber: r.is_legacy_number,
        letterDate: r.letter_date,
        receivedDate: r.received_date,
        counterpart: r.counterpart,
        counterpartNumber: r.counterpart_number,
        subject: r.subject,
        notes: r.notes,
        status: r.status,
        voidReason: r.void_reason,
        fromRequest: r.from_request,
        periodLabel: r.period_label,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
        fileCount: r.file_count,
      })),
    },
  };
}

// =============================================================================================
// Letter files (private bucket; Storage policies call letter_file_can_upload / _can_read)
// =============================================================================================

type StorageErrorLike = { status?: number; statusCode?: string; message?: string; code?: string };

/** Storage refusals that mean "the policy said no" (RLS) rather than "something broke". */
function isPolicyRefusal(error: StorageErrorLike): boolean {
  return (
    error.status === 403 ||
    error.statusCode === "403" ||
    error.code === "AccessDenied" ||
    error.code === "Unauthorized" ||
    /row-level security/i.test(error.message ?? "")
  );
}

function isTooLarge(error: StorageErrorLike): boolean {
  return error.status === 413 || error.statusCode === "413" || error.code === "EntityTooLarge";
}

function isBadType(error: StorageErrorLike): boolean {
  return error.status === 415 || error.statusCode === "415" || error.code === "InvalidMimeType";
}

/**
 * Uploads one already-checked file with the USER's client into the caller's own folder. No overwrite
 * (upsert false): the path has a fresh random name, so a clash means a bug (unavailable). The session
 * already has an active period when this runs, so a policy refusal is the 24-hour cap (contract).
 */
export async function uploadLetterFile(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: LetterFileMimeType,
  name: string,
): Promise<LetterResult<LetterFileUploadResult>> {
  if (!LETTER_FILE_PATH_PATTERN.test(path)) return fail("storage.upload", "bad_path");
  try {
    const { data, error } = await supabase.storage.from(LETTER_FILE_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error) {
      const raw = error as StorageErrorLike;
      if (isPolicyRefusal(raw)) return { ok: false, error: { code: "upload_limit", limit: LETTER_LIMITS.unattachedUploadsPer24h } };
      if (isTooLarge(raw)) return { ok: false, error: { code: "file_too_large", field: "file", ref: null, maxMb: LETTER_FILE_MAX_MB } };
      if (isBadType(raw)) return { ok: false, error: { code: "invalid_file", field: "file", ref: null } };
      return fail("storage.upload", `${raw.status ?? "-"}/${raw.code ?? raw.statusCode ?? "-"}`);
    }
    if (!data || data.path !== path) return fail("storage.upload", "unexpected_shape");
    return { ok: true, data: { path, name, sizeBytes: bytes.byteLength, mimeType: contentType } };
  } catch {
    return fail("storage.upload", "exception");
  }
}

const FILE_NOT_FOUND: Failure = { ok: false, error: { code: "not_found", entity: "file" } };

/**
 * One signed link for a file the caller may read. The parent detail (ONE RPC) decides what the caller
 * sees at all (letter_detail needs letters.view; letter_request_detail is the requester or view_all)
 * and lists only the files the database lets this caller read; a file not among them is not_found
 * "file". The path is then signed with the USER's client, so the bucket policy letter_file_can_read
 * checks again (a refusal is not_found "file"). The path never leaves the server.
 */
export async function readLetterFileLink(
  supabase: SupabaseClient,
  input: { parent: "letter"; letterId: string; fileId: number } | { parent: "request"; requestId: string; fileId: number },
  ttlSeconds: number,
): Promise<LetterResult<LetterFileLink>> {
  let files: FileJson[];
  if (input.parent === "letter") {
    const detail = await callRpc(supabase, "letter_detail", letterDetailJson, { p_letter_id: input.letterId }, { field: "letterId" });
    if (!detail.ok) return detail;
    files = detail.data.files;
  } else {
    const detail = await callRpc(supabase, "letter_request_detail", requestDetailJson, { p_request_id: input.requestId }, { field: "requestId" });
    if (!detail.ok) return detail;
    files = [...detail.data.attachments, ...detail.data.letter_files];
  }

  const file = files.find((f) => f.file_id === input.fileId);
  if (file === undefined || !LETTER_FILE_PATH_PATTERN.test(file.storage_path)) return FILE_NOT_FOUND;

  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { data, error } = await supabase.storage.from(LETTER_FILE_BUCKET).createSignedUrl(file.storage_path, ttlSeconds);
    if (error) {
      const raw = error as StorageErrorLike;
      // The policy (or a missing object) answers 400/403/404: the file is not readable for this caller.
      const refused =
        isPolicyRefusal(raw) || raw.status === 400 || raw.status === 404 || raw.statusCode === "400" || raw.statusCode === "404";
      if (refused) return FILE_NOT_FOUND;
      return fail("storage.createSignedUrl", `${raw.status ?? "-"}/${raw.code ?? raw.statusCode ?? "-"}`);
    }
    if (!data || typeof data.signedUrl !== "string" || data.signedUrl === "") return fail("storage.createSignedUrl", "unexpected_shape");
    return { ok: true, data: { fileId: file.file_id, url: data.signedUrl, expiresAt } };
  } catch {
    return fail("storage.createSignedUrl", "exception");
  }
}
