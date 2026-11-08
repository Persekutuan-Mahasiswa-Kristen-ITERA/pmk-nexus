import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import {
  queueViewSchema,
  type BorrowingPeriod,
  type InventoryCapabilities,
  type OpenLoanRow,
  type QueueCounts,
  type QueuePage,
  type QueueView,
} from "../types";
import { COPY, rangeText, STAFF_COPY } from "./copy";
import { formatCount } from "./format";
import { InventoryHeader, ListColumn } from "./inventory-header";
import { BorrowingExport } from "./inventory-export";
import { QueueCard } from "./queue-card";
import { QueueFilters, QueueViewSelect, type ViewOption } from "./queue-filters";
import { INVENTORY_PARAMS, QUEUE_PATH, queueHref, queueParams, type QueueUrlState } from "./routes";
import { UnavailableNotice } from "./states";

export type QueueResult =
  | { kind: "ok"; page: QueuePage }
  | { kind: "open_loans"; rows: OpenLoanRow[] }
  | { kind: "search_too_long" }
  /** A filter the server refused (unknown period): the contract text and a way back to the plain list. */
  | { kind: "refused"; text: string }
  | { kind: "unavailable" };

/**
 * Antrean (design screen 8, 11.1) and the handover list (screen 11, 14) for borrowing.view_all holders.
 * The "Tampilkan" select picks the group; heads land on Menunggu persetujuan, Operations on Siap
 * diambil, BPH on Semua. Cards open Detail Pengajuan, where the buttons follow the keys and the state.
 */
