import Link from "next/link";
import type { ReactNode } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import {
  formatLetterCopy,
  LETTER_REQUEST_EVENT_DETAIL,
  LETTER_REQUEST_EVENT_LABEL,
  letterRequestStage,
  OPEN_LETTER_REQUEST_STATUSES,
  type LetterCapabilities,
  type LetterRequestDetail,
  type LetterRequestTimelineEntry,
} from "../types";
import { RequestChips } from "./chips";
import { COPY, issuedText, rejectedWithNumberText } from "./copy";
import { FileList } from "./file-list";
import { formatDate, formatDateTime } from "./format";
import { NumberPlate, NumberText } from "./letter-number";
import { NarrowPage } from "./letters-header";
import { CancelRequestButton, FocusOnMount, ReviewPanel } from "./request-actions";
import { letterHref, MY_REQUESTS_PATH, QUEUE_PATH, requestFormHref, type RequestNotice } from "./routes";
import { BackLink, DetailRows, SectionCard, SuccessNotice } from "./states";

const PLATE_ID = "request-number";

/**
 * One request (design screens 7 and 9, 10.2-10.4, 12.1): the requester reads where it stands and
 * downloads the letter; a secretary acts on the same page through the "Tindakan" panel. Buttons follow
 * the database's `actions` for this viewer (absent, never greyed); the actions and the database decide
 * again. From 1024 px Riwayat sits in a right column.
 */
