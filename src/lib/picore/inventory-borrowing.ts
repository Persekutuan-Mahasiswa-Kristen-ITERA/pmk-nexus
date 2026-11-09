import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readTotalCount, type CountedRows } from "@/lib/supabase/limits";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MIME_TYPES,
  EVIDENCE_PATH_PATTERN,
  INVENTORY_DB_HINTS,
  INVENTORY_LIMITS,
  damagedConditionSchema,
  itemConditionSchema,
  itemHistoryKindSchema,
  itemModeSchema,
  requestEventSchema,
  requestStatusSchema,
  returnOutcomeSchema,
  unitStatusSchema,
  type BorrowingPeriod,
  type CatalogFilters,
  type CatalogPage,
  type CatalogUnit,
  type ChangeResult,
  type EvidenceMimeType,
  type EvidencePhotoLink,
  type EvidenceUploadResult,
  type HandoverUnit,
  type InventoryEntity,
  type InventoryError,
  type InventoryErrorCode,
  type InventoryExportFormat,
  type InventoryExportRow,
  type InventoryInputField,
  type InventoryListKind,
  type InventoryResult,
  type InventoryStatusCounts,
  type ItemAvailability,
  type ItemCreateResult,
  type ItemDetail,
  type ItemHistoryPage,
  type ListEntry,
  type ListEntryResult,
  type MyRequestsFilter,
  type MyRequestsPage,
  type OpenLoanRow,
  type Paged,
  type QueueCounts,
  type QueueFilters,
  type QueuePage,
  type RequestCreateResult,
  type RequestDetail,
  type RequestItemSummary,
  type RequestStatus,
  type RequestTransitionResult,
  type StockAddResult,
  type UnitAddResult,
} from "@/modules/inventory-borrowing/types";

// Thin typed wrappers around the Inventory and Borrowing RPCs (supabase/migrations/20261107100100,
// 20261108100000). These nexus functions check PI-CORE assignments (has_permission), read PI-CORE
// member names and period labels, so they are called from here and nowhere else (CLAUDE.md 4).
// The evidence bucket is here too: its Storage policies run the same PI-CORE-backed checks
// (borrowing_evidence_can_upload / _can_read), and every `.from(` stays in this layer (AUTH-41).
//
// Always with the USER's session client: the database checks the caller again inside every function.
// Inputs must already be validated by the caller (src/modules/inventory-borrowing/server). Answers are
// validated with zod; only the contract's fields survive (z.object strips anything else, so the
// requester's member id and storage paths never reach the UI). Nothing here throws.
// Only src/modules/inventory-borrowing/server/ may import this file.

// =============================================================================================
// Error mapping (contract section 8)
// =============================================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INV_CODE_PATTERN = /^INV-[0-9]{4,}$/;
const UNAVAILABLE: InventoryError = { code: "unavailable" };

/** SQLSTATEs the module raises on purpose. Anything else (also with a known hint) is unavailable. */
const KNOWN_SQLSTATES: ReadonlySet<string> = new Set(["42501", "P0001", "P0002", "22023", "23505"]);

const NOT_FOUND_ENTITY: Record<string, InventoryEntity> = {
  request_not_found: "request",
  item_not_found: "item",
  unit_not_found: "unit",
  category_not_found: "category",
  location_not_found: "location",
  line_not_found: "line",
};

/** Hints that always name the same input (22023 without a field detail). */
const HINT_FIELDS: Record<string, InventoryInputField> = {
  invalid_status: "status",
  invalid_page: "page",
  invalid_page_size: "pageSize",
  invalid_format: "format",
  search_too_long: "search",
  invalid_mode: "mode",
};

/** Database `detail` values that name a parameter or a JSON key -> the contract's input field. */
const DETAIL_FIELDS: Record<string, InventoryInputField> = {
  p_stock: "stock",
  good: "stock",
  needs_service: "stock",
  damaged: "stock",
  p_units: "units",
  p_lines: "lines",
  p_outcomes: "outcomes",
  p_reference: "reference",
  p_item_ids: "itemIds",
  p_is_active: "isActive",
  p_quantity: "quantity",
  quantity: "quantity",
  p_note: "note",
  note: "note",
  p_reason: "reason",
  reason: "reason",
  p_period_id: "periodId",
  outcome: "outcome",
  name: "name",
  description: "description",
  purpose: "purpose",
  outside_org_name: "outsideOrgName",
  outside_contact_name: "outsideContactName",
  item_id: "itemId",
  line_id: "lines",
  unit_id: "unitId",
  location_id: "locationId",
  category_id: "categoryId",
};

/** Per-call hints for the mapper: which input a uuid detail, a date error or invalid_view is about. */
export type InventoryErrorContext = {
  /** Field for input errors whose detail is an id or empty (e.g. "lines" for a handover line). */
  field?: InventoryInputField;
  /** Field for invalid_dates / start_in_past / date_range_too_long. */
  dateField?: InventoryInputField;
  /** Field for invalid_view ("view" for the queue, "filter" for Peminjaman Saya). */
  viewField?: InventoryInputField;
};

function lookup<T>(table: Record<string, T>, key: string | null | undefined): T | undefined {
  // Own keys only: "constructor" / "toString" must not resolve through the prototype (BUG-MD-01).
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}

const asUuid = (value: string | null) => (value !== null && UUID_PATTERN.test(value) ? value.toLowerCase() : null);
const asIsoDate = (value: string | null) => (value !== null && ISO_DATE_PATTERN.test(value) ? value : null);
const asCount = (value: string | null) => (value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null);
/** A line/unit/item id, or an evidence path (photo errors name the photo the browser uploaded). */
const asRef = (value: string | null) => asUuid(value) ?? (value !== null && EVIDENCE_PATH_PATTERN.test(value) ? value : null);

/**
 * Builds the contract error for a code. `detail` is the database detail (null for zod issues); `ref`
 * overrides the id found in the detail. Returns null when a code needs a value the detail does not
 * carry (the caller then answers unavailable: fail closed, never a made-up count).
 */
export function buildInventoryError(
  code: InventoryErrorCode,
  field: InventoryInputField,
  detail: string | null,
  ref?: string | null,
): InventoryError | null {
  const id = ref === undefined ? asUuid(detail) : ref;
  switch (code) {
    case "unauthenticated":
    case "forbidden":
    case "unavailable":
    case "self_approval_blocked":
    case "closed_period":
    case "invalid_mode":
    case "invalid_condition":
    case "location_per_unit":
    case "item_not_tracked":
    case "item_not_quantity":
    case "outside_party_incomplete":
    case "too_many_lines":
    case "duplicate_name":
    case "no_active_period":
    case "state_changed":
    case "unit_on_loan":
    case "item_archived":
    case "nothing_to_hand_over":
    case "already_corrected":
    case "stock_mismatch":
    case "invalid_period":
    case "upload_refused":
    case "export_too_large":
      return { code };
    case "photo_too_large":
      return { code, maxMb: EVIDENCE_MAX_BYTES / (1024 * 1024) };
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "note_required":
    case "quantity_invalid":
      return id ? { code, field, ref: id } : { code, field };
    case "invalid_dates":
    case "start_in_past":
      return { code, field };
    case "date_range_too_long":
      return { code, field, maxEndDate: asIsoDate(detail) };
    case "duplicate_item":
      return { code, itemId: id };
    case "too_many_units":
      return { code, ref: id };
    case "invalid_photo":
    case "photo_count":
    case "photo_missing":
      return { code, ref: ref === undefined ? asRef(detail) : ref };
    case "not_found":
      return null; // needs the entity; built by mapInventoryDbError only
    case "insufficient_stock":
      return { code, itemId: id, conflictDate: null };
    case "item_not_lendable":
      return { code, itemId: id };
    case "reserved_stock":
    case "open_requests_exist": {
      const count = asCount(detail);
      return count === null ? null : { code, count };
    }
    case "unit_not_available": {
      const status = unitStatusSchema.safeParse(detail);
      return { code, unitId: id, unitStatus: status.success ? status.data : null };
    }
    case "too_early":
      return { code, startDate: asIsoDate(detail) };
    case "correction_conflict":
      return { code, unitCode: detail !== null && INV_CODE_PATTERN.test(detail) ? detail : null };
    case "too_many_open_requests":
      return { code, limit: asCount(detail) ?? INVENTORY_LIMITS.openRequestsPerMember };
    case "daily_request_limit":
      return { code, limit: asCount(detail) ?? INVENTORY_LIMITS.requestsPerDay };
  }
}

