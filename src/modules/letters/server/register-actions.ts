"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import { addLetterFileRows, registerLetterRow, updateLetterRow, voidLetterRow, withdrawLetterFileRow } from "@/lib/picore/letters";
import {
  letterAddFilesSchema,
  letterRegisterSchema,
  letterUpdateSchema,
  letterVoidSchema,
  letterWithdrawFileSchema,
  type LetterAddFilesInput,
  type LetterFilesResult,
  type LetterRegisterInput,
  type LetterRegisterResult,
  type LetterResult,
  type LetterUpdateInput,
  type LetterUpdateResult,
  type LetterVoidInput,
  type LetterVoidResult,
  type LetterWithdrawFileInput,
} from "../types";
import { requireLetters, type LetterGate } from "./access";
import { dateInFuture, parseInput, safely } from "./validation";

// Server Actions for letters.manage (BPH secretaries): register, edit, add or withdraw files, void.
// Each: session check (getAccessState) + letters.manage first, zod validation, the Jakarta date checks,
// then ONE database function with the user's client (it checks the right, the active period, the
// version and every business rule again, and writes a letter history row). Never throws.

async function gate(): Promise<LetterGate> {
  let state: AccessState;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" };
  }
  return requireLetters("canManageRegister", state);
}

/** "Catat Surat Masuk / Keluar" (F2, F3). Needs an active period (canRegister). */
export async function registerLetter(input: LetterRegisterInput): Promise<LetterResult<LetterRegisterResult>> {
  return safely("registerLetter", async () => {
    const g = await gate();
    if (!g.ok) return g;
    if (!g.capabilities.hasActivePeriod) return { ok: false, error: { code: "no_active_period" } };
    const parsed = parseInput(letterRegisterSchema, input);
    if (!parsed.ok) return parsed;
    const data = parsed.data;
    const future =
      (data.type === "incoming" ? dateInFuture(data.receivedDate, "receivedDate") : null) ?? dateInFuture(data.letterDate, "letterDate");
    if (future) return { ok: false, error: future };
    return registerLetterRow(g.supabase, data);
  });
}

/** "Ubah rincian" (F4.1). An unchanged form answers changed: false. */
export async function updateLetter(input: LetterUpdateInput): Promise<LetterResult<LetterUpdateResult>> {
  return safely("updateLetter", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(letterUpdateSchema, input);
    if (!parsed.ok) return parsed;
    const data = parsed.data;
    const future =
      (data.type === "incoming" ? dateInFuture(data.receivedDate, "receivedDate") : null) ?? dateInFuture(data.letterDate, "letterDate");
    if (future) return { ok: false, error: future };
    return updateLetterRow(g.supabase, data);
  });
}

/** "Tambah berkas" (F4.2). */
export async function addLetterFiles(input: LetterAddFilesInput): Promise<LetterResult<LetterFilesResult>> {
  return safely("addLetterFiles", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(letterAddFilesSchema, input);
    if (!parsed.ok) return parsed;
    return addLetterFileRows(g.supabase, parsed.data);
  });
}

/** "Tarik berkas" (F4.2). `version` is the letter's version. */
export async function withdrawLetterFile(input: LetterWithdrawFileInput): Promise<LetterResult<LetterFilesResult>> {
  return safely("withdrawLetterFile", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(letterWithdrawFileSchema, input);
    if (!parsed.ok) return parsed;
    return withdrawLetterFileRow(g.supabase, parsed.data);
  });
}

/** "Batalkan nomor" (F4.3). */
export async function voidLetter(input: LetterVoidInput): Promise<LetterResult<LetterVoidResult>> {
  return safely("voidLetter", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(letterVoidSchema, input);
    if (!parsed.ok) return parsed;
    return voidLetterRow(g.supabase, parsed.data);
  });
}
