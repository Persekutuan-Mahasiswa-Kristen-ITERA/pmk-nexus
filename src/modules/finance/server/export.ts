import "server-only";
import type { AccessState } from "@/lib/auth/types";
import { attachmentDisposition } from "@/lib/export/datetime";
import { isSameOriginRequest, readCappedBody } from "@/lib/http/request";
import { exportFinanceRows, readFinanceSummary } from "@/lib/picore/finance";
import { isCut } from "@/lib/supabase/limits";
import { financeExportSchema, type FinanceError, type FinanceExportSummary } from "../types";
import { requireFinance } from "./access";
import { buildFinanceExportFile, type FinanceExportFile } from "./export-file";
import { financeErrorResponse, financeMethodNotAllowed } from "./http";
import { parseInput } from "./validation";

// POST /api/finance/export (spec F7, section 8). The route file only delegates here. Order: same-origin
// check (CSRF) -> session + finance.export AND view (R15) -> body validation -> ONE call to
// nexus.finance_export (which checks the right again, refuses more than 1000 rows before any log row,
// and writes the export-log row in the same transaction: no log row, no data) -> the cut check against
// total_count -> build the file in memory -> download. POST only: an export writes a log row, so a GET
// (prefetch, crawler, link preview) must never run it.

/** Bodies are a handful of short fields (filters + format); anything larger is not from our screen. */
const MAX_BODY_BYTES = 8 * 1024;

const REQUEST_ERROR = { ok: false as const, error: { code: "invalid_input" as const, field: "request" as const } };

/** Form fields the no-JavaScript fallback may send: the filter's own name (contract FINANCE_PARAMS shapes). */
const TEXT_FIELDS = ["search", "periodId", "type", "from", "to"] as const;
const FLAG_FIELDS = ["includeVoided", "withoutProof"] as const;

/**
 * Reads the export body. Two shapes:
 *   application/json: FinanceExportInput exactly ({ format, filters });
 *   form (urlencoded or multipart, the no-JavaScript fallback): `format` plus one field per filter with
 *   the filter's own name (search, periodId, type, from, to; includeVoided and withoutProof as "1" or
 *   "true"). Empty = not set.
 * Strict on purpose: an export must match the screen, so a bad value is refused, never replaced.
 */
export async function readFinanceExportBody(request: Request): Promise<{ ok: true; body: unknown } | typeof REQUEST_ERROR> {
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
  for (const name of TEXT_FIELDS) {
    const value = read(name);
    if (value === false) return REQUEST_ERROR;
    if (value !== null) filters[name] = value;
  }
  for (const name of FLAG_FIELDS) {
    const value = read(name);
    if (value === false) return REQUEST_ERROR;
    if (value === null) continue;
    if (value !== "1" && value !== "true") return REQUEST_ERROR;
    filters[name] = true;
  }
  return { ok: true, body: { format: format ?? undefined, filters } };
}

export async function handleFinanceExport(request: Request, readAccessState: () => Promise<AccessState>): Promise<Response> {
  if (request.method !== "POST") return financeMethodNotAllowed();
  if (!isSameOriginRequest(request)) return financeErrorResponse({ code: "forbidden" });

  let state: AccessState;
  try {
    state = await readAccessState();
  } catch {
    return financeErrorResponse({ code: "unavailable" });
  }
  // canExport already includes view (financeCapabilities), so a bare finance.export key is not enough (R15).
  const gate = await requireFinance("canExport", state);
  if (!gate.ok) return financeErrorResponse(gate.error);

  const raw = await readFinanceExportBody(request);
  if (!raw.ok) return financeErrorResponse(raw.error);
  const body = parseInput(financeExportSchema, raw.body);
  if (!body.ok) return financeErrorResponse(body.error);
  const { format, filters } = body.data;

  const exportedAt = new Date();
  let answer: Awaited<ReturnType<typeof exportFinanceRows>>;
  try {
    answer = await exportFinanceRows(gate.supabase, format, filters);
  } catch {
    return financeErrorResponse({ code: "unavailable" });
  }
  if (!answer.ok) return financeErrorResponse(answer.error);
  // PostgREST max_rows cuts a `returns table` answer silently: fewer rows than counted = refuse (FN-32).
  if (isCut({ rows: answer.data.rows, totalCount: answer.data.totalCount })) {
    return financeErrorResponse({ code: "export_too_large", rowCount: null } satisfies FinanceError);
  }

  // The summary block comes from the SAME call as the rows. An empty result has none: read it once
  // (a read, no log row) for the period the screen showed.
  let summary: FinanceExportSummary | null = answer.data.summary;
  let periodLabel: string | null = answer.data.rows[0]?.periodLabel ?? null;
  if (summary === null) {
    const read = await readFinanceSummary(gate.supabase, filters.periodId);
    if (!read.ok) return financeErrorResponse(read.error);
    summary = { opening: read.data.openingAmount, income: read.data.incomeTotal, expense: read.data.expenseTotal, balance: read.data.balance };
    periodLabel = read.data.periodLabel;
  }

  let file: FinanceExportFile;
  try {
    file = await buildFinanceExportFile(format, answer.data.rows, summary, filters, { periodLabel, exportedAt });
  } catch {
    // The log row is already written (same transaction as the rows); the file could not be built.
    console.error("[finance] building the finance export failed");
    return financeErrorResponse({ code: "unavailable" });
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
