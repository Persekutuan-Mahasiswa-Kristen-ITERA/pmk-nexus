// Helpers for the Data Anggota E2E specs. Local NEXUS stack only (sql() refuses anything else through assertLocalStack).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type APIResponse, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { sql } from "../support/local-stack";
import { sharedStrings, unzip } from "../support/zip";

export const LIST_PATH = "/data-anggota";
export const EXPORT_PATH = "/api/member-data/export";
export const ORIGIN = "http://localhost:3100";

// ---------------------------------------------------------------------------------------------
// Export log. Counted straight from the table with psql (read-only SELECT as the database owner).
// Why psql and not the member_data_export_log_list() function: it needs no sign-in (the Auth budget is
// 30 per 5 minutes), it sees every row (the function could hide a stray second row for some caller), and a
// plain count cannot be affected by a bug in the function under test. The function itself is exercised
// once, as admin and as BPH, in the log-reading test of data-anggota.spec.ts.
// ---------------------------------------------------------------------------------------------
export const logCount = () => Number(sql("select count(*) from nexus.member_data_export_logs"));
export const lastLogId = () => Number(sql("select coalesce(max(id), 0) from nexus.member_data_export_logs"));
export type LogRow = {
  id: number;
  exporter_member_id: string;
  created_at: string;
  format: string;
  filter_unit_id: string | null;
  filter_status: string;
  search_used: boolean;
  period_id: string;
};
export function logRowsAfter(id: number): LogRow[] {
  const out = sql(`select coalesce(json_agg(l order by l.id), '[]'::json) from nexus.member_data_export_logs l where l.id > ${id}`);
  return JSON.parse(out) as LogRow[];
}
export const memberId = (email: string) => sql(`select id from public.members where email = '${email}'`);
export const activePeriodId = () => sql("select id from public.periods where is_active");

// ---------------------------------------------------------------------------------------------
// Oracles: what the list SHOULD hold, straight from the PI-CORE tables (read-only SELECT)
// ---------------------------------------------------------------------------------------------
export const countMembers = (where: string) => Number(sql(`select count(*) from public.members where ${where}`));
export const unitOptionNames = () =>
  sql("select name from public.org_units where type in ('bph','department','bureau') and is_active order by sort_order").split("\n").filter(Boolean);
export const unitId = (name: string) => sql(`select id from public.org_units where name = '${name}'`);
/** Every identifier value in the local data that must never reach a page or a file. */
export function secretValues(): string[] {
  const rows = sql("select coalesce(email,''), coalesce(nim,''), coalesce(phone,''), coalesce(nip,'') from public.members").split("\n");
  const values = new Set<string>();
  for (const row of rows) for (const v of row.split("|")) if (v.length >= 6) values.add(v);
  return [...values];
}

// ---------------------------------------------------------------------------------------------
// Period flips (restore in finally; global-teardown also restores 2026/2027)
// ---------------------------------------------------------------------------------------------
export function addPreviousPeriodOfficer(email: string): string {
  const out = sql(
    `insert into public.assignments(member_id, org_unit_id, position_id, period_id)
     select (select id from public.members where email='${email}'),
            (select id from public.org_units where name='Departemen Operasional'),
            (select id from public.positions where name='Kepala Departemen'),
            (select id from public.periods where label='2025/2026')
     returning id`,
  );
  return out.split("\n")[0];
}
export function removeAssignment(id: string) {
  sql(`delete from public.assignments where id = '${id}'`);
}

// ---------------------------------------------------------------------------------------------
// Page helpers (the list)
// ---------------------------------------------------------------------------------------------
export const tableRows = (page: Page) => page.getByRole("main").locator("table tbody tr");
// getByRole("main"), not locator("main"): while the page streams in, the loading shell and the page are both in the DOM.
export const main = (page: Page) => page.getByRole("main");
export const counterText = (page: Page) => main(page).getByText(/^Menampilkan /);
export const resultBox = (page: Page) => main(page).locator("p", { hasText: /^Hasil/ });
export const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Cari nama anggota" });
export const unitSelect = (page: Page) => page.getByLabel("Unit", { exact: true });
export const statusSelect = (page: Page) => page.getByLabel("Status", { exact: true });
export const exportButton = (page: Page) => page.locator("summary", { hasText: "Ekspor" });

