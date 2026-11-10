import "server-only";
import { z } from "zod";
import { buildLetterError } from "@/lib/picore/letters";
import {
  LETTER_DB_HINTS,
  LETTER_FILE_PATH_PATTERN,
  LETTER_LIMITS,
  jakartaToday,
  type LetterError,
  type LetterErrorCode,
  type LetterInputField,
  type LetterResult,
} from "../types";

// Input validation helpers (contract header): the FIRST zod issue becomes the error. A message that is
// a known code keeps that code, with the issue path's first key as `field`; any other message (zod's
// own, e.g. a failed discriminated union) becomes invalid_input for that field. Payloads (`count`,
// `ref`) are filled as contract section 8 says.

const KNOWN_FIELDS: ReadonlySet<string> = new Set<LetterInputField>([
  "request", "type", "search", "period", "year", "status", "withoutFiles", "page", "pageSize", "format", "view",
  "filter", "from", "to", "filters", "parent", "letterId", "requestId", "fileId", "version", "subject", "counterpart",
  "counterpartNumber", "letterDate", "receivedDate", "notes", "legacyNumber", "files", "file", "reason", "note",
  "addressee", "purpose", "onBehalfOf", "neededBy", "prefix", "incomingCode", "outgoingCode", "codes", "seqDigits",
  "separator", "nextSeq",
]);

/** Codes a zod message may carry. Anything else (also a known database hint) is invalid_input. */
const INPUT_CODES: ReadonlySet<LetterErrorCode> = new Set<LetterErrorCode>([
  "invalid_input", "text_required", "text_too_long", "reason_required", "note_required", "date_required",
  "date_in_future", "date_in_past", "invalid_dates", "invalid_file", "file_too_large", "file_required", "file_count",
  "invalid_number_format",
]);

/** Wrapper objects whose own key says nothing; their first inner key names the field. */
const WRAPPERS: ReadonlySet<string> = new Set(["filters"]);

/** nexus ids (z.guid, as the contract: the database accepts any 8-4-4-4-12 hex). */
export const idInputSchema = z.guid({ message: "invalid_input" });

function fieldFromPath(path: readonly PropertyKey[]): LetterInputField {
  const keys = path.filter((k): k is string => typeof k === "string");
  const first = keys.length > 1 && WRAPPERS.has(keys[0]) ? keys[1] : keys[0];
  return first !== undefined && KNOWN_FIELDS.has(first) ? (first as LetterInputField) : "request";
}

/** For a path like ["files", 1, "name"]: that entry's upload path, when it is well-formed (the UI marks the tile). */
function filePathAt(input: unknown, path: readonly PropertyKey[]): string | null {
  const [key, index] = path;
  if (key !== "files" || typeof index !== "number" || typeof input !== "object" || input === null) return null;
  const list = (input as Record<string, unknown>).files;
  const entry = Array.isArray(list) ? list[index] : undefined;
  if (typeof entry !== "object" || entry === null) return null;
  const value = (entry as Record<string, unknown>).path;
  return typeof value === "string" && LETTER_FILE_PATH_PATTERN.test(value) ? value : null;
}

/** The contract error for a failed zod parse of `input`. */
export function inputError(error: z.ZodError, input: unknown): LetterError {
  const issue = error.issues[0];
  if (!issue) return { code: "invalid_input", field: "request" };
  const field = fieldFromPath(issue.path);
  const hinted = Object.hasOwn(LETTER_DB_HINTS, issue.message) ? LETTER_DB_HINTS[issue.message] : undefined;
  const code = hinted !== undefined && INPUT_CODES.has(hinted) ? hinted : "invalid_input";

  // file_required: the minimum of every list that has one is 1; file_count: the bound is 3 (the
  // database answers the exact room left when fewer may be added).
  let detail: string | null = null;
  if (code === "file_required") detail = "1";
  else if (code === "file_count") detail = String(LETTER_LIMITS.filesPerParent);
  else if (code === "invalid_file" || code === "file_too_large") detail = filePathAt(input, issue.path);
  return buildLetterError(code, field, detail) ?? { code: "invalid_input", field };
}

/** Parses untrusted input; the failure is already the contract error. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: LetterError } {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: inputError(parsed.error, input) };
}

/** Letter / received dates may not be after today (Asia/Jakarta, R16); the database checks again. */
export function dateInFuture(date: string | null, field: LetterInputField): LetterError | null {
  return date !== null && date > jakartaToday() ? { code: "date_in_future", field } : null;
}

/** "Dibutuhkan paling lambat" may not be before today (Asia/Jakarta); the database checks again. */
export function dateInPast(date: string | null, field: LetterInputField): LetterError | null {
  return date !== null && date < jakartaToday() ? { code: "date_in_past", field } : null;
}

/**
 * Last line of defence for "never throws": an unexpected exception becomes unavailable (logged
 * without details). Every path inside already returns results; this only guards against bugs.
 */
export async function safely<T>(label: string, run: () => Promise<LetterResult<T>>): Promise<LetterResult<T>> {
  try {
    return await run();
  } catch {
    console.error(`[letters] ${label} failed unexpectedly`);
    return { ok: false, error: { code: "unavailable" } };
  }
}