type PostgrestLikeError = { code?: string; hint?: string | null; details?: string | null };

const DATE_CODES: ReadonlySet<InventoryErrorCode> = new Set(["invalid_dates", "start_in_past", "date_range_too_long"]);

/**
 * Maps a database error to the contract's error union, ONLY through INVENTORY_DB_HINTS. An unknown
 * hint, a missing hint, an unexpected SQLSTATE (network, `nexus` not exposed, missing grant, 5xx) or a
 * hint that needs a detail it does not carry is `unavailable`: fail closed, never read as "no access"
 * and never as "no rows".
 */
export function mapInventoryDbError(error: PostgrestLikeError, ctx: InventoryErrorContext = {}): InventoryError {
  const code = lookup(INVENTORY_DB_HINTS, error.hint);
  if (code === undefined || code === "unavailable") return UNAVAILABLE;
  if (typeof error.code !== "string" || !KNOWN_SQLSTATES.has(error.code)) return UNAVAILABLE;
  const detail = typeof error.details === "string" && error.details !== "" ? error.details : null;

  if (code === "not_found") {
    const entity = lookup(NOT_FOUND_ENTITY, error.hint);
    if (entity === undefined) return UNAVAILABLE;
    const ref = asUuid(detail);
    return ref ? { code, entity, ref } : { code, entity };
  }

  const field =
    (error.hint === "invalid_view" ? ctx.viewField ?? "view" : undefined) ??
    lookup(HINT_FIELDS, error.hint) ??
    lookup(DETAIL_FIELDS, detail) ??
    (DATE_CODES.has(code) ? ctx.dateField : undefined) ??
    ctx.field ??
    "request";
  return buildInventoryError(code, field, detail) ?? UNAVAILABLE;
}

// =============================================================================================
// RPC call
// =============================================================================================

type InventoryRpc =
  | "inventory_item_list"
  | "inventory_item_detail"
  | "inventory_item_availability"
  | "inventory_availability_bulk"
  | "inventory_category_list"
  | "inventory_location_list"
  | "inventory_item_history_list"
  | "inventory_status_counts"
  | "inventory_category_add"
  | "inventory_category_rename"
  | "inventory_category_set_active"
  | "inventory_location_add"
  | "inventory_location_rename"
  | "inventory_location_set_active"
  | "inventory_item_create"
  | "inventory_item_update"
  | "inventory_unit_add"
  | "inventory_unit_update"
  | "inventory_stock_add"
  | "inventory_stock_move"
  | "inventory_stock_write_off"
  | "inventory_unit_set_condition"
  | "inventory_unit_write_off"
  | "inventory_item_set_active"
  | "inventory_unit_set_active"
  | "inventory_unit_restore_lost"
  | "inventory_export"
  | "borrowing_my_requests"
  | "borrowing_queue"
  | "borrowing_queue_counts"
  | "borrowing_open_loans"
  | "borrowing_period_list"
  | "borrowing_request_detail"
  | "borrowing_request_detail_by_ref"
  | "borrowing_handover_units"
  | "borrowing_request_create"
  | "borrowing_request_approve"
  | "borrowing_request_reject"
  | "borrowing_request_cancel"
  | "borrowing_request_extend"
  | "borrowing_request_hand_over"
  | "borrowing_request_return"
  | "borrowing_request_correct_return"
  | "borrowing_export";

type Failure = { ok: false; error: InventoryError };

/** Calls one nexus RPC with the USER's client and validates the answer. Never throws. */
async function callRpc<T>(
  supabase: SupabaseClient,
  fn: InventoryRpc,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
  ctx?: InventoryErrorContext,
): Promise<InventoryResult<T>> {
  try {
    const { data, error } = await supabase.schema("nexus").rpc(fn, args);
    if (error) {
      const mapped = mapInventoryDbError(error, ctx);
      // Expected refusals are not logged as failures; everything else is, with the code only.
      if (mapped.code === "unavailable") logFailure(fn, `${error.code || "rpc_error"}/${error.hint || "-"}`);
      return { ok: false, error: mapped };
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) return fail(fn, "unexpected_shape");
    return { ok: true, data: parsed.data };
  } catch {
    return fail(fn, "exception");
  }
}

function fail(fn: string, reason: string): Failure {
  logFailure(fn, reason);
  return { ok: false, error: UNAVAILABLE };
}

function logFailure(fn: string, reason: string): void {
  // Function name and code only: never tokens, member ids, names, search text, paths or row data.
  console.error(`[picore] nexus.${fn}() failed: ${reason}`);
}

/** Exactly one row from a set-returning write function (anything else is a bug: fail closed). */
function oneRow<T>(schema: z.ZodType<T>) {
  return z.array(schema).length(1).transform((rows) => rows[0]);
}

/** `returns void`: PostgREST answers null or an empty body; only success matters. */
const voidResult = z.any().transform(() => null);

// =============================================================================================
// Row shapes (snake_case as returned; only these fields are read)
// =============================================================================================

const uuid = z.guid(); // Postgres uuid text form; also accepts seeded non-RFC ids (as context.ts).
const count = z.number().int().nonnegative();
const int = z.number().int();
const isoDate = z.string().regex(ISO_DATE_PATTERN);
const timestamp = z.string().min(1);
const text = z.string();
const optText = z.string().nullable();

const pageColumns = { total_count: count, page: z.number().int().positive(), page_size: z.number().int().positive() };

const unitJson = z.object({
  unit_id: uuid,
  code: text,
  condition: itemConditionSchema,
  status: unitStatusSchema,
  location_id: uuid.nullable(),
  location_name: optText,
});

function toUnit(u: z.infer<typeof unitJson>): CatalogUnit {
  return {
    unitId: u.unit_id,
    code: u.code,
    condition: u.condition,
    status: u.status,
    locationId: u.location_id,
    locationName: u.location_name,
  };
}

const catalogRow = z.object({
  row_no: z.number().int().positive(),
  item_id: uuid,
  code: optText,
  name: text,
  mode: itemModeSchema,
  category_id: uuid.nullable(),
  category_name: optText,
  location_id: uuid.nullable(),
  location_name: optText,
  location_count: count,
  is_active: z.boolean(),
  unit_count: count,
  qty_good: count,
  qty_needs_service: count,
  qty_damaged: count,
  qty_total: count,
  lendable_qty: count,
  free_qty: count.nullable(),
  units: z.array(unitJson).nullable(),
  ...pageColumns,
});

const itemDetailJson = z.object({
  item_id: uuid,
  code: optText,
  name: text,
  mode: itemModeSchema,
  description: optText,
  category_id: uuid.nullable(),
  category_name: optText,
  location_id: uuid.nullable(),
  location_name: optText,
  location_count: count,
  is_active: z.boolean(),
  unit_count: count,
  stock: z.object({ good: count, needs_service: count, damaged: count, total: count }),
  lendable_qty: count,
  units: z.array(unitJson),
});

const availabilityRow = z.object({ item_id: uuid, lendable_qty: count, free_qty: count, held_qty: int });

const listEntryRow = z.object({ id: uuid, name: text, is_active: z.boolean(), item_count: count });

const historyRow = z.object({
  history_id: z.number().int(),
  occurred_at: timestamp,
  kind: itemHistoryKindSchema,
  unit_id: uuid.nullable(),
  unit_code: optText,
  condition_from: itemConditionSchema.nullable(),
  condition_to: itemConditionSchema.nullable(),
  quantity: int.nullable(),
  note: optText,
  request_id: uuid.nullable(),
  request_reference: optText,
  details: z.record(z.string(), z.unknown()).nullable(),
  actor_name: optText,
  ...pageColumns,
});

