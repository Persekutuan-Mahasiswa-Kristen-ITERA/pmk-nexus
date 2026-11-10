import "server-only";
import { readNumberingHistory, readNumberingSettings } from "@/lib/picore/letters";
import {
  numberingHistoryQuerySchema,
  type LetterResult,
  type NumberingHistoryPage,
  type NumberingHistoryQueryInput,
  type NumberingSettings,
} from "../types";
import { requireLetters } from "./access";
import { parseInput, safely } from "./validation";

// Numbering settings reads (contract section 12): System Admin (edit) or letters.manage (read-only).

/** Format, next numbers of the current Jakarta year, first-use flags, canEdit. */
export async function getNumberingSettings(): Promise<LetterResult<NumberingSettings>> {
  return safely("getNumberingSettings", async () => {
    const gate = await requireLetters("canReadNumbering");
    if (!gate.ok) return gate;
    return readNumberingSettings(gate.supabase);
  });
}

/** "Riwayat perubahan", newest first. */
export async function listNumberingHistory(input: NumberingHistoryQueryInput = {}): Promise<LetterResult<NumberingHistoryPage>> {
  return safely("listNumberingHistory", async () => {
    const gate = await requireLetters("canReadNumbering");
    if (!gate.ok) return gate;
    const parsed = parseInput(numberingHistoryQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readNumberingHistory(gate.supabase, parsed.data.page, parsed.data.pageSize);
  });
}