export function QueueScreen({
  result,
  values,
  counts,
  periods,
  capabilities,
  periodLabel,
  dateError,
  loneHead,
}: {
  result: QueueResult;
  values: QueueUrlState;
  counts: QueueCounts | null;
  periods: BorrowingPeriod[];
  capabilities: InventoryCapabilities;
  periodLabel: string | null;
  dateError: string | null;
  /** B29: the viewer is the only head now and has an own request waiting (design 11.1 hint). */
  loneHead: boolean;
}) {
  const countBox = countBoxFor(result, values.view);

  return (
    <ListNavigationProvider>
      <ListColumn>
        <InventoryHeader
          capabilities={capabilities}
          periodLabel={periodLabel}
          current="queue"
          queueActionCount={counts?.actionNeeded ?? null}
          countBox={countBox}
        />

        <QueueViewSelect values={values} options={viewOptions(capabilities, counts)} />

        {loneHead ? (
          <AlertMessage role="status" tone="info">
            {STAFF_COPY.loneHeadHint}
          </AlertMessage>
        ) : null}

        {result.kind === "open_loans" ? (
          <OpenLoansView rows={result.rows} canExport={capabilities.canExportBorrowing} />
        ) : (
          <>
            <QueueFilters
              values={values}
              periods={periods}
              searchError={result.kind === "search_too_long" ? COPY.searchTooLong : null}
              dateError={dateError}
              exportSlot={
                result.kind === "ok" && capabilities.canExportBorrowing && result.page.total > 0 ? (
                  <BorrowingExport filters={result.page.filters} />
                ) : null
              }
            />
            <QueueBody result={result} values={values} />
          </>
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

/** The groups this person may act on carry their count in the option text (design 11.1, 11.6). */
function viewOptions(capabilities: InventoryCapabilities, counts: QueueCounts | null): ViewOption[] {
  const actionable: Partial<Record<QueueView, number>> = {};
  if (counts && capabilities.canApprove) actionable.pending = counts.pending;
  if (counts && capabilities.canHandle) {
    actionable.ready = counts.ready;
    actionable.borrowed = counts.borrowed;
    actionable.overdue = counts.overdue;
  }
  return queueViewSchema.options.map((view) => ({ view, count: actionable[view] ?? null }));
}

function countBoxFor(result: QueueResult, view: QueueView) {
  if (result.kind === "ok") {
    return view === "pending"
      ? { label: "Pengajuan", value: formatCount(result.page.total), unit: "menunggu" }
      : { label: "Hasil", value: formatCount(result.page.total), unit: "pengajuan" };
  }
  if (result.kind === "open_loans") return { label: "Pengajuan", value: formatCount(result.rows.length), unit: "belum selesai" };
  return null;
}

function QueueBody({ result, values }: { result: Exclude<QueueResult, { kind: "open_loans" }>; values: QueueUrlState }) {
  if (result.kind === "unavailable") return <UnavailableNotice />;
  if (result.kind === "search_too_long") {
    return (
      <AlertMessage id="queue-search-error" role="alert" tone="error">
        {COPY.searchTooLong}
      </AlertMessage>
    );
  }
  if (result.kind === "refused") {
    return (
      <div className="flex flex-col items-start gap-1">
        <AlertMessage role="alert" tone="warning" className="w-full">
          {result.text}
        </AlertMessage>
        <ListLink href={queueHref({ view: values.view })} className={buttonClass("text", "-ml-2")}>
          Reset
        </ListLink>
      </div>
    );
  }

  const { page } = result;
  if (page.total === 0 || page.rows.length === 0) {
    const filtered = values.search.trim() !== "" || (values.from && values.to) || values.periodId;
    return (
      <PendingRegion>
        <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
          {filtered ? (
            <>
              <p role="status" className="text-body-md text-ink">
                {COPY.noMatch}
              </p>
              <ListLink href={queueHref({ view: values.view })} className={buttonClass("text", "mt-2 -ml-2")}>
                Reset
              </ListLink>
            </>
          ) : (
            <p role="status" className="text-body-md text-ink">
              {values.view === "pending" ? STAFF_COPY.queueEmptyPending : STAFF_COPY.queueEmptyOther}
            </p>
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
            <QueueCard row={row} />
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-center gap-2 pb-4">
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          basePath={QUEUE_PATH}
          params={queueParams(values)}
          pageParam={INVENTORY_PARAMS.page}
          label="Halaman antrean"
        />
        <p role="status" className="text-body-sm text-ink-body tabular-nums">
          {rangeText(from, to, page.total, "pengajuan", formatCount)}
        </p>
      </div>
    </PendingRegion>
  );
}

/**
 * "Belum selesai, semua periode" (design screen 11): everything unfinished, grouped by period (oldest
 * first, overdue first inside), with a summary of real counts and the export for the incoming team.
 */
function OpenLoansView({ rows, canExport }: { rows: OpenLoanRow[]; canExport: boolean }) {
  const groups = groupByPeriod(rows);
  return (
    <div className="flex flex-col gap-4">
      <AlertMessage role="status" tone="info">
        {STAFF_COPY.openLoansInfo}
      </AlertMessage>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
          <p role="status" className="text-body-md text-ink">
            {STAFF_COPY.openLoansEmpty}
          </p>
        </div>
      ) : (
        <>
          {canExport ? (
            <div className="flex justify-end">
              <BorrowingExport filters={{ view: "open_all_periods" }} intro={STAFF_COPY.openLoansExportIntro} />
            </div>
          ) : null}
          <p className="text-body-md text-ink tabular-nums">{openLoansSummary(rows)}</p>
          {groups.map((group) => (
            <section key={group.periodId} aria-labelledby={`period-${group.periodId}`} className="flex flex-col gap-3">
              <h2
                id={`period-${group.periodId}`}
                aria-label={`Periode ${group.label}, ${group.rows.length} pengajuan`}
                className="font-heading text-headline-lg text-title"
              >
                Periode {group.label} <span className="tabular-nums">({formatCount(group.rows.length)})</span>
              </h2>
              <ul className="flex flex-col gap-3">
                {group.rows.map((row) => (
                  <li key={row.requestId}>
                    <QueueCard row={row} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** "7 belum selesai: 2 menunggu persetujuan, 1 siap diambil, 4 dipinjam (1 terlambat)." Zero groups are left out. */
function openLoansSummary(rows: OpenLoanRow[]): string {
  const pending = rows.filter((r) => r.status === "submitted").length;
  const ready = rows.filter((r) => r.status === "approved").length;
  const borrowed = rows.filter((r) => r.status === "borrowed").length;
  const overdue = rows.filter((r) => r.isOverdue).length;
  const parts: string[] = [];
  if (pending > 0) parts.push(`${formatCount(pending)} menunggu persetujuan`);
  if (ready > 0) parts.push(`${formatCount(ready)} siap diambil`);
  if (borrowed > 0) parts.push(`${formatCount(borrowed)} dipinjam${overdue > 0 ? ` (${formatCount(overdue)} terlambat)` : ""}`);
  return `${formatCount(rows.length)} belum selesai: ${parts.join(", ")}.`;
}

/** Groups in the order the server sends the periods (oldest first); overdue requests first inside a group. */
function groupByPeriod(rows: OpenLoanRow[]): { periodId: string; label: string; rows: OpenLoanRow[] }[] {
  const groups = new Map<string, { periodId: string; label: string; rows: OpenLoanRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.periodId) ?? { periodId: row.periodId, label: row.periodLabel ?? "-", rows: [] };
    group.rows.push(row);
    groups.set(row.periodId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue)),
  }));
}
