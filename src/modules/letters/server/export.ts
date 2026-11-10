import "server-only";
import type { AccessState } from "@/lib/auth/types";
import { attachmentDisposition } from "@/lib/export/datetime";
import { isSameOriginRequest, methodNotAllowed, readCappedBody } from "@/lib/http/request";
import { exportLetterRows } from "@/lib/picore/letters";
import { isCut } from "@/lib/supabase/limits";
import { letterExportSchema, type LetterError, type LetterErrorBody } from "../types";
import { requireLetters } from "./access";
import { buildLetterExportFile, type LetterExportFile } from "./export-file";
import { parseInput } from "./validation";

// POST /api/letters/export (spec F8, section 8; design 14). The route file only delegates here. Order:
// same-origin check (CSRF) -> session + letters.export -> body validation -> ONE call to
// nexus.letter_export (which checks the right again and writes the export-log row in the same
// transaction: no log row, no data) -> build the file in memory -> download. POST only: an export
// writes a log row, so a GET (prefetch, crawler, link preview) must never run it.

/** Bodies are a handful of short fields (filters + format); anything larger is not from our screen. */
const MAX_BODY_BYTES = 8 * 1024;

/** HTTP status per error (contract section 8). */
export function letterErrorStatus(error: LetterError): number {
  switch (error.code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
    case "self_processing_blocked":
    case "closed_period":
      return 403;
    case "not_found":
      return 404;
    case "file_too_large":
      return 413;
    case "export_too_large":
      return 422;
    case "upload_limit":
      return 429;
    case "unavailable":
      return 503;
    case "invalid_input":
    case "text_required":
    case "text_too_long":
    case "reason_required":
    case "note_required":
    case "date_required":
    case "date_in_future":
    case "date_in_past":
    case "invalid_dates":
    case "invalid_file":
    case "file_already_attached":
    case "file_required":
    case "file_count":
    case "invalid_number_format":
      return 400;
    default:
      return 409;
  }
}

/** JSON error answer. Codes only: never a stack trace, a database message or row data. */
export function letterErrorResponse(error: LetterError): Response {
  const body: LetterErrorBody = { error };
  return Response.json(body, { status: letterErrorStatus(error), headers: { "Cache-Control": "no-store" } });
}

/** 405 for every method except POST. */
export function letterMethodNotAllowed(): Response {
  return methodNotAllowed();
}

const REQUEST_ERROR = { ok: false as const, error: { code: "invalid_input" as const, field: "request" as const } };

/** Form values are text: turn the two non-text filters into their JSON types; anything odd stays text (and is refused). */
function formValue(name: string, value: string): unknown {
  if (name === "year") return /^\d{1,4}$/.test(value) ? Number(value) : value;
  if (name === "withoutFiles") {
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
  }
  return value;
}

const FILTER_FIELDS = ["type", "search", "period", "year", "status", "withoutFiles"] as const;

/**
 * Reads the export body. Two shapes:
 *   application/json: { format, filters: {...} } exactly as LetterExportInput;
 *   form (urlencoded or multipart, the no-JavaScript fallback): `format` plus one field per filter with
 *   the filter's own name (type, search, period, year, status, withoutFiles "1"). Empty = not set.
 * Strict on purpose: an export must match the screen, so a bad value is refused, never replaced.
 */
export async function readLetterExportBody(request: Request): Promise<{ ok: true; body: unknown } | typeof REQUEST_ERROR> {
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
  const filters: Record<string, unknown> = {};
  for (const name of FILTER_FIELDS) {
    const value = read(name);
    if (value === false) return REQUEST_ERROR;
    if (value !== null) filters[name] = formValue(name, value);
  }
  return { ok: true, body: { format: format ?? undefined, filters } };
}

/**
 * PostgREST max_rows silently cuts a `returns table` answer. The database returns the full count
 * (total_count), so fewer rows than counted = cut: refuse (export_too_large) rather than hand out a
 * partial register. The export-log row is already written in the same transaction.
 */
export async function handleLetterExport(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return letterMethodNotAllowed();
  if (!isSameOriginRequest(request)) return letterErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return letterErrorResponse({ code: "unavailable" });
  }
  const gate = await requireLetters("canExportRegister", state);
  if (!gate.ok) return letterErrorResponse(gate.error);

  const raw = await readLetterExportBody(request);
  if (!raw.ok) return letterErrorResponse(raw.error);
  const body = parseInput(letterExportSchema, raw.body);
  if (!body.ok) return letterErrorResponse(body.error);

  const exportedAt = new Date();
  let rows: Awaited<ReturnType<typeof exportLetterRows>>;
  try {
    rows = await exportLetterRows(gate.supabase, body.data.format, body.data.filters);
  } catch {
    return letterErrorResponse({ code: "unavailable" });
  }
  if (!rows.ok) return letterErrorResponse(rows.error);
  if (isCut(rows.data)) return letterErrorResponse({ code: "export_too_large" });

  let file: LetterExportFile;
  try {
    file = await buildLetterExportFile(body.data.format, rows.data.rows, body.data.filters, {
      periodLabel: gate.member.activePeriodLabel,
      exportedAt,
    });
  } catch {
    // The log row is already written (same transaction as the rows); the file could not be built.
    console.error("[letters] building the letters export failed");
    return letterErrorResponse({ code: "unavailable" });
  }
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": attachmentDisposition(file.fileName),
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
