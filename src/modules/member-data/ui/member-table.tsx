import { cn } from "@/lib/utils";
import { MEMBER_EMPTY_VALUE, formatMemberUnit, type MemberRow } from "../types";

/**
 * The member ledger (Stitch screen 03 table, spec 4.1): No | Nama Lengkap | Unit / Jabatan | Status.
 * Read-only: rows are not links and have no hover, because there is no detail view (M4, MD-14).
 * Fits 390 px by wrapping text inside fixed columns; the wrapper only scrolls if a name cannot wrap.
 */
export function MemberTable({ rows, caption }: { rows: MemberRow[]; caption: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className="w-9 md:w-14" />
            <col className="w-[32%]" />
            <col />
            <col className="w-[5.75rem] md:w-28" />
          </colgroup>
          <thead className="bg-ivory">
            <tr className="border-b border-hairline text-label-sm font-bold text-walnut uppercase">
              <th scope="col" className="py-2.5 pr-1 pl-2 text-right md:pl-4">
                <abbr title="Nomor" className="no-underline">
                  No
                </abbr>
              </th>
              <th scope="col" className="px-2 py-2.5 md:px-4">
                Nama Lengkap
              </th>
              <th scope="col" className="px-2 py-2.5 md:px-4">
                Unit / Jabatan
              </th>
              <th scope="col" className="py-2.5 pr-2 pl-1 text-right md:pr-4">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <MemberTableRow key={row.memberId} row={row} zebra={index % 2 === 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemberTableRow({ row, zebra }: { row: MemberRow; zebra: boolean }) {
  const unit = formatMemberUnit(row);
  return (
    <tr className={cn("border-t border-row-line align-top first:border-t-0", zebra ? "bg-zebra" : "bg-surface")}>
      <td className="py-3 pr-1 pl-2 text-right text-label-sm text-ink-meta tabular-nums md:pl-4">{row.rowNo}</td>
      <td className="px-2 py-3 md:px-4">
        <p className="text-body-md font-semibold break-words text-ink">{row.fullName}</p>
        {row.isLecturer ? (
          // Member-type marker (M6), not a status: square-cornered tag, so pills stay status-only.
          <span className="mt-1 inline-block rounded-sm bg-ivory px-1.5 py-px text-label-sm text-walnut">Pembina</span>
        ) : null}
      </td>
      <td className="px-2 py-3 md:px-4">
        {unit === null && row.positionName === null ? (
          <p className="text-body-sm text-ink-body">{MEMBER_EMPTY_VALUE}</p>
        ) : (
          <>
            <p className="text-body-sm font-semibold break-words text-ink-body">{unit ?? MEMBER_EMPTY_VALUE}</p>
            <p className="mt-0.5 text-body-sm break-words text-ink-meta">
              {row.positionName ?? MEMBER_EMPTY_VALUE}
            </p>
          </>
        )}
      </td>
      <td className="py-3 pr-2 pl-1 text-right md:pr-4">
        <StatusChip active={row.isActive} />
      </td>
    </tr>
  );
}

/** Status chip (M1): the one pill on this screen. Text carries the meaning; colour only repeats it. */
function StatusChip({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2 text-label-sm font-bold whitespace-nowrap ${
        active ? "border-success-line bg-success-soft text-success" : "border-ivory-line bg-ivory text-walnut"
      }`}
    >
      {active ? "Aktif" : "Nonaktif"}
    </span>
  );
}
