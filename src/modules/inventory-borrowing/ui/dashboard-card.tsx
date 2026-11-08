import Link from "next/link";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { buttonClass } from "@/components/ui/nx-button";
import type { InventoryStatusCounts } from "../types";
import { STAFF_COPY } from "./copy";
import { formatCount } from "./format";
import { INVENTORY_PATH, queueHref } from "./routes";
import { SkeletonBar } from "./states";

const CARD = "flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1";

function Title() {
  return (
    <h2 id="inventory-status-title" className="text-headline-sm text-ink">
      {STAFF_COPY.dashTitle}
    </h2>
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
      <section aria-labelledby="inventory-status-title" className={CARD}>
        <Title />
        <p role="alert" className="text-body-md text-warn">
          {STAFF_COPY.dashError}
        </p>
        <ListNavigationProvider>
          <RetryButton className={buttonClass("text", "-ml-2 self-start")} />
        </ListNavigationProvider>
      </section>
    );
  }

  const { counts } = result;
  return (
    <section aria-labelledby="inventory-status-title" className={CARD}>
      <Title />
      {counts.itemCount === 0 ? (
        <p className="text-body-md text-ink-body">{STAFF_COPY.dashEmpty}</p>
      ) : (
        <>
          <p className="sr-only">
            {formatCount(counts.goodCount)} unit baik, {formatCount(counts.goodOnLoanCount)} sedang dipinjam,{" "}
            {formatCount(counts.needsServiceCount)} perlu servis
          </p>
          <div aria-hidden="true" className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className="text-numeric-metric text-ink tabular-nums">{formatCount(counts.goodCount)}</p>
              <p className="text-body-sm text-ink-meta">unit baik</p>
              <p className="text-body-sm text-ink-meta">{formatCount(counts.goodOnLoanCount)} di antaranya sedang dipinjam</p>
            </div>
            <div className="min-w-0">
              <p className="text-numeric-metric text-ink tabular-nums">{formatCount(counts.needsServiceCount)}</p>
              <p className="text-body-sm text-ink-meta">unit perlu servis</p>
            </div>
          </div>
        </>
      )}
      <div className="flex flex-col items-start">
        {pendingApprovals !== null && pendingApprovals > 0 ? (
          <Link href={queueHref({ view: "pending" })} className={buttonClass("text", "-ml-2")}>
            {formatCount(pendingApprovals)} pengajuan menunggu persetujuan
          </Link>
        ) : null}
        <Link href={INVENTORY_PATH} className={buttonClass("text", "-ml-2")}>
          {STAFF_COPY.dashCatalogLink}
        </Link>
      </div>
    </section>
  );
}

/** Loading shape (design 16.2): flat ivory bars, a caption, no shimmer. */
export function InventoryStatusSkeleton() {
  return (
    <section aria-labelledby="inventory-status-title" className={CARD}>
      <Title />
      <p role="status" className="text-body-sm text-ink-body">
        {STAFF_COPY.dashLoading}
      </p>
      <div aria-hidden="true" className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <SkeletonBar className="h-6 w-[60px]" />
            <SkeletonBar className="h-3 w-[90px]" />
          </div>
        ))}
      </div>
    </section>
  );
}
