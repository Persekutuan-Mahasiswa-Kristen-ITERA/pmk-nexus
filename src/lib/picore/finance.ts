import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  FINANCE_PROOF_BUCKET,
  FINANCE_PROOF_MAX_MB,
  FINANCE_PROOF_PATH_PATTERN,
  FINANCE_LIMITS,
  buildFinancePage,
  financeEntryDetailDbSchema,
  financeEntryListDbSchema,
  financeErrorFromDb,
  financeExportDbSchema,
  financePeriodListDbSchema,
  financeProofDbSchema,
  financeRecordDbSchema,
  financeSummaryDbSchema,
  financeVoidDbSchema,
  type FinanceAction,
  type FinanceEntryDetail,
  type FinanceEntryDetailAnswer,
  type FinanceEntryPage,
  type FinanceError,
  type FinanceExportAnswer,
  type FinanceListFilters,
  type FinancePeriodOption,
  type FinanceProofLink,
  type FinanceProofMimeType,
  type FinanceProofResult,
  type FinanceProofUploadResult,
  type FinanceRecordResult,
  type FinanceResult,
  type FinanceSummary,
  type FinanceVoidResult,
} from "@/modules/finance/types";

// Thin typed wrappers around the Finance RPCs (supabase/migrations/20261111200000_nexus_finance.sql,
// reference supabase/README.md section 3.4). These nexus functions check PI-CORE assignments and read
// PI-CORE member names and period labels, so they are called from here and nowhere else (CLAUDE.md 4).
// The proof bucket is here too: its Storage policies run the same PI-CORE-backed checks
// (finance_proof_can_upload / _can_read), and every `.from(` stays in this layer.
//
// Always with the USER's session client: the database checks the caller again inside every function.
// Inputs must already be validated by the caller (src/modules/finance/server). Answers are parsed with
// the contract's database schemas (a shape mismatch is `unavailable`, fail closed). Money stays text of
// digits end to end: nothing in this file turns an amount into a JS number. Nothing here throws.
// Only src/modules/finance/server/ may import this file.

// =============================================================================================
// Error mapping (contract section 9: ONLY through financeErrorFromDb)
// =============================================================================================

const UNAVAILABLE: FinanceError = { code: "unavailable" };

/** SQLSTATEs the module raises on purpose. Anything else (also with a known hint) is unavailable. */
const KNOWN_SQLSTATES: ReadonlySet<string> = new Set(["42501", "P0001", "P0002", "22023"]);

type PostgrestLikeError = { code?: string; hint?: string | null; details?: string | null };

/**
 * A database error as the contract's error union. An unexpected SQLSTATE (network, `nexus` not exposed,
 * missing grant without a hint, 5xx) is `unavailable` before the hint is even read: fail closed, never
 * "no access" and never "no rows". The message is never read.
 */
export function mapFinanceDbError(error: PostgrestLikeError, action: FinanceAction = "read"): FinanceError {
  if (typeof error.code !== "string" || !KNOWN_SQLSTATES.has(error.code)) return UNAVAILABLE;
  const detail = typeof error.details === "string" && error.details !== "" ? error.details : null;
  return financeErrorFromDb(error.hint ?? null, detail, action);
}

// =============================================================================================
// RPC call
// =============================================================================================

type FinanceRpc =
  | "finance_period_list"
  | "finance_summary"
  | "finance_entry_list"
  | "finance_entry_detail"
  | "finance_entry_record"
  | "finance_entry_void"
  | "finance_entry_add_proof"
  | "finance_entry_withdraw_proof"
  | "finance_export";

type Failure = { ok: false; error: FinanceError };

