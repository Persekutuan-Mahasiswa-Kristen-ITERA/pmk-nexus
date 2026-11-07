import {
  isoDateSchema,
  itemConditionSchema,
  myRequestsFilterSchema,
  type ItemCondition,
  type MyRequestsFilter,
} from "../types";

// Addresses of the inventory screens (docs/design/inventory-borrowing.md 4.3) and the safe reading of
// their query parameters. The address is user-editable: nothing here throws, unknown values fall back
// to the default, and the server validates again (zod in the contract, then the database).

export const INVENTORY_PATH = "/inventaris";
export const MY_REQUESTS_PATH = "/inventaris/saya";
export const REQUEST_FORM_PATH = "/inventaris/ajukan";

/** Query parameter names. Short English names, like Data Anggota ("q", "page"). */
export const INVENTORY_PARAMS = {
  search: "q",
  categoryId: "category",
  locationId: "location",
  condition: "condition",
  from: "from",
  to: "to",
  page: "page",
  filter: "filter",
  itemId: "item",
  again: "again",
  /** One-time success notice after a save ("sent", "cancelled"). */
  notice: "notice",
} as const;

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a parameter (a repeated parameter uses its first value). */
export function firstParam(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readId(value: string | undefined): string | null {
  return value !== undefined && GUID.test(value) ? value : null;
}

export function readDate(value: string | undefined): string | null {
  return isoDateSchema.safeParse(value).success ? (value as string) : null;
}

/** Plain positive integers only ("3"); anything else is page 1. */
export function readPage(value: string | undefined): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** Longest search text kept from the address: one more than the database accepts, so "too long" shows. */
const SEARCH_KEEP_LIMIT = 481;

// ---- Katalog ----

export type CatalogUrlState = {
  search: string;
  categoryId: string | null;
  locationId: string | null;
  condition: ItemCondition | null;
  from: string | null;
  to: string | null;
  page: number;
};

export const CATALOG_DEFAULTS: CatalogUrlState = {
  search: "",
  categoryId: null,
  locationId: null,
  condition: null,
  from: null,
  to: null,
  page: 1,
};

export function readCatalogParams(params: SearchParams): CatalogUrlState {
  const search = firstParam(params, INVENTORY_PARAMS.search) ?? "";
  const condition = itemConditionSchema.safeParse(firstParam(params, INVENTORY_PARAMS.condition));
  return {
    search: search.trim() === "" ? "" : search.slice(0, SEARCH_KEEP_LIMIT),
    categoryId: readId(firstParam(params, INVENTORY_PARAMS.categoryId)),
    locationId: readId(firstParam(params, INVENTORY_PARAMS.locationId)),
    condition: condition.success ? condition.data : null,
    from: readDate(firstParam(params, INVENTORY_PARAMS.from)),
    to: readDate(firstParam(params, INVENTORY_PARAMS.to)),
    page: readPage(firstParam(params, INVENTORY_PARAMS.page)),
  };
}

/** The list parameters in address form (no page), for links and pagination. */
export function catalogParams(state: Partial<CatalogUrlState>): Record<string, string> {
  const full = { ...CATALOG_DEFAULTS, ...state };
  const out: Record<string, string> = {};
  const search = full.search.trim();
  if (search !== "") out[INVENTORY_PARAMS.search] = search;
  if (full.categoryId) out[INVENTORY_PARAMS.categoryId] = full.categoryId;
  if (full.locationId) out[INVENTORY_PARAMS.locationId] = full.locationId;
  if (full.condition) out[INVENTORY_PARAMS.condition] = full.condition;
  if (full.from && full.to) {
    out[INVENTORY_PARAMS.from] = full.from;
    out[INVENTORY_PARAMS.to] = full.to;
  }
  return out;
}

/** Katalog address for a list state. Defaults are left out, so "Reset" is simply /inventaris. */
export function catalogHref(state: Partial<CatalogUrlState> = {}): string {
  const params = new URLSearchParams(catalogParams(state));
  const page = state.page ?? 1;
  if (page > 1) params.set(INVENTORY_PARAMS.page, String(page));
  const query = params.toString();
  return query ? `${INVENTORY_PATH}?${query}` : INVENTORY_PATH;
}

export function isDefaultCatalog(state: CatalogUrlState): boolean {
  return (
    state.search.trim() === "" &&
    !state.categoryId &&
    !state.locationId &&
    !state.condition &&
    !(state.from && state.to)
  );
}

// ---- Item detail ----

/** /inventaris/barang/{id}; `back` keeps the catalog filters so "< Katalog" returns to the same list. */
export function itemHref(itemId: string, back?: Record<string, string>): string {
  const query = back ? new URLSearchParams(back).toString() : "";
  return `${INVENTORY_PATH}/barang/${encodeURIComponent(itemId)}${query ? `?${query}` : ""}`;
}

// ---- Peminjaman Saya ----

export function readMyRequestsParams(params: SearchParams): { filter: MyRequestsFilter; page: number } {
  const filter = myRequestsFilterSchema.safeParse(firstParam(params, INVENTORY_PARAMS.filter));
  return {
    filter: filter.success ? filter.data : "open",
    page: readPage(firstParam(params, INVENTORY_PARAMS.page)),
  };
}

export function myRequestsParams(filter: MyRequestsFilter): Record<string, string> {
  return filter === "open" ? {} : { [INVENTORY_PARAMS.filter]: filter };
}

export function myRequestsHref(filter: MyRequestsFilter = "open", page = 1): string {
  const params = new URLSearchParams(myRequestsParams(filter));
  if (page > 1) params.set(INVENTORY_PARAMS.page, String(page));
  const query = params.toString();
  return query ? `${MY_REQUESTS_PATH}?${query}` : MY_REQUESTS_PATH;
}

// ---- Detail Pengajuan ----

/** /inventaris/pengajuan/{ref}, optionally with a one-time notice ("sent", "cancelled"). */
export function requestHref(reference: string, notice?: RequestNotice): string {
  const base = `${INVENTORY_PATH}/pengajuan/${encodeURIComponent(reference)}`;
  return notice ? `${base}?${INVENTORY_PARAMS.notice}=${notice}` : base;
}

export type RequestNotice = "sent" | "sent_outside" | "cancelled";

export function readRequestNotice(params: SearchParams): RequestNotice | null {
  const value = firstParam(params, INVENTORY_PARAMS.notice);
  return value === "sent" || value === "sent_outside" || value === "cancelled" ? value : null;
}

// ---- Request form ----

/**
 * /inventaris/ajukan. "Ajukan barang ini" passes the item and the checked dates; "Ajukan lagi" (P11)
 * passes the old reference so the form starts from that request.
 */
export function requestFormHref(prefill: { itemId?: string; from?: string | null; to?: string | null; again?: string } = {}): string {
  const params = new URLSearchParams();
  if (prefill.itemId) params.set(INVENTORY_PARAMS.itemId, prefill.itemId);
  if (prefill.from && prefill.to) {
    params.set(INVENTORY_PARAMS.from, prefill.from);
    params.set(INVENTORY_PARAMS.to, prefill.to);
  }
  if (prefill.again) params.set(INVENTORY_PARAMS.again, prefill.again);
  const query = params.toString();
  return query ? `${REQUEST_FORM_PATH}?${query}` : REQUEST_FORM_PATH;
}
