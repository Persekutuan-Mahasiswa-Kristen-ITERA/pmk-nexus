import { rangeDays, type RequestDetail } from "../types";
import { RequestChips } from "./chips";
import { formatRange } from "./format";

/** Who and when, at the top of the handover and return screens (design 12.1, 13.1). */
export function RequestSummaryCard({ detail }: { detail: RequestDetail }) {
  const who = detail.isOutsideParty && detail.outsideOrgName ? `${detail.outsideOrgName} (pihak luar)` : (detail.requesterName ?? "-");
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-headline-sm break-words text-ink">{who}</p>
        <RequestChips source={detail} compact />
      </div>
      <p className="text-body-sm text-ink-meta tabular-nums">
        {formatRange(detail.startDate, detail.endDate)} · {rangeDays(detail.startDate, detail.endDate)} hari
      </p>
    </div>
  );
}