const statusCountsRow = z.object({
  good_count: count,
  good_on_loan_count: count,
  needs_service_count: count,
  item_count: count,
});

const itemSummaryJson = z.object({
  item_id: uuid,
  name: text,
  code: optText,
  mode: itemModeSchema,
  quantity_requested: count,
  quantity_approved: count.nullable(),
  quantity_handed_over: count.nullable(),
  quantity_outstanding: count,
});

function toItemSummary(i: z.infer<typeof itemSummaryJson>): RequestItemSummary {
  return {
    itemId: i.item_id,
    name: i.name,
    code: i.code,
    mode: i.mode,
    quantityRequested: i.quantity_requested,
    quantityApproved: i.quantity_approved,
    quantityHandedOver: i.quantity_handed_over,
    quantityOutstanding: i.quantity_outstanding,
  };
}

/** Derived flags and outside-party columns shared by every request row. */
const flagColumns = {
  qty_outstanding: count,
  is_overdue: z.boolean(),
  overdue_days: count,
  is_not_picked_up: z.boolean(),
  is_partially_returned: z.boolean(),
  is_outside_party: z.boolean(),
  outside_org_name: optText,
  outside_contact_name: optText,
};

type FlagRow = {
  qty_outstanding: number;
  is_overdue: boolean;
  overdue_days: number;
  is_not_picked_up: boolean;
  is_partially_returned: boolean;
  is_outside_party: boolean;
  outside_org_name: string | null;
  outside_contact_name: string | null;
};

function toFlags(r: FlagRow) {
  return {
    qtyOutstanding: r.qty_outstanding,
    isOverdue: r.is_overdue,
    overdueDays: r.overdue_days,
    isNotPickedUp: r.is_not_picked_up,
    isPartiallyReturned: r.is_partially_returned,
    isOutsideParty: r.is_outside_party,
    outsideOrgName: r.outside_org_name,
    outsideContactName: r.outside_contact_name,
  };
}

const myRequestRow = z.object({
  row_no: z.number().int().positive(),
  request_id: uuid,
  reference: text,
  status: requestStatusSchema,
  version: z.number().int().positive(),
  period_label: optText,
  purpose: text,
  start_date: isoDate,
  end_date: isoDate,
  items: z.array(itemSummaryJson),
  has_issue: z.boolean(),
  extension_count: count,
  decided_by_name: optText,
  decision_note: optText,
  created_at: timestamp,
  ...flagColumns,
  ...pageColumns,
});

const queueRow = z.object({
  row_no: z.number().int().positive(),
  request_id: uuid,
  reference: text,
  status: requestStatusSchema,
  version: z.number().int().positive(),
  period_id: uuid,
  period_label: optText,
  requester_name: optText,
  is_own: z.boolean(),
  purpose: text,
  start_date: isoDate,
  end_date: isoDate,
  items: z.array(itemSummaryJson),
  has_issue: z.boolean(),
  extension_count: count,
  pending_overlap_count: count,
  created_at: timestamp,
  ...flagColumns,
  ...pageColumns,
});

const queueCountsRow = z.object({
  pending: count,
  ready: count,
  borrowed: count,
  overdue: count,
  open_all_periods: count,
  action_needed: count,
});

const openLoanRow = z.object({
  row_no: z.number().int().positive(),
  request_id: uuid,
  reference: text,
  status: requestStatusSchema,
  period_id: uuid,
  period_label: optText,
  requester_name: optText,
  is_own: z.boolean(),
  start_date: isoDate,
  end_date: isoDate,
  items: z.array(itemSummaryJson),
  ...flagColumns,
});

const periodRow = z.object({
  period_id: uuid,
  label: text,
  starts_on: isoDate.nullable(),
  ends_on: isoDate.nullable(),
  is_active: z.boolean(),
});

/** Unknown mime types become null (the record is still shown; the bucket allows only the three). */
const mimeType = z
  .string()
  .nullable()
  .transform((v): EvidenceMimeType | null => (EVIDENCE_MIME_TYPES as readonly string[]).includes(v ?? "") ? (v as EvidenceMimeType) : null);

const photoJson = z.object({
  photo_id: z.number().int(),
  storage_path: z.string().regex(EVIDENCE_PATH_PATTERN),
  mime_type: mimeType,
  size_bytes: int.nullable(),
});

const returnJson = z.object({
  return_id: z.number().int(),
  batch_id: z.number().int(),
  outcome: returnOutcomeSchema,
  quantity: count,
  unit_id: uuid.nullable(),
  unit_code: optText,
  resulting_condition: damagedConditionSchema.nullable(),
  note: optText,
  recorded_at: timestamp,
  recorded_by_name: optText,
  is_reversed: z.boolean(),
  photos: z.array(photoJson),
});

const lineJson = z.object({
  line_id: uuid,
  item_id: uuid,
  item_name: text,
  item_code: optText,
  mode: itemModeSchema,
  item_is_active: z.boolean(),
  quantity_requested: count,
  quantity_approved: count.nullable(),
  quantity_handed_over: count.nullable(),
  returned_good: count,
  returned_damaged: count,
  returned_lost: count,
  outstanding: count,
  handover_note: optText,
  available: z.object({ lendable: count, free: count }).nullable(),
  units: z.array(z.object({ unit_id: uuid, code: text, is_out: z.boolean() })),
  returns: z.array(returnJson),
});

const timelineJson = z.union([
  z.object({
    event: z.literal("extended"),
    at: timestamp,
    old_end_date: isoDate,
    new_end_date: isoDate,
    actor_name: optText,
    note: text,
  }),
  z.object({
    event: requestEventSchema,
    at: timestamp,
    from_status: requestStatusSchema.nullable(),
    to_status: requestStatusSchema,
    actor_name: optText,
    note: optText,
  }),
]);

const detailJson = z.object({
  request_id: uuid,
  reference: text,
  status: requestStatusSchema,
  version: z.number().int().positive(),
  period_id: uuid,
  period_label: optText,
  requester_name: optText,
  is_own: z.boolean(),
  purpose: text,
  note: optText,
  start_date: isoDate,
  end_date: isoDate,
  created_at: timestamp,
  decided_at: timestamp.nullable(),
  decided_by_name: optText,
  decision_note: optText,
  handed_over_at: timestamp.nullable(),
  handed_over_by_name: optText,
  returned_at: timestamp.nullable(),
  has_issue: z.boolean(),
  extension_count: count,
  pending_overlap_count: count.nullable(),
  other_approver_count: count.nullable(),
  lines: z.array(lineJson),
  timeline: z.array(timelineJson),
  actions: z.object({
    can_approve: z.boolean(),
    can_reject: z.boolean(),
    can_extend: z.boolean(),
    can_hand_over: z.boolean(),
    can_return: z.boolean(),
    can_cancel: z.boolean(),
    cancel_reason_required: z.boolean(),
    can_correct_return: z.boolean(),
  }),
  ...flagColumns,
});

type DetailJson = z.infer<typeof detailJson>;

