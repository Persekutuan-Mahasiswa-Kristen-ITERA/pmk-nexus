import "server-only";
import { toCsvBytes, type CsvValue } from "@/lib/export/csv";
import { jakartaDateTime } from "@/lib/export/datetime";
import { writePdfBlocks, type PdfBlock } from "@/lib/export/pdf";
import { writeXlsxTable, type XlsxValue } from "@/lib/export/xlsx";
import type { MinuteExportTarget } from "@/lib/picore/minutes";
import {
  MINUTE_COPY,
  MINUTE_EXPORT_COLUMNS,
  MINUTE_FIELD_LABEL,
  MINUTE_PERIOD_FILTER_LABEL,
  MINUTE_STATUS_FILTER_LABEL,
  MINUTE_STATUS_LABEL,
  formatMinuteCopy,
  minuteExportFileName,
  minuteUnitLabel,
  type MinuteExportFormat,
  type MinuteExportRow,
} from "../types";

// Turns exported minutes into a file (spec F6, section 8). Same rows and order as the screen, all
// pages (or the one minute); voided minutes with their reason; meeting dates as stored (Jakarta
// calendar days), timestamps in WIB; header with the period filter and the export time in WIB (A-MN16).
// Content and decision in full; no file links (A-MN16). Built in memory, stored nowhere. All user text
// is plain text (R10, MN-16): xlsx text cells are shared strings (never formulas), csv cells are
// neutralized (a title starting with "=" never runs), the PDF draws text only.

export type MinuteExportFile = { bytes: Uint8Array; contentType: string; fileName: string };

export type MinuteExportMeta = {
  /** Active period label from the session (my_context); null = not shown. */
  periodLabel: string | null;
  /** Export time; one value for the file name and the header. */
  exportedAt: Date;
};

const EMPTY = "-";

const CONTENT_TYPES: Record<MinuteExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

/** A stored timestamp (UTC ISO) in WIB, e.g. "2026-11-08 14:05 WIB". */
function wib(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : jakartaDateTime(date);
}

type ColumnKey = (typeof MINUTE_EXPORT_COLUMNS)[number]["key"];

/** One value per contract column (MINUTE_EXPORT_COLUMNS order). */
const VALUE: Record<ColumnKey, (r: MinuteExportRow) => string | number> = {
  rowNo: (r) => r.rowNo,
  meetingDate: (r) => r.meetingDate,
  unit: (r) => minuteUnitLabel(r),
  title: (r) => r.title,
  topic: (r) => r.topic,
  content: (r) => r.content,
  decision: (r) => r.decision ?? EMPTY,
  status: (r) => MINUTE_STATUS_LABEL[r.status],
  voidReason: (r) => r.voidReason ?? EMPTY,
  period: (r) => r.periodLabel ?? EMPTY,
  createdBy: (r) => r.createdByName ?? EMPTY,
  createdAt: (r) => wib(r.createdAt),
  fileCount: (r) => r.fileCount,
};

/** xlsx widths in characters. */
const WIDTH: Record<ColumnKey, number> = {
  rowNo: 6,
  meetingDate: 13,
  unit: 24,
  title: 32,
  topic: 32,
  content: 60,
  decision: 40,
  status: 12,
  voidReason: 30,
  period: 12,
  createdBy: 22,
  createdAt: 19,
  fileCount: 13,
};

/** Header lines under the title: what was exported (filters or one minute) and the export time (A-MN16). */
function metaLines(rows: readonly MinuteExportRow[], target: MinuteExportTarget, meta: MinuteExportMeta): string[] {
  const lines: string[] = [];
  if (target.kind === "list") {
    const { filters } = target;
    const period = MINUTE_PERIOD_FILTER_LABEL[filters.period];
    lines.push(filters.period === "active" && meta.periodLabel ? `${period}: ${meta.periodLabel}` : period);
    const used: string[] = [`Status ${MINUTE_STATUS_FILTER_LABEL[filters.status]}`];
    // The unit filter names the unit through the rows (all rows share it); no rows = no name to show.
    if (filters.unitId !== null) used.push(rows.length > 0 ? `Unit ${minuteUnitLabel(rows[0])}` : "Satu unit");
    if (filters.search !== null) used.push("Dengan pencarian");
    lines.push(`Filter: ${used.join(", ")}`);
  }
  lines.push(`Diekspor ${jakartaDateTime(meta.exportedAt)}`);
  return lines;
}

/** One PDF block per minute: title, meta, then topic, content and decision as their own paragraphs. */
function pdfBlock(r: MinuteExportRow, single: boolean): PdfBlock {
  const status =
    r.status === "voided" && r.voidReason
      ? `Status: ${MINUTE_STATUS_LABEL[r.status]}. ${formatMinuteCopy(MINUTE_COPY.detail.historyReason, { alasan: r.voidReason })}`
      : `Status: ${MINUTE_STATUS_LABEL[r.status]}`;
  return {
    heading: single ? r.title : `${r.rowNo}. ${r.title}`,
    meta: [
      `${MINUTE_FIELD_LABEL.meetingDate}: ${r.meetingDate} · Unit: ${minuteUnitLabel(r)} · Periode: ${r.periodLabel ?? EMPTY}`,
      status,
      `Dicatat oleh ${r.createdByName ?? EMPTY}, ${wib(r.createdAt)} · ${formatMinuteCopy(MINUTE_COPY.list.fileCount, { n: r.fileCount })}`,
    ],
    sections: [
      { label: MINUTE_FIELD_LABEL.topic, text: r.topic },
      { label: MINUTE_FIELD_LABEL.content, text: r.content },
      { label: MINUTE_FIELD_LABEL.decision, text: r.decision ?? MINUTE_COPY.detail.noDecision },
    ],
  };
}

export async function buildMinuteExportFile(
  format: MinuteExportFormat,
  rows: readonly MinuteExportRow[],
  target: MinuteExportTarget,
  meta: MinuteExportMeta,
): Promise<MinuteExportFile> {
  const contentType = CONTENT_TYPES[format];
  const single = target.kind === "single" ? rows[0] : undefined;
  const fileName = minuteExportFileName(single ? { kind: "single", meetingDate: single.meetingDate } : { kind: "list" }, format, meta.exportedAt);
  const header = MINUTE_EXPORT_COLUMNS.map((c) => c.header);
  const data = rows.map((r) => MINUTE_EXPORT_COLUMNS.map((c) => VALUE[c.key](r)));
  const title = `${MINUTE_COPY.moduleTitle} PMK ITERA`;
  const lines = metaLines(rows, target, meta);

  switch (format) {
    case "csv": {
      // Plain table only (no title lines), so the file stays machine-readable (as the other modules).
      const csv: CsvValue[][] = data;
      return { bytes: toCsvBytes(header, csv), contentType, fileName };
    }
    case "xlsx": {
      const xlsx: XlsxValue[][] = data;
      const bytes = await writeXlsxTable({
        sheetName: MINUTE_COPY.moduleTitle,
        metaLines: [title, ...lines],
        header,
        rows: xlsx,
        columnWidths: MINUTE_EXPORT_COLUMNS.map((c) => WIDTH[c.key]),
      });
      return { bytes, contentType, fileName };
    }
    case "pdf": {
      const bytes = await writePdfBlocks({
        title,
        metaLines: lines,
        blocks: rows.map((r) => pdfBlock(r, target.kind === "single")),
        emptyText: MINUTE_COPY.list.empty,
        pageLabel: (page, pageCount) => `Halaman ${page} dari ${pageCount}`,
        info: { title, author: "PMK-NEXUS" },
      });
      return { bytes, contentType, fileName };
    }
  }
}
