import {
  MINUTE_NOTICES,
  MINUTE_PARAMS,
  MINUTE_ROUTES,
  MINUTE_SEARCH_RAW_MAX_LENGTH,
  minuteDetailPath,
  minutePeriodFilterSchema,
  minuteStatusFilterSchema,
  type MinuteNotice,
  type MinutePeriodFilter,
  type MinuteStatusFilter,
} from "../types";

// Addresses of the Meeting Minutes screens and the safe reading of their query parameters. The address is
// user-editable: nothing here throws, unknown values fall back to the defaults, and the server validates
// again (zod in the contract, then the database).

export type SearchParams = Record<string, string | string[] | undefined>;

/** The list state the address holds (screen 1). */
export type ListUrlState = {
  search: string;
  /** An org unit id or null (all units the person may read). */
  unitId: string | null;
  period: MinutePeriodFilter;
  status: MinuteStatusFilter;
  page: number;
};

export const LIST_DEFAULTS: Omit<ListUrlState, "search" | "page"> = { unitId: null, period: "active", status: "active" };

export function firstParam(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string | undefined | null): value is string {
  return typeof value === "string" && GUID.test(value);
}

function readPage(value: string | undefined): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** One more than the raw limit, so "too long" still reaches the server and shows its message. */
const SEARCH_KEEP_LIMIT = MINUTE_SEARCH_RAW_MAX_LENGTH + 1;

export function readListParams(params: SearchParams): ListUrlState {
  const search = firstParam(params, MINUTE_PARAMS.search) ?? "";
  const unit = firstParam(params, MINUTE_PARAMS.unit);
  const period = minutePeriodFilterSchema.safeParse(firstParam(params, MINUTE_PARAMS.period));
  const status = minuteStatusFilterSchema.safeParse(firstParam(params, MINUTE_PARAMS.status));
  return {
    search: search.trim() === "" ? "" : search.slice(0, SEARCH_KEEP_LIMIT),
    unitId: isGuid(unit) ? unit.toLowerCase() : null,
    period: period.success ? period.data : LIST_DEFAULTS.period,
    status: status.success ? status.data : LIST_DEFAULTS.status,
    page: readPage(firstParam(params, MINUTE_PARAMS.page)),
  };
}

/** The list parameters in address form; defaults are left out so the plain address stays plain. */
export function listParams(state: Partial<ListUrlState>): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.search && state.search.trim() !== "") out[MINUTE_PARAMS.search] = state.search.trim();
  if (state.unitId) out[MINUTE_PARAMS.unit] = state.unitId;
  if (state.period && state.period !== LIST_DEFAULTS.period) out[MINUTE_PARAMS.period] = state.period;
  if (state.status && state.status !== LIST_DEFAULTS.status) out[MINUTE_PARAMS.status] = state.status;
  return out;
}

export function listHref(state: Partial<ListUrlState> = {}): string {
  const params = listParams(state);
  if (state.page && state.page > 1) params[MINUTE_PARAMS.page] = String(state.page);
  const query = new URLSearchParams(params).toString();
  return query ? `${MINUTE_ROUTES.list}?${query}` : MINUTE_ROUTES.list;
}

/** Detail address, with a one-time success notice after a save. */
export function minuteHref(minuteId: string, notice?: MinuteNotice): string {
  const path = minuteDetailPath(minuteId);
  return notice ? `${path}?${MINUTE_PARAMS.notice}=${notice}` : path;
}

export function readMinuteNotice(params: SearchParams): MinuteNotice | null {
  const value = firstParam(params, MINUTE_PARAMS.notice);
  return (MINUTE_NOTICES as readonly string[]).includes(value ?? "") ? (value as MinuteNotice) : null;
}
