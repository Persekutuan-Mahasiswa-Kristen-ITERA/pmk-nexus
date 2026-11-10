import "server-only";
import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";

// PDF writers (D-020: pdfkit, server side). writePdfTable: A4 portrait (or landscape on request), simple ruled table, header
// row repeated on every page, "Halaman x dari y" footer. writePdfBlocks: one block per record (heading, meta lines,
// labelled long texts with their line breaks), flowing across pages, same footer (Meeting Minutes spec 8).
// Fonts: Plus Jakarta Sans Regular and Bold (SIL OFL 1.1, see fonts/OFL.txt), embedded and subset, so
// Latin, Latin Extended and Vietnamese names render (checked 2026-11-06). Characters outside the font
// (for example Cyrillic, Chinese or Arabic script) show as empty boxes. pdfkit's built-in Helvetica is
// never loaded (it only covers Latin-1).

export type PdfColumn = {
  header: string;
  /** Share of the table width; the shares are normalized, so any positive numbers work. */
  weight: number;
  align?: "left" | "center" | "right";
};

export type PdfTable = {
  title: string;
  /** Small lines under the title (period, export time). */
  metaLines: readonly string[];
  columns: readonly PdfColumn[];
  rows: readonly (readonly string[])[];
  /** Footer text per page, e.g. (1, 3) => "Halaman 1 dari 3". */
  pageLabel: (page: number, pageCount: number) => string;
  /** Document properties (shown by PDF readers). */
  info: { title: string; author: string };
  /** Page orientation; default portrait. Wide tables (many columns) use landscape. */
  layout?: "portrait" | "landscape";
};

const FONT_REGULAR = "NexusRegular";
const FONT_BOLD = "NexusBold";

let fontCache: Promise<{ regular: Buffer; bold: Buffer }> | null = null;

/** Reads both font files once per server instance. A failed read is retried on the next export. */
function loadFonts(): Promise<{ regular: Buffer; bold: Buffer }> {
  if (!fontCache) {
    // Keep `new URL("<literal>", import.meta.url)` INSIDE readFile(): the bundler then copies exactly
    // these two files next to the server code and deploys them (moving the URL into a variable makes
    // it trace the whole project instead).
    fontCache = Promise.all([
      readFile(new URL("./fonts/PlusJakartaSans-Regular.ttf", import.meta.url)),
      readFile(new URL("./fonts/PlusJakartaSans-Bold.ttf", import.meta.url)),
    ]).then(([regular, bold]) => ({ regular, bold }));
    fontCache.catch(() => {
      fontCache = null;
    });
  }
  return fontCache;
}

const PAGE = { margin: 40, footerGap: 18 };
const SIZE = { title: 14, meta: 9, cell: 9, footer: 8 };
const CELL_PADDING = { x: 4, y: 4 };
const COLOR = { text: "#1a1a1a", muted: "#555555", rule: "#999999", headerFill: "#eeeeee" };

/** Builds the whole PDF in memory and returns its bytes. */
export async function writePdfTable(table: PdfTable): Promise<Uint8Array> {
  const fonts = await loadFonts();
  const doc = new PDFDocument({
    size: "A4",
    layout: table.layout ?? "portrait",
    margin: PAGE.margin,
    bufferPages: true, // needed to write "Halaman x dari y" once the page count is known
    autoFirstPage: true,
    // The constructor accepts font bytes at run time; the typings only list a path string.
    font: fonts.regular as unknown as string,
    info: { Title: table.info.title, Author: table.info.author },
    lang: "id-ID",
  });
  doc.registerFont(FONT_REGULAR, fonts.regular);
  doc.registerFont(FONT_BOLD, fonts.bold);

  const done = collect(doc);
  drawDocument(doc, table);
  doc.end();
  return done;
}

function collect(doc: PDFKit.PDFDocument): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      const all = Buffer.concat(chunks);
      resolve(new Uint8Array(all.buffer, all.byteOffset, all.byteLength));
    });
    doc.on("error", reject);
  });
}

