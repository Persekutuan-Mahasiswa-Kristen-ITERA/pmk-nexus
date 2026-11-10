import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readTotalCount, type CountedRows } from "@/lib/supabase/limits";
import {
  MINUTE_FILE_BUCKET,
  MINUTE_FILE_MAX_MB,
  MINUTE_FILE_MIME_TYPES,
  MINUTE_FILE_PATH_PATTERN,
  MINUTE_HISTORY_FIELD_KEYS,
  MINUTE_LIMITS,
  minuteErrorFromDb,
  minuteHistoryKindSchema,
  minuteStatusSchema,
  minuteUnitTypeSchema,
  type MinuteDashboardCounts,
  type MinuteDetail,
  type MinuteError,
  type MinuteExportFormat,
  type MinuteExportRow,
  type MinuteFieldChange,
  type MinuteFile,
  type MinuteFileLink,
  type MinuteFileMimeType,
  type MinuteFileUploadResult,
  type MinuteFilesResult,
  type MinuteHistoryKind,
  type MinuteListFilters,
  type MinutePage,
  type MinutePaged,
  type MinuteRecordResult,
  type MinuteResult,
  type MinuteRow,
  type MinuteUnitOption,
  type MinuteUpdateResult,
  type MinuteVoidResult,
} from "@/modules/minutes/types";

// Thin typed wrappers around the Meeting Minutes RPCs (supabase/migrations/20261111100100_nexus_minutes.sql,
// reference supabase/README.md section 3.3). These nexus functions check PI-CORE assignments (unit
// scopes through has_permission), read PI-CORE member names, unit names and period labels, so they are
// called from here and nowhere else (CLAUDE.md 4). The minute-file bucket is here too: its Storage
// policies run the same PI-CORE-backed checks (minute_file_can_upload / _can_read), and every `.from(`
// stays in this layer.
//
// Always with the USER's session client: the database checks the caller again inside every function.
// Inputs must already be validated by the caller (src/modules/minutes/server). Answers are validated
// with zod; only the contract's fields survive (storage paths never reach the UI). Nothing here throws.
// Only src/modules/minutes/server/ may import this file.

// =============================================================================================
// Error mapping (contract section 8: ONLY through minuteErrorFromDb)
// =============================================================================================

const UNAVAILABLE: MinuteError = { code: "unavailable" };

/** SQLSTATEs the module raises on purpose. Anything else (also with a known hint) is unavailable. */
const KNOWN_SQLSTATES: ReadonlySet<string> = new Set(["42501", "P0001", "P0002", "22023"]);

type PostgrestLikeError = { code?: string; hint?: string | null; details?: string | null };

/**
 * A database error as the contract's error union. An unexpected SQLSTATE (network, `nexus` not exposed,
 * missing grant without a hint, 5xx) is `unavailable` before the hint is even read: fail closed, never
 * "no access" and never "no rows". The message is never read.
 */
export function mapMinuteDbError(error: PostgrestLikeError): MinuteError {
  if (typeof error.code !== "string" || !KNOWN_SQLSTATES.has(error.code)) return UNAVAILABLE;
  const detail = typeof error.details === "string" && error.details !== "" ? error.details : null;
  return minuteErrorFromDb(error.hint ?? null, detail);
}

// =============================================================================================
// RPC call
// =============================================================================================

type MinuteRpc =
  | "minute_unit_options"
  | "minute_list"
  | "minute_detail"
  | "minute_dashboard_counts"
  | "minute_record"
  | "minute_update"
  | "minute_add_files"
  | "minute_withdraw_file"
  | "minute_void"
  | "minute_export";

type Failure = { ok: false; error: MinuteError };

