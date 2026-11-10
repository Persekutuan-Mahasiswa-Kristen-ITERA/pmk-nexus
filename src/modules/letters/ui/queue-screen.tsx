import Link from "next/link";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";
import {
  LETTER_PARAMS,
  letterQueueViewSchema,
  letterRequestStage,
  type LetterCapabilities,
  type LetterQueueCounts,
  type LetterQueuePage,
  type LetterQueueRow,
  type LetterQueueView,
} from "../types";
import { RequestChips } from "./chips";
import { COPY, rangeText } from "./copy";
import { formatCount, formatDate, formatDay, initials } from "./format";
import { NumberText } from "./letter-number";
import { LettersHeader, ListColumn, type LetterTiles } from "./letters-header";
import { QueueFilters, QueueViewSelect, type ViewOption } from "./queue-filters";
import { QUEUE_PATH, queueHref, queueParams, requestHref, type QueueUrlState } from "./routes";
import { UnavailableNotice } from "./states";

export type QueueResult = { kind: "ok"; page: LetterQueuePage } | { kind: "unavailable" };

/**
 * Antrean Permohonan (design screen 8, 11.1-11.3) for letter_requests.view_all. Processors land on
 * "Menunggu" (oldest first), BPH without process on "Semua". Cards open the review page, where the
 * buttons follow the keys and the state. No export here (A-LT17).
 */
