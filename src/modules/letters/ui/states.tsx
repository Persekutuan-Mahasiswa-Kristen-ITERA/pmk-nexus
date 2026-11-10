import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { RetryButton } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { COPY } from "./copy";

// Shared states of the Letters screens (design 3.4, 5.3, 6.4). Server components; RetryButton needs a
// ListNavigationProvider above it.

/** The database or PI-CORE did not answer. Fail closed, stay signed in, one action ("Coba lagi"). */
export function UnavailableNotice({ text = COPY.unavailable }: { text?: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
      <AlertMessage role="alert" tone="warning">
        {text}
      </AlertMessage>
      <RetryButton className={buttonClass("outline")} />
    </div>
  );
}

/** "Surat ini tidak ditemukan." / "Permohonan ini tidak ditemukan." with one way back. */
export function NotFoundCard({ text, backHref, backLabel }: { text: string; backHref: string; backLabel: string }) {
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

/** "< Surat Keluar" / "< Antrean": a 44 px text link above a detail or form title. */
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

/** Plain card section with an h2 (detail and settings pages). `action` sits at the right of the title. */
export function SectionCard({
  title,
  id,
  action,
  className,
  children,
}: {
  title: ReactNode;
  id: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 md:p-5 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-headline-sm text-ink">
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label / value rows (design 6.1 Rincian, 10.2 Permohonan): a <dl> that wraps long text. */
export function DetailRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-body-md">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-ink-meta">{row.label}</dt>
          <dd className="break-words whitespace-pre-line text-ink">{row.value}</dd>
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
