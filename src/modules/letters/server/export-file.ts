import "server-only";
import { toCsvBytes, type CsvValue } from "@/lib/export/csv";
import { jakartaDateTime } from "@/lib/export/datetime";
import { writePdfTable, type PdfColumn } from "@/lib/export/pdf";
import { writeXlsxTable, type XlsxValue } from "@/lib/export/xlsx";
import {
  LETTER_COUNTERPART_LABEL,
  LETTER_PERIOD_FILTER_LABEL,
  LETTER_STATUS_FILTER_LABEL,
  LETTER_STATUS_LABEL,
  LETTER_TYPE_LABEL,
  letterExportFileName,
  letterFieldLabel,
  type LetterExportFormat,
  type LetterExportRow,
  type LetterListFilters,
} from "../types";

// Turns exported register rows into a file (spec F8, section 8; design 14). Same rows and order as the
// screen, all pages; voided letters with their reason (number gaps explainable); dates as stored
// (Jakarta calendar days), timestamps in WIB; header with the tab, the period filter and the export
// time in WIB (A-LT16). No file contents and no links (LT-36). Built in memory, stored nowhere. Text
// cells are written as text (xlsx) or neutralized (csv), so a Perihal starting with "=" never runs as a
// formula.

export type LetterExportFile = { bytes: Uint8Array; contentType: string; fileName: string };

export type LetterExportMeta = {
  /** Active period label from the session (my_context); null = not shown. */
  periodLabel: string | null;
  /** Export time; one value for the file name and the header. */
  exportedAt: Date;
};

const EMPTY = "-";
const YES = "Ya";
const NO = "Tidak";

const CONTENT_TYPES: Record<LetterExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

/** A stored timestamp (UTC ISO) in WIB, e.g. "2026-11-08 14:05 WIB". */
function wib(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : jakartaDateTime(date);
}

/** Header lines under the title: period filter, other filters in use, export time (A-LT16). */
function metaLines(filters: LetterListFilters, meta: LetterExportMeta): string[] {
  const lines: string[] = [];
  const period = LETTER_PERIOD_FILTER_LABEL[filters.period];
  lines.push(filters.period === "active" && meta.periodLabel ? `${period}: ${meta.periodLabel}` : period);
  const used: string[] = [];
  if (filters.status !== "all") used.push(`Status ${LETTER_STATUS_FILTER_LABEL[filters.status]}`);
  if (filters.year !== null) used.push(`Tahun nomor ${filters.year}`);
  if (filters.withoutFiles) used.push("Tanpa berkas");
  if (filters.search !== null) used.push("Dengan pencarian");
  if (used.length > 0) lines.push(`Filter: ${used.join(", ")}`);
  lines.push(`Diekspor ${jakartaDateTime(meta.exportedAt)}`);
  return lines;
}

type Column = {
  header: string;
  /** xlsx width in characters. */
  width: number;
  value: (r: LetterExportRow) => string | number | null;
};

/**
 * Columns (spec section 8): No, Nomor surat, Nomor lama, [Tanggal diterima], Tanggal surat,
 * Pengirim / Ditujukan kepada, [Nomor surat dari pengirim], Perihal, Catatan, Status, Alasan pembatalan,
 * Dari permohonan, Periode, Dicatat oleh, Waktu dicatat, Jumlah berkas. Bracketed columns are incoming
 * only. Field names are the contract's labels, so list, detail, form and export use the same words.
 */
function columnsFor(type: LetterExportRow["type"]): Column[] {
  const incoming = type === "incoming";
  return [
    { header: "No", width: 6, value: (r) => r.rowNo },
    { header: "Nomor surat", width: 26, value: (r) => r.numberText },
    { header: "Nomor lama", width: 11, value: (r) => (r.isLegacyNumber ? YES : NO) },
    ...(incoming ? [{ header: letterFieldLabel("receivedDate", type), width: 16, value: (r: LetterExportRow) => r.receivedDate ?? EMPTY }] : []),
    { header: letterFieldLabel("letterDate", type), width: 14, value: (r) => r.letterDate ?? EMPTY },
    { header: LETTER_COUNTERPART_LABEL[type], width: 30, value: (r) => r.counterpart },
    ...(incoming
      ? [{ header: letterFieldLabel("counterpartNumber", type), width: 24, value: (r: LetterExportRow) => r.counterpartNumber ?? EMPTY }]
      : []),
    { header: letterFieldLabel("subject", type), width: 40, value: (r) => r.subject },
    { header: letterFieldLabel("notes", type), width: 30, value: (r) => r.notes },
    { header: "Status", width: 12, value: (r) => LETTER_STATUS_LABEL[r.status] },
    { header: "Alasan pembatalan", width: 30, value: (r) => r.voidReason },
    { header: "Dari permohonan", width: 15, value: (r) => (r.fromRequest ? YES : NO) },
    { header: "Periode", width: 12, value: (r) => r.periodLabel ?? EMPTY },
    { header: "Dicatat oleh", width: 22, value: (r) => r.createdByName ?? EMPTY },
    { header: "Waktu dicatat", width: 19, value: (r) => wib(r.createdAt) },
    { header: "Jumlah berkas", width: 13, value: (r) => r.fileCount },
  ];
}

