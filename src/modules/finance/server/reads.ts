import "server-only";
import { readFinanceEntries, readFinanceEntryDetail, readFinancePeriods, readFinanceSummary } from "@/lib/picore/finance";
import {
  financeListQuerySchema,
  financeSummaryQuerySchema,
  type FinanceEntryDetail,
  type FinanceEntryPage,
  type FinanceListQueryInput,
  type FinancePeriodOption,
  type FinanceResult,
  type FinanceSummary,
  type FinanceSummaryQueryInput,
} from "../types";
import { requireFinance } from "./access";
import { idInputSchema, parseInput, safely } from "./validation";

// Reads (contract section 13; finance.view). Order in each: session + capability (server), then input
// validation, then ONE database function with the user's client, which checks again. None throws.
// Permission is checked before validation so a caller without access learns nothing from the inputs.

/** The "Periode" select: periods that have entries, plus the active one. */
export async function listFinancePeriods(): Promise<FinanceResult<FinancePeriodOption[]>> {
  return safely("listFinancePeriods", async () => {
    const gate = await requireFinance("canView");
    if (!gate.ok) return gate;
    return readFinancePeriods(gate.supabase);
  });
}

/**
 * Header tiles and hints of the selected period, the opening form's previous-closing hint, and the
 * Dashboard card. No input = the active period (no active period: no_active_period).
 */
export async function getFinanceSummary(input?: FinanceSummaryQueryInput): Promise<FinanceResult<FinanceSummary>> {
  return safely("getFinanceSummary", async () => {
    const gate = await requireFinance("canView");
    if (!gate.ok) return gate;
    const parsed = parseInput(financeSummaryQuerySchema, input ?? {});
    if (!parsed.ok) return parsed;
    return readFinanceSummary(gate.supabase, parsed.data.periodId);
  });
}

/** Screen 1 list (F1). */
export async function listFinanceEntries(input?: FinanceListQueryInput): Promise<FinanceResult<FinanceEntryPage>> {
  return safely("listFinanceEntries", async () => {
    const gate = await requireFinance("canView");
    if (!gate.ok) return gate;
    const parsed = parseInput(financeListQuerySchema, input ?? {});
    if (!parsed.ok) return parsed;
    return readFinanceEntries(gate.supabase, parsed.data.filters, parsed.data.page, parsed.data.pageSize);
  });
}

/** Screen 2 detail. A malformed id (page address) answers not_found "entry". `proofPaths` never leave. */
export async function getFinanceEntryDetail(entryId: string): Promise<FinanceResult<FinanceEntryDetail>> {
  return safely("getFinanceEntryDetail", async () => {
    const gate = await requireFinance("canView");
    if (!gate.ok) return gate;
    const id = idInputSchema.safeParse(entryId);
    if (!id.success) return { ok: false, error: { code: "not_found", entity: "entry" } };
    return readFinanceEntryDetail(gate.supabase, id.data);
  });
}
