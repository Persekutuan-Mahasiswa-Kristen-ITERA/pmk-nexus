// Contract between the Inventory and Borrowing backend (src/lib/picore/, src/modules/inventory-borrowing/server)
// and the UI (src/modules/inventory-borrowing/ui, src/app). Written 2026-11-08 by the backend engineer.
// Change it only after telling the tech lead: both sides depend on it.
//
// Spec:     docs/modules/inventory-borrowing.md (sections 2-5, 8, 11, 11b, 11c). Decisions: D-020, D-022.
// Design:   docs/design/inventory-borrowing.md (copy quoted below comes from there or from the spec).
// Database: supabase/migrations/20261107100100_nexus_inventory_borrowing.sql (public RPCs nexus.inventory_*
//           and nexus.borrowing_*), 20261107100000 (keys), 20261107100200 (evidence bucket),
//           20261108100000_nexus_inventory_borrowing_fixes.sql (detail by reference, period filter,
//           correction hints, manager export rows). Round 2 of this contract: 2026-11-08.
//
// Pure and isomorphic: safe to import from Server Components, Client Components and route handlers.
// Stored values are the database's English identifiers; Indonesian labels are in section 9.
// No type here holds email, phone, NIM, NIP or auth user ids (L4). PI-CORE member ids that the database
// returns (requester, actor) are read by the server but NOT exposed: `isOwn` covers what the UI needs.
// Zod issue messages in this file are machine codes (InventoryErrorCode), never shown to people. The
// server turns the FIRST issue into an error: a message that is a known code keeps that code (with the
// issue path's first key as `field`); any other message (zod's own, e.g. "Unrecognized key") becomes
// invalid_input for that field.

import { z } from "zod";
import type { AccessState } from "@/lib/auth/types";

// =============================================================================================
// 1. Limits (mirror the database; the database checks again). Spec 11c / A-IB43.
// =============================================================================================

export const INVENTORY_LIMITS = {
  itemName: 120,
  itemDescription: 1000,
  /** Purpose, every note and every reason (all 500, spec 11c). */
  note: 500,
  categoryName: 60,
  locationName: 80,
  outsidePartyName: 120,
  /** Per condition, and per line quantity. */
  stockMax: 9999,
  linesPerRequest: 50,
  /** Units created in one call (item create, "+ Tambah unit") and units handed over on one line. */
  unitsPerCall: 200,
  /** Return outcomes in one "Catat pengembalian" call. */
  outcomesPerReturn: 200,
  /** Item ids per bulk availability call (catalog date filter, request form). */
  bulkAvailabilityItems: 100,
  /** end_date <= start_date + 365, also after extensions (counted from the ORIGINAL start, R30). */
  requestMaxDays: 365,
  /** Dates before this are refused by the database (borrowing_requests_date_cap). */
  minDate: "2000-01-01",
  /** Owner caps (R29, A-IB47): open = Diajukan only [A-IB49]; daily = per Jakarta day. */
  openRequestsPerMember: 5,
  requestsPerDay: 20,
} as const;

/** Rows per page on screen (A-IB20) and the hard server maximum (refused, never clamped). */
export const INVENTORY_PAGE_SIZE_DEFAULT = 20;
export const INVENTORY_PAGE_SIZE_MAX = 50;
/** Search: max length after trimming and collapsing spaces; raw input above 480 is refused first. */
export const INVENTORY_SEARCH_MAX_LENGTH = 120;
export const INVENTORY_SEARCH_RAW_MAX_LENGTH = 480;

// =============================================================================================
// 2. Enums (exactly the values stored by the database)
// =============================================================================================

/** tracked = "Dilacak per unit" (one INV code per unit); quantity = "Dihitung per jumlah" (one code). */
export const itemModeSchema = z.enum(["tracked", "quantity"]);
export type ItemMode = z.infer<typeof itemModeSchema>;

/** Fixed list (IB10). Only `good` is lendable. Lost is a unit STATUS, never a condition. */
export const itemConditionSchema = z.enum(["good", "needs_service", "damaged"]);
export type ItemCondition = z.infer<typeof itemConditionSchema>;

/** Condition a damaged return leaves the unit or quantity in (A-IB30). */
export const damagedConditionSchema = z.enum(["needs_service", "damaged"]);
export type DamagedCondition = z.infer<typeof damagedConditionSchema>;

/** Unit status: archived = "Nonaktif", lost = "Hilang" (write-off, code kept). */
export const unitStatusSchema = z.enum(["active", "archived", "lost"]);
export type UnitStatus = z.infer<typeof unitStatusSchema>;

/** Request status (spec section 4 state machine). Derived states are flags, never a status (R9). */
export const requestStatusSchema = z.enum(["submitted", "approved", "rejected", "cancelled", "borrowed", "returned"]);
export type RequestStatus = z.infer<typeof requestStatusSchema>;
/** Statuses that still hold or wait for something; the rest are terminal (or correctable once). */
export const OPEN_REQUEST_STATUSES = ["submitted", "approved", "borrowed"] as const satisfies readonly RequestStatus[];

/** One return outcome: kembali baik / kembali rusak / hilang. */
export const returnOutcomeSchema = z.enum(["good", "damaged", "lost"]);
export type ReturnOutcome = z.infer<typeof returnOutcomeSchema>;

/** Timeline events from borrowing_status_history, plus `extended` from borrowing_extensions. */
export const requestEventSchema = z.enum([
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "handed_over",
  "returned_partial",
  "returned",
  "return_corrected",
]);
export type RequestEvent = z.infer<typeof requestEventSchema>;

/** inventory_item_history.kind. */
export const itemHistoryKindSchema = z.enum([
  "created",
  "edited",
  "unit_added",
  "stock_added",
  "condition_changed",
  "written_off",
  "archived",
  "reactivated",
  "restored",
]);
export type ItemHistoryKind = z.infer<typeof itemHistoryKindSchema>;

/** Catalog status filter: `archived` and `all` need inventory.manage (A-IB5; the database refuses otherwise). */
export const catalogStatusFilterSchema = z.enum(["active", "archived", "all"]);
export type CatalogStatusFilter = z.infer<typeof catalogStatusFilterSchema>;

/**
 * Antrean views (design 11.1, database _ib_queue_rows):
 * pending = Diajukan oldest first; ready = Disetujui soonest start first; borrowed = Dipinjam, Terlambat
 * first; overdue = Terlambat only; closed = Dikembalikan/Ditolak/Dibatalkan newest first;
 * all = everything of the ACTIVE period (empty without one); open_all_periods = handover list (F11.5).
 * pending/ready/borrowed/overdue/closed span all periods (L7: open items stay actionable).
 */
export const queueViewSchema = z.enum(["pending", "ready", "borrowed", "overdue", "closed", "all", "open_all_periods"]);
export type QueueView = z.infer<typeof queueViewSchema>;

/** "Peminjaman Saya" filter: open (default) / closed / all. */
export const myRequestsFilterSchema = z.enum(["open", "closed", "all"]);
export type MyRequestsFilter = z.infer<typeof myRequestsFilterSchema>;

/** Export formats (D-020, same three as Data Anggota). */
export const inventoryExportFormatSchema = z.enum(["xlsx", "csv", "pdf"]);
export type InventoryExportFormat = z.infer<typeof inventoryExportFormatSchema>;

/** The two pick lists Ops maintains (IB10). */
export const inventoryListKindSchema = z.enum(["category", "location"]);
export type InventoryListKind = z.infer<typeof inventoryListKindSchema>;

// =============================================================================================
// 3. Small shared schemas
// =============================================================================================

/** Code points, like Postgres char_length (JS .length would count an emoji twice). */
function charLength(text: string): number {
  return [...text].length;
}

/** nexus ids. z.guid() (not z.uuid()) like Member Data; the database accepts any 8-4-4-4-12 hex. */
const idSchema = z.guid({ message: "invalid_input" });

/** Optimistic-lock version from the last read; a mismatch answers state_changed ("Data sudah berubah"). */
const versionSchema = z.number({ message: "invalid_input" }).int({ message: "invalid_input" }).min(1, { message: "invalid_input" });

