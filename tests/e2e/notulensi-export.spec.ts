// Meeting Minutes export (spec F6, section 8; MN-25..MN-27, A-MN8, A-MN16, R13): Excel, CSV and PDF hold exactly the rows the
// filtered screen lists inside the caller's EXPORT scope, in screen order, voided minutes marked with their reason; content and
// decision in full; one append-only log row per successful export (no search text, no PII); no file without the key, outside
// the scope or without the log row; a single-minute export from the detail; cells that start with = + - @ are never formulas.
// Pattern of finance-export.spec.ts and surat-export.spec.ts.
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signedInContext } from "./helpers";
import { hasPdftotext, parseCsv, pdfText } from "./member-data-helpers";
import { unzip } from "../support/zip";
import {
  activePeriodId,
  awayFromMidnight,
  emailOf,
  EXPORT,
  exportLogCount,
  exportLogMaxId,
  exportLogsAfter,
  fakeFile,
  jakartaToday,
  listTotal,
  main,
  memberId,
  minuteRow,
  minuteUrl,
  mustRecord,
  nameOf,
  ORIGIN,
  q,
  rpcAs,
  sweepQa,
  tag,
  UNITS,
  unitId,
  voidAs,
  xlsxTable,
} from "./notulensi-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
  q("alter table nexus.minute_export_logs drop constraint if exists qa_block_mn_log_write");
});

const HEADER = ["No", "Tanggal rapat", "Unit", "Judul rapat", "Topik bahasan", "Isi notulensi", "Keputusan dan tindak lanjut", "Status", "Alasan pembatalan", "Periode", "Dicatat oleh", "Waktu dicatat", "Jumlah berkas"];
const COL = { no: 0, date: 1, unit: 2, title: 3, topic: 4, content: 5, decision: 6, status: 7, voidReason: 8, period: 9, by: 10, at: 11, files: 12 } as const;

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
  return { header: records[at] ?? [], rows: records.slice(at + 1).filter((r) => r.some((x) => x !== "")), above: records.slice(0, at) };
}

/** The titles listed on the screen, top to bottom (one card per minute). */
async function screenTitles(page: Page): Promise<string[]> {
  const cards = main(page).locator("article");
  await expect(cards.first()).toBeVisible();
  return cards.locator("h3 a").allInnerTexts();
}

