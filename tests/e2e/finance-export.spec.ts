// Finance export (spec F7, section 8; FN-28..FN-32, A-FN14): Excel, CSV and PDF hold exactly the rows the filtered screen lists, in
// screen order, voided entries marked with their reason; the summary block is the WHOLE period (never the filter); one append-only
// log row per successful export; no file without the key or without the log row; cells that start with = + - @ are never formulas;
// money is a plain integer in CSV and Excel; no proof contents, no links, no search text in the log.
// Pattern of surat-export.spec.ts. Entries are made through the app's own database functions; the ledger is append-only, so
// everything carries "QA<tag>" and `sweepQa` voids what is still Aktif at the end.
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signedInContext } from "./helpers";
import { hasPdftotext, parseCsv, pdfText } from "./member-data-helpers";
import { unzip } from "../support/zip";
import {
  activePeriodId,
  addDays,
  awayFromMidnight,
  emailOf,
  entryRow,
  EXPORT,
  exportLogCount,
  fakeProof,
  jakartaToday,
  main,
  memberId,
  mustRecord,
  nameOf,
  ORIGIN,
  q,
  qjson,
  rpcAs,
  rupiah,
  sweepQa,
  tag,
  totals,
  voidAs,
  xlsxTable,
} from "./finance-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
  q("alter table nexus.finance_export_logs drop constraint if exists qa_block_fn_log_write");
});

const HEADER = ["No", "Nomor", "Tanggal", "Jenis", "Keterangan", "Catatan", "Jumlah (Rp)", "Status", "Alasan pembatalan", "Koreksi atas", "Dicatat oleh", "Waktu dicatat", "Bukti", "Periode"];
const COL = { no: 0, number: 1, date: 2, type: 3, description: 4, notes: 5, amount: 6, status: 7, voidReason: 8, corrects: 9, by: 10, at: 11, proof: 12, period: 13 } as const;

type Fmt = "csv" | "xlsx" | "pdf";
const LABEL: Record<Fmt, "Excel (.xlsx)" | "CSV (.csv)" | "PDF (.pdf)"> = { xlsx: "Excel (.xlsx)", csv: "CSV (.csv)", pdf: "PDF (.pdf)" };
const exportLogMaxId = () => Number(q("select coalesce(max(id), 0) from nexus.finance_export_logs"));
const exportLogsAfter = (id: number) => qjson<Record<string, any>>(`select * from nexus.finance_export_logs where id > ${id} order by id`); // eslint-disable-line @typescript-eslint/no-explicit-any

async function download(page: Page, fmt: Fmt) {
  const event = page.waitForEvent("download");
  await page.locator("summary:visible", { hasText: "Ekspor" }).click();
  await page.getByRole("button", { name: LABEL[fmt] }).click();
  const d = await event;
  const path = await d.path();
  if (!path) throw new Error("download has no path");
  return { path, fileName: d.suggestedFilename() };
}

/** Header, rows and the lines above the header (the summary block) of a CSV or Excel file. */
function table(source: string | Buffer, fmt: "csv" | "xlsx"): { header: string[]; rows: string[][]; above: string[][] } {
  if (fmt === "xlsx") {
    const t = xlsxTable(source as string);
    const at = t.all.findIndex((r) => r[0] === "No");
    return { header: t.header, rows: t.rows, above: t.all.slice(0, at) };
  }
  const bytes = typeof source === "string" ? readFileSync(source) : source;
  expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf"); // UTF-8 BOM so Excel reads it right
  const records = parseCsv(bytes.toString("utf8").replace(/^﻿/, ""));
  const at = records.findIndex((r) => r[0] === "No");
  return { header: records[at] ?? [], rows: records.slice(at + 1).filter((r) => r.some((x) => x !== "")), above: records.slice(0, at).filter((r) => r.some((x) => x !== "")) };
}