function drawDocument(doc: PDFKit.PDFDocument, table: PdfTable): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = table.columns.reduce((sum, c) => sum + c.weight, 0);
  const widths = table.columns.map((c) => (c.weight / totalWeight) * width);
  // Keep the last row clear of the footer line.
  const bottom = () => doc.page.height - doc.page.margins.bottom - PAGE.footerGap;

  // Title block (first page only).
  doc.fillColor(COLOR.text).font(FONT_BOLD).fontSize(SIZE.title).text(cleanText(table.title), left, doc.page.margins.top, { width });
  doc.font(FONT_REGULAR).fontSize(SIZE.meta).fillColor(COLOR.muted);
  for (const line of table.metaLines) doc.text(cleanText(line), left, doc.y, { width });
  let y = doc.y + 10;

  const headerCells = table.columns.map((c) => cleanText(c.header));
  y = drawRow(doc, headerCells, table.columns, widths, left, y, true);

  for (const raw of table.rows) {
    const row = raw.map(cleanText);
    const height = rowHeight(doc, row, widths, false);
    if (y + height > bottom()) {
      doc.addPage();
      y = drawRow(doc, headerCells, table.columns, widths, left, doc.page.margins.top, true);
    }
    y = drawRow(doc, row, table.columns, widths, left, y, false);
  }

  drawFooters(doc, table.pageLabel);
}

/** Control characters (tab, newline, ...) have no glyph and would print as boxes: show a space. */
function cleanText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

function rowHeight(doc: PDFKit.PDFDocument, cells: readonly string[], widths: number[], header: boolean): number {
  doc.font(header ? FONT_BOLD : FONT_REGULAR).fontSize(SIZE.cell);
  const heights = cells.map((text, i) => doc.heightOfString(text || " ", { width: widths[i] - 2 * CELL_PADDING.x }));
  return Math.max(...heights) + 2 * CELL_PADDING.y;
}

/** Draws one row at y and returns the y below it. */
function drawRow(
  doc: PDFKit.PDFDocument,
  cells: readonly string[],
  columns: readonly PdfColumn[],
  widths: number[],
  left: number,
  y: number,
  header: boolean,
): number {
  const height = rowHeight(doc, cells, widths, header);
  const width = widths.reduce((a, b) => a + b, 0);
  if (header) doc.rect(left, y, width, height).fill(COLOR.headerFill);

  doc.font(header ? FONT_BOLD : FONT_REGULAR).fontSize(SIZE.cell).fillColor(COLOR.text);
  let x = left;
  cells.forEach((text, i) => {
    doc.text(text, x + CELL_PADDING.x, y + CELL_PADDING.y, {
      width: widths[i] - 2 * CELL_PADDING.x,
      align: columns[i]?.align ?? "left",
      lineBreak: true,
    });
    x += widths[i];
  });

  doc
    .moveTo(left, y + height)
    .lineTo(left + width, y + height)
    .lineWidth(header ? 0.8 : 0.4)
    .strokeColor(COLOR.rule)
    .stroke();
  return y + height;
}

/** `footerBottom` = distance of the footer line's base from the page edge (default: the bottom margin). */
function drawFooters(doc: PDFKit.PDFDocument, pageLabel: PdfTable["pageLabel"], footerBottom?: number): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit add a page; lift the margin while writing.
    const marginBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const label = pageLabel(i - range.start + 1, range.count);
    doc
      .font(FONT_REGULAR)
      .fontSize(SIZE.footer)
      .fillColor(COLOR.muted)
      .text(label, doc.page.margins.left, doc.page.height - (footerBottom ?? marginBottom) - SIZE.footer - 4, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = marginBottom;
  }
}

// =============================================================================================
// Block document (one record per block; long texts keep their line breaks)
// =============================================================================================

export type PdfBlockSection = { label: string; text: string };

