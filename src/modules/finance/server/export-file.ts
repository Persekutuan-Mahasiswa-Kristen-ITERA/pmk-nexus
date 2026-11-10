import "server-only";
import { toCsvWithPreamble, type CsvValue } from "@/lib/export/csv";
import { jakartaDateTime } from "@/lib/export/datetime";
import { writePdfTable } from "@/lib/export/pdf";
import { writeXlsxTable, type XlsxValue } from "@/lib/export/xlsx";
import {
  FINANCE_ENTRY_TYPE_LABEL,
  FINANCE_EXPORT_COLUMNS,
  FINANCE_EXPORT_PROOF_LABEL,
  FINANCE_EXPORT_SUMMARY_LABEL,
  FINANCE_STATUS_LABEL,
  FINANCE_TYPE_FILTER_LABEL,
  FINANCE_COPY,
  financeExportFileName,
  formatRupiah,
  rupiahToSafeInteger,
  type FinanceExportFormat,
  type FinanceExportRow,
  type FinanceExportSummary,
  type FinanceListFilters,
} from "../types";

// Turns exported entries into a file (spec F7, section 8). Same rows and order as the screen, ALL pages;
// the summary of the WHOLE period first (period, Saldo awal, totals, export time in WIB, the filters
// used); voided entries marked with their reason; dates as stored (Jakarta calendar days), timestamps in
// WIB; no proof contents and no links. Built in memory, stored nowhere.
//
// MONEY (spec 4.2, FN-09): CSV holds plain integers without separators, Excel holds integer cells with a
// number format, PDF holds the "Rp" format. The only Number conversion is rupiahToSafeInteger(), which
// refuses anything that is not a safe integer. Money is NEVER handed to the CSV writer as text: a negative
// balance "-250000" would be read as a formula start and prefixed with an apostrophe.
//
// TEXT (FN-30, R16): xlsx text cells are shared strings (never formulas), csv text cells are neutralised
// (a Keterangan starting with "=", "+", "-" or "@" never runs), the PDF draws text only.

export type FinanceExportFile = { bytes: Uint8Array; contentType: string; fileName: string };

export type FinanceExportMeta = {
  /** Label of the exported period (from the rows or the summary read); null = not shown. */
  periodLabel: string | null;
  /** Export time; one value for the file name and the header. */
  exportedAt: Date;
};

const EMPTY = "-";
const AMOUNT_FORMAT = "#,##0";

const CONTENT_TYPES: Record<FinanceExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

/** A stored timestamp (UTC ISO) in WIB, e.g. "2026-11-08 14:05 WIB". */
function wib(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : jakartaDateTime(date);
}

type ColumnKey = (typeof FINANCE_EXPORT_COLUMNS)[number]["key"];

/** Cell value per contract column. Amount is the integer for CSV and Excel; the PDF formats it itself. */
const VALUE: Record<ColumnKey, (r: FinanceExportRow) => string | number> = {
  rowNo: (r) => r.rowNo,
  numberText: (r) => r.numberText,
  entryDate: (r) => r.entryDate,
  entryType: (r) => FINANCE_ENTRY_TYPE_LABEL[r.entryType],
  description: (r) => r.description,
  notes: (r) => r.notes ?? EMPTY,
  amount: (r) => rupiahToSafeInteger(r.amount),
  status: (r) => FINANCE_STATUS_LABEL[r.status],
  voidReason: (r) => r.voidReason ?? EMPTY,
  correctsNumberText: (r) => r.correctsNumberText ?? EMPTY,
  createdByName: (r) => r.createdByName ?? EMPTY,
  createdAt: (r) => wib(r.createdAt),
  hasProof: (r) => (r.hasProof ? FINANCE_EXPORT_PROOF_LABEL.yes : FINANCE_EXPORT_PROOF_LABEL.no),
  periodLabel: (r) => r.periodLabel ?? EMPTY,
};

/** xlsx widths in characters, per contract column. */
const WIDTH: Record<ColumnKey, number> = {
  rowNo: 6,
  numberText: 11,
  entryDate: 12,
  entryType: 13,
  description: 40,
  notes: 32,
  amount: 16,
  status: 12,
  voidReason: 30,
  correctsNumberText: 13,
  createdByName: 22,
  createdAt: 19,
  hasProof: 11,
  periodLabel: 12,
};

/** PDF column shares (landscape A4: 14 columns is the contract's list). */
const PDF_WEIGHT: Record<ColumnKey, number> = {
  rowNo: 3,
  numberText: 7,
  entryDate: 8,
  entryType: 8,
  description: 20,
  notes: 14,
  amount: 11,
  status: 7,
  voidReason: 12,
  correctsNumberText: 7,
  createdByName: 10,
  createdAt: 10,
  hasProof: 6,
  periodLabel: 7,
};

