import "server-only";
import { methodNotAllowed } from "@/lib/http/request";
import { financeErrorStatus, type FinanceError, type FinanceErrorBody } from "../types";

// Shared answers of the two Finance route handlers.

/** JSON error answer. Codes only: never a stack trace, a database message, an amount or row data. */
export function financeErrorResponse(error: FinanceError): Response {
  const body: FinanceErrorBody = { error };
  return Response.json(body, { status: financeErrorStatus(error), headers: { "Cache-Control": "no-store" } });
}

/** 405 for every method except POST. */
export function financeMethodNotAllowed(): Response {
  return methodNotAllowed();
}
