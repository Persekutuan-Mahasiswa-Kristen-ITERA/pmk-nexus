"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import type { AccessState } from "@/lib/auth/types";
import { addMinuteFileRows, recordMinuteRow, updateMinuteRow, voidMinuteRow, withdrawMinuteFileRow } from "@/lib/picore/minutes";
import {
  minuteAddFilesSchema,
  minuteRecordSchema,
  minuteScopeIncludes,
  minuteUpdateSchema,
  minuteVoidSchema,
  minuteWithdrawFileSchema,
  type MinuteAddFilesInput,
  type MinuteFilesResult,
  type MinuteRecordInput,
  type MinuteRecordResult,
  type MinuteResult,
  type MinuteUpdateInput,
  type MinuteUpdateResult,
  type MinuteVoidInput,
  type MinuteVoidResult,
  type MinuteWithdrawFileInput,
} from "../types";
import { requireMinutes, type MinuteGate } from "./access";
import { meetingDateInFuture, parseInput, safely } from "./validation";

// Server Actions for minutes.manage (secretaries; BPH every unit, department/bureau their own unit):
// record, edit, add or withdraw attachments, void. Each: session check (getAccessState) + minutes.manage
// in some scope first, zod validation, the Jakarta date check, then ONE database function with the
// user's client. The database checks the right ON THE MINUTE'S UNIT, the active period, the version and
// every business rule again, and writes a history row. The actor, the period and the creator are never
// inputs (MN-09). Never throws.

async function gate(): Promise<MinuteGate> {
  let state: AccessState;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" };
  }
  return requireMinutes("canManage", state);
}

/** "Simpan Notulensi" (F3). Needs an active period and minutes.manage on the chosen unit. */
export async function recordMinute(input: MinuteRecordInput): Promise<MinuteResult<MinuteRecordResult>> {
  return safely("recordMinute", async () => {
    const g = await gate();
    if (!g.ok) return g;
    if (!g.capabilities.hasActivePeriod) return { ok: false, error: { code: "no_active_period" } };
    const parsed = parseInput(minuteRecordSchema, input);
    if (!parsed.ok) return parsed;
    const data = parsed.data;
    const future = meetingDateInFuture(data.meetingDate);
    if (future) return { ok: false, error: future };
    // The unit comes from the form: never trusted. The database checks scope and kind again.
    if (!minuteScopeIncludes(g.capabilities.manage, data.unitId)) return { ok: false, error: { code: "unit_not_allowed" } };
    return recordMinuteRow(g.supabase, data);
  });
}

/** "Simpan Perubahan" (F4). An unchanged form answers changed: false. */
export async function updateMinute(input: MinuteUpdateInput): Promise<MinuteResult<MinuteUpdateResult>> {
  return safely("updateMinute", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(minuteUpdateSchema, input);
    if (!parsed.ok) return parsed;
    const future = meetingDateInFuture(parsed.data.meetingDate);
    if (future) return { ok: false, error: future };
    return updateMinuteRow(g.supabase, parsed.data);
  });
}

/** "Tambah lampiran" (F5): 1..filesRoom just-uploaded files. */
export async function addMinuteFiles(input: MinuteAddFilesInput): Promise<MinuteResult<MinuteFilesResult>> {
  return safely("addMinuteFiles", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(minuteAddFilesSchema, input);
    if (!parsed.ok) return parsed;
    return addMinuteFileRows(g.supabase, parsed.data);
  });
}

/** "Tarik berkas" (F5). `version` is the minute's version. */
export async function withdrawMinuteFile(input: MinuteWithdrawFileInput): Promise<MinuteResult<MinuteFilesResult>> {
  return safely("withdrawMinuteFile", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(minuteWithdrawFileSchema, input);
    if (!parsed.ok) return parsed;
    return withdrawMinuteFileRow(g.supabase, parsed.data);
  });
}

/** "Batalkan notulensi" (F5). Never restored. */
export async function voidMinute(input: MinuteVoidInput): Promise<MinuteResult<MinuteVoidResult>> {
  return safely("voidMinute", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(minuteVoidSchema, input);
    if (!parsed.ok) return parsed;
    return voidMinuteRow(g.supabase, parsed.data);
  });
}
