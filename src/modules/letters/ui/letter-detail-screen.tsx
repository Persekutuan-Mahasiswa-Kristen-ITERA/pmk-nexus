import Link from "next/link";
import type { ReactNode } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import {
  formatLetterCopy,
  isLastIssuedFile,
  LETTER_CHIP_LABEL,
  LETTER_COUNTERPART_LABEL,
  LETTER_HISTORY_CHANGE_LINE,
  LETTER_HISTORY_LABEL,
  LETTER_TYPE_LABEL,
  letterFieldLabel,
  type LetterDetail,
  type LetterFieldChange,
  type LetterHistoryEntry,
  type LetterType,
} from "../types";
import { LetterStatusChip } from "./chips";
import { COPY } from "./copy";
import { FileList } from "./file-list";
import { formatDate, formatDateTime } from "./format";
import { AddFilesButton, VoidLetterButton } from "./letter-actions";
import { NumberPlate, NumberText } from "./letter-number";
import { NarrowPage } from "./letters-header";
import { letterEditHref, registerFormHref, registerPath, requestHref, type LetterNotice } from "./routes";
import { BackLink, DetailRows, SectionCard, SuccessNotice } from "./states";

/** History entries shown before "Lihat semua riwayat ({n})" (design 6.3). */
const HISTORY_SHOWN = 5;

/**
 * Detail Surat (design screen 3, section 6): the number plate, the banner that applies, Rincian, Berkas
 * and Riwayat. Buttons follow the database's `actions` for this viewer (absent, never greyed); the
 * Server Actions and the database decide again. From 1024 px Riwayat moves to a right column.
 */
export function LetterDetailScreen({
  detail,
  notice,
  canViewRequests,
}: {
  detail: LetterDetail;
  notice: LetterNotice | null;
  /** letter_requests.view_all: "Dari permohonan" links to the request. */
  canViewRequests: boolean;
}) {
  const { actions } = detail;
  const manager = actions.canEdit || actions.canAddFiles || actions.canWithdrawFiles || actions.canVoid;
  const visibleFiles = detail.files.filter((f) => !f.isWithdrawn);

  return (
    <NarrowPage wide>
      <div className="flex flex-col gap-4 lg:gap-5">
        <BackLink href={registerPath(detail.type)}>{LETTER_TYPE_LABEL[detail.type]}</BackLink>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-display-sm text-title">Detail {LETTER_TYPE_LABEL[detail.type]}</h1>
          <span className="flex flex-wrap items-center gap-1.5">
            <LetterStatusChip status={detail.status} />
            {detail.isLegacyNumber ? <StatusChip tone="ivory">{LETTER_CHIP_LABEL.legacyNumber}</StatusChip> : null}
          </span>
        </div>

        {notice ? <Notice notice={notice} detail={detail} /> : null}

        <NumberPlate numberText={detail.numberText} struck={detail.status === "voided"} />

        <Banner detail={detail} manager={manager} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title={COPY.detailsTitle} id="letter-details">
            <DetailRows rows={detailRows(detail, canViewRequests)} />
          </SectionCard>

          <SectionCard title={visibleFiles.length > 0 ? `${COPY.filesTitle} (${visibleFiles.length})` : COPY.filesTitle} id="letter-files">
            {detail.files.length > 0 ? (
              <FileList
                files={detail.files}
                parent={{ parent: "letter", letterId: detail.letterId }}
                withdraw={
                  actions.canWithdrawFiles
                    ? { letterId: detail.letterId, version: detail.version, lastIssuedFile: isLastIssuedFile(detail) }
                    : null
                }
              />
            ) : (
              <p className="text-body-md text-ink-body">{COPY.noFiles}</p>
            )}
            {actions.canAddFiles && actions.filesRoom > 0 ? (
              <AddFilesButton letterId={detail.letterId} version={detail.version} room={actions.filesRoom} />
            ) : actions.canWithdrawFiles && actions.filesRoom === 0 ? (
              <p className="mt-3 text-body-sm text-ink-body">{COPY.filesFull}</p>
            ) : null}
          </SectionCard>

          {actions.canEdit || actions.canVoid ? (
            <div className="flex flex-col gap-2">
              {actions.canEdit ? (
                <Link href={letterEditHref(detail.letterId)} className={buttonClass("outline")}>
                  Ubah rincian
                </Link>
              ) : null}
              {actions.canVoid ? <VoidLetterButton detail={detail} /> : null}
            </div>
          ) : null}
        </div>

        <SectionCard title={COPY.historyTitle} id="letter-history" className="lg:sticky lg:top-6">
          <History entries={detail.history} type={detail.type} numberText={detail.numberText} />
        </SectionCard>
      </div>
    </NarrowPage>
  );
}

