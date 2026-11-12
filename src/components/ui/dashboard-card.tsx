import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** Stagger slots for cards under the header (40 ms apart, last one at 120 ms). */
const DELAY = ["nx-delay-1", "nx-delay-2", "nx-delay-3"] as const;

/**
 * One module card on the Dashboard (Stitch screen 01, PI-CORE stat cards, D-023): a gold-tinted icon
 * tile naming the module, the title, the module's real figures, and a link to the module at the foot.
 * Soft border, Stitch elevation 1; on a pointer device it lifts 2 px (nx-lift) because it leads to the
 * module. Each card loads on its own and arrives in its stagger slot.
 */
export function DashboardCard({
  titleId,
  title,
  icon,
  slot = 0,
  children,
}: {
  titleId: string;
  title: string;
  /** The module's drawer icon, so the card and the menu item look alike. */
  icon: ReactNode;
  /** Position under the header (0 = first card). */
  slot?: number;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={`nx-rise nx-lift ${DELAY[Math.min(slot, DELAY.length - 1)]} flex flex-col gap-5 rounded-card border border-surface-line bg-surface p-5 shadow-elevation-1 transition-[transform,border-color,box-shadow] duration-card-hover hover:-translate-y-card-hover hover:border-gold-tint-line hover:shadow-elevation-2 focus-within:border-gold-tint-line md:gap-6 md:p-card-wide`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-gold-tint-line bg-gold-tint text-walnut"
        >
          {icon}
        </span>
        <h2 id={titleId} className="text-headline-sm text-ink">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** Foot link of a card: full width, 48 px, a hairline above it; the chevron nudges right on hover. */
export function DashboardCardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div className="-mx-5 -mb-5 mt-auto border-t border-row-line md:-mx-6 md:-mb-6">
      <Link
        href={href}
        className="group flex min-h-12 items-center justify-between gap-3 rounded-b-xl px-5 text-label-lg text-walnut transition-colors duration-150 hover:bg-ivory active:bg-ivory md:px-6"
      >
        {children}
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          strokeWidth={2}
        />
      </Link>
    </div>
  );
}
