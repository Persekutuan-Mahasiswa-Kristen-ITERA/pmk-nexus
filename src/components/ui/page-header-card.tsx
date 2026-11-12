import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { CountUp } from "./count-up";

/**
 * Warm header card at the top of a screen (D-023): the period pill, the Playfair title and one or two
 * lines under it, with an optional slot for stat tiles. Cream-to-gold fill with a soft glow in the
 * corner (--nx-header-fill), like the PI-CORE home hero. It is the first thing to arrive (nx-rise).
 */
export function PageHeaderCard({
  periodLabel,
  title,
  aside,
  children,
}: {
  /** Active period label ("2026/2027"); null hides the pill (no active period). */
  periodLabel: string | null;
  /** The page's h1. */
  title: string;
  /** Small box at the right of the title (e.g. "Pengajuan 3 berjalan"). */
  aside?: ReactNode;
  /** Lines and tiles under the title. */
  children?: ReactNode;
}) {
  return (
    <div className="nx-header-card nx-rise relative flex flex-col gap-4 overflow-hidden rounded-[var(--nx-header-radius)] border border-gold-tint-line p-5 shadow-elevation-1 md:p-[var(--nx-header-pad)]">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gold" />
      <div className="relative flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          {periodLabel ? <PeriodPill label={periodLabel} /> : null}
          <h1 className="min-w-0 font-heading text-display-lg text-balance break-words text-title">{title}</h1>
        </div>
        {aside}
      </div>
      {children ? <div className="relative max-w-3xl border-t border-gold-tint-line/70 pt-3">{children}</div> : null}
    </div>
  );
}

/** "Periode 2026/2027": the one status the whole screen depends on, so it gets the pill (D-014 chips). */
export function PeriodPill({ label }: { label: string }) {
  return (
    <p className="inline-flex h-8 items-center gap-1.5 self-start rounded-full border border-gold-tint-line bg-surface px-3 text-label-lg text-ink tabular-nums">
      <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-walnut" strokeWidth={2} />
      Periode {label}
    </p>
  );
}

/**
 * One figure in a header: label, value, optional line under it. White on the warm fill so the number
 * is the brightest thing in the card. Use 2 or 3 side by side; never invented values (R-17).
 */
export function HeaderStat({
  label,
  value,
  note,
  warn = false,
  twoLineLabel = false,
}: {
  label: string;
  value: number;
  note?: string;
  /** A count that needs attention (not zero): the figure turns warning brown, the label says why. */
  warn?: boolean;
  /** Reserve two label lines on a phone so the figures of a row line up when one label wraps. */
  twoLineLabel?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-gold-tint-line bg-surface px-3 pt-2.5 pb-3 md:px-4">
      <dt className={`text-body-sm text-ink-meta ${twoLineLabel ? "min-h-9 md:min-h-0" : ""}`}>{label}</dt>
      <dd className={`nx-figure-md mt-1 ${warn ? "text-warn" : "text-ink"}`}>
        <CountUp value={value} />
      </dd>
      {note ? <dd className="text-body-sm text-ink-body">{note}</dd> : null}
    </div>
  );
}
