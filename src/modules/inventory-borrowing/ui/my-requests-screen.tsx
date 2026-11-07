import Link from "next/link";
import { Plus } from "lucide-react";
import { FilterTagLinks } from "@/components/list/filter-tags";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { buttonClass } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";
import {
  MY_REQUESTS_FILTER_LABEL,
  rangeDays,
  type InventoryCapabilities,
  type MyRequestRow,
  type MyRequestsFilter,
  type MyRequestsPage,
} from "../types";
import { RequestChips } from "./chips";
import { COPY, rangeText } from "./copy";
import { formatCount, formatRange } from "./format";
import { InventoryHeader, ListColumn } from "./inventory-header";
import { INVENTORY_PARAMS, MY_REQUESTS_PATH, myRequestsHref, myRequestsParams, requestFormHref, requestHref } from "./routes";
import { UnavailableNotice } from "./states";

const FILTERS: MyRequestsFilter[] = ["open", "closed", "all"];

/**
 * Peminjaman Saya (design screen 7, list). The only status channel for a member: NEXUS sends no
 * notifications (IB14). Own requests only (L9), including outside-party requests the person recorded.
 */
export function MyRequestsScreen({
  result,
  filter,
  capabilities,
  periodLabel,
}: {
  result: { kind: "ok"; page: MyRequestsPage } | { kind: "unavailable" };
  filter: MyRequestsFilter;
  capabilities: InventoryCapabilities;
  periodLabel: string | null;
}) {
  const total = result.kind === "ok" ? result.page.total : null;
  const countBox =
    total === null
      ? null
      : filter === "open"
        ? { label: "Pengajuan", value: formatCount(total), unit: "berjalan" }
        : { label: "Hasil", value: formatCount(total), unit: "pengajuan" };

  return (
    <ListNavigationProvider>
      <ListColumn>
        <InventoryHeader capabilities={capabilities} periodLabel={periodLabel} current="mine" countBox={countBox} />

        {capabilities.canSubmitRequest ? (
          <Link href={requestFormHref()} className={buttonClass("primary")}>
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            Ajukan Peminjaman
          </Link>
        ) : null}

        <FilterTagLinks
          label="Tampilkan pengajuan"
          current={filter}
          options={FILTERS.map((key) => ({ key, label: MY_REQUESTS_FILTER_LABEL[key], href: myRequestsHref(key) }))}
        />

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : (
          <RequestList page={result.page} filter={filter} canSubmit={capabilities.canSubmitRequest} />
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

function RequestList({ page, filter, canSubmit }: { page: MyRequestsPage; filter: MyRequestsFilter; canSubmit: boolean }) {
  if (page.total === 0 || page.rows.length === 0) {
    return (
      <PendingRegion>
        <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
          {filter === "all" ? (
            <>
              <p role="status" className="text-body-md font-semibold text-ink">
                {COPY.noRequests}
              </p>
              {canSubmit ? (
                <Link href={requestFormHref()} className={buttonClass("primary", "mt-4")}>
                  Ajukan Peminjaman
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <p role="status" className="text-body-md text-ink">
                {COPY.noRequestsForFilter}
              </p>
              <ListLink href={myRequestsHref("all")} className={buttonClass("text", "mt-2 -ml-2")}>
                Lihat semua
              </ListLink>
            </>
          )}
        </div>
      </PendingRegion>
    );
  }

  const from = page.rows[0].rowNo;
  const to = page.rows[page.rows.length - 1].rowNo;

  return (
    <PendingRegion className="flex flex-col gap-4">
      <ul aria-label={`Pengajuan, halaman ${page.page} dari ${page.pageCount}`} className="flex flex-col gap-3">
        {page.rows.map((row) => (
          <li key={row.requestId}>
            <RequestCard row={row} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-center gap-2 pb-4">
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          basePath={MY_REQUESTS_PATH}
          params={myRequestsParams(filter)}
          pageParam={INVENTORY_PARAMS.page}
          label="Halaman daftar pengajuan"
        />
        <p role="status" className="text-body-sm text-ink-body tabular-nums">
          {rangeText(from, to, page.total, "pengajuan", formatCount)}
        </p>
      </div>
    </PendingRegion>
  );
}

/**
 * One request as a card (design 10.1, X8). The reference is the link text, stretched over the whole
 * card; the focus ring goes around the card.
 */
function RequestCard({ row }: { row: MyRequestRow }) {
  const days = rangeDays(row.startDate, row.endDate);
  const handedOver = row.items.reduce((sum, item) => sum + (item.quantityHandedOver ?? 0), 0);

  return (
    <article
      className={cn(
        "relative flex flex-col gap-1.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 transition-colors duration-150 hover:border-ivory-line motion-reduce:transition-none",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-walnut",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h2 className="text-headline-sm text-ink tabular-nums">
          <Link
            href={requestHref(row.reference)}
            className="text-walnut after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
          >
            {row.reference}
          </Link>
        </h2>
        <RequestChips source={row} compact />
      </div>
      {row.isOutsideParty && row.outsideOrgName ? (
        <p className="text-body-sm break-words text-ink-body">Untuk: {row.outsideOrgName} (pihak luar)</p>
      ) : null}
      <p className="text-body-md break-words text-ink">{itemSummary(row)}</p>
      <p className="text-body-sm text-ink-meta tabular-nums">
        {formatRange(row.startDate, row.endDate)} · {days} hari
      </p>
      {row.isPartiallyReturned ? (
        <p className="text-body-sm text-ink-body tabular-nums">
          Sebagian kembali, sisa {formatCount(row.qtyOutstanding)} dari {formatCount(handedOver)}
        </p>
      ) : null}
      {row.decisionNote && row.decidedByName ? (
        <p className="line-clamp-2 text-body-sm break-words text-ink-body">
          Catatan dari {row.decidedByName}: {row.decisionNote}
        </p>
      ) : null}
    </article>
  );
}

/** "[Barang A], [Barang B] +1 barang". */
function itemSummary(row: MyRequestRow): string {
  const names = row.items.map((item) => item.name);
  const shown = names.slice(0, 2).join(", ");
  const rest = names.length - 2;
  return rest > 0 ? `${shown} +${rest} barang` : shown;
}
