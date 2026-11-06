import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import type { MemberListPage, MemberUnitOption } from "../types";
import { COPY, formatCount, rangeText } from "./copy";
import { ListLink, ListNavigationProvider, PendingRegion, RetryButton } from "./list-navigation";
import { isDefaultFilter, memberListHref, MEMBER_LIST_PATH } from "./list-url";
import { MemberExport } from "./member-export";
import { MemberFilters, type MemberFilterValues } from "./member-filters";
import { MemberPagination } from "./member-pagination";
import { MemberTable } from "./member-table";

const SEARCH_ERROR_ID = "member-search-error";

/** What the page could load. `unavailable` and `invalid` keep the person on the page with one way out. */
export type MemberListResult =
  | { kind: "ok"; list: MemberListPage; unitOptions: MemberUnitOption[] }
  | { kind: "invalid"; field: "search" | "other"; unitOptions: MemberUnitOption[] }
  | { kind: "unavailable" };

/**
 * Data Anggota (Stitch screen 03, spec F1-F6). Server component: the data arrives as props from the
 * page, which ran the session and permission checks itself.
 */
export function MemberListScreen({
  result,
  filterValues,
  canExport,
  periodLabel,
}: {
  result: MemberListResult;
  filterValues: MemberFilterValues;
  canExport: boolean;
  periodLabel: string | null;
}) {
  const total = result.kind === "ok" ? result.list.total : null;

  return (
    <ListNavigationProvider>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 md:max-w-3xl">
        <div className="flex items-end justify-between gap-4 border-b border-surface-line pb-3">
          <div className="min-w-0">
            <h1 className="font-heading text-display-lg text-title">Data Anggota</h1>
            {periodLabel ? <p className="text-body-md text-ink-body">Periode {periodLabel}</p> : null}
          </div>
          {total !== null ? (
            <p className="shrink-0 rounded-lg border border-surface-line bg-surface px-3 py-1.5 text-right">
              <span className="block text-body-sm text-ink-meta">Hasil</span>
              <span className="text-numeric-metric text-walnut tabular-nums">{formatCount(total)}</span>{" "}
              <span className="text-body-sm text-ink-body">anggota</span>
            </p>
          ) : null}
        </div>

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : (
          <>
            <MemberFilters
              values={filterValues}
              unitOptions={result.unitOptions}
              searchInvalid={result.kind === "invalid" && result.field === "search"}
              errorId={SEARCH_ERROR_ID}
            />
            {result.kind === "invalid" ? (
              <InvalidNotice field={result.field} filterValues={filterValues} />
            ) : (
              <ListBody list={result.list} canExport={canExport} />
            )}
          </>
        )}
      </div>
    </ListNavigationProvider>
  );
}

function ListBody({ list, canExport }: { list: MemberListPage; canExport: boolean }) {
  const filters = {
    search: list.filters.search,
    unitId: list.filters.unitId,
    status: list.filters.status,
  };

  if (list.total === 0 || list.rows.length === 0) {
    return (
      <PendingRegion>
        <EmptyNotice filters={filters} />
      </PendingRegion>
    );
  }

  const from = list.rows[0].rowNo;
  const to = list.rows[list.rows.length - 1].rowNo;

  return (
    <div className="flex flex-col gap-3">
      {canExport ? <MemberExport filters={list.filters} /> : null}
      <PendingRegion className="flex flex-col gap-4">
        <MemberTable rows={list.rows} caption={`Daftar anggota, halaman ${list.page} dari ${list.pageCount}`} />
        <div className="flex flex-col items-center gap-2 pb-4">
          <MemberPagination page={list.page} pageCount={list.pageCount} filters={filters} />
          <p role="status" className="text-body-sm text-ink-body tabular-nums">
            {rangeText(from, to, list.total)}
          </p>
        </div>
      </PendingRegion>
    </div>
  );
}

/** No rows. With a search: offer to drop just the search; with filters: reset everything (spec F6). */
function EmptyNotice({ filters }: { filters: { search: string | null; unitId: string | null; status: MemberListPage["filters"]["status"] } }) {
  const atDefaults = isDefaultFilter(filters);
  return (
    <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
      <p role="status" className="text-body-md text-ink">
        {atDefaults ? COPY.noActiveMembers : COPY.noMatch}
      </p>
      {atDefaults ? null : (
        <div className="mt-3 flex flex-wrap gap-x-2">
          {filters.search ? (
            <ListLink href={memberListHref({ ...filters, search: null })} className={buttonClass("text", "-ml-2")}>
              Hapus pencarian
            </ListLink>
          ) : null}
          <ListLink href={MEMBER_LIST_PATH} className={buttonClass("text", filters.search ? undefined : "-ml-2")}>
            Reset
          </ListLink>
        </div>
      )}
    </div>
  );
}

/** The server refused a value from the address (for example a search longer than 120 characters). */
function InvalidNotice({ field, filterValues }: { field: "search" | "other"; filterValues: MemberFilterValues }) {
  const isSearch = field === "search";
  return (
    <div className="flex flex-col items-start gap-2">
      <AlertMessage id={SEARCH_ERROR_ID} role="alert" tone="error" className="w-full">
        {isSearch ? COPY.searchTooLong : COPY.filterInvalid}
      </AlertMessage>
      <ListLink
        href={isSearch ? memberListHref({ unitId: filterValues.unitId, status: filterValues.status }) : MEMBER_LIST_PATH}
        className={buttonClass("text", "-ml-2")}
      >
        {isSearch ? "Hapus pencarian" : "Reset"}
      </ListLink>
    </div>
  );
}

/** PI-CORE or the database did not answer. Fail closed, stay signed in, one action (spec F6, AR10). */
function UnavailableNotice() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
      <AlertMessage role="alert" tone="warning">
        {COPY.unavailable}
      </AlertMessage>
      <RetryButton className={buttonClass("outline")} />
    </div>
  );
}
