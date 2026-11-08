import Link from "next/link";
import { Plus } from "lucide-react";
import { FilterTagLinks } from "@/components/list/filter-tags";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { UNIT_STATUS_LABEL, type CatalogPage, type CatalogStatusFilter, type InventoryCapabilities } from "../types";
import type { CatalogResult } from "./catalog-screen";
import { CatalogFilters } from "./catalog-filters";
import { CatalogTable } from "./catalog-table";
import { COPY, rangeText, STAFF_COPY } from "./copy";
import { formatCount } from "./format";
import { InventoryHeader, ListColumn } from "./inventory-header";
import { CatalogExport } from "./inventory-export";
import {
  catalogHref,
  catalogParams,
  INVENTORY_PARAMS,
  isDefaultCatalog,
  ITEM_NEW_PATH,
  LISTS_PATH,
  MANAGE_PATH,
  manageExtra,
  type CatalogUrlState,
} from "./routes";
import { UnavailableNotice } from "./states";

const STATUS_OPTIONS: { key: CatalogStatusFilter; label: string }[] = [
  { key: "active", label: UNIT_STATUS_LABEL.active },
  { key: "archived", label: UNIT_STATUS_LABEL.archived },
  { key: "all", label: "Semua" },
];

/** "Tambah barang": the manager's way out of an empty catalog (design 5.3) and the Kelola focal point. */
export function ManagerEmptyAction() {
  return (
    <Link href={ITEM_NEW_PATH} className={buttonClass("primary")}>
      <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
      Tambah barang
    </Link>
  );
}

/**
 * Kelola Barang (design 4.3, screens 4 and 5): the manager's catalog. Same search and filters as
 * Katalog, plus the status filter (Aktif / Nonaktif / Semua, spec F2.7) that only inventory.manage may
 * use (the database refuses it for anyone else). Rows open the item detail, where "Ubah barang" is.
 */
export function ManageScreen({
  result,
  values,
  status,
  capabilities,
  periodLabel,
  today,
  queueActionCount,
}: {
  result: CatalogResult;
  values: CatalogUrlState;
  status: CatalogStatusFilter;
  capabilities: InventoryCapabilities;
  periodLabel: string | null;
  today: string;
  queueActionCount: number | null;
}) {
  const total = result.kind === "ok" ? result.list.total : null;
  const extra = manageExtra(status);
  const listsEmpty = result.kind !== "unavailable" && result.categories.length === 0 && result.locations.length === 0;

  return (
    <ListNavigationProvider>
      <ListColumn>
        <InventoryHeader
          capabilities={capabilities}
          periodLabel={periodLabel}
          current="manage"
          queueActionCount={queueActionCount}
          countBox={total !== null ? { label: "Hasil", value: formatCount(total), unit: "barang" } : null}
        />

        <ManagerEmptyAction />

        {listsEmpty ? (
          <div className="flex flex-col items-start gap-1">
            <AlertMessage role="status" tone="info" className="w-full">
              {STAFF_COPY.manageListsEmpty}
            </AlertMessage>
            <Link href={LISTS_PATH} className={buttonClass("text", "-ml-2")}>
              Isi daftar
            </Link>
          </div>
        ) : (
          <Link href={LISTS_PATH} className={buttonClass("text", "-ml-2 -my-2 self-start")}>
            {STAFF_COPY.manageListsLink}
          </Link>
        )}

        <FilterTagLinks
          label={STAFF_COPY.manageStatusLabel}
          current={status}
          options={STATUS_OPTIONS.map((option) => ({
            key: option.key,
            label: option.label,
            href: catalogHref({ ...values, page: 1 }, MANAGE_PATH, manageExtra(option.key)),
          }))}
        />

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
              dateError={null}
              basePath={MANAGE_PATH}
              extra={extra}
              showDates={false}
              exportSlot={
                result.kind === "ok" && capabilities.canExportInventory && result.list.total > 0 ? (
                  <CatalogExport filters={result.list.filters} />
                ) : null
              }
            />
            {result.kind === "search_too_long" ? (
              <AlertMessage role="alert" tone="error">
                {COPY.searchTooLong}
              </AlertMessage>
            ) : (
              <ManageBody list={result.list} values={values} status={status} />
            )}
          </>
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

function ManageBody({ list, values, status }: { list: CatalogPage; values: CatalogUrlState; status: CatalogStatusFilter }) {
  const extra = manageExtra(status);
  if (list.total === 0 || list.rows.length === 0) {
    const firstUse = isDefaultCatalog(values) && status === "active";
    return (
      <PendingRegion>
        <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
          {firstUse ? (
            <p role="status" className="text-body-md font-semibold text-ink">
              {COPY.catalogEmpty}
            </p>
          ) : (
            <>
              <p role="status" className="text-body-md text-ink">
                {COPY.noMatch}
              </p>
              <ListLink href={MANAGE_PATH} className={buttonClass("text", "mt-2 -ml-2")}>
                Reset
              </ListLink>
            </>
          )}
        </div>
      </PendingRegion>
    );
  }

  const params = { ...catalogParams(values), ...extra };
  const from = list.rows[0].rowNo;
  const to = list.rows[list.rows.length - 1].rowNo;
  return (
    <PendingRegion className="flex flex-col gap-4">
      <CatalogTable
        rows={list.rows}
        caption={`Daftar barang, halaman ${list.page} dari ${list.pageCount}`}
        backParams={catalogParams(values)}
        withDates={false}
      />
      <div className="flex flex-col items-center gap-2 pb-4">
        <Pagination
          page={list.page}
          pageCount={list.pageCount}
          basePath={MANAGE_PATH}
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
