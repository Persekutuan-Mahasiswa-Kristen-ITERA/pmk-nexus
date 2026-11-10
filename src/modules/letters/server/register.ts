import "server-only";
import { readLetterDashboardCounts, readLetterDetail, readLetterList, readLetterYears } from "@/lib/picore/letters";
import {
  letterListQuerySchema,
  letterTypeSchema,
  type LetterDashboardCounts,
  type LetterDetail,
  type LetterListQueryInput,
  type LetterPage,
  type LetterResult,
  type LetterType,
} from "../types";
import { requireLetters } from "./access";
import { idInputSchema, parseInput, safely } from "./validation";

// Register reads (contract section 12). Order in each: session + capability (server), then input
// validation, then ONE database function with the user's client, which checks again. None throws.
// Permission is checked before validation so a caller without access learns nothing from the inputs.

/** Surat Masuk / Surat Keluar list (F1). letters.view. */
export async function listLetters(input: LetterListQueryInput): Promise<LetterResult<LetterPage>> {
  return safely("listLetters", async () => {
    const gate = await requireLetters("canViewRegister");
    if (!gate.ok) return gate;
    const parsed = parseInput(letterListQuerySchema, input);
    if (!parsed.ok) return parsed;
    return readLetterList(gate.supabase, parsed.data.filters, parsed.data.page, parsed.data.pageSize);
  });
}

/** "Tahun nomor" choices, newest first. */
export async function listLetterYears(type: LetterType): Promise<LetterResult<number[]>> {
  return safely("listLetterYears", async () => {
    const gate = await requireLetters("canViewRegister");
    if (!gate.ok) return gate;
    const parsed = letterTypeSchema.safeParse(type);
    if (!parsed.success) return { ok: false, error: { code: "invalid_input", field: "type" } };
    return readLetterYears(gate.supabase, parsed.data);
  });
}

/** Letter detail (design screen 3). A malformed id (page address) answers not_found "letter". */
export async function getLetterDetail(letterId: string): Promise<LetterResult<LetterDetail>> {
  return safely("getLetterDetail", async () => {
    const gate = await requireLetters("canViewRegister");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(letterId);
    if (!id.success) return { ok: false, error: { code: "not_found", entity: "letter" } };
    return readLetterDetail(gate.supabase, id.data);
  });
}

/** Dashboard card and the header tiles (counts only, active period). */
export async function getLetterDashboardCounts(): Promise<LetterResult<LetterDashboardCounts>> {
  return safely("getLetterDashboardCounts", async () => {
    const gate = await requireLetters("canViewRegister");
    if (!gate.ok) return gate;
    return readLetterDashboardCounts(gate.supabase);
  });
}
