import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { ListNavigationProvider, RetryButton } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";
import { FINANCE_COPY } from "../types";

// Shared frames and states of the Finance screens (spec 7, screen 9: same look as Letters).
// Server components; RetryButton brings its own ListNavigationProvider.

/** List column: 576 px, 768 px from tablet width, 1024 px from desktop for the table. */
export function ListColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-xl flex-col gap-5 md:max-w-3xl lg:max-w-5xl">{children}</div>;
}

/** Forms and the detail: the 448 px column; `wide` gives the detail two columns from 1024 px. */
export function NarrowPage({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={cn("mx-auto flex w-full max-w-md flex-col gap-4", wide && "lg:max-w-5xl")}>{children}</div>;
}

/** The database or PI-CORE did not answer. Fail closed, stay signed in, one action ("Coba lagi"). */
export function UnavailableNotice({ text = FINANCE_COPY.list.error }: { text?: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
      <AlertMessage role="alert" tone="warning">
        {text}
      </AlertMessage>
      <ListNavigationProvider>
        <RetryButton className={buttonClass("outline")} />
      </ListNavigationProvider>
    </div>
  );
}

/** One plain message with one way back ("Transaksi ini tidak ditemukan."). */
export function MessageCard({ text, backHref, backLabel }: { text: string; backHref: string; backLabel: string }) {
  return (
    <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
      <p role="status" className="text-body-md text-ink">
        {text}
      </p>
      <Link href={backHref} className={buttonClass("text", "mt-2 -ml-2")}>
        {backLabel}
      </Link>
    </div>
  );
}

/** "< Kembali ke daftar": a 44 px text link above a detail title. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
    >
      <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
      {children}
    </Link>
  );
}

/**
 * A detail card with an h2 and, like the Stitch 08 cards, a small walnut icon before the title and a
 * hairline under it. `action` sits at the right of the title.
 */
export function SectionCard({
  title,
  id,
  icon,
  action,
  className,
  children,
}: {
  title: ReactNode;
  id: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 md:p-5", className)}
    >
      <div className="flex min-h-7 items-center justify-between gap-3 border-b border-row-line pb-2.5">
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-headline-sm text-ink">
          {icon ? (
            <span aria-hidden="true" className="text-walnut [&_svg]:size-5">
              {icon}
            </span>
          ) : null}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label / value rows: a <dl> that wraps long text. */
export function DetailRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-body-md">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-ink-meta">{row.label}</dt>
          <dd className="break-words text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Success notice at the top of a page after a save (role=status). */
export function SuccessNotice({ children }: { children: ReactNode }) {
  return (
    <AlertMessage role="status" tone="success">
      {children}
    </AlertMessage>
  );
}