/** Calls one nexus RPC with the USER's client and parses the answer. Never throws. */
async function callRpc<S extends z.ZodType>(
  supabase: SupabaseClient,
  fn: FinanceRpc,
  schema: S,
  args: Record<string, unknown> | undefined,
  action: FinanceAction,
): Promise<FinanceResult<z.output<S>>> {
  try {
    const { data, error } = await supabase.schema("nexus").rpc(fn, args);
    if (error) {
      const mapped = mapFinanceDbError(error, action);
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
  // Function name and code only: never tokens, member ids, names, search text, paths, amounts or row data.
  console.error(`[picore] nexus.${fn}() failed: ${reason}`);
}

// =============================================================================================
// Reads (finance.view)
// =============================================================================================

/** nexus.finance_period_list(): the "Periode" select (active first). */
export async function readFinancePeriods(supabase: SupabaseClient): Promise<FinanceResult<FinancePeriodOption[]>> {
  return callRpc(supabase, "finance_period_list", financePeriodListDbSchema, undefined, "read");
}

/** nexus.finance_summary(): header tiles and hints. periodId null = the active period. */
export async function readFinanceSummary(supabase: SupabaseClient, periodId: string | null): Promise<FinanceResult<FinanceSummary>> {
  return callRpc(supabase, "finance_summary", financeSummaryDbSchema, { p_period_id: periodId }, "read");
}

/** nexus.finance_entry_list(). A page past the end answers the last page (database). */
export async function readFinanceEntries(
  supabase: SupabaseClient,
  filters: FinanceListFilters,
  page: number,
  pageSize: number,
): Promise<FinanceResult<FinanceEntryPage>> {
  const result = await callRpc(
    supabase,
    "finance_entry_list",
    financeEntryListDbSchema,
    {
      p_period_id: filters.periodId,
      p_search: filters.search,
      p_type: filters.type,
      p_from: filters.from,
      p_to: filters.to,
      p_include_voided: filters.includeVoided,
      p_without_proof: filters.withoutProof,
      p_page: page,
      p_page_size: pageSize,
    },
    "read",
  );
  if (!result.ok) return result;
  // A page can never hold more rows than the size asked for (fail closed).
  if (result.data.rows.length > pageSize) return fail("finance_entry_list", "inconsistent_page");
  return { ok: true, data: { ...buildFinancePage(result.data, pageSize), filters } };
}

/**
 * nexus.finance_entry_detail(): the detail AND the stored proof paths, for signing. SERVER ONLY: the
 * caller must hand only `.detail` to the browser.
 */
export async function readFinanceEntryDetailAnswer(
  supabase: SupabaseClient,
  entryId: string,
): Promise<FinanceResult<FinanceEntryDetailAnswer>> {
  return callRpc(supabase, "finance_entry_detail", financeEntryDetailDbSchema, { p_entry_id: entryId }, "read");
}

export async function readFinanceEntryDetail(supabase: SupabaseClient, entryId: string): Promise<FinanceResult<FinanceEntryDetail>> {
  const result = await readFinanceEntryDetailAnswer(supabase, entryId);
  return result.ok ? { ok: true, data: result.data.detail } : result;
}

// =============================================================================================
// Writes (finance.manage; actor, period and number always from the session inside the database)
// =============================================================================================

type FileRef = { path: string; name: string };

/** p_files jsonb: exactly path and name (nothing else the client might have added). */
const filesArg = (files: readonly FileRef[]) => files.map((f) => ({ path: f.path, name: f.name }));

export type FinanceRecordArgs = {
  entryType: "income" | "expense" | "opening";
  entryDate: string;
  /** Digits text, as the database parses it. Never a number. */
  amount: string;
  description: string;
  notes: string | null;
  correctsEntryId: string | null;
  files: FileRef[];
  submitKey: string;
};

/** nexus.finance_entry_record(). `action` picks the amount copy (Saldo awal allows 0). */
export async function recordFinanceEntryRow(supabase: SupabaseClient, input: FinanceRecordArgs): Promise<FinanceResult<FinanceRecordResult>> {
  return callRpc(
    supabase,
    "finance_entry_record",
    financeRecordDbSchema,
    {
      p_idempotency_key: input.submitKey,
      p_entry_type: input.entryType,
      p_entry_date: input.entryDate,
      p_amount: input.amount,
      p_description: input.description,
      p_notes: input.notes,
      p_corrects_entry_id: input.correctsEntryId,
      p_files: filesArg(input.files),
    },
    input.entryType === "opening" ? "recordOpening" : "record",
  );
}

/** nexus.finance_entry_void(). Never restored. */
export async function voidFinanceEntryRow(
  supabase: SupabaseClient,
  input: { entryId: string; reason: string },
): Promise<FinanceResult<FinanceVoidResult>> {
  return callRpc(supabase, "finance_entry_void", financeVoidDbSchema, { p_entry_id: input.entryId, p_reason: input.reason }, "void");
}

/** nexus.finance_entry_add_proof(). */
export async function addFinanceProofRows(
  supabase: SupabaseClient,
  input: { entryId: string; files: FileRef[] },
): Promise<FinanceResult<FinanceProofResult>> {
  return callRpc(supabase, "finance_entry_add_proof", financeProofDbSchema, { p_entry_id: input.entryId, p_files: filesArg(input.files) }, "addProof");
}

/** nexus.finance_entry_withdraw_proof(). The record and the stored file stay (L5). */
export async function withdrawFinanceProofRow(
  supabase: SupabaseClient,
  input: { fileId: number; reason: string },
): Promise<FinanceResult<FinanceProofResult>> {
  return callRpc(
    supabase,
    "finance_entry_withdraw_proof",
    financeProofDbSchema,
    { p_file_id: input.fileId, p_reason: input.reason },
    "withdrawProof",
  );
}

// =============================================================================================
// Export (finance.export; VOLATILE, writes the export-log row: call exactly once per export)
// =============================================================================================

/**
 * nexus.finance_export(): the list's rows (all pages) of one period plus the whole-period summary and the
 * full-result count. More than 1000 rows = too_many_rows (export_too_large with the count) before any
 * log row. The caller compares rows.length with totalCount (a cut answer is refused).
 */
export async function exportFinanceRows(
  supabase: SupabaseClient,
  format: "xlsx" | "csv" | "pdf",
  filters: FinanceListFilters,
): Promise<FinanceResult<FinanceExportAnswer>> {
  return callRpc(
    supabase,
    "finance_export",
    financeExportDbSchema,
    {
      p_format: format,
      p_period_id: filters.periodId,
      p_search: filters.search,
      p_type: filters.type,
      p_from: filters.from,
      p_to: filters.to,
      p_include_voided: filters.includeVoided,
      p_without_proof: filters.withoutProof,
    },
    "export",
  );
}

// =============================================================================================
// Proof files (private bucket; Storage policies call finance_proof_can_upload / _can_read)
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
 * already checked finance.manage and the active period, so a policy refusal is the 24-hour cap.
 */
export async function uploadFinanceProof(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: FinanceProofMimeType,
  name: string,
): Promise<FinanceResult<FinanceProofUploadResult>> {
  if (!FINANCE_PROOF_PATH_PATTERN.test(path)) return fail("storage.upload", "bad_path");
  try {
    const { data, error } = await supabase.storage.from(FINANCE_PROOF_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error) {
      const raw = error as StorageErrorLike;
      if (isPolicyRefusal(raw)) return { ok: false, error: { code: "upload_limit", limit: FINANCE_LIMITS.unattachedUploadsPer24h } };
      if (isTooLarge(raw)) return { ok: false, error: { code: "file_too_large", field: "file", ref: null, maxMb: FINANCE_PROOF_MAX_MB } };
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
 * One signed link for a proof the caller may read. finance_entry_detail (ONE RPC) decides whether the
 * caller may read the entry at all and lists only the proofs the database lets THIS caller see (withdrawn
 * ones only for managers); a file not among them is not_found "file". The path is then signed with the
 * USER's client, so the bucket policy finance_proof_can_read checks again (a refusal is not_found
 * "file"). The path never leaves the server.
 */
export async function readFinanceProofLink(
  supabase: SupabaseClient,
  input: { entryId: string; fileId: number },
  ttlSeconds: number,
): Promise<FinanceResult<FinanceProofLink>> {
  const answer = await readFinanceEntryDetailAnswer(supabase, input.entryId);
  if (!answer.ok) return answer;

  const proof = answer.data.proofPaths.find((p) => p.fileId === input.fileId);
  if (proof === undefined || !FINANCE_PROOF_PATH_PATTERN.test(proof.storagePath)) return FILE_NOT_FOUND;

  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { data, error } = await supabase.storage.from(FINANCE_PROOF_BUCKET).createSignedUrl(proof.storagePath, ttlSeconds);
    if (error) {
      const raw = error as StorageErrorLike;
      // The policy (or a missing object) answers 400/403/404: the file is not readable for this caller.
      const refused = isPolicyRefusal(raw) || raw.status === 400 || raw.status === 404 || raw.statusCode === "400" || raw.statusCode === "404";
      if (refused) return FILE_NOT_FOUND;
      return fail("storage.createSignedUrl", `${raw.status ?? "-"}/${raw.code ?? raw.statusCode ?? "-"}`);
    }
    if (!data || typeof data.signedUrl !== "string" || data.signedUrl === "") return fail("storage.createSignedUrl", "unexpected_shape");
    return { ok: true, data: { fileId: proof.fileId, url: data.signedUrl, expiresAt } };
  } catch {
    return fail("storage.createSignedUrl", "exception");
  }
}
