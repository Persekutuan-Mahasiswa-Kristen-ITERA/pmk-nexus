"use server";

import { getAccessState } from "@/lib/auth/session";
import * as fileActions from "@/modules/letters/server/file-actions";
import { listNumberingHistory } from "@/modules/letters/server/numbering";
import * as numberingActions from "@/modules/letters/server/numbering-actions";
import { listLetterYears } from "@/modules/letters/server/register";
import * as registerActions from "@/modules/letters/server/register-actions";
import * as requestActions from "@/modules/letters/server/request-actions";
import { getLetterQueueCounts, getMyRequestCaps } from "@/modules/letters/server/requests";
import type {
  LetterAddFilesInput,
  LetterError,
  LetterFileLink,
  LetterFileLinkInput,
  LetterFilesResult,
  LetterQueueCounts,
  LetterRegisterInput,
  LetterRegisterResult,
  LetterRequestCaps,
  LetterRequestCancelInput,
  LetterRequestCreateInput,
  LetterRequestIssueInput,
  LetterRequestProcessInput,
  LetterRequestRejectInput,
  LetterRequestTakeNumberInput,
  LetterRequestTransitionResult,
  LetterResult,
  LetterTakeNumberResult,
  LetterType,
  LetterUpdateInput,
  LetterUpdateResult,
  LetterVoidInput,
  LetterVoidResult,
  LetterWithdrawFileInput,
  NumberingFormatResult,
  NumberingFormatUpdateInput,
  NumberingHistoryPage,
  NumberingHistoryQueryInput,
  NumberingSetNextInput,
  NumberingSetNextResult,
} from "@/modules/letters/types";

// The Server Actions the Letters screens call (contract section 12 names; the UI imports them through
// src/modules/letters/ui/server-actions.ts). Thin on purpose: each one checks the session itself first
// (AR8, OPEN_QUESTIONS F2: layouts do not re-run on client navigation), then calls the module entry
// point, which checks the session and the capability again, validates with zod and lets the database
// check a third time. They return exactly what the module returns (LetterResult, never throws).

/** Session gate (AR8). Anyone who is not an active member stops here, before anything runs. */
async function sessionError(): Promise<LetterError | null> {
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
async function gated<T>(next: () => Promise<LetterResult<T>>): Promise<LetterResult<T>> {
  const denied = await sessionError();
  if (denied) return { ok: false, error: denied };
  return next();
}

// ---- Register (letters.manage) ----

export async function registerLetter(input: LetterRegisterInput): Promise<LetterResult<LetterRegisterResult>> {
  return gated(() => registerActions.registerLetter(input));
}

export async function updateLetter(input: LetterUpdateInput): Promise<LetterResult<LetterUpdateResult>> {
  return gated(() => registerActions.updateLetter(input));
}

export async function addLetterFiles(input: LetterAddFilesInput): Promise<LetterResult<LetterFilesResult>> {
  return gated(() => registerActions.addLetterFiles(input));
}

export async function withdrawLetterFile(input: LetterWithdrawFileInput): Promise<LetterResult<LetterFilesResult>> {
  return gated(() => registerActions.withdrawLetterFile(input));
}

export async function voidLetter(input: LetterVoidInput): Promise<LetterResult<LetterVoidResult>> {
  return gated(() => registerActions.voidLetter(input));
}

// ---- Requests ----

export async function submitRequest(input: LetterRequestCreateInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return gated(() => requestActions.submitRequest(input));
}

export async function cancelRequest(input: LetterRequestCancelInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return gated(() => requestActions.cancelRequest(input));
}

export async function processRequest(input: LetterRequestProcessInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return gated(() => requestActions.processRequest(input));
}

export async function takeRequestNumber(input: LetterRequestTakeNumberInput): Promise<LetterResult<LetterTakeNumberResult>> {
  return gated(() => requestActions.takeRequestNumber(input));
}

export async function issueRequest(input: LetterRequestIssueInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return gated(() => requestActions.issueRequest(input));
}

export async function rejectRequest(input: LetterRequestRejectInput): Promise<LetterResult<LetterRequestTransitionResult>> {
  return gated(() => requestActions.rejectRequest(input));
}

// ---- Numbering (System Admin) ----

export async function updateNumberingFormat(input: NumberingFormatUpdateInput): Promise<LetterResult<NumberingFormatResult>> {
  return gated(() => numberingActions.updateNumberingFormat(input));
}

export async function setNextNumber(input: NumberingSetNextInput): Promise<LetterResult<NumberingSetNextResult>> {
  return gated(() => numberingActions.setNextNumber(input));
}

// ---- Files ----

/** "Lihat" / "Unduh": a signed link made at the press (300 s). */
export async function getLetterFileLink(input: LetterFileLinkInput): Promise<LetterResult<LetterFileLink>> {
  return gated(() => fileActions.getLetterFileLink(input));
}

// ---- Reads a Client Component needs after the page loaded ----

/** "Tahun nomor" choices of a register tab (letters.view). */
export async function loadLetterYears(type: LetterType): Promise<LetterResult<number[]>> {
  return gated(() => listLetterYears(type));
}

/** The caller's own request caps (header box, cap alert above the request form). */
export async function loadMyRequestCaps(): Promise<LetterResult<LetterRequestCaps>> {
  return gated(() => getMyRequestCaps());
}

/** Antrean counts (letter_requests.view_all): "Tampilkan" options and "Antrean (n)". */
export async function loadLetterQueueCounts(): Promise<LetterResult<LetterQueueCounts>> {
  return gated(() => getLetterQueueCounts());
}

/** "Riwayat perubahan" of the numbering settings, one page (System Admin or letters.manage). */
export async function loadNumberingHistory(input: NumberingHistoryQueryInput = {}): Promise<LetterResult<NumberingHistoryPage>> {
  return gated(() => listNumberingHistory(input));
}
