import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { CopyNumberButton } from "./copy-number-button";
import { numberParts, spokenNumber } from "./format";

/**
 * A letter number as plain text (design 3.2): Plus Jakarta Sans bold, tabular figures, a <wbr> after
 * every separator so "PMK/NEX/SM/2026/012" wraps at 358 px and at 200% zoom instead of overflowing.
 * The stored text is shown as is, never rebuilt from parts.
 */
export function NumberText({ value, className }: { value: string; className?: string }) {
  const parts = numberParts(value);
  return (
    <span className={cn("font-bold tabular-nums", className)}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The number plate, the module's one motif (design K4, screens 3, 7, 9): the official number on the
 * gold tint, large and even (tabular Plus Jakarta Sans, not Playfair's old-style figures), with
 * "Salin nomor" because the secretary pastes it into the Word file of the letter. A screen reader hears
 * the number as one phrase. `focusRef` lets the review page move focus here after "Ambil nomor".
 */
export function NumberPlate({
  numberText,
  note,
  copy = true,
  struck = false,
  id,
}: {
  numberText: string;
  /** A line under the number (Terbitkan: "Nomor ini sudah diambil ..."). */
  note?: ReactNode;
  copy?: boolean;
  /** Voided number: the text says so elsewhere; the plate only dims (never the only signal). */
  struck?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-label={`${COPY.plateLabel} ${spokenNumber(numberText)}`}
      className="nx-rise flex flex-col gap-1 rounded-xl border border-gold-tint-line bg-gold-tint px-4 pt-3.5 pb-2 shadow-elevation-1 focus:outline-none md:px-5"
    >
      <p aria-hidden="true" className="text-body-sm text-ink-body">
        {COPY.plateLabel}
      </p>
      <p aria-hidden="true" className={cn("text-numeric-metric break-words text-ink lg:text-display-sm", struck && "text-ink-body line-through decoration-1")}>
        <NumberText value={numberText} />
      </p>
      {note ? <p className="mt-0.5 pb-1 text-body-sm text-ink-body">{note}</p> : null}
      {copy ? <CopyNumberButton numberText={numberText} /> : null}
    </section>
  );
}
