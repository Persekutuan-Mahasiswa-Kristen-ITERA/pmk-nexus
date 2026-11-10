import {
  FINANCE_NOTICES,
  FINANCE_PARAMS,
  FINANCE_ROUTES,
  FINANCE_SEARCH_RAW_MAX_LENGTH,
  financeEntryPath,
  financeTypeFilterSchema,
  type FinanceListFilters,
  type FinanceNotice,
  type FinanceTypeFilter,
} from "../types";

// Addresses of the Finance screens and the safe reading of their query parameters. The address is
// user-editable: nothing here throws, unknown values fall back to the defaults, and the server validates
// again (zod in the contract, then the database).

export type SearchParams = Record<string, string | string[] | undefined>;

/** The list state the address holds (screen 1). `period` null = the active period. */
export type ListUrlState = {
  search: string;
  period: string | null;
  type: FinanceTypeFilter;
  from: string | null;
  to: string | null;
  includeVoided: boolean;
  withoutProof: boolean;
  page: number;
};

export const LIST_DEFAULTS = { type: "all", includeVoided: false, withoutProof: false } as const;

export function firstParam(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isGuid(value: string | undefined | null): value is string {
  return typeof value === "string" && GUID.test(value);
}

function readPage(value: string | undefined): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** One more than the raw limit, so "too long" still reaches the server and shows its message. */
const SEARCH_KEEP_LIMIT = FINANCE_SEARCH_RAW_MAX_LENGTH + 1;

/** A date from the address: kept as typed when it looks like a date (the server judges it), else absent. */
function readDate(value: string | undefined): string | null {
  return value !== undefined && ISO_DATE.test(value) ? value : null;
}

export function readListParams(params: SearchParams): ListUrlState {
  const search = firstParam(params, FINANCE_PARAMS.search) ?? "";
  const period = firstParam(params, FINANCE_PARAMS.period);
  const type = financeTypeFilterSchema.safeParse(firstParam(params, FINANCE_PARAMS.type));
  return {
    search: search.trim() === "" ? "" : search.slice(0, SEARCH_KEEP_LIMIT),
    period: isGuid(period) ? period.toLowerCase() : null,
    type: type.success ? type.data : LIST_DEFAULTS.type,
    from: readDate(firstParam(params, FINANCE_PARAMS.from)),
    to: readDate(firstParam(params, FINANCE_PARAMS.to)),
    includeVoided: firstParam(params, FINANCE_PARAMS.includeVoided) === "1",
    withoutProof: firstParam(params, FINANCE_PARAMS.withoutProof) === "1",
    page: readPage(firstParam(params, FINANCE_PARAMS.page)),
  };
}

/** The list parameters in address form; defaults are left out so the plain address stays plain. */
export function listParams(state: Partial<ListUrlState>): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.search && state.search.trim() !== "") out[FINANCE_PARAMS.search] = state.search.trim();
  if (state.period) out[FINANCE_PARAMS.period] = state.period;
  if (state.type && state.type !== LIST_DEFAULTS.type) out[FINANCE_PARAMS.type] = state.type;
  if (state.from) out[FINANCE_PARAMS.from] = state.from;
  if (state.to) out[FINANCE_PARAMS.to] = state.to;
  if (state.includeVoided) out[FINANCE_PARAMS.includeVoided] = "1";
  if (state.withoutProof) out[FINANCE_PARAMS.withoutProof] = "1";
  return out;
}

export function listHref(state: Partial<ListUrlState> = {}): string {
  const params = listParams(state);
  if (state.page && state.page > 1) params[FINANCE_PARAMS.page] = String(state.page);
  const query = new URLSearchParams(params).toString();
  return query ? `${FINANCE_ROUTES.list}?${query}` : FINANCE_ROUTES.list;
}

/** The query the page sends to listFinanceEntries (the server validates it again). */
export function toListQuery(values: ListUrlState): { filters: Partial<FinanceListFilters>; page: number } {
  return {
    filters: {
      periodId: values.period,
      search: values.search,
      type: values.type,
      from: values.from,
      to: values.to,
      includeVoided: values.includeVoided,
      withoutProof: values.withoutProof,
    },
    page: values.page,
  };
}

/** Detail address, with a one-time success notice after a save. */
export function entryHref(entryId: string, notice?: FinanceNotice): string {
  const path = financeEntryPath(entryId);
  return notice ? `${path}?${FINANCE_PARAMS.notice}=${notice}` : path;
}

export function readFinanceNotice(params: SearchParams): FinanceNotice | null {
  const value = firstParam(params, FINANCE_PARAMS.notice);
  return (FINANCE_NOTICES as readonly string[]).includes(value ?? "") ? (value as FinanceNotice) : null;
}
