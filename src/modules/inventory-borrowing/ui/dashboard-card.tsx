import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { CountUp } from "@/components/ui/count-up";
import { DashboardCard, DashboardCardLink } from "@/components/ui/dashboard-card";
import { buttonClass } from "@/components/ui/nx-button";
import type { InventoryStatusCounts } from "../types";
import { STAFF_COPY } from "./copy";
import { formatCount } from "./format";
import { INVENTORY_PATH, queueHref } from "./routes";
import { SkeletonBar } from "./states";

const TITLE_ID = "inventory-status-title";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <DashboardCard slot={0} titleId={TITLE_ID} title={STAFF_COPY.dashTitle} icon={<Package aria-hidden="true" className="size-5" strokeWidth={2} />}>
      {children}
    </DashboardCard>
  );
}

/**
 * Dashboard card "Inventaris Status" (design screen 13, owner P7 a): counts only, no percentage. The
 * loaned units are part of the good ones, so that count sits under "unit baik" as "di antaranya".
 * Archived entries and lost units are not counted (A-IB32). Errors stay inside the card.
 */
export function InventoryStatusCard({
  result,
  pendingApprovals,
}: {
  result: { kind: "ok"; counts: InventoryStatusCounts } | { kind: "error" };
  /** Heads only: Diajukan requests (design 16.2); null hides the line. */
  pendingApprovals: number | null;
}) {
  if (result.kind === "error") {
    return (
      <Card>
        <p role="alert" className="text-body-md text-warn">
          {STAFF_COPY.dashError}
        </p>
        <ListNavigationProvider>
          <RetryButton className={buttonClass("text", "-ml-2 self-start")} />
        </ListNavigationProvider>
      </Card>
    );
  }

  const { counts } = result;
  return (
    <Card>
      {counts.itemCount === 0 ? (
        <p className="text-body-md text-ink-body">{STAFF_COPY.dashEmpty}</p>
      ) : (
        <>
          <p className="sr-only">
            {formatCount(counts.goodCount)} unit baik, {formatCount(counts.goodOnLoanCount)} sedang dipinjam,{" "}
            {formatCount(counts.needsServiceCount)} perlu servis
          </p>
          {/* Two figures split by a line; "perlu servis" turns warning brown only when it is not zero. */}
          <div aria-hidden="true" className="grid grid-cols-2 divide-x divide-row-line">
            <div className="min-w-0 pr-4">
              <p className="nx-figure-lg text-ink">
                <CountUp value={counts.goodCount} announce={false} />
              </p>
              <p className="text-body-md font-semibold text-ink">unit baik</p>
              <p className="mt-0.5 text-body-sm text-ink-meta">{formatCount(counts.goodOnLoanCount)} di antaranya sedang dipinjam</p>
            </div>
            <div className="min-w-0 pl-4">
              <p className={`nx-figure-lg ${counts.needsServiceCount > 0 ? "text-warn" : "text-ink"}`}>
                <CountUp value={counts.needsServiceCount} announce={false} />
              </p>
              <p className="text-body-md font-semibold text-ink">unit perlu servis</p>
            </div>
          </div>
        </>
      )}
      {pendingApprovals !== null && pendingApprovals > 0 ? (
        // The one thing a head acts on from here, so it sits as a tinted row above the plain link.
        <Link
          href={queueHref({ view: "pending" })}
          className="nx-press flex min-h-12 items-center justify-between gap-3 rounded-lg border border-gold-tint-line bg-gold-tint px-3 text-label-lg text-walnut hover:border-ivory-line hover:bg-ivory"
        >
          <span className="tabular-nums">{formatCount(pendingApprovals)} pengajuan menunggu persetujuan</span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
        </Link>
      ) : null}
      <DashboardCardLink href={INVENTORY_PATH}>{STAFF_COPY.dashCatalogLink}</DashboardCardLink>
    </Card>
  );
}

/** Loading shape (design 16.2): ivory bars with the loading sweep, and a caption. */
export function InventoryStatusSkeleton() {
  return (
    <Card>
      <p role="status" className="text-body-sm text-ink-body">
        {STAFF_COPY.dashLoading}
      </p>
      <div aria-hidden="true" className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <SkeletonBar className="h-10 w-[80px]" />
            <SkeletonBar className="h-3.5 w-[100px]" />
          </div>
        ))}
      </div>
    </Card>
  );
}