export type PdfBlock = {
  heading: string;
  /** Small muted lines under the heading (date, unit, status, ...). */
  meta: readonly string[];
  /** Labelled texts; line breaks are kept, other control characters become spaces. */
  sections: readonly PdfBlockSection[];
};

export type PdfBlockDocument = {
  title: string;
  metaLines: readonly string[];
  blocks: readonly PdfBlock[];
  /** Shown instead of blocks when there are none. */
  emptyText: string;
  pageLabel: (page: number, pageCount: number) => string;
  info: { title: string; author: string };
};

const BLOCK_SIZE = { heading: 11, meta: 8.5, label: 9, body: 9.5, gap: 14 };

/** Keeps "\n" (paragraphs of a minute); every other control character (and CR) becomes a space or goes. */
function cleanMultiline(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, " ");
}

/** Builds a block PDF in memory and returns its bytes. A4 portrait. */
export async function writePdfBlocks(spec: PdfBlockDocument): Promise<Uint8Array> {
  const fonts = await loadFonts();
  // The bottom margin leaves room for the footer, so flowing text (which adds pages by itself) never
  // runs into "Halaman x dari y".
  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margins: { top: PAGE.margin, left: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin + PAGE.footerGap },
    bufferPages: true,
    autoFirstPage: true,
    font: fonts.regular as unknown as string,
    info: { Title: spec.info.title, Author: spec.info.author },
    lang: "id-ID",
  });
  doc.registerFont(FONT_REGULAR, fonts.regular);
  doc.registerFont(FONT_BOLD, fonts.bold);

  const done = collect(doc);
  drawBlocks(doc, spec);
  drawFooters(doc, spec.pageLabel, PAGE.margin);
  doc.end();
  return done;
}

function drawBlocks(doc: PDFKit.PDFDocument, spec: PdfBlockDocument): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.fillColor(COLOR.text).font(FONT_BOLD).fontSize(SIZE.title).text(cleanText(spec.title), left, doc.page.margins.top, { width });
  doc.font(FONT_REGULAR).fontSize(SIZE.meta).fillColor(COLOR.muted);
  for (const line of spec.metaLines) doc.text(cleanText(line), left, doc.y, { width });
  doc.y += 10;

  if (spec.blocks.length === 0) {
    doc.font(FONT_REGULAR).fontSize(BLOCK_SIZE.body).fillColor(COLOR.text).text(cleanText(spec.emptyText), left, doc.y, { width });
    return;
  }

  spec.blocks.forEach((block, index) => {
    const heading = cleanText(block.heading);
    doc.font(FONT_BOLD).fontSize(BLOCK_SIZE.heading);
    // Keep a heading together with at least its meta: start a new page when it would sit at the bottom.
    const needed = doc.heightOfString(heading, { width }) + block.meta.length * (BLOCK_SIZE.meta + 4) + 24;
    if (index > 0 && doc.y + needed > bottom()) doc.addPage();
    if (index > 0) {
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.4).strokeColor(COLOR.rule).stroke();
      doc.y += 8;
    }

    doc.fillColor(COLOR.text).font(FONT_BOLD).fontSize(BLOCK_SIZE.heading).text(heading, left, doc.y, { width });
    doc.font(FONT_REGULAR).fontSize(BLOCK_SIZE.meta).fillColor(COLOR.muted);
    for (const line of block.meta) doc.text(cleanText(line), left, doc.y, { width });

    for (const section of block.sections) {
      doc.y += 5;
      if (doc.y + BLOCK_SIZE.label * 3 > bottom()) doc.addPage();
      doc.fillColor(COLOR.text).font(FONT_BOLD).fontSize(BLOCK_SIZE.label).text(cleanText(section.label), left, doc.y, { width });
      doc.font(FONT_REGULAR).fontSize(BLOCK_SIZE.body).text(cleanMultiline(section.text) || " ", left, doc.y, { width });
    }
    doc.y += BLOCK_SIZE.gap;
  });
}
