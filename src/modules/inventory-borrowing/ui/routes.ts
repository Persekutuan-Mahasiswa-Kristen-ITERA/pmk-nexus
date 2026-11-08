import {
  catalogStatusFilterSchema,
  inventoryListKindSchema,
  isoDateSchema,
  itemConditionSchema,
  myRequestsFilterSchema,
  queueViewSchema,
  type CatalogStatusFilter,
  type InventoryListKind,
  type ItemCondition,
  type MyRequestsFilter,
  type QueueView,
} from "../types";

// Addresses of the inventory screens (docs/design/inventory-borrowing.md 4.3) and the safe reading of
// their query parameters. The address is user-editable: nothing here throws, unknown values fall back
// to the default, and the server validates again (zod in the contract, then the database).

export const INVENTORY_PATH = "/inventaris";
export const MY_REQUESTS_PATH = "/inventaris/saya";
export const REQUEST_FORM_PATH = "/inventaris/ajukan";
export const QUEUE_PATH = "/inventaris/antrean";
export const MANAGE_PATH = "/inventaris/kelola";
export const ITEM_NEW_PATH = "/inventaris/kelola/barang/baru";
export const LISTS_PATH = "/inventaris/kelola/daftar";

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
  status: "status",
  view: "view",
  periodId: "period",
  kind: "kind",
  /** Codes named in the "Barang disimpan" notice after creating an item. */
  code: "code",
  lastCode: "last",
  count: "n",
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

/**
 * Katalog address for a list state. Defaults are left out, so "Reset" is simply /inventaris.
 * Kelola Barang reuses the same filters on its own path, with its status filter as `extra`.
 */
