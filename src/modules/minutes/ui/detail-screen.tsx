import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, History as HistoryIcon, NotebookPen, Paperclip } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import { cn } from "@/lib/utils";
import {
  formatMinuteCopy,
  MINUTE_COPY,
  MINUTE_FIELD_LABEL,
  MINUTE_HISTORY_LABEL,
  MINUTE_NOTICE_COPY,
  MINUTE_ROUTES,
  minuteEditPath,
  minuteUnitLabel,
  type MinuteDetail,
  type MinuteFieldChange,
  type MinuteHistoryEntry,
  type MinuteNotice,
} from "../types";
import { AddFilesButton, VoidMinuteButton } from "./detail-actions";
import { MinuteFileList } from "./file-list";
import { formatDate, formatDateTime, formatDay } from "./format";
import { MinutesExport } from "./minutes-export";
import { BackLink, DetailRows, NarrowPage, SectionCard, SuccessNotice } from "./states";

const D = MINUTE_COPY.detail;

/** History entries shown before the rest fold behind a disclosure. */
const HISTORY_SHOWN = 5;

/**
 * Detail Notulensi (spec 7 screen 2, F2). The meeting title sits on the warm plate as the one thing to
 * find first; then Data Pertemuan, the minutes themselves, Lampiran and Riwayat. Buttons follow the
 * database's `actions` for this viewer (absent, never greyed); the Server Actions and the database decide
 * again. From 1024 px Riwayat moves to a right column.
 */