/** The PDF combines related cells so the table fits a landscape A4 page. */
function pdfTable(type: LetterExportRow["type"], rows: readonly LetterExportRow[]): { columns: PdfColumn[]; rows: string[][] } {
  const incoming = type === "incoming";
  const columns: PdfColumn[] = [
    { header: "No", weight: 3, align: "right" },
    { header: "Nomor surat", weight: 12 },
    { header: incoming ? "Tanggal" : letterFieldLabel("letterDate", type), weight: 9 },
    { header: LETTER_COUNTERPART_LABEL[type], weight: 13 },
    { header: letterFieldLabel("subject", type), weight: 18 },
    { header: letterFieldLabel("notes", type), weight: 12 },
    { header: "Status", weight: 11 },
    { header: "Periode", weight: 6 },
    { header: "Dicatat", weight: 11 },
    { header: "Berkas", weight: 5, align: "right" },
  ];
  const data = rows.map((r) => {
    const number = [r.numberText, r.isLegacyNumber ? "(Nomor lama)" : null, r.fromRequest ? "(Dari permohonan)" : null]
      .filter((v): v is string => v !== null)
      .join(" ");
    const dates = incoming
      ? [`Diterima ${r.receivedDate ?? EMPTY}`, r.letterDate ? `Tanggal surat ${r.letterDate}` : null].filter((v): v is string => v !== null).join("; ")
      : r.letterDate ?? EMPTY;
    const counterpart = incoming && r.counterpartNumber ? `${r.counterpart} (No. ${r.counterpartNumber})` : r.counterpart;
    const status = r.status === "voided" && r.voidReason ? `${LETTER_STATUS_LABEL[r.status]}: ${r.voidReason}` : LETTER_STATUS_LABEL[r.status];
    return [
      String(r.rowNo),
      number,
      dates,
      counterpart,
      r.subject,
      r.notes ?? EMPTY,
      status,
      r.periodLabel ?? EMPTY,
      `${r.createdByName ?? EMPTY}, ${wib(r.createdAt)}`,
      String(r.fileCount),
    ];
  });
  return { columns, rows: data };
}

export async function buildLetterExportFile(
  format: LetterExportFormat,
  rows: readonly LetterExportRow[],
  filters: LetterListFilters,
  meta: LetterExportMeta,
): Promise<LetterExportFile> {
  const type = filters.type;
  const contentType = CONTENT_TYPES[format];
  const fileName = letterExportFileName(type, format, meta.exportedAt);
  const columns = columnsFor(type);
  const header = columns.map((c) => c.header);
  const data = rows.map((r) => columns.map((c) => c.value(r)));
  const title = `${LETTER_TYPE_LABEL[type]} PMK ITERA`;
  const lines = metaLines(filters, meta);

  switch (format) {
    case "csv": {
      // Plain table only (no title lines), so the file stays machine-readable (as Data Anggota).
      const csv: CsvValue[][] = data;
      return { bytes: toCsvBytes(header, csv), contentType, fileName };
    }
    case "xlsx": {
      const xlsx: XlsxValue[][] = data;
      const bytes = await writeXlsxTable({
        sheetName: LETTER_TYPE_LABEL[type],
        metaLines: [title, ...lines],
        header,
        rows: xlsx,
        columnWidths: columns.map((c) => c.width),
      });
      return { bytes, contentType, fileName };
    }
    case "pdf": {
      const table = pdfTable(type, rows);
      const bytes = await writePdfTable({
        title,
        metaLines: lines,
        columns: table.columns,
        rows: table.rows,
        pageLabel: (page, pageCount) => `Halaman ${page} dari ${pageCount}`,
        info: { title, author: "PMK-NEXUS" },
        layout: "landscape",
      });
      return { bytes, contentType, fileName };
    }
  }
}
