import "server-only";
import { z } from "zod";
import { jakartaToday, minuteErrorFromZod, type MinuteError, type MinuteResult } from "../types";

// Input validation helpers. The contract owns the mapping: the FIRST zod issue becomes the error
// through minuteErrorFromZod() (known code kept, field from the deepest known key of the path; anything
// else invalid_input). Never reads or echoes the input itself.

/** nexus ids (z.guid, as the contract: the database accepts any 8-4-4-4-12 hex). */
export const idInputSchema = z.guid({ message: "invalid_input" });

/** Parses untrusted input; the failure is already the contract error. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.output<S> } | { ok: false; error: MinuteError } {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: minuteErrorFromZod(parsed.error) };
}

/** "Tanggal Rapat" may not be after today in Asia/Jakarta (R9, R14); the database checks again. */
export function meetingDateInFuture(date: string, now: Date = new Date()): MinuteError | null {
  return date > jakartaToday(now) ? { code: "date_in_future", field: "meetingDate" } : null;
}

/**
 * Last line of defence for "never throws": an unexpected exception becomes unavailable (logged
 * without details). Every path inside already returns results; this only guards against bugs.
 */
export async function safely<T>(label: string, run: () => Promise<MinuteResult<T>>): Promise<MinuteResult<T>> {
  try {
    return await run();
  } catch {
    console.error(`[minutes] ${label} failed unexpectedly`);
    return { ok: false, error: { code: "unavailable" } };
  }
}
