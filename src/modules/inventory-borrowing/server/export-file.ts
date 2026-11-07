import "server-only";
import { toCsvBytes, type CsvValue } from "@/lib/export/csv";
import { jakartaDate, jakartaDateTime } from "@/lib/export/datetime";
import { writePdfTable, type PdfColumn } from "@/lib/export/pdf";
import { writeXlsxTable, type XlsxValue } from "@/lib/export/xlsx";
import type { BorrowingExportRow } from "@/lib/picore/inventory-borrowing";
import {
  CONDITION_LABEL,
  ITEM_MODE_LABEL,
  QUEUE_VIEW_LABEL,
  REQUEST_STATUS_LABEL,
  inventoryExportStatusLabel,
  type CatalogFilters,
  type InventoryExportFormat,
  type InventoryExportRow,
  type QueueFilters,
  type RequestItemSummary,
} from "../types";

// Turns exported rows into a file (spec F12, section 8; design 15). Same rows and order as the screen,
// dates in WIB, header with the period label and the export time (A-IB12). Built in memory, stored
// nowhere. Evidence photos are never exported. Text cells are written as text (xlsx) or neutralized
// (csv), so a name starting with "=" never runs as a formula.

export type InventoryExportFile = { bytes: Uint8Array; contentType: string; fileName: string };

export type InventoryExportMeta = {
  /** Active period label from the session (my_context); null = not shown. */
  periodLabel: string | null;
  /** Export time; one value for the file name and the header. */
  exportedAt: Date;
};

const EMPTY = "-";

const CONTENT_TYPES: Record<InventoryExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

/** "inventaris-2026-11-08.xlsx" / "peminjaman-2026-11-08.csv" (date in Asia/Jakarta, design 15.2). */
export function inventoryExportFileName(kind: "inventaris" | "peminjaman", format: InventoryExportFormat, exportedAt: Date): string {
  return `${kind}-${jakartaDate(exportedAt)}.${format}`;
}

/** A stored timestamp (UTC ISO) in WIB, e.g. "2026-11-08 14:05 WIB". */
function wib(timestamp: string | null): string | null {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : jakartaDateTime(date);
}

function baseMeta(meta: InventoryExportMeta): string[] {
  const lines: string[] = [];
  if (meta.periodLabel) lines.push(`Periode ${meta.periodLabel}`);
  lines.push(`Diekspor ${jakartaDateTime(meta.exportedAt)}`);
  return lines;
}

/** One table in a neutral form, written by each format. Numbers stay numbers in xlsx and csv. */
type Table = {
  title: string;
  sheetName: string;
  metaLines: string[];
  header: string[];
  rows: (string | number | null)[][];
  /** xlsx column widths (characters). */
  widths: number[];
  /** PDF columns (may combine cells) and rows. */
  pdf: { columns: PdfColumn[]; rows: string[][] };
};

async function writeTable(format: InventoryExportFormat, table: Table, fileName: string): Promise<InventoryExportFile> {
  const contentType = CONTENT_TYPES[format];
  switch (format) {
    case "csv": {
      // Plain table only (no title lines), so the file stays machine-readable (as Data Anggota).
      const data: CsvValue[][] = table.rows;
      return { bytes: toCsvBytes(table.header, data), contentType, fileName };
    }
    case "xlsx": {
      const data: XlsxValue[][] = table.rows;
      const bytes = await writeXlsxTable({
        sheetName: table.sheetName,
        metaLines: [table.title, ...table.metaLines],
        header: table.header,
        rows: data,
        columnWidths: table.widths,
      });
      return { bytes, contentType, fileName };
    }
    case "pdf": {
      const bytes = await writePdfTable({
        title: table.title,
        metaLines: table.metaLines,
        columns: table.pdf.columns,
        rows: table.pdf.rows,
        pageLabel: (page, pageCount) => `Halaman ${page} dari ${pageCount}`,
        info: { title: table.title, author: "PMK-NEXUS" },
        layout: "landscape",
      });
      return { bytes, contentType, fileName };
    }
  }
}

const cell = (value: string | number | null): string => (value === null ? "" : String(value));

// ---------------------------------------------------------------------------------------------
// Inventory (catalog) export
// ---------------------------------------------------------------------------------------------

