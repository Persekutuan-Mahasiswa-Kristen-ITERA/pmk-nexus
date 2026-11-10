import { AlertMessage } from "@/components/ui/alert-message";
import { HeaderStat, PageHeaderCard } from "@/components/ui/page-header-card";
import { MINUTE_COPY, type MinuteDashboardCounts } from "../types";
import { formatDate } from "./format";

/**
 * Title block of the list (spec 7 screen 1, D-023): the warm header card with the period pill, the
 * Playfair title, one line about what a minute is, and two tiles: minutes of this period and the date of
 * the latest meeting. Tiles are hidden when the counts could not be read (a hint, not data). Managers
 * without an active period get the banner under the card.
 */
export function MinutesHeader({
  periodLabel,
  counts,
  showNoPeriodBanner,
}: {
  periodLabel: string | null;
  counts: MinuteDashboardCounts | null;
  showNoPeriodBanner: boolean;
}) {
  const tiles = counts && counts.periodId !== null ? counts : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderCard periodLabel={periodLabel} title={MINUTE_COPY.moduleTitle}>
        <p className="max-w-[34ch] text-body-lg text-ink-body">{MINUTE_COPY.form.subtitle}</p>
        {tiles ? (
          <dl aria-label="Ringkasan notulensi" className="mt-1 grid grid-cols-2 gap-2 md:max-w-md md:gap-3">
            <HeaderStat label={MINUTE_COPY.list.tileCount} value={tiles.minuteCount} />
            <LatestMeetingStat date={tiles.latestMeetingDate} />
          </dl>
        ) : null}
      </PageHeaderCard>
      {showNoPeriodBanner ? (
        <AlertMessage role="status" tone="info">
          {MINUTE_COPY.noActivePeriod}
        </AlertMessage>
      ) : null}
    </div>
  );
}

/**
 * "Rapat terakhir": same frame as HeaderStat. The day is set at figure size and the month and year next
 * to it, so both tiles share one baseline at 390 px (a full date at figure size would not fit).
 */
function LatestMeetingStat({ date }: { date: string | null }) {
  const [day, ...rest] = date ? formatDate(date).split(" ") : [MINUTE_COPY.list.tileNoDate];
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-gold-tint-line bg-surface px-3 pt-2.5 pb-3 md:px-4">
      <dt className="text-body-sm text-ink-meta">{MINUTE_COPY.list.tileLatest}</dt>
      <dd className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className="nx-figure-md text-ink">{day}</span>
        {rest.length > 0 ? <span className="text-body-md font-semibold text-ink-body tabular-nums">{rest.join(" ")}</span> : null}
      </dd>
    </div>
  );
}
