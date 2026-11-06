// Contract between the Member Data backend (src/lib/picore/member-data.ts, src/modules/member-data/server)
// and the UI (src/modules/member-data/ui, src/app). Written 2026-11-06 by the backend engineer.
// Change it only after telling the tech lead: both sides depend on it.
// Spec: docs/modules/member-data.md rev. 2 (sections 2-5, 9). Decisions: D-010, D-019, D-020.
// Database: supabase/README.md section 3 (nexus.member_data_* functions).
//
// Pure and isomorphic: safe to import from Server Components, Client Components and route handlers.
// No type here holds email, phone, NIM, NIP, user id or access level (L4, MD-10). Error codes only:
// the UI owns the Indonesian wording.

import { z } from "zod";
import type { AccessState } from "@/lib/auth/types";

// ---------------------------------------------------------------------------------------------
// Limits (mirror the database caps; the database checks again)
// ---------------------------------------------------------------------------------------------

/** Rows per page on screen (A-MD1). The page address never carries a page size. */
export const MEMBER_LIST_PAGE_SIZE_DEFAULT = 20;
/** Hard server maximum (R16). Larger values are refused, never clamped. */
export const MEMBER_LIST_PAGE_SIZE_MAX = 50;
/** Max search length after trimming and collapsing spaces (PI-CORE name length). */
export const MEMBER_SEARCH_MAX_LENGTH = 120;
/** Max RAW search length; longer input is refused before any cleaning (DB review L1). */
export const MEMBER_SEARCH_RAW_MAX_LENGTH = 480;
/** Export-log page size: default and maximum are both 50 (database default). */
export const MEMBER_EXPORT_LOG_PAGE_SIZE_MAX = 50;

/**
 * Names of the page-address parameters (F3 step 4: search, filters and page only) and of the export
 * form fields (POST /api/member-data/export uses the same names plus `format`).
 */
export const MEMBER_LIST_PARAMS = {
  search: "q",
  unitId: "unit",
  status: "status",
  page: "page",
  format: "format",
} as const;

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

/** Status filter (M1): Aktif (default), Nonaktif, Semua. */
export const memberStatusFilterSchema = z.enum(["active", "inactive", "all"]);
export type MemberStatusFilter = z.infer<typeof memberStatusFilterSchema>;
export const MEMBER_STATUS_FILTER_DEFAULT: MemberStatusFilter = "active";

/** Export formats (M5): one "Ekspor" button with exactly these three. */
export const memberExportFormatSchema = z.enum(["xlsx", "csv", "pdf"]);
export type MemberExportFormat = z.infer<typeof memberExportFormatSchema>;

/** Unit types offered by the unit filter (R5): never the root, never a division. */
export type MemberUnitType = "bph" | "department" | "bureau";

// ---------------------------------------------------------------------------------------------
// Input schemas (used by the server; the UI may reuse them for early feedback)
// ---------------------------------------------------------------------------------------------

/**
 * Search: name only (F2). Trimmed, runs of whitespace collapsed, blank = no search (null).
 * Same cleaning and caps as nexus._member_data_clean_search, so both sides agree on "too long".
 */
export const memberSearchSchema = z
  .string()
  .max(MEMBER_SEARCH_RAW_MAX_LENGTH)
  .transform((raw) => raw.trim().replace(/\s+/g, " "))
  .pipe(z.string().max(MEMBER_SEARCH_MAX_LENGTH))
  .transform((clean) => (clean === "" ? null : clean));

/** PI-CORE org_units.id. z.guid() (not z.uuid()) because seeded PI-CORE ids are not all RFC 4122. */
export const memberUnitIdSchema = z.guid();

/** Validated filters shared by the list and the export (R15: export never shows more than the screen). */
export const memberListFiltersSchema = z.object({
  search: memberSearchSchema.nullable().default(null),
  unitId: memberUnitIdSchema.nullable().default(null),
  status: memberStatusFilterSchema.default(MEMBER_STATUS_FILTER_DEFAULT),
});