/** Calls one nexus RPC with the USER's client and validates the answer. Never throws. */
async function callRpc<T>(supabase: SupabaseClient, fn: MinuteRpc, schema: z.ZodType<T>, args?: Record<string, unknown>): Promise<MinuteResult<T>> {
  try {
    const { data, error } = await supabase.schema("nexus").rpc(fn, args);
    if (error) {
      const mapped = mapMinuteDbError(error);
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

const uuid = z.guid(); // Postgres uuid text form; also accepts seeded non-RFC ids (as context.ts).
const count = z.number().int().nonnegative();
const version = z.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(1);
const text = z.string();
const optText = z.string().nullable();
const bool = z.boolean();
const jsonObject = z.record(z.string(), z.unknown());

const pageColumns = { total_count: count, page: z.number().int().positive(), page_size: z.number().int().positive() };

const unitOptionRow = z.object({
  unit_id: uuid,
  unit_name: text,
  unit_type: minuteUnitTypeSchema,
  is_active: bool,
  can_read: bool,
  can_record: bool,
});

const minuteRow = z.object({
  row_no: count,
  minute_id: uuid,
  org_unit_id: uuid,
  unit_name: optText,
  unit_type: minuteUnitTypeSchema.nullable(),
  meeting_date: isoDate,
  title: text,
  topic: text,
  status: minuteStatusSchema,
  period_id: uuid,
  period_label: optText,
  file_count: count,
  created_at: timestamp,
  version,
  ...pageColumns,
});

const fileJson = z.object({
  file_id: z.number().int().positive(),
  // Kept for signing only; never mapped into a contract type. Not pattern-checked here so one odd
  // stored path cannot hide a whole detail page; the signer checks it.
  storage_path: z.string(),
  original_name: text,
  size_bytes: count.nullable(),
  mime_type: z.enum(MINUTE_FILE_MIME_TYPES),
  attached_at: timestamp,
  attached_by_name: optText,
  is_withdrawn: bool,
  withdrawn_at: timestamp.nullable(),
  withdrawn_by_name: optText,
  withdraw_reason: optText,
});
type FileJson = z.infer<typeof fileJson>;

const historyJson = z.object({
  history_id: z.number().int().positive(),
  at: timestamp,
  kind: minuteHistoryKindSchema,
  actor_name: optText,
  before: jsonObject.nullable(),
  after: jsonObject.nullable(),
  note: optText,
  file_name: optText,
});

const minuteDetailJson = z.object({
  minute_id: uuid,
  org_unit_id: uuid,
  unit_name: optText,
  unit_type: minuteUnitTypeSchema.nullable(),
  meeting_date: isoDate,
  title: text,
  topic: text,
  content: text,
  decision: optText,
  status: minuteStatusSchema,
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
  file_count: count,
  files: z.array(fileJson),
  history: z.array(historyJson),
  actions: z.object({
    can_edit: bool,
    can_void: bool,
    can_add_files: bool,
    can_withdraw_files: bool,
    files_room: count,
    can_export: bool,
  }),
});

const dashboardRow = z.object({
  period_id: uuid.nullable(),
  period_label: optText,
  period_starts_on: isoDate.nullable(),
  period_ends_on: isoDate.nullable(),
  minute_count: count,
  latest_meeting_date: isoDate.nullable(),
});

const exportRow = z.object({
  row_no: count,
  minute_id: uuid,
  meeting_date: isoDate,
  unit_name: optText,
  unit_type: minuteUnitTypeSchema.nullable(),
  title: text,
  topic: text,
  content: text,
  decision: optText,
  status: minuteStatusSchema,
  void_reason: optText,
  period_label: optText,
  created_by_name: optText,
  created_at: timestamp,
  file_count: count,
  total_count: count,
});

// =============================================================================================
// Helpers
// =============================================================================================

type PageColumns = { total_count: number; page: number; page_size: number };

/**
 * total/page/page_size repeat on every row; they must agree with each other and with the request, and
 * the page must fit (fail closed). 0 rows = nothing matches: page 1 of 1.
 */
function toPaged<R extends PageColumns, T>(fn: MinuteRpc, rows: R[], pageSize: number, map: (row: R) => T): MinuteResult<MinutePaged<T>> {
  if (rows.length === 0) return { ok: true, data: { rows: [], total: 0, page: 1, pageSize, pageCount: 1 } };
  const { total_count: total, page, page_size: size } = rows[0];
  const consistent = rows.every((r) => r.total_count === total && r.page === page && r.page_size === size);
  if (!consistent || size !== pageSize || rows.length > size) return fail(fn, "inconsistent_page");
  return { ok: true, data: { rows: rows.map(map), total, page, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)) } };
}

type FileRef = { path: string; name: string };

/** p_files jsonb: exactly path and name (nothing else the client might have added). */
const filesArg = (files: readonly FileRef[]) => files.map((f) => ({ path: f.path, name: f.name }));

function toFile(f: FileJson): MinuteFile {
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

const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** before/after of an `edited` row, in the contract's field order; unknown keys and odd values are ignored. */
function toChanges(kind: MinuteHistoryKind, before: Record<string, unknown> | null, after: Record<string, unknown> | null): MinuteFieldChange[] {
  if (kind !== "edited" || after === null) return [];
  const changes: MinuteFieldChange[] = [];
  for (const [key, field] of Object.entries(MINUTE_HISTORY_FIELD_KEYS)) {
    if (!Object.hasOwn(after, key)) continue;
    const next = after[key];
    const prev = before !== null && Object.hasOwn(before, key) ? before[key] : null;
    if (!textOrNull(next) || !textOrNull(prev)) continue;
    changes.push({ field, before: prev, after: next });
  }
  return changes;
}

function toMinuteDetail(d: z.infer<typeof minuteDetailJson>): MinuteDetail {
  return {
    minuteId: d.minute_id,
    unitId: d.org_unit_id,
    unitName: d.unit_name,
    unitType: d.unit_type,
    meetingDate: d.meeting_date,
    title: d.title,
    topic: d.topic,
    content: d.content,
    decision: d.decision,
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
    fileCount: d.file_count,
    files: d.files.map(toFile),
    history: d.history.map((h) => ({
      historyId: h.history_id,
      at: h.at,
      kind: h.kind,
      actorName: h.actor_name,
      changes: toChanges(h.kind, h.before, h.after),
      // The database returns null for a file this caller may not see (withdrawn, non-manager).
      fileName: h.kind === "file_added" || h.kind === "file_withdrawn" ? h.file_name : null,
      note: h.kind === "file_withdrawn" || h.kind === "voided" ? h.note : null,
    })),
    actions: {
      canEdit: d.actions.can_edit,
      canVoid: d.actions.can_void,
      canAddFiles: d.actions.can_add_files,
      canWithdrawFiles: d.actions.can_withdraw_files,
      filesRoom: d.actions.files_room,
      canExport: d.actions.can_export,
    },
  };
}

// =============================================================================================
// Reads (minutes.view in any scope)
// =============================================================================================

/** nexus.minute_unit_options(): the Unit filter and the record form's select. */
export async function readMinuteUnitOptions(supabase: SupabaseClient): Promise<MinuteResult<MinuteUnitOption[]>> {
  const result = await callRpc(supabase, "minute_unit_options", z.array(unitOptionRow));
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((r) => ({
      unitId: r.unit_id,
      unitName: r.unit_name,
      unitType: r.unit_type,
      isActive: r.is_active,
      canRead: r.can_read,
      canRecord: r.can_record,
    })),
  };
}

/** nexus.minute_list(). A unit outside the scope answers no rows (database M7). */
export async function readMinuteList(
  supabase: SupabaseClient,
  filters: MinuteListFilters,
  page: number,
  pageSize: number,
): Promise<MinuteResult<MinutePage>> {
  const result = await callRpc(supabase, "minute_list", z.array(minuteRow), {
    p_search: filters.search,
    p_unit_id: filters.unitId,
    p_period: filters.period,
    p_status: filters.status,
    p_page: page,
    p_page_size: pageSize,
  });
  if (!result.ok) return result;
  const paged = toPaged(
    "minute_list",
    result.data,
    pageSize,
    (r): MinuteRow => ({
      rowNo: r.row_no,
      minuteId: r.minute_id,
      unitId: r.org_unit_id,
      unitName: r.unit_name,
      unitType: r.unit_type,
      meetingDate: r.meeting_date,
      title: r.title,
      topic: r.topic,
      status: r.status,
      periodId: r.period_id,
      periodLabel: r.period_label,
      fileCount: r.file_count,
      createdAt: r.created_at,
      version: r.version,
    }),
  );
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filters } };
}