/** Optional text: trimmed, blank -> null, then the length cap (same order as nexus._ib_text). */
function optionalTextSchema(max: number) {
  return z
    .string()
    .nullish()
    .transform((raw) => {
      const trimmed = (raw ?? "").trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine((text) => text === null || charLength(text) <= max, { message: "text_too_long" });
}

/** Required text: trimmed, then not blank and within the cap. `missing` is the code a blank answers. */
function requiredTextSchema(max: number, missing: "text_required" | "reason_required" | "note_required" = "text_required") {
  return z
    .string({ message: missing })
    .transform((raw) => raw.trim())
    .refine((text) => text !== "", { message: missing })
    .refine((text) => charLength(text) <= max, { message: "text_too_long" });
}

function intSchema(min: number, max: number) {
  return z
    .number({ message: "quantity_invalid" })
    .int({ message: "quantity_invalid" })
    .min(min, { message: "quantity_invalid" })
    .max(max, { message: "quantity_invalid" });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as "YYYY-MM-DD" (Asia/Jakarta calendar day, R19), not before 2000-01-01. */
export const isoDateSchema = z
  .string({ message: "invalid_dates" })
  .regex(ISO_DATE, { message: "invalid_dates" })
  .refine(isRealDate, { message: "invalid_dates" })
  .refine((date) => date >= INVENTORY_LIMITS.minDate, { message: "invalid_dates" });

function isRealDate(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

/** Search: same cleaning and caps as nexus._ib_search_pattern. Blank = no search (null). */
export const inventorySearchSchema = z
  .string()
  .refine((raw) => charLength(raw) <= INVENTORY_SEARCH_RAW_MAX_LENGTH, { message: "search_too_long" })
  .transform((raw) => raw.trim().replace(/\s+/g, " "))
  .refine((clean) => charLength(clean) <= INVENTORY_SEARCH_MAX_LENGTH, { message: "search_too_long" })
  .transform((clean) => (clean === "" ? null : clean));

const pageSchema = z.number({ message: "invalid_page" }).int({ message: "invalid_page" }).min(1, { message: "invalid_page" });
const pageSizeSchema = z
  .number({ message: "invalid_page_size" })
  .int({ message: "invalid_page_size" })
  .min(1, { message: "invalid_page_size" })
  .max(INVENTORY_PAGE_SIZE_MAX, { message: "invalid_page_size" });

// =============================================================================================
// 4. Read inputs (lists, filters, availability)
// =============================================================================================

/**
 * Catalog filters (F1, design screen 2), shared by the list and the export (R15: the export never shows
 * more than the screen). Dates: both or none; with both, `freeQty` is filled and items with nothing
 * free sort last (design P2). The availability range has NO 365-day cap in the database; the start
 * date may not be before today (Jakarta), checked by the server and the database (start_in_past).
 */
export const catalogFiltersSchema = z
  .object({
    search: inventorySearchSchema.nullable().default(null),
    categoryId: idSchema.nullable().default(null),
    locationId: idSchema.nullable().default(null),
    condition: itemConditionSchema.nullable().default(null),
    status: catalogStatusFilterSchema.default("active"),
    availableFrom: isoDateSchema.nullable().default(null),
    availableTo: isoDateSchema.nullable().default(null),
  })
  .superRefine((f, ctx) => checkOptionalRange(f.availableFrom, f.availableTo, "availableTo", ctx));

export const catalogQuerySchema = z
  .object({
    filters: catalogFiltersSchema.prefault({}),
    page: pageSchema.default(1),
    pageSize: pageSizeSchema.default(INVENTORY_PAGE_SIZE_DEFAULT),
  });

/** "Cek ketersediaan" for one item (F1.3): counts only, never who holds it (R8). */
export const availabilityQuerySchema = z
  .object({ itemId: idSchema, from: isoDateSchema, to: isoDateSchema })
  .superRefine((q, ctx) => checkOptionalRange(q.from, q.to, "to", ctx));

/** Bulk availability (request form lines, catalog date filter). 0..100 ids; unknown/archived ids are left out. */
export const bulkAvailabilityQuerySchema = z
  .object({
    itemIds: z.array(idSchema).max(INVENTORY_LIMITS.bulkAvailabilityItems, { message: "invalid_input" }),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .superRefine((q, ctx) => checkOptionalRange(q.from, q.to, "to", ctx));

/** Category or location list. Inactive entries are included by default (filter shows "{nama} (nonaktif)"). */
export const listEntriesQuerySchema = z.object({
  kind: inventoryListKindSchema,
  includeInactive: z.boolean().default(true),
});

/** Item history (managers and borrowing.view_all holders), newest first. */
export const itemHistoryQuerySchema = z.object({
  itemId: idSchema,
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(INVENTORY_PAGE_SIZE_DEFAULT),
});

/** Longest raw reference the database looks at; longer input is refused before cleaning. */
export const REQUEST_REFERENCE_RAW_MAX_LENGTH = 40;
/** PJM- plus 4 to 16 digits, after trimming and upper-casing (borrowing_request_detail_by_ref). */
export const REQUEST_REFERENCE_PATTERN = /^PJM-[0-9]{4,16}$/;

/**
 * "Detail Pengajuan" address /inventaris/pengajuan/{ref}. Same rule as the database: raw max 40, then
 * trimmed and upper-cased ("pjm-0001" works). Malformed = invalid_input (field reference); unknown and
 * not-visible references both answer not_found "request" (R8: no probing).
 */
export const requestReferenceSchema = z
  .string({ message: "invalid_input" })
  .refine((raw) => charLength(raw) <= REQUEST_REFERENCE_RAW_MAX_LENGTH, { message: "invalid_input" })
  .transform((raw) => raw.trim().toUpperCase())
  .refine((ref) => REQUEST_REFERENCE_PATTERN.test(ref), { message: "invalid_input" });

export const myRequestsQuerySchema = z.object({
  filter: myRequestsFilterSchema.default("open"),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(INVENTORY_PAGE_SIZE_DEFAULT),
});

/**
 * Antrean filters (F4, design 11.1), shared by the list and the borrowing export. Search matches
 * reference, requester name, organisation, contact person and item name. Dates: both or none; a request
 * matches when its range overlaps [from, to]. Past dates are allowed here (history).
 * periodId (PI-CORE period, from borrowing_period_list): null = as before ("all" = the active period,
 * every other view spans all periods); set = only requests created in that period, for every view.
 * An unknown id answers invalid_period.
 */
export const queueFiltersSchema = z
  .object({
    view: queueViewSchema.default("pending"),
    search: inventorySearchSchema.nullable().default(null),
    from: isoDateSchema.nullable().default(null),
    to: isoDateSchema.nullable().default(null),
    itemId: idSchema.nullable().default(null),
    periodId: idSchema.nullable().default(null),
  })
  .superRefine((f, ctx) => checkOptionalRange(f.from, f.to, "to", ctx));

export const queueQuerySchema = z.object({
  filters: queueFiltersSchema.prefault({}),
  page: pageSchema.default(1),
  pageSize: pageSizeSchema.default(INVENTORY_PAGE_SIZE_DEFAULT),
});

/** Export bodies: the validated filters the screen shows, plus the format (F12). */
export const catalogExportSchema = z.object({ format: inventoryExportFormatSchema, filters: catalogFiltersSchema });
export const borrowingExportSchema = z.object({ format: inventoryExportFormatSchema, filters: queueFiltersSchema });

export type CatalogFiltersInput = z.input<typeof catalogFiltersSchema>;
export type CatalogFilters = z.output<typeof catalogFiltersSchema>;
export type CatalogQueryInput = z.input<typeof catalogQuerySchema>;
export type CatalogQuery = z.output<typeof catalogQuerySchema>;
export type AvailabilityQueryInput = z.input<typeof availabilityQuerySchema>;
export type BulkAvailabilityQueryInput = z.input<typeof bulkAvailabilityQuerySchema>;
export type ListEntriesQueryInput = z.input<typeof listEntriesQuerySchema>;
export type ItemHistoryQueryInput = z.input<typeof itemHistoryQuerySchema>;
export type MyRequestsQueryInput = z.input<typeof myRequestsQuerySchema>;
export type QueueFiltersInput = z.input<typeof queueFiltersSchema>;
export type QueueFilters = z.output<typeof queueFiltersSchema>;
export type QueueQueryInput = z.input<typeof queueQuerySchema>;
/** Cleaned reference ("PJM-0001"). */
export type RequestReference = z.output<typeof requestReferenceSchema>;
export type CatalogExportInput = z.input<typeof catalogExportSchema>;
export type BorrowingExportInput = z.input<typeof borrowingExportSchema>;

/** Both dates or none; end not before start. */
function checkOptionalRange(from: string | null, to: string | null, toPath: string, ctx: z.RefinementCtx): void {
  if ((from === null) !== (to === null) || (from !== null && to !== null && to < from)) {
    ctx.addIssue({ code: "custom", message: "invalid_dates", path: [toPath] });
  }
}

// =============================================================================================
// 5. Write inputs: inventory (inventory.manage). Every change writes an item history row.
// =============================================================================================

const stockCountsSchema = z
  .object({
    good: intSchema(0, INVENTORY_LIMITS.stockMax).default(0),
    needsService: intSchema(0, INVENTORY_LIMITS.stockMax).default(0),
    damaged: intSchema(0, INVENTORY_LIMITS.stockMax).default(0),
  })
  .refine((s) => s.good + s.needsService + s.damaged >= 1, { message: "quantity_invalid" }); // "Isi minimal satu barang."

const newUnitSchema = z.object({ condition: itemConditionSchema, locationId: idSchema.nullable().default(null) });
const newUnitsSchema = z
  .array(newUnitSchema)
  .min(1, { message: "quantity_invalid" }) // "Tambahkan minimal satu unit."
  .max(INVENTORY_LIMITS.unitsPerCall, { message: "quantity_invalid" });

const itemCommonFields = {
  name: requiredTextSchema(INVENTORY_LIMITS.itemName),
  description: optionalTextSchema(INVENTORY_LIMITS.itemDescription),
  categoryId: idSchema.nullable().default(null),
  note: optionalTextSchema(INVENTORY_LIMITS.note),
};

/** "Tambah barang" (F2, design 7.1/7.2). Mode first and forever (P5 a). The database assigns every code. */
export const itemCreateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("quantity"),
    ...itemCommonFields,
    /** One location per quantity item (G1). Must be an ACTIVE entry. */
    locationId: idSchema.nullable().default(null),
    stock: stockCountsSchema,
  }),
  z.object({
    mode: z.literal("tracked"),
    ...itemCommonFields,
    /** Location is per unit; the item has none (location_per_unit). */
    units: newUnitsSchema,
  }),
]);

/**
 * Edit fields (not stock, not mode, not code). Send every field as shown on the form; an unchanged form
 * writes nothing (`changed: false`). A deactivated category/location may be KEPT, not newly chosen.
 * locationId must be null for a tracked item (location_per_unit).
 */
export const itemUpdateSchema = z.object({
  itemId: idSchema,
  name: requiredTextSchema(INVENTORY_LIMITS.itemName),
  description: optionalTextSchema(INVENTORY_LIMITS.itemDescription),
  categoryId: idSchema.nullable(),
  locationId: idSchema.nullable(),
  note: optionalTextSchema(INVENTORY_LIMITS.note),
});

/** "+ Tambah unit" for a tracked, active item. */
export const unitAddSchema = z.object({ itemId: idSchema, units: newUnitsSchema, note: optionalTextSchema(INVENTORY_LIMITS.note) });

/** Move a unit to another location (null = no location). */
export const unitMoveSchema = z.object({
  unitId: idSchema,
  locationId: idSchema.nullable(),
  note: optionalTextSchema(INVENTORY_LIMITS.note),
});

/** Stock dialogs (design 7.6, owner P6 a): a reason is ALWAYS required. */
const reasonSchema = requiredTextSchema(INVENTORY_LIMITS.note, "reason_required");

/** "Tambah jumlah": new stock of a quantity item arrived. The result may not exceed 9999. */
export const stockAddSchema = z.object({
  itemId: idSchema,
  condition: itemConditionSchema,
  quantity: intSchema(1, INVENTORY_LIMITS.stockMax),
  note: reasonSchema,
});

/** "Ubah kondisi" for a quantity item. Moving out of good may not cut into reserved stock (reserved_stock). */
export const stockMoveSchema = z
  .object({
    itemId: idSchema,
    from: itemConditionSchema,
    to: itemConditionSchema,
    quantity: intSchema(1, INVENTORY_LIMITS.stockMax),
    note: reasonSchema,
  })
  .refine((s) => s.from !== s.to, { message: "invalid_condition", path: ["to"] });

/** "Keluarkan dari stok" for a quantity item (lost or thrown away; the total drops, history keeps it). */
export const stockWriteOffSchema = z.object({
  itemId: idSchema,
  condition: itemConditionSchema,
  quantity: intSchema(1, INVENTORY_LIMITS.stockMax),
  note: reasonSchema,
});

/** "Ubah kondisi {kode}" for an active unit not on loan. */
export const unitConditionSchema = z.object({ unitId: idSchema, condition: itemConditionSchema, note: reasonSchema });

/** "Keluarkan" a unit: status Hilang, code kept. Not while on loan. */
export const unitWriteOffSchema = z.object({ unitId: idSchema, note: reasonSchema });

/** "Ditemukan kembali" (A-IB45): a lost unit returns with its condition now; the item must be active. */
export const unitRestoreSchema = z.object({ unitId: idSchema, condition: itemConditionSchema, note: reasonSchema });

/** "Nonaktifkan" / "Aktifkan kembali". Archiving is refused while lines are open (open_requests_exist). */
export const itemSetActiveSchema = z.object({ itemId: idSchema, isActive: z.boolean(), note: optionalTextSchema(INVENTORY_LIMITS.note) });
export const unitSetActiveSchema = z.object({ unitId: idSchema, isActive: z.boolean(), note: optionalTextSchema(INVENTORY_LIMITS.note) });

/** Category / location lists: add, rename, deactivate or reactivate; never delete (IB10). Names unique, case-insensitive. */
export const listEntryAddSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), name: requiredTextSchema(INVENTORY_LIMITS.categoryName) }),
  z.object({ kind: z.literal("location"), name: requiredTextSchema(INVENTORY_LIMITS.locationName) }),
]);
export const listEntryRenameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), id: idSchema, name: requiredTextSchema(INVENTORY_LIMITS.categoryName) }),
  z.object({ kind: z.literal("location"), id: idSchema, name: requiredTextSchema(INVENTORY_LIMITS.locationName) }),
]);
export const listEntrySetActiveSchema = z.object({ kind: inventoryListKindSchema, id: idSchema, isActive: z.boolean() });

