"use server";

import { getAccessState } from "@/lib/auth/session";
import * as financeActions from "@/modules/finance/server/actions";
import type {
  FinanceAddProofInput,
  FinanceError,
  FinanceProofLink,
  FinanceProofLinkInput,
  FinanceProofResult,
  FinanceRecordInput,
  FinanceRecordResult,
  FinanceResult,
  FinanceVoidInput,
  FinanceVoidResult,
  FinanceWithdrawProofInput,
} from "@/modules/finance/types";

// The Server Actions the Finance screens call (contract section 13 names). Thin on purpose: each one
// checks the session itself first (AR8, static rule AUTH-42: layouts do not re-run on client navigation),
// then calls the module entry point, which checks the session and the capability again, validates with zod
// and lets the database check a third time. They return exactly what the module returns (FinanceResult,
// never throws).

/** Session gate (AR8). Anyone who is not an active member stops here, before anything runs. */
async function sessionError(): Promise<FinanceError | null> {
  try {
    const state = await getAccessState();
    if (state.kind === "member") return null;
    if (state.kind === "anonymous") return { code: "unauthenticated" };
    if (state.kind === "error") return { code: "unavailable" };
    return { code: "forbidden" };
  } catch {
    return { code: "unavailable" };
  }
}

/** Runs `next` only for an active member. */
async function gated<T>(next: () => Promise<FinanceResult<T>>): Promise<FinanceResult<T>> {
  const denied = await sessionError();
  if (denied) return { ok: false, error: denied };
  return next();
}

// ---- Writes (finance.manage) ----

export async function recordFinanceEntry(input: FinanceRecordInput): Promise<FinanceResult<FinanceRecordResult>> {
  return gated(() => financeActions.recordFinanceEntry(input));
}

export async function voidFinanceEntry(input: FinanceVoidInput): Promise<FinanceResult<FinanceVoidResult>> {
  return gated(() => financeActions.voidFinanceEntry(input));
}

export async function addFinanceProof(input: FinanceAddProofInput): Promise<FinanceResult<FinanceProofResult>> {
  return gated(() => financeActions.addFinanceProof(input));
}

export async function withdrawFinanceProof(input: FinanceWithdrawProofInput): Promise<FinanceResult<FinanceProofResult>> {
  return gated(() => financeActions.withdrawFinanceProof(input));
}

// ---- Proof link (finance.view) ----

/** "Lihat": a signed link made at the press (300 s). */
export async function getFinanceProofLink(input: FinanceProofLinkInput): Promise<FinanceResult<FinanceProofLink>> {
  return gated(() => financeActions.getFinanceProofLink(input));
}