/** nexus.minute_detail(). An unknown id or a minute outside the scope answers not_found "minute". */
export async function readMinuteDetail(supabase: SupabaseClient, minuteId: string): Promise<MinuteResult<MinuteDetail>> {
  const result = await callRpc(supabase, "minute_detail", minuteDetailJson, { p_minute_id: minuteId });
  if (!result.ok) return result;
  return { ok: true, data: toMinuteDetail(result.data) };
}

/** nexus.minute_dashboard_counts(): one row, counts only. */
export async function readMinuteDashboardCounts(supabase: SupabaseClient): Promise<MinuteResult<MinuteDashboardCounts>> {
  const result = await callRpc(supabase, "minute_dashboard_counts", oneRow(dashboardRow));
  if (!result.ok) return result;
  const r = result.data;
  return {
    ok: true,
    data: {
      periodId: r.period_id,
      periodLabel: r.period_label,
      periodStartsOn: r.period_starts_on,
      periodEndsOn: r.period_ends_on,
      minuteCount: r.minute_count,
      latestMeetingDate: r.latest_meeting_date,
    },
  };
}

// =============================================================================================
// Writes (minutes.manage; actor, period and creator always from the session inside the database)
// =============================================================================================

export type MinuteRecordArgs = {
  unitId: string;
  meetingDate: string;
  title: string;
  topic: string;
  content: string;
  decision: string | null;
  files: FileRef[];
};

