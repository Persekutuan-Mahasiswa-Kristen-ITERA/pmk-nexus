import "server-only";
import { methodNotAllowed } from "@/lib/http/request";
import { minuteErrorStatus, type MinuteError, type MinuteErrorBody } from "../types";

// Shared answers of the two Meeting Minutes route handlers.

/** JSON error answer. Codes only: never a stack trace, a database message or row data. */
export function minuteErrorResponse(error: MinuteError): Response {
  const body: MinuteErrorBody = { error };
  return Response.json(body, { status: minuteErrorStatus(error), headers: { "Cache-Control": "no-store" } });
}

/** 405 for every method except POST. */
export function minuteMethodNotAllowed(): Response {
  return methodNotAllowed();
}
