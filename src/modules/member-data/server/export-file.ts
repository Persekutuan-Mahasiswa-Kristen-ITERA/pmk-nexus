import "server-only";
import { toCsvBytes, type CsvValue } from "@/lib/export/csv";
import { jakartaDate, jakartaDateTime } from "@/lib/export/datetime";
import { writePdfTable, type PdfColumn } from "@/lib/export/pdf";
import { writeXlsxTable, type XlsxValue } from "@/lib/export/xlsx";
import { MEMBER_EMPTY_VALUE, formatMemberUnit, type MemberExportFormat, type MemberRow } from "../types";

// Turns the exported rows into a file (spec F5, A-MD5): the same information as the screen, with the
// "Pembina" marker as its own column and unit and position as separate columns.
// Columns: No, Nama Lengkap, Pembina (Ya / empty), Unit, Jabatan, Status (Aktif / Nonaktif).

export type MemberExportFile = {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
};

export type MemberExportMeta = {
  /** Active period label from the session (my_context); null = not shown. */
  periodLabel: string | null;
  /** Export time; one value for the file name and the header. */
  exportedAt: Date;
};

const TITLE = "Data Anggota PMK ITERA";
const HEADER = ["No", "Nama Lengkap", "Pembina", "Unit", "Jabatan", "Status"] as const;

const CONTENT_TYPES: Record<MemberExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

/** "data-anggota-2026-11-06.csv" (date in Asia/Jakarta). */
export function memberExportFileName(format: MemberExportFormat, exportedAt: Date): string {
  return `data-anggota-${jakartaDate(exportedAt)}.${format}`;
}

/** One output row as text cells (shared by all formats). Pembina empty = not a lecturer. */
function cells(row: MemberRow): { no: number; texts: [string, string, string, string, string] } {
  return {
    no: row.rowNo,
    texts: [
      row.fullName,
      row.isLecturer ? "Ya" : "",
      formatMemberUnit(row) ?? MEMBER_EMPTY_VALUE,
      row.positionName ?? MEMBER_EMPTY_VALUE,
      row.isActive ? "Aktif" : "Nonaktif",
    ],
  };
}

function metaLines(meta: MemberExportMeta): string[] {
  const lines: string[] = [];
  if (meta.periodLabel) lines.push(`Periode ${meta.periodLabel}`);
  lines.push(`Diekspor ${jakartaDateTime(meta.exportedAt)}`);
  return lines;
}

export async function buildMemberExportFile(
  format: MemberExportFormat,
  rows: readonly MemberRow[],
  meta: MemberExportMeta,
): Promise<MemberExportFile> {
  const fileName = memberExportFileName(format, meta.exportedAt);
  const contentType = CONTENT_TYPES[format];
  const table = rows.map(cells);

  switch (format) {
    case "csv": {
      // Plain table only (no title lines), so the file stays machine-readable.
      const data: CsvValue[][] = table.map(({ no, texts }) => [no, ...texts.map((t) => (t === "" ? null : t))]);
      return { bytes: toCsvBytes(HEADER, data), contentType, fileName };
    }
    case "xlsx": {
      const data: XlsxValue[][] = table.map(({ no, texts }) => [no, ...texts.map((t) => (t === "" ? null : t))]);
      const bytes = await writeXlsxTable({
        sheetName: "Data Anggota",
        metaLines: [TITLE, ...metaLines(meta)],
        header: HEADER,
        rows: data,
        columnWidths: [6, 36, 10, 40, 26, 11],
      });
      return { bytes, contentType, fileName };
    }
    case "pdf": {
      const columns: PdfColumn[] = [
        { header: HEADER[0], weight: 5, align: "right" },
        { header: HEADER[1], weight: 28 },
        { header: HEADER[2], weight: 9 },
        { header: HEADER[3], weight: 30 },
        { header: HEADER[4], weight: 18 },
        { header: HEADER[5], weight: 10 },
      ];
      const bytes = await writePdfTable({
        title: TITLE,
        metaLines: metaLines(meta),
        columns,
        rows: table.map(({ no, texts }) => [String(no), ...texts]),
        pageLabel: (page, pageCount) => `Halaman ${page} dari ${pageCount}`,
        info: { title: TITLE, author: "PMK-NEXUS" },
      });
      return { bytes, contentType, fileName };
    }
  }
}
