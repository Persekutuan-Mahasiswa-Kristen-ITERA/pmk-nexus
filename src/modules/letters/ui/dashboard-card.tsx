import Link from "next/link";
import { ChevronRight, Mail } from "lucide-react";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { CountUp } from "@/components/ui/count-up";
import { DashboardCard, DashboardCardLink } from "@/components/ui/dashboard-card";
import { buttonClass } from "@/components/ui/nx-button";
import { SkeletonBar } from "@/components/ui/skeleton-bar";
import type { LetterDashboardCounts } from "../types";
import { COPY } from "./copy";
import { formatCount } from "./format";
import { INCOMING_PATH, queueViewHref } from "./routes";

const TITLE_ID = "letters-card-title";

function Card({ slot, children }: { slot: number; children: React.ReactNode }) {
  return (
    <DashboardCard slot={slot} titleId={TITLE_ID} title={COPY.dashTitle} icon={<Mail aria-hidden="true" className="size-5" strokeWidth={2} />}>
      {children}
    </DashboardCard>
  );
}

/**
 * Dashboard card "Surat Menyurat" (design screen 12, section 15; P12 a): counts only, never a subject,
 * a counterpart or a number. Aktif letters of the active period (G9); for letter_requests.view_all also
 * the waiting requests of all periods, as the one thing to act on. Errors stay inside the card.
 */
export function LettersCard({
  result,
  slot = 0,
}: {
  result: { kind: "ok"; counts: LetterDashboardCounts } | { kind: "error" };
  slot?: number;
}) {
  if (result.kind === "error") {
    return (
      <Card slot={slot}>
        <p role="alert" className="text-body-md text-warn">
          {COPY.dashError}
        </p>
        <ListNavigationProvider>
          <RetryButton className={buttonClass("text", "-ml-2 self-start")} />
        </ListNavigationProvider>
      </Card>
    );
  }

  const { counts } = result;
  const period = counts.periodLabel ? `di periode ${counts.periodLabel}` : null;
  const waiting = counts.waitingRequestCount;
  const empty = counts.incomingCount === 0 && counts.outgoingCount === 0;
  const spoken = [
    `${formatCount(counts.incomingCount)} surat masuk dan ${formatCount(counts.outgoingCount)} surat keluar${period ? ` ${period}` : ""}`,
    waiting !== null ? `${formatCount(waiting)} permohonan menunggu` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card slot={slot}>
      {empty ? (
        <p className="text-body-md text-ink-body">{COPY.dashEmpty}</p>
      ) : (
        <>
          <p className="sr-only">{spoken}</p>
          <div aria-hidden="true" className="grid grid-cols-2 divide-x divide-row-line">
            <Figure value={counts.incomingCount} unit="surat masuk" note={period} className="pr-4" />
            <Figure value={counts.outgoingCount} unit="surat keluar" note={period} className="pl-4" />
          </div>
        </>
      )}
      {waiting !== null && waiting > 0 ? (
        // The one thing a secretary acts on from here, so it sits as a tinted row above the plain link.
        <Link
          href={queueViewHref("submitted")}
          className="nx-press flex min-h-12 items-center justify-between gap-3 rounded-lg border border-gold-tint-line bg-gold-tint px-3 text-label-lg text-walnut hover:border-ivory-line hover:bg-ivory"
        >
          <span className="tabular-nums">{formatCount(waiting)} permohonan menunggu</span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
        </Link>
      ) : null}
      <DashboardCardLink href={INCOMING_PATH}>{COPY.dashLink}</DashboardCardLink>
    </Card>
  );
}

function Figure({ value, unit, note, className }: { value: number; unit: string; note: string | null; className: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="nx-figure-lg text-ink">
        <CountUp value={value} announce={false} />
      </p>
      <p className="text-body-md font-semibold text-ink">{unit}</p>
      {note ? <p className="mt-0.5 text-body-sm text-ink-meta tabular-nums">{note}</p> : null}
    </div>
  );
}

/** Loading shape (design 15.2): flat ivory bars with the sweep, and a caption. */
export function LettersCardSkeleton({ slot = 0 }: { slot?: number }) {
  return (
    <Card slot={slot}>
      <p role="status" className="text-body-sm text-ink-body">
        {COPY.dashLoading}
      </p>
      <div aria-hidden="true" className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <SkeletonBar className="h-10 w-[60px]" />
            <SkeletonBar className="h-3 w-[90px]" />
          </div>
        ))}
      </div>
    </Card>
  );
}
