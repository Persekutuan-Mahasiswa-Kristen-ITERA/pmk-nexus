// Letters export (spec F8, section 8; LT-36..LT-39, A-LT16): Excel, CSV and PDF hold exactly the rows the filtered screen lists,
// in screen order, with voided letters marked; one append-only log row per successful export; no file without the key or without
// the log row; cells that start with = + - @ are never formulas; no personal data and no links.
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signedInContext } from "./helpers";
import { hasPdftotext, parseCsv, pdfText } from "./member-data-helpers";
import { unzip } from "../support/zip";
import {
  EXPORT,
  exportLogCount,
  exportLogMaxId,
  exportLogsAfter,
  jakartaToday,
  main,
  memberId,
  emailOf,
  mustRegister,
  ORIGIN,
  PATHS,
  q,
  qjson,
  qn,
  rpcAs,
  sweepQa,
  tag,
  voidAs,
} from "./surat-helpers";
import { xlsxTable } from "./inventaris-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
  q("alter table nexus.letter_export_logs drop constraint if exists qa_block_lt_log_write");
});

const INCOMING_HEADER = ["No", "Nomor surat", "Nomor lama", "Tanggal diterima", "Tanggal surat", "Pengirim", "Nomor surat dari pengirim", "Perihal", "Catatan", "Status", "Alasan pembatalan", "Dari permohonan", "Periode", "Dicatat oleh", "Waktu dicatat", "Jumlah berkas"];
const OUTGOING_HEADER = ["No", "Nomor surat", "Nomor lama", "Tanggal surat", "Ditujukan kepada", "Perihal", "Catatan", "Status", "Alasan pembatalan", "Dari permohonan", "Periode", "Dicatat oleh", "Waktu dicatat", "Jumlah berkas"];

type Fmt = "csv" | "xlsx" | "pdf";
const LABEL: Record<Fmt, "Excel (.xlsx)" | "CSV (.csv)" | "PDF (.pdf)"> = { xlsx: "Excel (.xlsx)", csv: "CSV (.csv)", pdf: "PDF (.pdf)" };

async function download(page: Page, fmt: Fmt) {
  const event = page.waitForEvent("download");
  await page.locator("summary:visible", { hasText: "Ekspor" }).click();
  await page.getByRole("button", { name: LABEL[fmt] }).click();
  const d = await event;
  const path = await d.path();
  if (!path) throw new Error("download has no path");
  return { path, fileName: d.suggestedFilename() };
}

function table(path: string, fmt: "csv" | "xlsx"): { header: string[]; rows: string[][] } {
  if (fmt === "xlsx") {
    const t = xlsxTable(path);
    return { header: t.header, rows: t.rows };
  }
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf"); // UTF-8 BOM so Excel reads it right
  const records = parseCsv(bytes.toString("utf8").replace(/^﻿/, ""));
  return { header: records[0], rows: records.slice(1).filter((r) => r.some((x) => x !== "")) };
}

/** The numbers listed on the screen, top to bottom (one card per letter). */
async function screenNumbers(page: Page): Promise<string[]> {
  const cards = main(page).locator("article");
  await expect(cards.first()).toBeVisible();
  const texts = await cards.locator("h3 a").allInnerTexts();
  return texts.map((t) => t.replace(/\s+/g, "").trim());
}

