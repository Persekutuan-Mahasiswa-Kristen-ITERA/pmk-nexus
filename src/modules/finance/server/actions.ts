"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import {
  addFinanceProofRows,
  readFinanceProofLink,
  recordFinanceEntryRow,
  voidFinanceEntryRow,
  withdrawFinanceProofRow,
} from "@/lib/picore/finance";
import {
  FINANCE_PROOF_SIGNED_URL_TTL_SECONDS,
  financeAddProofSchema,
  financeProofLinkSchema,
  financeRecordSchema,
  financeVoidSchema,
  financeWithdrawProofSchema,
  type FinanceAddProofInput,
  type FinanceProofLink,
  type FinanceProofLinkInput,
  type FinanceProofResult,
  type FinanceRecordInput,
  type FinanceRecordResult,
  type FinanceResult,
  type FinanceVoidInput,
  type FinanceVoidResult,
  type FinanceWithdrawProofInput,
} from "../types";
import { requireFinance, type FinanceCapability, type FinanceGate } from "./access";
import { entryDateInFuture, parseInput, safely } from "./validation";

// Server Actions for finance.manage (the two Treasurers): record, void, add or withdraw proof, plus the
// signed proof link for finance.view. Each: session check (getAccessState, AR8) + the right first, zod
// validation, the Jakarta date check, then ONE database function with the user's client. The database
// checks the right, the active period and every business rule again, and writes a history row. The actor,
// the period, the number and the creator are never inputs (FN-13, FN-22). There is no edit action: a saved
// entry never changes (K2 a). Never throws.

async function gate(capability: FinanceCapability): Promise<FinanceGate> {
  let state: AccessState;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" };
  }
  return requireFinance(capability, state);
}

/**
 * "Simpan transaksi" (F2, F3, F5). Needs finance.manage and an active period. The submit key makes a
 * retry or double tap save one entry (replayed = true is a success).
 */
export async function recordFinanceEntry(input: FinanceRecordInput): Promise<FinanceResult<FinanceRecordResult>> {
  return safely("recordFinanceEntry", async () => {
    const g = await gate("canManage");
    if (!g.ok) return g;
    if (!g.capabilities.canRecord) return { ok: false, error: { code: "no_active_period" } };
    const parsed = parseInput(financeRecordSchema, input);
    if (!parsed.ok) return parsed;
    const data = parsed.data;
    const future = entryDateInFuture(data.entryDate);
    if (future) return { ok: false, error: future };
    return recordFinanceEntryRow(g.supabase, {
      entryType: data.entryType,
      entryDate: data.entryDate,
      amount: data.amount,
      description: data.description,
      notes: data.notes,
      correctsEntryId: data.correctsEntryId,
      files: data.files,
      submitKey: data.submitKey,
    });
  });
}

/** "Batalkan transaksi" (F4). Aktif entry of the active period; never restored. */
export async function voidFinanceEntry(input: FinanceVoidInput): Promise<FinanceResult<FinanceVoidResult>> {
  return safely("voidFinanceEntry", async () => {
    const g = await gate("canManage");
    if (!g.ok) return g;
    const parsed = parseInput(financeVoidSchema, input);
    if (!parsed.ok) return parsed;
    return voidFinanceEntryRow(g.supabase, parsed.data);
  });
}

/** "Tambah bukti" (F6): 1..filesRoom just-uploaded proofs. */
export async function addFinanceProof(input: FinanceAddProofInput): Promise<FinanceResult<FinanceProofResult>> {
  return safely("addFinanceProof", async () => {
    const g = await gate("canManage");
    if (!g.ok) return g;
    const parsed = parseInput(financeAddProofSchema, input);
    if (!parsed.ok) return parsed;
    return addFinanceProofRows(g.supabase, parsed.data);
  });
}

/** "Tarik berkas" (F6). The record and the stored file stay (L5). */
export async function withdrawFinanceProof(input: FinanceWithdrawProofInput): Promise<FinanceResult<FinanceProofResult>> {
  return safely("withdrawFinanceProof", async () => {
    const g = await gate("canManage");
    if (!g.ok) return g;
    const parsed = parseInput(financeWithdrawProofSchema, input);
    if (!parsed.ok) return parsed;
    return withdrawFinanceProofRow(g.supabase, parsed.data);
  });
}

/**
 * "Lihat" on a proof (spec 4.4: the link is made at the press, so it never expires under an open page).
 * finance.view. The database decides which proofs this caller may read (withdrawn ones only for managers);
 * the storage path never leaves the server. Short-lived: FINANCE_PROOF_SIGNED_URL_TTL_SECONDS (300 s).
 */
export async function getFinanceProofLink(input: FinanceProofLinkInput): Promise<FinanceResult<FinanceProofLink>> {
  return safely("getFinanceProofLink", async () => {
    const g = await gate("canView");
    if (!g.ok) return g;
    const parsed = parseInput(financeProofLinkSchema, input);
    if (!parsed.ok) return parsed;
    return readFinanceProofLink(g.supabase, parsed.data, FINANCE_PROOF_SIGNED_URL_TTL_SECONDS);
  });
}
