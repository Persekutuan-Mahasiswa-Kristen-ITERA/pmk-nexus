import Link from "next/link";
import { Plus } from "lucide-react";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { buttonClass } from "@/components/ui/nx-button";
import {
  FINANCE_COPY,
  FINANCE_PARAMS,
  FINANCE_ROUTES,
  isDefaultFinanceFilters,
  type FinanceCapabilities,
  type FinanceEntryPage,
  type FinancePeriodOption,
  type FinanceSummary,
} from "../types";
import { EntryList } from "./entry-list";
import { FinanceExport } from "./finance-export";
import { FinanceHeader } from "./finance-header";
import { ListFilters } from "./list-filters";
import { listHref, listParams, type ListUrlState } from "./routes";
import { ListColumn, UnavailableNotice } from "./states";

export type FinanceListResult =
  | { kind: "ok"; page: FinanceEntryPage }
  | { kind: "search_too_long" }
  | { kind: "invalid_range" }
  | { kind: "unavailable" };

const L = FINANCE_COPY.list;

/**
 * Finance, the list (spec 7 screen 1, F1) for finance.view holders. "Catat transaksi" needs finance.manage
 * and an active period AND a period that is the active one; "Ekspor" needs finance.export and at least one
 * row. The tiles show the whole selected period; the list below follows the filters (A-FN3).
 */
export function FinanceListScreen({
  result,
  values,
  summary,
  periods,
  capabilities,
  periodLabel,
  searchError,
  rangeError,
}: {
  result: FinanceListResult;
  values: ListUrlState;
  summary: FinanceSummary | null;
  periods: FinancePeriodOption[];
  capabilities: FinanceCapabilities;
  periodLabel: string | null;
  searchError: string | null;
  rangeError: string | null;
}) {
  const writable = summary === null ? true : summary.isActivePeriod;
  return (
    <ListNavigationProvider>
      <ListColumn>
        <FinanceHeader summary={summary} periods={periods} selectedPeriod={values.period} periodLabel={periodLabel} capabilities={capabilities} />

        {capabilities.canRecord && writable ? (
          <Link href={FINANCE_ROUTES.record} className={buttonClass("primary", "nx-press nx-rise nx-delay-2 md:w-auto md:self-start")}>
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            {FINANCE_COPY.page.record}
          </Link>
        ) : null}

        <ListFilters
          values={values}
          searchError={searchError}
          rangeError={rangeError}
          exportSlot={
            result.kind === "ok" && capabilities.canExport && result.page.total > 0 ? (
              <FinanceExport filters={result.page.filters} periodLabel={summary?.periodLabel ?? periodLabel} />
            ) : null
          }
        />

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : result.kind === "search_too_long" || result.kind === "invalid_range" ? null : (
          <ListBody page={result.page} values={values} canRecord={capabilities.canRecord && writable} />
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

function ListBody({ page, values, canRecord }: { page: FinanceEntryPage; values: ListUrlState; canRecord: boolean }) {
  if (page.total === 0 || page.rows.length === 0) {
    return (
      <PendingRegion>
        <EmptyState filtered={!isDefaultFinanceFilters(page.filters)} canRecord={canRecord} />
      </PendingRegion>
    );
  }
  return (
    <PendingRegion className="flex flex-col gap-4">
      <p role="status" className="text-body-sm text-ink-body tabular-nums">
        {FINANCE_COPY.filters.resultCount.replace("{n}", String(page.total))}
      </p>
      <EntryList rows={page.rows} caption={`${FINANCE_COPY.page.title}, halaman ${page.page} dari ${page.pageCount}`} />
      <div className="flex justify-center pb-4">
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          basePath={FINANCE_ROUTES.list}
          params={listParams(values)}
          pageParam={FINANCE_PARAMS.page}
          label={`Halaman daftar ${FINANCE_COPY.page.title.toLowerCase()}`}
        />
      </div>
    </PendingRegion>
  );
}

/** Empty (first use or nothing in the period) and no match (spec 7 screen 1, states table). */
function EmptyState({ filtered, canRecord }: { filtered: boolean; canRecord: boolean }) {
  const card = "rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1";
  if (filtered) {
    return (
      <div className={card}>
        <p role="status" className="text-body-md text-ink">
          {L.noMatch}
        </p>
        <div className="mt-2 -ml-2 flex flex-wrap gap-x-2">
          <ListLink href={listHref()} className={buttonClass("text")}>
            {FINANCE_COPY.filters.reset}
          </ListLink>
        </div>
      </div>
    );
  }
  return (
    <div className={card}>
      <p role="status" className="text-body-md font-semibold text-ink">
        {L.empty}
      </p>
      {canRecord ? <p className="mt-1 text-body-md text-ink-body">{L.emptyManager}</p> : null}
    </div>
  );
}
