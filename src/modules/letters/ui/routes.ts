import {
  defaultLetterQueueView,
  isValidLetterDate,
  LETTER_PARAMS,
  LETTER_SEARCH_RAW_MAX_LENGTH,
  letterPeriodFilterSchema,
  letterQueueViewSchema,
  letterStatusFilterSchema,
  MY_LETTER_REQUESTS_FILTER_DEFAULT,
  myLetterRequestsFilterSchema,
  type LetterCapabilities,
  type LetterPeriodFilter,
  type LetterQueueView,
  type LetterSegment,
  type LetterStatusFilter,
  type LetterType,
  type MyLetterRequestsFilter,
} from "../types";

// Addresses of the Letters screens (docs/design/letters.md 4.3) and the safe reading of their query
// parameters. The address is user-editable: nothing here throws, unknown values fall back to the
// default, and the server validates again (zod in the contract, then the database).

export const LETTERS_PATH = "/surat";
export const INCOMING_PATH = "/surat/masuk";
export const OUTGOING_PATH = "/surat/keluar";
export const MY_REQUESTS_PATH = "/surat/saya";
export const QUEUE_PATH = "/surat/antrean";
export const REQUEST_FORM_PATH = "/surat/ajukan";
export const NUMBERING_PATH = "/pengaturan/penomoran-surat";

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a parameter (a repeated parameter uses its first value). */
export function firstParam(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string | undefined | null): value is string {
  return typeof value === "string" && GUID.test(value);
}

