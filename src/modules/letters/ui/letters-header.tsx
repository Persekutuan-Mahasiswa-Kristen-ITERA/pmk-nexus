import type { ReactNode } from "react";
import { AlertMessage } from "@/components/ui/alert-message";
import { ModuleNav, type ModuleNavItem } from "@/components/ui/module-nav";
import { HeaderStat, PageHeaderCard } from "@/components/ui/page-header-card";
import { cn } from "@/lib/utils";
import { letterSegments, type LetterCapabilities, type LetterSegment } from "../types";
import { COPY } from "./copy";
import { formatCount } from "./format";
import { segmentHref } from "./routes";

const SEGMENT_LABEL: Record<LetterSegment, string> = {
  incoming: "Surat Masuk",
  outgoing: "Surat Keluar",
  mine: "Permohonan Saya",
  queue: "Antrean",
};

/**
 * The segments this person may use (design K1, 4.3, P1). Register tabs need letters.view, Antrean
 * needs letter_requests.view_all; both match nothing without an active period (R7), so the
 * capabilities already hide them then. "Antrean (n)" counts what waits for THIS person (4.4, P2).
 */
export function letterSections(capabilities: LetterCapabilities, actionNeeded: number | null): ModuleNavItem[] {
  return letterSegments(capabilities).map((segment) => {
    const count = segment === "queue" && capabilities.canProcessRequests && actionNeeded && actionNeeded > 0 ? actionNeeded : null;
    return {
      key: segment,
      href: segmentHref(segment),
      label: SEGMENT_LABEL[segment],
      count,
      accessibleLabel: count ? `Antrean, ${count} perlu tindakan` : undefined,
    };
  });
}

/** Figures under the title (design 3.1): Aktif letters of the active period and, for view_all, waiting requests. */
export type LetterTiles = {
  incoming: { count: number; voided: number } | null;
  outgoing: { count: number; voided: number } | null;
  waiting: number | null;
};

/**
 * Title block of a section page (design 3.1, 4.2; D-023): the warm header card with the period pill,
 * the Playfair title, the one line for this viewer, an optional count box and stat tiles; then the
 * no-active-period banner (3.4) and the segmented control.
 */
export function LettersHeader({
  capabilities,
  periodLabel,
  current,
  countBox,
  tiles,
  actionNeeded = null,
}: {
  capabilities: LetterCapabilities;
  periodLabel: string | null;
  current: LetterSegment;
  /** "Hasil 42 surat" / "Permohonan 2 berjalan"; null while unknown. */
  countBox?: { label: string; value: string; unit: string } | null;
  tiles?: LetterTiles | null;
  actionNeeded?: number | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderCard periodLabel={periodLabel} title={COPY.moduleTitle} aside={countBox ? <CountBox {...countBox} /> : null}>
        <p className="max-w-[34ch] text-body-lg text-ink-body">
          {capabilities.canViewRegister ? COPY.leadRegister : COPY.leadMember}
        </p>
        {tiles ? <StatTiles tiles={tiles} /> : null}
      </PageHeaderCard>
      {capabilities.hasActivePeriod ? null : (
        <AlertMessage role="status" tone="info">
          {COPY.noPeriodRequest}
        </AlertMessage>
      )}
      <div className="nx-rise nx-delay-1">
        <ModuleNav label={COPY.navLabel} items={letterSections(capabilities, actionNeeded)} current={current} />
      </div>
    </div>
  );
}

function StatTiles({ tiles }: { tiles: LetterTiles }) {
  const items: ReactNode[] = [];
  // "Permohonan menunggu" wraps on a phone; the other labels keep the same height so figures line up.
  const tall = tiles.waiting !== null;
  if (tiles.incoming) {
    items.push(
      <HeaderStat
        key="in"
        label="Surat masuk"
        twoLineLabel={tall}
        value={tiles.incoming.count}
        note={tiles.incoming.voided > 0 ? `${formatCount(tiles.incoming.voided)} dibatalkan` : undefined}
      />,
    );
  }
  if (tiles.outgoing) {
    items.push(
      <HeaderStat
        key="out"
        label="Surat keluar"
        twoLineLabel={tall}
        value={tiles.outgoing.count}
        note={tiles.outgoing.voided > 0 ? `${formatCount(tiles.outgoing.voided)} dibatalkan` : undefined}
      />,
    );
  }
  if (tiles.waiting !== null) {
    items.push(<HeaderStat key="wait" label="Permohonan menunggu" twoLineLabel value={tiles.waiting} warn={tiles.waiting > 0} />);
  }
  if (items.length === 0) return null;
  return (
    <dl
      aria-label="Ringkasan surat"
      className={cn("mt-1 grid gap-2 md:gap-3", items.length === 3 ? "grid-cols-3" : items.length === 2 ? "grid-cols-2" : "grid-cols-1")}
    >
      {items}
    </dl>
  );
}

function CountBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <p className="shrink-0 rounded-lg border border-gold-tint-line bg-surface px-3 py-1.5 text-right">
      <span className="block text-body-sm text-ink-meta">{label}</span>
      <span className="text-numeric-metric text-walnut tabular-nums">{value}</span>{" "}
      <span className="text-body-sm text-ink-body">{unit}</span>
    </p>
  );
}

/** List screens: 576 px, 768 px from tablet width, `wide` = 1024 px from desktop for the register table (X7). */
export function ListColumn({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-xl flex-col gap-5 md:max-w-3xl", wide && "lg:max-w-5xl")}>{children}</div>
  );
}

/** Forms and details: the 448 px column; `wide` lets a detail use two columns from 1024 px (6.5, 10.6). */
export function NarrowPage({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={cn("mx-auto flex w-full max-w-md flex-col gap-4", wide && "lg:max-w-5xl")}>{children}</div>;
}
