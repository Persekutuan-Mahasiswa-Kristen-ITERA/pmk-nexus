import { CalendarDays, FileText } from "lucide-react";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { CountUp } from "@/components/ui/count-up";
import { DashboardCard, DashboardCardLink } from "@/components/ui/dashboard-card";
import { buttonClass } from "@/components/ui/nx-button";
import { SkeletonBar } from "@/components/ui/skeleton-bar";
import { formatMinuteCopy, MINUTE_COPY, MINUTE_ROUTES, type MinuteDashboardCounts } from "../types";
import { UI_COPY } from "./copy";
import { formatDate } from "./format";

const TITLE_ID = "minutes-card-title";
const C = MINUTE_COPY.dashboard;

function Card({ slot, children }: { slot: number; children: React.ReactNode }) {
  return (
    <DashboardCard slot={slot} titleId={TITLE_ID} title={C.title} icon={<FileText aria-hidden="true" className="size-5" strokeWidth={2} />}>
      {children}
    </DashboardCard>
  );
}

/**
 * Dashboard card "Notulensi Rapat" (spec 7 screen 8, N5 a): counts only, never a title, so a sensitive
 * title never leaves the module. Aktif minutes of the active period inside this person's units (a
 * department secretary counts her unit only). Errors stay inside the card.
 */
export function MinutesCard({ result, slot = 0 }: { result: { kind: "ok"; counts: MinuteDashboardCounts } | { kind: "error" }; slot?: number }) {
  if (result.kind === "error") {
    return (
      <Card slot={slot}>
        <p role="alert" className="text-body-md text-warn">
          {C.error}
        </p>
        <ListNavigationProvider>
          <RetryButton className={buttonClass("text", "-ml-2 self-start")} />
        </ListNavigationProvider>
      </Card>
    );
  }

  const { counts } = result;
  const label = counts.periodLabel ?? "";
  // "{n} notulensi di periode {label}": the number at figure size, the rest of the sentence under it.
  const [, rest = ""] = C.count.split("{n}");
  return (
    <Card slot={slot}>
      {counts.minuteCount === 0 ? (
        <p className="text-body-md text-ink-body">{C.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <p className="sr-only">{formatMinuteCopy(C.count, { n: counts.minuteCount, label })}</p>
            <p aria-hidden="true" className="nx-figure-lg text-ink">
              <CountUp value={counts.minuteCount} announce={false} />
            </p>
            <p aria-hidden="true" className="text-body-md font-semibold text-ink">
              {formatMinuteCopy(rest.trim(), { label })}
            </p>
          </div>
          {counts.latestMeetingDate ? (
            <p className="inline-flex items-center gap-2 self-start rounded-lg border border-gold-tint-line bg-gold-tint px-3 py-2 text-body-md text-ink tabular-nums">
              <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-walnut" strokeWidth={2} />
              {formatMinuteCopy(C.latest, { tanggal: formatDate(counts.latestMeetingDate) })}
            </p>
          ) : null}
        </div>
      )}
      <DashboardCardLink href={MINUTE_ROUTES.list}>{C.link}</DashboardCardLink>
    </Card>
  );
}

/** Loading shape: flat ivory bars with the sweep, and a caption. */
export function MinutesCardSkeleton({ slot = 0 }: { slot?: number }) {
  return (
    <Card slot={slot}>
      <p role="status" className="text-body-sm text-ink-body">
        {UI_COPY.loadingDashboard}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonBar className="h-10 w-[60px]" />
        <SkeletonBar className="h-3 w-[180px]" />
        <SkeletonBar className="mt-1 h-9 w-[200px] rounded-lg" />
      </div>
    </Card>
  );
}