function Notice({ notice, detail }: { notice: LetterNotice; detail: LetterDetail }) {
  switch (notice) {
    case "registered":
      return (
        <div className="flex flex-col gap-1">
          <SuccessNotice>
            {COPY.registeredLead}
            <strong className="font-bold tabular-nums">
              <NumberText value={detail.numberText} />
            </strong>
            .
          </SuccessNotice>
          <Link href={registerFormHref(detail.type)} className={buttonClass("text", "-ml-2 self-start")}>
            {COPY.registerAnother}
          </Link>
        </div>
      );
    case "edited":
      return <SuccessNotice>{COPY.edited}</SuccessNotice>;
    case "files_added":
      return <SuccessNotice>{COPY.filesAdded}</SuccessNotice>;
    case "file_withdrawn":
      return <SuccessNotice>{COPY.fileWithdrawn}</SuccessNotice>;
    case "voided":
      return <SuccessNotice>{COPY.voided}</SuccessNotice>;
  }
}

/** At most one banner above Rincian (design 6.2), in the order the cases can occur. */
function Banner({ detail, manager }: { detail: LetterDetail; manager: boolean }) {
  if (detail.status === "voided") {
    const when = detail.voidedAt ? ` pada ${formatDay(detail.voidedAt)}` : "";
    const who = detail.voidedByName ? ` oleh ${detail.voidedByName}` : "";
    const rejected = detail.request?.status === "rejected";
    return (
      <AlertMessage role="status" tone="info">
        Nomor ini dibatalkan{when}
        {who}.{detail.voidReason ? ` Alasan: ${detail.voidReason}.` : ""} Nomor tidak dipakai lagi dan suratnya tidak bisa dipulihkan.
        {rejected && detail.request ? ` Nomor diambil untuk permohonan ${detail.request.subject}, yang ditolak.` : ""}
      </AlertMessage>
    );
  }
  if (!detail.isActivePeriod) {
    return (
      <AlertMessage role="status" tone="info">
        Surat dari periode {detail.periodLabel ?? "sebelumnya"}. Hanya bisa dibaca.
      </AlertMessage>
    );
  }
  if (detail.awaitingFinalFile && detail.request) {
    return (
      <AlertMessage role="status" tone="info">
        Nomor ini diambil untuk permohonan {detail.request.subject}. Berkas finalnya diunggah lewat Terbitkan surat.
      </AlertMessage>
    );
  }
  if (manager && detail.fileCount === 0 && !detail.awaitingFinalFile) {
    return (
      <AlertMessage role="status" tone="info">
        {COPY.managerNoFiles}
      </AlertMessage>
    );
  }
  return null;
}

function formatDay(iso: string): string {
  return formatDateTime(iso).replace(/, .*$/, "");
}

