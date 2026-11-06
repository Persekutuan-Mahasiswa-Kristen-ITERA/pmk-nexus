import "server-only";
import type { z } from "zod";
import type { MemberDataError, MemberDataInputField } from "../types";

// Turns a zod failure into the contract's invalid_input error, naming the first refused field.

const KNOWN_FIELDS: ReadonlySet<string> = new Set<MemberDataInputField>([
  "search",
  "unitId",
  "status",
  "page",
  "pageSize",
  "format",
]);

export function invalidInput(error: z.ZodError): MemberDataError {
  const first = error.issues[0]?.path[0];
  const field = typeof first === "string" && KNOWN_FIELDS.has(first) ? (first as MemberDataInputField) : "request";
  return { code: "invalid_input", field };
}