export function catalogHref(
  state: Partial<CatalogUrlState> = {},
  basePath: string = INVENTORY_PATH,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ ...catalogParams(state), ...extra });
  const page = state.page ?? 1;
  if (page > 1) params.set(INVENTORY_PARAMS.page, String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
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

/** Handover ("Serahkan barang", design 12) and return ("Terima pengembalian", design 13) pages. */
export function handoverHref(reference: string): string {
  return `${requestHref(reference)}/serah-terima`;
}
export function returnHref(reference: string): string {
  return `${requestHref(reference)}/terima-kembali`;
}

const REQUEST_NOTICES = [
  "sent",
  "sent_outside",
  "cancelled",
  "approved",
  "rejected",
  "extended",
  "handed_over",
  "returned_all",
  "returned_partial",
  "returned_issue",
  "corrected",
] as const;

export type RequestNotice = (typeof REQUEST_NOTICES)[number];

export function readRequestNotice(params: SearchParams): RequestNotice | null {
  const value = firstParam(params, INVENTORY_PARAMS.notice);
  return (REQUEST_NOTICES as readonly string[]).includes(value ?? "") ? (value as RequestNotice) : null;
}

// ---- Antrean (design 11.1, 14) ----

export type QueueUrlState = {
  view: QueueView;
  search: string;
  from: string | null;
  to: string | null;
  periodId: string | null;
  page: number;
};

/** Reads the Antrean address. `defaultView` depends on the person (heads, Operations, BPH). */
export function readQueueParams(params: SearchParams, defaultView: QueueView): QueueUrlState {
  const view = queueViewSchema.safeParse(firstParam(params, INVENTORY_PARAMS.view));
  const search = firstParam(params, INVENTORY_PARAMS.search) ?? "";
  return {
    view: view.success ? view.data : defaultView,
    search: search.trim() === "" ? "" : search.slice(0, SEARCH_KEEP_LIMIT),
    from: readDate(firstParam(params, INVENTORY_PARAMS.from)),
    to: readDate(firstParam(params, INVENTORY_PARAMS.to)),
    periodId: readId(firstParam(params, INVENTORY_PARAMS.periodId)),
    page: readPage(firstParam(params, INVENTORY_PARAMS.page)),
  };
}

/** Antrean parameters in address form (no page). The view is always written, so links stay exact. */
export function queueParams(state: Partial<QueueUrlState> & { view: QueueView }): Record<string, string> {
  const out: Record<string, string> = { [INVENTORY_PARAMS.view]: state.view };
  const search = (state.search ?? "").trim();
  if (search !== "") out[INVENTORY_PARAMS.search] = search;
  if (state.from && state.to) {
    out[INVENTORY_PARAMS.from] = state.from;
    out[INVENTORY_PARAMS.to] = state.to;
  }
  if (state.periodId) out[INVENTORY_PARAMS.periodId] = state.periodId;
  return out;
}

export function queueHref(state: Partial<QueueUrlState> & { view: QueueView }): string {
  const params = new URLSearchParams(queueParams(state));
  if ((state.page ?? 1) > 1) params.set(INVENTORY_PARAMS.page, String(state.page));
  return `${QUEUE_PATH}?${params.toString()}`;
}

// ---- Kelola Barang (design 7, 8) ----

export function readManageStatus(params: SearchParams): CatalogStatusFilter {
  const status = catalogStatusFilterSchema.safeParse(firstParam(params, INVENTORY_PARAMS.status));
  return status.success ? status.data : "active";
}

export function manageExtra(status: CatalogStatusFilter): Record<string, string> {
  return status === "active" ? {} : { [INVENTORY_PARAMS.status]: status };
}

/** /inventaris/kelola/barang/{id}: the edit form. */
export function itemEditHref(itemId: string): string {
  return `${MANAGE_PATH}/barang/${encodeURIComponent(itemId)}`;
}

export function readListKind(params: SearchParams): InventoryListKind {
  const kind = inventoryListKindSchema.safeParse(firstParam(params, INVENTORY_PARAMS.kind));
  return kind.success ? kind.data : "category";
}

export function listsHref(kind: InventoryListKind = "category"): string {
  return kind === "category" ? LISTS_PATH : `${LISTS_PATH}?${INVENTORY_PARAMS.kind}=${kind}`;
}

// ---- Item notices (design 7.5) ----

export type ItemNotice =
  | { kind: "created_quantity"; code: string }
  | { kind: "created_tracked"; count: number; first: string; last: string }
  | { kind: "saved" }
  | { kind: "reactivated" };

const INV_CODE = /^INV-[0-9]{4,16}$/;

/** Item detail address with a one-time notice after a manager saved something. */
export function itemNoticeHref(itemId: string, notice: ItemNotice): string {
  const params = new URLSearchParams({ [INVENTORY_PARAMS.notice]: notice.kind });
  if (notice.kind === "created_quantity") params.set(INVENTORY_PARAMS.code, notice.code);
  if (notice.kind === "created_tracked") {
    params.set(INVENTORY_PARAMS.count, String(notice.count));
    params.set(INVENTORY_PARAMS.code, notice.first);
    params.set(INVENTORY_PARAMS.lastCode, notice.last);
  }
  return `${INVENTORY_PATH}/barang/${encodeURIComponent(itemId)}?${params.toString()}`;
}

/** Only well-formed notices are shown; anything else in the address is ignored. */
export function readItemNotice(params: SearchParams): ItemNotice | null {
  const kind = firstParam(params, INVENTORY_PARAMS.notice);
  const code = firstParam(params, INVENTORY_PARAMS.code) ?? "";
  if (kind === "saved" || kind === "reactivated") return { kind };
  if (kind === "created_quantity" && INV_CODE.test(code)) return { kind, code };
  if (kind === "created_tracked") {
    const last = firstParam(params, INVENTORY_PARAMS.lastCode) ?? "";
    const count = readPage(firstParam(params, INVENTORY_PARAMS.count));
    if (INV_CODE.test(code) && INV_CODE.test(last)) return { kind, count, first: code, last };
  }
  return null;
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