export const memberListQuerySchema = memberListFiltersSchema.extend({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MEMBER_LIST_PAGE_SIZE_MAX).default(MEMBER_LIST_PAGE_SIZE_DEFAULT),
});

export const memberExportLogQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MEMBER_EXPORT_LOG_PAGE_SIZE_MAX).default(MEMBER_EXPORT_LOG_PAGE_SIZE_MAX),
});

/** What callers pass in (all fields optional; defaults applied by the server). */
export type MemberListQueryInput = z.input<typeof memberListQuerySchema>;
/** After validation: search is cleaned (null = none), every field present. */
export type MemberListFilters = z.output<typeof memberListFiltersSchema>;
export type MemberListQuery = z.output<typeof memberListQuerySchema>;
export type MemberExportLogQueryInput = z.input<typeof memberExportLogQuerySchema>;
export type MemberExportLogQuery = z.output<typeof memberExportLogQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------------------------

/**
 * One row = one member (R1, MD-15). Unit and position are the PRIMARY active-period assignment (M3).
 * null = show "-" (R2, R10). Allowed fields only (L4, D-010, D-019).
 */
export type MemberRow = {
  /** Running number across pages ("No", F4 step 3), computed by the database. */
  rowNo: number;
  /** PI-CORE members.id. Row key only; not displayed. */
  memberId: string;
  fullName: string;
  /** member_type = 'lecturer': show the "Pembina" marker (M6). */
  isLecturer: boolean;
  /** true = Aktif, false = Nonaktif (M1). */
  isActive: boolean;
  /** Name of the primary assignment's unit; null = no assignment in the active period. */
  unitName: string | null;
  /** Parent department name, only when the unit is a division (R4). Display: "Parent · Unit". */
  parentUnitName: string | null;
  /** Name of the primary assignment's position; null = no assignment. */
  positionName: string | null;
};

export type MemberListPage = {
  rows: MemberRow[];
  /** Matches for the current search and filters (the "dari N anggota" counter). */
  total: number;
  /** The page actually returned. A page past the end returns the last page (F4 step 2). */
  page: number;
  pageSize: number;
  /** max(1, ceil(total / pageSize)). */
  pageCount: number;
  /** The validated filters the rows were read with (send these, not raw URL values, to the export). */
  filters: MemberListFilters;
};

/** Unit filter option (R5): active bph/department/bureau units, already in PI-CORE order. */
export type MemberUnitOption = {
  id: string;
  name: string;
  type: MemberUnitType;
};

/** One export-log row (spec 4.2). The exporter's name is looked up at read time; the log stores none. */
export type MemberExportLogEntry = {
  logId: number;
  /** ISO 8601 timestamp (server time). */
  createdAt: string;
  exporterMemberId: string;
  /** Current PI-CORE name; null if the member row no longer exists. */
  exporterName: string | null;
  format: MemberExportFormat;
  /** null = all units. */
  filterUnitId: string | null;
  /** Current unit name; null for "all units" or a unit that no longer exists. */
  filterUnitName: string | null;
  filterStatus: MemberStatusFilter;
  /** Whether a search term was used. The text itself is never stored (A-MD11). */
  searchUsed: boolean;
  periodId: string;
  periodLabel: string | null;
};

