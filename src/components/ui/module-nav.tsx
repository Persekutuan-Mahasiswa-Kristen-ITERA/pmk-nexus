import Link from "next/link";
import { cn } from "@/lib/utils";

export type ModuleNavItem = {
  key: string;
  href: string;
  label: string;
  /** Optional count shown as "(3)": plain text, not a pill (design X6). Hidden when 0 or null. */
  count?: number | null;
  /** Accessible name when the visible label is not enough, e.g. "Antrean, 3 perlu tindakan". */
  accessibleLabel?: string;
};

/**
 * Segmented module navigation (docs/design/inventory-borrowing.md 4.2-4.6, Stitch screen 10 control).
 * Real links in a <nav>, not an ARIA tablist: each section is its own page, so Back and shared links
 * work. Segments are equal width, at least 56 px high, and labels may wrap to two lines on a phone.
 * Active = walnut fill + bold + aria-current (never colour alone).
 */
export function ModuleNav({ label, items, current }: { label: string; items: ModuleNavItem[]; current: string | null }) {
  if (items.length < 2) return null; // one section needs no switcher
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 rounded-xl bg-ivory p-1">
        {items.map((item) => {
          const active = item.key === current;
          const showCount = typeof item.count === "number" && item.count > 0;
          return (
            <li key={item.key} className="min-w-0 flex-1 basis-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.accessibleLabel}
                className={`${cn(
                  "flex min-h-14 w-full items-center justify-center rounded-lg px-2 py-1.5 text-center leading-tight text-balance transition-colors duration-150 motion-reduce:transition-none",
                  active
                    ? "bg-walnut font-bold text-primary-foreground"
                    : "text-ink-body hover:bg-surface hover:text-ink",
                )} text-label-lg`}
              >
                <span>
                  {item.label}
                  {showCount ? <span className="tabular-nums"> ({item.count})</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