function toRequestDetail(d: DetailJson): RequestDetail {
  return {
    ...toFlags(d),
    requestId: d.request_id,
    reference: d.reference,
    status: d.status,
    version: d.version,
    periodId: d.period_id,
    periodLabel: d.period_label,
    requesterName: d.requester_name,
    isOwn: d.is_own,
    purpose: d.purpose,
    note: d.note,
    startDate: d.start_date,
    endDate: d.end_date,
    createdAt: d.created_at,
    decidedAt: d.decided_at,
    decidedByName: d.decided_by_name,
    decisionNote: d.decision_note,
    handedOverAt: d.handed_over_at,
    handedOverByName: d.handed_over_by_name,
    returnedAt: d.returned_at,
    hasIssue: d.has_issue,
    extensionCount: d.extension_count,
    pendingOverlapCount: d.pending_overlap_count,
    otherApproverCount: d.other_approver_count,
    lines: d.lines.map((l) => ({
      lineId: l.line_id,
      itemId: l.item_id,
      itemName: l.item_name,
      itemCode: l.item_code,
      mode: l.mode,
      itemIsActive: l.item_is_active,
      quantityRequested: l.quantity_requested,
      quantityApproved: l.quantity_approved,
      quantityHandedOver: l.quantity_handed_over,
      returnedGood: l.returned_good,
      returnedDamaged: l.returned_damaged,
      returnedLost: l.returned_lost,
      outstanding: l.outstanding,
      handoverNote: l.handover_note,
      available: l.available,
      units: l.units.map((u) => ({ unitId: u.unit_id, code: u.code, isOut: u.is_out })),
      returns: l.returns.map((r) => ({
        returnId: r.return_id,
        batchId: r.batch_id,
        outcome: r.outcome,
        quantity: r.quantity,
        unitId: r.unit_id,
        unitCode: r.unit_code,
        resultingCondition: r.resulting_condition,
        note: r.note,
        recordedAt: r.recorded_at,
        recordedByName: r.recorded_by_name,
        isReversed: r.is_reversed,
        // The storage path stays on the server (contract: EvidencePhoto has no path).
        photos: r.photos.map((p) => ({ photoId: p.photo_id, mimeType: p.mime_type, sizeBytes: p.size_bytes })),
      })),
    })),
    timeline: d.timeline.map((t) =>
      t.event === "extended"
        ? { event: "extended", at: t.at, oldEndDate: t.old_end_date, newEndDate: t.new_end_date, actorName: t.actor_name, note: t.note }
        : { event: t.event, at: t.at, fromStatus: t.from_status, toStatus: t.to_status, actorName: t.actor_name, note: t.note },
    ),
    actions: {
      canApprove: d.actions.can_approve,
      canReject: d.actions.can_reject,
      canExtend: d.actions.can_extend,
      canHandOver: d.actions.can_hand_over,
      canReturn: d.actions.can_return,
      canCancel: d.actions.can_cancel,
      cancelReasonRequired: d.actions.cancel_reason_required,
      canCorrectReturn: d.actions.can_correct_return,
    },
  };
}

const transitionRow = z.object({ request_id: uuid, status: requestStatusSchema, version: z.number().int().positive() });

function toTransition(r: z.infer<typeof transitionRow>): RequestTransitionResult {
  return { requestId: r.request_id, status: r.status, version: r.version };
}

const inventoryExportRow = z.object({
  row_no: z.number().int().positive(),
  item_id: uuid,
  code: optText,
  item_name: text,
  mode: itemModeSchema,
  category_name: optText,
  location_name: optText,
  unit_condition: itemConditionSchema.nullable(),
  unit_status: unitStatusSchema.nullable(),
  qty_good: count.nullable(),
  qty_needs_service: count.nullable(),
  qty_damaged: count.nullable(),
  qty_total: count.nullable(),
  item_is_active: z.boolean(),
  free_qty: count.nullable(),
  total_count: count, // migration 20261109100000: rows of the full filtered result, on every row
});

const borrowingExportRow = z.object({
  row_no: z.number().int().positive(),
  reference: text,
  status: requestStatusSchema,
  period_label: optText,
  requester_name: optText,
  is_outside_party: z.boolean(),
  outside_org_name: optText,
  outside_contact_name: optText,
  purpose: text,
  items: z.array(itemSummaryJson),
  units_handed_over: z.array(text),
  start_date: isoDate,
  end_date: isoDate,
  extension_count: count,
  decided_by_name: optText,
  decided_at: timestamp.nullable(),
  decision_note: optText,
  handed_over_at: timestamp.nullable(),
  returned_at: timestamp.nullable(),
  returned_good: count,
  returned_damaged: count,
  returned_lost: count,
  has_issue: z.boolean(),
  is_overdue: z.boolean(),
  overdue_days: count,
  is_not_picked_up: z.boolean(),
  is_partially_returned: z.boolean(),
  total_count: count, // migration 20261109100000
});

/**
 * nexus.borrowing_export() row, for the server-side file writer only (never sent to the UI). Same rows
 * and order as the Antrean with the same filters.
 */
export type BorrowingExportRow = {
  rowNo: number;
  reference: string;
  status: RequestStatus;
  periodLabel: string | null;
  /** Current PI-CORE name; for an outside party the Operations member who recorded it. */
  requesterName: string | null;
  isOutsideParty: boolean;
  outsideOrgName: string | null;
  outsideContactName: string | null;
  purpose: string;
  items: RequestItemSummary[];
  unitsHandedOver: string[];
  startDate: string;
  endDate: string;
  extensionCount: number;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  handedOverAt: string | null;
  returnedAt: string | null;
  returnedGood: number;
  returnedDamaged: number;
  returnedLost: number;
  hasIssue: boolean;
  isOverdue: boolean;
  overdueDays: number;
  isNotPickedUp: boolean;
  isPartiallyReturned: boolean;
};

// =============================================================================================
// Paging helper
// =============================================================================================

type PageColumns = { total_count: number; page: number; page_size: number };

/**
 * total/page/page_size repeat on every row; they must agree with each other and with the request, and
 * the page must fit (fail closed). 0 rows = nothing matches: page 1 of 1.
 */
function toPaged<R extends PageColumns, T>(
  fn: InventoryRpc,
  rows: R[],
  pageSize: number,
  map: (row: R) => T,
): InventoryResult<Paged<T>> {
  if (rows.length === 0) return { ok: true, data: { rows: [], total: 0, page: 1, pageSize, pageCount: 1 } };
  const { total_count: total, page, page_size: size } = rows[0];
  const consistent = rows.every((r) => r.total_count === total && r.page === page && r.page_size === size);
  if (!consistent || size !== pageSize || rows.length > size) return fail(fn, "inconsistent_page");
  return { ok: true, data: { rows: rows.map(map), total, page, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)) } };
}

// =============================================================================================
// Catalog reads
// =============================================================================================

/** nexus.inventory_item_list(). */
export async function readCatalog(
  supabase: SupabaseClient,
  filters: CatalogFilters,
  page: number,
  pageSize: number,
): Promise<InventoryResult<CatalogPage>> {
  const result = await callRpc(
    supabase,
    "inventory_item_list",
    z.array(catalogRow),
    {
      p_search: filters.search,
      p_category_id: filters.categoryId,
      p_location_id: filters.locationId,
      p_condition: filters.condition,
      p_status: filters.status,
      p_available_from: filters.availableFrom,
      p_available_to: filters.availableTo,
      p_page: page,
      p_page_size: pageSize,
    },
    { dateField: "availableTo" },
  );
  if (!result.ok) return result;
  const paged = toPaged("inventory_item_list", result.data, pageSize, (r) => ({
    rowNo: r.row_no,
    itemId: r.item_id,
    code: r.code,
    name: r.name,
    mode: r.mode,
    categoryId: r.category_id,
    categoryName: r.category_name,
    locationId: r.location_id,
    locationName: r.location_name,
    locationCount: r.location_count,
    isActive: r.is_active,
    unitCount: r.unit_count,
    qtyGood: r.qty_good,
    qtyNeedsService: r.qty_needs_service,
    qtyDamaged: r.qty_damaged,
    qtyTotal: r.qty_total,
    lendableQty: r.lendable_qty,
    freeQty: r.free_qty,
    units: r.units === null ? null : r.units.map(toUnit),
  }));
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filters } };
}

/** nexus.inventory_item_detail(). */
export async function readItemDetail(supabase: SupabaseClient, itemId: string): Promise<InventoryResult<ItemDetail>> {
  const result = await callRpc(supabase, "inventory_item_detail", itemDetailJson, { p_item_id: itemId }, { field: "itemId" });
  if (!result.ok) return result;
  const d = result.data;
  return {
    ok: true,
    data: {
      itemId: d.item_id,
      code: d.code,
      name: d.name,
      mode: d.mode,
      description: d.description,
      categoryId: d.category_id,
      categoryName: d.category_name,
      locationId: d.location_id,
      locationName: d.location_name,
      locationCount: d.location_count,
      isActive: d.is_active,
      unitCount: d.unit_count,
      stock: { good: d.stock.good, needsService: d.stock.needs_service, damaged: d.stock.damaged, total: d.stock.total },
      lendableQty: d.lendable_qty,
      units: d.units.map(toUnit),
    },
  };
}

