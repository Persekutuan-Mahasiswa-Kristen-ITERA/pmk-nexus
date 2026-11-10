import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { getFinanceSummary, listFinanceEntries, listFinancePeriods } from "@/modules/finance/server/reads";
import {
  FINANCE_COPY,
  financeCapabilities,
  financeErrorMessage,
  type FinancePeriodOption,
  type FinanceSummary,
} from "@/modules/finance/types";
import { FinanceListScreen, type FinanceListResult } from "@/modules/finance/ui/list-screen";
import { pageFailure } from "@/modules/finance/ui/page-errors";
import { listHref, readListParams, toListQuery, type SearchParams } from "@/modules/finance/ui/routes";
import { financePageTitle } from "./page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await financePageTitle(FINANCE_COPY.page.title) };
}

/**
 * Finance (spec 7 screen 1). finance.view; without an active period the keys match nothing (R11) and the
 * Forbidden screen says why. The list, the period choices and the header tiles are read side by side; the
 * period select is a hint, so a failed read only hides it. A summary that fails shows NO tiles (never a
 * stale or partial balance, spec 3 states) and the list says "Terjadi gangguan" if it fails itself.
 */
export default async function FinanceListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = financeCapabilities(state);
  if (!capabilities.canView) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const values = readListParams(await searchParams);
  const [list, summary, periods] = await Promise.all([
    listFinanceEntries(toListQuery(values)),
    getFinanceSummary({ periodId: values.period }),
    readPeriods(),
  ]);

  let result: FinanceListResult;
  let searchError: string | null = null;
  let rangeError: string | null = null;
  if (list.ok) {
    result = { kind: "ok", page: list.data };
  } else {
    const failure = pageFailure(list.error, listHref(values));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (list.error.code === "invalid_input" && list.error.field === "search") {
      result = { kind: "search_too_long" };
      searchError = financeErrorMessage(list.error, "read");
    } else if (list.error.code === "invalid_dates") {
      result = { kind: "invalid_range" };
      rangeError = financeErrorMessage(list.error, "read");
    } else {
      result = { kind: "unavailable" };
    }
  }

  // The summary stands for the whole period. If it cannot be read, no tile is better than a wrong one.
  let shown: FinanceSummary | null = null;
  if (summary.ok) shown = summary.data;
  else if (summary.error.code === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  return (
    <FinanceListScreen
      result={result}
      values={values}
      summary={shown}
      periods={periods}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      searchError={searchError}
      rangeError={rangeError}
    />
  );
}

/** Periods that have data, active first. A failed read hides the select. */
async function readPeriods(): Promise<FinancePeriodOption[]> {
  try {
    const result = await listFinancePeriods();
    return result.ok ? result.data : [];
  } catch {
    return [];
  }
}