export type ItemCreateInput = z.input<typeof itemCreateSchema>;
export type ItemUpdateInput = z.input<typeof itemUpdateSchema>;
export type UnitAddInput = z.input<typeof unitAddSchema>;
export type UnitMoveInput = z.input<typeof unitMoveSchema>;
export type StockAddInput = z.input<typeof stockAddSchema>;
export type StockMoveInput = z.input<typeof stockMoveSchema>;
export type StockWriteOffInput = z.input<typeof stockWriteOffSchema>;
export type UnitConditionInput = z.input<typeof unitConditionSchema>;
export type UnitWriteOffInput = z.input<typeof unitWriteOffSchema>;
export type UnitRestoreInput = z.input<typeof unitRestoreSchema>;
export type ItemSetActiveInput = z.input<typeof itemSetActiveSchema>;
export type UnitSetActiveInput = z.input<typeof unitSetActiveSchema>;
export type ListEntryAddInput = z.input<typeof listEntryAddSchema>;
export type ListEntryRenameInput = z.input<typeof listEntryRenameSchema>;
export type ListEntrySetActiveInput = z.input<typeof listEntrySetActiveSchema>;

// =============================================================================================
// 6. Write inputs: borrowing (state machine, spec section 4). Every transition sends the `version` the
//    screen read; the requester is ALWAYS the session member, never an input (IB-14).
// =============================================================================================

/** Outside party (F10, A-IB28): organisation + contact person name only. Needs borrowing.handle. */
export const outsidePartySchema = z.object({
  orgName: requiredTextSchema(INVENTORY_LIMITS.outsidePartyName),
  contactName: requiredTextSchema(INVENTORY_LIMITS.outsidePartyName),
});

/**
 * "Ajukan Peminjaman" (F3, F10). Dates are Jakarta calendar days, end inclusive; start not before today
 * (start_in_past, checked by server and database); end <= start + 365 (R30). 1..50 lines, each item once
 * (R20), quantity 1..9999 and within the free quantity (checked by the database: insufficient_stock).
 * Caps: 5 open Diajukan, 20 per Jakarta day (too_many_open_requests, daily_request_limit; database only).
 */
export const requestCreateSchema = z
  .object({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    purpose: requiredTextSchema(INVENTORY_LIMITS.note),
    note: optionalTextSchema(INVENTORY_LIMITS.note),
    lines: z
      .array(z.object({ itemId: idSchema, quantity: intSchema(1, INVENTORY_LIMITS.stockMax) }))
      .min(1, { message: "quantity_invalid" }) // "Tambahkan minimal satu barang."
      .max(INVENTORY_LIMITS.linesPerRequest, { message: "too_many_lines" }),
    /** null = for myself (default). Set = "Untuk pihak luar" (borrowing.handle only). */
    outsideParty: outsidePartySchema.nullable().default(null),
  })
  .superRefine((r, ctx) => {
    if (r.endDate < r.startDate) {
      ctx.addIssue({ code: "custom", message: "invalid_dates", path: ["endDate"] });
    } else if (r.endDate > maxRequestEndDate(r.startDate)) {
      ctx.addIssue({ code: "custom", message: "date_range_too_long", path: ["endDate"] });
    }
    const ids = r.lines.map((l) => l.itemId.toLowerCase());
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate_item", path: ["lines"] });
  });

/**
 * "Setujui" (F4, heads, never own). Lines not listed are approved in full. A listed line may be lowered
 * (0..requested, A-IB14); then the note is required (note_required, database). At least one item must
 * remain approved (quantity_invalid). Availability is re-checked under lock (insufficient_stock).
 */
export const requestApproveSchema = z
  .object({
    requestId: idSchema,
    version: versionSchema,
    note: optionalTextSchema(INVENTORY_LIMITS.note),
    lines: z
      .array(z.object({ lineId: idSchema, quantity: intSchema(0, INVENTORY_LIMITS.stockMax) }))
      .max(INVENTORY_LIMITS.linesPerRequest, { message: "too_many_lines" })
      .default([]),
  })
  .refine((a) => uniqueIds(a.lines.map((l) => l.lineId)), { message: "invalid_input", path: ["lines"] });

/** "Tolak" (F4.3, heads, never own). Note required (IB-21). */
export const requestRejectSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  note: requiredTextSchema(INVENTORY_LIMITS.note, "note_required"),
});

/**
 * "Batalkan pengajuan" (F7). Requester: while Diajukan (reason optional) or Disetujui (reason required).
 * A handle holder: Disetujui only, reason required. The detail's `actions.cancelReasonRequired` tells the
 * form; the database answers reason_required otherwise.
 */
export const requestCancelSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  reason: optionalTextSchema(INVENTORY_LIMITS.note),
});

/**
 * "Ubah tanggal kembali" (F8, heads, never own). Later than the current end date (invalid_dates) and at
 * most ORIGINAL start + 365 (date_range_too_long); use maxRequestEndDate(detail.startDate) on the form.
 */
export const requestExtendSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  newEndDate: isoDateSchema,
  note: requiredTextSchema(INVENTORY_LIMITS.note, "note_required"),
});

/** One handover line: a quantity item hands over a count; a tracked item hands over chosen units. */
const handOverLineSchema = z.union([
  z.strictObject({
    lineId: idSchema,
    quantity: intSchema(0, INVENTORY_LIMITS.stockMax),
    note: optionalTextSchema(INVENTORY_LIMITS.note),
  }),
  z.strictObject({
    lineId: idSchema,
    unitIds: z
      .array(idSchema)
      .max(INVENTORY_LIMITS.unitsPerCall, { message: "too_many_units" })
      .refine(uniqueIds, { message: "invalid_input" }),
    note: optionalTextSchema(INVENTORY_LIMITS.note),
  }),
]);

/**
 * "Catat serah terima" (F5, borrowing.handle, own request allowed). Not before the start date (too_early).
 * Lines not listed hand over 0. Per line at most the approved quantity; less than approved needs the
 * line note (note_required). All zero answers nothing_to_hand_over (the screen offers cancel instead).
 */
export const requestHandOverSchema = z
  .object({
    requestId: idSchema,
    version: versionSchema,
    note: optionalTextSchema(INVENTORY_LIMITS.note),
    lines: z.array(handOverLineSchema).max(INVENTORY_LIMITS.linesPerRequest, { message: "too_many_lines" }),
  })
  .refine((h) => uniqueIds(h.lines.map((l) => l.lineId)), { message: "invalid_input", path: ["lines"] });

// ---- Evidence photos (IB8, A-IB31, storage migration 20261107100200) ----

/** Private bucket. Only the path is stored; people get short-lived signed URLs (CLAUDE.md 11). */
export const EVIDENCE_BUCKET = "nexus-borrowing-evidence";
/** Bucket limit: 1.5 MiB per file (the browser resizes to about 1280 px long side first, A-IB31). */
export const EVIDENCE_MAX_BYTES = 1_572_864;
export const EVIDENCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];
export const EVIDENCE_EXTENSION: Record<EvidenceMimeType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** Per damaged or lost outcome. */
export const EVIDENCE_PHOTOS_MIN = 1;
export const EVIDENCE_PHOTOS_MAX = 3;
/** Uploads not yet attached to a saved return, per request folder (review L6). The 11th is refused. */
export const EVIDENCE_UNATTACHED_MAX = 10;
/** Resize target in the browser (A-IB31, an assumption). Client hint only; the bucket enforces the bytes. */
export const EVIDENCE_RESIZE_LONG_SIDE_PX = 1280;
/**
 * Largest ORIGINAL photo the browser accepts before resizing (A-IB52: 15 MB, read as 15 MiB). Over it:
 * "Foto terlalu besar. Pakai foto di bawah {max} MB." (design 13.3) with max = EVIDENCE_ORIGINAL_MAX_MB.
 */
export const EVIDENCE_ORIGINAL_MAX_MB = 15;
export const EVIDENCE_ORIGINAL_MAX_BYTES = EVIDENCE_ORIGINAL_MAX_MB * 1024 * 1024;
/** Lifetime of a signed photo link (A-IB51). */
export const EVIDENCE_SIGNED_URL_TTL_SECONDS = 300;
/**
 * Upload goes through the NEXUS route (A-IB50), never straight from the browser: the server checks the
 * file's real type from its first bytes (magic bytes) against the declared type, then uploads with the
 * USER's client (bucket policy borrowing_evidence_can_upload checks again).
 */
export const EVIDENCE_UPLOAD_ROUTE = "/api/inventory/evidence";
/** Multipart field names of the upload route. */
export const EVIDENCE_UPLOAD_FIELDS = { requestId: "requestId", file: "file" } as const;

/** Same pattern as the database: "<request id>/<random uuid>.<jpg|jpeg|png|webp>", lowercase. */
export const EVIDENCE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;
export const evidencePathSchema = z.string().regex(EVIDENCE_PATH_PATTERN, { message: "invalid_photo" });

/** The file the browser sends AFTER resizing (checked again by the bucket: size and declared type). */
export const evidenceFileSchema = z.object({
  type: z.enum(EVIDENCE_MIME_TYPES, { message: "invalid_photo" }),
  size: z.number().int().min(1, { message: "invalid_photo" }).max(EVIDENCE_MAX_BYTES, { message: "invalid_photo" }),
});
/** Upload target: only while the request is Dipinjam and by a borrowing.handle holder (bucket policy). */
export const evidenceUploadSchema = z.object({ requestId: idSchema, file: evidenceFileSchema });

/** Builds the storage path for a new upload. `fileId` is a fresh random uuid (crypto.randomUUID()). */
export function evidencePhotoPath(requestId: string, fileId: string, type: EvidenceMimeType): string {
  return `${requestId.toLowerCase()}/${fileId.toLowerCase()}.${EVIDENCE_EXTENSION[type]}`;
}

// ---- Return ----

const photoListSchema = z
  .array(evidencePathSchema)
  .min(EVIDENCE_PHOTOS_MIN, { message: "photo_count" }) // "Tambahkan minimal satu foto."
  .max(EVIDENCE_PHOTOS_MAX, { message: "photo_count" });

/**
 * What came back on one line: a quantity item gives `quantity` (1..9999); a tracked item gives ONE
 * `unitId` that is out on this line. Exactly one of the two.
 */
const returnTargetFields = {
  lineId: idSchema,
  quantity: intSchema(1, INVENTORY_LIMITS.stockMax).optional(),
  unitId: idSchema.optional(),
};