export function MinuteDetailScreen({ detail, notice }: { detail: MinuteDetail; notice: MinuteNotice | null }) {
  const { actions } = detail;
  const voided = detail.status === "voided";

  return (
    <NarrowPage wide>
      <div className="flex flex-col gap-4 lg:gap-5">
        <BackLink href={MINUTE_ROUTES.list}>{D.back}</BackLink>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-display-sm text-title">{D.title}</h1>
            {voided ? (
              <span>
                <StatusChip tone="grey">{D.voidedChip}</StatusChip>
              </span>
            ) : null}
          </div>
          {actions.canExport ? <MinutesExport target={{ kind: "single", minuteId: detail.minuteId, meetingDate: detail.meetingDate }} /> : null}
        </div>

        {notice ? <SuccessNotice>{MINUTE_NOTICE_COPY[notice]}</SuccessNotice> : null}

        <TitlePlate detail={detail} />

        {voided ? (
          <AlertMessage role="status" tone="info">
            {formatMinuteCopy(D.voidBlock, {
              nama: detail.voidedByName ?? "-",
              tanggal: detail.voidedAt ? formatDay(detail.voidedAt) : "-",
              alasan: detail.voidReason ?? "-",
            })}
          </AlertMessage>
        ) : null}
        {!detail.isActivePeriod ? (
          <AlertMessage role="status" tone="info">
            {D.oldPeriod}
          </AlertMessage>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={D.meetingCard} id="minute-meeting" icon={<CalendarDays strokeWidth={2} />}>
            <DetailRows rows={meetingRows(detail)} />
            <p className="mt-3 border-t border-row-line pt-2.5 text-body-sm text-ink-body">
              {formatMinuteCopy(D.recordedBy, { nama: detail.createdByName ?? "-", tanggal: formatDay(detail.createdAt) })}
            </p>
          </SectionCard>

          <SectionCard title={MINUTE_COPY.form.resultCard} id="minute-content" icon={<NotebookPen strokeWidth={2} />}>
            <div className="flex flex-col gap-5">
              <Passage label={D.topic}>
                <p className="text-body-lg font-semibold break-words text-ink">{detail.topic}</p>
              </Passage>
              <Passage label={D.content}>
                <p className="max-w-[68ch] text-body-lg break-words whitespace-pre-line text-ink">{detail.content}</p>
              </Passage>
              <Passage label={D.decision} tinted={detail.decision !== null}>
                {detail.decision ? (
                  <p className="max-w-[68ch] text-body-lg break-words whitespace-pre-line text-ink">{detail.decision}</p>
                ) : (
                  <p className="text-body-md text-ink-body">{D.noDecision}</p>
                )}
              </Passage>
            </div>
          </SectionCard>

          <SectionCard
            title={detail.fileCount > 0 ? `${D.filesCard} (${detail.fileCount})` : D.filesCard}
            id="minute-files"
            icon={<Paperclip strokeWidth={2} />}
          >
            {detail.files.length > 0 ? (
              <MinuteFileList
                files={detail.files}
                minuteId={detail.minuteId}
                withdraw={actions.canWithdrawFiles ? { version: detail.version } : null}
              />
            ) : (
              <p className="text-body-md text-ink-body">{D.noFiles}</p>
            )}
            {actions.canAddFiles && actions.filesRoom > 0 ? (
              <AddFilesButton minuteId={detail.minuteId} version={detail.version} room={actions.filesRoom} />
            ) : null}
          </SectionCard>

          {actions.canEdit || actions.canVoid ? (
            <div className="flex flex-col gap-2">
              {actions.canEdit ? (
                <Link href={minuteEditPath(detail.minuteId)} className={buttonClass("primary", "nx-press")}>
                  {D.edit}
                </Link>
              ) : null}
              {actions.canVoid ? <VoidMinuteButton minuteId={detail.minuteId} version={detail.version} /> : null}
            </div>
          ) : null}
        </div>

        <SectionCard title={D.historyCard} id="minute-history" icon={<HistoryIcon strokeWidth={2} />} className="lg:sticky lg:top-6">
          <History entries={detail.history} title={detail.title} />
        </SectionCard>
      </div>
    </NarrowPage>
  );
}

/** The meeting title on the warm plate (D-023 gold tint), struck through when voided. */
function TitlePlate({ detail }: { detail: MinuteDetail }) {
  const voided = detail.status === "voided";
  return (
    <section aria-labelledby="minute-title-label" className="rounded-xl border border-gold-tint-line bg-gold-tint px-4 py-3.5 md:px-5">
      <h2 id="minute-title-label" className="text-body-sm text-ink-body">
        {MINUTE_FIELD_LABEL.title}
      </h2>
      <p
        className={cn(
          "mt-0.5 font-heading text-headline-lg text-balance break-words text-title",
          voided && "text-ink-body line-through decoration-1",
        )}
      >
        {detail.title}
      </p>
    </section>
  );
}

/** One labelled block of the minutes; the decision gets a quiet ivory ground so it is found at a glance. */
function Passage({ label, tinted = false, children }: { label: string; tinted?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", tinted && "-mx-1 rounded-lg bg-zebra px-3 py-3 ring-1 ring-row-line")}>
      <h3 className="text-label-lg text-ink-label">{label}</h3>
      {children}
    </div>
  );
}

/** Data Pertemuan rows: date, unit and period (who recorded it sits under them as one line). */
function meetingRows(detail: MinuteDetail): { label: string; value: ReactNode }[] {
  return [
    { label: D.meetingDate, value: formatDate(detail.meetingDate) },
    { label: D.unit, value: minuteUnitLabel(detail) },
    { label: D.period, value: detail.periodLabel ?? "-" },
  ];
}

/** Riwayat, newest first; more than five sit behind a disclosure. */
function History({ entries, title }: { entries: MinuteHistoryEntry[]; title: string }) {
  if (entries.length === 0) return null;
  const items = entries.map(historyEntry);
  const label = `${D.historyCard} ${title}`;
  if (items.length <= HISTORY_SHOWN) return <Timeline label={label} entries={items} />;
  return (
    <div className="flex flex-col gap-2">
      <Timeline label={label} entries={items.slice(0, HISTORY_SHOWN)} />
      <details className="group">
        <summary className="-ml-2 inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory [&::-webkit-details-marker]:hidden">
          {D.historyCard} ({items.length})
        </summary>
        <div className="mt-3">
          <Timeline label={label} entries={items.slice(HISTORY_SHOWN)} />
        </div>
      </details>
    </div>
  );
}

function historyEntry(entry: MinuteHistoryEntry): TimelineEntry {
  const template = MINUTE_HISTORY_LABEL[entry.kind];
  const title = entry.actorName === null ? template.replace(/ oleh \{nama\}/, "") : formatMinuteCopy(template, { nama: entry.actorName });
  let details: ReactNode = null;
  if (entry.kind === "edited" && entry.changes.length > 0) {
    // "Diubah oleh {nama}": the changed fields as the summary, before and after behind a tap (spec 7.2).
    details = (
      <details className="group/change">
        <summary className="-ml-2 inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory [&::-webkit-details-marker]:hidden">
          {entry.changes.map((c) => MINUTE_FIELD_LABEL[c.field]).join(", ")}
        </summary>
        <ul className="mt-1 flex flex-col gap-2">
          {entry.changes.map((change) => (
            <li key={change.field} className="break-words whitespace-pre-line">
              {changeLine(change)}
            </li>
          ))}
        </ul>
      </details>
    );
  } else if (entry.kind === "file_added" || entry.kind === "file_withdrawn") {
    details = (
      <>
        {entry.fileName ? <p className="break-words">{entry.fileName}</p> : null}
        {entry.note ? <p className="break-words whitespace-pre-line">{formatMinuteCopy(D.historyReason, { alasan: entry.note })}</p> : null}
      </>
    );
  } else if (entry.kind === "voided" && entry.note) {
    details = <p className="break-words whitespace-pre-line">{formatMinuteCopy(D.historyReason, { alasan: entry.note })}</p>;
  }
  return { key: String(entry.historyId), title, dateTime: entry.at, dateText: formatDateTime(entry.at), details };
}

/** 'Judul rapat: "lama" menjadi "baru"'; dates read as dates; an empty value reads "kosong". */
function changeLine(change: MinuteFieldChange): string {
  const show = (value: string | null) => {
    if (value === null || value === "") return D.historyEmptyValue;
    return change.field === "meetingDate" ? formatDate(value) : value;
  };
  return formatMinuteCopy(D.historyChange, { isian: MINUTE_FIELD_LABEL[change.field], lama: show(change.before), baru: show(change.after) });
}
