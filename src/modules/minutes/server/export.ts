import "server-only";
import type { AccessState } from "@/lib/auth/types";
import { attachmentDisposition } from "@/lib/export/datetime";
import { isSameOriginRequest, readCappedBody } from "@/lib/http/request";
import { exportMinuteRows, type MinuteExportTarget } from "@/lib/picore/minutes";
import { isCut } from "@/lib/supabase/limits";
import { minuteExportSchema, type MinuteError } from "../types";
import { requireMinutes } from "./access";
import { buildMinuteExportFile, type MinuteExportFile } from "./export-file";
import { minuteErrorResponse, minuteMethodNotAllowed } from "./http";
import { parseInput } from "./validation";

// POST /api/minutes/export (spec F6, section 8). The route file only delegates here. Order: same-origin
// check (CSRF) -> session + minutes.export (in some scope) -> body validation -> ONE call to
// nexus.minute_export (which checks the right again per unit, refuses more than 1000 rows before any
// log row, and writes the export-log row in the same transaction: no log row, no data) -> the cut
// check against total_count -> build the file in memory -> download. POST only: an export writes a log
// row, so a GET (prefetch, crawler, link preview) must never run it.

/** Bodies are a handful of short fields (filters + format, or an id); anything larger is not from our screen. */
const MAX_BODY_BYTES = 8 * 1024;

const REQUEST_ERROR = { ok: false as const, error: { code: "invalid_input" as const, field: "request" as const } };

const FILTER_FIELDS = ["search", "unitId", "period", "status"] as const;

/**
 * Reads the export body. Two shapes:
 *   application/json: MinuteExportInput exactly ({ kind: "list", format, filters } or
 *   { kind: "single", format, minuteId });
 *   form (urlencoded or multipart, the no-JavaScript fallback): `kind`, `format`, and either `minuteId`
 *   or one field per filter with the filter's own name (search, unitId, period, status). Empty = not set.
 * Strict on purpose: an export must match the screen, so a bad value is refused, never replaced.
 */
export async function readMinuteExportBody(request: Request): Promise<{ ok: true; body: unknown } | typeof REQUEST_ERROR> {
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
  const kind = read("kind");
  const format = read("format");
  const minuteId = read("minuteId");
  if (kind === false || format === false || minuteId === false) return REQUEST_ERROR;
  if (kind === "single") return { ok: true, body: { kind, format: format ?? undefined, minuteId: minuteId ?? undefined } };
  const filters: Record<string, unknown> = {};
  for (const name of FILTER_FIELDS) {
    const value = read(name);
    if (value === false) return REQUEST_ERROR;
    if (value !== null) filters[name] = value;
  }
  return { ok: true, body: { kind: kind ?? undefined, format: format ?? undefined, filters } };
}

export async function handleMinuteExport(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return minuteMethodNotAllowed();
  if (!isSameOriginRequest(request)) return minuteErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return minuteErrorResponse({ code: "unavailable" });
  }
  const gate = await requireMinutes("canExport", state);
  if (!gate.ok) return minuteErrorResponse(gate.error);

  const raw = await readMinuteExportBody(request);
  if (!raw.ok) return minuteErrorResponse(raw.error);
  const body = parseInput(minuteExportSchema, raw.body);
  if (!body.ok) return minuteErrorResponse(body.error);
  const input = body.data;
  const target: MinuteExportTarget =
    input.kind === "single" ? { kind: "single", minuteId: input.minuteId } : { kind: "list", filters: input.filters };

  const exportedAt = new Date();
  let rows: Awaited<ReturnType<typeof exportMinuteRows>>;
  try {
    rows = await exportMinuteRows(gate.supabase, input.format, target);
  } catch {
    return minuteErrorResponse({ code: "unavailable" });
  }
  if (!rows.ok) return minuteErrorResponse(rows.error);
  // PostgREST max_rows cuts a `returns table` answer silently: fewer rows than counted = refuse.
  if (isCut(rows.data)) return minuteErrorResponse({ code: "export_too_large", rowCount: null } satisfies MinuteError);

  let file: MinuteExportFile;
  try {
    file = await buildMinuteExportFile(input.format, rows.data.rows, target, {
      periodLabel: gate.member.activePeriodLabel,
      exportedAt,
    });
  } catch {
    // The log row is already written (same transaction as the rows); the file could not be built.
    console.error("[minutes] building the minutes export failed");
    return minuteErrorResponse({ code: "unavailable" });
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