/**
 * Columns: No, Kode, Nama Barang, Cara Catat, Kategori, Lokasi, Kondisi (unit rows), Baik, Perlu servis,
 * Rusak, Total (quantity rows), Status (ONE column: Aktif / Nonaktif / Hilang, inventoryExportStatusLabel),
 * and "Tersedia" only with the "Tersedia pada tanggal" filter.
 */
export async function buildInventoryExportFile(
  format: InventoryExportFormat,
  rows: readonly InventoryExportRow[],
  filters: CatalogFilters,
  meta: InventoryExportMeta,
): Promise<InventoryExportFile> {
  const withFree = filters.availableFrom !== null && filters.availableTo !== null;
  const header = [
    "No", "Kode", "Nama Barang", "Cara Catat", "Kategori", "Lokasi", "Kondisi", "Baik", "Perlu servis", "Rusak", "Total", "Status",
    ...(withFree ? ["Tersedia"] : []),
  ];
  const data = rows.map((r) => [
    r.rowNo,
    r.code ?? EMPTY,
    r.itemName,
    ITEM_MODE_LABEL[r.mode],
    r.categoryName ?? EMPTY,
    r.locationName ?? EMPTY,
    r.unitCondition === null ? null : CONDITION_LABEL[r.unitCondition],
    r.qtyGood,
    r.qtyNeedsService,
    r.qtyDamaged,
    r.qtyTotal,
    inventoryExportStatusLabel(r),
    ...(withFree ? [r.freeQty] : []),
  ]);

  const metaLines = baseMeta(meta);
  if (withFree) metaLines.push(`Tersedia pada tanggal ${filters.availableFrom} s.d. ${filters.availableTo}`);

  const weights = [4, 8, 18, 10, 10, 10, 7, 5, 6, 5, 5, 7, ...(withFree ? [6] : [])];
  const numeric = new Set([0, 7, 8, 9, 10, 12]);
  const table: Table = {
    title: "Inventaris PMK ITERA",
    sheetName: "Inventaris",
    metaLines,
    header,
    rows: data,
    widths: [6, 12, 32, 18, 18, 18, 13, 7, 12, 7, 7, 10, ...(withFree ? [10] : [])],
    pdf: {
      columns: header.map((h, i) => ({ header: h, weight: weights[i], align: numeric.has(i) ? "right" : "left" })),
      rows: data.map((row) => row.map(cell)),
    },
  };
  return writeTable(format, table, inventoryExportFileName("inventaris", format, meta.exportedAt));
}

// ---------------------------------------------------------------------------------------------
// Borrowing export
// ---------------------------------------------------------------------------------------------

/** "Proyektor (INV-0001): diminta 2, disetujui 1, diserahkan 1, belum kembali 1". */
function itemText(item: RequestItemSummary): string {
  const parts = [`diminta ${item.quantityRequested}`];
  if (item.quantityApproved !== null) parts.push(`disetujui ${item.quantityApproved}`);
  if (item.quantityHandedOver !== null) {
    parts.push(`diserahkan ${item.quantityHandedOver}`);
    if (item.quantityOutstanding > 0) parts.push(`belum kembali ${item.quantityOutstanding}`);
  }
  return `${item.name}${item.code ? ` (${item.code})` : ""}: ${parts.join(", ")}`;
}

/** Derived states with the chip words of design 17. */
function stateNotes(r: BorrowingExportRow): string {
  const notes: string[] = [];
  if (r.isOverdue) notes.push(`Terlambat ${r.overdueDays} hari`);
  if (r.isNotPickedUp) notes.push("Belum diambil");
  if (r.isPartiallyReturned) notes.push("Sebagian kembali");
  if (r.hasIssue) notes.push("Ada masalah");
  return notes.join(", ");
}

/** Who asked: the member, or "{organisasi} ({penanggung jawab})" for an outside party. */
function borrowerText(r: BorrowingExportRow): string {
  if (r.isOutsideParty) {
    const org = r.outsideOrgName ?? EMPTY;
    return r.outsideContactName ? `${org} (${r.outsideContactName})` : org;
  }
  return r.requesterName ?? EMPTY;
}

/**
 * Columns: No, Referensi, Status, Keterangan, Periode, Peminjam, Dicatat Oleh (outside party), Keperluan,
 * Barang, Unit Diserahkan, Mulai, Selesai, Perpanjangan, Diputuskan Oleh, Waktu Keputusan, Catatan
 * Keputusan, Waktu Serah Terima, Waktu Kembali, Kembali Baik, Kembali Rusak, Hilang.
 * The PDF combines related cells so the table fits a landscape page.
 */