/** Rincian rows by type (design 6.1). Incoming: received, letter date, sender, sender's number ... */
function detailRows(detail: LetterDetail, canViewRequests: boolean): { label: string; value: ReactNode }[] {
  const rows: { label: string; value: ReactNode }[] = [];
  if (detail.type === "incoming") {
    if (detail.receivedDate) rows.push({ label: "Diterima", value: formatDate(detail.receivedDate) });
    if (detail.letterDate) rows.push({ label: "Tanggal surat", value: formatDate(detail.letterDate) });
    rows.push({ label: LETTER_COUNTERPART_LABEL.incoming, value: detail.counterpart });
    if (detail.counterpartNumber) rows.push({ label: "Nomor dari pengirim", value: detail.counterpartNumber });
    rows.push({ label: "Perihal", value: detail.subject });
  } else {
    rows.push({ label: "Perihal", value: detail.subject });
    rows.push({ label: LETTER_COUNTERPART_LABEL.outgoing, value: detail.counterpart });
    if (detail.letterDate) rows.push({ label: "Tanggal surat", value: formatDate(detail.letterDate) });
  }
  if (detail.notes) rows.push({ label: "Catatan", value: detail.notes });
  rows.push({ label: "Periode", value: detail.periodLabel ?? "-" });
  if (detail.type === "outgoing" && detail.request && canViewRequests) {
    rows.push({
      label: "Dari permohonan",
      value: (
        <>
          <Link href={requestHref(detail.request.requestId)} className="text-walnut underline underline-offset-2">
            {detail.request.subject}
          </Link>
          {detail.request.requesterName ? <span className="block text-body-sm text-ink-body">oleh {detail.request.requesterName}</span> : null}
        </>
      ),
    });
  }
  rows.push({
    label: "Dicatat",
    value: (
      <>
        {detail.createdByName ?? "-"}
        <span className="block text-body-sm text-ink-meta">
          <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
        </span>
      </>
    ),
  });
  return rows;
}

/** Riwayat, newest first (design 6.3); more than five sit behind a disclosure. */
function History({ entries, type, numberText }: { entries: LetterHistoryEntry[]; type: LetterType; numberText: string }) {
  if (entries.length === 0) return <p className="text-body-md text-ink-body">{COPY.historyEmpty}</p>;
  const items = entries.map((entry) => historyEntry(entry, type));
  const label = `Riwayat surat ${numberText}`;
  if (items.length <= HISTORY_SHOWN) return <Timeline label={label} entries={items} />;
  return (
    <div className="flex flex-col gap-2">
      <Timeline label={label} entries={items.slice(0, HISTORY_SHOWN)} />
      <details className="group">
        <summary className="-ml-2 inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Lihat semua riwayat ({items.length})</span>
          <span className="hidden group-open:inline">Sembunyikan riwayat lama</span>
        </summary>
        <div className="mt-3">
          <Timeline label={`${label}, lanjutan`} entries={items.slice(HISTORY_SHOWN)} />
        </div>
      </details>
    </div>
  );
}

function historyEntry(entry: LetterHistoryEntry, type: LetterType): TimelineEntry {
  const template = LETTER_HISTORY_LABEL[entry.kind];
  const title =
    entry.actorName === null && template.includes("{nama}")
      ? template.replace(/ oleh \{nama\}/, "")
      : formatLetterCopy(template, { nama: entry.actorName ?? "", file: entry.fileName ?? "berkas" });
  let details: ReactNode = null;
  if (entry.kind === "edited" && entry.changes.length > 0) {
    details = (
      <ul className="flex flex-col gap-0.5">
        {entry.changes.map((change) => (
          <li key={change.field}>{changeLine(change, type)}</li>
        ))}
      </ul>
    );
  } else if ((entry.kind === "file_withdrawn" || entry.kind === "voided") && entry.note) {
    details = <p className="whitespace-pre-line">Alasan: {entry.note}</p>;
  } else if ((entry.kind === "file_added" || entry.kind === "file_withdrawn") && entry.actorName) {
    details = <p>oleh {entry.actorName}</p>;
  }
  return { key: String(entry.historyId), title, dateTime: entry.at, dateText: formatDateTime(entry.at), details };
}

/** 'Perihal: "lama" menjadi "baru"'; dates read as dates; an empty value reads "(kosong)". */
function changeLine(change: LetterFieldChange, type: LetterType): string {
  const show = (value: string | null) => {
    if (value === null || value === "") return "(kosong)";
    return change.field === "letterDate" || change.field === "receivedDate" ? formatDate(value) : value;
  };
  return formatLetterCopy(LETTER_HISTORY_CHANGE_LINE, {
    isian: letterFieldLabel(change.field, type),
    lama: show(change.before),
    baru: show(change.after),
  });
}