/** nexus.minute_record(). */
export async function recordMinuteRow(supabase: SupabaseClient, input: MinuteRecordArgs): Promise<MinuteResult<MinuteRecordResult>> {
  const result = await callRpc(supabase, "minute_record", oneRow(z.object({ minute_id: uuid, version })), {
    p_org_unit_id: input.unitId,
    p_meeting_date: input.meetingDate,
    p_title: input.title,
    p_topic: input.topic,
    p_content: input.content,
    p_decision: input.decision,
    p_files: filesArg(input.files),
  });
  if (!result.ok) return result;
  return { ok: true, data: { minuteId: result.data.minute_id, version: result.data.version } };
}

export type MinuteUpdateArgs = {
  minuteId: string;
  version: number;
  meetingDate: string;
  title: string;
  topic: string;
  content: string;
  decision: string | null;
};

/** nexus.minute_update(). Unit and period are not parameters (A-MN4). */
export async function updateMinuteRow(supabase: SupabaseClient, input: MinuteUpdateArgs): Promise<MinuteResult<MinuteUpdateResult>> {
  const result = await callRpc(supabase, "minute_update", oneRow(z.object({ minute_id: uuid, changed: bool, version })), {
    p_minute_id: input.minuteId,
    p_version: input.version,
    p_meeting_date: input.meetingDate,
    p_title: input.title,
    p_topic: input.topic,
    p_content: input.content,
    p_decision: input.decision,
  });
  if (!result.ok) return result;
  return { ok: true, data: { minuteId: result.data.minute_id, changed: result.data.changed, version: result.data.version } };
}

const filesResultRow = oneRow(z.object({ minute_id: uuid, file_count: count, version }));

/** nexus.minute_add_files(). */
export async function addMinuteFileRows(
  supabase: SupabaseClient,
  input: { minuteId: string; version: number; files: FileRef[] },
): Promise<MinuteResult<MinuteFilesResult>> {
  const result = await callRpc(supabase, "minute_add_files", filesResultRow, {
    p_minute_id: input.minuteId,
    p_version: input.version,
    p_files: filesArg(input.files),
  });
  if (!result.ok) return result;
  return { ok: true, data: { minuteId: result.data.minute_id, fileCount: result.data.file_count, version: result.data.version } };
}

/** nexus.minute_withdraw_file(). `version` is the MINUTE's version. */
export async function withdrawMinuteFileRow(
  supabase: SupabaseClient,
  input: { fileId: number; version: number; reason: string },
): Promise<MinuteResult<MinuteFilesResult>> {
  const result = await callRpc(supabase, "minute_withdraw_file", filesResultRow, {
    p_file_id: input.fileId,
    p_version: input.version,
    p_reason: input.reason,
  });
  if (!result.ok) return result;
  return { ok: true, data: { minuteId: result.data.minute_id, fileCount: result.data.file_count, version: result.data.version } };
}

/** nexus.minute_void(). Never restored (A-MN15). */
export async function voidMinuteRow(
  supabase: SupabaseClient,
  input: { minuteId: string; version: number; reason: string },
): Promise<MinuteResult<MinuteVoidResult>> {
  const result = await callRpc(supabase, "minute_void", oneRow(z.object({ minute_id: uuid, status: minuteStatusSchema, version })), {
    p_minute_id: input.minuteId,
    p_version: input.version,
    p_reason: input.reason,
  });
  if (!result.ok) return result;
  return { ok: true, data: { minuteId: result.data.minute_id, status: result.data.status, version: result.data.version } };
}