/**
 * One return outcome. good: note optional, no photo, no condition. damaged: resulting condition, note
 * and 1..3 photos required. lost: note and 1..3 photos required, no condition (IB8, A-IB30).
 */
export const returnOutcomeInputSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({ outcome: z.literal("good"), ...returnTargetFields, note: optionalTextSchema(INVENTORY_LIMITS.note) }),
    z.strictObject({
      outcome: z.literal("damaged"),
      ...returnTargetFields,
      resultingCondition: damagedConditionSchema,
      note: requiredTextSchema(INVENTORY_LIMITS.note, "note_required"),
      photos: photoListSchema,
    }),
    z.strictObject({
      outcome: z.literal("lost"),
      ...returnTargetFields,
      note: requiredTextSchema(INVENTORY_LIMITS.note, "note_required"),
      photos: photoListSchema,
    }),
  ])
  .refine((o) => (o.quantity === undefined) !== (o.unitId === undefined), { message: "invalid_input", path: ["quantity"] });

/**
 * "Catat pengembalian" (F6, borrowing.handle, own request allowed). One call = one return batch, 1..200
 * outcomes. Lines not mentioned stay out (partial return, "Sebagian kembali"). Per line the outcomes may
 * not exceed what is still out (quantity_invalid). Photos must be uploaded first into this request's
 * folder; each path and each unit may appear once in the call.
 */
export const requestReturnSchema = z
  .object({
    requestId: idSchema,
    version: versionSchema,
    outcomes: z
      .array(returnOutcomeInputSchema)
      .min(1, { message: "invalid_input" })
      .max(INVENTORY_LIMITS.outcomesPerReturn, { message: "invalid_input" }),
  })
  .superRefine((r, ctx) => {
    const units = r.outcomes.flatMap((o) => (o.unitId === undefined ? [] : [o.unitId]));
    if (!uniqueIds(units)) ctx.addIssue({ code: "custom", message: "unit_not_available", path: ["outcomes"] });
    const paths = r.outcomes.flatMap((o) => ("photos" in o ? o.photos : []));
    const folder = `${r.requestId.toLowerCase()}/`;
    if (new Set(paths).size !== paths.length || paths.some((p) => !p.startsWith(folder))) {
      ctx.addIssue({ code: "custom", message: "invalid_photo", path: ["outcomes"] });
    }
  });

/**
 * "Koreksi pengembalian" (A-IB15): returned -> borrowed, borrowing.handle, ONCE per request, only for a
 * request of the active period (closed_period), refused if the stock moved since (correction_conflict).
 */
export const requestCorrectReturnSchema = z.object({
  requestId: idSchema,
  version: versionSchema,
  reason: requiredTextSchema(INVENTORY_LIMITS.note, "reason_required"),
});

export type OutsidePartyInput = z.input<typeof outsidePartySchema>;
export type RequestCreateInput = z.input<typeof requestCreateSchema>;
export type RequestApproveInput = z.input<typeof requestApproveSchema>;
export type RequestRejectInput = z.input<typeof requestRejectSchema>;
export type RequestCancelInput = z.input<typeof requestCancelSchema>;
export type RequestExtendInput = z.input<typeof requestExtendSchema>;
export type RequestHandOverInput = z.input<typeof requestHandOverSchema>;
export type ReturnOutcomeInput = z.input<typeof returnOutcomeInputSchema>;
export type RequestReturnInput = z.input<typeof requestReturnSchema>;
export type RequestCorrectReturnInput = z.input<typeof requestCorrectReturnSchema>;
export type EvidenceFileInput = z.input<typeof evidenceFileSchema>;

function uniqueIds(ids: string[]): boolean {
  return new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
}

// =============================================================================================
// 7. Output types (camelCase of the RPC columns; nothing the database does not return)
// =============================================================================================

/** Dates are "YYYY-MM-DD" (Jakarta calendar days); timestamps are ISO 8601 strings (UTC, show in WIB). */
type IsoDate = string;
type IsoTimestamp = string;

export type Paged<T> = {
  rows: T[];
  total: number;
  /** The page actually returned: a page past the end returns the last page. */
  page: number;
  pageSize: number;
  /** max(1, ceil(total / pageSize)). */
  pageCount: number;
};

// ---- Catalog ----

/** One unit inside a tracked item (catalog expander, item detail). Members see active units only. */
export type CatalogUnit = {
  unitId: string;
  code: string;
  condition: ItemCondition;
  status: UnitStatus;
  locationId: string | null;
  locationName: string | null;
};

/** nexus.inventory_item_list() row. Counts exclude archived and lost units (A-IB32). */
export type CatalogRow = {
  rowNo: number;
  itemId: string;
  /** INV code of a quantity item; null for a tracked item (codes are per unit). */
  code: string | null;
  name: string;
  mode: ItemMode;
  categoryId: string | null;
  categoryName: string | null;
  /** Quantity item: its location. Tracked item: null (see locationCount and units). */
  locationId: string | null;
  locationName: string | null;
  /** Distinct locations of active units (tracked) or 0/1 (quantity): "{n} lokasi" in line 2. */
  locationCount: number;
  isActive: boolean;
  /** Active units (tracked); 0 for quantity items. */
  unitCount: number;
  qtyGood: number;
  qtyNeedsService: number;
  qtyDamaged: number;
  qtyTotal: number;
  /** Good stock if the item is active, else 0 (the "dari {m}" of availability). */
  lendableQty: number;
  /** Free over the "Tersedia pada tanggal" range; null when no dates are set. Never negative. */
  freeQty: number | null;
  /** Tracked items only (managers also get archived and lost units); null for quantity items. */
  units: CatalogUnit[] | null;
};

export type CatalogPage = Paged<CatalogRow> & {
  /** The validated filters the rows were read with (send these, not raw URL values, to the export). */
  filters: CatalogFilters;
};

/** nexus.inventory_item_detail(). Archived items answer not_found to non-managers. */
export type ItemDetail = {
  itemId: string;
  code: string | null;
  name: string;
  mode: ItemMode;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  locationId: string | null;
  locationName: string | null;
  locationCount: number;
  isActive: boolean;
  unitCount: number;
  stock: { good: number; needsService: number; damaged: number; total: number };
  lendableQty: number;
  /** Tracked items: units (managers also see archived and lost); quantity items: []. */
  units: CatalogUnit[];
};

/** nexus.inventory_item_availability() / inventory_availability_bulk(): counts only (R8). */
export type ItemAvailability = {
  itemId: string;
  /** "dari {m}": good stock of an active item. */
  lendableQty: number;
  /** "Tersedia {n}": free over the WHOLE range (peak day). Never negative. */
  freeQty: number;
  /** "{k} lainnya sudah dipesan atau sedang dipinjam" = lendableQty - freeQty. */
  heldQty: number;
};

/** nexus.inventory_category_list() / inventory_location_list(), A-Z. */
export type ListEntry = {
  id: string;
  name: string;
  isActive: boolean;
  /** Active items using it ("12 barang"). */
  itemCount: number;
};

/** nexus.inventory_item_history_list() row, newest first. */
export type ItemHistoryEntry = {
  historyId: number;
  occurredAt: IsoTimestamp;
  kind: ItemHistoryKind;
  unitId: string | null;
  unitCode: string | null;
  conditionFrom: ItemCondition | null;
  conditionTo: ItemCondition | null;
  quantity: number | null;
  note: string | null;
  /** Set when a return (or its correction) caused the change. */
  requestId: string | null;
  requestReference: string | null;
  /**
   * Free-form facts the database stores per kind, e.g. created {mode, code, good, needs_service, damaged},
   * edited {field: [old, new]}, unit_added {code}, written_off {status_from}, return effects {return_id}
   * or {reversed_return_id}. Snake_case keys as stored; the UI reads only what it needs.
   */
  details: Record<string, unknown> | null;
  /** Current PI-CORE name of whoever made the change; null if unknown. */
  actorName: string | null;
};

export type ItemHistoryPage = Paged<ItemHistoryEntry>;

/** nexus.inventory_status_counts(): Dashboard "Inventaris Status" (IB12, A-IB32, P7 a). No percentage. */
export type InventoryStatusCounts = {
  /** Units/quantity in Baik, INCLUDING those on loan ("{n} unit baik"). */
  goodCount: number;
  /** Of goodCount, out on a loan now ("{m} di antaranya sedang dipinjam"). */
  goodOnLoanCount: number;
  needsServiceCount: number;
  /** Active items; 0 = empty state "Belum ada barang di inventaris." */
  itemCount: number;
};

/**
 * nexus.inventory_export() row (server-side, for the file writer). Same rows and order as the screen:
 * one row per quantity item, one row per unit of a tracked item (a tracked item without units: one row).
 * Managers get archived and lost units exactly as in the catalog list (fix 20261108100000).
 * The file shows ONE status column built with inventoryExportStatusLabel().
 */
export type InventoryExportRow = {
  rowNo: number;
  itemId: string;
  /** Quantity item: item code. Tracked item: the unit's code (null for a tracked item without units). */
  code: string | null;
  itemName: string;
  mode: ItemMode;
  categoryName: string | null;
  /** Quantity item: its location. Unit row: the unit's location. */
  locationName: string | null;
  /** Unit rows only; null on quantity-item rows. */
  unitCondition: ItemCondition | null;
  unitStatus: UnitStatus | null;
  /** Quantity rows (and a tracked item without units); null on unit rows. */
  qtyGood: number | null;
  qtyNeedsService: number | null;
  qtyDamaged: number | null;
  qtyTotal: number | null;
  itemIsActive: boolean;
  /** Filled only with the "Tersedia pada tanggal" filter. */
  freeQty: number | null;
};

// ---- Borrowing ----

/** One line of a request in list rows (items jsonb of _ib_request_rows). */
export type RequestItemSummary = {
  itemId: string;
  name: string;
  code: string | null;
  mode: ItemMode;
  quantityRequested: number;
  /** null until decided. */
  quantityApproved: number | null;
  /** null until handed over. */
  quantityHandedOver: number | null;
  quantityOutstanding: number;
};

/**
 * Derived flags (R9), computed by the database with the Jakarta date at read time; nothing is stored.
 * isOverdue (F9 "Terlambat"): status borrowed AND something still out AND endDate before today.
 */
export type RequestDerivedFlags = {
  /** Sum of outstanding over all lines (handed over minus non-reversed return outcomes). */
  qtyOutstanding: number;
  isOverdue: boolean;
  /** today - endDate when overdue, else 0 ("Terlambat {n} hari"). */
  overdueDays: number;
  /** "Belum diambil": approved and startDate before today. */
  isNotPickedUp: boolean;
  /** "Sebagian kembali": borrowed, something still out, something already back. */
  isPartiallyReturned: boolean;
};

/** Who asked: a member, or an outside party recorded by an Operations member (requester of record). */
export type RequestParty = {
  isOutsideParty: boolean;
  outsideOrgName: string | null;
  outsideContactName: string | null;
};

