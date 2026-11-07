import "server-only";
import { z } from "zod";
import { buildInventoryError } from "@/lib/picore/inventory-borrowing";
import {
  INVENTORY_DB_HINTS,
  isoDateSchema,
  jakartaToday,
  maxRequestEndDate,
  type InventoryError,
  type InventoryErrorCode,
  type InventoryInputField,
  type InventoryResult,
} from "../types";

// Input validation helpers (contract header): the FIRST zod issue becomes the error. A message that is
// a known code keeps that code, with the issue path's first key as `field`; any other message (zod's
// own, e.g. "Expected object") becomes invalid_input for that field.

const KNOWN_FIELDS: ReadonlySet<string> = new Set<InventoryInputField>([
  "request", "search", "categoryId", "locationId", "condition", "status", "availableFrom", "availableTo", "page",
  "pageSize", "format", "view", "filter", "kind", "id", "itemId", "itemIds", "periodId", "reference", "unitId",
  "unitIds", "requestId", "version", "mode", "name", "description", "note", "reason", "purpose", "stock", "units",
  "quantity", "from", "to", "isActive", "startDate", "endDate", "newEndDate", "lines", "outsideParty",
  "outsideOrgName", "outsideContactName", "outcomes", "outcome", "resultingCondition", "photos", "file",
]);

/** Codes a zod message may carry. Anything else (also a known database hint) is invalid_input. */
const INPUT_CODES: ReadonlySet<InventoryErrorCode> = new Set<InventoryErrorCode>([
  "invalid_input", "text_required", "text_too_long", "reason_required", "note_required", "quantity_invalid",
  "invalid_dates", "start_in_past", "date_range_too_long", "invalid_mode", "invalid_condition", "too_many_lines",
  "duplicate_item", "too_many_units", "invalid_photo", "photo_count", "unit_not_available",
]);

/** Wrapper objects whose own key says nothing; their first inner key names the field. */
const WRAPPERS: ReadonlySet<string> = new Set(["filters"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** nexus ids (z.guid, as the contract: the database accepts any 8-4-4-4-12 hex). */
export const idInputSchema = z.guid({ message: "invalid_input" });

function fieldFromPath(path: readonly PropertyKey[]): InventoryInputField {
  const keys = path.filter((k): k is string => typeof k === "string");
  const first = keys.length > 1 && WRAPPERS.has(keys[0]) ? keys[1] : keys[0];
  if (first === "outsideParty" && keys[1] === "orgName") return "outsideOrgName";
  if (first === "outsideParty" && keys[1] === "contactName") return "outsideContactName";
  return first !== undefined && KNOWN_FIELDS.has(first) ? (first as InventoryInputField) : "request";
}

/** Reads input[key][index] safely (the input is untrusted and may be anything). */
function itemAt(input: unknown, key: string, index: number): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  const list = (input as Record<string, unknown>)[key];
  return Array.isArray(list) ? list[index] : undefined;
}

/** For a path like ["lines", 2, ...]: the line, unit or item id of that entry, so the UI marks the right row. */
function refFromPath(input: unknown, path: readonly PropertyKey[]): string | undefined {
  const [key, index] = path;
  if (typeof key !== "string" || typeof index !== "number") return undefined;
  const entry = itemAt(input, key, index);
  if (typeof entry !== "object" || entry === null) return undefined;
  for (const name of ["lineId", "unitId", "itemId"]) {
    const value = (entry as Record<string, unknown>)[name];
    if (typeof value === "string" && UUID.test(value)) return value.toLowerCase();
  }
  return undefined;
}

/** date_range_too_long from the form: the latest allowed end date (original start + 365), when known. */
function maxEndDateFrom(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const start = isoDateSchema.safeParse((input as Record<string, unknown>).startDate);
  return start.success ? maxRequestEndDate(start.data) : null;
}

/** The contract error for a failed zod parse of `input`. */
export function inputError(error: z.ZodError, input: unknown): InventoryError {
  const issue = error.issues[0];
  if (!issue) return { code: "invalid_input", field: "request" };
  const field = fieldFromPath(issue.path);
  const ref = refFromPath(input, issue.path);

  const hinted = Object.hasOwn(INVENTORY_DB_HINTS, issue.message) ? INVENTORY_DB_HINTS[issue.message] : undefined;
  const code = hinted !== undefined && INPUT_CODES.has(hinted) ? hinted : "invalid_input";
  if (code === "date_range_too_long") return { code, field, maxEndDate: maxEndDateFrom(input) };
  return buildInventoryError(code, field, null, ref ?? null) ?? { code: "invalid_input", field };
}

/** Parses untrusted input; the failure is already the contract error. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: InventoryError } {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: inputError(parsed.error, input) };
}

/** Start dates may not be before today (Jakarta, R19); the database checks again (start_in_past). */
export function startInPast(date: string | null, field: InventoryInputField): InventoryError | null {
  return date !== null && date < jakartaToday() ? { code: "start_in_past", field } : null;
}

/**
 * Last line of defence for "never throws": an unexpected exception becomes unavailable (logged
 * without details). Every path inside already returns results; this only guards against bugs.
 */
export async function safely<T>(label: string, run: () => Promise<InventoryResult<T>>): Promise<InventoryResult<T>> {
  try {
    return await run();
  } catch {
    console.error(`[inventory] ${label} failed unexpectedly`);
    return { ok: false, error: { code: "unavailable" } };
  }
}