function toAvailability(r: z.infer<typeof availabilityRow>): ItemAvailability {
  return { itemId: r.item_id, lendableQty: r.lendable_qty, freeQty: r.free_qty, heldQty: r.held_qty };
}

/** nexus.inventory_item_availability(): one row for a visible item. */
export async function readItemAvailability(
  supabase: SupabaseClient,
  itemId: string,
  from: string,
  to: string,
): Promise<InventoryResult<ItemAvailability>> {
  const result = await callRpc(
    supabase,
    "inventory_item_availability",
    oneRow(availabilityRow),
    { p_item_id: itemId, p_from: from, p_to: to },
    { field: "itemId", dateField: "to" },
  );
  return result.ok ? { ok: true, data: toAvailability(result.data) } : result;
}

/** nexus.inventory_availability_bulk(): unknown and archived ids are left out. */
export async function readAvailabilityBulk(
  supabase: SupabaseClient,
  itemIds: string[],
  from: string,
  to: string,
): Promise<InventoryResult<ItemAvailability[]>> {
  const result = await callRpc(
    supabase,
    "inventory_availability_bulk",
    z.array(availabilityRow),
    { p_item_ids: itemIds, p_from: from, p_to: to },
    { field: "itemIds", dateField: "to" },
  );
  return result.ok ? { ok: true, data: result.data.map(toAvailability) } : result;
}

/** nexus.inventory_category_list() / inventory_location_list(), A-Z. */
export async function readListEntries(
  supabase: SupabaseClient,
  kind: InventoryListKind,
  includeInactive: boolean,
): Promise<InventoryResult<ListEntry[]>> {
  const fn = kind === "category" ? "inventory_category_list" : "inventory_location_list";
  const result = await callRpc(supabase, fn, z.array(listEntryRow), { p_include_inactive: includeInactive });
  if (!result.ok) return result;
  return { ok: true, data: result.data.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, itemCount: r.item_count })) };
}

/** nexus.inventory_item_history_list(), newest first. The actor's member id is not read. */
export async function readItemHistory(
  supabase: SupabaseClient,
  itemId: string,
  page: number,
  pageSize: number,
): Promise<InventoryResult<ItemHistoryPage>> {
  const result = await callRpc(
    supabase,
    "inventory_item_history_list",
    z.array(historyRow),
    { p_item_id: itemId, p_page: page, p_page_size: pageSize },
    { field: "itemId" },
  );
  if (!result.ok) return result;
  return toPaged("inventory_item_history_list", result.data, pageSize, (r) => ({
    historyId: r.history_id,
    occurredAt: r.occurred_at,
    kind: r.kind,
    unitId: r.unit_id,
    unitCode: r.unit_code,
    conditionFrom: r.condition_from,
    conditionTo: r.condition_to,
    quantity: r.quantity,
    note: r.note,
    requestId: r.request_id,
    requestReference: r.request_reference,
    details: r.details,
    actorName: r.actor_name,
  }));
}

/** nexus.inventory_status_counts(): Dashboard card. */
export async function readInventoryStatusCounts(supabase: SupabaseClient): Promise<InventoryResult<InventoryStatusCounts>> {
  const result = await callRpc(supabase, "inventory_status_counts", oneRow(statusCountsRow));
  if (!result.ok) return result;
  const r = result.data;
  return {
    ok: true,
    data: {
      goodCount: r.good_count,
      goodOnLoanCount: r.good_on_loan_count,
      needsServiceCount: r.needs_service_count,
      itemCount: r.item_count,
    },
  };
}

// =============================================================================================
// Inventory writes (inventory.manage)
// =============================================================================================

type NewUnit = { condition: string; locationId: string | null };
const unitsJson = (units: NewUnit[]) => units.map((u) => ({ condition: u.condition, location_id: u.locationId }));

export type ItemCreateArgs =
  | {
      mode: "quantity";
      name: string;
      description: string | null;
      categoryId: string | null;
      note: string | null;
      locationId: string | null;
      stock: { good: number; needsService: number; damaged: number };
    }
  | {
      mode: "tracked";
      name: string;
      description: string | null;
      categoryId: string | null;
      note: string | null;
      units: NewUnit[];
    };

/** nexus.inventory_item_create(). */
export async function createInventoryItem(supabase: SupabaseClient, input: ItemCreateArgs): Promise<InventoryResult<ItemCreateResult>> {
  const shape = z.object({ item_id: uuid, item_code: optText, unit_codes: z.array(text).nullable() });
  const result = await callRpc(
    supabase,
    "inventory_item_create",
    oneRow(shape),
    {
      p_mode: input.mode,
      p_name: input.name,
      p_description: input.description,
      p_category_id: input.categoryId,
      p_location_id: input.mode === "quantity" ? input.locationId : null,
      p_stock:
        input.mode === "quantity"
          ? { good: input.stock.good, needs_service: input.stock.needsService, damaged: input.stock.damaged }
          : null,
      p_units: input.mode === "tracked" ? unitsJson(input.units) : null,
      p_note: input.note,
    },
    { field: input.mode === "tracked" ? "units" : "stock" },
  );
  if (!result.ok) return result;
  return { ok: true, data: { itemId: result.data.item_id, itemCode: result.data.item_code, unitCodes: result.data.unit_codes ?? [] } };
}

/** nexus.inventory_item_update(): false = nothing changed. */
export async function updateInventoryItem(
  supabase: SupabaseClient,
  input: { itemId: string; name: string; description: string | null; categoryId: string | null; locationId: string | null; note: string | null },
): Promise<InventoryResult<ChangeResult>> {
  const result = await callRpc(supabase, "inventory_item_update", z.boolean(), {
    p_item_id: input.itemId,
    p_name: input.name,
    p_description: input.description,
    p_category_id: input.categoryId,
    p_location_id: input.locationId,
    p_note: input.note,
  });
  return result.ok ? { ok: true, data: { changed: result.data } } : result;
}

/** nexus.inventory_unit_add(): codes of the new units. */
export async function addInventoryUnits(
  supabase: SupabaseClient,
  input: { itemId: string; units: NewUnit[]; note: string | null },
): Promise<InventoryResult<UnitAddResult>> {
  const result = await callRpc(
    supabase,
    "inventory_unit_add",
    z.array(text),
    { p_item_id: input.itemId, p_units: unitsJson(input.units), p_note: input.note },
    { field: "units" },
  );
  return result.ok ? { ok: true, data: { unitCodes: result.data } } : result;
}

/** nexus.inventory_unit_update(): move a unit. */
export async function moveInventoryUnit(
  supabase: SupabaseClient,
  input: { unitId: string; locationId: string | null; note: string | null },
): Promise<InventoryResult<ChangeResult>> {
  const result = await callRpc(
    supabase,
    "inventory_unit_update",
    z.boolean(),
    { p_unit_id: input.unitId, p_location_id: input.locationId, p_note: input.note },
    { field: "locationId" },
  );
  return result.ok ? { ok: true, data: { changed: result.data } } : result;
}

/** nexus.inventory_stock_add(): the new quantity in that condition. */
export async function addInventoryStock(
  supabase: SupabaseClient,
  input: { itemId: string; condition: string; quantity: number; note: string },
): Promise<InventoryResult<StockAddResult>> {
  const result = await callRpc(supabase, "inventory_stock_add", count, {
    p_item_id: input.itemId,
    p_condition: input.condition,
    p_quantity: input.quantity,
    p_note: input.note,
  });
  return result.ok ? { ok: true, data: { quantity: result.data } } : result;
}

/** nexus.inventory_stock_move(). */
export async function moveInventoryStock(
  supabase: SupabaseClient,
  input: { itemId: string; from: string; to: string; quantity: number; note: string },
): Promise<InventoryResult<null>> {
  return callRpc(supabase, "inventory_stock_move", voidResult, {
    p_item_id: input.itemId,
    p_from: input.from,
    p_to: input.to,
    p_quantity: input.quantity,
    p_note: input.note,
  });
}

