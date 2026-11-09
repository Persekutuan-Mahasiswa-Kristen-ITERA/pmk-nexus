import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { RetryButton } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { COPY } from "./copy";

// Shared states of the inventory screens (design 3.6). Server components; RetryButton needs a
// ListNavigationProvider above it.

/** PI-CORE or the database did not answer. Fail closed, stay signed in, one action ("Coba lagi"). */
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

/** "Barang ini tidak ditemukan." / "Pengajuan ini tidak ditemukan." with one way back. */
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

/** "< Katalog" / "< Peminjaman Saya" / "< Kembali": a 44 px text link above a detail or form title. */
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

/** Flat placeholder bar (shared; kept here so module imports stay short). */
export { SkeletonBar } from "@/components/ui/skeleton-bar";

/** Plain card section with an h2 (detail and form pages). */
export function SectionCard({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1"
    >
      <h2 id={headingId} className="text-headline-sm text-ink">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
