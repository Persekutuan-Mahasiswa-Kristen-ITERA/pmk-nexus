"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import {
  cancelLetterRequest,
  createLetterRequest,
  issueLetterRequest,
  processLetterRequest,
  rejectLetterRequest,
  takeLetterRequestNumber,
} from "@/lib/picore/letters";
import {
  letterRequestCancelSchema,
  letterRequestCreateSchema,
  letterRequestIssueSchema,
  letterRequestProcessSchema,
  letterRequestRejectSchema,
  letterRequestTakeNumberSchema,
  type LetterRequestCancelInput,
  type LetterRequestCreateInput,
  type LetterRequestIssueInput,
  type LetterRequestProcessInput,
  type LetterRequestRejectInput,
  type LetterRequestTakeNumberInput,
  type LetterRequestTransitionResult,
  type LetterResult,
  type LetterTakeNumberResult,
} from "../types";
import { requireLetters, type LetterCapability, type LetterGate } from "./access";
import { dateInFuture, dateInPast, parseInput, safely } from "./validation";

// Server Actions of the request state machine (spec 4.2). Each: session check (getAccessState) and
// capability first, zod validation, the Jakarta date checks, then ONE database function with the
// user's client. The requester, the actor and the period always come from the session inside the
// database; L6 (never on one's own request) is enforced there. Never throws.

async function gate(capability: LetterCapability): Promise<LetterGate> {
  let state: AccessState;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" };
  }
  return requireLetters(capability, state);
}

/** "Ajukan Surat" (F5): any active member with an active period. Caps are checked by the database. */
export async function submitRequest(input: LetterRequestCreateInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return safely("submitRequest", async () => {
    const g = await gate("canViewOwnRequests");
    if (!g.ok) return g;
    if (!g.capabilities.canSubmitRequest) return { ok: false, error: { code: "no_active_period" } };
    const parsed = parseInput(letterRequestCreateSchema, input);
    if (!parsed.ok) return parsed;
    const past = dateInPast(parsed.data.neededBy, "neededBy");
    if (past) return { ok: false, error: past };
    return createLetterRequest(g.supabase, parsed.data);
  });
}

/** "Batalkan permohonan" (F7.3): the requester, while Diajukan (the database decides). */
export async function cancelRequest(input: LetterRequestCancelInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return safely("cancelRequest", async () => {
    const g = await gate("canViewOwnRequests");
    if (!g.ok) return g;
    const parsed = parseInput(letterRequestCancelSchema, input);
    if (!parsed.ok) return parsed;
    return cancelLetterRequest(g.supabase, parsed.data);
  });
}

/** "Proses permohonan" (F6.3): Diajukan -> Diproses. */
export async function processRequest(input: LetterRequestProcessInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return safely("processRequest", async () => {
    const g = await gate("canProcessRequests");
    if (!g.ok) return g;
    const parsed = parseInput(letterRequestProcessSchema, input);
    if (!parsed.ok) return parsed;
    return processLetterRequest(g.supabase, parsed.data);
  });
}

/** "Ambil nomor" (F6.4): the next SK number and the linked register row; status stays Diproses. */
export async function takeRequestNumber(input: LetterRequestTakeNumberInput): Promise<LetterResult<LetterTakeNumberResult>> {
  return safely("takeRequestNumber", async () => {
    const g = await gate("canProcessRequests");
    if (!g.ok) return g;
    const parsed = parseInput(letterRequestTakeNumberSchema, input);
    if (!parsed.ok) return parsed;
    return takeLetterRequestNumber(g.supabase, parsed.data);
  });
}

/** "Terbitkan Surat" (F6.5): sends letterVersion as p_letter_version. */
export async function issueRequest(input: LetterRequestIssueInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return safely("issueRequest", async () => {
    const g = await gate("canProcessRequests");
    if (!g.ok) return g;
    const parsed = parseInput(letterRequestIssueSchema, input);
    if (!parsed.ok) return parsed;
    const future = dateInFuture(parsed.data.letterDate, "letterDate");
    if (future) return { ok: false, error: future };
    return issueLetterRequest(g.supabase, parsed.data);
  });
}

/** "Tolak permohonan" (F6.6): note required; a taken number is voided in the same transaction. */
export async function rejectRequest(input: LetterRequestRejectInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return safely("rejectRequest", async () => {
    const g = await gate("canProcessRequests");
    if (!g.ok) return g;
    const parsed = parseInput(letterRequestRejectSchema, input);
    if (!parsed.ok) return parsed;
    return rejectLetterRequest(g.supabase, parsed.data);
  });
}
