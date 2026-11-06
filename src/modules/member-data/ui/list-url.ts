import {
  MEMBER_LIST_PARAMS,
  MEMBER_STATUS_FILTER_DEFAULT,
  type MemberStatusFilter,
} from "../types";

/** Route of the Data Anggota page (drawer item, forms, reset link). */
export const MEMBER_LIST_PATH = "/data-anggota";

/** What the page address may hold (F3 step 4): search, unit, status, page. Nothing else. */
export type MemberListUrlState = {
  search: string | null;
  unitId: string | null;
  status: MemberStatusFilter;
  page: number;
};

export const MEMBER_LIST_DEFAULTS: MemberListUrlState = {
  search: null,
  unitId: null,
  status: MEMBER_STATUS_FILTER_DEFAULT,
  page: 1,
};

/** Address for a list state. Defaults are left out so "Reset" is simply /data-anggota. */
export function memberListHref(state: Partial<MemberListUrlState>): string {
  const full = { ...MEMBER_LIST_DEFAULTS, ...state };
  const params = new URLSearchParams();
  const search = full.search?.trim() ?? "";
  if (search !== "") params.set(MEMBER_LIST_PARAMS.search, search);
  if (full.unitId) params.set(MEMBER_LIST_PARAMS.unitId, full.unitId);
  if (full.status !== MEMBER_STATUS_FILTER_DEFAULT) params.set(MEMBER_LIST_PARAMS.status, full.status);
  if (full.page > 1) params.set(MEMBER_LIST_PARAMS.page, String(full.page));
  const query = params.toString();
  return query ? `${MEMBER_LIST_PATH}?${query}` : MEMBER_LIST_PATH;
}

/** True when search and filters are at their defaults (used to word the empty state). */
export function isDefaultFilter(state: Pick<MemberListUrlState, "search" | "unitId" | "status">): boolean {
  return !state.search && !state.unitId && state.status === MEMBER_STATUS_FILTER_DEFAULT;
}
