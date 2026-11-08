import Link from "next/link";
import type { ReactNode } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import {
  CONDITION_LABEL,
  formatInventoryCopy,
  INVENTORY_ERROR_COPY,
  rangeDays,
  TIMELINE_EVENT_LABEL,
  type EvidencePhotoLink,
  type InventoryCapabilities,
  type InventoryResult,
  type RequestDetail,
  type RequestLine,
  type RequestTimelineEntry,
} from "../types";
import { CancelRequest } from "./cancel-request";
import { RequestChips } from "./chips";
import { COPY, pendingOverlapText, returnedPartialText, sentOutsideText, STAFF_COPY } from "./copy";
import { EvidencePhotos } from "./evidence-photos";
import { formatCount, formatDate, formatDateTime, formatRange } from "./format";
import { NarrowPage } from "./inventory-header";
import { ReviewPanel } from "./review-panel";
import { requestFormHref, type RequestNotice } from "./routes";
import { StaffActions } from "./staff-actions";
import { BackLink, SectionCard } from "./states";

/**
 * Detail Pengajuan (design screens 7 and 8, 10.2-10.4, 11.2-11.4; P14). The requester sees status,
 * decision, timeline and "Batalkan pengajuan". Heads also get the review panel; Operations the
 * handover, return and correction buttons. Every button follows the database's `actions` for this
 * viewer (absent, never greyed); the Server Actions and the database decide again.
 */
export function RequestDetailScreen({
  detail,
  capabilities,
  notice,
  back,
  loadPhotos,
  today,
}: {
  detail: RequestDetail;
  capabilities: InventoryCapabilities;
  notice: RequestNotice | null;
  back: { href: string; label: string };
  loadPhotos: (requestId: string) => Promise<InventoryResult<EvidencePhotoLink[]>>;
  /** Jakarta date, for the "not before the start date" hint of the handover (A-IB8). */
  today: string;
}) {
  const statusLine = statusText(detail);
  const overlap = detail.status === "submitted" ? (detail.pendingOverlapCount ?? 0) : 0;
  const ownWhileHead = detail.isOwn && capabilities.canApprove && detail.status === "submitted";
  const tooEarly = capabilities.canHandle && detail.status === "approved" && !detail.actions.canHandOver && detail.startDate > today;
  const canDecide = detail.status === "submitted" && (detail.actions.canApprove || detail.actions.canReject);
  const canAskAgain =
    detail.isOwn && capabilities.canSubmitRequest && (detail.status === "rejected" || detail.status === "cancelled");

  return (
    <NarrowPage>
      <BackLink href={back.href}>{back.label}</BackLink>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-display-sm text-title tabular-nums">Pengajuan {detail.reference}</h1>
        <RequestChips source={detail} />
      </div>

      {notice ? <SuccessNotice notice={notice} detail={detail} /> : null}

      {overlap > 0 ? (
        <AlertMessage role="status" tone="warning">
          {pendingOverlapText(overlap)}
        </AlertMessage>
      ) : null}
      {ownWhileHead ? (
        <AlertMessage role="status" tone="info">
          {INVENTORY_ERROR_COPY.self_approval_blocked}
          {detail.otherApproverCount === 0 ? ` ${STAFF_COPY.ownRequestOneHead}` : null}
        </AlertMessage>
      ) : null}
      {tooEarly ? (
        <AlertMessage role="status" tone="info">
          {formatInventoryCopy(INVENTORY_ERROR_COPY.too_early ?? "", { tanggal: formatDate(detail.startDate) })}
        </AlertMessage>
      ) : null}

      {detail.isOverdue ? (
        <AlertMessage role="status" tone="warning">
          Terlambat {detail.overdueDays} hari. Kembalikan barang ke tim Operasional.
        </AlertMessage>
      ) : detail.isNotPickedUp ? (
        <AlertMessage role="status" tone="info">
          Barang belum diambil. Ambil ke tim Operasional, atau batalkan pengajuan kalau tidak jadi.
        </AlertMessage>
      ) : statusLine ? (
        <p className="text-body-md text-ink-body">{statusLine}</p>
      ) : null}

      <SectionCard title="Ringkasan" id="request-summary">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-body-md">
          <dt className="text-ink-meta">Pemohon</dt>
          <dd className="break-words text-ink">
            {detail.isOutsideParty ? (
              <>
                {detail.outsideOrgName} (pihak luar)
                {detail.outsideContactName ? (
                  <span className="block text-body-sm text-ink-body">Penanggung jawab {detail.outsideContactName}</span>
                ) : null}
                {detail.requesterName ? (
                  <span className="block text-body-sm text-ink-body">Dicatat oleh {detail.requesterName}</span>
                ) : null}
              </>
            ) : (
              (detail.requesterName ?? "-")
            )}
          </dd>
          <dt className="text-ink-meta">Tanggal</dt>
          <dd className="text-ink tabular-nums">
            {formatRange(detail.startDate, detail.endDate)} ({rangeDays(detail.startDate, detail.endDate)} hari)
          </dd>
          <dt className="text-ink-meta">Keperluan</dt>
          <dd className="break-words whitespace-pre-line text-ink">{detail.purpose}</dd>
          {detail.note ? (
            <>
              <dt className="text-ink-meta">Catatan</dt>
              <dd className="break-words whitespace-pre-line text-ink">{detail.note}</dd>
            </>
          ) : null}
        </dl>
      </SectionCard>

      <SectionCard title="Barang" id="request-lines">
        <ul className="flex flex-col divide-y divide-row-line">
          {detail.lines.map((line) => (
            <li key={line.lineId} className="py-3 first:pt-0 last:pb-0">
              <LineBlock line={line} detail={detail} loadPhotos={loadPhotos} />
            </li>
          ))}
        </ul>
      </SectionCard>

      {detail.decidedAt && detail.decidedByName ? (
        <SectionCard title="Keputusan" id="request-decision">
          <p className="text-body-md font-semibold text-ink">
            {detail.status === "rejected" ? "Ditolak" : "Disetujui"} oleh {detail.decidedByName}
          </p>
          <p className="text-body-sm text-ink-meta">
            <time dateTime={detail.decidedAt}>{formatDateTime(detail.decidedAt)}</time>
          </p>
          {detail.decisionNote ? (
            <p className="mt-2 text-body-md break-words whitespace-pre-line text-ink-body">&ldquo;{detail.decisionNote}&rdquo;</p>
          ) : null}
        </SectionCard>
      ) : null}

      {canDecide ? <ReviewPanel detail={detail} /> : null}

      <SectionCard title="Riwayat" id="request-timeline">
        <Timeline label={`Riwayat pengajuan ${detail.reference}`} entries={timelineEntries(detail.timeline)} />
      </SectionCard>

      <StaffActions detail={detail} />

      {detail.actions.canCancel ? (
        <CancelRequest
          requestId={detail.requestId}
          reference={detail.reference}
          version={detail.version}
          reasonRequired={detail.actions.cancelReasonRequired}
        />
      ) : null}

      {canAskAgain ? (
        <Link href={requestFormHref({ again: detail.reference })} className={buttonClass("outline")}>
          Ajukan lagi
        </Link>
      ) : null}
    </NarrowPage>
  );
}