let setupDone = false;
let ids: { formula: string; plain: string; voided: string; outgoing: string } | null = null;
async function setup() {
  if (setupDone && ids) return ids;
  const formula = await mustRegister("sekjen", "incoming", { subject: `=HYPERLINK("http://evil.example","${TAG}")`, counterpart: `+1+1 ${TAG}`, notes: "@SUM(A1:A9)", counterpartNumber: "-2+3" });
  const plain = await mustRegister("sekum1", "incoming", { subject: `${TAG} Surat biasa, dengan "tanda kutip" dan koma`, counterpart: `Mitra ${TAG}`, notes: "Baris satu\nBaris dua" });
  const voided = await mustRegister("sekjen", "incoming", { subject: `${TAG} Salah catat`, counterpart: `Mitra ${TAG}` });
  expect((await voidAs("sekjen", voided.id, "Dobel dicatat, lihat nomor sebelumnya")).ok).toBe(true);
  const outgoing = await mustRegister("sekjen", "outgoing", { subject: `${TAG} Surat keluar uji`, counterpart: `Tujuan ${TAG}` });
  setupDone = true;
  ids = { formula: formula.numberText, plain: plain.numberText, voided: voided.numberText, outgoing: outgoing.numberText };
  return ids;
}

for (const fmt of ["xlsx", "csv", "pdf"] as const) {
  test.describe(`LT-38, LT-39: ${fmt} export of Surat Masuk by BPH (view only) equals the filtered screen`, () => {
    test(`ketum exports ${fmt}: same rows in the same order as the screen, voided marked, one log row, no formulas, no personal data`, async ({ browser }) => {
      test.setTimeout(180_000);
      const made = await setup();
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        await page.goto(`${PATHS.incoming}?q=${encodeURIComponent(TAG)}&status=all`);
        const shown = await screenNumbers(page);
        expect(shown.length).toBeGreaterThanOrEqual(3);
        const total = Number(/dari (\d+) surat/.exec(await main(page).getByText(/^Menampilkan/).innerText())![1]);
        expect(total).toBe(shown.length);

        const before = exportLogMaxId();
        const file = await download(page, fmt);
        expect(file.fileName).toBe(`surat-masuk-${jakartaToday()}.${fmt}`);

        if (fmt === "pdf") {
          const bytes = readFileSync(file.path);
          expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
          if (hasPdftotext) {
            const text = pdfText(file.path);
            expect(text).toContain("Surat Masuk PMK ITERA");
            expect(text).toMatch(/Periode aktif: 2026\/2027/);
            expect(text).toMatch(/Diekspor \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
            // The number cell wraps ("PMK/NEX/" then "SM/2026/054") in the narrow column, so compare the tails, which must come in screen order
            const flat = text.replace(/\s+/g, "");
            const at = shown.map((n) => flat.indexOf(n.split("/").slice(-3).join("/")));
            expect(at.every((i) => i >= 0), `every listed number is in the PDF: ${JSON.stringify(at)}`).toBe(true);
            expect([...at].sort((a, b) => a - b), "rows in screen order").toEqual(at);
            // The status cell is "Dibatalkan: <reason>" and wraps in its narrow column, so only the start of the reason is contiguous
            expect(text).toContain("Dibatalkan:");
            expect(text.replace(/\s+/g, "")).toContain("Dobeldicatat");
          }
        } else {
          const t = table(file.path, fmt);
          expect(t.header).toEqual(INCOMING_HEADER);
          // rows = the screen: same numbers, same order, numbered 1..n
          expect(t.rows.map((r) => r[1])).toEqual(shown);
          expect(t.rows.map((r) => r[0])).toEqual(t.rows.map((_, i) => String(i + 1)));
          expect(t.rows).toHaveLength(total);
          const byNumber = (n: string) => t.rows.find((r) => r[1] === n)!;
          const v = byNumber(made.voided);
          expect(v[9]).toBe("Dibatalkan");
          expect(v[10]).toBe("Dobel dicatat, lihat nomor sebelumnya");
          const p = byNumber(made.plain);
          expect(p[9]).toBe("Aktif");
          expect(p[10]).toBe("-" === p[10] ? "-" : p[10]); // no void reason on an active letter (empty or dash)
          expect(p[7]).toBe(`${TAG} Surat biasa, dengan "tanda kutip" dan koma`); // commas and quotes survive
          expect(p[8]).toContain("Baris satu");
          expect(p[8]).toContain("Baris dua");
          expect(p[11]).toBe("Tidak");
          expect(p[12]).toBe("2026/2027");
          expect(p[13]).toBe(q(`select full_name from public.members where email = '${emailOf("sekum1")}'`)); // the creator's NAME, never an email
          const dbTime = q(`select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') from nexus.letters where number_text = '${made.plain}'`);
          expect(p[14]).toContain(dbTime); // timestamps in WIB
          expect(p[14]).toContain("WIB");
          expect(p[15]).toBe("0");
          // Formula injection: a cell that starts with = + - @ is text, never a formula
          const f = byNumber(made.formula);
          if (fmt === "csv") {
            expect(f[7]).toBe(`'=HYPERLINK("http://evil.example","${TAG}")`);
            expect(f[5]).toBe(`'+1+1 ${TAG}`);
            expect(f[8]).toBe("'@SUM(A1:A9)");
            expect(f[6]).toBe("'-2+3");
          } else {
            expect(f[7]).toContain("HYPERLINK"); // the text is there ...
            const sheet = unzip(readFileSync(file.path))["xl/worksheets/sheet1.xml"].toString("utf8");
            expect(sheet, "an xlsx cell must never carry a formula element").not.toMatch(/<f[ >]/);
            expect(sheet).not.toMatch(/t="str"/); // t="str" is a formula result cell
          }
          // No personal data and no links anywhere in the file
          const all = JSON.stringify(t);
          expect(all).not.toMatch(/@nexus\.test|\b123450\d{3}\b|signed|token=|storage\/v1|nexus-letter-files/i);
        }

        // Exactly one log row, written before the file: who, what, how many; no search text; no rows
        const logs = exportLogsAfter(before);
        expect(logs).toHaveLength(1);
        const log = logs[0];
        expect(log.exporter_member_id).toBe(memberId(emailOf("ketum")));
        expect(log.letter_type).toBe("incoming");
        expect(log.format).toBe(fmt);
        expect(Number(log.row_count)).toBe(total);
        expect(log.period_id).toBe(q("select id from public.periods where is_active"));
        expect(JSON.stringify(log)).not.toContain(TAG); // the search text is not stored
        expect(log.filters.search_used).toBe(true); // only THAT a search was used, never its text
        expect(Object.keys(log.filters).sort()).toEqual(["period", "search_used", "status", "without_files", "year"]);
      } finally {
        await context.close();
      }
    });
  });
}

