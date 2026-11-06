"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPlainClick, useListNavigation } from "./list-navigation";
import { memberListHref, type MemberListUrlState } from "./list-url";

type Gap = "gap";

/**
 * Page numbers to show: first, last, the current page and `around` pages on each side, with gaps.
 * Phones get around = 0 (Prev, 1, current, last, Next fits 358 px with 44 px targets); wider screens get 1.
 */
export function pageWindow(current: number, count: number, around: number): (number | Gap)[] {
  const keep = new Set<number>([1, count]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= count) keep.add(p);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | Gap)[] = [];
  sorted.forEach((page, i) => {
    if (i > 0 && page - sorted[i - 1] > 1) out.push("gap");
    out.push(page);
  });
  return out;
}

// The type size is appended outside cn(), which would drop text-label-lg next to a text colour.
const cellBase =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border px-3 tabular-nums transition-colors duration-150 motion-reduce:transition-none";
const linkClass = `${cn(cellBase, "border-field-line bg-surface text-ink-body hover:border-walnut hover:text-walnut")} text-label-lg`;
const currentClass = `${cn(cellBase, "border-walnut bg-walnut text-primary-foreground")} text-label-lg`;
const disabledClass = `${cn(cellBase, "border-surface-line bg-surface text-ink-meta")} text-label-lg`;

/** Prev / numbers / Next (spec F4, Stitch 03). Real links, so it also works without JavaScript. */
export function MemberPagination({
  page,
  pageCount,
  filters,
}: {
  page: number;
  pageCount: number;
  filters: Omit<MemberListUrlState, "page">;
}) {
  const { navigate } = useListNavigation();
  if (pageCount <= 1) return null;

  const href = (p: number) => memberListHref({ ...filters, page: p });
  const go = (p: number) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    // Scroll to the top so the new page starts at its first row, like a full page load.
    navigate(href(p), { scroll: true });
  };

  const numbers = (around: number, className: string) => (
    <ol className={cn("items-center gap-1", className)}>
      {pageWindow(page, pageCount, around).map((item, i) =>
        item === "gap" ? (
          <li key={`gap-${i}`} aria-hidden="true" className="px-0.5 text-label-lg text-ink-meta">
            …
          </li>
        ) : (
          <li key={item}>
            {item === page ? (
              <a href={href(item)} aria-current="page" onClick={go(item)} className={currentClass}>
                <span className="sr-only">Halaman </span>
                {item}
              </a>
            ) : (
              <a href={href(item)} onClick={go(item)} className={linkClass}>
                <span className="sr-only">Halaman </span>
                {item}
              </a>
            )}
          </li>
        ),
      )}
    </ol>
  );

  return (
    <nav aria-label="Halaman daftar anggota" className="flex items-center justify-center gap-1">
      {page > 1 ? (
        <a href={href(page - 1)} onClick={go(page - 1)} className={`${linkClass} gap-0.5 pl-2`} aria-label="Halaman sebelumnya">
          <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={2} />
          Prev
        </a>
      ) : (
        <span role="link" aria-disabled="true" className={`${disabledClass} gap-0.5 pl-2`}>
          <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={2} />
          Prev
        </span>
      )}
      {numbers(0, "flex sm:hidden")}
      {numbers(1, "hidden sm:flex")}
      {page < pageCount ? (
        <a href={href(page + 1)} onClick={go(page + 1)} className={`${linkClass} gap-0.5 pr-2`} aria-label="Halaman berikutnya">
          Next
          <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2} />
        </a>
      ) : (
        <span role="link" aria-disabled="true" className={`${disabledClass} gap-0.5 pr-2`}>
          Next
          <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2} />
        </span>
      )}
    </nav>
  );
}