let made: { formula: string; plain: string; voided: string; withFiles: string; internal: string; plainId: string } | null = null;
async function setup() {
  if (made) return made;
  await awayFromMidnight();
  const bph = unitId(UNITS.bph);
  const formula = await mustRecord("sekjen", { unit: bph, title: `=HYPERLINK("http://evil.example","${TAG}")`, topic: "+1+1 rumus", content: "@SUM(A1:A9)", decision: "-2+3" });
  const plain = await mustRecord("sekjen", { unit: bph, title: `${TAG} Rapat biasa, dengan "kutip" dan koma`, topic: "Topik biasa", content: "Baris satu\nBaris dua", decision: "Putusan biasa" });
  const voided = await mustRecord("sekum1", { unit: bph, title: `${TAG} Salah catat` });
  expect((await voidAs("sekum1", voided.id, "Dobel dicatat, lihat yang lain")).ok).toBe(true);
  await mustRecord("sekjen", { unit: bph, title: `${TAG} Dengan lampiran`, files: [fakeFile("sekjen", "a.pdf"), fakeFile("sekjen", "b.pdf")] });
  const internal = await mustRecord("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} Rapat internal` });
  made = { formula: formula.id, plain: `${TAG} Rapat biasa, dengan "kutip" dan koma`, voided: `${TAG} Salah catat`, withFiles: `${TAG} Dengan lampiran`, internal: internal.id, plainId: plain.id };
  return made;
}

for (const fmt of ["xlsx", "csv", "pdf"] as const) {
  test.describe(`MN-26, MN-27: ${fmt} export by BPH (view and export, no manage) equals the filtered screen`, () => {
    test(`ketum exports ${fmt}: same rows in the same order as the screen, voided marked, content in full, one log row, no formulas`, async ({ browser }) => {
      test.setTimeout(180_000);
      const ids = await setup();
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        await page.goto(`/notulensi?q=${encodeURIComponent(TAG)}&status=all`);
        const shown = await screenTitles(page);
        expect(shown.length).toBeGreaterThanOrEqual(5);
        const total = await listTotal("ketum", { p_search: TAG, p_status: "all" });
        expect(shown).toHaveLength(total);

        const before = exportLogMaxId();
        const file = await download(page, fmt);
        expect(file.fileName).toBe(`notulensi-${jakartaToday()}.${fmt}`);

        if (fmt === "pdf") {
          expect(readFileSync(file.path).subarray(0, 5).toString()).toBe("%PDF-");
          if (hasPdftotext) {
            const text = pdfText(file.path);
            expect(text).toContain("Notulensi Rapat PMK ITERA");
            expect(text).toContain("Periode aktif: 2026/2027");
            expect(text).toContain("Filter: Status Semua, Dengan pencarian");
            expect(text).toMatch(/Diekspor \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
            // One block per minute, headed "<n>. <title>", in screen order (spec 8: a block, not a table cell). A long
            // heading wraps onto the next line in the PDF, so compare the start of each title.
            const headings = [...text.matchAll(/^[\s\f]*(\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2].trim()] as const); // page 2+ starts with a form feed
            expect(headings.map(([n]) => n).slice(0, shown.length)).toEqual(shown.map((_, i) => i + 1));
            headings.slice(0, shown.length).forEach(([, h], i) => expect(shown[i].startsWith(h.slice(0, 12)), `block ${i + 1}: ${h}`).toBe(true));
            expect(text).toContain('=HYPERLINK("http://evil.example"'); // shown as text, never a link
            expect(text).toContain("Status: Dibatalkan. Alasan: Dobel dicatat, lihat yang lain");
            expect(text).toContain("Baris satu\nBaris dua"); // content in full, line breaks kept
            expect(text).toContain("2 berkas");
          }
        } else {
          const t = table(file.path, fmt);
          expect(t.header).toEqual(HEADER);
          expect(t.rows.map((r) => r[COL.title])).toEqual(fmt === "csv" ? shown.map((s) => (/^[=+\-@]/.test(s) ? `'${s}` : s)) : shown);
          expect(t.rows.map((r) => r[COL.no])).toEqual(t.rows.map((_, i) => String(i + 1)));
          const byTitle = (s: string) => t.rows.find((r) => r[COL.title] === s)!;
          const v = byTitle(ids.voided);
          expect(v[COL.status]).toBe("Dibatalkan");
          expect(v[COL.voidReason]).toBe("Dobel dicatat, lihat yang lain");
          const p = byTitle(ids.plain);
          expect(p[COL.status]).toBe("Aktif");
          expect(p[COL.unit]).toBe(UNITS.bph);
          expect(p[COL.content]).toBe("Baris satu\nBaris dua"); // content in full, line breaks kept
          expect(p[COL.decision]).toBe("Putusan biasa");
          expect(p[COL.voidReason]).toBe("-");
          expect(p[COL.period]).toBe("2026/2027");
          expect(p[COL.by]).toBe(nameOf("sekjen")); // a NAME, never an email
          expect(p[COL.date]).toBe(jakartaToday());
          const dbTime = q(`select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') from nexus.minutes where id = '${ids.plainId}'`);
          expect(p[COL.at]).toBe(`${dbTime} WIB`);
          expect(byTitle(ids.withFiles)[COL.files]).toBe("2");
          // Formula injection: a cell that starts with = + - @ is text, never a formula.
          if (fmt === "csv") {
            const f = t.rows.find((r) => r[COL.title].startsWith("'=HYPERLINK"))!;
            expect(f[COL.title]).toBe(`'=HYPERLINK("http://evil.example","${TAG}")`);
            expect(f[COL.topic]).toBe("'+1+1 rumus");
            expect(f[COL.content]).toBe("'@SUM(A1:A9)");
            expect(f[COL.decision]).toBe("'-2+3");
          } else {
            const sheet = unzip(readFileSync(file.path))["xl/worksheets/sheet1.xml"].toString("utf8");
            expect(sheet, "an xlsx cell must never carry a formula element").not.toMatch(/<f[ >]/);
            expect(sheet).not.toMatch(/t="str"/);
            expect(t.above.flat()).toEqual(expect.arrayContaining(["Notulensi Rapat PMK ITERA", "Periode aktif: 2026/2027", "Filter: Status Semua, Dengan pencarian"]));
          }
          // No personal data, no storage paths, no links.
          expect(JSON.stringify(t)).not.toMatch(/@nexus\.test|storage\/v1|nexus-minute-files|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        }

        // Exactly one log row: who, format, row count, period; no search text, no title.
        const logs = exportLogsAfter(before);
        expect(logs).toHaveLength(1);
        const log = logs[0];
        expect(log.exporter_member_id).toBe(memberId(emailOf("ketum")));
        expect(log.format).toBe(fmt);
        expect(Number(log.row_count)).toBe(total);
        expect(log.period_id).toBe(activePeriodId());
        expect(log.minute_id).toBeNull();
        expect(log.filters).toEqual({ period: "active", status: "all", unit_id: null, search_used: true });
        expect(JSON.stringify(log)).not.toContain(TAG);
      } finally {
        await context.close();
      }
    });
  });
}

test.describe("MN-25, MN-26, R13: the export follows the scope; filters equal the list", () => {
  test("filters through the route equal minute_list's total; a department secretary exports her unit only, another unit's filter gives an empty file", async ({ browser }) => {
    test.setTimeout(180_000);
    await setup();
    const sekjen = await signedInContext(browser, "sekjen");
    const sekdep = await signedInContext(browser, "sekdep");
    try {
      const combos: { who: "sekjen" | "sekdep"; filters: Record<string, unknown>; rpc: Record<string, unknown> }[] = [
        { who: "sekjen", filters: { search: TAG }, rpc: { p_search: TAG } },
        { who: "sekjen", filters: { search: TAG, status: "voided" }, rpc: { p_search: TAG, p_status: "voided" } },
        { who: "sekjen", filters: { search: TAG, status: "all", period: "all" }, rpc: { p_search: TAG, p_status: "all", p_period: "all" } },
        { who: "sekjen", filters: { search: TAG, unitId: unitId(UNITS.internal) }, rpc: { p_search: TAG, p_unit_id: unitId(UNITS.internal) } },
        { who: "sekdep", filters: { search: TAG, status: "all" }, rpc: { p_search: TAG, p_status: "all" } },
        { who: "sekdep", filters: { unitId: unitId(UNITS.bph), status: "all" }, rpc: { p_unit_id: unitId(UNITS.bph), p_status: "all" } },
        { who: "sekjen", filters: { search: `tidak-ada-${TAG}` }, rpc: { p_search: `tidak-ada-${TAG}` } },
      ];
      for (const c of combos) {
        const ctx = c.who === "sekjen" ? sekjen.context : sekdep.context;
        const before = exportLogMaxId();
        const res = await ctx.request.post(EXPORT, { data: { kind: "list", format: "csv", filters: c.filters }, headers: { origin: ORIGIN } });
        const label = `${c.who} ${JSON.stringify(c.filters)}`;
        expect(res.status(), label).toBe(200);
        const t = table(Buffer.from(await res.body()), "csv");
        expect(t.rows.length, label).toBe(await listTotal(c.who, c.rpc));
        if (c.who === "sekdep") for (const r of t.rows) expect(r[COL.unit], label).toBe(UNITS.internal);
        expect(exportLogsAfter(before), label).toHaveLength(1);
      }
      // A department secretary's file never holds another unit's minute.
      const all = await sekdep.context.request.post(EXPORT, { data: { kind: "list", format: "csv", filters: { search: TAG, status: "all" } }, headers: { origin: ORIGIN } });
      const text = await all.text();
      expect(text).toContain(`${TAG} Rapat internal`);
      expect(text).not.toContain(`${TAG} Rapat biasa`);
    } finally {
      await sekjen.context.close();
      await sekdep.context.close();
    }
  });

  test("A-MN8: 'Ekspor' on a detail exports that one minute (its log row stores the minute id); outside the scope it is 404 and writes nothing", async ({ browser }) => {
    test.setTimeout(120_000);
    const ids = await setup();
    const { context, page } = await signedInContext(browser, "sekjen");
    const sekdep = await signedInContext(browser, "sekdep");
    try {
      await page.goto(minuteUrl(ids.plainId));
      await expect(page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      const before = exportLogMaxId();
      const file = await download(page, "csv");
      expect(file.fileName).toBe(`notulensi-rapat-${jakartaToday()}.csv`);
      const t = table(file.path, "csv");
      expect(t.rows).toHaveLength(1);
      expect(t.rows[0][COL.title]).toBe(ids.plain);
      const logs = exportLogsAfter(before);
      expect(logs).toHaveLength(1);
      expect(logs[0].minute_id).toBe(ids.plainId);
      expect(logs[0].filters).toEqual({ single: true });
      expect(Number(logs[0].row_count)).toBe(1);
      // PDF of one minute: the title as the heading, no list numbering.
      const pdf = await context.request.post(EXPORT, { data: { kind: "single", format: "pdf", minuteId: ids.plainId }, headers: { origin: ORIGIN } });
      expect(pdf.status()).toBe(200);
      // Outside the scope: the department secretary asks for a BPH minute.
      const logsBefore = exportLogCount();
      const outside = await sekdep.context.request.post(EXPORT, { data: { kind: "single", format: "csv", minuteId: ids.plainId }, headers: { origin: ORIGIN } });
      expect(outside.status()).toBe(404);
      expect(await outside.text()).not.toContain(TAG);
      const missing = await context.request.post(EXPORT, { data: { kind: "single", format: "csv", minuteId: "00000000-0000-4000-8000-000000000000" }, headers: { origin: ORIGIN } });
      expect(missing.status()).toBe(404);
      expect(exportLogCount(), "a refused single export writes no log row").toBe(logsBefore);
      expect(minuteRow(ids.plainId).status).toBe("active"); // an export changes nothing
    } finally {
      await context.close();
      await sekdep.context.close();
    }
  });

  test("the screen offers no 'Ekspor' for an empty result, and none for a Kepala Departemen who reads but cannot export", async ({ browser }) => {
    await setup();
    const ketum = await signedInContext(browser, "ketum");
    const kadep = await signedInContext(browser, "kadep");
    try {
      await ketum.page.goto(`/notulensi?q=${encodeURIComponent(`tidak-ada-${TAG}`)}`);
      await expect(main(ketum.page).getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await expect(ketum.page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(0);
      const own = await mustRecord("sekjen", { unit: unitId(UNITS.ops), title: `${TAG} operasional` });
      await kadep.page.goto(minuteUrl(own.id));
      await expect(kadep.page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      await expect(kadep.page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(0);
      const direct = await kadep.context.request.post(EXPORT, { data: { kind: "single", format: "csv", minuteId: own.id }, headers: { origin: ORIGIN } });
      expect(direct.status()).toBe(403);
    } finally {
      await ketum.context.close();
      await kadep.context.close();
    }
  });
});

test.describe("headers, body shapes and refusals", () => {
  async function post(context: BrowserContext, data: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
    return context.request.post(EXPORT, { data: data as never, headers });
  }

  test("type, attachment, no-store, length; the body really is that type", async ({ browser }) => {
    await setup();
    const { context } = await signedInContext(browser, "ketum");
    try {
      const expected: Record<Fmt, [RegExp, (b: Buffer) => boolean]> = {
        csv: [/^text\/csv; charset=utf-8$/, (b) => b.subarray(0, 3).toString("hex") === "efbbbf"],
        xlsx: [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/, (b) => b.subarray(0, 2).toString() === "PK"],
        pdf: [/^application\/pdf$/, (b) => b.subarray(0, 5).toString() === "%PDF-"],
      };
      for (const fmt of ["csv", "xlsx", "pdf"] as const) {
        const res = await post(context, { kind: "list", format: fmt, filters: { search: TAG } });
        expect(res.status(), fmt).toBe(200);
        const h = res.headers();
        expect(h["content-type"], fmt).toMatch(expected[fmt][0]);
        expect(h["content-disposition"], fmt).toBe(`attachment; filename="notulensi-${jakartaToday()}.${fmt}"`);
        expect(h["cache-control"], fmt).toContain("no-store");
        const body = await res.body();
        expect(Number(h["content-length"]), fmt).toBe(body.length);
        expect(expected[fmt][1](body), fmt).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test("bad bodies are 400 with a code only and write no log row", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      const before = exportLogCount();
      for (const [label, body] of [
        ["unknown format", { kind: "list", format: "docx", filters: {} }],
        ["no kind", { format: "csv", filters: {} }],
        ["unknown kind", { kind: "all", format: "csv" }],
        ["single without id", { kind: "single", format: "csv" }],
        ["single with a bad id", { kind: "single", format: "csv", minuteId: "bukan-id" }],
        ["bad status", { kind: "list", format: "csv", filters: { status: "draft" } }],
        ["bad period", { kind: "list", format: "csv", filters: { period: "2025/2026" } }],
        ["bad unit", { kind: "list", format: "csv", filters: { unitId: "bph" } }],
        ["search 121 characters", { kind: "list", format: "csv", filters: { search: "s".repeat(121) } }],
        ["not an object", ["csv"]],
      ] as [string, unknown][]) {
        const res = await post(context, body);
        expect(res.status(), label).toBe(400);
        const json = (await res.json()) as { error: { code: string } };
        expect(typeof json.error.code, label).toBe("string");
        expect(JSON.stringify(json), label).not.toMatch(/stack|select |nexus\./i);
      }
      const broken = await context.request.post(EXPORT, { data: "{not json", headers: { origin: ORIGIN, "content-type": "application/json" } });
      expect(broken.status()).toBe(400);
      const huge = await context.request.post(EXPORT, { data: JSON.stringify({ kind: "list", format: "csv", filters: { search: "x".repeat(20_000) } }), headers: { origin: ORIGIN, "content-type": "application/json" } });
      expect(huge.status()).toBe(400);
      expect(exportLogCount(), "refused exports write no log row").toBe(before);
    } finally {
      await context.close();
    }
  });

  test("if the log row cannot be written, NO file is returned and the screen says so; nothing is half-logged", async ({ browser }) => {
    test.setTimeout(180_000);
    await setup();
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(`/notulensi?q=${encodeURIComponent(TAG)}`);
      await expect(main(page).locator("article").first()).toBeVisible();
      const before = exportLogCount();
      q("alter table nexus.minute_export_logs add constraint qa_block_mn_log_write check (false) not valid");
      try {
        const res = await post(context, { kind: "list", format: "csv", filters: { search: TAG } });
        expect(res.status()).toBe(503);
        expect(JSON.stringify(await res.json())).toBe('{"error":{"code":"unavailable"}}');
        let downloaded = false;
        page.on("download", () => (downloaded = true));
        await page.locator("summary:visible", { hasText: "Ekspor" }).click();
        await page.getByRole("button", { name: "CSV (.csv)" }).click();
        await expect(page.getByText("Terjadi gangguan. Coba lagi.").first()).toBeVisible();
        expect(downloaded).toBe(false);
        expect(exportLogCount()).toBe(before);
      } finally {
        q("alter table nexus.minute_export_logs drop constraint if exists qa_block_mn_log_write");
      }
      const ok = await post(context, { kind: "list", format: "csv", filters: { search: TAG } });
      expect(ok.status()).toBe(200);
      expect(exportLogCount()).toBe(before + 1);
    } finally {
      await context.close();
    }
  });

  test("direct database calls: no-key personas and heads write nothing; a holder is logged once per call; a bad format writes nothing", async () => {
    await setup();
    const before = exportLogCount();
    for (const who of ["regular", "pembina", "admin", "kadep", "kabiro", "inactive", "unlinked", "anon"] as const) {
      expect((await rpcAs(who, "minute_export", { p_format: "csv" })).ok, who).toBe(false);
    }
    expect((await rpcAs("ketum", "minute_export", { p_format: "docx" })).ok).toBe(false);
    expect(exportLogCount()).toBe(before);
    for (const [i, who] of (["ketum", "sekjen", "sekdep"] as const).entries()) {
      const ok = await rpcAs(who, "minute_export", { p_format: "csv", p_search: TAG });
      expect(ok.ok, `${who}: ${JSON.stringify(ok.body).slice(0, 200)}`).toBe(true);
      expect(exportLogCount()).toBe(before + i + 1);
    }
  });
});
