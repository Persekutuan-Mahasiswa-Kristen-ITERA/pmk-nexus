import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import type { CatalogPage, InventoryCapabilities, ListEntry } from "../types";
import { CatalogFilters } from "./catalog-filters";
import { CatalogTable } from "./catalog-table";
import { COPY, rangeText } from "./copy";
import { formatCount } from "./format";
import { InventoryHeader, ListColumn } from "./inventory-header";
import { CatalogExport } from "./inventory-export";
import {
  catalogHref,
  catalogParams,
  INVENTORY_PARAMS,
  INVENTORY_PATH,
  isDefaultCatalog,
  requestFormHref,
  type CatalogUrlState,
} from "./routes";
import { UnavailableNotice } from "./states";

const SEARCH_ERROR_ID = "catalog-search-error";

export type CatalogResult =
  | { kind: "ok"; list: CatalogPage; categories: ListEntry[]; locations: ListEntry[] }
  | { kind: "search_too_long"; categories: ListEntry[]; locations: ListEntry[] }
  | { kind: "unavailable" };

/**
 * Katalog (design screen 2): find an item, see whether enough of it is in good condition, start a
 * request. Server component; the page checked the session and inventory.view itself.
 */
export function CatalogScreen({
  result,
  values,
  capabilities,
  periodLabel,
  today,
  dateError,
  managerEmptyAction = null,
}: {
  result: CatalogResult;
  values: CatalogUrlState;
  capabilities: InventoryCapabilities;
  periodLabel: string | null;
  today: string;
  dateError: string | null;
  /**
   * Part B slot: "Tambah barang" for inventory.manage holders in the empty catalog (design 5.3).
   * Until Kelola Barang ships it stays null and everyone reads the member line.
   */
  managerEmptyAction?: ReactNode;
}) {
  const total = result.kind === "ok" ? result.list.total : null;

  return (
    <ListNavigationProvider>
      <ListColumn>
        <InventoryHeader
          capabilities={capabilities}
          periodLabel={periodLabel}
          current="catalog"
          countBox={total !== null ? { label: "Hasil", value: formatCount(total), unit: "barang" } : null}
        />

        {capabilities.canSubmitRequest ? (
          // The one focal point of the screen (design 5.2). Absent without an active period.
          <Link href={requestFormHref()} className={buttonClass("primary")}>
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            Ajukan Peminjaman
          </Link>
        ) : null}

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : (
          <>
            <CatalogFilters
              values={values}
              categories={result.categories}
              locations={result.locations}
              today={today}
              searchError={result.kind === "search_too_long" ? COPY.searchTooLong : null}
              dateError={dateError}
              exportSlot={
                result.kind === "ok" && capabilities.canExportInventory && result.list.total > 0 ? (
                  <CatalogExport filters={result.list.filters} />
                ) : null
              }
            />
            {result.kind === "search_too_long" ? (
              <SearchTooLong values={values} />
            ) : (
              <CatalogBody
                list={result.list}
                values={values}
                emptyAction={managerEmptyAction}
                withDates={Boolean(result.list.filters.availableFrom && result.list.filters.availableTo)}
              />
            )}
          </>
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

function CatalogBody({
  list,
  values,
  emptyAction,
  withDates,
}: {
  list: CatalogPage;
  values: CatalogUrlState;
  emptyAction: ReactNode;
  withDates: boolean;
}) {
  if (list.total === 0 || list.rows.length === 0) {
    return (
      <PendingRegion>
        <EmptyNotice values={values} emptyAction={emptyAction} />
      </PendingRegion>
    );
  }

  const params = catalogParams(values);
  const backParams = list.page > 1 ? { ...params, [INVENTORY_PARAMS.page]: String(list.page) } : params;
  const from = list.rows[0].rowNo;
  const to = list.rows[list.rows.length - 1].rowNo;

  return (
    <PendingRegion className="flex flex-col gap-4">
      <CatalogTable
        rows={list.rows}
        caption={`Daftar barang, halaman ${list.page} dari ${list.pageCount}`}
        backParams={backParams}
        withDates={withDates}
      />
      <div className="flex flex-col items-center gap-2 pb-4">
        <Pagination
          page={list.page}
          pageCount={list.pageCount}
          basePath={INVENTORY_PATH}
          params={params}
          pageParam={INVENTORY_PARAMS.page}
          label="Halaman daftar barang"
        />
        <p role="status" className="text-body-sm text-ink-body tabular-nums">
          {rangeText(from, to, list.total, "barang", formatCount)}
        </p>
      </div>
    </PendingRegion>
  );
}

/** Empty catalog names the cause and the next step; no match offers to drop the search or reset. */
function EmptyNotice({ values, emptyAction }: { values: CatalogUrlState; emptyAction: ReactNode }) {
  if (isDefaultCatalog(values)) {
    return (
      <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
        <p role="status" className="text-body-md font-semibold text-ink">
          {COPY.catalogEmpty}
        </p>
        {emptyAction ? <div className="mt-4">{emptyAction}</div> : <p className="mt-1 text-body-md text-ink-body">{COPY.catalogEmptyMember}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
      <p role="status" className="text-body-md text-ink">
        {COPY.noMatch}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-2">
        {values.search.trim() ? (
          <ListLink href={catalogHref({ ...values, search: "" })} className={buttonClass("text", "-ml-2")}>
            Hapus pencarian
          </ListLink>
        ) : null}
        <ListLink href={INVENTORY_PATH} className={buttonClass("text", values.search.trim() ? undefined : "-ml-2")}>
          Reset
        </ListLink>
      </div>
    </div>
  );
}

function SearchTooLong({ values }: { values: CatalogUrlState }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <AlertMessage id={SEARCH_ERROR_ID} role="alert" tone="error" className="w-full">
        {COPY.searchTooLong}
      </AlertMessage>
      <ListLink href={catalogHref({ ...values, search: "" })} className={buttonClass("text", "-ml-2")}>
        Hapus pencarian
      </ListLink>
    </div>
  );
}