/** Names in the rows on screen, in order. */
export async function namesOnPage(page: Page): Promise<string[]> {
  const cells = tableRows(page).locator("td:nth-child(2) > p");
  return (await cells.allInnerTexts()).map((t) => t.trim());
}
/** Row numbers ("No") on screen. */
export async function numbersOnPage(page: Page): Promise<number[]> {
  return (await tableRows(page).locator("td:nth-child(1)").allInnerTexts()).map((t) => Number(t.trim()));
}
/** Waits until the list shows `total` results (the "Hasil" box and the counter agree). */
export async function expectTotal(page: Page, total: number) {
  if (total === 0) {
    await expect(main(page).getByText("Tidak ada anggota yang cocok. Ubah pencarian atau filter.")).toBeVisible();
  } else {
    await expect(main(page).getByText(new RegExp(`dari ${total.toLocaleString("id-ID")} anggota$`))).toBeVisible();
  }
  await expect(resultBox(page)).toContainText(total.toLocaleString("id-ID"));
}
export const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Opens the page as the current context and waits for the table (or any list state). */
export async function openList(page: Page, query = "") {
  const res = await page.goto(`${LIST_PATH}${query}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

// ---------------------------------------------------------------------------------------------
// Raw requests with the browser session's cookies
// ---------------------------------------------------------------------------------------------
export const postExport = (context: BrowserContext, form: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }): Promise<APIResponse> =>
  context.request.post(EXPORT_PATH, { form, headers, maxRedirects: 0 });

export async function errorCodeOf(res: APIResponse): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Downloaded files
// ---------------------------------------------------------------------------------------------
export function readCsv(path: string): { bom: boolean; header: string[]; rows: string[][]; raw: string } {
  const bytes = readFileSync(path);
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const raw = bytes.toString("utf8").replace(/^﻿/, "");
  const records = parseCsv(raw);
  return { bom, header: records[0] ?? [], rows: records.slice(1), raw };
}
/** Small RFC 4180 parser (quotes, doubled quotes, CRLF) so the test does not trust the writer's own logic. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Data rows of the first sheet: rows whose first cell is a number. Returns the names (2nd cell) in order. */
export function xlsxNames(path: string): { names: string[]; strings: string[]; xml: string } {
  const files = unzip(readFileSync(path));
  const strings = sharedStrings(files);
  const xml = files["xl/worksheets/sheet1.xml"].toString("utf8");
  const names: string[] = [];
  for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [...row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
    if (cells.length < 2) continue;
    const isNumber = (attrs: string) => !/\bt="/.test(attrs) || /\bt="n"/.test(attrs);
    if (!isNumber(cells[0][1])) continue;
    const second = cells[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(second[2] ?? "")?.[1];
    if (v !== undefined && /\bt="s"/.test(second[1])) names.push(strings[Number(v)]);
  }
  return { names, strings, xml };
}

export const hasPdftotext = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
/** `layout` keeps rows on one line (good for counting rows); without it each cell is read in turn (good for one long cell). */
export function pdfText(path: string, layout = true): string {
  return execFileSync("pdftotext", [...(layout ? ["-layout"] : []), path, "-"], { encoding: "utf8" });
}

/** "YYYY-MM-DD" in Asia/Jakarta for `date` (the file name date). */
export function jakartaDay(date: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return p;
}

/** Downloads one export through the real menu and returns the saved path and the suggested file name. */
export async function downloadExport(page: Page, label: "Excel (.xlsx)" | "CSV (.csv)" | "PDF (.pdf)") {
  const download = page.waitForEvent("download");
  await exportButton(page).click();
  await page.getByRole("button", { name: label }).click();
  const d = await download;
  const path = await d.path();
  if (!path) throw new Error("download has no path");
  return { path, fileName: d.suggestedFilename(), download: d };
}

export async function tapAll(locator: Locator): Promise<void> {
  for (const el of await locator.all()) await el.scrollIntoViewIfNeeded();
}