/** Plain positive integers only ("3"); anything else is page 1. */
export function readPage(value: string | undefined): number {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

function readDate(value: string | undefined): string | null {
  return value !== undefined && isValidLetterDate(value) ? value : null;
}

/** Longest search kept from the address: one more than the server accepts, so "too long" shows. */
const SEARCH_KEEP_LIMIT = LETTER_SEARCH_RAW_MAX_LENGTH + 1;

function readSearch(params: SearchParams): string {
  const search = firstParam(params, LETTER_PARAMS.search) ?? "";
  return search.trim() === "" ? "" : search.slice(0, SEARCH_KEEP_LIMIT);
}

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

// ---- Segments ----

export function segmentHref(segment: LetterSegment): string {
  switch (segment) {
    case "incoming":
      return INCOMING_PATH;
    case "outgoing":
      return OUTGOING_PATH;
    case "mine":
      return MY_REQUESTS_PATH;
    case "queue":
      return QUEUE_PATH;
  }
}

export function registerPath(type: LetterType): string {
  return type === "incoming" ? INCOMING_PATH : OUTGOING_PATH;
}

// ---- Register (Surat Masuk, Surat Keluar) ----

export type RegisterUrlState = {
  search: string;
  period: LetterPeriodFilter;
  year: number | null;
  status: LetterStatusFilter;
  withoutFiles: boolean;
  page: number;
};

export const REGISTER_DEFAULTS: RegisterUrlState = {
  search: "",
  period: "active",
  year: null,
  status: "all",
  withoutFiles: false,
  page: 1,
};

export function readRegisterParams(params: SearchParams): RegisterUrlState {
  const period = letterPeriodFilterSchema.safeParse(firstParam(params, LETTER_PARAMS.period));
  const status = letterStatusFilterSchema.safeParse(firstParam(params, LETTER_PARAMS.status));
  const yearText = firstParam(params, LETTER_PARAMS.year);
  const year = yearText !== undefined && /^\d{4}$/.test(yearText) ? Number(yearText) : null;
  return {
    search: readSearch(params),
    period: period.success ? period.data : REGISTER_DEFAULTS.period,
    year,
    status: status.success ? status.data : REGISTER_DEFAULTS.status,
    withoutFiles: firstParam(params, LETTER_PARAMS.withoutFiles) === "1",
    page: readPage(firstParam(params, LETTER_PARAMS.page)),
  };
}

/** The list parameters in address form (no page), for links and pagination. Defaults are left out. */
export function registerParams(state: Partial<RegisterUrlState>): Record<string, string> {
  const full = { ...REGISTER_DEFAULTS, ...state };
  const out: Record<string, string> = {};
  const search = full.search.trim();
  if (search !== "") out[LETTER_PARAMS.search] = search;
  if (full.period !== REGISTER_DEFAULTS.period) out[LETTER_PARAMS.period] = full.period;
  if (full.year !== null) out[LETTER_PARAMS.year] = String(full.year);
  if (full.status !== REGISTER_DEFAULTS.status) out[LETTER_PARAMS.status] = full.status;
  if (full.withoutFiles) out[LETTER_PARAMS.withoutFiles] = "1";
  return out;
}

export function registerHref(type: LetterType, state: Partial<RegisterUrlState> = {}): string {
  const params = registerParams(state);
  if (state.page && state.page > 1) params[LETTER_PARAMS.page] = String(state.page);
  return withQuery(registerPath(type), params);
}

// ---- Letter detail and forms ----

/** One-time success notices on the letter detail (design 6.4, 7.5). */
export const LETTER_NOTICES = ["registered", "edited", "files_added", "file_withdrawn", "voided"] as const;
export type LetterNotice = (typeof LETTER_NOTICES)[number];

export function letterHref(letterId: string, notice?: LetterNotice): string {
  return withQuery(`${LETTERS_PATH}/${letterId}`, notice ? { [LETTER_PARAMS.notice]: notice } : {});
}

export function letterEditHref(letterId: string): string {
  return `${LETTERS_PATH}/${letterId}/ubah`;
}

export function registerFormHref(type: LetterType): string {
  return type === "incoming" ? "/surat/catat/masuk" : "/surat/catat/keluar";
}

export function readLetterNotice(params: SearchParams): LetterNotice | null {
  const value = firstParam(params, LETTER_PARAMS.notice);
  return (LETTER_NOTICES as readonly string[]).includes(value ?? "") ? (value as LetterNotice) : null;
}

// ---- Requests ----

/** One-time success notices on the request detail (design 9.4, 10.4, 12.2, 12.7). */
export const REQUEST_NOTICES = ["sent", "cancelled", "processed", "number_taken", "issued", "rejected"] as const;
export type RequestNotice = (typeof REQUEST_NOTICES)[number];

export function requestHref(requestId: string, notice?: RequestNotice): string {
  return withQuery(`${LETTERS_PATH}/permohonan/${requestId}`, notice ? { [LETTER_PARAMS.notice]: notice } : {});
}

export function issueHref(requestId: string): string {
  return `${LETTERS_PATH}/permohonan/${requestId}/terbitkan`;
}

export function readRequestNotice(params: SearchParams): RequestNotice | null {
  const value = firstParam(params, LETTER_PARAMS.notice);
  return (REQUEST_NOTICES as readonly string[]).includes(value ?? "") ? (value as RequestNotice) : null;
}

/** "Ajukan Surat", or the form prefilled from an earlier request ("Ajukan lagi", P14). */
export function requestFormHref(again?: string): string {
  return withQuery(REQUEST_FORM_PATH, again ? { [LETTER_PARAMS.again]: again } : {});
}

export function readAgainId(params: SearchParams): string | null {
  const value = firstParam(params, LETTER_PARAMS.again);
  return isGuid(value) ? value : null;
}

// ---- Permohonan Saya ----

export function readMyRequestsParams(params: SearchParams): { filter: MyLetterRequestsFilter; page: number } {
  const filter = myLetterRequestsFilterSchema.safeParse(firstParam(params, LETTER_PARAMS.filter));
  return {
    filter: filter.success ? filter.data : MY_LETTER_REQUESTS_FILTER_DEFAULT,
    page: readPage(firstParam(params, LETTER_PARAMS.page)),
  };
}

export function myRequestsParams(filter: MyLetterRequestsFilter): Record<string, string> {
  return filter === MY_LETTER_REQUESTS_FILTER_DEFAULT ? {} : { [LETTER_PARAMS.filter]: filter };
}

export function myRequestsHref(filter: MyLetterRequestsFilter = MY_LETTER_REQUESTS_FILTER_DEFAULT, page = 1): string {
  const params = myRequestsParams(filter);
  if (page > 1) params[LETTER_PARAMS.page] = String(page);
  return withQuery(MY_REQUESTS_PATH, params);
}

// ---- Antrean ----

export type QueueUrlState = {
  view: LetterQueueView;
  search: string;
  from: string | null;
  to: string | null;
  page: number;
  /** The default view of this person (left out of the address). */
  defaultView: LetterQueueView;
};

export function readQueueParams(params: SearchParams, capabilities: LetterCapabilities): QueueUrlState {
  const defaultView = defaultLetterQueueView(capabilities);
  const view = letterQueueViewSchema.safeParse(firstParam(params, LETTER_PARAMS.view));
  return {
    view: view.success ? view.data : defaultView,
    search: readSearch(params),
    from: readDate(firstParam(params, LETTER_PARAMS.from)),
    to: readDate(firstParam(params, LETTER_PARAMS.to)),
    page: readPage(firstParam(params, LETTER_PARAMS.page)),
    defaultView,
  };
}

export function queueParams(state: QueueUrlState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.view !== state.defaultView) out[LETTER_PARAMS.view] = state.view;
  const search = state.search.trim();
  if (search !== "") out[LETTER_PARAMS.search] = search;
  if (state.from) out[LETTER_PARAMS.from] = state.from;
  if (state.to) out[LETTER_PARAMS.to] = state.to;
  return out;
}

export function queueHref(state: QueueUrlState): string {
  const params = queueParams(state);
  if (state.page > 1) params[LETTER_PARAMS.page] = String(state.page);
  return withQuery(QUEUE_PATH, params);
}

/** A link to one Antrean view (Dashboard card, empty states). Always carries the view. */
export function queueViewHref(view: LetterQueueView): string {
  return withQuery(QUEUE_PATH, { [LETTER_PARAMS.view]: view });
}

// ---- Penomoran Surat ----

export const NUMBERING_NOTICES = ["format_saved", "next_set"] as const;
export type NumberingNotice = (typeof NUMBERING_NOTICES)[number];

export function numberingHref(notice?: NumberingNotice, page = 1): string {
  const params: Record<string, string> = {};
  if (notice) params[LETTER_PARAMS.notice] = notice;
  if (page > 1) params[LETTER_PARAMS.page] = String(page);
  return withQuery(NUMBERING_PATH, params);
}

export function readNumberingNotice(params: SearchParams): NumberingNotice | null {
  const value = firstParam(params, LETTER_PARAMS.notice);
  return (NUMBERING_NOTICES as readonly string[]).includes(value ?? "") ? (value as NumberingNotice) : null;
}