/** The filters used, in words, for the header block (A-FN14). The search text itself is shown. */
function filterParts(filters: FinanceListFilters): string[] {
  const L = FINANCE_EXPORT_SUMMARY_LABEL;
  const yesNo = (value: boolean) => (value ? L.yes : L.no);
  return [
    `${L.type}: ${FINANCE_TYPE_FILTER_LABEL[filters.type]}`,
    `${L.from}: ${filters.from ?? EMPTY}`,
    `${L.to}: ${filters.to ?? EMPTY}`,
    `${L.includeVoided}: ${yesNo(filters.includeVoided)}`,
    `${L.withoutProof}: ${yesNo(filters.withoutProof)}`,
    `${L.search}: ${filters.search ?? EMPTY}`,
  ];
}

/** The summary of the WHOLE period (not the filter), then the export time and the filters (spec F7.2). */
export function financeSummaryLines(summary: FinanceExportSummary, meta: FinanceExportMeta, filters: FinanceListFilters): string[] {
  const L = FINANCE_EXPORT_SUMMARY_LABEL;
  return [
    `${L.period}: ${meta.periodLabel ?? EMPTY}`,
    `${L.opening}: ${formatRupiah(summary.opening)}`,
    `${L.income}: ${formatRupiah(summary.income)}`,
    `${L.expense}: ${formatRupiah(summary.expense)}`,
    `${L.balance}: ${formatRupiah(summary.balance)}`,
    `${L.exportedAt}: ${jakartaDateTime(meta.exportedAt)}`,
    `${L.filters}: ${filterParts(filters).join(" · ")}`,
  ];
}

export async function buildFinanceExportFile(
  format: FinanceExportFormat,
  rows: readonly FinanceExportRow[],
  summary: FinanceExportSummary,
  filters: FinanceListFilters,
  meta: FinanceExportMeta,
): Promise<FinanceExportFile> {
  const contentType = CONTENT_TYPES[format];
  const fileName = financeExportFileName(format, meta.periodLabel, meta.exportedAt);
  const header = FINANCE_EXPORT_COLUMNS.map((c) => c.header);
  const title = `${FINANCE_COPY.page.title} PMK ITERA`;
  const lines = financeSummaryLines(summary, meta, filters);

  switch (format) {
    case "csv": {
      // The summary block first as plain rows (A-FN14), then the table. Money as integers, never as text.
      const L = FINANCE_EXPORT_SUMMARY_LABEL;
      const block: CsvValue[][] = [
        [L.period, meta.periodLabel ?? EMPTY],
        [L.opening, rupiahToSafeInteger(summary.opening)],
        [L.income, rupiahToSafeInteger(summary.income)],
        [L.expense, rupiahToSafeInteger(summary.expense)],
        [L.balance, rupiahToSafeInteger(summary.balance)],
        [L.exportedAt, jakartaDateTime(meta.exportedAt)],
        [L.filters, filterParts(filters).join(" · ")],
        [],
      ];
      const data: CsvValue[][] = rows.map((r) => FINANCE_EXPORT_COLUMNS.map((c) => VALUE[c.key](r)));
      return { bytes: toCsvWithPreamble(block, header, data), contentType, fileName };
    }
    case "xlsx": {
      const data: XlsxValue[][] = rows.map((r) => FINANCE_EXPORT_COLUMNS.map((c) => VALUE[c.key](r)));
      const bytes = await writeXlsxTable({
        sheetName: FINANCE_COPY.page.title,
        metaLines: [title, ...lines],
        header,
        rows: data,
        columnWidths: FINANCE_EXPORT_COLUMNS.map((c) => WIDTH[c.key]),
        columnFormats: FINANCE_EXPORT_COLUMNS.map((c) => (c.key === "amount" ? AMOUNT_FORMAT : undefined)),
      });
      return { bytes, contentType, fileName };
    }
    case "pdf": {
      const pdfRows = rows.map((r) =>
        FINANCE_EXPORT_COLUMNS.map((c) => (c.key === "amount" ? formatRupiah(r.amount) : String(VALUE[c.key](r)))),
      );
      const bytes = await writePdfTable({
        title,
        metaLines: lines,
        columns: FINANCE_EXPORT_COLUMNS.map((c) => ({
          header: c.header,
          weight: PDF_WEIGHT[c.key],
          align: c.key === "amount" ? ("right" as const) : ("left" as const),
        })),
        rows: pdfRows,
        pageLabel: (page, pageCount) => `Halaman ${page} dari ${pageCount}`,
        info: { title, author: "PMK-NEXUS" },
        layout: "landscape",
      });
      return { bytes, contentType, fileName };
    }
  }
}