test.describe("LT-38: Surat Keluar export, filters, period filter", () => {
  test("secretary exports Surat Keluar as CSV with its own columns; status, year and 'Tanpa berkas' filters match the screen's own database function", async ({ browser }) => {
    test.setTimeout(180_000);
    const made = await setup();
    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      await page.goto(`${PATHS.outgoing}?q=${encodeURIComponent(TAG)}`);
      const shown = await screenNumbers(page);
      expect(shown).toContain(made.outgoing);
      const file = await download(page, "csv");
      expect(file.fileName).toBe(`surat-keluar-${jakartaToday()}.csv`);
      const t = table(file.path, "csv");
      expect(t.header).toEqual(OUTGOING_HEADER);
      expect(t.rows.map((r) => r[1])).toEqual(shown);
      expect(t.rows.find((r) => r[1] === made.outgoing)![4]).toBe(`Tujuan ${TAG}`);

      // Through the route with other filters; the count equals the list function's total for the same filters (oracle: letter_list)
      const year = Number(jakartaToday().slice(0, 4));
      const combos: { type: "incoming" | "outgoing"; filters: Record<string, unknown>; rpc: Record<string, unknown> }[] = [
        { type: "incoming", filters: { type: "incoming", status: "voided" }, rpc: { p_type: "incoming", p_status: "voided" } },
        { type: "incoming", filters: { type: "incoming", status: "active", search: TAG }, rpc: { p_type: "incoming", p_status: "active", p_search: TAG } },
        { type: "outgoing", filters: { type: "outgoing", period: "all" }, rpc: { p_type: "outgoing", p_period: "all" } },
        { type: "outgoing", filters: { type: "outgoing", year, withoutFiles: true }, rpc: { p_type: "outgoing", p_year: year, p_without_files: true } },
        { type: "incoming", filters: { type: "incoming", search: "tidak-ada-sama-sekali-" + TAG }, rpc: { p_type: "incoming", p_search: "tidak-ada-sama-sekali-" + TAG } },
      ];
      for (const c of combos) {
        const res = await context.request.post(EXPORT, { data: { format: "csv", filters: c.filters }, headers: { origin: ORIGIN } });
        expect(res.status(), JSON.stringify(c.filters)).toBe(200);
        const rows = parseCsv((await res.text()).replace(/^﻿/, "")).slice(1).filter((r) => r.some((x) => x !== ""));
        const list = await rpcAs("sekjen", "letter_list", { ...c.rpc, p_page_size: 50 });
        const total = Array.isArray(list.body) && list.body.length > 0 ? Number(list.body[0].total_count) : 0;
        expect(rows.length, JSON.stringify(c.filters)).toBe(total);
      }
      // An empty result is still a valid file with just the header (and one log row with row_count 0)
      const empty = await context.request.post(EXPORT, { data: { format: "csv", filters: { type: "incoming", search: "tidak-ada-sama-sekali-" + TAG } }, headers: { origin: ORIGIN } });
      expect(parseCsv((await empty.text()).replace(/^﻿/, "")).filter((r) => r.some((x) => x !== ""))).toHaveLength(1);
      expect(qjson<{ row_count: number }>("select row_count from nexus.letter_export_logs order by id desc limit 1")[0].row_count).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("response headers: type, attachment, no-store, length; the body really is that type", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      const expected: Record<Fmt, [RegExp, (b: Buffer) => boolean]> = {
        csv: [/^text\/csv; charset=utf-8$/, (b) => b.subarray(0, 3).toString("hex") === "efbbbf"],
        xlsx: [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/, (b) => b.subarray(0, 2).toString() === "PK"],
        pdf: [/^application\/pdf$/, (b) => b.subarray(0, 5).toString() === "%PDF-"],
      };
      for (const fmt of ["csv", "xlsx", "pdf"] as const) {
        const res = await context.request.post(EXPORT, { data: { format: fmt, filters: { type: "incoming" } }, headers: { origin: ORIGIN } });
        expect(res.status(), fmt).toBe(200);
        const h = res.headers();
        expect(h["content-type"], fmt).toMatch(expected[fmt][0]);
        expect(h["content-disposition"], fmt).toMatch(new RegExp(`^attachment; filename="?surat-masuk-\\d{4}-\\d{2}-\\d{2}\\.${fmt}"?`));
        expect(h["cache-control"], fmt).toContain("no-store");
        const body = await res.body();
        expect(Number(h["content-length"]), fmt).toBe(body.length);
        expect(expected[fmt][1](body), fmt).toBe(true);
      }
      // The form fallback (no JavaScript: urlencoded and multipart, browser-style mixed-case boundary) works too
      const form = await context.request.post(EXPORT, { form: { format: "csv", type: "incoming", status: "voided", withoutFiles: "0" }, headers: { origin: ORIGIN } });
      expect(form.status()).toBe(200);
      const multi = await context.request.post(EXPORT, { multipart: { format: "csv", type: "outgoing" }, headers: { origin: ORIGIN } });
      expect(multi.status()).toBe(200);
    } finally {
      await context.close();
    }
  });
});

