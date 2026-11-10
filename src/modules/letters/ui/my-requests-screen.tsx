import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { FilterTagLinks } from "@/components/list/filter-tags";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { buttonClass } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";
import {
  LETTER_PARAMS,
  letterRequestStage,
  MY_LETTER_REQUESTS_FILTER_LABEL,
  type LetterCapabilities,
  type MyLetterRequestRow,
  type MyLetterRequestsFilter,
  type MyLetterRequestsPage,
} from "../types";
import { RequestChips } from "./chips";
import { COPY, rangeText } from "./copy";
import { formatCount, formatDay } from "./format";
import { NumberText } from "./letter-number";
import { LettersHeader, ListColumn } from "./letters-header";
import { MY_REQUESTS_PATH, myRequestsHref, myRequestsParams, requestFormHref, requestHref } from "./routes";
import { UnavailableNotice } from "./states";

const FILTERS: MyLetterRequestsFilter[] = ["open", "closed", "all"];

/**
 * Permohonan Saya (design screen 7, 10.1): the only status channel for a member, since NEXUS sends no
 * notifications. Own requests only (L9); open ones first, newest first. Defaults to "Semua" (owner):
 * an issued request, the one with the file, counts as closed.
 */
export function MyRequestsScreen({
  result,
  filter,
  capabilities,
  periodLabel,
  openCount,
  actionNeeded,
}: {
  result: { kind: "ok"; page: MyLetterRequestsPage } | { kind: "unavailable" };
  filter: MyLetterRequestsFilter;
  capabilities: LetterCapabilities;
  periodLabel: string | null;
  /** Own Diajukan + Diproses requests ("Permohonan 2 berjalan"); null when unknown. */
  openCount: number | null;
  actionNeeded: number | null;
}) {
  const countBox = openCount === null ? null : { label: "Permohonan", value: formatCount(openCount), unit: "berjalan" };

  return (
    <ListNavigationProvider>
      <ListColumn>
        <LettersHeader
          capabilities={capabilities}
          periodLabel={periodLabel}
          current="mine"
          countBox={countBox}
          actionNeeded={actionNeeded}
        />

        {capabilities.canSubmitRequest ? (
          <Link href={requestFormHref()} className={buttonClass("primary", "nx-press nx-rise nx-delay-2 md:w-auto md:self-start")}>
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            Ajukan Surat
          </Link>
        ) : null}

        <FilterTagLinks
          label="Tampilkan permohonan"
          current={filter}
          options={FILTERS.map((key) => ({ key, label: MY_LETTER_REQUESTS_FILTER_LABEL[key], href: myRequestsHref(key) }))}
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

function RequestList({ page, filter, canSubmit }: { page: MyLetterRequestsPage; filter: MyLetterRequestsFilter; canSubmit: boolean }) {
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
                  Ajukan Surat
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
      <ul aria-label={`Permohonan, halaman ${page.page} dari ${page.pageCount}`} className="nx-rise-list flex flex-col gap-3">
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
          pageParam={LETTER_PARAMS.page}
          label="Halaman daftar permohonan"
        />
        <p role="status" className="text-body-sm text-ink-body tabular-nums">
          {rangeText(from, to, page.total, "permohonan", formatCount)}
        </p>
      </div>
    </PendingRegion>
  );
}

/**
 * One request (design 10.1): the Perihal is the link text, stretched over the card; the focus ring goes
 * around the card. Under a hairline: the date with the chips, then the line that says where it stands.
 */
function RequestCard({ row }: { row: MyLetterRequestRow }) {
  return (
    <article
      className={cn(
        "nx-lift relative flex flex-col gap-1 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 hover:border-gold-tint-line",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-walnut",
      )}
    >
      <h2 className="line-clamp-2 text-headline-sm break-words">
        <Link
          href={requestHref(row.requestId)}
          className="text-walnut after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
        >
          {row.subject}
        </Link>
      </h2>
      <p className="text-body-md break-words text-ink-body">Kepada {row.addressee}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-row-line pt-2.5">
        <span className="text-body-sm text-ink-meta tabular-nums">Diajukan {formatDay(row.createdAt)}</span>
        <RequestChips source={row} compact />
      </div>
      <StageLines row={row} />
    </article>
  );
}

function StageLines({ row }: { row: MyLetterRequestRow }) {
  const stage = letterRequestStage(row);
  const line = (children: ReactNode, className = "text-ink-body") => <p className={cn("text-body-sm break-words", className)}>{children}</p>;
  const number = row.numberText ? (
    <p className="text-body-md text-ink">
      Nomor <NumberText value={row.numberText} />
    </p>
  ) : null;
  switch (stage) {
    case "submitted":
      return line("Menunggu sekretaris.");
    case "processing":
      return line(row.processedByName ? `Sedang disiapkan oleh ${row.processedByName}.` : "Sedang disiapkan.");
    case "awaiting_file":
      return (
        <>
          {number}
          {line("Berkas menyusul.")}
        </>
      );
    case "issued":
      return (
        <>
          {number}
          {row.hasIssuedFile ? line("Berkas siap diunduh.", "text-success") : null}
        </>
      );
    case "issued_number_voided":
      return line("Nomor ini dibatalkan. Ajukan lagi kalau suratnya masih perlu.");
    case "rejected":
      return row.note ? (
        <p className="line-clamp-2 text-body-sm break-words text-ink-body">
          Catatan dari {row.noteByName ?? "sekretaris"}: {row.note}
        </p>
      ) : null;
    case "cancelled":
      return line("Kamu membatalkan permohonan ini.");
  }
}
