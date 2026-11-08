import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { rangeDays, type OpenLoanRow, type QueueRow } from "../types";
import { RequestChips } from "./chips";
import { pendingOverlapShort } from "./copy";
import { formatCount, formatRange } from "./format";
import { requestHref } from "./routes";

type CardRow = (QueueRow | OpenLoanRow) & { hasIssue?: boolean; pendingOverlapCount?: number };

/**
 * One request in Antrean and in the handover list (design 11.1, 14.2: one card pattern). The requester
 * is the link text, stretched over the card; the focus ring goes around the card. "Pengajuanmu" marks
 * the viewer's own request in plain text. The warning line is icon plus a full sentence.
 */
export function QueueCard({ row }: { row: CardRow }) {
  const who = row.isOutsideParty && row.outsideOrgName ? row.outsideOrgName : (row.requesterName ?? row.reference);
  const days = rangeDays(row.startDate, row.endDate);
  const overlap = row.status === "submitted" ? (row.pendingOverlapCount ?? 0) : 0;

  return (
    <article
      className={cn(
        "relative flex flex-col gap-1.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 transition-colors duration-150 hover:border-ivory-line motion-reduce:transition-none",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-walnut",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 className="min-w-0 text-headline-sm break-words text-ink">
          <Link
            href={requestHref(row.reference)}
            aria-label={`Pengajuan ${row.reference} dari ${who}${row.isOwn ? ", pengajuanmu" : ""}`}
            className="text-walnut after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
          >
            {who}
          </Link>
          {row.isOwn ? <span className="ml-2 text-body-sm font-normal text-ink-body">(Pengajuanmu)</span> : null}
        </h3>
        <RequestChips source={{ ...row, hasIssue: row.hasIssue ?? false }} compact />
      </div>
      {row.isOutsideParty && row.requesterName ? (
        <p className="text-body-sm break-words text-ink-body">Dicatat oleh {row.requesterName}</p>
      ) : null}
      <p className="text-body-md break-words text-ink">{itemSummary(row)}</p>
      <p className="text-body-sm text-ink-meta tabular-nums">
        {row.reference} · {formatRange(row.startDate, row.endDate)} · {days} hari
      </p>
      {row.status === "borrowed" && row.qtyOutstanding > 0 ? (
        <p className="text-body-sm text-ink-body tabular-nums">Sisa belum kembali {formatCount(row.qtyOutstanding)}</p>
      ) : null}
      {overlap > 0 ? (
        <p className="flex items-start gap-1.5 text-body-sm text-warn">
          <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" strokeWidth={2} />
          {pendingOverlapShort(overlap)}
        </p>
      ) : null}
    </article>
  );
}

/** "[Barang A] x2, [Barang B] x1 +2 barang": the approved quantity once decided, else the requested one. */
function itemSummary(row: CardRow): string {
  const parts = row.items.map((item) => `${item.name} x${formatCount(item.quantityApproved ?? item.quantityRequested)}`);
  const shown = parts.slice(0, 3).join(", ");
  const rest = parts.length - 3;
  return rest > 0 ? `${shown} +${rest} barang` : shown;
}
