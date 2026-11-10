"use server";

import { getAccessState } from "@/lib/auth/session";
import * as minuteActions from "@/modules/minutes/server/actions";
import * as fileActions from "@/modules/minutes/server/file-actions";
import { listMinuteUnits } from "@/modules/minutes/server/minutes";
import type {
  MinuteAddFilesInput,
  MinuteError,
  MinuteFileLink,
  MinuteFileLinkInput,
  MinuteFilesResult,
  MinuteRecordInput,
  MinuteRecordResult,
  MinuteResult,
  MinuteUnitOption,
  MinuteUpdateInput,
  MinuteUpdateResult,
  MinuteVoidInput,
  MinuteVoidResult,
  MinuteWithdrawFileInput,
} from "@/modules/minutes/types";

// The Server Actions the Meeting Minutes screens call (contract section 12 names). Thin on purpose:
// each one checks the session itself first (AR8, static rule AUTH-42: layouts do not re-run on client
// navigation), then calls the module entry point, which checks the session and the capability again
// (with unit scopes), validates with zod and lets the database check a third time. They return exactly
// what the module returns (MinuteResult, never throws).

/** Session gate (AR8). Anyone who is not an active member stops here, before anything runs. */
async function sessionError(): Promise<MinuteError | null> {
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
async function gated<T>(next: () => Promise<MinuteResult<T>>): Promise<MinuteResult<T>> {
  const denied = await sessionError();
  if (denied) return { ok: false, error: denied };
  return next();
}

// ---- Writes (minutes.manage) ----

export async function recordMinute(input: MinuteRecordInput): Promise<MinuteResult<MinuteRecordResult>> {
  return gated(() => minuteActions.recordMinute(input));
}

export async function updateMinute(input: MinuteUpdateInput): Promise<MinuteResult<MinuteUpdateResult>> {
  return gated(() => minuteActions.updateMinute(input));
}

export async function addMinuteFiles(input: MinuteAddFilesInput): Promise<MinuteResult<MinuteFilesResult>> {
  return gated(() => minuteActions.addMinuteFiles(input));
}

export async function withdrawMinuteFile(input: MinuteWithdrawFileInput): Promise<MinuteResult<MinuteFilesResult>> {
  return gated(() => minuteActions.withdrawMinuteFile(input));
}

export async function voidMinute(input: MinuteVoidInput): Promise<MinuteResult<MinuteVoidResult>> {
  return gated(() => minuteActions.voidMinute(input));
}

// ---- Files ----

/** "Lihat": a signed link made at the press (300 s). */
export async function getMinuteFileLink(input: MinuteFileLinkInput): Promise<MinuteResult<MinuteFileLink>> {
  return gated(() => fileActions.getMinuteFileLink(input));
}

// ---- Reads a Client Component needs after the page loaded ----

/** Unit options (filter and record select) for a Client Component (minutes.view). */
export async function loadMinuteUnits(): Promise<MinuteResult<MinuteUnitOption[]>> {
  return gated(() => listMinuteUnits());
}
