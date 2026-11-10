import Link from "next/link";
import type { ReactNode } from "react";
import { History as HistoryIcon, Paperclip, Receipt } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import { cn } from "@/lib/utils";
import {
  FINANCE_COPY,
  FINANCE_ENTRY_TYPE_LABEL,
  FINANCE_HISTORY_DETAIL,
  FINANCE_HISTORY_LABEL,
  FINANCE_NOTICE_COPY,
  FINANCE_ROUTES,
  financeCorrectionPath,
  financeEntryPath,
  financeRerecordPath,
  formatEntryAmount,
  formatFinanceCopy,
  type FinanceEntryDetail,
  type FinanceHistoryEntry,
  type FinanceNotice,
} from "../types";
import { AddProofButton, VoidEntryButton } from "./detail-actions";
import { FinanceExport } from "./finance-export";
import { formatDate, formatDateTime, formatDay } from "./format";
import { ProofList } from "./proof-list";
import { BackLink, DetailRows, NarrowPage, SectionCard, SuccessNotice } from "./states";

const D = FINANCE_COPY.detail;

/** History entries shown before the rest fold behind a disclosure. */
const HISTORY_SHOWN = 5;

/**
 * Detail Transaksi (spec 7 screen 2, F4-F6). The amount sits on the warm plate as the one thing to find
 * first, signed and struck through when voided; then the data, Bukti and Riwayat. Buttons follow the
 * database's `actions` for this viewer (absent, never greyed); the Server Actions and the database decide
 * again. From 1024 px Riwayat moves to a right column. An entry of an old period offers "Buat koreksi", never
 * a void (L7, F5).
 */