function SuccessNotice({ notice, detail }: { notice: RequestNotice; detail: RequestDetail }) {
  const text = noticeText(notice, detail);
  return (
    <AlertMessage role="status" tone="success">
      {text}
    </AlertMessage>
  );
}

/** One-time success text after a save (design 9.4, 10.5, 11.5, 12.3, 13.5). */
function noticeText(notice: RequestNotice, detail: RequestDetail): string {
  switch (notice) {
    case "cancelled":
      return COPY.cancelled;
    case "sent_outside":
      return detail.outsideOrgName ? sentOutsideText(detail.outsideOrgName) : COPY.sent;
    case "sent":
      return COPY.sent;
    case "approved":
      return STAFF_COPY.approved;
    case "rejected":
      return STAFF_COPY.rejected;
    case "extended":
      return STAFF_COPY.extended;
    case "handed_over":
      return STAFF_COPY.handedOver;
    case "returned_all":
      return STAFF_COPY.returnedAll;
    case "returned_partial":
      return returnedPartialText(detail.qtyOutstanding);
    case "returned_issue":
      return STAFF_COPY.returnedIssue;
    case "corrected":
      return STAFF_COPY.corrected;
  }
}

/** The extra line per status (design 10.3). Derived states have their own alert above. */
function statusText(detail: RequestDetail): string | null {
  switch (detail.status) {
    case "submitted":
      return "Menunggu keputusan dari kepala Operasional.";
    case "approved":
      return "Ambil barang ke tim Operasional pada tanggal mulai.";
    case "borrowed":
      return detail.isPartiallyReturned
        ? `Sisa belum kembali: ${formatCount(detail.qtyOutstanding)}.`
        : `Kembalikan barang ke tim Operasional paling lambat ${formatDate(detail.endDate)}.`;
    case "returned":
      return "Semua barang sudah kembali.";
    default:
      return null;
  }
}

