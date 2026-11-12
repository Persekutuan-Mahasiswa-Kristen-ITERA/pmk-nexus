import Link from "next/link";
import { Paperclip } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import {
  FINANCE_COPY,
  FINANCE_ENTRY_TYPE_LABEL,
  formatEntryAmount,
  type FinanceEntryRow,
  type FinanceEntryType,
} from "../types";
import { UI_COPY } from "./copy";
import { formatDate } from "./format";
import { entryHref } from "./routes";

const C = UI_COPY.columns;
const L = FINANCE_COPY.list;

/** Income reads green, expense reads red AND carries its sign, so colour is never the only cue (spec 4.2). */
function amountTone(type: FinanceEntryType, voided: boolean): string {
  if (voided) return "text-ink-body line-through decoration-1";
  if (type === "income") return "text-success";
  if (type === "expense") return "text-danger";
  return "text-ink";
}

/**
 * The list (spec 7 screen 1). Phones and tablets: one card per entry, led by the date and the number, then
 * Keterangan and the signed amount. From 1024 px: a real table (Tanggal, Nomor, Keterangan, Jenis, Jumlah,
 * Bukti) with Keterangan as the row header. Only one of the two is displayed, so Tab and screen readers meet
 * each entry once. The quiet default: only "Dibatalkan" and the type carry a chip. A voided amount is
 * struck through; an entry without a proof says so (K5 a mark).
 */
export function EntryList({ rows, caption }: { rows: FinanceEntryRow[]; caption: string }) {
  return (
    <>
      <ul aria-label={caption} className="nx-rise-list flex flex-col gap-2.5 lg:hidden">
        {rows.map((row) => (
          <li key={row.entryId}>
            <EntryCard row={row} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1 lg:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-ivory">
            <tr className="border-b border-hairline text-label-sm font-bold text-walnut uppercase">
              <th scope="col" className="w-[8.5rem] px-4 py-2.5">
                {C.date}
              </th>
              <th scope="col" className="w-[7.5rem] px-4 py-2.5">
                {C.number}
              </th>
              <th scope="col" className="px-4 py-2.5">
                {C.description}
              </th>
              <th scope="col" className="w-[9rem] px-4 py-2.5">
                {C.type}
              </th>
              <th scope="col" className="w-[11rem] px-4 py-2.5 text-right">
                {C.amount}
              </th>
              <th scope="col" className="w-[7.5rem] px-4 py-2.5">
                {C.proof}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const voided = row.status === "voided";
              return (
                <tr
                  key={row.entryId}
                  className={cn(
                    "border-t border-row-line align-top transition-colors duration-150 first:border-t-0 hover:bg-ivory/60 motion-reduce:transition-none",
                    index % 2 === 1 ? "bg-zebra" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 text-body-md text-ink-body tabular-nums">{formatDate(row.entryDate)}</td>
                  <td className="px-4 py-3 text-body-md text-ink-body tabular-nums">{row.numberText}</td>
                  <th scope="row" className="min-w-0 px-4 py-3 font-normal">
                    <span className="flex min-w-0 flex-col items-start gap-1.5">
                      <Link
                        href={entryHref(row.entryId)}
                        className={cn(
                          "rounded-sm text-body-md font-semibold break-words text-walnut underline-offset-2 hover:underline",
                          voided && "text-ink-body",
                        )}
                      >
                        {row.description}
                      </Link>
                      {row.correctsNumberText ? (
                        <span className="text-body-sm text-ink-meta">
                          {FINANCE_COPY.form.correctsLine.replace("{nomor}", row.correctsNumberText)}
                        </span>
                      ) : null}
                    </span>
                  </th>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-body-md text-ink-body">{FINANCE_ENTRY_TYPE_LABEL[row.entryType]}</span>
                      {voided ? <StatusChip tone="grey">{L.voidedChip}</StatusChip> : null}
                    </span>
                  </td>
                  <td className={cn("px-4 py-3 text-right text-body-md font-semibold tabular-nums", amountTone(row.entryType, voided))}>
                    {formatEntryAmount(row.entryType, row.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <ProofMark count={row.proofCount} voided={voided} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * One entry as a card: "15 Okt 2026 · KAS-0012", Keterangan as the link (stretched over the card, so the
 * focus ring goes around the card), the signed amount, and the proof mark.
 */
function EntryCard({ row }: { row: FinanceEntryRow }) {
  const voided = row.status === "voided";
  return (
    <article
      className={cn(
        "nx-lift relative flex flex-col gap-1 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 hover:border-gold-tint-line",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-walnut",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-body-sm break-words text-ink-body tabular-nums">
          {formatDate(row.entryDate)} · {row.numberText}
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={row.entryType === "income" ? "success" : row.entryType === "expense" ? "warning" : "ivory"}>
            {FINANCE_ENTRY_TYPE_LABEL[row.entryType]}
          </StatusChip>
          {voided ? <StatusChip tone="grey">{L.voidedChip}</StatusChip> : null}
        </span>
      </div>
      <h3 className="text-body-lg font-bold break-words">
        <Link
          href={entryHref(row.entryId)}
          className={cn(
            "text-ink after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none",
            voided && "text-ink-body",
          )}
        >
          {row.description}
        </Link>
      </h3>
      {row.correctsNumberText ? (
        <p className="text-body-sm text-ink-meta">{FINANCE_COPY.form.correctsLine.replace("{nomor}", row.correctsNumberText)}</p>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className={cn("text-headline-sm font-bold break-words tabular-nums", amountTone(row.entryType, voided))}>
          {formatEntryAmount(row.entryType, row.amount)}
        </p>
        <ProofMark count={row.proofCount} voided={voided} />
      </div>
    </article>
  );
}

/** A paperclip when a proof exists; the K5 a mark "Tanpa bukti" when none does (not for a voided entry). */
function ProofMark({ count, voided }: { count: number; voided: boolean }) {
  if (count > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-body-sm text-ink-body tabular-nums">
        <Paperclip aria-hidden="true" className="size-4 shrink-0 text-walnut" strokeWidth={2} />
        <span className="sr-only">{L.hasProof}: </span>
        {count}
      </span>
    );
  }
  if (voided) return <span className="text-body-sm text-ink-meta">{UI_COPY.none}</span>;
  return <span className="text-body-sm text-ink-meta">{L.withoutProofMark}</span>;
}
