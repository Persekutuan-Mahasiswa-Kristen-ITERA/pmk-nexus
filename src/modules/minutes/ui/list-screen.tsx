import Link from "next/link";
import { Plus } from "lucide-react";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { buttonClass } from "@/components/ui/nx-button";
import {
  isDefaultMinuteFilters,
  MINUTE_COPY,
  MINUTE_ERROR_COPY_VARIANTS,
  MINUTE_PARAMS,
  MINUTE_ROUTES,
  type MinuteCapabilities,
  type MinuteDashboardCounts,
  type MinutePage,
  type MinuteUnitOption,
} from "../types";
import { ListFilters } from "./list-filters";
import { MinutesExport } from "./minutes-export";
import { MinutesHeader } from "./minutes-header";
import { MinutesList } from "./minutes-list";
import { listHref, listParams, type ListUrlState } from "./routes";
import { ListColumn, UnavailableNotice } from "./states";

export type MinutesListResult = { kind: "ok"; page: MinutePage } | { kind: "search_too_long" } | { kind: "unavailable" };

const L = MINUTE_COPY.list;

/**
 * Notulensi Rapat, the list (spec 7 screen 1, F1) for minutes.view holders. "Catat notulensi" needs
 * minutes.manage and an active period; "Ekspor" needs minutes.export and at least one row. Rows outside
 * the person's units never arrive (the database filters them).
 */
export function MinutesListScreen({
  result,
  values,
  units,
  capabilities,
  periodLabel,
  counts,
}: {
  result: MinutesListResult;
  values: ListUrlState;
  units: MinuteUnitOption[];
  capabilities: MinuteCapabilities;
  periodLabel: string | null;
  counts: MinuteDashboardCounts | null;
}) {
  return (
    <ListNavigationProvider>
      <ListColumn>
        <MinutesHeader
          periodLabel={periodLabel}
          counts={counts}
          showNoPeriodBanner={capabilities.canManage && !capabilities.hasActivePeriod}
        />

        {capabilities.canRecord ? (
          <Link href={MINUTE_ROUTES.record} className={buttonClass("primary", "nx-press nx-rise nx-delay-2 md:w-auto md:self-start")}>
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            {L.recordButton}
          </Link>
        ) : null}

        <ListFilters
          values={values}
          units={units}
          searchError={result.kind === "search_too_long" ? MINUTE_ERROR_COPY_VARIANTS.invalidInput.search : null}
          exportSlot={
            result.kind === "ok" && capabilities.canExport && result.page.total > 0 ? (
              <MinutesExport target={{ kind: "list", filters: result.page.filters }} />
            ) : null
          }
        />

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : result.kind === "search_too_long" ? null : (
          <ListBody page={result.page} values={values} canRecord={capabilities.canRecord} />
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

function ListBody({ page, values, canRecord }: { page: MinutePage; values: ListUrlState; canRecord: boolean }) {
  if (page.total === 0 || page.rows.length === 0) {
    return (
      <PendingRegion>
        <EmptyState filtered={!isDefaultMinuteFilters(page.filters)} canRecord={canRecord} />
      </PendingRegion>
    );
  }
  return (
    <PendingRegion className="flex flex-col gap-4">
      <MinutesList rows={page.rows} caption={`${MINUTE_COPY.moduleTitle}, halaman ${page.page} dari ${page.pageCount}`} />
      <div className="flex justify-center pb-4">
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          basePath={MINUTE_ROUTES.list}
          params={listParams(values)}
          pageParam={MINUTE_PARAMS.page}
          label={`Halaman daftar ${MINUTE_COPY.moduleTitle.toLowerCase()}`}
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
            {L.filterReset}
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