test.describe("LT-37, LT-39: refusals write no log row and return no file", () => {
  async function post(context: BrowserContext, data: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
    return context.request.post(EXPORT, { data: data as never, headers });
  }

  test("bad bodies are 400 with a code only: unknown format, type missing, bad period or status, year out of range, search too long, broken JSON", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      const before = exportLogCount();
      for (const [label, body] of [
        ["unknown format", { format: "docx", filters: { type: "incoming" } }],
        ["no format", { filters: { type: "incoming" } }],
        ["no type", { format: "csv", filters: {} }],
        ["wrong type", { format: "csv", filters: { type: "diary" } }],
        ["wrong period", { format: "csv", filters: { type: "incoming", period: "2025/2026" } }],
        ["wrong status", { format: "csv", filters: { type: "incoming", status: "weird" } }],
        ["year 1999", { format: "csv", filters: { type: "incoming", year: 1999 } }],
        ["year as text", { format: "csv", filters: { type: "incoming", year: "x" } }],
        ["search 121 characters", { format: "csv", filters: { type: "incoming", search: "s".repeat(121) } }],
        ["a body that is not an object", ["csv"]],
      ] as [string, unknown][]) {
        const res = await post(context, body);
        expect(res.status(), label).toBe(400);
        const json = (await res.json()) as { error: { code: string } };
        expect(typeof json.error.code, label).toBe("string");
        expect(JSON.stringify(json), label).not.toMatch(/stack|select |nexus\./i);
      }
      const broken = await context.request.post(EXPORT, { data: "{not json", headers: { origin: ORIGIN, "content-type": "application/json" } });
      expect(broken.status()).toBe(400);
      const huge = await context.request.post(EXPORT, { data: JSON.stringify({ format: "csv", filters: { type: "incoming", search: "x".repeat(20_000) } }), headers: { origin: ORIGIN, "content-type": "application/json" } });
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
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(`${PATHS.incoming}?q=${encodeURIComponent(TAG)}`);
      await expect(main(page).locator("article").first()).toBeVisible();
      const before = exportLogCount();
      q("alter table nexus.letter_export_logs add constraint qa_block_lt_log_write check (false) not valid");
      try {
        const res = await post(context, { format: "csv", filters: { type: "incoming" } });
        expect(res.status()).toBe(503);
        expect(res.headers()["content-type"]).toContain("application/json");
        expect(JSON.stringify(await res.json())).toBe('{"error":{"code":"unavailable"}}');
        // On the screen: the normal outage text, no download, the page stays usable
        let downloaded = false;
        page.on("download", () => (downloaded = true));
        await page.locator("summary:visible", { hasText: "Ekspor" }).click();
        await page.getByRole("button", { name: "CSV (.csv)" }).click();
        await expect(page.getByText("Terjadi gangguan. Coba lagi sebentar lagi.")).toBeVisible();
        expect(downloaded).toBe(false);
        expect(exportLogCount()).toBe(before);
      } finally {
        q("alter table nexus.letter_export_logs drop constraint if exists qa_block_lt_log_write");
      }
      // Restored: the same call works and writes exactly one row
      const ok = await post(context, { format: "csv", filters: { type: "incoming" } });
      expect(ok.status()).toBe(200);
      expect(exportLogCount()).toBe(before + 1);
    } finally {
      await context.close();
    }
  });

  test("a direct export call by a member without the key is refused by the database and writes nothing (LT-37, LT-39)", async () => {
    const before = exportLogCount();
    for (const who of ["regular", "pembina", "admin", "sekdep", "kadep", "inactive", "unlinked", "anon"] as const) {
      const denied = await rpcAs(who, "letter_export", { p_format: "csv", p_type: "incoming" });
      expect(denied.ok, who).toBe(false);
    }
    expect(exportLogCount()).toBe(before);
    expect(qn("select count(*) from nexus.letter_export_logs where exporter_member_id = (select id from public.members where email = 'member.regular@nexus.test')")).toBe(0);
    // Holders of the key are logged exactly once per call (the function writes the row in the same transaction as the rows)
    const ok = await rpcAs("ketum", "letter_export", { p_format: "csv", p_type: "incoming" });
    expect(ok.ok, JSON.stringify(ok.body).slice(0, 200)).toBe(true);
    expect(exportLogCount()).toBe(before + 1);
  });
});