/** nexus.borrowing_my_requests() row: OWN requests only (L9), also outside-party ones you recorded. */
export type MyRequestRow = RequestDerivedFlags &
  RequestParty & {
    rowNo: number;
    requestId: string;
    /** PJM-0001. */
    reference: string;
    status: RequestStatus;
    version: number;
    periodLabel: string | null;
    purpose: string;
    startDate: IsoDate;
    endDate: IsoDate;
    items: RequestItemSummary[];
    hasIssue: boolean;
    extensionCount: number;
    decidedByName: string | null;
    decisionNote: string | null;
    createdAt: IsoTimestamp;
  };

export type MyRequestsPage = Paged<MyRequestRow> & { filter: MyRequestsFilter };

/** nexus.borrowing_queue() row (borrowing.view_all). */
export type QueueRow = RequestDerivedFlags &
  RequestParty & {
    rowNo: number;
    requestId: string;
    reference: string;
    status: RequestStatus;
    version: number;
    periodId: string;
    periodLabel: string | null;
    /** Current PI-CORE name (for an outside party: the recorder, "Dicatat oleh {nama}"). */
    requesterName: string | null;
    /** The caller's own request ("Pengajuanmu"): approve/reject/extend buttons absent (L6). */
    isOwn: boolean;
    purpose: string;
    startDate: IsoDate;
    endDate: IsoDate;
    items: RequestItemSummary[];
    hasIssue: boolean;
    extensionCount: number;
    /** Other Diajukan requests sharing an item and a day (R6 warning); 0 unless status is submitted. */
    pendingOverlapCount: number;
    createdAt: IsoTimestamp;
  };

export type QueuePage = Paged<QueueRow> & { filters: QueueFilters };

/** nexus.borrowing_queue_counts(): "Tampilkan" option counts and "Antrean (n)" (design 4.4, P12). */
export type QueueCounts = {
  pending: number;
  ready: number;
  borrowed: number;
  overdue: number;
  openAllPeriods: number;
  /** What waits for THIS caller (head: others' Diajukan; handle: Disetujui + Terlambat; BPH only: 0). */
  actionNeeded: number;
};

/**
 * nexus.borrowing_period_list() row (borrowing.view_all only), newest first: choices for the queue and
 * export period filter. A read-only view of PI-CORE periods.
 */
export type BorrowingPeriod = {
  periodId: string;
  /** "2026/2027". */
  label: string;
  /** May be null in PI-CORE. */
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
  isActive: boolean;
};

/** nexus.borrowing_open_loans() row: every unfinished request of every period (F11.5), no paging. */
export type OpenLoanRow = RequestDerivedFlags &
  RequestParty & {
    rowNo: number;
    requestId: string;
    reference: string;
    /** submitted, approved or borrowed. */
    status: RequestStatus;
    periodId: string;
    periodLabel: string | null;
    requesterName: string | null;
    isOwn: boolean;
    startDate: IsoDate;
    endDate: IsoDate;
    items: RequestItemSummary[];
  };

/** A unit handed over on a line. isOut = not yet returned. */
export type RequestLineUnit = { unitId: string; code: string; isOut: boolean };

/** Evidence photo record. The path is never sent to the UI; use getEvidencePhotoLinks for signed URLs. */
export type EvidencePhoto = { photoId: number; mimeType: EvidenceMimeType | null; sizeBytes: number | null };

/** One recorded return outcome (append-only). Reversed = undone by the one correction (A-IB15). */
export type RequestLineReturn = {
  returnId: number;
  batchId: number;
  outcome: ReturnOutcome;
  quantity: number;
  unitId: string | null;
  unitCode: string | null;
  resultingCondition: DamagedCondition | null;
  note: string | null;
  recordedAt: IsoTimestamp;
  recordedByName: string | null;
  isReversed: boolean;
  photos: EvidencePhoto[];
};

/** One line of the request detail. */
export type RequestLine = {
  lineId: string;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  mode: ItemMode;
  /** false = "Tidak aktif" (R17). */
  itemIsActive: boolean;
  quantityRequested: number;
  quantityApproved: number | null;
  quantityHandedOver: number | null;
  returnedGood: number;
  returnedDamaged: number;
  returnedLost: number;
  outstanding: number;
  handoverNote: string | null;
  /**
   * "Tersedia sekarang {free} dari {lendable}" over the remaining range, not counting this request.
   * Only for borrowing.view_all holders, only while the request is open and not past its end; else null.
   */
  available: { lendable: number; free: number } | null;
  units: RequestLineUnit[];
  returns: RequestLineReturn[];
};

/** Timeline entry, oldest first: a status event or an extension (old and new end date). */
export type RequestTimelineEntry =
  | {
      event: RequestEvent;
      at: IsoTimestamp;
      fromStatus: RequestStatus | null;
      toStatus: RequestStatus;
      /** PI-CORE name of the actor (A-IB46: also shown to the requester). */
      actorName: string | null;
      note: string | null;
    }
  | {
      event: "extended";
      at: IsoTimestamp;
      oldEndDate: IsoDate;
      newEndDate: IsoDate;
      actorName: string | null;
      note: string;
    };

/**
 * Which buttons exist for THIS caller right now (database answer; the write functions re-check all).
 * All false without an active period (R11).
 */
export type RequestActions = {
  canApprove: boolean;
  canReject: boolean;
  canExtend: boolean;
  /** Also false before the start date (A-IB8): show "Belum bisa diserahkan..." from startDate. */
  canHandOver: boolean;
  canReturn: boolean;
  canCancel: boolean;
  /** Approved, or the canceller is not the requester. */
  cancelReasonRequired: boolean;
  /** Returned, of the active period, and not corrected before (once per request, spec 11c). */
  canCorrectReturn: boolean;
};

/** nexus.borrowing_request_detail(): visible to the requester of record and to view_all holders. */
export type RequestDetail = RequestDerivedFlags &
  RequestParty & {
    requestId: string;
    reference: string;
    status: RequestStatus;
    version: number;
    periodId: string;
    periodLabel: string | null;
    requesterName: string | null;
    isOwn: boolean;
    purpose: string;
    note: string | null;
    startDate: IsoDate;
    /** Current end date (after extensions). */
    endDate: IsoDate;
    createdAt: IsoTimestamp;
    decidedAt: IsoTimestamp | null;
    decidedByName: string | null;
    decisionNote: string | null;
    handedOverAt: IsoTimestamp | null;
    handedOverByName: string | null;
    returnedAt: IsoTimestamp | null;
    /** "Ada masalah": something came back damaged or lost. */
    hasIssue: boolean;
    extensionCount: number;
    /** R6 warning count; null for callers without borrowing.view_all. */
    pendingOverlapCount: number | null;
    /**
     * B29 hint: how many OTHER members hold borrowing.approve now (count only). Set only while
     * Diajukan and the caller is a head or the requester; else null. 0 = "waits for another head".
     */
    otherApproverCount: number | null;
    lines: RequestLine[];
    timeline: RequestTimelineEntry[];
    actions: RequestActions;
  };

/** nexus.borrowing_handover_units() row: units the handler may tick (active, Baik, on no open loan). */
export type HandoverUnit = {
  lineId: string;
  itemId: string;
  unitId: string;
  code: string;
  locationId: string | null;
  locationName: string | null;
};

/** A signed, short-lived link to one evidence photo (requester and view_all holders only, L11). */
export type EvidencePhotoLink = { photoId: number; url: string; expiresAt: IsoTimestamp };

// ---- Write results ----

/** nexus.inventory_item_create(). */
export type ItemCreateResult = {
  itemId: string;
  /** INV code of a quantity item; null for tracked. */
  itemCode: string | null;
  /** INV codes of the new units (tracked); [] for quantity. */
  unitCodes: string[];
};
/** inventory_item_update / unit_update / item_set_active / unit_set_active: false = nothing to change. */
export type ChangeResult = { changed: boolean };
/** nexus.inventory_unit_add(): codes of the new units. */
export type UnitAddResult = { unitCodes: string[] };
/** nexus.inventory_stock_add(): the new quantity in that condition. */
export type StockAddResult = { quantity: number };
/** Category/location add, rename, set_active. */
export type ListEntryResult = { id: string };
/** Every borrowing transition: the new status and version, so the screen continues without a reload. */
export type RequestTransitionResult = { requestId: string; status: RequestStatus; version: number };
/** nexus.borrowing_request_create(). */
export type RequestCreateResult = RequestTransitionResult & { reference: string };
/** Upload of one evidence photo: the path to send in the return outcome. */
export type EvidenceUploadResult = { path: string };

// =============================================================================================
// 8. Errors and results
// =============================================================================================

/** Which input a refusal is about (zod path or database detail). `request` = malformed body. */
export type InventoryInputField =
  | "request"
  | "search"
  | "categoryId"
  | "locationId"
  | "condition"
  | "status"
  | "availableFrom"
  | "availableTo"
  | "page"
  | "pageSize"
  | "format"
  | "view"
  | "filter"
  | "kind"
  | "id"
  | "itemId"
  | "itemIds"
  | "periodId"
  | "reference"
  | "unitId"
  | "unitIds"
  | "requestId"
  | "version"
  | "mode"
  | "name"
  | "description"
  | "note"
  | "reason"
  | "purpose"
  | "stock"
  | "units"
  | "quantity"
  | "from"
  | "to"
  | "isActive"
  | "startDate"
  | "endDate"
  | "newEndDate"
  | "lines"
  | "outsideParty"
  | "outsideOrgName"
  | "outsideContactName"
  | "outcomes"
  | "outcome"
  | "resultingCondition"
  | "photos"
  | "file";

/** Entities a not_found can be about (P0002 hints). A request you may not see is also not_found (R8). */
export type InventoryEntity = "request" | "item" | "unit" | "category" | "location" | "line";

/**
 * Error union. HTTP-like meaning: unauthenticated 401, forbidden 403, invalid input 400, not_found 404,
 * business refusals 409/422, unavailable 503 (fail closed: never shown as "no access", never a sign-out).
 * `field` names the input; `ref` is an id from the database detail (item, line or unit id) so the UI can
 * mark the right line. Payloads carry counts and dates only, never a person (R8, IB-13).
 */