export function EntryDetailScreen({ detail, notice, periodLabel }: { detail: FinanceEntryDetail; notice: FinanceNotice | null; periodLabel: string | null }) {
  const { actions } = detail;
  const voided = detail.status === "voided";

  return (
    <NarrowPage wide>
      <div className="flex flex-col gap-4 lg:gap-5">
        <BackLink href={FINANCE_ROUTES.list}>{D.back}</BackLink>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-display-sm text-title">{D.title}</h1>
            {voided ? (
              <span>
                <StatusChip tone="grey">{FINANCE_COPY.list.voidedChip}</StatusChip>
              </span>
            ) : null}
          </div>
          {actions.canExport ? <FinanceExport filters={exportFilters(detail)} periodLabel={detail.periodLabel ?? periodLabel} /> : null}
        </div>

        {notice ? <SuccessNotice>{formatFinanceCopy(FINANCE_NOTICE_COPY[notice], { nomor: detail.numberText })}</SuccessNotice> : null}

        <AmountPlate detail={detail} />

        {voided ? (
          <AlertMessage role="status" tone="info">
            {formatFinanceCopy(D.voidBlock, {
              nama: detail.voidedByName ?? "-",
              tanggal: detail.voidedAt ? formatDay(detail.voidedAt) : "-",
              alasan: detail.voidReason ?? "-",
            })}
          </AlertMessage>
        ) : null}
        {!detail.isActivePeriod ? (
          <AlertMessage role="status" tone="info">
            {formatFinanceCopy(FINANCE_COPY.page.oldPeriodBanner, { label: detail.periodLabel ?? "" })}
          </AlertMessage>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={D.title} id="finance-data" icon={<Receipt strokeWidth={2} />}>
            <DetailRows rows={dataRows(detail)} />
            <CorrectionLinks detail={detail} />
            <p className="mt-3 border-t border-row-line pt-2.5 text-body-sm text-ink-body">
              {formatFinanceCopy(D.recordedBy, { nama: detail.createdByName ?? "-", tanggal: formatDay(detail.createdAt) })}
            </p>
          </SectionCard>

          <SectionCard title={detail.proofCount > 0 ? `${D.proofTitle} (${detail.proofCount})` : D.proofTitle} id="finance-proof" icon={<Paperclip strokeWidth={2} />}>
            {detail.files.length > 0 ? (
              <ProofList files={detail.files} entryId={detail.entryId} canWithdraw={actions.canWithdrawProof} />
            ) : (
              <p className="text-body-md text-ink-body">{D.proofEmpty}</p>
            )}
            {actions.canAddProof && actions.filesRoom > 0 ? <AddProofButton entryId={detail.entryId} room={actions.filesRoom} /> : null}
          </SectionCard>

          <Actions detail={detail} />
        </div>

        <SectionCard title={D.historyTitle} id="finance-history" icon={<HistoryIcon strokeWidth={2} />} className="lg:sticky lg:top-6">
          <History entries={detail.history} number={detail.numberText} />
        </SectionCard>
      </div>
    </NarrowPage>
  );
}

/** What "Ekspor" on a detail sends: the period of this entry, with every other filter at its default. */
function exportFilters(detail: FinanceEntryDetail) {
  return {
    periodId: detail.periodId,
    search: detail.numberText,
    type: "all" as const,
    from: null,
    to: null,
    includeVoided: true,
    withoutProof: false,
  };
}

/** The signed amount on the warm plate (D-023 gold tint), struck through when voided. */
function AmountPlate({ detail }: { detail: FinanceEntryDetail }) {
  const voided = detail.status === "voided";
  return (
    <section aria-labelledby="finance-amount-label" className="rounded-xl border border-gold-tint-line bg-gold-tint px-4 py-3.5 md:px-5">
      <h2 id="finance-amount-label" className="text-body-sm text-ink-body">
        {D.amount}
      </h2>
      <p
        className={cn(
          "mt-0.5 font-heading text-headline-lg break-words text-title tabular-nums",
          voided && "text-ink-body line-through decoration-1",
        )}
      >
        {formatEntryAmount(detail.entryType, detail.amount)}
      </p>
      <p className="mt-0.5 text-body-sm text-ink-body">{detail.numberText}</p>
    </section>
  );
}

/** The buttons of this entry for this viewer. An old-period entry offers the correction, never a void. */
function Actions({ detail }: { detail: FinanceEntryDetail }) {
  const { actions } = detail;
  const showAny = actions.canVoid || actions.canCorrect || actions.canRerecord;
  const oldPeriodNote = !detail.isActivePeriod && detail.status === "active" && actions.canCorrect;
  if (!showAny && !oldPeriodNote) return null;
  return (
    <div className="flex flex-col gap-2">
      {oldPeriodNote ? <p className="text-body-md text-ink-body">{D.oldPeriodNote}</p> : null}
      {actions.canCorrect ? (
        <Link href={financeCorrectionPath(detail.entryId)} className={buttonClass("primary", "nx-press")}>
          {D.correct}
        </Link>
      ) : null}
      {actions.canRerecord ? (
        <Link href={financeRerecordPath(detail)} className={buttonClass("primary", "nx-press")}>
          {D.rerecord}
        </Link>
      ) : null}
      {actions.canVoid ? <VoidEntryButton entryId={detail.entryId} numberText={detail.numberText} /> : null}
    </div>
  );
}

function dataRows(detail: FinanceEntryDetail): { label: string; value: ReactNode }[] {
  const rows: { label: string; value: ReactNode }[] = [
    { label: D.number, value: detail.numberText },
    { label: D.date, value: formatDate(detail.entryDate) },
    { label: D.type, value: FINANCE_ENTRY_TYPE_LABEL[detail.entryType] },
    { label: D.description, value: detail.description },
  ];
  if (detail.notes) rows.push({ label: D.notes, value: <span className="whitespace-pre-line">{detail.notes}</span> });
  rows.push({ label: D.period, value: detail.periodLabel ?? "-" });
  return rows;
}

/** "Koreksi atas KAS-0003" and "Dikoreksi lewat KAS-0020": links to the linked entries (A-FN8). */
function CorrectionLinks({ detail }: { detail: FinanceEntryDetail }) {
  if (!detail.corrects && detail.correctedBy.length === 0) return null;
  const link = "rounded-sm font-semibold text-walnut underline underline-offset-2";
  return (
    <ul className="mt-3 flex flex-col gap-1 border-t border-row-line pt-2.5 text-body-md">
      {detail.corrects ? (
        <li>
          <Link href={financeEntryPath(detail.corrects.entryId)} className={link}>
            {formatFinanceCopy(D.correctsLink, { nomor: detail.corrects.numberText })}
          </Link>
        </li>
      ) : null}
      {detail.correctedBy.map((by) => (
        <li key={by.entryId}>
          <Link href={financeEntryPath(by.entryId)} className={link}>
            {formatFinanceCopy(D.correctedBy, { nomor: by.numberText })}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Riwayat, newest first; more than five sit behind a disclosure. */
function History({ entries, number }: { entries: FinanceHistoryEntry[]; number: string }) {
  if (entries.length === 0) return null;
  const items = entries.map(historyEntry);
  const label = `${D.historyTitle} ${number}`;
  if (items.length <= HISTORY_SHOWN) return <Timeline label={label} entries={items} />;
  return (
    <div className="flex flex-col gap-2">
      <Timeline label={label} entries={items.slice(0, HISTORY_SHOWN)} />
      <details className="group">
        <summary className="-ml-2 inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory [&::-webkit-details-marker]:hidden">
          {D.historyTitle} ({items.length})
        </summary>
        <div className="mt-3">
          <Timeline label={label} entries={items.slice(HISTORY_SHOWN)} />
        </div>
      </details>
    </div>
  );
}

function historyEntry(entry: FinanceHistoryEntry): TimelineEntry {
  const template = FINANCE_HISTORY_LABEL[entry.kind];
  const title = entry.actorName === null ? template.replace(/ oleh \{nama\}/, "") : formatFinanceCopy(template, { nama: entry.actorName });
  let details: ReactNode = null;
  if (entry.kind === "file_added" || entry.kind === "file_withdrawn") {
    details = (
      <>
        {entry.fileName ? <p className="break-words">{formatFinanceCopy(FINANCE_HISTORY_DETAIL.file, { file: entry.fileName })}</p> : null}
        {entry.note ? <p className="break-words whitespace-pre-line">{formatFinanceCopy(FINANCE_HISTORY_DETAIL.reason, { alasan: entry.note })}</p> : null}
      </>
    );
  } else if (entry.kind === "voided" && entry.note) {
    details = <p className="break-words whitespace-pre-line">{formatFinanceCopy(FINANCE_HISTORY_DETAIL.reason, { alasan: entry.note })}</p>;
  }
  return { key: String(entry.historyId), title, dateTime: entry.at, dateText: formatDateTime(entry.at), details };
}