/** nexus.inventory_stock_write_off(). */
export async function writeOffInventoryStock(
  supabase: SupabaseClient,
  input: { itemId: string; condition: string; quantity: number; note: string },
): Promise<InventoryResult<null>> {
  return callRpc(supabase, "inventory_stock_write_off", voidResult, {
    p_item_id: input.itemId,
    p_condition: input.condition,
    p_quantity: input.quantity,
    p_note: input.note,
  });
}

/** nexus.inventory_unit_set_condition(). */
export async function setInventoryUnitCondition(
  supabase: SupabaseClient,
  input: { unitId: string; condition: string; note: string },
): Promise<InventoryResult<null>> {
  return callRpc(supabase, "inventory_unit_set_condition", voidResult, {
    p_unit_id: input.unitId,
    p_condition: input.condition,
    p_note: input.note,
  });
}

/** nexus.inventory_unit_write_off(). */
export async function writeOffInventoryUnit(supabase: SupabaseClient, input: { unitId: string; note: string }): Promise<InventoryResult<null>> {
  return callRpc(supabase, "inventory_unit_write_off", voidResult, { p_unit_id: input.unitId, p_note: input.note });
}

/** nexus.inventory_unit_restore_lost(). */
export async function restoreLostInventoryUnit(
  supabase: SupabaseClient,
  input: { unitId: string; condition: string; note: string },
): Promise<InventoryResult<null>> {
  return callRpc(supabase, "inventory_unit_restore_lost", voidResult, {
    p_unit_id: input.unitId,
    p_condition: input.condition,
    p_note: input.note,
  });
}

/** nexus.inventory_item_set_active(): false = already in that state. */
export async function setInventoryItemActive(
  supabase: SupabaseClient,
  input: { itemId: string; isActive: boolean; note: string | null },
): Promise<InventoryResult<ChangeResult>> {
  const result = await callRpc(supabase, "inventory_item_set_active", z.boolean(), {
    p_item_id: input.itemId,
    p_is_active: input.isActive,
    p_note: input.note,
  });
  return result.ok ? { ok: true, data: { changed: result.data } } : result;
}

/** nexus.inventory_unit_set_active(): false = already in that state. */
export async function setInventoryUnitActive(
  supabase: SupabaseClient,
  input: { unitId: string; isActive: boolean; note: string | null },
): Promise<InventoryResult<ChangeResult>> {
  const result = await callRpc(supabase, "inventory_unit_set_active", z.boolean(), {
    p_unit_id: input.unitId,
    p_is_active: input.isActive,
    p_note: input.note,
  });
  return result.ok ? { ok: true, data: { changed: result.data } } : result;
}

/** nexus.inventory_category_add / inventory_location_add. */
export async function addInventoryListEntry(
  supabase: SupabaseClient,
  kind: InventoryListKind,
  name: string,
): Promise<InventoryResult<ListEntryResult>> {
  const fn = kind === "category" ? "inventory_category_add" : "inventory_location_add";
  const result = await callRpc(supabase, fn, uuid, { p_name: name }, { field: "name" });
  return result.ok ? { ok: true, data: { id: result.data } } : result;
}

/** nexus.inventory_category_rename / inventory_location_rename. */
export async function renameInventoryListEntry(
  supabase: SupabaseClient,
  kind: InventoryListKind,
  id: string,
  name: string,
): Promise<InventoryResult<ListEntryResult>> {
  const result =
    kind === "category"
      ? await callRpc(supabase, "inventory_category_rename", uuid, { p_category_id: id, p_name: name }, { field: "name" })
      : await callRpc(supabase, "inventory_location_rename", uuid, { p_location_id: id, p_name: name }, { field: "name" });
  return result.ok ? { ok: true, data: { id: result.data } } : result;
}

/** nexus.inventory_category_set_active / inventory_location_set_active. */
export async function setInventoryListEntryActive(
  supabase: SupabaseClient,
  kind: InventoryListKind,
  id: string,
  isActive: boolean,
): Promise<InventoryResult<ListEntryResult>> {
  const result =
    kind === "category"
      ? await callRpc(supabase, "inventory_category_set_active", uuid, { p_category_id: id, p_is_active: isActive })
      : await callRpc(supabase, "inventory_location_set_active", uuid, { p_location_id: id, p_is_active: isActive });
  return result.ok ? { ok: true, data: { id: result.data } } : result;
}

// =============================================================================================
// Borrowing reads
// =============================================================================================

/** nexus.borrowing_my_requests(): the caller's own requests (L9). */
export async function readMyRequests(
  supabase: SupabaseClient,
  filter: MyRequestsFilter,
  page: number,
  pageSize: number,
): Promise<InventoryResult<MyRequestsPage>> {
  const result = await callRpc(
    supabase,
    "borrowing_my_requests",
    z.array(myRequestRow),
    { p_filter: filter, p_page: page, p_page_size: pageSize },
    { viewField: "filter" },
  );
  if (!result.ok) return result;
  const paged = toPaged("borrowing_my_requests", result.data, pageSize, (r) => ({
    ...toFlags(r),
    rowNo: r.row_no,
    requestId: r.request_id,
    reference: r.reference,
    status: r.status,
    version: r.version,
    periodLabel: r.period_label,
    purpose: r.purpose,
    startDate: r.start_date,
    endDate: r.end_date,
    items: r.items.map(toItemSummary),
    hasIssue: r.has_issue,
    extensionCount: r.extension_count,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  }));
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filter } };
}

/** nexus.borrowing_queue() (borrowing.view_all). The requester's member id is not read; isOwn is. */
export async function readQueue(
  supabase: SupabaseClient,
  filters: QueueFilters,
  page: number,
  pageSize: number,
): Promise<InventoryResult<QueuePage>> {
  const result = await callRpc(
    supabase,
    "borrowing_queue",
    z.array(queueRow),
    {
      p_view: filters.view,
      p_search: filters.search,
      p_from: filters.from,
      p_to: filters.to,
      p_item_id: filters.itemId,
      p_period_id: filters.periodId,
      p_page: page,
      p_page_size: pageSize,
    },
    { dateField: "to", viewField: "view" },
  );
  if (!result.ok) return result;
  const paged = toPaged("borrowing_queue", result.data, pageSize, (r) => ({
    ...toFlags(r),
    rowNo: r.row_no,
    requestId: r.request_id,
    reference: r.reference,
    status: r.status,
    version: r.version,
    periodId: r.period_id,
    periodLabel: r.period_label,
    requesterName: r.requester_name,
    isOwn: r.is_own,
    purpose: r.purpose,
    startDate: r.start_date,
    endDate: r.end_date,
    items: r.items.map(toItemSummary),
    hasIssue: r.has_issue,
    extensionCount: r.extension_count,
    pendingOverlapCount: r.pending_overlap_count,
    createdAt: r.created_at,
  }));
  if (!paged.ok) return paged;
  return { ok: true, data: { ...paged.data, filters } };
}

/** nexus.borrowing_queue_counts(). */
export async function readQueueCounts(supabase: SupabaseClient): Promise<InventoryResult<QueueCounts>> {
  const result = await callRpc(supabase, "borrowing_queue_counts", oneRow(queueCountsRow));
  if (!result.ok) return result;
  const r = result.data;
  return {
    ok: true,
    data: {
      pending: r.pending,
      ready: r.ready,
      borrowed: r.borrowed,
      overdue: r.overdue,
      openAllPeriods: r.open_all_periods,
      actionNeeded: r.action_needed,
    },
  };
}