export type InventoryError =
  // Session and access (L1, keys). not_active_member (42501) and permission_required (42501) -> forbidden.
  | { code: "unauthenticated" }
  | { code: "forbidden" }
  | { code: "unavailable" }
  | { code: "self_approval_blocked" } // L6
  | { code: "closed_period" } // L7: correction of an old-period request
  // Input (22023). invalid_input/invalid_status/invalid_view/invalid_page/invalid_page_size/
  // invalid_format/search_too_long -> invalid_input with the field.
  | { code: "invalid_input"; field: InventoryInputField; ref?: string }
  | { code: "text_required" | "text_too_long" | "reason_required" | "note_required"; field: InventoryInputField; ref?: string }
  | { code: "quantity_invalid"; field: InventoryInputField; ref?: string }
  | { code: "invalid_dates" | "start_in_past"; field: InventoryInputField }
  | { code: "date_range_too_long"; field: InventoryInputField; maxEndDate: IsoDate | null }
  | { code: "invalid_mode" | "invalid_condition" | "location_per_unit" | "item_not_tracked" | "item_not_quantity" }
  | { code: "outside_party_incomplete" | "too_many_lines" }
  | { code: "duplicate_item"; itemId: string | null }
  | { code: "too_many_units"; ref: string | null }
  | { code: "invalid_photo" | "photo_count"; ref: string | null }
  | { code: "duplicate_name" } // 23505
  // Not found (P0002).
  | { code: "not_found"; entity: InventoryEntity; ref?: string }
  // Business refusals (P0001).
  | { code: "no_active_period" } // R11
  | { code: "state_changed" } // "Data sudah berubah. Muat ulang."
  /**
   * conflictDate: only for an extension (A-IB53), the first day of the added range on which the item is
   * short, found by the server through the availability function; null when it cannot be found.
   */
  | { code: "insufficient_stock"; itemId: string | null; conflictDate: IsoDate | null }
  | { code: "item_not_lendable"; itemId: string | null }
  | { code: "reserved_stock"; count: number } // detail = peak reserved quantity
  | { code: "open_requests_exist"; count: number } // detail = open line count
  | { code: "unit_on_loan" }
  | { code: "item_archived" }
  | { code: "unit_not_available"; unitId: string | null; unitStatus: UnitStatus | null }
  | { code: "too_early"; startDate: IsoDate | null } // A-IB8
  | { code: "nothing_to_hand_over" }
  | { code: "correction_conflict"; unitCode: string | null } // stock or unit changed since the return (only that)
  | { code: "already_corrected" } // the one correction per request was used (spec 11c)
  | { code: "stock_mismatch" } // return: counted stock no longer matches the loan (stale screen data)
  | { code: "invalid_period" } // queue/export period filter: unknown period id
  | { code: "photo_missing"; ref: string | null } // the path was never uploaded
  | { code: "upload_refused" } // Storage policy said no (no right, request not Dipinjam, or 10 unattached)
  | { code: "too_many_open_requests"; limit: number } // R29: 5 Diajukan
  | { code: "daily_request_limit"; limit: number } // R29: 20 per Jakarta day
  // Server only (no database hint). Added 2026-11-08 (tech lead).
  /** Export answer may have been cut by the API row limit (POSTGREST_MAX_ROWS); interim guard, HTTP 422. */
  | { code: "export_too_large" }
  /** Upload above the bucket limit EVIDENCE_MAX_BYTES; maxMb = that limit in MB (1.5). HTTP 413. */
  | { code: "photo_too_large"; maxMb: number };

export type InventoryErrorCode = InventoryError["code"];

export type InventoryResult<T> = { ok: true; data: T } | { ok: false; error: InventoryError };

/** JSON body of every non-2xx answer from the export and upload route handlers. */
export type InventoryErrorBody = { error: InventoryError };

/**
 * Database hint -> error code. Hints not listed here (and any error without a hint, network failures,
 * unexpected shapes) answer `unavailable` (fail closed). The three guard hints immutable_column,
 * export_log_direct_insert and append_only fire only on a bug (no RPC path reaches them) and are
 * deliberately `unavailable` too.
 */
// Look up with Object.hasOwn (a hint like "constructor" must not resolve through the prototype, BUG-MD-01).
export const INVENTORY_DB_HINTS: Record<string, InventoryErrorCode> = {
  // 42501
  permission_required: "forbidden",
  not_active_member: "forbidden",
  self_approval_blocked: "self_approval_blocked",
  closed_period: "closed_period",
  immutable_column: "unavailable",
  export_log_direct_insert: "unavailable",
  append_only: "unavailable",
  // P0002
  request_not_found: "not_found",
  item_not_found: "not_found",
  unit_not_found: "not_found",
  category_not_found: "not_found",
  location_not_found: "not_found",
  line_not_found: "not_found",
  // P0001
  no_active_period: "no_active_period",
  state_changed: "state_changed",
  insufficient_stock: "insufficient_stock",
  reserved_stock: "reserved_stock",
  item_not_lendable: "item_not_lendable",
  open_requests_exist: "open_requests_exist",
  unit_on_loan: "unit_on_loan",
  item_archived: "item_archived",
  unit_not_available: "unit_not_available",
  too_early: "too_early",
  nothing_to_hand_over: "nothing_to_hand_over",
  correction_conflict: "correction_conflict",
  already_corrected: "already_corrected",
  stock_mismatch: "stock_mismatch",
  photo_missing: "photo_missing",
  too_many_open_requests: "too_many_open_requests",
  daily_request_limit: "daily_request_limit",
  // 23505
  duplicate_name: "duplicate_name",
  // 22023
  date_range_too_long: "date_range_too_long",
  too_many_units: "too_many_units",
  invalid_input: "invalid_input",
  invalid_mode: "invalid_mode",
  invalid_condition: "invalid_condition",
  invalid_status: "invalid_input",
  invalid_view: "invalid_input",
  invalid_dates: "invalid_dates",
  start_in_past: "start_in_past",
  quantity_invalid: "quantity_invalid",
  text_required: "text_required",
  text_too_long: "text_too_long",
  reason_required: "reason_required",
  note_required: "note_required",
  duplicate_item: "duplicate_item",
  too_many_lines: "too_many_lines",
  outside_party_incomplete: "outside_party_incomplete",
  location_per_unit: "location_per_unit",
  item_not_tracked: "item_not_tracked",
  item_not_quantity: "item_not_quantity",
  invalid_photo: "invalid_photo",
  photo_count: "photo_count",
  search_too_long: "invalid_input",
  invalid_page: "invalid_input",
  invalid_page_size: "invalid_input",
  invalid_format: "invalid_input",
  invalid_period: "invalid_period",
};

/** Generic texts reused by several codes (design 3.6). */
const COPY_UNAVAILABLE = "Terjadi gangguan. Coba lagi sebentar lagi.";
const COPY_STATE_CHANGED = "Data sudah berubah. Muat ulang.";

/**
 * Indonesian copy per error code: word for word from the design (docs/design/inventory-borrowing.md), the
 * spec, or the owner's approval of 2026-11-08 ("owner"). Placeholders in braces are filled with
 * formatInventoryCopy(). `null` = PER FIELD: the design words it per input (the comment says where) and
 * the UI picks the text for the field it marks. Codes whose text depends on the ACTION or the entity
 * (not_found, no_active_period, insufficient_stock, unit_not_available, invalid_photo) hold the most
 * common text here; use inventoryErrorMessage() to get the right variant.
 */
export const INVENTORY_ERROR_COPY: Record<InventoryErrorCode, string | null> = {
  unauthenticated: null, // no text: redirect to /login?reason=session_ended (auth-login F9)
  forbidden: "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", // 3.6 (pages: ForbiddenScreen)
  unavailable: COPY_UNAVAILABLE, // 3.6
  self_approval_blocked: "Tidak bisa memproses pengajuanmu sendiri. Kepala lain yang memutuskan.", // 11.2
  closed_period: "Pengajuan ini dari periode yang sudah selesai, jadi tidak bisa diubah lagi.", // owner
  invalid_input: null, // PER FIELD: summary "Ada {n} isian yang perlu diperbaiki." (3.4); search 3.6; export 15.2
  text_required: null, // PER FIELD: 7.4, 8.2, 9.2 (e.g. "Isi nama barang.", "Isi keperluannya, ...")
  text_too_long: null, // PER FIELD: "{Field} terlalu panjang. Pakai paling banyak {n} karakter." (7.4, 8.2, 9.2)
  reason_required: null, // PER FIELD: "Tulis alasannya." (7.6), "Tulis alasan pembatalan." (10.4), "Tulis alasan koreksi." (11.4)
  note_required: null, // PER FIELD: reject 11.3, extend 11.3, approve-lower 11.3, handover 12.2, return 13.2
  quantity_invalid: null, // PER FIELD: 7.4, 7.6a, 9.2, 12.2, 13.2 ("Isi angka bulat, mulai 1.", ...)
  invalid_dates: "Tanggal akhir tidak boleh sebelum tanggal mulai.", // 6.2, 9.2 (extend: "Pilih tanggal setelah {tanggal}." 11.3)
  start_in_past: "Tanggal mulai tidak boleh sebelum hari ini.", // 6.2, 9.2
  date_range_too_long:
    "Peminjaman paling lama 365 hari dari tanggal mulai. Untuk waktu yang lebih lama, buat pengajuan baru.", // owner
  invalid_mode: "Pilih cara mencatat barang ini.", // 7.4
  invalid_condition: null, // PER FIELD: "Pilih kondisi unit." (7.4), "Pilih kondisi barang sekarang." (13.2)
  location_per_unit: COPY_UNAVAILABLE, // owner: programming error, generic text
  item_not_tracked: COPY_UNAVAILABLE, // owner
  item_not_quantity: COPY_UNAVAILABLE, // owner
  outside_party_incomplete: null, // PER FIELD: "Isi nama organisasi." / "Isi nama penanggung jawab." (9.2)
  too_many_lines: "Satu pengajuan paling banyak 50 barang. Bagi jadi beberapa pengajuan.", // owner
  duplicate_item: "Barang ini sudah ditambahkan.", // owner
  too_many_units: "Paling banyak 200 unit untuk satu barang dalam satu pengajuan.", // owner
  invalid_photo: "Format foto tidak didukung. Pakai JPG, PNG, atau WebP.", // 13.3 (bad path: generic, owner)
  photo_count: "Tambahkan minimal satu foto.", // 13.2 (more than 3: "Maksimal 3 foto." is a hint line, 13.3)
  duplicate_name: "Nama ini sudah ada.", // 8.2
  not_found: "Data ini tidak ditemukan. Muat ulang.", // owner (unit, category, location, line); request/item: variants
  no_active_period: "Belum ada periode aktif. Perubahan belum bisa disimpan.", // owner (submit: variant, 3.6)
  state_changed: COPY_STATE_CHANGED, // 3.6
  insufficient_stock: "Stok berubah. Cek lagi.", // 9.5 (submit); approve, extend, correction: variants
  item_not_lendable: "Ada barang yang sekarang tidak bisa dipinjam. Hapus dari daftar, lalu kirim lagi.", // owner
  reserved_stock:
    "Tidak bisa. Barang yang baik tidak boleh kurang dari {n}, karena {n} sudah dipesan untuk peminjaman yang belum selesai.", // 7.6b
  open_requests_exist: "Barang ini masih punya {n} peminjaman yang belum selesai. Selesaikan atau batalkan dulu.", // 7.6d
  unit_on_loan: "Unit ini sedang dipinjam. Tunggu sampai dikembalikan.", // owner
  item_archived: "Barang ini nonaktif. Aktifkan kembali dulu.", // owner
  unit_not_available: "Unit ini tidak tersedia. Muat ulang untuk melihat keadaannya sekarang.", // owner (handover: variant 12.4)
  too_early: "Belum bisa diserahkan. Tanggal mulai peminjaman: {tanggal}.", // 12.3
  nothing_to_hand_over:
    "Pilih minimal satu barang yang diserahkan. Kalau tidak ada yang diserahkan, batalkan pengajuan.", // 12.3
  correction_conflict: "Stok barang ini sudah berubah sejak pengembalian. Perbaiki stoknya dari halaman barang.", // owner
  already_corrected: "Pengembalian ini sudah pernah dikoreksi. Koreksi hanya boleh sekali.", // owner
  stock_mismatch: COPY_UNAVAILABLE, // owner: stale data, generic text
  invalid_period: COPY_STATE_CHANGED, // owner
  photo_missing: "Foto gagal diunggah. Coba lagi.", // spec 3 states table, 13.3
  upload_refused: "Foto tidak bisa ditambahkan lagi ke pengajuan ini. Muat ulang untuk melihat statusnya.", // owner
  too_many_open_requests:
    "Kamu sudah punya 5 pengajuan yang menunggu persetujuan. Tunggu keputusannya atau batalkan salah satu.", // owner
  daily_request_limit: "Kamu sudah membuat 20 pengajuan hari ini. Coba lagi besok.", // owner
  export_too_large: "Hasil terlalu banyak untuk satu file. Persempit filter, lalu coba lagi.", // tech lead 2026-11-08
  photo_too_large: "Foto terlalu besar. Pakai foto di bawah {max} MB.", // 13.3 ({max} = error.maxMb)
};

