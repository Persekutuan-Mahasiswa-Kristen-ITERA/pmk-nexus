"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, Package } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { UNIT_STATUS_LABEL, type CatalogRow } from "../types";
import { UnitChip } from "./chips";
import { COPY } from "./copy";
import { formatCount } from "./format";
import { itemHref } from "./routes";

/**
 * Katalog list (design 5.1, 5.2, 5.4; D-023). Phone: one card per item (name, code, category and
 * location, "x dari y baik", condition chips). From 768 px: the table with Kode, Barang, Kategori,
 * Lokasi, Baik / Total, Kondisi lain. Only one of the two is displayed; the other is display:none, so
 * screen readers and Tab meet each item once. Rows are not tappable as a whole; the item name is the
 * link. A tracked item has an expander that lists its units (code, condition, location; never who
 * holds them, R8).
 */
export function CatalogTable({
  rows,
  caption,
  backParams,
  withDates,
}: {
  rows: CatalogRow[];
  caption: string;
  /** Catalog parameters, so the item page can return to the same list. */
  backParams: Record<string, string>;
  /** "Tersedia pada tanggal" is set: the right column shows free / lendable for that range. */
  withDates: boolean;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <ul aria-label={caption} className="nx-rise-list flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <CatalogCard
            key={row.itemId}
            row={row}
            href={itemHref(row.itemId, backParams)}
            withDates={withDates}
            expanded={openIds.has(row.itemId)}
            onToggle={() => toggle(row.itemId)}
          />
        ))}
      </ul>
      {/* No entrance on the tall desktop table: a composited layer that tall is skipped by full-page captures. */}
      <div className="hidden overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1 md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-ivory">
            <tr className="border-b border-hairline text-label-sm font-bold text-walnut uppercase">
              <th scope="col" className="hidden w-24 px-4 py-2.5 md:table-cell">
                Kode
              </th>
              <th scope="col" className="px-3 py-2.5 md:px-4">
                Barang
              </th>
              <th scope="col" className="hidden w-[15%] px-4 py-2.5 md:table-cell">
                Kategori
              </th>
              <th scope="col" className="hidden w-[15%] px-4 py-2.5 md:table-cell">
                Lokasi
              </th>
              <th scope="col" className="w-[6.5rem] px-3 py-2.5 text-right md:w-28 md:px-4">
                {withDates ? "Tersedia" : "Baik / Total"}
              </th>
              <th scope="col" className="hidden w-32 px-4 py-2.5 md:table-cell">
                Kondisi lain
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <Fragment key={row.itemId}>
                <CatalogTableRow
                  row={row}
                  zebra={index % 2 === 1}
                  href={itemHref(row.itemId, backParams)}
                  withDates={withDates}
                  expanded={openIds.has(row.itemId)}
                  onToggle={() => toggle(row.itemId)}
                />
                {row.mode === "tracked" && openIds.has(row.itemId) ? (
                  <tr id={unitsId(row.itemId)} className="border-t border-row-line bg-ivory">
                    <td colSpan={6} className="px-3 py-3 md:px-4">
                      <UnitList row={row} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The item's mark, in the place PI-CORE puts a person's initials (D-023 round 2): a tracked item (each
 * unit has its own code) shows the initials of its name; a counted item shows a box. Walnut on the gold
 * tint. Decorative: the name and the code next to it say the same in words.
 */
function ItemMark({ row, className }: { row: CatalogRow; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border border-gold-tint-line bg-gold-tint font-bold text-walnut",
        className,
      )}
    >
      {row.mode === "tracked" ? (
        <span className="text-label-lg">{initials(row.name)}</span>
      ) : (
        <Package className="size-5" strokeWidth={2} />
      )}
    </span>
  );
}

/** "Barang Uji 04" -> "BU"; one word -> its first two characters. Letters and digits only. */
function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function unitsId(itemId: string, layout: "table" | "card" = "table") {
  return layout === "card" ? `units-card-${itemId}` : `units-${itemId}`;
}

/**
 * Phone card for one item. The name and "x dari y baik" share the first line because they answer the
 * screen's question (is there enough of it?); code, category and location sit under the name.
 */
