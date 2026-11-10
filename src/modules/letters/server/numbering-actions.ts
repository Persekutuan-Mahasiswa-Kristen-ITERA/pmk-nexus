"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import { setNumberingNextRow, updateNumberingFormatRow } from "@/lib/picore/letters";
import {
  numberingFormatUpdateSchema,
  numberingSetNextSchema,
  type LetterResult,
  type NumberingFormatResult,
  type NumberingFormatUpdateInput,
  type NumberingSetNextInput,
  type NumberingSetNextResult,
} from "../types";
import { requireLetters, type LetterGate } from "./access";
import { parseInput, safely } from "./validation";

// Server Actions for the numbering settings: System Admin only (access control L3). Works without an
// active period. Each: session check (getAccessState) + System Admin first, zod validation, then ONE
// database function (it checks the admin flag, the version, the year and the rules again and logs
// before/after). Never throws.

async function gate(): Promise<LetterGate> {
  let state: AccessState;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" };
  }
  return requireLetters("canEditNumbering", state);
}

/** "Simpan format" (P11). The year is always included: p_include_year is sent as true. */
export async function updateNumberingFormat(input: NumberingFormatUpdateInput): Promise<LetterResult<NumberingFormatResult>> {
  return safely("updateNumberingFormat", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(numberingFormatUpdateSchema, input);
    if (!parsed.ok) return parsed;
    return updateNumberingFormatRow(g.supabase, parsed.data);
  });
}

/** "Atur nomor berikutnya" (L7 a): current Jakarta year only, reason required. */
export async function setNextNumber(input: NumberingSetNextInput): Promise<LetterResult<NumberingSetNextResult>> {
  return safely("setNextNumber", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(numberingSetNextSchema, input);
    if (!parsed.ok) return parsed;
    return setNumberingNextRow(g.supabase, parsed.data);
  });
}
