import "server-only";
import {
  MEMBER_LIST_PARAMS,
  memberStatusFilterSchema,
  memberUnitIdSchema,
  type MemberListQueryInput,
} from "../types";

// Safe reading of the Data Anggota page address (F3 step 4). The address is user-editable, so nothing
// here may throw. Values with an obvious default fall back to it; the search text is kept as typed
// (bounded) so listMembers() can answer invalid_input "search" instead of silently searching for
// something else. The page size is never read from the address (MD-26).

/** Next.js page `searchParams` (already awaited) or a URLSearchParams. */
export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

/** Longest search text kept from the address: one more than the database accepts, so "too long" stays visible. */
const SEARCH_KEEP_LIMIT = 481;
/** Upper bound for the page number; anything above is past the end and the database returns the last page. */
const PAGE_LIMIT = 100_000;

export function parseMemberListSearchParams(params: SearchParamsInput): MemberListQueryInput {
  const search = first(params, MEMBER_LIST_PARAMS.search);
  const unit = first(params, MEMBER_LIST_PARAMS.unitId);
  const status = memberStatusFilterSchema.safeParse(first(params, MEMBER_LIST_PARAMS.status));
  const unitId = memberUnitIdSchema.safeParse(unit);

  return {
    search: search === undefined || search.trim() === "" ? null : search.slice(0, SEARCH_KEEP_LIMIT),
    unitId: unitId.success ? unitId.data : null,
    status: status.success ? status.data : undefined,
    page: parsePage(first(params, MEMBER_LIST_PARAMS.page)),
  };
}

/** First value of a parameter (a repeated parameter uses its first value). */
function first(params: SearchParamsInput, name: string): string | undefined {
  try {
    if (params instanceof URLSearchParams) return params.get(name) ?? undefined;
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  } catch {
    return undefined;
  }
}

/** Only plain positive integers ("3"), else page 1. "1e3", "-2", "0x10" and "2.5" all become 1. */
function parsePage(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return undefined;
  const page = Number(value);
  if (page < 1) return undefined;
  return Math.min(page, PAGE_LIMIT);
}
