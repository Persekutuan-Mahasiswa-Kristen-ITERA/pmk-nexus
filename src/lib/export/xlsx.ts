import "server-only";
import writeXlsxFile, { type Cell, type Row, type SheetData } from "write-excel-file/node";

// .xlsx writer (D-020: write-excel-file, server side).
// Formula safety (checked in write-excel-file 4.1.1, modules/xlsx/files/sheet.xml/cell.js): a cell is
// written as a formula ONLY when its type is the string 'Formula'. Every text cell here is written with
// `type: String`, which becomes a shared string (t="s", XML-escaped). So a name starting with "=" is
// stored as text and never evaluated, and no apostrophe prefix is added (the name stays exact).

export type XlsxValue = string | number | null;

export type XlsxTable = {
  sheetName: string;
  /** Lines above the table (title first, in bold). Leave empty for a plain table. */
  metaLines: readonly string[];
  header: readonly string[];
  rows: readonly (readonly XlsxValue[])[];
  /** Column widths in characters, one per header column. */
  columnWidths: readonly number[];
  /**
   * Optional Excel number format per column (e.g. "#,##0"), applied to NUMBER cells only; text cells and
   * columns without a format are unchanged. Finance uses it for integer rupiah cells (spec 8).
   */
  columnFormats?: readonly (string | undefined)[];
};

function textCell(value: string, bold = false): Cell {
  return bold ? { value, type: String, fontWeight: "bold" } : { value, type: String };
}

function valueCell(value: XlsxValue, format?: string): Cell {
  if (value === null) return null;
  if (typeof value === "number") return format === undefined ? { value, type: Number } : { value, type: Number, format };
  return textCell(value);
}

/** Builds the workbook bytes: optional meta lines, one empty row, a bold header row, then the rows. */
export async function writeXlsxTable(table: XlsxTable): Promise<Uint8Array> {
  const data: SheetData = [];
  table.metaLines.forEach((line, index) => data.push([textCell(line, index === 0)]));
  if (table.metaLines.length > 0) data.push([null]);
  data.push(table.header.map((label) => textCell(label, true)));
  for (const row of table.rows) data.push(row.map((value, column) => valueCell(value, table.columnFormats?.[column])) as Row);

  const buffer = await writeXlsxFile(data, {
    sheet: table.sheetName,
    columns: table.columnWidths.map((width) => ({ width })),
  }).toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