/** nexus.borrowing_open_loans(): every unfinished request of every period. */
export async function readOpenLoans(supabase: SupabaseClient): Promise<InventoryResult<OpenLoanRow[]>> {
  const result = await callRpc(supabase, "borrowing_open_loans", z.array(openLoanRow));
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((r) => ({
      ...toFlags(r),
      rowNo: r.row_no,
      requestId: r.request_id,
      reference: r.reference,
      status: r.status,
      periodId: r.period_id,
      periodLabel: r.period_label,
      requesterName: r.requester_name,
      isOwn: r.is_own,
      startDate: r.start_date,
      endDate: r.end_date,
      items: r.items.map(toItemSummary),
    })),
  };
}

/** nexus.borrowing_period_list(): PI-CORE periods, newest first (borrowing.view_all). */
export async function readBorrowingPeriods(supabase: SupabaseClient): Promise<InventoryResult<BorrowingPeriod[]>> {
  const result = await callRpc(supabase, "borrowing_period_list", z.array(periodRow));
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((r) => ({ periodId: r.period_id, label: r.label, startsOn: r.starts_on, endsOn: r.ends_on, isActive: r.is_active })),
  };
}

/** nexus.borrowing_request_detail(): own request or borrowing.view_all; else not_found "request". */
export async function readRequestDetail(supabase: SupabaseClient, requestId: string): Promise<InventoryResult<RequestDetail>> {
  const result = await callRpc(supabase, "borrowing_request_detail", detailJson, { p_request_id: requestId }, { field: "requestId" });
  return result.ok ? { ok: true, data: toRequestDetail(result.data) } : result;
}

/** nexus.borrowing_request_detail_by_ref(): same JSON and visibility, found by "PJM-0001". */
export async function readRequestDetailByReference(
  supabase: SupabaseClient,
  reference: string,
): Promise<InventoryResult<RequestDetail>> {
  const result = await callRpc(
    supabase,
    "borrowing_request_detail_by_ref",
    detailJson,
    { p_reference: reference },
    { field: "reference" },
  );
  return result.ok ? { ok: true, data: toRequestDetail(result.data) } : result;
}

/** nexus.borrowing_handover_units() (borrowing.handle). */
export async function readHandoverUnits(supabase: SupabaseClient, requestId: string): Promise<InventoryResult<HandoverUnit[]>> {
  const row = z.object({ line_id: uuid, item_id: uuid, unit_id: uuid, code: text, location_id: uuid.nullable(), location_name: optText });
  const result = await callRpc(supabase, "borrowing_handover_units", z.array(row), { p_request_id: requestId }, { field: "requestId" });
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((r) => ({
      lineId: r.line_id,
      itemId: r.item_id,
      unitId: r.unit_id,
      code: r.code,
      locationId: r.location_id,
      locationName: r.location_name,
    })),
  };
}

// =============================================================================================
// Borrowing writes (state machine). Each returns the new status and version.
// =============================================================================================

/** nexus.borrowing_request_create(). The requester is the session member (never an input). */
export async function createBorrowingRequest(
  supabase: SupabaseClient,
  input: {
    startDate: string;
    endDate: string;
    purpose: string;
    note: string | null;
    lines: { itemId: string; quantity: number }[];
    outsideParty: { orgName: string; contactName: string } | null;
  },
): Promise<InventoryResult<RequestCreateResult>> {
  const shape = z.object({ request_id: uuid, reference: text, status: requestStatusSchema, version: z.number().int().positive() });
  const result = await callRpc(
    supabase,
    "borrowing_request_create",
    oneRow(shape),
    {
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_purpose: input.purpose,
      p_lines: input.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
      p_note: input.note,
      p_outside_org_name: input.outsideParty?.orgName ?? null,
      p_outside_contact_name: input.outsideParty?.contactName ?? null,
    },
    { field: "lines", dateField: "endDate" },
  );
  if (!result.ok) return result;
  const r = result.data;
  return { ok: true, data: { requestId: r.request_id, reference: r.reference, status: r.status, version: r.version } };
}

async function transition(
  supabase: SupabaseClient,
  fn: InventoryRpc,
  args: Record<string, unknown>,
  ctx: InventoryErrorContext,
): Promise<InventoryResult<RequestTransitionResult>> {
  const result = await callRpc(supabase, fn, oneRow(transitionRow), args, ctx);
  return result.ok ? { ok: true, data: toTransition(result.data) } : result;
}

/** nexus.borrowing_request_approve(). Lines not listed are approved in full. */
export function approveBorrowingRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; note: string | null; lines: { lineId: string; quantity: number }[] },
): Promise<InventoryResult<RequestTransitionResult>> {
  return transition(
    supabase,
    "borrowing_request_approve",
    {
      p_request_id: input.requestId,
      p_version: input.version,
      p_note: input.note,
      p_lines: input.lines.length === 0 ? null : input.lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity })),
    },
    { field: "lines" },
  );
}

/** nexus.borrowing_request_reject(). */
export function rejectBorrowingRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; note: string },
): Promise<InventoryResult<RequestTransitionResult>> {
  return transition(
    supabase,
    "borrowing_request_reject",
    { p_request_id: input.requestId, p_version: input.version, p_note: input.note },
    { field: "note" },
  );
}

/** nexus.borrowing_request_cancel(). */
export function cancelBorrowingRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; reason: string | null },
): Promise<InventoryResult<RequestTransitionResult>> {
  return transition(
    supabase,
    "borrowing_request_cancel",
    { p_request_id: input.requestId, p_version: input.version, p_reason: input.reason },
    { field: "reason" },
  );
}

/** nexus.borrowing_request_extend(). insufficient_stock comes back with conflictDate null (the action fills it). */
export function extendBorrowingRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; newEndDate: string; note: string },
): Promise<InventoryResult<RequestTransitionResult>> {
  return transition(
    supabase,
    "borrowing_request_extend",
    { p_request_id: input.requestId, p_version: input.version, p_new_end_date: input.newEndDate, p_note: input.note },
    { field: "newEndDate", dateField: "newEndDate" },
  );
}

export type HandOverLineArgs =
  | { lineId: string; quantity: number; note: string | null }
  | { lineId: string; unitIds: string[]; note: string | null };

/** nexus.borrowing_request_hand_over(). A quantity line sends `quantity`, a tracked line `unit_ids` (never both). */
export function handOverBorrowingRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; note: string | null; lines: HandOverLineArgs[] },
): Promise<InventoryResult<RequestTransitionResult>> {
  return transition(
    supabase,
    "borrowing_request_hand_over",
    {
      p_request_id: input.requestId,
      p_version: input.version,
      p_note: input.note,
      p_lines: input.lines.map((l) =>
        "unitIds" in l
          ? { line_id: l.lineId, unit_ids: l.unitIds, note: l.note }
          : { line_id: l.lineId, quantity: l.quantity, note: l.note },
      ),
    },
    { field: "lines" },
  );
}

export type ReturnOutcomeArgs = {
  lineId: string;
  outcome: "good" | "damaged" | "lost";
  quantity?: number;
  unitId?: string;
  resultingCondition?: "needs_service" | "damaged";
  note: string | null;
  photos?: string[];
};

/**
 * nexus.borrowing_request_return(). Keys are sent only when they apply: the database refuses
 * resulting_condition on good/lost and unit_id on quantity items even when null.
 */
export function returnBorrowingRequest(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; outcomes: ReturnOutcomeArgs[] },
): Promise<InventoryResult<RequestTransitionResult>> {
  const outcomes = input.outcomes.map((o) => ({
    line_id: o.lineId,
    outcome: o.outcome,
    ...(o.quantity !== undefined ? { quantity: o.quantity } : {}),
    ...(o.unitId !== undefined ? { unit_id: o.unitId } : {}),
    ...(o.outcome === "damaged" && o.resultingCondition !== undefined ? { resulting_condition: o.resultingCondition } : {}),
    note: o.note,
    ...(o.outcome !== "good" && o.photos !== undefined ? { photos: o.photos } : {}),
  }));
  return transition(
    supabase,
    "borrowing_request_return",
    { p_request_id: input.requestId, p_version: input.version, p_outcomes: outcomes },
    { field: "outcomes" },
  );
}

