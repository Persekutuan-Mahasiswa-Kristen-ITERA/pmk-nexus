import Link from "next/link";
import { FileClock, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { LETTER_COUNTERPART_LABEL, LETTER_DATE_LINE, formatLetterCopy, type LetterRow, type LetterType } from "../types";
import { RegisterRowChips } from "./chips";
import { COPY } from "./copy";
import { formatCount, formatDate } from "./format";
import { NumberText } from "./letter-number";
import { letterHref } from "./routes";

/**
 * The register (design 5.1, 5.2, 5.4; K2, K3, X7). Phones and tablets: one card per letter, led by
 * the number. From 1024 px: a real table with the number as the row header. Only one of the two is
 * displayed (the other is display:none), so Tab and screen readers meet each letter once. The quiet
 * default (K9): only "Dibatalkan" and "Nomor lama" carry a chip.
 */
export function RegisterList({ rows, type, caption }: { rows: LetterRow[]; type: LetterType; caption: string }) {
  return (
    <>
      <ul aria-label={caption} className="nx-rise-list flex flex-col gap-2.5 lg:hidden">
        {rows.map((row) => (
          <li key={row.letterId}>
            <LetterCard row={row} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1 lg:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-ivory">
            <tr className="border-b border-hairline text-label-sm font-bold text-walnut uppercase">
              <th scope="col" className="w-[13.5rem] px-4 py-2.5">
                Nomor
              </th>
              <th scope="col" className="w-[19%] px-4 py-2.5">
                {LETTER_COUNTERPART_LABEL[type]}
              </th>
              <th scope="col" className="px-4 py-2.5">
                Perihal
              </th>
              <th scope="col" className="w-[8.5rem] px-4 py-2.5">
                {type === "incoming" ? "Diterima" : "Tanggal surat"}
              </th>
              <th scope="col" className="w-[9rem] px-4 py-2.5">
                Berkas
              </th>
              <th scope="col" className="w-[8.5rem] px-4 py-2.5">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.letterId}
                className={cn(
                  "border-t border-row-line align-top transition-colors duration-150 first:border-t-0 hover:bg-ivory/60 motion-reduce:transition-none",
                  index % 2 === 1 ? "bg-zebra" : "bg-surface",
                )}
              >
                <th scope="row" className="px-4 py-3 font-normal">
                  <Link
                    href={letterHref(row.letterId)}
                    className={cn(
                      "inline-block rounded-sm text-body-md text-walnut underline-offset-2 hover:underline",
                      row.status === "voided" && "text-ink-body",
                    )}
                  >
                    <NumberText value={row.numberText} />
                  </Link>
                </th>
                <td className="px-4 py-3 text-body-md font-semibold break-words text-ink">{row.counterpart}</td>
                <td className="px-4 py-3 text-body-md text-ink">
                  <span className="line-clamp-2 break-words">{row.subject}</span>
                  {row.fromRequest ? <span className="mt-0.5 block text-body-sm text-ink-meta">{COPY.fromRequest}</span> : null}
                </td>
                <td className="px-4 py-3 text-body-md text-ink-body tabular-nums">{rowDate(row) ?? "-"}</td>
                <td className="px-4 py-3">
                  <FileMark row={row} />
                </td>
                <td className="px-4 py-3">
                  <RegisterRowChips status={row.status} isLegacyNumber={row.isLegacyNumber} />
                  {row.status === "active" && !row.isLegacyNumber ? <span className="text-body-md text-ink-body">Aktif</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * One letter as a card (5.1): the number is the link text, stretched over the card; the focus ring
 * goes around the card. Line 2 the counterpart, line 3 the Perihal (two lines), then the date and the
 * file mark under a hairline.
 */
function LetterCard({ row }: { row: LetterRow }) {
  const date = rowDate(row);
  return (
    <article
      className={cn(
        "nx-lift relative flex flex-col gap-1 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 hover:border-gold-tint-line",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-walnut",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 className="min-w-0 text-body-md break-words">
          <Link
            href={letterHref(row.letterId)}
            className={cn(
              "text-walnut after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none",
              row.status === "voided" && "text-ink-body",
            )}
          >
            <NumberText value={row.numberText} />
          </Link>
        </h3>
        <RegisterRowChips status={row.status} isLegacyNumber={row.isLegacyNumber} />
      </div>
      <p className="text-body-md font-semibold break-words text-ink">{row.counterpart}</p>
      <p className="line-clamp-2 text-body-md break-words text-ink-body">{row.subject}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-row-line pt-2.5 text-body-sm text-ink-meta tabular-nums">
        <span>
          {date ? formatLetterCopy(LETTER_DATE_LINE[row.type], { tanggal: date }) : null}
          {row.fromRequest ? <span className="text-ink-meta"> · {COPY.fromRequest}</span> : null}
        </span>
        <FileMark row={row} />
      </div>
    </article>
  );
}

/** "2 berkas" with a paperclip, "Menunggu file final", or "Belum ada berkas" (5.2): plain text, no colour. */
function FileMark({ row }: { row: LetterRow }) {
  if (row.fileCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-body-sm text-ink-body tabular-nums">
        <Paperclip aria-hidden="true" className="size-4 shrink-0 text-walnut" strokeWidth={2} />
        {formatCount(row.fileCount)} berkas
      </span>
    );
  }
  if (row.awaitingFinalFile) {
    return (
      <span className="inline-flex items-center gap-1 text-body-sm text-ink-body">
        <FileClock aria-hidden="true" className="size-4 shrink-0 text-walnut" strokeWidth={2} />
        {COPY.awaitingFile}
      </span>
    );
  }
  return <span className="text-body-sm text-ink-meta">{COPY.noFile}</span>;
}

/** The date a secretary looks for: received for incoming, the letter date for outgoing (5.2). */
function rowDate(row: LetterRow): string | null {
  const date = row.type === "incoming" ? row.receivedDate : row.letterDate;
  return date ? formatDate(date) : null;
}