export async function buildBorrowingExportFile(
  format: InventoryExportFormat,
  rows: readonly BorrowingExportRow[],
  filters: QueueFilters,
  meta: InventoryExportMeta,
): Promise<InventoryExportFile> {
  const header = [
    "No", "Referensi", "Status", "Keterangan", "Periode", "Peminjam", "Dicatat Oleh", "Keperluan", "Barang",
    "Unit Diserahkan", "Mulai", "Selesai", "Perpanjangan", "Diputuskan Oleh", "Waktu Keputusan", "Catatan Keputusan",
    "Waktu Serah Terima", "Waktu Kembali", "Kembali Baik", "Kembali Rusak", "Hilang",
  ];
  const nullable = (text: string) => (text === "" ? null : text);
  const data = rows.map((r) => [
    r.rowNo,
    r.reference,
    REQUEST_STATUS_LABEL[r.status],
    nullable(stateNotes(r)),
    r.periodLabel ?? EMPTY,
    borrowerText(r),
    r.isOutsideParty ? r.requesterName ?? EMPTY : null,
    r.purpose,
    r.items.map(itemText).join("; "),
    nullable(r.unitsHandedOver.join(", ")),
    r.startDate,
    r.endDate,
    r.extensionCount,
    r.decidedByName,
    wib(r.decidedAt),
    r.decisionNote,
    wib(r.handedOverAt),
    wib(r.returnedAt),
    r.returnedGood,
    r.returnedDamaged,
    r.returnedLost,
  ]);

  const pdfColumns: PdfColumn[] = [
    { header: "No", weight: 3, align: "right" },
    { header: "Referensi", weight: 7 },
    { header: "Status", weight: 8 },
    { header: "Peminjam", weight: 10 },
    { header: "Keperluan", weight: 11 },
    { header: "Barang", weight: 16 },
    { header: "Tanggal", weight: 9 },
    { header: "Keputusan", weight: 11 },
    { header: "Serah / Kembali", weight: 9 },
    { header: "Hasil Kembali", weight: 8 },
    { header: "Periode", weight: 6 },
  ];
  const pdfRows = rows.map((r) => {
    const notes = stateNotes(r);
    const units = r.unitsHandedOver.length > 0 ? ` Unit: ${r.unitsHandedOver.join(", ")}` : "";
    const decision = [r.decidedByName, wib(r.decidedAt), r.decisionNote].filter((v): v is string => v !== null && v !== "");
    const moves = [r.handedOverAt ? `Serah ${wib(r.handedOverAt)}` : null, r.returnedAt ? `Kembali ${wib(r.returnedAt)}` : null];
    return [
      String(r.rowNo),
      r.reference,
      notes ? `${REQUEST_STATUS_LABEL[r.status]}, ${notes}` : REQUEST_STATUS_LABEL[r.status],
      r.isOutsideParty && r.requesterName ? `${borrowerText(r)}, dicatat ${r.requesterName}` : borrowerText(r),
      r.purpose,
      `${r.items.map(itemText).join("; ")}${units}`,
      `${r.startDate} s.d. ${r.endDate}${r.extensionCount > 0 ? ` (diperpanjang ${r.extensionCount}x)` : ""}`,
      decision.length > 0 ? decision.join(", ") : EMPTY,
      moves.filter((v): v is string => v !== null).join("; ") || EMPTY,
      r.returnedGood + r.returnedDamaged + r.returnedLost > 0
        ? `Baik ${r.returnedGood}, Rusak ${r.returnedDamaged}, Hilang ${r.returnedLost}`
        : EMPTY,
      r.periodLabel ?? EMPTY,
    ];
  });

  const metaLines = baseMeta(meta);
  metaLines.splice(metaLines.length - 1, 0, `Tampilan: ${QUEUE_VIEW_LABEL[filters.view]}`);

  const table: Table = {
    title: "Peminjaman Barang PMK ITERA",
    sheetName: "Peminjaman",
    metaLines,
    header,
    rows: data,
    widths: [6, 12, 13, 26, 11, 30, 22, 36, 50, 26, 11, 11, 12, 22, 19, 36, 19, 19, 12, 13, 8],
    pdf: { columns: pdfColumns, rows: pdfRows },
  };
  return writeTable(format, table, inventoryExportFileName("peminjaman", format, meta.exportedAt));
}
