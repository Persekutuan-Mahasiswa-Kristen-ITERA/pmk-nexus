// CSV writer (D-020: hand-written, no library). RFC 4180 quoting, CRLF line ends, UTF-8 with a BOM so
// Excel shows accented names correctly. Pure: no I/O, safe to unit-test.

export type CsvValue = string | number | null;

const BOM = "﻿";

/**
 * Characters that make a spreadsheet read a cell as a formula (OWASP "CSV injection"): = + - @, and a
 * leading tab or carriage return. Member names come from PI-CORE, so a crafted name could otherwise
 * run a formula on the exporter's computer.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Prefixes a dangerous cell with an apostrophe so spreadsheets show it as text. A lone "-" is left as
 * is: it cannot form a formula and is the "no value" placeholder of our exports.
 */
export function neutralizeFormula(value: string): string {
  if (value === "-") return value;
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One field: numbers as is; text neutralized, then quoted when it holds a comma, quote, CR or LF. */
export function csvField(value: CsvValue): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Whole file as text, starting with the BOM. `header` is written first (our own labels, also neutralized). */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** UTF-8 bytes of toCsv(), for a Response body. */
export function toCsvBytes(header: readonly string[], rows: readonly (readonly CsvValue[])[]): Uint8Array {
  return new TextEncoder().encode(toCsv(header, rows));
}

/**
 * Like toCsv(), but `preamble` rows come BEFORE the header (a summary block, e.g. Finance spec F7.2). Same
 * quoting and formula neutralisation for every cell; numbers stay numbers (a negative total is not a formula).
 */
export function toCsvWithPreamble(
  preamble: readonly (readonly CsvValue[])[],
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): Uint8Array {
  const lines = [...preamble, header, ...rows].map((row) => row.map(csvField).join(","));
  return new TextEncoder().encode(`${BOM}${lines.join("\r\n")}\r\n`);
}