/** Action variants of the codes whose text depends on what the person was doing. */
export const INVENTORY_ERROR_COPY_VARIANTS = {
  notFound: {
    request: "Pengajuan ini tidak ditemukan.", // 10.5
    item: "Barang ini tidak ditemukan.", // 6.4
  },
  noActivePeriod: {
    submitRequest: "Belum ada periode aktif. Pengajuan belum bisa dibuat.", // 3.6
  },
  insufficientStock: {
    submitRequest: "Stok berubah. Cek lagi.", // 9.5
    approve: "Stok tidak cukup di tanggal itu. Pengajuan tetap menunggu.", // 11.3
    extend: "Bentrok dengan pengajuan lain pada {tanggal}. Tanggal belum diubah.", // 11.3
    /** A-IB53: no date found. Derived from 11.3 by dropping "pada {tanggal}"; confirm with the owner. */
    extendWithoutDate: "Bentrok dengan pengajuan lain. Tanggal belum diubah.",
    correctReturn: "Stok tidak cukup untuk koreksi ini.", // owner
  },
  unitNotAvailable: {
    handOver: "Unit {kode} baru dipakai pengajuan lain. Pilih unit lain.", // 12.4
  },
  invalidPhoto: {
    /** Bad or duplicate path: the browser built it, so it is a programming error (owner). */
    path: COPY_UNAVAILABLE,
  },
} as const;

/** The action that produced an error; picks the copy variant. */
export type InventoryAction =
  | "submitRequest"
  | "approve"
  | "reject"
  | "extend"
  | "cancel"
  | "handOver"
  | "return"
  | "correctReturn"
  | "uploadPhoto"
  | "manage"
  | "read"
  | "export";

/**
 * The text to show for an error, or null when the UI must pick a PER FIELD text (see INVENTORY_ERROR_COPY)
 * or redirect (unauthenticated). Placeholders are filled where the error carries the value; `{kode}`
 * (handover unit code) comes from the caller's unit list, `unitCode`. Dates are passed through
 * `formatDate` (the UI's "10 Des 2026" formatter, design 3.5); default = the ISO date as is.
 */
export function inventoryErrorMessage(
  error: InventoryError,
  action: InventoryAction,
  extra: { unitCode?: string; formatDate?: (date: IsoDate) => string } = {},
): string | null {
  const v = INVENTORY_ERROR_COPY_VARIANTS;
  const formatDate = extra.formatDate ?? ((date: IsoDate) => date);
  switch (error.code) {
    case "not_found":
      if (error.entity === "request") return v.notFound.request;
      if (error.entity === "item") return v.notFound.item;
      return INVENTORY_ERROR_COPY.not_found;
    case "no_active_period":
      return action === "submitRequest" ? v.noActivePeriod.submitRequest : INVENTORY_ERROR_COPY.no_active_period;
    case "insufficient_stock":
      if (action === "approve") return v.insufficientStock.approve;
      if (action === "correctReturn") return v.insufficientStock.correctReturn;
      if (action === "extend") {
        return error.conflictDate === null
          ? v.insufficientStock.extendWithoutDate
          : formatInventoryCopy(v.insufficientStock.extend, { tanggal: formatDate(error.conflictDate) });
      }
      return v.insufficientStock.submitRequest;
    case "unit_not_available":
      if (action === "handOver" && extra.unitCode !== undefined) {
        return formatInventoryCopy(v.unitNotAvailable.handOver, { kode: extra.unitCode });
      }
      return INVENTORY_ERROR_COPY.unit_not_available;
    case "invalid_photo":
      // The type check happens on upload; on a saved return the path is the problem.
      return action === "uploadPhoto" ? INVENTORY_ERROR_COPY.invalid_photo : v.invalidPhoto.path;
    case "reserved_stock":
    case "open_requests_exist":
      return formatInventoryCopy(INVENTORY_ERROR_COPY[error.code] ?? "", { n: error.count });
    case "photo_too_large":
      return formatInventoryCopy(INVENTORY_ERROR_COPY.photo_too_large ?? "", {
        max: error.maxMb.toLocaleString("id-ID", { maximumFractionDigits: 1 }),
      });
    case "too_early":
      return error.startDate === null
        ? COPY_UNAVAILABLE
        : formatInventoryCopy(INVENTORY_ERROR_COPY.too_early ?? "", { tanggal: formatDate(error.startDate) });
    default:
      return INVENTORY_ERROR_COPY[error.code];
  }
}

/** Fills "{n}", "{tanggal}", "{kode}" ... in a copy string. Unknown placeholders stay as they are. */
export function formatInventoryCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : whole));
}

// =============================================================================================
// 9. Labels (stored value -> Indonesian), shared by the screens and the export files
//    Sources: migration header, design 4.3, 7.1, 10.1, 11.1, 17.
// =============================================================================================

export const ITEM_MODE_LABEL: Record<ItemMode, string> = { tracked: "Dilacak per unit", quantity: "Dihitung per jumlah" };
export const CONDITION_LABEL: Record<ItemCondition, string> = { good: "Baik", needs_service: "Perlu servis", damaged: "Rusak" };
/** "Aktif" follows the design's list-entry chip (17); archived and lost are design chips. */
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = { active: "Aktif", archived: "Nonaktif", lost: "Hilang" };
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: "Diajukan",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  borrowed: "Dipinjam",
  returned: "Dikembalikan",
};
/** Spec F6 wording ("kembali baik", "kembali rusak", "hilang"); the return screen uses Baik / Rusak / Hilang. */
export const RETURN_OUTCOME_LABEL: Record<ReturnOutcome, string> = { good: "kembali baik", damaged: "kembali rusak", lost: "hilang" };
export const QUEUE_VIEW_LABEL: Record<QueueView, string> = {
  pending: "Menunggu persetujuan",
  ready: "Siap diambil",
  borrowed: "Sedang dipinjam",
  overdue: "Terlambat",
  closed: "Selesai",
  all: "Semua",
  open_all_periods: "Belum selesai, semua periode",
};
export const MY_REQUESTS_FILTER_LABEL: Record<MyRequestsFilter, string> = { open: "Berjalan", closed: "Selesai", all: "Semua" };

/**
 * Timeline lines ("Riwayat", design 10.2), owner-approved 2026-11-08. {nama} = the entry's actorName.
 * `extended` keeps the design text; its second line shows old and new end date and the note.
 */
export const TIMELINE_EVENT_LABEL: Record<RequestEvent | "extended", string> = {
  submitted: "Diajukan",
  approved: "Disetujui oleh {nama}",
  rejected: "Ditolak oleh {nama}",
  cancelled: "Dibatalkan oleh {nama}",
  handed_over: "Diserahkan, dicatat {nama}",
  returned_partial: "Sebagian dikembalikan, dicatat {nama}",
  returned: "Dikembalikan, dicatat {nama}",
  return_corrected: "Pengembalian dikoreksi oleh {nama}",
  extended: "Tanggal kembali diubah",
};

/** Item history ("Riwayat barang"), owner-approved 2026-11-08. */
export const ITEM_HISTORY_KIND_LABEL: Record<ItemHistoryKind, string> = {
  created: "Ditambahkan ke katalog",
  edited: "Data barang diubah",
  unit_added: "Unit ditambahkan",
  stock_added: "Stok ditambahkan",
  condition_changed: "Kondisi diubah",
  written_off: "Dicatat hilang atau dibuang",
  archived: "Dinonaktifkan",
  reactivated: "Diaktifkan kembali",
  restored: "Ditemukan kembali",
};

/**
 * The ONE "Status" column of the inventory export (owner / tech lead 2026-11-08): a lost unit is
 * "Hilang"; an archived unit or any row of an archived item is "Nonaktif"; everything else "Aktif".
 * Hilang wins over an archived item, because it says more about that unit.
 */
export function inventoryExportStatusLabel(row: Pick<InventoryExportRow, "unitStatus" | "itemIsActive">): string {
  if (row.unitStatus === "lost") return UNIT_STATUS_LABEL.lost;
  if (row.unitStatus === "archived" || !row.itemIsActive) return UNIT_STATUS_LABEL.archived;
  return UNIT_STATUS_LABEL.active;
}

// =============================================================================================
// 10. Pure helpers (screen, server and export agree on dates)
// =============================================================================================