function CatalogCard({
  row,
  href,
  withDates,
  expanded,
  onToggle,
}: {
  row: CatalogRow;
  href: string;
  withDates: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const unitCount = row.units?.filter((u) => u.status === "active").length ?? row.unitCount;
  const lead = row.mode === "quantity" ? (row.code ?? "") : `${formatCount(unitCount)} unit`;
  const meta = [row.categoryName ?? COPY.noCategory, locationText(row)].join(" · ");
  const hasUnits = row.mode === "tracked" && unitCount > 0;

  return (
    <li className="rounded-xl border border-surface-line bg-surface shadow-elevation-1 transition-colors duration-200 hover:border-gold-tint-line">
      <div className="flex items-start gap-3 px-4 pt-2 pb-3.5">
        <ItemMark row={row} className="mt-1.5 size-11" />
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            className="-mx-1 flex min-h-11 min-w-0 items-center rounded-lg px-1 text-body-lg font-semibold text-walnut hover:underline focus-visible:underline"
          >
            <span className="min-w-0 wrap-anywhere">{row.name}</span>
          </Link>
          {row.isActive ? null : (
            <span className="mb-1 inline-flex">
              <StatusChip tone="ivory">{UNIT_STATUS_LABEL.archived}</StatusChip>
            </span>
          )}
          {lead ? <p className="text-body-sm font-semibold text-ink-body tabular-nums">{lead}</p> : null}
          <p className="text-body-sm break-words text-ink-meta">{meta}</p>
          <OtherConditions row={row} className="mt-2" />
        </div>
        <div className="shrink-0 pt-3 text-right">
          <CountCell row={row} withDates={withDates} />
        </div>
      </div>
      {hasUnits ? (
        <div className="border-t border-row-line px-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={unitsId(row.itemId, "card")}
            onClick={onToggle}
            className="inline-flex min-h-11 w-full items-center gap-1 rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
          >
            {expanded ? "Sembunyikan unit" : `Lihat ${formatCount(unitCount)} unit`}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-180")}
              strokeWidth={2}
            />
          </button>
          {expanded ? (
            <div id={unitsId(row.itemId, "card")} className="mx-2 mb-3 rounded-lg bg-canvas px-3 py-2.5">
              <UnitList row={row} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function CatalogTableRow({
  row,
  zebra,
  href,
  withDates,
  expanded,
  onToggle,
}: {
  row: CatalogRow;
  zebra: boolean;
  href: string;
  withDates: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const unitCount = row.units?.filter((u) => u.status === "active").length ?? row.unitCount;
  const location = locationText(row);
  const category = row.categoryName ?? COPY.noCategory;
  const lead = row.mode === "quantity" ? (row.code ?? "") : `${formatCount(unitCount)} unit`;

  return (
    <tr className={cn("border-t border-row-line align-top first:border-t-0", zebra ? "bg-zebra" : "bg-surface")}>
      <td className="hidden px-4 pt-[19px] pb-3 text-body-sm text-ink-body tabular-nums md:table-cell">{lead}</td>
      <th scope="row" className="px-3 py-1.5 font-normal md:px-4">
        <div className="flex items-center gap-3">
          <ItemMark row={row} className="size-9" />
          <Link
            href={href}
            className="-mx-1 flex min-h-11 min-w-0 items-center rounded-lg px-1 text-body-md font-semibold text-walnut hover:underline focus-visible:underline"
          >
            {/* Long codes without spaces ("QAMW82PY3CKT") must wrap inside the column, not run over the next. */}
            <span className="min-w-0 wrap-anywhere">{row.name}</span>
          </Link>
        </div>
        {row.isActive ? null : (
          // Only managers ever get archived rows (Kelola Barang, filter Nonaktif or Semua).
          <span className="mb-1 inline-flex">
            <StatusChip tone="ivory">{UNIT_STATUS_LABEL.archived}</StatusChip>
          </span>
        )}
        {row.mode === "tracked" && unitCount > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={unitsId(row.itemId)}
            onClick={onToggle}
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
          >
            {expanded ? "Sembunyikan unit" : `Lihat ${formatCount(unitCount)} unit`}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-180")}
              strokeWidth={2}
            />
          </button>
        ) : null}
      </th>
      <td className="hidden px-4 pt-[19px] pb-3 text-body-sm break-words text-ink-body md:table-cell">{category}</td>
      <td className="hidden px-4 pt-[19px] pb-3 text-body-sm break-words text-ink-body md:table-cell">{location}</td>
      <td className="px-3 pt-[18px] pb-3 text-right md:px-4">
        <CountCell row={row} withDates={withDates} />
      </td>
      <td className="hidden px-4 pt-4 pb-3 md:table-cell">
        <OtherConditions row={row} />
      </td>
    </tr>
  );
}

/** "4 dari 5 baik" (K2, never a percentage), or "Tersedia 2 dari 4" with the date filter. */
function CountCell({ row, withDates }: { row: CatalogRow; withDates: boolean }) {
  if (withDates && row.freeQty !== null) {
    return (
      <p className="tabular-nums">
        <span className="block text-body-sm text-ink-body">Tersedia</span>
        <span className="text-body-md font-bold text-ink">
          {formatCount(row.freeQty)} dari {formatCount(row.lendableQty)}
        </span>
      </p>
    );
  }
  return (
    <p className="tabular-nums">
      <span className="text-body-md font-bold text-ink">
        {formatCount(row.qtyGood)} dari {formatCount(row.qtyTotal)}
      </span>{" "}
      <span className="block text-body-sm text-ink-body">baik</span>
    </p>
  );
}

/** Chips only for conditions other than Baik that have a count; a fully good item shows none. */
function OtherConditions({ row, className }: { row: CatalogRow; className?: string }) {
  if (row.qtyNeedsService === 0 && row.qtyDamaged === 0) return null;
  return (
    <p className={cn("flex flex-wrap gap-1.5", className)}>
      {row.qtyNeedsService > 0 ? <StatusChip tone="warning">{formatCount(row.qtyNeedsService)} Perlu servis</StatusChip> : null}
      {row.qtyDamaged > 0 ? <StatusChip tone="danger">{formatCount(row.qtyDamaged)} Rusak</StatusChip> : null}
    </p>
  );
}

function UnitList({ row }: { row: CatalogRow }) {
  const units = row.units ?? [];
  return (
    <ul aria-label={`Unit ${row.name}`} className="flex flex-col gap-2">
      {units.map((unit) => (
        <li key={unit.unitId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-body">
          <span className="font-semibold tabular-nums">{unit.code}</span>
          <UnitChip condition={unit.condition} status={unit.status} />
          <span className="ml-auto break-words">{unit.locationName ?? COPY.noLocation}</span>
        </li>
      ))}
    </ul>
  );
}

/** Quantity item: its location. Tracked item: the one location of its units, or "{n} lokasi". */
function locationText(row: CatalogRow): string {
  if (row.mode === "quantity") return row.locationName ?? COPY.noLocation;
  if (row.locationCount > 1) return `${formatCount(row.locationCount)} lokasi`;
  const named = row.units?.find((u) => u.status === "active" && u.locationName)?.locationName;
  return named ?? COPY.noLocation;
}
