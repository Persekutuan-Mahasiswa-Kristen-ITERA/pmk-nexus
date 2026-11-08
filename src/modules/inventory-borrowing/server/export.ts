import "server-only";
import type { z } from "zod";
import type { AccessState, MemberContext } from "@/lib/auth/types";
import { attachmentDisposition } from "@/lib/export/datetime";
import { isSameOriginRequest, methodNotAllowed, readCappedBody } from "@/lib/http/request";
import { exportBorrowingRows, exportInventoryRows } from "@/lib/picore/inventory-borrowing";
import { mayBeTruncated } from "@/lib/supabase/limits";
import {
  borrowingExportSchema,
  catalogExportSchema,
  type InventoryError,
  type InventoryErrorBody,
} from "../types";
import { requireInventory, type InventoryCapability } from "./access";
import { buildBorrowingExportFile, buildInventoryExportFile, type InventoryExportFile } from "./export-file";
import { parseInput, startInPast } from "./validation";

// POST /api/inventory/export and POST /api/inventory/borrowing/export (spec F12, section 8; design 15).
// The route files only delegate here. Order: same-origin check (CSRF) -> session + export right ->
// body validation -> ONE call to nexus.inventory_export / borrowing_export (which checks the right
// again and writes the export-log row in the same transaction: no log row, no data, A-IB33) -> build
// the file in memory -> download. POST only: an export writes a log row, so a GET (prefetch, crawler,
// link preview) must never run it.

/** Bodies are a handful of short fields (filters + format); anything larger is not from our screen. */
const MAX_BODY_BYTES = 8 * 1024;

/** HTTP status per error (contract: 401, 403, 400, 404, 409/422, 503). */
export function inventoryErrorStatus(error: InventoryError): number {
  switch (error.code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
    case "self_approval_blocked":
    case "closed_period":
    case "upload_refused":
      return 403;
    case "not_found":
      return 404;
    case "photo_too_large":
      return 413;
    case "export_too_large":
      return 422;
    case "unavailable":
      return 503;
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "note_required":
    case "quantity_invalid":
    case "invalid_dates":
    case "start_in_past":
    case "date_range_too_long":
    case "invalid_mode":
    case "invalid_condition":
    case "location_per_unit":
    case "item_not_tracked":
    case "item_not_quantity":
    case "outside_party_incomplete":
    case "too_many_lines":
    case "duplicate_item":
    case "too_many_units":
    case "invalid_photo":
    case "photo_count":
    case "invalid_period":
      return 400;
    default:
      return 409;
  }
}

/** JSON error answer. Codes only: never a stack trace, a database message or row data. */
export function inventoryErrorResponse(error: InventoryError): Response {
  const body: InventoryErrorBody = { error };
  return Response.json(body, { status: inventoryErrorStatus(error), headers: { "Cache-Control": "no-store" } });
}

/** 405 for every method except POST. */
export function inventoryMethodNotAllowed(): Response {
  return methodNotAllowed();
}

const REQUEST_ERROR = { ok: false as const, error: { code: "invalid_input" as const, field: "request" as const } };

/**
 * Reads the export body. Two shapes:
 *   application/json: { format, filters: {...} } exactly as CatalogExportInput / BorrowingExportInput;
 *   form (urlencoded or multipart, the no-JavaScript fallback): `format` plus one field per filter with
 *   the filter's own name (catalog: search, categoryId, locationId, condition, status, availableFrom,
 *   availableTo; borrowing: view, search, from, to, itemId, periodId). Empty = not set.
 * Strict on purpose: an export must match the screen, so a bad value is refused, never replaced.
 */
async function readExportBody(request: Request, filterFields: readonly string[]): Promise<{ ok: true; body: unknown } | typeof REQUEST_ERROR> {
  // Keep the raw header for parsing: the multipart boundary is case-sensitive (WebKit sends mixed case).
  const rawType = request.headers.get("content-type") ?? "";
  const type = rawType.toLowerCase();
  const isJson = type.startsWith("application/json");
  const isForm = type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");
  if (!isJson && !isForm) return REQUEST_ERROR;

  const bytes = await readCappedBody(request, MAX_BODY_BYTES);
  if (!bytes) return REQUEST_ERROR;

  if (isJson) {
    try {
      return { ok: true, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
    } catch {
      return REQUEST_ERROR;
    }
  }

  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": rawType } }).formData();
  } catch {
    return REQUEST_ERROR;
  }
  const read = (name: string): string | null | false => {
    const all = form.getAll(name);
    // One text value at most per field; files or repeats are not from our form.
    if (all.length > 1 || (all.length === 1 && typeof all[0] !== "string")) return false;
    return typeof all[0] === "string" && all[0] !== "" ? all[0] : null;
  };
  const format = read("format");
  if (format === false) return REQUEST_ERROR;
  const filters: Record<string, string> = {};
  for (const name of filterFields) {
    const value = read(name);
    if (value === false) return REQUEST_ERROR;
    if (value !== null) filters[name] = value;
  }
  return { ok: true, body: { format: format ?? undefined, filters } };
}