// =============================================================================================
// Export (minutes.export; VOLATILE, writes the export-log row: call exactly once per export)
// =============================================================================================

export type MinuteExportTarget = { kind: "list"; filters: MinuteListFilters } | { kind: "single"; minuteId: string };

/**
 * nexus.minute_export(): the list's rows (all pages) inside the caller's EXPORT scope, or one minute,
 * plus the full-result count. More than 1000 rows = too_many_rows (export_too_large with the count)
 * before any log row. "single" sends only p_format and p_minute_id (the list filters are ignored).
 */
export async function exportMinuteRows(
  supabase: SupabaseClient,
  format: MinuteExportFormat,
  target: MinuteExportTarget,
): Promise<MinuteResult<CountedRows<MinuteExportRow>>> {
  const args =
    target.kind === "single"
      ? { p_format: format, p_minute_id: target.minuteId }
      : {
          p_format: format,
          p_search: target.filters.search,
          p_unit_id: target.filters.unitId,
          p_period: target.filters.period,
          p_status: target.filters.status,
        };
  const result = await callRpc(supabase, "minute_export", z.array(exportRow), args);
  if (!result.ok) return result;
  const totalCount = readTotalCount(result.data);
  if (totalCount === null) return fail("minute_export", "inconsistent_total");
  return {
    ok: true,
    data: {
      totalCount,
      rows: result.data.map((r) => ({
        rowNo: r.row_no,
        minuteId: r.minute_id,
        meetingDate: r.meeting_date,
        unitName: r.unit_name,
        unitType: r.unit_type,
        title: r.title,
        topic: r.topic,
        content: r.content,
        decision: r.decision,
        status: r.status,
        voidReason: r.void_reason,
        periodLabel: r.period_label,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
        fileCount: r.file_count,
      })),
    },
  };
}

// =============================================================================================
// Minute files (private bucket; Storage policies call minute_file_can_upload / _can_read)
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
 * (upsert false): the path has a fresh random name, so a clash means a bug (unavailable). The caller
 * already checked minutes.manage and the active period, so a policy refusal is the 24-hour cap.
 */
export async function uploadMinuteFile(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: MinuteFileMimeType,
  name: string,
): Promise<MinuteResult<MinuteFileUploadResult>> {
  if (!MINUTE_FILE_PATH_PATTERN.test(path)) return fail("storage.upload", "bad_path");
  try {
    const { data, error } = await supabase.storage.from(MINUTE_FILE_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error) {
      const raw = error as StorageErrorLike;
      if (isPolicyRefusal(raw)) return { ok: false, error: { code: "upload_limit", limit: MINUTE_LIMITS.unattachedUploadsPer24h } };
      if (isTooLarge(raw)) return { ok: false, error: { code: "file_too_large", field: "file", ref: null, maxMb: MINUTE_FILE_MAX_MB } };
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
 * One signed link for a file the caller may read. minute_detail (ONE RPC) decides whether the caller
 * may read the minute at all and lists only the files the database lets THIS caller see (withdrawn ones
 * only for managers of the unit); a file not among them is not_found "file". The path is then signed
 * with the USER's client, so the bucket policy minute_file_can_read checks again (a refusal is
 * not_found "file"). The path never leaves the server.
 */
export async function readMinuteFileLink(
  supabase: SupabaseClient,
  input: { minuteId: string; fileId: number },
  ttlSeconds: number,
): Promise<MinuteResult<MinuteFileLink>> {
  const detail = await callRpc(supabase, "minute_detail", minuteDetailJson, { p_minute_id: input.minuteId });
  if (!detail.ok) return detail;

  const file = detail.data.files.find((f) => f.file_id === input.fileId);
  if (file === undefined || !MINUTE_FILE_PATH_PATTERN.test(file.storage_path)) return FILE_NOT_FOUND;

  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { data, error } = await supabase.storage.from(MINUTE_FILE_BUCKET).createSignedUrl(file.storage_path, ttlSeconds);
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
