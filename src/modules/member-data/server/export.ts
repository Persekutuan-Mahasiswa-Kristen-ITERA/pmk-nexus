import "server-only";
import { attachmentDisposition } from "@/lib/export/datetime";
import { isCut } from "@/lib/supabase/limits";
import { exportMemberRows } from "@/lib/picore/member-data";
import type { AccessState } from "@/lib/auth/types";
import {
  MEMBER_LIST_PARAMS,
  memberExportFormatSchema,
  memberListFiltersSchema,
  type MemberDataError,
  type MemberExportError,
  type MemberExportErrorBody,
  type MemberExportFormat,
  type MemberListFilters,
} from "../types";
import { requireMemberData } from "./access";
import { buildMemberExportFile } from "./export-file";
import { invalidInput } from "./validation";

// POST /api/member-data/export (spec F5, R15, A-MD12, MD-29..MD-37). The route file only delegates here.
// Order: same-origin check (CSRF) -> session + member_data.export -> body validation -> ONE call to
// nexus.member_data_export (which checks the permission again and writes the export-log row in the
// same transaction) -> build the file in memory -> download. Nothing is stored in NEXUS storage.
// POST only: the export writes a log row, so a GET (prefetch, crawler, link preview) must never run it.

/** Form bodies are a handful of short fields; anything larger is not from our form. */
const MAX_BODY_BYTES = 8 * 1024;

const STATUS_BY_CODE: Record<MemberExportError["code"], number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_input: 400,
  unavailable: 503,
  export_too_large: 422,
};

/** JSON error answer. Codes only: never a stack trace, a database message or row data. */
export function memberExportError(error: MemberExportError): Response {
  const body: MemberExportErrorBody = { error };
  return Response.json(body, { status: STATUS_BY_CODE[error.code], headers: { "Cache-Control": "no-store" } });
}

/** 405 for every method except POST. */
export function memberExportMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

/**
 * CSRF guard. The browser always sends Origin on a POST; it must match the host this request was sent
 * to (x-forwarded-host on Vercel, else host), like Next.js's own Server Action check. A missing Origin,
 * "null", or a cross-site Sec-Fetch-Site is refused.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  if (host === "") return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") && url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

type ParsedBody = { ok: true; format: MemberExportFormat; filters: MemberListFilters } | { ok: false; error: MemberDataError };

/**
 * Reads q, unit, status and format from a form body. Strict on purpose (unlike the page address):
 * an export must match the screen, so a bad value is refused instead of replaced by a default.
 * Empty q / unit = none; missing status = active.
 */
/** Reads the body up to `max` bytes; null when it is larger or unreadable. Never buffers more than max + one chunk. */
async function readCappedBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function parseMemberExportBody(request: Request): Promise<ParsedBody> {
  const requestError = { ok: false as const, error: { code: "invalid_input" as const, field: "request" as const } };
  // Keep the raw header for parsing: the multipart boundary is case-sensitive (WebKit sends mixed case).
  const rawType = request.headers.get("content-type") ?? "";
  const type = rawType.toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded") && !type.startsWith("multipart/form-data")) {
    return requestError;
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return requestError;

  // Content-Length can be absent (chunked body), so the cap is also enforced while reading (review LOW 1).
  const bytes = await readCappedBody(request, MAX_BODY_BYTES);
  if (!bytes) return requestError;

  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": rawType } }).formData();
  } catch {
    return requestError;
  }

  const fields = {
    search: MEMBER_LIST_PARAMS.search,
    unitId: MEMBER_LIST_PARAMS.unitId,
    status: MEMBER_LIST_PARAMS.status,
    format: MEMBER_LIST_PARAMS.format,
  } as const;
  const values: Partial<Record<keyof typeof fields, string>> = {};
  for (const [key, name] of Object.entries(fields) as [keyof typeof fields, string][]) {
    const all = form.getAll(name);
    // One text value at most per field; files or repeats are not from our form.
    if (all.length > 1 || (all.length === 1 && typeof all[0] !== "string")) {
      return { ok: false, error: { code: "invalid_input", field: key } };
    }
    if (typeof all[0] === "string" && all[0] !== "") values[key] = all[0];
  }

  const format = memberExportFormatSchema.safeParse(values.format);
  if (!format.success) return { ok: false, error: { code: "invalid_input", field: "format" } };
  const filters = memberListFiltersSchema.safeParse({
    search: values.search ?? null,
    unitId: values.unitId ?? null,
    status: values.status,
  });
  if (!filters.success) return { ok: false, error: invalidInput(filters.error) };
  return { ok: true, format: format.data, filters: filters.data };
}

/**
 * The whole export. `readAccessState` is the route's getAccessState (passed in so the route file runs
 * the session check itself, AR8/F2, and so it runs only after the cheap same-origin check).
 */
export async function handleMemberDataExport(
  request: Request,
  readAccessState: () => Promise<AccessState>,
): Promise<Response> {
  if (request.method !== "POST") return memberExportMethodNotAllowed();
  if (!isSameOriginRequest(request)) return memberExportError({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return memberExportError({ code: "unavailable" });
  }
  const gate = await requireMemberData("canExport", state);
  if (!gate.ok) return memberExportError(gate.error);

  const body = await parseMemberExportBody(request);
  if (!body.ok) return memberExportError(body.error);

  const exportedAt = new Date();
  const rows = await exportMemberRows(gate.supabase, body.format, body.filters);
  if (!rows.ok) return memberExportError(rows.error);
  // PostgREST max_rows silently cuts a `returns table` answer; fewer rows than the database counted
  // (total_count) = cut. Refuse rather than hand out a partial list. The log row is already written.
  if (isCut(rows.data)) return memberExportError({ code: "export_too_large" });

  try {
    const file = await buildMemberExportFile(body.format, rows.data.rows, {
      periodLabel: gate.member.activePeriodLabel,
      exportedAt,
    });
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
    // Report "gangguan" without details; the log may then show an export that produced no file.
    console.error(`[member-data] building the ${body.format} export failed`);
    return memberExportError({ code: "unavailable" });
  }
}