type ExportPlan<S extends z.ZodType> = {
  capability: InventoryCapability;
  schema: S;
  filterFields: readonly string[];
  label: string;
  run: (
    gate: { supabase: Parameters<typeof exportInventoryRows>[0]; member: MemberContext; canManage: boolean },
    body: z.output<S>,
    exportedAt: Date,
  ) => Promise<{ ok: true; file: () => Promise<InventoryExportFile> } | { ok: false; error: InventoryError }>;
};

async function handleExport<S extends z.ZodType>(
  request: Request,
  readAccessState: () => Promise<AccessState>,
  plan: ExportPlan<S>,
): Promise<Response> {
  if (request.method !== "POST") return inventoryMethodNotAllowed();
  if (!isSameOriginRequest(request)) return inventoryErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return inventoryErrorResponse({ code: "unavailable" });
  }
  const gate = await requireInventory(plan.capability, state);
  if (!gate.ok) return inventoryErrorResponse(gate.error);

  const raw = await readExportBody(request, plan.filterFields);
  if (!raw.ok) return inventoryErrorResponse(raw.error);
  const body = parseInput(plan.schema, raw.body);
  if (!body.ok) return inventoryErrorResponse(body.error);

  const exportedAt = new Date();
  let prepared: Awaited<ReturnType<ExportPlan<S>["run"]>>;
  try {
    prepared = await plan.run(
      { supabase: gate.supabase, member: gate.member, canManage: gate.capabilities.canManageInventory },
      body.data,
      exportedAt,
    );
  } catch {
    return inventoryErrorResponse({ code: "unavailable" });
  }
  if (!prepared.ok) return inventoryErrorResponse(prepared.error);

  try {
    const file = await prepared.file();
    return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachmentDisposition(file.fileName),
        "Content-Length": String(file.bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // The log row is already written (same transaction as the rows); the file could not be built.
    console.error(`[inventory] building the ${plan.label} export failed`);
    return inventoryErrorResponse({ code: "unavailable" });
  }
}

/**
 * INTERIM guard (2026-11-08): PostgREST max_rows (1000) silently cuts a `returns table` answer, so an
 * answer of that size may be incomplete. Refuse it (export_too_large) rather than hand out a partial
 * list. The export-log row is already written in the same transaction. Replace when the exports are
 * paged or return one value (to be decided with the owner).
 */
const TOO_LARGE = { ok: false as const, error: { code: "export_too_large" as const } };

const CATALOG_FILTER_FIELDS = ["search", "categoryId", "locationId", "condition", "status", "availableFrom", "availableTo"] as const;
const QUEUE_FILTER_FIELDS = ["view", "search", "from", "to", "itemId", "periodId"] as const;

/** Catalog export (inventory.export). Archived/all also needs inventory.manage (database rule A-IB5). */
export function handleInventoryExport(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  return handleExport(request, readAccessState, {
    capability: "canExportInventory",
    schema: catalogExportSchema,
    filterFields: CATALOG_FILTER_FIELDS,
    label: "inventory",
    run: async (gate, body, exportedAt) => {
      if (body.filters.status !== "active" && !gate.canManage) return { ok: false, error: { code: "forbidden" } };
      const past = startInPast(body.filters.availableFrom, "availableFrom");
      if (past) return { ok: false, error: past };
      const rows = await exportInventoryRows(gate.supabase, body.format, body.filters);
      if (!rows.ok) return rows;
      if (mayBeTruncated(rows.data.length)) return TOO_LARGE;
      const meta = { periodLabel: gate.member.activePeriodLabel, exportedAt };
      return { ok: true, file: () => buildInventoryExportFile(body.format, rows.data, body.filters, meta) };
    },
  });
}

/** Borrowing export (borrowing.export, gated on view_all), incl. the period filter. */
export function handleBorrowingExport(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  return handleExport(request, readAccessState, {
    capability: "canExportBorrowing",
    schema: borrowingExportSchema,
    filterFields: QUEUE_FILTER_FIELDS,
    label: "borrowing",
    run: async (gate, body, exportedAt) => {
      const rows = await exportBorrowingRows(gate.supabase, body.format, body.filters);
      if (!rows.ok) return rows;
      if (mayBeTruncated(rows.data.length)) return TOO_LARGE;
      const meta = { periodLabel: gate.member.activePeriodLabel, exportedAt };
      return { ok: true, file: () => buildBorrowingExportFile(body.format, rows.data, body.filters, meta) };
    },
  });
}