/** nexus.borrowing_request_correct_return(). */
export function correctBorrowingReturn(
  supabase: SupabaseClient,
  input: { requestId: string; version: number; reason: string },
): Promise<InventoryResult<RequestTransitionResult>> {
  return transition(
    supabase,
    "borrowing_request_correct_return",
    { p_request_id: input.requestId, p_version: input.version, p_reason: input.reason },
    { field: "reason" },
  );
}

// =============================================================================================
// Exports (each call writes ONE export-log row in the same transaction; no row, no data)
// =============================================================================================

/**
 * nexus.inventory_export(): every matching row (one per quantity item, one per unit of a tracked item).
 * VOLATILE: supabase-js sends it as POST. Call it exactly once per export.
 */
export async function exportInventoryRows(
  supabase: SupabaseClient,
  format: InventoryExportFormat,
  filters: CatalogFilters,
): Promise<InventoryResult<CountedRows<InventoryExportRow>>> {
  const result = await callRpc(
    supabase,
    "inventory_export",
    z.array(inventoryExportRow),
    {
      p_format: format,
      p_search: filters.search,
      p_category_id: filters.categoryId,
      p_location_id: filters.locationId,
      p_condition: filters.condition,
      p_status: filters.status,
      p_available_from: filters.availableFrom,
      p_available_to: filters.availableTo,
    },
    { dateField: "availableTo" },
  );
  if (!result.ok) return result;
  const totalCount = readTotalCount(result.data);
  if (totalCount === null) return fail("inventory_export", "inconsistent_total");
  return {
    ok: true,
    data: {
      totalCount,
      rows: result.data.map((r) => ({
        rowNo: r.row_no,
        itemId: r.item_id,
        code: r.code,
        itemName: r.item_name,
        mode: r.mode,
        categoryName: r.category_name,
        locationName: r.location_name,
        unitCondition: r.unit_condition,
        unitStatus: r.unit_status,
        qtyGood: r.qty_good,
        qtyNeedsService: r.qty_needs_service,
        qtyDamaged: r.qty_damaged,
        qtyTotal: r.qty_total,
        itemIsActive: r.item_is_active,
        freeQty: r.free_qty,
      })),
    },
  };
}

/** nexus.borrowing_export(): same rows and order as the queue with the same filters (incl. period). */
export async function exportBorrowingRows(
  supabase: SupabaseClient,
  format: InventoryExportFormat,
  filters: QueueFilters,
): Promise<InventoryResult<CountedRows<BorrowingExportRow>>> {
  const result = await callRpc(
    supabase,
    "borrowing_export",
    z.array(borrowingExportRow),
    {
      p_format: format,
      p_view: filters.view,
      p_search: filters.search,
      p_from: filters.from,
      p_to: filters.to,
      p_item_id: filters.itemId,
      p_period_id: filters.periodId,
    },
    { dateField: "to", viewField: "view" },
  );
  if (!result.ok) return result;
  const totalCount = readTotalCount(result.data);
  if (totalCount === null) return fail("borrowing_export", "inconsistent_total");
  return {
    ok: true,
    data: {
      totalCount,
      rows: result.data.map((r) => ({
        rowNo: r.row_no,
        reference: r.reference,
        status: r.status,
        periodLabel: r.period_label,
        requesterName: r.requester_name,
        isOutsideParty: r.is_outside_party,
        outsideOrgName: r.outside_org_name,
        outsideContactName: r.outside_contact_name,
        purpose: r.purpose,
        items: r.items.map(toItemSummary),
        unitsHandedOver: r.units_handed_over,
        startDate: r.start_date,
        endDate: r.end_date,
        extensionCount: r.extension_count,
        decidedByName: r.decided_by_name,
        decidedAt: r.decided_at,
        decisionNote: r.decision_note,
        handedOverAt: r.handed_over_at,
        returnedAt: r.returned_at,
        returnedGood: r.returned_good,
        returnedDamaged: r.returned_damaged,
        returnedLost: r.returned_lost,
        hasIssue: r.has_issue,
        isOverdue: r.is_overdue,
        overdueDays: r.overdue_days,
        isNotPickedUp: r.is_not_picked_up,
        isPartiallyReturned: r.is_partially_returned,
      })),
    },
  };
}

// =============================================================================================
// Evidence photos (private bucket; Storage policies call borrowing_evidence_can_upload / _can_read)
// =============================================================================================

/** Storage refusals that mean "the policy said no" (RLS) rather than "something broke". */
function isPolicyRefusal(error: { status?: number; statusCode?: string; message?: string; code?: string }): boolean {
  return (
    error.status === 403 ||
    error.statusCode === "403" ||
    error.code === "AccessDenied" ||
    error.code === "Unauthorized" ||
    /row-level security/i.test(error.message ?? "")
  );
}

/** Refusals of the bucket's own size/type limits. */
function isFileRefusal(error: { status?: number; statusCode?: string; code?: string }): boolean {
  return (
    error.status === 413 ||
    error.status === 415 ||
    error.statusCode === "413" ||
    error.statusCode === "415" ||
    error.code === "EntityTooLarge" ||
    error.code === "InvalidMimeType"
  );
}

/**
 * Uploads one already-checked photo with the USER's client. No overwrite (upsert false): the path has
 * a fresh random name, so a clash means a bug, answered as unavailable.
 */
export async function uploadEvidencePhoto(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: EvidenceMimeType,
): Promise<InventoryResult<EvidenceUploadResult>> {
  try {
    const { data, error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error) {
      const raw = error as { status?: number; statusCode?: string; message?: string; code?: string };
      if (isPolicyRefusal(raw)) return { ok: false, error: { code: "upload_refused" } };
      if (isFileRefusal(raw)) {
        const tooLarge = raw.status === 413 || raw.statusCode === "413" || raw.code === "EntityTooLarge";
        return { ok: false, error: tooLarge ? { code: "photo_too_large", maxMb: EVIDENCE_MAX_BYTES / (1024 * 1024) } : { code: "invalid_photo", ref: null } };
      }
      return fail("storage.upload", `${raw.status ?? "-"}/${raw.code ?? raw.statusCode ?? "-"}`);
    }
    if (!data || data.path !== path) return fail("storage.upload", "unexpected_shape");
    return { ok: true, data: { path } };
  } catch {
    return fail("storage.upload", "exception");
  }
}

/**
 * Signed links for the photos attached to one request. The request detail (ONE RPC) decides who may
 * see the request at all (requester of record or borrowing.view_all, else not_found) and lists the
 * attached photos with their paths; the paths are then signed with the USER's client, so the bucket
 * policy borrowing_evidence_can_read checks every file again. A file the policy or Storage refuses is
 * left out (the rest still show); a failed Storage call is unavailable.
 */
export async function readEvidencePhotoLinks(
  supabase: SupabaseClient,
  requestId: string,
  ttlSeconds: number,
): Promise<InventoryResult<EvidencePhotoLink[]>> {
  const detail = await callRpc(supabase, "borrowing_request_detail", detailJson, { p_request_id: requestId }, { field: "requestId" });
  if (!detail.ok) return detail;

  const photos = detail.data.lines.flatMap((l) => l.returns.flatMap((r) => r.photos));
  if (photos.length === 0) return { ok: true, data: [] };

  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(
      photos.map((p) => p.storage_path),
      ttlSeconds,
    );
    if (error || !Array.isArray(data)) return fail("storage.createSignedUrls", error ? `${error.status ?? "-"}` : "unexpected_shape");
    const byPath = new Map<string, string>();
    for (const entry of data) {
      if (entry.error === null && typeof entry.path === "string" && typeof entry.signedUrl === "string" && entry.signedUrl !== "") {
        byPath.set(entry.path, entry.signedUrl);
      }
    }
    const links: EvidencePhotoLink[] = [];
    for (const photo of photos) {
      const url = byPath.get(photo.storage_path);
      if (url !== undefined) links.push({ photoId: photo.photo_id, url, expiresAt });
    }
    if (links.length < photos.length) logFailure("storage.createSignedUrls", `${photos.length - links.length}_not_signed`);
    return { ok: true, data: links };
  } catch {
    return fail("storage.createSignedUrls", "exception");
  }
}
