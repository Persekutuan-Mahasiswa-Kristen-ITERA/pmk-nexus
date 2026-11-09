import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readTotalCount, type CountedRows } from "@/lib/supabase/limits";
import type {
  MemberDataError,
  MemberDataInputField,
  MemberDataResult,
  MemberExportFormat,
  MemberExportLogEntry,
  MemberExportLogPage,
  MemberExportLogQuery,
  MemberListFilters,
  MemberListPage,
  MemberListQuery,
  MemberRow,
  MemberUnitOption,
} from "@/modules/member-data/types";

// Thin typed wrappers around the Member Data RPCs (supabase/README.md section 3, D-010, D-019).
// These nexus functions read PI-CORE tables on the caller's behalf, so they are called from here and
// nowhere else (CLAUDE.md 4). Always with the USER's session client: the database checks the caller's
// permission inside every function (defense in depth behind the server check in the module).
// Inputs must already be validated by the caller; answers are validated here with zod and only the
// contract's fields survive (z.object strips anything else, so a new PI-CORE column never leaks).
// Only src/modules/member-data/server/ may import this file.

const uuid = z.guid(); // Postgres uuid text form; also accepts seeded non-RFC ids (same as context.ts).
const count = z.number().int().nonnegative();

/** Columns shared by member_data_list() and member_data_export(). unit_type is read but not exposed. */
const memberRowShape = {
  row_no: z.number().int().positive(),
  member_id: uuid,
  full_name: z.string(),
  // Display marker only (M6). A future PI-CORE member type must not break the directory, so any string
  // is accepted and only 'lecturer' turns the marker on.
  member_type: z.string(),
  is_active: z.boolean(),
  unit_name: z.string().nullable(),
  parent_unit_name: z.string().nullable(),
  position_name: z.string().nullable(),
};