/** One line: name, code or units, the quantity cells that apply so far, what is still out, issues. */
function LineBlock({
  line,
  detail,
  loadPhotos,
}: {
  line: RequestLine;
  detail: RequestDetail;
  loadPhotos: (requestId: string) => Promise<InventoryResult<EvidencePhotoLink[]>>;
}) {
  const live = line.returns.filter((r) => !r.isReversed);
  const returned = line.returnedGood + line.returnedDamaged + line.returnedLost;
  const damaged = live.filter((r) => r.outcome === "damaged");
  const photoIds = live.flatMap((r) => r.photos.map((p) => p.photoId));
  const cells: { label: string; value: number }[] = [{ label: "Diminta", value: line.quantityRequested }];
  if (line.quantityApproved !== null) cells.push({ label: "Disetujui", value: line.quantityApproved });
  if (line.quantityHandedOver !== null) {
    cells.push({ label: "Diserahkan", value: line.quantityHandedOver });
    cells.push({ label: "Kembali", value: returned });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-body-md font-semibold break-words text-ink">{line.itemName}</p>
        <p className="text-body-sm text-ink-meta tabular-nums">
          {line.mode === "quantity" ? line.itemCode : "Dilacak per unit"}
          {line.itemIsActive ? null : " · Tidak aktif"}
        </p>
      </div>
      <dl className="grid grid-cols-4 gap-2">
        {cells.map((cell) => (
          <div key={cell.label} className="min-w-0">
            <dt className="text-body-sm text-ink-meta">{cell.label}</dt>
            <dd className="text-body-md font-semibold text-ink tabular-nums">{formatCount(cell.value)}</dd>
          </div>
        ))}
      </dl>
      {line.units.length > 0 ? (
        <p className="text-body-sm break-words text-ink-body tabular-nums">Unit: {line.units.map((u) => u.code).join(", ")}</p>
      ) : null}
      {detail.status === "borrowed" && line.outstanding > 0 ? (
        <p className="text-body-sm text-ink-body tabular-nums">Sisa belum kembali: {formatCount(line.outstanding)}</p>
      ) : null}
      {damaged.map((r) => (
        <p key={r.returnId} className="text-body-sm text-ink-body tabular-nums">
          Rusak {formatCount(r.quantity)}
          {r.unitCode ? ` (${r.unitCode})` : null}
          {r.resultingCondition ? `, sekarang ${CONDITION_LABEL[r.resultingCondition]}` : null}
        </p>
      ))}
      {line.returnedLost > 0 ? (
        <p className="text-body-sm text-ink-body tabular-nums">Hilang {formatCount(line.returnedLost)}</p>
      ) : null}
      {photoIds.length > 0 ? (
        <EvidencePhotos
          requestId={detail.requestId}
          reference={detail.reference}
          photoIds={photoIds}
          itemName={line.itemName}
          loadPhotos={loadPhotos}
        />
      ) : null}
    </div>
  );
}

/** Newest first (the contract sends oldest first). A missing name drops the "oleh {nama}" part. */
function timelineEntries(timeline: RequestTimelineEntry[]): TimelineEntry[] {
  return [...timeline].reverse().map((entry, index) => {
    const label = TIMELINE_EVENT_LABEL[entry.event];
    const title =
      entry.actorName === null
        ? label.replace(/,? (oleh|dicatat) \{nama\}/, "")
        : formatInventoryCopy(label, { nama: entry.actorName });
    let details: ReactNode = null;
    if (entry.event === "extended") {
      details = (
        <>
          <p>
            {formatDate(entry.oldEndDate)} menjadi {formatDate(entry.newEndDate)}
          </p>
          <p className="whitespace-pre-line">Catatan: {entry.note}</p>
        </>
      );
    } else if (entry.note) {
      details = <p className="whitespace-pre-line">Catatan: {entry.note}</p>;
    }
    return { key: `${entry.event}-${entry.at}-${index}`, title, dateTime: entry.at, dateText: formatDateTime(entry.at), details };
  });
}