/** The summary block as label -> value. CSV: two cells per row. Excel and PDF: one "Label: value" line. */
function summaryOf(above: string[][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of above) {
    if (r.length > 1 && r[1] !== "") out[r[0]] = r[1];
    else {
      const m = /^([^:]+): ([\s\S]*)$/.exec(r[0] ?? "");
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

/** The numbers listed on the screen, top to bottom (one card per entry; the number follows the date on the first line). */
async function screenNumbers(page: Page): Promise<string[]> {
  const cards = main(page).locator("article");
  await expect(cards.first()).toBeVisible();
  return (await cards.allInnerTexts()).map((t) => /KAS-\d{4,}/.exec(t)![0]);
}

const listTotal = async (who: "ketum" | "bendahara", rpc: Record<string, unknown>) => {
  const list = await rpcAs(who, "finance_entry_list", { ...rpc, p_page_size: 50 });
  expect(list.ok, JSON.stringify(list.body).slice(0, 200)).toBe(true);
  return Array.isArray(list.body) && list.body.length > 0 ? Number(list.body[0].total_count) : 0;
};

let made: { formula: string; formulaNotes: string; signs: string; plain: string; voided: string; proof: string; formulaId: string } | null = null;
async function setup() {
  if (made) return made;
  await awayFromMidnight();
  const formula = await mustRecord("bendahara", { description: `=HYPERLINK("http://evil.example","${TAG}")`, notes: "@SUM(A1:A9)", amount: "70000" });
  const signs = await mustRecord("bendahara", { description: `+1+1 ${TAG} plus`, notes: "-2+3", amount: "5000" });
  const plain = await mustRecord("bendahara", { type: "income", description: `${TAG} Iuran, dengan "tanda kutip" dan koma`, amount: "150000" });
  const voided = await mustRecord("bendahara", { description: `${TAG} Salah catat`, amount: "88000" });
  expect((await voidAs("bendahara", voided.id, "Jumlahnya salah, lihat nomor sesudahnya")).ok).toBe(true);
  const proof = await mustRecord("bendahara", { description: `${TAG} Ada bukti`, amount: "25000", files: [fakeProof("bendahara", "nota.pdf")] });
  made = { formula: formula.numberText, formulaNotes: "@SUM(A1:A9)", signs: signs.numberText, plain: plain.numberText, voided: voided.numberText, proof: proof.numberText, formulaId: formula.id };
  return made;
}

for (const fmt of ["xlsx", "csv", "pdf"] as const) {
  test.describe(`FN-28..FN-31: ${fmt} export by BPH (view and export, no manage) equals the filtered screen`, () => {
    test(`ketum exports ${fmt}: same rows in the same order as the screen, voided marked, summary of the whole period, one log row, no formulas`, async ({ browser }) => {
      test.setTimeout(180_000);
      const ids = await setup();
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        await page.goto(`/finance?q=${encodeURIComponent(TAG)}&voided=1`);
        const shown = await screenNumbers(page);
        expect(shown.length).toBeGreaterThanOrEqual(5);
        const total = Number(/^Hasil: (\d+) transaksi$/.exec(await main(page).getByText(/^Hasil: \d+ transaksi$/).innerText())![1]);
        expect(total).toBe(shown.length);

        const before = exportLogMaxId();
        const file = await download(page, fmt);
        expect(file.fileName).toBe(`finance-2026-2027-${jakartaToday()}.${fmt}`);
        const whole = totals();

        if (fmt === "pdf") {
          expect(readFileSync(file.path).subarray(0, 5).toString()).toBe("%PDF-");
          if (hasPdftotext) {
            const text = pdfText(file.path);
            expect(text).toContain("Finance PMK ITERA");
            expect(text).toContain("Periode: 2026/2027");
            expect(text).toMatch(/Diekspor: \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
            // The number column is narrow: "KAS-0144" wraps to "KAS-01" and "44" on the next line. Join the two before comparing.
            const lines = text.split("\n");
            const inPdf: string[] = [];
            lines.forEach((line, i) => {
              const head = /^\s*\d+\s+(KAS-\d+)\s/.exec(line)?.[1];
              if (!head) return;
              const tail = /^\s+(\d{1,4})\s/.exec(lines[i + 1] ?? "")?.[1] ?? "";
              inPdf.push(head + tail);
            });
            expect(inPdf, "the numbers in the PDF, in the order of the screen").toEqual(shown);
            const flat = text.replace(/\s+/g, "");
            expect(flat).toContain(`TotalPemasukan:${rupiah(whole.income)}`.replace(/\s+/g, ""));
            expect(flat).toContain(`TotalPengeluaran:${rupiah(whole.expense)}`.replace(/\s+/g, ""));
            expect(text).toContain("Dibatal"); // the status cell wraps ("Dibatal" + "kan") in its narrow column
            expect(text).toContain("Rp 25.000"); // the PDF shows money as Rp
          }
        } else {
          const t = table(file.path, fmt);
          expect(t.header).toEqual(HEADER);
          // rows = the screen: same numbers, same order, numbered 1..n
          expect(t.rows.map((r) => r[COL.number])).toEqual(shown);
          expect(t.rows.map((r) => r[COL.no])).toEqual(t.rows.map((_, i) => String(i + 1)));
          expect(t.rows).toHaveLength(total);
          const byNumber = (n: string) => t.rows.find((r) => r[COL.number] === n)!;

          const v = byNumber(ids.voided);
          expect(v[COL.status]).toBe("Dibatalkan");
          expect(v[COL.voidReason]).toBe("Jumlahnya salah, lihat nomor sesudahnya");
          expect(v[COL.amount], "a voided amount stays what it was").toBe("88000");
          const p = byNumber(ids.plain);
          expect(p[COL.status]).toBe("Aktif");
          expect(p[COL.type]).toBe("Pemasukan");
          expect(p[COL.amount], "money is a plain integer, never text with Rp or dots").toBe("150000");
          expect(p[COL.description]).toBe(`${TAG} Iuran, dengan "tanda kutip" dan koma`); // commas and quotes survive
          expect(p[COL.notes]).toBe("-");
          expect(p[COL.corrects]).toBe("-");
          expect(p[COL.by]).toBe(nameOf("bendahara")); // the recorder's NAME, never an email
          expect(p[COL.period]).toBe("2026/2027");
          expect(p[COL.proof]).toBe("Tidak ada");
          const dbTime = q(`select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') from nexus.finance_entries where number_text = '${ids.plain}'`);
          expect(p[COL.at]).toContain(dbTime); // timestamps in WIB
          expect(p[COL.at]).toContain("WIB");
          expect(p[COL.date]).toBe(jakartaToday());
          const withProof = byNumber(ids.proof);
          expect(withProof[COL.proof]).toBe("Ada");
          expect(withProof[COL.type]).toBe("Pengeluaran");
          expect(withProof[COL.amount]).toBe("25000");

          // Formula injection: a cell that starts with = + - @ is text, never a formula.
          const f = byNumber(ids.formula);
          const s = byNumber(ids.signs);
          if (fmt === "csv") {
            expect(f[COL.description]).toBe(`'=HYPERLINK("http://evil.example","${TAG}")`);
            expect(f[COL.notes]).toBe("'@SUM(A1:A9)");
            expect(s[COL.description]).toBe(`'+1+1 ${TAG} plus`);
            expect(s[COL.notes]).toBe("'-2+3");
          } else {
            expect(f[COL.description]).toContain("HYPERLINK"); // the text is there ...
            const sheet = unzip(readFileSync(file.path))["xl/worksheets/sheet1.xml"].toString("utf8");
            expect(sheet, "an xlsx cell must never carry a formula element").not.toMatch(/<f[ >]/);
            expect(sheet).not.toMatch(/t="str"/); // t="str" is a formula result cell
          }

          // The summary block is the WHOLE period (opening + income - expense of Aktif entries), the export time and the filters.
          const sum = summaryOf(t.above);
          if (fmt === "csv") {
            expect(sum["Periode"]).toBe("2026/2027");
            expect(sum["Saldo awal"]).toBe(String(whole.opening));
            expect(sum["Total Pemasukan"]).toBe(String(whole.income));
            expect(sum["Total Pengeluaran"]).toBe(String(whole.expense));
            expect(sum["Total Saldo"]).toBe(String(whole.balance));
          } else {
            expect(sum["Periode"]).toBe("2026/2027");
            expect(sum["Saldo awal"]).toBe(rupiah(whole.opening));
            expect(sum["Total Pemasukan"]).toBe(rupiah(whole.income));
            expect(sum["Total Pengeluaran"]).toBe(rupiah(whole.expense));
            expect(sum["Total Saldo"]).toBe(rupiah(whole.balance));
          }
          expect(sum["Diekspor"]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB$/);
          expect(sum["Filter"]).toContain("Tampilkan yang dibatalkan: Ya");
          expect(sum["Filter"]).toContain(`Pencarian: ${TAG}`);

          // No personal data, no storage paths, no links anywhere in the file.
          const all = JSON.stringify(t);
          expect(all).not.toMatch(/@nexus\.test|signed|token=|storage\/v1|nexus-finance-proofs|\.pdf|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        }

        // Exactly one log row: who, what, how many, which period; no search text, no amounts.
        const logs = exportLogsAfter(before);
        expect(logs).toHaveLength(1);
        const log = logs[0];
        expect(log.exporter_member_id).toBe(memberId(emailOf("ketum")));
        expect(log.format).toBe(fmt);
        expect(Number(log.row_count)).toBe(total);
        expect(log.exported_period_id).toBe(activePeriodId());
        expect(log.period_id).toBe(activePeriodId());
        expect(JSON.stringify(log)).not.toContain(TAG); // the search text is not stored
        expect(log.filters.search_used).toBe(true); // only THAT a search was used, never its text
        expect(log.filters.include_voided).toBe(true);
        expect(Object.keys(log.filters).sort()).toEqual(["from", "include_voided", "search_used", "to", "type", "without_proof"]);
        expect(JSON.stringify(log)).not.toMatch(/70000|150000|88000|amount/i);
      } finally {
        await context.close();
      }
    });
  });
}

test.describe("FN-29, FN-31: filters, the whole-period summary, empty results, an older period", () => {
  test("the Treasurer exports through the route with other filters: the row count equals the list function's total for the same filters; the summary never follows the filter", async ({ browser }) => {
    test.setTimeout(180_000);
    await setup();
    const { context } = await signedInContext(browser, "bendahara");
    try {
      const today = jakartaToday();
      const oldPeriod = q("select id from public.periods where label = '2025/2026'");
      const combos: { name: string; filters: Record<string, unknown>; rpc: Record<string, unknown>; period?: string }[] = [
        { name: "search + voided", filters: { search: TAG, includeVoided: true }, rpc: { p_search: TAG, p_include_voided: true } },
        { name: "search only (voided hidden)", filters: { search: TAG }, rpc: { p_search: TAG } },
        { name: "expenses incl. voided", filters: { search: TAG, type: "expense", includeVoided: true }, rpc: { p_search: TAG, p_type: "expense", p_include_voided: true } },
        { name: "income", filters: { search: TAG, type: "income" }, rpc: { p_search: TAG, p_type: "income" } },
        { name: "without proof incl. voided", filters: { search: TAG, withoutProof: true, includeVoided: true }, rpc: { p_search: TAG, p_without_proof: true, p_include_voided: true } },
        { name: "date range today", filters: { search: TAG, from: today, to: today }, rpc: { p_search: TAG, p_from: today, p_to: today } },
        { name: "date range in the future (no rows)", filters: { search: TAG, from: addDays(today, 5) }, rpc: { p_search: TAG, p_from: addDays(today, 5) } },
        { name: "an older period", filters: { periodId: oldPeriod }, rpc: { p_period_id: oldPeriod }, period: oldPeriod },
        { name: "no match", filters: { search: `tidak-ada-sama-sekali-${TAG}` }, rpc: { p_search: `tidak-ada-sama-sekali-${TAG}` } },
      ];
      for (const c of combos) {
        const before = exportLogMaxId();
        const res = await context.request.post(EXPORT, { data: { format: "csv", filters: c.filters }, headers: { origin: ORIGIN } });
        expect(res.status(), c.name).toBe(200);
        const t = table(Buffer.from(await res.body()), "csv");
        expect(t.header, c.name).toEqual(HEADER);
        const want = await listTotal("bendahara", c.rpc);
        expect(t.rows.length, c.name).toBe(want);
        // The summary stands for the WHOLE period of the export, whatever the filter said (F7.2).
        const whole = totals(c.period ?? activePeriodId());
        const sum = summaryOf(t.above);
        expect(sum["Total Pemasukan"], c.name).toBe(String(whole.income));
        expect(sum["Total Pengeluaran"], c.name).toBe(String(whole.expense));
        expect(sum["Total Saldo"], c.name).toBe(String(whole.balance));
        expect(sum["Periode"], c.name).toBe(c.period ? "2025/2026" : "2026/2027");
        // One log row each, an empty file included (row_count 0); the log names the exported period.
        const logs = exportLogsAfter(before);
        expect(logs, c.name).toHaveLength(1);
        expect(Number(logs[0].row_count), c.name).toBe(want);
        expect(logs[0].exported_period_id, c.name).toBe(c.period ?? activePeriodId());
        expect(logs[0].period_id, c.name).toBe(activePeriodId());
        if (c.period) expect(res.headers()["content-disposition"]).toContain(`finance-2025-2026-${jakartaToday()}.csv`);
      }
    } finally {
      await context.close();
    }
  });

  test("the screen offers no 'Ekspor' when the filtered list is empty; BPH without the Treasurer key still sees it on a non-empty list", async ({ browser }) => {
    await setup();
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(`/finance?q=${encodeURIComponent(`tidak-ada-sama-sekali-${TAG}`)}`);
      await expect(main(page).getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await expect(page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(0);
      await page.goto(`/finance?q=${encodeURIComponent(TAG)}`);
      await expect(page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("the Treasurer's detail page exports the period of that entry (the 'Ekspor' on a detail)", async ({ browser }) => {
    test.setTimeout(120_000);
    const ids = await setup();
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      await page.goto(`/finance/${ids.formulaId}`);
      await expect(page.getByRole("heading", { level: 1, name: "Detail Transaksi" })).toBeVisible();
      const before = exportLogMaxId();
      const file = await download(page, "csv");
      expect(file.fileName).toBe(`finance-2026-2027-${jakartaToday()}.csv`);
      const t = table(file.path, "csv");
      expect(t.header).toEqual(HEADER);
      expect(t.rows.map((r) => r[COL.number])).toContain(ids.formula);
      expect(exportLogsAfter(before)).toHaveLength(1);
      expect(entryRow(ids.formulaId).status).toBe("active"); // an export changes nothing
    } finally {
      await context.close();
    }
  });
});

test.describe("FN-28, FN-31: response headers and body shapes", () => {
  test("type, attachment, no-store, length; the body really is that type; the form fallback works", async ({ browser }) => {
    await setup();
    const { context } = await signedInContext(browser, "ketum");
    try {
      const expected: Record<Fmt, [RegExp, (b: Buffer) => boolean]> = {
        csv: [/^text\/csv; charset=utf-8$/, (b) => b.subarray(0, 3).toString("hex") === "efbbbf"],
        xlsx: [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/, (b) => b.subarray(0, 2).toString() === "PK"],
        pdf: [/^application\/pdf$/, (b) => b.subarray(0, 5).toString() === "%PDF-"],
      };
      for (const fmt of ["csv", "xlsx", "pdf"] as const) {
        const res = await context.request.post(EXPORT, { data: { format: fmt, filters: { search: TAG } }, headers: { origin: ORIGIN } });
        expect(res.status(), fmt).toBe(200);
        const h = res.headers();
        expect(h["content-type"], fmt).toMatch(expected[fmt][0]);
        expect(h["content-disposition"], fmt).toMatch(new RegExp(`^attachment; filename="?finance-2026-2027-\\d{4}-\\d{2}-\\d{2}\\.${fmt}"?`));
        expect(h["cache-control"], fmt).toContain("no-store");
        const body = await res.body();
        expect(Number(h["content-length"]), fmt).toBe(body.length);
        expect(expected[fmt][1](body), fmt).toBe(true);
      }
      // The form fallback (no JavaScript: urlencoded and multipart, browser-style mixed-case boundary).
      const form = await context.request.post(EXPORT, { form: { format: "csv", search: TAG, type: "expense", includeVoided: "1" }, headers: { origin: ORIGIN } });
      expect(form.status()).toBe(200);
      const formRows = table(Buffer.from(await form.body()), "csv").rows;
      expect(formRows.length).toBe(await listTotal("ketum", { p_search: TAG, p_type: "expense", p_include_voided: true }));
      const multi = await context.request.post(EXPORT, { multipart: { format: "csv", type: "income", search: TAG }, headers: { origin: ORIGIN } });
      expect(multi.status()).toBe(200);
      const badFlag = await context.request.post(EXPORT, { form: { format: "csv", includeVoided: "yes" }, headers: { origin: ORIGIN } });
      expect(badFlag.status(), "a flag other than 1 or true is refused, never guessed").toBe(400);
    } finally {
      await context.close();
    }
  });
});

test.describe("FN-30, FN-32: refusals write no log row and return no file", () => {
  async function post(context: BrowserContext, data: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
    return context.request.post(EXPORT, { data: data as never, headers });
  }

  test("bad bodies are 400 with a code only: unknown format, bad type, period, date, range, flag, search too long, broken JSON, wrong content type", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      const before = exportLogCount();
      for (const [label, body] of [
        ["unknown format", { format: "docx", filters: {} }],
        ["no format", { filters: {} }],
        ["wrong type", { format: "csv", filters: { type: "diary" } }],
        ["period that is not an id", { format: "csv", filters: { periodId: "2025/2026" } }],
        ["a period that does not exist", { format: "csv", filters: { periodId: "00000000-0000-4000-8000-000000000000" } }],
        ["date that is not a date", { format: "csv", filters: { from: "kemarin" } }],
        ["end before start", { format: "csv", filters: { from: "2026-11-10", to: "2026-11-01" } }],
        ["flag as text", { format: "csv", filters: { includeVoided: "yes" } }],
        ["search 121 characters", { format: "csv", filters: { search: "s".repeat(121) } }],
        ["a body that is not an object", ["csv"]],
      ] as [string, unknown][]) {
        const res = await post(context, body);
        expect(res.status(), label).toBe(400);
        const json = (await res.json()) as { error: { code: string } };
        expect(typeof json.error.code, label).toBe("string");
        expect(JSON.stringify(json), label).not.toMatch(/stack|select |nexus\.|amount/i);
      }
      const broken = await context.request.post(EXPORT, { data: "{not json", headers: { origin: ORIGIN, "content-type": "application/json" } });
      expect(broken.status()).toBe(400);
      const huge = await context.request.post(EXPORT, { data: JSON.stringify({ format: "csv", filters: { search: "x".repeat(20_000) } }), headers: { origin: ORIGIN, "content-type": "application/json" } });
      expect(huge.status()).toBe(400);
      const wrongType = await context.request.post(EXPORT, { data: "format=csv", headers: { origin: ORIGIN, "content-type": "text/plain" } });
      expect(wrongType.status()).toBe(400);
      expect(exportLogCount(), "refused exports write no log row").toBe(before);
    } finally {
      await context.close();
    }
  });

  test("if the log row cannot be written, NO file is returned (the log comes first) and the screen says so; nothing is half-logged", async ({ browser }) => {
    test.setTimeout(180_000);
    await setup();
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(`/finance?q=${encodeURIComponent(TAG)}`);
      await expect(main(page).locator("article").first()).toBeVisible();
      const before = exportLogCount();
      q("alter table nexus.finance_export_logs add constraint qa_block_fn_log_write check (false) not valid");
      try {
        const res = await post(context, { format: "csv", filters: { search: TAG } });
        expect(res.status()).toBe(503);
        expect(res.headers()["content-type"]).toContain("application/json");
        expect(JSON.stringify(await res.json())).toBe('{"error":{"code":"unavailable"}}');
        // On the screen: the normal outage text, no download, the page stays usable.
        let downloaded = false;
        page.on("download", () => (downloaded = true));
        await page.locator("summary:visible", { hasText: "Ekspor" }).click();
        await page.getByRole("button", { name: "CSV (.csv)" }).click();
        await expect(page.getByText("Terjadi gangguan. Coba lagi.").first()).toBeVisible();
        expect(downloaded).toBe(false);
        expect(exportLogCount()).toBe(before);
      } finally {
        q("alter table nexus.finance_export_logs drop constraint if exists qa_block_fn_log_write");
      }
      // Restored: the same call works and writes exactly one row.
      const ok = await post(context, { format: "csv", filters: { search: TAG } });
      expect(ok.status()).toBe(200);
      expect(exportLogCount()).toBe(before + 1);
    } finally {
      await context.close();
    }
  });

  test("direct database calls: a member without the key writes nothing; a holder is logged exactly once per call; a bad format writes nothing", async () => {
    await setup();
    const before = exportLogCount();
    const regularBefore = Number(q(`select count(*) from nexus.finance_export_logs where exporter_member_id = '${memberId(emailOf("regular"))}'`));
    for (const who of ["regular", "pembina", "admin", "sekdep", "kadep", "inactive", "unlinked", "anon"] as const) {
      const denied = await rpcAs(who, "finance_export", { p_format: "csv" });
      expect(denied.ok, who).toBe(false);
    }
    expect(exportLogCount()).toBe(before);
    const bad = await rpcAs("ketum", "finance_export", { p_format: "docx" });
    expect(bad.ok).toBe(false);
    expect(exportLogCount()).toBe(before);
    for (const [i, who] of (["ketum", "bendahara", "sekjen"] as const).entries()) {
      const ok = await rpcAs(who, "finance_export", { p_format: "csv", p_search: TAG });
      expect(ok.ok, `${who}: ${JSON.stringify(ok.body).slice(0, 200)}`).toBe(true);
      expect(exportLogCount()).toBe(before + i + 1);
    }
    // Refusals are counted per member too: `regular` may hold log rows of an earlier period spec (a temporary Treasurer of
    // 2025/2026), so the check is "the denied calls added none", not "there are none".
    expect(Number(q(`select count(*) from nexus.finance_export_logs where exporter_member_id = '${memberId(emailOf("regular"))}'`))).toBe(regularBefore);
  });
});
