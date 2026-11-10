import Link from "next/link";
import { Paperclip } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { formatMinuteCopy, MINUTE_COPY, minuteUnitLabel, type MinuteRow } from "../types";
import { formatDate } from "./format";
import { minuteHref } from "./routes";

const COLUMNS = MINUTE_COPY.list.columns;

/**
 * The list (spec 7 screen 1). Phones and tablets: one card per minute, led by the meeting date and the
 * unit, then the title. From 1024 px: a real table (Tanggal, Unit, Judul, Topik, Berkas) with the title
 * as the row header. Only one of the two is displayed, so Tab and screen readers meet each minute once.
 * The quiet default: only "Dibatalkan" carries a chip.
 */
export function MinutesList({ rows, caption }: { rows: MinuteRow[]; caption: string }) {
  return (
    <>
      <ul aria-label={caption} className="nx-rise-list flex flex-col gap-2.5 lg:hidden">
        {rows.map((row) => (
          <li key={row.minuteId}>
            <MinuteCard row={row} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1 lg:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-ivory">
            <tr className="border-b border-hairline text-label-sm font-bold text-walnut uppercase">
              <th scope="col" className="w-[8.5rem] px-4 py-2.5">
                {COLUMNS.date}
              </th>
              <th scope="col" className="w-[18%] px-4 py-2.5">
                {COLUMNS.unit}
              </th>
              <th scope="col" className="px-4 py-2.5">
                {COLUMNS.title}
              </th>
              <th scope="col" className="w-[28%] px-4 py-2.5">
                {COLUMNS.topic}
              </th>
              <th scope="col" className="w-[7.5rem] px-4 py-2.5">
                {COLUMNS.files}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const voided = row.status === "voided";
              return (
                <tr
                  key={row.minuteId}
                  className={cn(
                    "border-t border-row-line align-top transition-colors duration-150 first:border-t-0 hover:bg-ivory/60 motion-reduce:transition-none",
                    index % 2 === 1 ? "bg-zebra" : "bg-surface",
                  )}
                >
                  <td className="px-4 py-3 text-body-md text-ink-body tabular-nums">{formatDate(row.meetingDate)}</td>
                  <td className="px-4 py-3 text-body-md break-words text-ink">{minuteUnitLabel(row)}</td>
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="flex flex-col items-start gap-1.5">
                      <Link
                        href={minuteHref(row.minuteId)}
                        className={cn(
                          "rounded-sm text-body-md font-semibold break-words text-walnut underline-offset-2 hover:underline",
                          voided && "text-ink-body",
                        )}
                      >
                        {row.title}
                      </Link>
                      {voided ? <StatusChip tone="grey">{MINUTE_COPY.detail.voidedChip}</StatusChip> : null}
                    </span>
                  </th>
                  <td className="px-4 py-3 text-body-md text-ink-body">
                    <span className="line-clamp-2 break-words">{row.topic}</span>
                  </td>
                  <td className="px-4 py-3">
                    <FileMark count={row.fileCount} />
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
 * One minute as a card: "17 Okt 2026 · Departemen Internal", the title as the link (stretched over the
 * card, so the focus ring goes around the card), the topic on one line, and the file mark.
 */
function MinuteCard({ row }: { row: MinuteRow }) {
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
          {formatMinuteCopy(MINUTE_COPY.list.cardMeta, { tanggal: formatDate(row.meetingDate), unit: minuteUnitLabel(row) })}
        </p>
        {voided ? <StatusChip tone="grey">{MINUTE_COPY.detail.voidedChip}</StatusChip> : null}
      </div>
      <h3 className="text-body-lg font-bold break-words">
        <Link
          href={minuteHref(row.minuteId)}
          className={cn(
            "text-ink after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none",
            voided && "text-ink-body",
          )}
        >
          {row.title}
        </Link>
      </h3>
      <p className="truncate text-body-md text-ink-body">{row.topic}</p>
      {row.fileCount > 0 ? (
        <div className="mt-2 border-t border-row-line pt-2.5">
          <FileMark count={row.fileCount} />
        </div>
      ) : null}
    </article>
  );
}

/** "2 berkas" with a paperclip; nothing when there is no file. */
function FileMark({ count }: { count: number }) {
  if (count <= 0) return <span className="text-body-sm text-ink-meta">-</span>;
  return (
    <span className="inline-flex items-center gap-1 text-body-sm text-ink-body tabular-nums">
      <Paperclip aria-hidden="true" className="size-4 shrink-0 text-walnut" strokeWidth={2} />
      {formatMinuteCopy(MINUTE_COPY.list.fileCount, { n: count })}
    </span>
  );
}