export function QueueScreen({
  result,
  values,
  counts,
  capabilities,
  periodLabel,
  tiles,
  rangeError,
  loneProcessor,
}: {
  result: QueueResult;
  values: QueueUrlState;
  counts: LetterQueueCounts | null;
  capabilities: LetterCapabilities;
  periodLabel: string | null;
  tiles: LetterTiles | null;
  rangeError: string | null;
  /** 3.4: the viewer is the only processor now and has an open request of their own. */
  loneProcessor: boolean;
}) {
  // "Hasil" always: the "Permohonan menunggu" tile already carries the waiting count.
  const countBox = result.kind === "ok" ? { label: "Hasil", value: formatCount(result.page.total), unit: "permohonan" } : null;

  return (
    <ListNavigationProvider>
      <ListColumn wide>
        <LettersHeader
          capabilities={capabilities}
          periodLabel={periodLabel}
          current="queue"
          countBox={countBox}
          tiles={tiles}
          actionNeeded={counts?.actionNeeded ?? null}
        />

        {loneProcessor ? (
          <AlertMessage role="status" tone="info">
            {COPY.loneProcessor}
          </AlertMessage>
        ) : null}

        {/* From 1024 px "Tampilkan" and the search share a row; the search drops by the label's height. */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-4">
          <QueueViewSelect values={values} options={viewOptions(capabilities, counts)} />
          <div className="lg:mt-6">
            <QueueFilters values={values} rangeError={rangeError} />
          </div>
        </div>

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : values.view === "open_all_periods" ? (
          <HandoverView page={result.page} values={values} counts={counts} />
        ) : (
          <QueueBody page={result.page} values={values} />
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

/** Counts in the option text only for processors, and only for the open views they work through. */
function viewOptions(capabilities: LetterCapabilities, counts: LetterQueueCounts | null): ViewOption[] {
  const known: Partial<Record<LetterQueueView, number>> = {};
  if (counts && capabilities.canProcessRequests) {
    known.submitted = counts.submitted;
    known.processing = counts.processing;
    known.awaiting_file = counts.awaitingFile;
    known.open_all_periods = counts.openAllPeriods;
  }
  return letterQueueViewSchema.options.map((view) => ({ view, count: known[view] ?? null }));
}

function filtered(values: QueueUrlState): boolean {
  return values.search.trim() !== "" || Boolean(values.from && values.to);
}

function EmptyCard({ values }: { values: QueueUrlState }) {
  return (
    <PendingRegion>
      <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
        {filtered(values) ? (
          <>
            <p role="status" className="text-body-md text-ink">
              {COPY.noMatch}
            </p>
            <ListLink href={queueHref({ ...values, search: "", from: null, to: null, page: 1 })} className={buttonClass("text", "mt-2 -ml-2")}>
              Reset
            </ListLink>
          </>
        ) : (
          <p role="status" className="text-body-md text-ink">
            {values.view === "submitted"
              ? COPY.queueEmptyWaiting
              : values.view === "open_all_periods"
                ? COPY.handoverEmpty
                : COPY.queueEmptyOther}
          </p>
        )}
      </div>
    </PendingRegion>
  );
}

function QueueBody({ page, values }: { page: LetterQueuePage; values: QueueUrlState }) {
  if (page.total === 0 || page.rows.length === 0) return <EmptyCard values={values} />;
  const from = page.rows[0].rowNo;
  const to = page.rows[page.rows.length - 1].rowNo;
  return (
    <PendingRegion className="flex flex-col gap-4">
      <QueueRows rows={page.rows} caption={`Permohonan, halaman ${page.page} dari ${page.pageCount}`} />
      <Footer page={page} values={values} from={from} to={to} />
    </PendingRegion>
  );
}

function Footer({ page, values, from, to }: { page: LetterQueuePage; values: QueueUrlState; from: number; to: number }) {
  return (
    <div className="flex flex-col items-center gap-2 pb-4">
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        basePath={QUEUE_PATH}
        params={queueParams(values)}
        pageParam={LETTER_PARAMS.page}
        label="Halaman antrean"
      />
      <p role="status" className="text-body-sm text-ink-body tabular-nums">
        {rangeText(from, to, page.total, "permohonan", formatCount)}
      </p>
    </div>
  );
}

/**
 * "Belum selesai, semua periode" (design 11.3): everything not finished, grouped by period (oldest
 * first), with a summary of real counts. Old-period requests stay actionable by whoever holds the key now.
 */
function HandoverView({ page, values, counts }: { page: LetterQueuePage; values: QueueUrlState; counts: LetterQueueCounts | null }) {
  return (
    <div className="flex flex-col gap-4">
      <AlertMessage role="status" tone="info">
        {COPY.handoverInfo}
      </AlertMessage>
      {page.total === 0 || page.rows.length === 0 ? (
        <EmptyCard values={values} />
      ) : (
        <PendingRegion className="flex flex-col gap-5">
          {counts && !filtered(values) ? <p className="text-body-md text-ink tabular-nums">{handoverSummary(counts)}</p> : null}
          {groupByPeriod(page.rows).map((group) => (
            <section key={group.periodId} aria-labelledby={`period-${group.periodId}`} className="flex flex-col gap-3">
              <h2
                id={`period-${group.periodId}`}
                aria-label={`Periode ${group.label}, ${group.total} permohonan`}
                className="font-heading text-headline-lg text-title"
              >
                Periode {group.label} <span className="tabular-nums">({formatCount(group.total)})</span>
              </h2>
              <QueueRows rows={group.rows} caption={`Permohonan periode ${group.label}`} />
            </section>
          ))}
          <Footer page={page} values={values} from={page.rows[0].rowNo} to={page.rows[page.rows.length - 1].rowNo} />
        </PendingRegion>
      )}
    </div>
  );
}

/** "6 belum selesai: 3 menunggu, 2 diproses, 1 menunggu file final." Zero groups are left out. */
function handoverSummary(counts: LetterQueueCounts): string {
  const parts: string[] = [];
  if (counts.submitted > 0) parts.push(`${formatCount(counts.submitted)} menunggu`);
  if (counts.processing > 0) parts.push(`${formatCount(counts.processing)} diproses`);
  if (counts.awaitingFile > 0) parts.push(`${formatCount(counts.awaitingFile)} menunggu file final`);
  return `${formatCount(counts.openAllPeriods)} belum selesai${parts.length > 0 ? `: ${parts.join(", ")}` : ""}.`;
}

function groupByPeriod(rows: LetterQueueRow[]) {
  const groups = new Map<string, { periodId: string; label: string; total: number; rows: LetterQueueRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.periodId) ?? { periodId: row.periodId, label: row.periodLabel ?? "-", total: row.periodTotalCount, rows: [] };
    group.rows.push(row);
    groups.set(row.periodId, group);
  }
  return [...groups.values()];
}

/**
 * Phones and tablets: one card per request. From 1024 px: a table (Pemohon, Perihal, Diajukan,
 * Dibutuhkan, Status; design 11.4) in the wide column, as the register (X7): at 768 px the Perihal
 * column was too narrow to read. Only one of the two is displayed, so Tab and screen readers meet each request once.
 */
function QueueRows({ rows, caption }: { rows: LetterQueueRow[]; caption: string }) {
  return (
    <>
      <ul aria-label={caption} className="nx-rise-list flex flex-col gap-3 lg:hidden">
        {rows.map((row) => (
          <li key={row.requestId}>
            <QueueCard row={row} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1 lg:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-ivory">
            <tr className="border-b border-hairline text-label-sm font-bold text-walnut uppercase">
              <th scope="col" className="w-[15rem] px-4 py-2.5">
                Pemohon
              </th>
              <th scope="col" className="px-4 py-2.5">
                Perihal
              </th>
              <th scope="col" className="w-[7.5rem] px-4 py-2.5">
                Diajukan
              </th>
              <th scope="col" className="w-[8.5rem] px-4 py-2.5">
                Dibutuhkan
              </th>
              <th scope="col" className="w-[11rem] px-4 py-2.5">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.requestId}
                className={cn(
                  "border-t border-row-line align-top transition-colors duration-150 first:border-t-0 hover:bg-ivory/60 motion-reduce:transition-none",
                  index % 2 === 1 ? "bg-zebra" : "bg-surface",
                )}
              >
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <div className="flex items-start gap-2.5">
                    <Avatar name={row.requesterName} />
                    <div className="min-w-0">
                      <Link
                        href={requestHref(row.requestId)}
                        className="text-body-md font-semibold break-words text-walnut underline-offset-2 hover:underline"
                      >
                        {row.requesterName ?? "-"}
                      </Link>
                      {row.isOwn ? <span className="block text-body-sm text-ink-body">{COPY.ownMarker}</span> : null}
                    </div>
                  </div>
                </th>
                <td className="px-4 py-3 text-body-md text-ink">
                  <span className="line-clamp-2 break-words">{row.subject}</span>
                  {showNumber(row) && row.numberText ? (
                    <span className="mt-0.5 block text-body-sm text-ink-body">
                      Nomor <NumberText value={row.numberText} />
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-body-md text-ink-body tabular-nums">{formatDay(row.createdAt)}</td>
                <td className="px-4 py-3 text-body-md text-ink-body tabular-nums">
                  {row.neededBy ? formatDate(row.neededBy) : "-"}
                  {row.isPastDue ? <span className="block text-body-sm font-semibold text-warn">lewat {row.daysPastDue} hari</span> : null}
                </td>
                <td className="px-4 py-3">
                  <RequestChips source={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const showNumber = (row: LetterQueueRow) => row.status === "processing" || row.status === "issued";

/** Requester initials on the gold tint (D-023 avatar, like PI-CORE). Decorative: the name says it in words. */
function Avatar({ name }: { name: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-gold-tint-line bg-gold-tint text-label-sm font-bold text-walnut"
    >
      {initials(name)}
    </span>
  );
}

/**
 * One request (design 11.1): requester (the link, stretched over the card) with "Pengajuanmu" for the
 * viewer's own, chips, Perihal, addressee and "Atas nama", date and attachments, the needed-by line
 * ("lewat n hari" for secretaries), and for a taken number the number and who took it.
 */
function QueueCard({ row }: { row: LetterQueueRow }) {
  const stage = letterRequestStage(row);
  const facts = [`Kepada ${row.addressee}`, row.onBehalfOf ? `Atas nama ${row.onBehalfOf}` : null].filter(Boolean).join(" · ");
  return (
    <article
      className={cn(
        "nx-lift relative flex flex-col gap-1.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 hover:border-gold-tint-line",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-walnut",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={row.requesterName} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <h3 className="min-w-0 text-headline-sm break-words">
              <Link
                href={requestHref(row.requestId)}
                aria-label={`Permohonan ${row.subject} dari ${row.requesterName ?? "pemohon"}${row.isOwn ? ", pengajuanmu" : ""}`}
                className="text-walnut after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
              >
                {row.requesterName ?? "-"}
              </Link>
              {row.isOwn ? <span className="ml-2 text-body-sm font-normal text-ink-body">{COPY.ownMarker}</span> : null}
            </h3>
            <RequestChips source={row} compact />
          </div>
          <p className="line-clamp-2 text-body-md break-words text-ink">{row.subject}</p>
          <p className="text-body-sm break-words text-ink-body">{facts}</p>
          {stage === "awaiting_file" && row.numberText ? (
            <>
              <p className="text-body-md text-ink">
                Nomor <NumberText value={row.numberText} />
              </p>
              {row.numberTakenAt ? (
                <p className="text-body-sm text-ink-meta tabular-nums">
                  Diambil {formatDay(row.numberTakenAt)}
                  {row.numberTakenByName ? ` oleh ${row.numberTakenByName}` : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-body-sm text-ink-meta tabular-nums">
              Diajukan {formatDay(row.createdAt)}
              {row.attachmentCount > 0 ? ` · ${formatCount(row.attachmentCount)} lampiran` : ""}
            </p>
          )}
          {row.neededBy && (row.status === "submitted" || row.status === "processing") ? (
            <p className={cn("text-body-sm tabular-nums", row.isPastDue ? "font-semibold text-warn" : "text-ink-body")}>
              Dibutuhkan paling lambat {formatDate(row.neededBy)}
              {row.isPastDue ? ` (lewat ${row.daysPastDue} hari)` : ""}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