export type MemberExportLogPage = {
  entries: MemberExportLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

// ---------------------------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------------------------

/** Which input was refused. `request` = the request itself was malformed (export body, too large). */
export type MemberDataInputField = "search" | "unitId" | "status" | "page" | "pageSize" | "format" | "request";

/**
 * Error codes. The UI maps them to the spec's Indonesian copy (F6):
 * - unauthenticated: no valid session -> login with "Sesi kamu berakhir" (HTTP 401).
 * - forbidden: signed in but not allowed (missing permission, no access, temporary password,
 *   cross-site request) -> "no permission" page or "Aksesmu sudah berubah" (HTTP 403).
 * - invalid_input: a value was refused; `field` says which (HTTP 400).
 * - unavailable: PI-CORE/database unreachable or an unexpected answer -> "Terjadi gangguan" (HTTP 503).
 *   Fail closed: never shown as "no access", never a sign-out (AR10).
 */
export type MemberDataError =
  | { code: "unauthenticated" }
  | { code: "forbidden" }
  | { code: "invalid_input"; field: MemberDataInputField }
  | { code: "unavailable" };

export type MemberDataResult<T> = { ok: true; data: T } | { ok: false; error: MemberDataError };

/** JSON body of every non-2xx answer from POST /api/member-data/export. */
export type MemberExportErrorBody = { error: MemberDataError };

// ---------------------------------------------------------------------------------------------
// Pure helpers (shared by the screen and the export so both show the same text)
// ---------------------------------------------------------------------------------------------

/** Placeholder for "no value" (unit/position of a member without an assignment). */
export const MEMBER_EMPTY_VALUE = "-";

/** Line 1 of "Unit / Jabatan": "Departemen Operasional · Logistik" for a division (R4). null = none. */
export function formatMemberUnit(row: Pick<MemberRow, "unitName" | "parentUnitName">): string | null {
  if (row.unitName === null) return null;
  return row.parentUnitName === null ? row.unitName : `${row.parentUnitName} · ${row.unitName}`;
}

/** What the caller may do in this module. For menus and buttons only; the server checks again. */
export type MemberDataCapabilities = {
  /** member_data.view: drawer item, list page, Dashboard "Members" card. */
  canView: boolean;
  /** member_data.export (needs view, R15): the "Ekspor" button. */
  canExport: boolean;
  /** System Admin (fixed, L3) or member_data.view_export_log. */
  canViewExportLog: boolean;
};

/** Derives the capabilities from the session state. Keys need scope "all" (the only scope offered). */
export function memberDataCapabilities(state: AccessState): MemberDataCapabilities {
  if (state.kind !== "member") return { canView: false, canExport: false, canViewExportLog: false };
  const has = (key: string) => state.permissions.some((grant) => grant.key === key && grant.scope === "all");
  const canView = has("member_data.view");
  return {
    canView,
    canExport: canView && has("member_data.export"),
    canViewExportLog: state.member.isSystemAdmin || has("member_data.view_export_log"),
  };
}

/*
 * Functions the backend provides (signatures are part of this contract). All server only.
 *
 * src/modules/member-data/server/queries.ts
 *   listMembers(input?: MemberListQueryInput): Promise<MemberDataResult<MemberListPage>>
 *   getMemberUnitOptions(): Promise<MemberDataResult<MemberUnitOption[]>>
 *   getActiveMemberCount(): Promise<MemberDataResult<number>>          // Dashboard "Members" (M5b)
 *   listMemberExportLog(input?: MemberExportLogQueryInput): Promise<MemberDataResult<MemberExportLogPage>>
 *     Each checks the session and permission first (getAccessState), validates input with zod, then
 *     calls the database, which checks again. Never throws.
 *
 * src/modules/member-data/server/params.ts
 *   parseMemberListSearchParams(params: SearchParamsInput): MemberListQueryInput
 *     For the page's `searchParams`. Never throws. Bad page/status/unit values fall back to the
 *     defaults; the search text is kept as typed so listMembers can answer invalid_input "search".
 *
 * POST /api/member-data/export  (form body: q, unit, status, format; same names as the page address)
 *   200: the file, Content-Disposition: attachment; filename="data-anggota-YYYY-MM-DD.<ext>" (Asia/Jakarta).
 *   401/403/400/503: JSON MemberExportErrorBody. Other methods: 405. Cross-site requests: 403.
 *   Send the validated `filters` of the MemberListPage the screen shows (status as active/inactive/all).
 *   Writes one export-log row per successful export (database, same transaction).
 */