export function RequestDetailScreen({
  detail,
  capabilities,
  notice,
  activePeriodLabel,
}: {
  detail: LetterRequestDetail;
  capabilities: LetterCapabilities;
  notice: RequestNotice | null;
  activePeriodLabel: string | null;
}) {
  const stage = letterRequestStage(detail);
  const open = (OPEN_LETTER_REQUEST_STATUSES as readonly string[]).includes(detail.status);
  const staffView = !detail.isOwn && capabilities.canViewAllRequests;
  const canAct = detail.actions.canProcess || detail.actions.canTakeNumber || detail.actions.canIssue || detail.actions.canReject;
  const canAskAgain = detail.isOwn && capabilities.canSubmitRequest && (detail.status === "rejected" || detail.status === "cancelled");
  const back = detail.isOwn || !capabilities.canViewAllRequests ? { href: MY_REQUESTS_PATH, label: "Permohonan Saya" } : { href: QUEUE_PATH, label: "Antrean" };

  return (
    <NarrowPage wide>
      <div className="flex flex-col gap-4 lg:gap-5">
        <BackLink href={back.href}>{back.label}</BackLink>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-display-sm text-balance break-words text-title">{detail.subject}</h1>
          <RequestChips source={{ ...detail, isPastDue: staffView ? detail.isPastDue : false }} />
        </div>

        {notice ? <Notice notice={notice} detail={detail} canViewRegister={capabilities.canViewRegister} /> : null}

        {staffView && open && !detail.isActivePeriod ? (
          <AlertMessage role="status" tone="info">
            Permohonan ini dari periode {detail.periodLabel ?? "sebelumnya"}.
            {activePeriodLabel ? ` Suratnya akan dicatat di periode ${activePeriodLabel}.` : ""}
          </AlertMessage>
        ) : null}
        {staffView && open && detail.requesterIsActive === false ? (
          <AlertMessage role="status" tone="info">
            {COPY.requesterInactive}
          </AlertMessage>
        ) : null}
        {detail.isOwn && open && capabilities.canProcessRequests ? (
          <AlertMessage role="status" tone="info">
            {COPY.ownRequest}
            {capabilities.canManageRegister ? ` ${COPY.ownRequestManager}` : ""}
            {detail.otherProcessorCount === 0 ? ` ${COPY.ownRequestLone}` : ""}
          </AlertMessage>
        ) : null}

        {detail.numberText && (stage === "awaiting_file" || stage === "issued") ? (
          <NumberPlate id={PLATE_ID} numberText={detail.numberText} />
        ) : null}
        {notice === "number_taken" ? <FocusOnMount targetId={PLATE_ID} /> : null}

        {staffView && capabilities.canProcessRequests && stage === "awaiting_file" ? (
          <AlertMessage role="status" tone="info">
            {COPY.awaitingFileProcessor}
          </AlertMessage>
        ) : null}
        {detail.isOwn ? <StateLine detail={detail} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          {detail.letterFiles.length > 0 ? (
            <SectionCard title="Berkas surat" id="request-letter-files">
              <FileList
                files={detail.letterFiles}
                parent={{ parent: "request", requestId: detail.requestId }}
                openLabel={detail.isOwn ? "Unduh" : "Lihat"}
              />
            </SectionCard>
          ) : null}

          <SectionCard title="Permohonan" id="request-facts">
            <DetailRows rows={factRows(detail, staffView)} />
          </SectionCard>

          {detail.attachments.length > 0 ? (
            <SectionCard title={`Lampiran (${detail.attachments.length})`} id="request-attachments">
              <FileList files={detail.attachments} parent={{ parent: "request", requestId: detail.requestId }} />
            </SectionCard>
          ) : null}

          {detail.note && (detail.status === "rejected" || detail.status === "processing" || detail.status === "issued") ? (
            <SectionCard title="Catatan dari sekretaris" id="request-note">
              {detail.noteByName ? <p className="text-body-md font-semibold text-ink">{detail.noteByName}</p> : null}
              {detail.noteAt ? (
                <p className="text-body-sm text-ink-meta">
                  <time dateTime={detail.noteAt}>{formatDateTime(detail.noteAt)}</time>
                </p>
              ) : null}
              <p className="mt-2 text-body-md break-words whitespace-pre-line text-ink">&ldquo;{detail.note}&rdquo;</p>
            </SectionCard>
          ) : null}

          {canAct && !detail.isOwn ? <ReviewPanel detail={detail} /> : null}

          {detail.actions.canCancel || canAskAgain ? (
            <div className="flex flex-col gap-2">
              {detail.actions.canCancel ? <CancelRequestButton requestId={detail.requestId} version={detail.version} /> : null}
              {canAskAgain ? (
                <Link href={requestFormHref(detail.requestId)} className={buttonClass("outline")}>
                  Ajukan lagi
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <SectionCard title={COPY.historyTitle} id="request-timeline" className="lg:sticky lg:top-6">
          <Timeline label="Riwayat permohonan" entries={timelineEntries(detail.timeline)} />
        </SectionCard>
      </div>
    </NarrowPage>
  );
}

function Notice({ notice, detail, canViewRegister }: { notice: RequestNotice; detail: LetterRequestDetail; canViewRegister: boolean }) {
  switch (notice) {
    case "sent":
      return <SuccessNotice>{COPY.sent}</SuccessNotice>;
    case "cancelled":
      return <SuccessNotice>{COPY.cancelled}</SuccessNotice>;
    case "processed":
      return <SuccessNotice>{COPY.processed}</SuccessNotice>;
    case "number_taken":
      return detail.numberText ? (
        <SuccessNotice>
          {COPY.numberTakenLead}
          <strong className="font-bold">
            <NumberText value={detail.numberText} />
          </strong>
          {COPY.numberTakenTail}
        </SuccessNotice>
      ) : null;
    case "issued":
      return (
        <div className="flex flex-col gap-1">
          <SuccessNotice>{detail.numberText ? issuedText(detail.numberText) : COPY.unavailable}</SuccessNotice>
          {canViewRegister && detail.letterId ? (
            <Link href={letterHref(detail.letterId)} className={buttonClass("text", "-ml-2 self-start")}>
              {COPY.seeInRegister}
            </Link>
          ) : null}
        </div>
      );
    case "rejected": {
      const taken = [...detail.timeline].reverse().find((entry) => entry.event === "number_taken")?.numberText ?? null;
      return <SuccessNotice>{taken ? rejectedWithNumberText(taken) : COPY.rejected}</SuccessNotice>;
    }
  }
}

/** The requester's state line (design 10.3). Voided number: a warning alert instead (G5). */
function StateLine({ detail }: { detail: LetterRequestDetail }) {
  const stage = letterRequestStage(detail);
  const text: Record<typeof stage, string> = {
    submitted: "Menunggu sekretaris. Kamu masih bisa membatalkannya sampai sekretaris mulai memprosesnya.",
    processing:
      "Sekretaris sedang menyiapkan suratmu. Permohonan ini sudah tidak bisa dibatalkan. Kalau ada yang perlu diubah, hubungi sekretaris di luar aplikasi.",
    awaiting_file:
      "Nomor suratmu sudah diambil, menunggu file final. Berkas suratnya menyusul setelah suratnya ditandatangani. Permohonan ini sudah tidak bisa dibatalkan.",
    issued: "Suratmu sudah terbit. Unduh berkasnya di bawah.",
    issued_number_voided:
      "Nomor surat ini sudah dibatalkan oleh pengelola surat, jadi berkasnya tidak tersedia lagi. Ajukan permohonan baru kalau kamu masih membutuhkan surat.",
    rejected: "Permohonan ditolak. Baca catatan sekretaris di bawah.",
    cancelled: "Permohonan dibatalkan.",
  };
  if (stage === "issued_number_voided") {
    return (
      <AlertMessage role="status" tone="warning">
        {text[stage]}
      </AlertMessage>
    );
  }
  return (
    <p className="rounded-xl border border-surface-line bg-surface px-4 py-3 text-body-md text-ink shadow-elevation-1">{text[stage]}</p>
  );
}

function factRows(detail: LetterRequestDetail, staffView: boolean): { label: string; value: ReactNode }[] {
  const rows: { label: string; value: ReactNode }[] = [];
  if (staffView) rows.push({ label: "Pemohon", value: detail.requesterName ?? "-" });
  if (detail.onBehalfOf) rows.push({ label: "Atas nama", value: detail.onBehalfOf });
  rows.push({ label: "Ditujukan kepada", value: detail.addressee });
  rows.push({ label: "Keperluan", value: detail.purpose });
  if (detail.neededBy) {
    rows.push({
      label: "Dibutuhkan paling lambat",
      value: (
        <>
          {formatDate(detail.neededBy)}
          {staffView && detail.isPastDue && detail.daysPastDue ? (
            <span className="block text-body-sm font-semibold text-warn">(lewat {detail.daysPastDue} hari)</span>
          ) : null}
        </>
      ),
    });
  }
  rows.push({ label: "Diajukan", value: <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time> });
  if (detail.periodLabel && !detail.isActivePeriod) rows.push({ label: "Periode", value: detail.periodLabel });
  return rows;
}

/** Newest first (the contract sends oldest first). A missing name drops the "oleh {nama}" part. */
function timelineEntries(timeline: LetterRequestTimelineEntry[]): TimelineEntry[] {
  return [...timeline].reverse().map((entry, index) => {
    const template = LETTER_REQUEST_EVENT_LABEL[entry.event];
    const title =
      entry.actorName === null ? template.replace(/,? (oleh|dicatat) \{nama\}/, "") : formatLetterCopy(template, { nama: entry.actorName });
    const lines: ReactNode[] = [];
    if (entry.event === "number_taken" && entry.numberText) {
      lines.push(
        <p key="n">
          Nomor <NumberText value={entry.numberText} />
        </p>,
      );
    }
    if (entry.event === "issued") lines.push(<p key="i">{LETTER_REQUEST_EVENT_DETAIL.issued}</p>);
    if (entry.note) {
      const word = entry.event === "rejected" || entry.event === "cancelled" ? "Alasan" : "Catatan";
      lines.push(
        <p key="c" className="whitespace-pre-line">
          {word}: {entry.note}
        </p>,
      );
    }
    return {
      key: `${entry.event}-${entry.at}-${index}`,
      title,
      dateTime: entry.at,
      dateText: formatDateTime(entry.at),
      details: lines.length > 0 ? lines : undefined,
    };
  });
}