/** Today's calendar date in Asia/Jakarta (R19) as "YYYY-MM-DD". */
export function jakartaToday(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "YYYY-MM-DD" plus n days (calendar arithmetic, no time zone involved). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Latest allowed end date for a request or an extension: ORIGINAL start + 365 days (R30). */
export function maxRequestEndDate(startDate: IsoDate): IsoDate {
  return addDays(startDate, INVENTORY_LIMITS.requestMaxDays);
}

/** Inclusive length of a range in days ("(3 hari)", design 3.5). */
export function rangeDays(startDate: IsoDate, endDate: IsoDate): number {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * F9 "Terlambat", the same rule as the database: Dipinjam, something still out, end date before today
 * (Jakarta). The server rows already carry isOverdue; use this only for client-side re-evaluation.
 */
export function isRequestOverdue(
  row: { status: RequestStatus; qtyOutstanding: number; endDate: IsoDate },
  today: IsoDate,
): boolean {
  return row.status === "borrowed" && row.qtyOutstanding > 0 && row.endDate < today;
}

// =============================================================================================
// 11. Capabilities (menus and buttons only; every server entry point and the database check again)
// =============================================================================================

export type InventoryCapabilities = {
  /** inventory.view (baseline D01): drawer item, Katalog, item detail, availability, Dashboard card. */
  canViewCatalog: boolean;
  /** inventory.manage: Kelola Barang, item form, stock dialogs, categories and locations. */
  canManageInventory: boolean;
  /** inventory.export (gated on view by the engine): "Ekspor" on Katalog and Kelola Barang. */
  canExportInventory: boolean;
  /** inventory.manage or borrowing.view_all (database rule of inventory_item_history_list). */
  canViewItemHistory: boolean;
  /** Fixed right (L9): "Peminjaman Saya" and own request details. Any active member. */
  canViewOwnRequests: boolean;
  /** Fixed right (L9) AND an active period (R11): "+ Ajukan Peminjaman". */
  canSubmitRequest: boolean;
  /** borrowing.view_all (the engine adds it for approve and handle): Antrean, open loans. */
  canViewAllRequests: boolean;
  /** borrowing.approve: approve, reject, extend. Never on own requests (per request: detail.actions). */
  canApprove: boolean;
  /** borrowing.handle: handover, return, cancel approved, correct a return, outside-party requests. */
  canHandle: boolean;
  /** borrowing.handle and an active period: "Untuk pihak luar" on the request form (F10). */
  canRecordOutsideParty: boolean;
  /** borrowing.export (gated on view_all by the engine): "Ekspor" on Antrean. */
  canExportBorrowing: boolean;
  /** false = show "Belum ada periode aktif..." banner. */
  hasActivePeriod: boolean;
};

const NO_CAPABILITIES: InventoryCapabilities = {
  canViewCatalog: false,
  canManageInventory: false,
  canExportInventory: false,
  canViewItemHistory: false,
  canViewOwnRequests: false,
  canSubmitRequest: false,
  canViewAllRequests: false,
  canApprove: false,
  canHandle: false,
  canRecordOutsideParty: false,
  canExportBorrowing: false,
  hasActivePeriod: false,
};

/**
 * Derives the capabilities from the session state. my_permissions() already returns the union of all
 * active-period assignments with implied keys added (manage -> view, approve/handle -> view_all) and
 * export keys gated on their view key (R15). These keys accept scope "all" only (spec section 2).
 */
export function inventoryCapabilities(state: AccessState): InventoryCapabilities {
  if (state.kind !== "member") return NO_CAPABILITIES;
  const has = (key: string) => state.permissions.some((grant) => grant.key === key && grant.scope === "all");
  const hasActivePeriod = state.member.activePeriodId !== null;
  const canViewCatalog = has("inventory.view");
  const canManageInventory = has("inventory.manage");
  const canHandle = has("borrowing.handle");
  const canViewAllRequests = has("borrowing.view_all");
  return {
    canViewCatalog,
    canManageInventory,
    canExportInventory: canViewCatalog && has("inventory.export"),
    canViewItemHistory: canManageInventory || canViewAllRequests,
    canViewOwnRequests: true,
    canSubmitRequest: hasActivePeriod,
    canViewAllRequests,
    canApprove: has("borrowing.approve"),
    canHandle,
    canRecordOutsideParty: canHandle && hasActivePeriod,
    canExportBorrowing: canViewAllRequests && has("borrowing.export"),
    hasActivePeriod,
  };
}

/** Default "Tampilkan" option (design 11.1): heads -> pending, other Operations -> ready, BPH -> all. */
export function defaultQueueView(capabilities: InventoryCapabilities): QueueView {
  if (capabilities.canApprove) return "pending";
  if (capabilities.canHandle) return "ready";
  return "all";
}

/*
 * =============================================================================================
 * 12. Functions the backend will provide (signatures are part of this contract). All server only.
 *     Each one: session + capability check first (getAccessState), zod validation, then ONE call to the
 *     nexus RPC with the USER's client (the database checks again). Never throws; returns
 *     InventoryResult<T>. Write functions are Server Actions ("use server").
 *     The RPC wrappers live in src/lib/picore/inventory-borrowing.ts (they read PI-CORE names, periods
 *     and assignments through nexus functions; CLAUDE.md 4).
 * =============================================================================================
 *
 * src/modules/inventory-borrowing/server/catalog.ts                        (reads; needs canViewCatalog unless noted)
 *   listCatalog(input?: CatalogQueryInput): Promise<InventoryResult<CatalogPage>>        inventory_item_list
 *   getItemDetail(itemId: string): Promise<InventoryResult<ItemDetail>>                   inventory_item_detail
 *   getItemAvailability(input: AvailabilityQueryInput): Promise<InventoryResult<ItemAvailability>>
 *                                                                                         inventory_item_availability
 *   getAvailabilityBulk(input: BulkAvailabilityQueryInput): Promise<InventoryResult<ItemAvailability[]>>
 *                                                                                         inventory_availability_bulk
 *   listEntries(input: ListEntriesQueryInput): Promise<InventoryResult<ListEntry[]>>      inventory_category_list / _location_list
 *   listItemHistory(input: ItemHistoryQueryInput): Promise<InventoryResult<ItemHistoryPage>>
 *                                                     (canViewItemHistory)                inventory_item_history_list
 *   getInventoryStatusCounts(): Promise<InventoryResult<InventoryStatusCounts>>          inventory_status_counts
 *
 * src/modules/inventory-borrowing/server/manage-actions.ts                 ("use server"; canManageInventory)
 *   createItem(input: ItemCreateInput): Promise<InventoryResult<ItemCreateResult>>        inventory_item_create
 *   updateItem(input: ItemUpdateInput): Promise<InventoryResult<ChangeResult>>            inventory_item_update
 *   addUnits(input: UnitAddInput): Promise<InventoryResult<UnitAddResult>>                inventory_unit_add
 *   moveUnit(input: UnitMoveInput): Promise<InventoryResult<ChangeResult>>                inventory_unit_update
 *   addStock(input: StockAddInput): Promise<InventoryResult<StockAddResult>>              inventory_stock_add
 *   moveStock(input: StockMoveInput): Promise<InventoryResult<null>>                      inventory_stock_move
 *   writeOffStock(input: StockWriteOffInput): Promise<InventoryResult<null>>              inventory_stock_write_off
 *   setUnitCondition(input: UnitConditionInput): Promise<InventoryResult<null>>           inventory_unit_set_condition
 *   writeOffUnit(input: UnitWriteOffInput): Promise<InventoryResult<null>>                inventory_unit_write_off
 *   restoreLostUnit(input: UnitRestoreInput): Promise<InventoryResult<null>>              inventory_unit_restore_lost
 *   setItemActive(input: ItemSetActiveInput): Promise<InventoryResult<ChangeResult>>      inventory_item_set_active
 *   setUnitActive(input: UnitSetActiveInput): Promise<InventoryResult<ChangeResult>>      inventory_unit_set_active
 *   addListEntry(input: ListEntryAddInput): Promise<InventoryResult<ListEntryResult>>     inventory_category_add / _location_add
 *   renameListEntry(input: ListEntryRenameInput): Promise<InventoryResult<ListEntryResult>>
 *   setListEntryActive(input: ListEntrySetActiveInput): Promise<InventoryResult<ListEntryResult>>
 *
 * src/modules/inventory-borrowing/server/borrowing.ts                      (reads)
 *   listMyRequests(input?: MyRequestsQueryInput): Promise<InventoryResult<MyRequestsPage>>
 *                                                     (canViewOwnRequests)                borrowing_my_requests
 *   listQueue(input?: QueueQueryInput): Promise<InventoryResult<QueuePage>>  (canViewAllRequests) borrowing_queue
 *   getQueueCounts(): Promise<InventoryResult<QueueCounts>>                  (canViewAllRequests) borrowing_queue_counts
 *   listOpenLoans(): Promise<InventoryResult<OpenLoanRow[]>>                 (canViewAllRequests) borrowing_open_loans
 *   getRequestDetail(requestId: string): Promise<InventoryResult<RequestDetail>>
 *                                                     (own or view_all; else not_found)   borrowing_request_detail
 *   getRequestDetailByReference(reference: string): Promise<InventoryResult<RequestDetail>>
 *     For /inventaris/pengajuan/{ref}. requestReferenceSchema first; same visibility and JSON as above;
 *     unknown and not-visible both answer not_found "request".                            borrowing_request_detail_by_ref
 *   listBorrowingPeriods(): Promise<InventoryResult<BorrowingPeriod[]>>      (canViewAllRequests) borrowing_period_list
 *   listHandoverUnits(requestId: string): Promise<InventoryResult<HandoverUnit[]>> (canHandle) borrowing_handover_units
 *   getEvidencePhotoLinks(requestId: string): Promise<InventoryResult<EvidencePhotoLink[]>>
 *     Requester or view_all. Signs each attached photo of the request for EVIDENCE_SIGNED_URL_TTL_SECONDS
 *     with the USER's client (bucket policy borrowing_evidence_can_read checks again).
 *
 * src/modules/inventory-borrowing/server/borrowing-actions.ts              ("use server")
 *   submitRequest(input: RequestCreateInput): Promise<InventoryResult<RequestCreateResult>>
 *                                                     (canSubmitRequest; outsideParty needs canHandle)
 *                                                                                         borrowing_request_create
 *   approveRequest(input: RequestApproveInput): Promise<InventoryResult<RequestTransitionResult>> (canApprove)
 *   rejectRequest(input: RequestRejectInput): Promise<InventoryResult<RequestTransitionResult>>   (canApprove)
 *   extendRequest(input: RequestExtendInput): Promise<InventoryResult<RequestTransitionResult>>   (canApprove)
 *     On insufficient_stock the server looks for the first short day of the added range with the
 *     availability function and returns it as conflictDate (A-IB53); null when none is found.
 *   cancelRequest(input: RequestCancelInput): Promise<InventoryResult<RequestTransitionResult>>
 *                                                     (requester of record, or canHandle; database decides)
 *   handOverRequest(input: RequestHandOverInput): Promise<InventoryResult<RequestTransitionResult>> (canHandle)
 *   recordReturn(input: RequestReturnInput): Promise<InventoryResult<RequestTransitionResult>>      (canHandle)
 *   correctReturn(input: RequestCorrectReturnInput): Promise<InventoryResult<RequestTransitionResult>> (canHandle)
 *
 * POST EVIDENCE_UPLOAD_ROUTE = /api/inventory/evidence  (multipart: EVIDENCE_UPLOAD_FIELDS; canHandle; A-IB50)
 *   Same-origin check; checks declared type and size (evidenceFileSchema) AND the file's magic bytes
 *   (JPEG FF D8 FF, PNG 89 50 4E 47, WebP RIFF....WEBP; must match the declared type), then uploads with
 *   the USER's client to EVIDENCE_BUCKET at evidencePhotoPath(...). 200: EvidenceUploadResult.
 *   400 invalid_photo / invalid_input, 413 photo_too_large, 401, 403 upload_refused (bucket policy), 503:
 *   InventoryErrorBody.
 *
 * POST /api/inventory/export           (form/JSON: CatalogExportInput; canExportInventory)
 *   200: the file, Content-Disposition attachment "inventaris-YYYY-MM-DD.<ext>" (Asia/Jakarta, design 15.2).
 * POST /api/inventory/borrowing/export (form/JSON: BorrowingExportInput incl. periodId; canExportBorrowing)
 *   200: the file "peminjaman-YYYY-MM-DD.<ext>".
 *   The catalog file has ONE status column, inventoryExportStatusLabel(row) (Aktif / Nonaktif / Hilang).
 *   Both: same-origin check, ONE call to inventory_export / borrowing_export (writes the export-log row
 *   in the same transaction; no row, no file), Cache-Control no-store. 401/403/400/503: InventoryErrorBody.
 *   422 export_too_large: the answer reached the API row limit (POSTGREST_MAX_ROWS = 1000), so it may be
 *   cut; no file is returned (interim guard until exports are paged or returned as one value).
 */
