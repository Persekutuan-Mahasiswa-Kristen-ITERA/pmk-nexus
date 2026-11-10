import "server-only";
import { readMinuteDashboardCounts, readMinuteDetail, readMinuteList, readMinuteUnitOptions } from "@/lib/picore/minutes";
import {
  minuteListQuerySchema,
  type MinuteDashboardCounts,
  type MinuteDetail,
  type MinuteListQueryInput,
  type MinutePage,
  type MinuteResult,
  type MinuteUnitOption,
} from "../types";
import { requireMinutes } from "./access";
import { idInputSchema, parseInput, safely } from "./validation";

// Reads (contract section 12; minutes.view in any scope). Order in each: session + capability
// (server), then input validation, then ONE database function with the user's client, which filters
// to the caller's units and checks again. None throws. Permission is checked before validation so a
// caller without access learns nothing from the inputs.

/** Screen 1 list (F1). A unit outside the scope answers no rows (M7). */
export async function listMinutes(input?: MinuteListQueryInput): Promise<MinuteResult<MinutePage>> {
  return safely("listMinutes", async () => {
    const gate = await requireMinutes("canView");
    if (!gate.ok) return gate;
    const parsed = parseInput(minuteListQuerySchema, input ?? {});
    if (!parsed.ok) return parsed;
    return readMinuteList(gate.supabase, parsed.data.filters, parsed.data.page, parsed.data.pageSize);
  });
}

/** Unit filter (readableMinuteUnits) and the record form's select (recordableMinuteUnits). */
export async function listMinuteUnits(): Promise<MinuteResult<MinuteUnitOption[]>> {
  return safely("listMinuteUnits", async () => {
    const gate = await requireMinutes("canView");
    if (!gate.ok) return gate;
    return readMinuteUnitOptions(gate.supabase);
  });
}

/** Screen 2 detail. A malformed id (page address) answers not_found "minute". */
export async function getMinuteDetail(minuteId: string): Promise<MinuteResult<MinuteDetail>> {
  return safely("getMinuteDetail", async () => {
    const gate = await requireMinutes("canView");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(minuteId);
    if (!id.success) return { ok: false, error: { code: "not_found", entity: "minute" } };
    return readMinuteDetail(gate.supabase, id.data);
  });
}

/** Header tiles, the R9 period dates for the form, and the Dashboard card (counts only). */
export async function getMinuteDashboardCounts(): Promise<MinuteResult<MinuteDashboardCounts>> {
  return safely("getMinuteDashboardCounts", async () => {
    const gate = await requireMinutes("canView");
    if (!gate.ok) return gate;
    return readMinuteDashboardCounts(gate.supabase);
  });
}
