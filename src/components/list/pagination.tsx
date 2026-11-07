"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isPlainClick, useListNavigation } from "./list-navigation";

type Gap = "gap";

/** First, last, the current page and `around` pages each side, with gaps (same rule as Data Anggota). */
function pageWindow(current: number, count: number, around: number): (number | Gap)[] {
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

// Type size appended outside cn() (it would drop text-label-lg next to a text colour).
const cellBase =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-lg border px-3 tabular-nums transition-colors duration-150 motion-reduce:transition-none";
const linkClass = `${cn(cellBase, "border-field-line bg-surface text-ink-body hover:border-walnut hover:text-walnut")} text-label-lg`;
const currentClass = `${cn(cellBase, "border-walnut bg-walnut text-primary-foreground")} text-label-lg`;
const disabledClass = `${cn(cellBase, "border-surface-line bg-surface text-ink-meta")} text-label-lg`;

/** Address of `page` on `basePath` with the other list parameters kept. Page 1 is left out. */
export function pageHref(basePath: string, params: Record<string, string>, pageParam: string, page: number): string {
  const search = new URLSearchParams(params);
  search.delete(pageParam);
  if (page > 1) search.set(pageParam, String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Prev / numbers / Next as real links (works without JavaScript), shared by module lists.
 * Phones show first, current and last; wider screens one more page each side.
 */
export function Pagination({
  page,
  pageCount,
  basePath,
  params,
  pageParam = "page",
  label,
}: {
  page: number;
  pageCount: number;
  basePath: string;
  /** The list's other parameters (search, filters), already in their address form. */
  params: Record<string, string>;
  pageParam?: string;
  /** Accessible name, e.g. "Halaman daftar barang". */
  label: string;
}) {
  const { navigate } = useListNavigation();
  if (pageCount <= 1) return null;

  const href = (p: number) => pageHref(basePath, params, pageParam, p);
  const go = (p: number) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
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
            <a
              href={href(item)}
              aria-current={item === page ? "page" : undefined}
              onClick={go(item)}
              className={item === page ? currentClass : linkClass}
            >
              <span className="sr-only">Halaman </span>
              {item}
            </a>
          </li>
        ),
      )}
    </ol>
  );

  return (
    <nav aria-label={label} className="flex items-center justify-center gap-1">
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