const listRow = z.object({
  ...memberRowShape,
  total_count: count,
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

// total_count (migration 20261109100000) = rows of the full filtered result, on every row.
const exportRow = z.object({ ...memberRowShape, total_count: count });

const unitOptionRow = z.object({
  id: uuid,
  name: z.string(),
  type: z.enum(["bph", "department", "bureau"]),
});

const exportLogRow = z.object({
  log_id: z.number().int().positive(),
  created_at: z.string().min(1),
  exporter_member_id: uuid,
  exporter_name: z.string().nullable(),
  format: z.enum(["xlsx", "csv", "pdf"]),
  filter_unit_id: uuid.nullable(),
  filter_unit_name: z.string().nullable(),
  filter_status: z.enum(["active", "inactive", "all"]),
  search_used: z.boolean(),
  period_id: uuid,
  period_label: z.string().nullable(),
  total_count: count,
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

type MemberDataRpc =
  | "member_data_list"
  | "member_data_unit_options"
  | "member_data_active_count"
  | "member_data_export"
  | "member_data_export_log_list";

/** nexus.member_data_list(): one page of the directory. 0 rows = no match (total 0, page 1). */
export async function readMemberList(
  supabase: SupabaseClient,
  query: MemberListQuery,
): Promise<MemberDataResult<MemberListPage>> {
  const result = await callRpc(supabase, "member_data_list", z.array(listRow), {
    p_search: query.search,
    p_unit_id: query.unitId,
    p_status: query.status,
    p_page: query.page,
    p_page_size: query.pageSize,
  });
  if (!result.ok) return result;

  const rows = result.data;
  const filters: MemberListFilters = { search: query.search, unitId: query.unitId, status: query.status };
  if (rows.length === 0) {
    return { ok: true, data: { rows: [], total: 0, page: 1, pageSize: query.pageSize, pageCount: 1, filters } };
  }
  // total/page/page_size repeat on every row; they must agree, and the page must fit (fail closed).
  const { total_count: total, page, page_size: pageSize } = rows[0];
  const consistent = rows.every((r) => r.total_count === total && r.page === page && r.page_size === pageSize);
  if (!consistent || pageSize !== query.pageSize || rows.length > pageSize) {
    return fail("member_data_list", "inconsistent_page");
  }
  return {
    ok: true,
    data: { rows: rows.map(toMemberRow), total, page, pageSize, pageCount: pageCountOf(total, pageSize), filters },
  };
}

/** nexus.member_data_unit_options(): unit filter options, already in PI-CORE order. */
export async function readMemberUnitOptions(supabase: SupabaseClient): Promise<MemberDataResult<MemberUnitOption[]>> {
  const result = await callRpc(supabase, "member_data_unit_options", z.array(unitOptionRow));
  if (!result.ok) return result;
  return { ok: true, data: result.data.map((row) => ({ id: row.id, name: row.name, type: row.type })) };
}

/** nexus.member_data_active_count(): all members with is_active (Dashboard "Members", M5b). */
export async function readActiveMemberCount(supabase: SupabaseClient): Promise<MemberDataResult<number>> {
  return callRpc(supabase, "member_data_active_count", count);
}

/**
 * nexus.member_data_export(): every matching row, no paging, and ONE export-log row in the same
 * transaction (A-MD12: if the log insert fails, the call fails and nothing is returned).
 * VOLATILE: supabase-js .rpc() sends it as POST. Call it exactly once per export.
 */
export async function exportMemberRows(
  supabase: SupabaseClient,
  format: MemberExportFormat,
  filters: MemberListFilters,
): Promise<MemberDataResult<CountedRows<MemberRow>>> {
  const result = await callRpc(supabase, "member_data_export", z.array(exportRow), {
    p_format: format,
    p_search: filters.search,
    p_unit_id: filters.unitId,
    p_status: filters.status,
  });
  if (!result.ok) return result;
  const totalCount = readTotalCount(result.data);
  if (totalCount === null) return fail("member_data_export", "inconsistent_total");
  return { ok: true, data: { rows: result.data.map(toMemberRow), totalCount } };
}

/** nexus.member_data_export_log_list(): newest first (System Admin or member_data.view_export_log). */
export async function readMemberExportLog(
  supabase: SupabaseClient,
  query: MemberExportLogQuery,
): Promise<MemberDataResult<MemberExportLogPage>> {
  const result = await callRpc(supabase, "member_data_export_log_list", z.array(exportLogRow), {
    p_page: query.page,
    p_page_size: query.pageSize,
  });
  if (!result.ok) return result;

  const rows = result.data;
  if (rows.length === 0) {
    return { ok: true, data: { entries: [], total: 0, page: 1, pageSize: query.pageSize, pageCount: 1 } };
  }
  const { total_count: total, page, page_size: pageSize } = rows[0];
  const consistent = rows.every((r) => r.total_count === total && r.page === page && r.page_size === pageSize);
  if (!consistent || pageSize !== query.pageSize || rows.length > pageSize) {
    return fail("member_data_export_log_list", "inconsistent_page");
  }
  const entries: MemberExportLogEntry[] = rows.map((row) => ({
    logId: row.log_id,
    createdAt: row.created_at,
    exporterMemberId: row.exporter_member_id,
    exporterName: row.exporter_name,
    format: row.format,
    filterUnitId: row.filter_unit_id,
    filterUnitName: row.filter_unit_name,
    filterStatus: row.filter_status,
    searchUsed: row.search_used,
    periodId: row.period_id,
    periodLabel: row.period_label,
  }));
  return { ok: true, data: { entries, total, page, pageSize, pageCount: pageCountOf(total, pageSize) } };
}

function toMemberRow(row: z.infer<typeof exportRow>): MemberRow {
  return {
    rowNo: row.row_no,
    memberId: row.member_id,
    fullName: row.full_name,
    isLecturer: row.member_type === "lecturer",
    isActive: row.is_active,
    unitName: row.unit_name,
    parentUnitName: row.parent_unit_name,
    positionName: row.position_name,
  };
}

function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ---------------------------------------------------------------------------------------------
// RPC call and error mapping
// ---------------------------------------------------------------------------------------------

/** Database hints (22023) -> the input field the UI should mark (supabase/README.md section 3). */
const INVALID_INPUT_HINTS: Record<string, MemberDataInputField> = {
  invalid_status: "status",
  invalid_page: "page",
  invalid_page_size: "pageSize",
  invalid_format: "format",
  invalid_unit: "unitId",
  search_too_long: "search",
};

type PostgrestLikeError = { code?: string; hint?: string | null };

/**
 * Maps a database error to the contract's error union. Only two answers are trusted as meaningful:
 * 42501 + hint permission_required (the permission gate) and 22023 + a known input hint. Everything
 * else (network, `nexus` not exposed, missing grant, unknown hint, 5xx) is "unavailable": fail closed,
 * never read as "no access" and never as "no rows".
 */
export function mapMemberDataError(error: PostgrestLikeError): MemberDataError {
  if (error.code === "42501" && error.hint === "permission_required") return { code: "forbidden" };
  if (error.code === "22023" && typeof error.hint === "string") {
    // Own keys only: "constructor" / "toString" must not resolve through the prototype (BUG-MD-01).
    if (Object.hasOwn(INVALID_INPUT_HINTS, error.hint)) {
      return { code: "invalid_input", field: INVALID_INPUT_HINTS[error.hint] };
    }
  }
  return { code: "unavailable" };
}

/** Calls one Member Data RPC with the USER's client and validates the answer. Never throws. */
async function callRpc<T>(
  supabase: SupabaseClient,
  fn: MemberDataRpc,
  schema: z.ZodType<T>,
  args?: Record<string, string | number | null>,
): Promise<MemberDataResult<T>> {
  try {
    const { data, error } = await supabase.schema("nexus").rpc(fn, args);
    if (error) {
      const mapped = mapMemberDataError(error);
      // Expected refusals are not logged as failures; everything else is, with the code only.
      if (mapped.code === "unavailable") logFailure(fn, error.code || "rpc_error");
      return { ok: false, error: mapped };
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) return fail(fn, "unexpected_shape");
    return { ok: true, data: parsed.data };
  } catch {
    return fail(fn, "exception");
  }
}

function fail(fn: MemberDataRpc, reason: string): { ok: false; error: MemberDataError } {
  logFailure(fn, reason);
  return { ok: false, error: { code: "unavailable" } };
}

function logFailure(fn: MemberDataRpc, reason: string): void {
  // Function name and code only: never tokens, user ids, search text, or row data in logs.
  console.error(`[picore] nexus.${fn}() failed: ${reason}`);
}
