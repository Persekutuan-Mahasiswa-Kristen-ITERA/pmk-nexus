import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TimelineEntry = {
  key: string;
  /** Event text, e.g. "Disetujui oleh {nama}". */
  title: ReactNode;
  /** ISO timestamp for the <time> element, and its display text. */
  dateTime: string;
  dateText: string;
  /** Extra lines (old and new date, a note). */
  details?: ReactNode;
};

/**
 * Ordered timeline (docs/design/inventory-borrowing.md 10.2, 10.6). Newest first; the first entry is
 * the current step: filled walnut dot and bold text. Dots are decorative; the text carries the meaning.
 */
export function Timeline({ entries, label }: { entries: TimelineEntry[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {entries.map((entry, index) => {
        const current = index === 0;
        const last = index === entries.length - 1;
        return (
          <li key={entry.key} className="relative flex gap-3 pb-4 last:pb-0">
            <span aria-hidden="true" className="relative flex w-3 shrink-0 justify-center">
              <span
                className={cn(
                  "mt-1 size-3 rounded-full border-2",
                  current ? "border-walnut bg-walnut" : "border-field-line bg-surface",
                )}
              />
              {last ? null : <span className="absolute top-5 bottom-[-0.75rem] w-px bg-field-line" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-body-md break-words text-ink", current && "font-bold")}>{entry.title}</p>
              <p className="text-body-sm text-ink-meta">
                <time dateTime={entry.dateTime}>{entry.dateText}</time>
              </p>
              {entry.details ? <div className="mt-1 text-body-sm break-words text-ink-body">{entry.details}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
