// Data Anggota export and export log, plus direct API/database-function access per persona.
// Spec: docs/modules/member-data.md F5, MD-02, MD-03, MD-05, MD-06, MD-10, MD-29..MD-34, MD-37.
// The export log is append-only and already holds rows, so every check MEASURES A DELTA (count before, count after).
// The count is read straight from nexus.member_data_export_logs with psql (see member-data-helpers.ts for why).
import { expect, test, type Page } from "@playwright/test";
import { API_URL, PUBLISHABLE_KEY, sql } from "../support/local-stack";
import { getSession, setActive, setActivePeriod, signedInContext, type PersonaKey } from "./helpers";
import {
  EXPORT_PATH,
  LIST_PATH,
  ORIGIN,
  activePeriodId,
  countMembers,
  counterText,
  downloadExport,
  errorCodeOf,
  exportButton,
  expectTotal,
  hasPdftotext,
  jakartaDay,
  lastLogId,
  logCount,
  logRowsAfter,
  main,
  memberId,
  namesOnPage,
  openList,
  parseCsv,
  pdfText,
  postExport,
  readCsv,
  secretValues,
  unitId,
  xlsxNames,
} from "./member-data-helpers";

const HEADER = ["No", "Nama Lengkap", "Pembina", "Unit", "Jabatan", "Status"];
const FILE_NAME = /^data-anggota-(\d{4}-\d{2}-\d{2})\.(xlsx|csv|pdf)$/;

/** Names on screen in order, across every page of the current filters. */
async function allNamesOnScreen(page: Page): Promise<string[]> {
  const out: string[] = [];
  const base = new URL(page.url());
  for (let n = 1; ; n++) {
    const url = new URL(base);
    if (n > 1) url.searchParams.set("page", String(n));
    else url.searchParams.delete("page");
    await page.goto(url.pathname + url.search);
    await expect(counterText(page)).toBeVisible();
    out.push(...(await namesOnPage(page)));
    const next = await page.getByRole("link", { name: "Halaman berikutnya" }).count();
    if (!next) break;
  }
  return out;
}

function assertDateInName(fileName: string, before: Date, after: Date) {
  const m = FILE_NAME.exec(fileName);
  expect(m, fileName).not.toBeNull();
  expect([jakartaDay(before), jakartaDay(after)]).toContain(m![1]);
}

// ---------------------------------------------------------------------------------------------
test.describe("MD-29, MD-30, MD-31, MD-10: export through the real menu as Ketua Umum", () => {
  test("Excel, CSV and PDF of the default view: name, type, 45 rows in screen order, one log row each, no personal data", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await expectTotal(page, 45);
      const screenNames = await allNamesOnScreen(page);
      expect(screenNames).toHaveLength(45);
      await openList(page);
      const exporter = memberId("ketum@nexus.test");
      const period = activePeriodId();
      const secrets = secretValues();
      const logBefore = lastLogId();
      const countBefore = logCount();

      // ---- CSV
      let before = new Date();
      const csv = await downloadExport(page, "CSV (.csv)");
      assertDateInName(csv.fileName, before, new Date());
      expect(csv.fileName).toMatch(/\.csv$/);
      const csvFile = readCsv(csv.path);
      expect(csvFile.bom).toBe(true);
      expect(csvFile.raw).toContain("\r\n");
      expect(csvFile.raw.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      expect(csvFile.header).toEqual(HEADER);
      expect(csvFile.rows).toHaveLength(45);
      expect(csvFile.rows.every((r) => r.length === 6)).toBe(true);
      expect(csvFile.rows.map((r) => r[1])).toEqual(screenNames); // same order as the screen (MD-29)
      expect(csvFile.rows.map((r) => Number(r[0]))).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
      expect(csvFile.rows.filter((r) => r[2] === "Ya")).toHaveLength(3); // the lecturers (MD-24)
      expect(csvFile.rows.filter((r) => r[2] !== "Ya").every((r) => r[2] === "")).toBe(true);
      expect(new Set(csvFile.rows.map((r) => r[5]))).toEqual(new Set(["Aktif"]));
      const bulk11 = csvFile.rows.find((r) => r[1] === "Bulk Anggota 11")!;
      expect([bulk11[3], bulk11[4]]).toEqual(["Departemen Pelayanan Khusus · Musik", "Staff"]);
      const dosen = csvFile.rows.find((r) => r[1] === "Test Dosen Pembina")!;
      expect([dosen[2], dosen[3], dosen[4]]).toEqual(["Ya", "-", "-"]);
      for (const s of secrets) expect(csvFile.raw, "csv").not.toContain(s);
      await expect(main(page).getByText(`Unduhan dimulai: ${csv.fileName}`)).toBeVisible();
      expect(logCount()).toBe(countBefore + 1);

      // ---- Excel
      before = new Date();
      const xlsx = await downloadExport(page, "Excel (.xlsx)");
      assertDateInName(xlsx.fileName, before, new Date());
      expect(xlsx.fileName).toMatch(/\.xlsx$/);
      const book = xlsxNames(xlsx.path);
      expect(book.names).toEqual(screenNames);
      expect(book.strings).toEqual(expect.arrayContaining(["Data Anggota PMK ITERA", "Periode 2026/2027", ...HEADER]));
      expect(book.strings.some((t) => /^Diekspor \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB$/.test(t))).toBe(true);
      expect(book.xml).not.toMatch(/<f[ >\/]/);
      for (const s of secrets) expect(book.strings.join("\n"), "xlsx").not.toContain(s);
      expect(logCount()).toBe(countBefore + 2);

      // ---- PDF
      before = new Date();
      const pdf = await downloadExport(page, "PDF (.pdf)");
      assertDateInName(pdf.fileName, before, new Date());
      expect(pdf.fileName).toMatch(/\.pdf$/);
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(pdf.path).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      if (hasPdftotext) {
        const text = pdfText(pdf.path);
        expect(text).toContain("Data Anggota PMK ITERA");
        expect(text).toContain("Periode 2026/2027");
        expect(text).toMatch(/Diekspor \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
        expect(text).toMatch(/Halaman 1 dari \d+/);
        expect(text.match(/\bAktif\b/g) ?? []).toHaveLength(45); // one status per row
        expect(text).not.toMatch(/\bNonaktif\b/);
        expect(text).toContain("Bulk Anggota 11");
        for (const s of secrets) expect(text, "pdf").not.toContain(s);
      }
      expect(logCount()).toBe(countBefore + 3);

      // ---- The log: exactly three new rows, one per export, nothing else stored (MD-31, MD-32)
      const rows = logRowsAfter(logBefore);
      expect(rows.map((r) => r.format)).toEqual(["csv", "xlsx", "pdf"]);
      for (const r of rows) {
        expect(Object.keys(r).sort()).toEqual(["created_at", "exporter_member_id", "filter_status", "filter_unit_id", "format", "id", "period_id", "search_used"]);
        expect(r.exporter_member_id).toBe(exporter); // the session's member, never client input
        expect(r.period_id).toBe(period);
        expect(r.filter_status).toBe("active");
        expect(r.filter_unit_id).toBeNull();
        expect(r.search_used).toBe(false);
        expect(Math.abs(Date.now() - new Date(r.created_at).getTime())).toBeLessThan(5 * 60_000);
      }
    } finally {
      await context.close();
    }
  });

  test("the export follows the filters, not only the page on screen: Semua = 49, Nonaktif = 4, Operasional = 4, search + unit", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const ops = unitId("Departemen Operasional");
      const cases: { query: string; total: number; status: string; unit: string | null; search: boolean; rowTest?: (rows: string[][]) => void }[] = [
        { query: "?status=all", total: 49, status: "all", unit: null, search: false, rowTest: (r) => expect(r.filter((x) => x[5] === "Nonaktif")).toHaveLength(4) },
        { query: "?status=inactive", total: 4, status: "inactive", unit: null, search: false, rowTest: (r) => expect(new Set(r.map((x) => x[5]))).toEqual(new Set(["Nonaktif"])) },
        {
          query: `?unit=${ops}`,
          total: 4,
          status: "active",
          unit: ops,
          search: false,
          rowTest: (r) => {
            expect(r.map((x) => x[1])).toEqual(["Bulk Anggota 11", "Bulk Anggota 23", "Bulk Anggota 39", "Test Kepala Departemen"]);
            // R6: the row still shows Bulk 11's PRIMARY assignment (Musik), although the filter matched Logistik
            expect(r.find((x) => x[1] === "Bulk Anggota 11")![3]).toBe("Departemen Pelayanan Khusus · Musik");
          },
        },
        { query: `?q=bulk&unit=${ops}&status=all`, total: 3, status: "all", unit: ops, search: true },
        { query: "?q=Dosen", total: 1, status: "active", unit: null, search: true, rowTest: (r) => expect(r[0].slice(1, 5)).toEqual(["Test Dosen Pembina", "Ya", "-", "-"]) },
        { query: "?q=ANGGOTA&status=all", total: countMembers("full_name ilike '%anggota%'"), status: "all", unit: null, search: true },
      ];
      for (const c of cases) {
        await openList(page, c.query);
        await expectTotal(page, c.total);
        const screen = await allNamesOnScreen(page);
        await openList(page, c.query);
        const last = lastLogId();
        const csv = await downloadExport(page, "CSV (.csv)");
        const file = readCsv(csv.path);
        expect(file.rows, c.query).toHaveLength(c.total);
        expect(file.rows.map((r) => r[1]), c.query).toEqual(screen);
        c.rowTest?.(file.rows);
        const logged = logRowsAfter(last);
        expect(logged, c.query).toHaveLength(1);
        expect(logged[0]).toMatchObject({ format: "csv", filter_status: c.status, filter_unit_id: c.unit, search_used: c.search });
        // No search text anywhere in the log row (A-MD11)
        expect(JSON.stringify(logged[0]).toLowerCase()).not.toMatch(/bulk|dosen|anggota/);
      }
    } finally {
      await context.close();
    }
  });

  test("Excel and PDF also hold exactly the filtered rows (Semua, 49)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, "?status=all");
      await expectTotal(page, 49);
      const xlsx = await downloadExport(page, "Excel (.xlsx)");
      const names = xlsxNames(xlsx.path).names;
      expect(names).toHaveLength(49);
      expect(new Set(names).size).toBe(49);
      const pdf = await downloadExport(page, "PDF (.pdf)");
      if (hasPdftotext) {
        const text = pdfText(pdf.path);
        expect((text.match(/\bAktif\b/g) ?? []).length).toBe(45);
        // "Test Anggota Nonaktif" also holds the word in its NAME, so count the status column (end of line) only
        expect((text.match(/Nonaktif[ \t]*$/gm) ?? []).length).toBe(4);
        expect(text).toMatch(/Halaman \d+ dari [2-9]/); // 49 rows span several pages
      }
    } finally {
      await context.close();
    }
  });

  test("BPH Bendahara Umum 1 may export too (rule D13)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      await openList(page);
      const before = logCount();
      const csv = await downloadExport(page, "CSV (.csv)");
      expect(readCsv(csv.path).rows).toHaveLength(45);
      expect(logCount()).toBe(before + 1);
      const row = logRowsAfter(lastLogId() - 1)[0];
      expect(row.exporter_member_id).toBe(memberId("bendahara@nexus.test"));
    } finally {
      await context.close();
    }
  });

  test("double click on a format sends ONE request and writes ONE log row; the button is busy meanwhile", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      const requests: string[] = [];
      page.on("request", (r) => {
        if (r.url().endsWith(EXPORT_PATH) && r.method() === "POST") requests.push(r.postData() ?? "");
      });
      const before = logCount();
      const download = page.waitForEvent("download");
      await exportButton(page).click();
      await page.getByRole("button", { name: "CSV (.csv)" }).dblclick();
      await download;
      await expect(main(page).getByText(/^Unduhan dimulai: /)).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(logCount()).toBe(before + 1);

      // Two synchronous clicks in the same tick, the worst case of a jumpy finger
      const second = page.waitForEvent("download");
      await exportButton(page).click();
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("details button")].find((el) => el.textContent?.includes("PDF")) as HTMLButtonElement;
        b.click();
        b.click();
        b.click();
      });
      await second;
      await expect(main(page).getByText(/^Unduhan dimulai: .*\.pdf$/)).toBeVisible();
      expect(requests).toHaveLength(2);
      expect(logCount()).toBe(before + 2);

      // Format buttons are disabled while busy; the summary shows the busy text on a slow answer
      await page.route(`**${EXPORT_PATH}`, async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"unavailable"}}' });
      });
      await exportButton(page).click();
      await page.getByRole("button", { name: "Excel (.xlsx)" }).click();
      await expect(main(page).getByText("Menyiapkan file...")).toBeVisible();
      await expect(main(page).getByText("Terjadi gangguan. Coba lagi sebentar lagi.")).toBeVisible();
      await expect(main(page).getByText("Menyiapkan file...")).toHaveCount(0);
      expect(logCount()).toBe(before + 2); // the mocked call never reached the server
    } finally {
      await context.close();
    }
  });

  test("the browser sends only q, unit, status and format (validated filters, never the raw address)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, `?q=${encodeURIComponent("  Bulk   Anggota ")}&unit=${unitId("Departemen Operasional")}&status=all&page=2&pageSize=500&evil=1`);
      await expect(main(page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
      let body = "";
      let headers: Record<string, string> = {};
      await page.route(`**${EXPORT_PATH}`, async (route) => {
        body = route.request().postData() ?? "";
        headers = route.request().headers();
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"unavailable"}}' });
      });
      await exportButton(page).click();
      await page.getByRole("button", { name: "CSV (.csv)" }).click();
      await expect(main(page).getByText("Terjadi gangguan. Coba lagi sebentar lagi.")).toBeVisible();
      const params = new URLSearchParams(body);
      expect(Object.fromEntries(params)).toEqual({ q: "Bulk Anggota", unit: unitId("Departemen Operasional"), status: "all", format: "csv" });
      expect(headers["content-type"]).toMatch(/application\/x-www-form-urlencoded/);
    } finally {
      await context.close();
    }
  });

  test("GET (or HEAD, or opening the URL in a tab) never exports and never writes a log row", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const before = logCount();
      for (const method of ["get", "head", "put", "patch", "delete"] as const) {
        const res = await context.request[method](`${EXPORT_PATH}?format=csv&status=all`, { maxRedirects: 0 });
        expect(res.status(), method).toBe(405);
        expect(res.headers()["allow"], method).toBe("POST");
        expect(res.headers()["content-disposition"]).toBeUndefined();
      }
      const nav = await page.goto(`${EXPORT_PATH}?format=csv`);
      expect(nav?.status()).toBe(405);
      // A prefetch of the list page (what a link preview or Next's Link would do) writes nothing either
      await page.goto(LIST_PATH);
      await page.waitForTimeout(500);
      expect(logCount()).toBe(before);
    } finally {
      await context.close();
    }
  });

  test("a direct POST from a script (own cookies, same-origin header) gets the real file with the right headers; +1 log row", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      const before = logCount();
      for (const [format, type, ext] of [
        ["csv", "text/csv; charset=utf-8", "csv"],
        ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
        ["pdf", "application/pdf", "pdf"],
      ] as const) {
        const res = await postExport(context, { format, status: "inactive" });
        expect(res.status(), format).toBe(200);
        const h = res.headers();
        expect(h["content-type"]).toBe(type);
        expect(h["content-disposition"]).toMatch(new RegExp(`^attachment; filename="data-anggota-\\d{4}-\\d{2}-\\d{2}\\.${ext}"$`));
        expect(h["cache-control"]).toMatch(/no-store/);
        expect(h["x-content-type-options"]).toBe("nosniff");
        const bytes = await res.body();
        expect(Number(h["content-length"])).toBe(bytes.byteLength);
        if (format === "csv") expect(parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""))).toHaveLength(5); // header + 4 inactive
      }
      expect(logCount()).toBe(before + 3);
    } finally {
      await context.close();
    }
  });

  test("anonymous GET of the export URL: no file (401 from the proxy, review LOW 5), no log row", async ({ request }) => {
    const before = logCount();
    const res = await request.get(`${EXPORT_PATH}?format=csv`, { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-disposition"]).toBeUndefined();
    expect(logCount()).toBe(before);
  });

  test("MD-37: the exported bytes are not kept anywhere on the server (no export or storage route exists)", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      for (const path of ["/exports", "/exports/data-anggota.csv", "/api/exports", "/api/member-data", "/api/member-data/export/latest", "/storage", "/api/storage"]) {
        const res = await context.request.get(path, { maxRedirects: 0 });
        expect(res.status(), path).toBe(404);
      }
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("MD-02, MD-03, MD-05, MD-06: the export endpoint refuses everyone else and writes NO log row", () => {
  const refused: [PersonaKey, number, string][] = [
    ["kadep", 403, "Kepala Departemen (view only)"],
    ["kabiro", 403, "Kepala Biro (view only)"],
    ["admin", 403, "System Admin without a position"],
    ["regular", 403, "regular member"],
    ["pembina", 403, "lecturer"],
    ["inactive", 403, "deactivated member"],
    ["unlinked", 403, "no member row"],
    ["temppw", 403, "temporary password"],
  ];
  for (const [persona, status, label] of refused) {
    test(`${persona} (${label}): POST -> ${status} forbidden, no file, log unchanged`, async ({ browser }) => {
      const { context } = await signedInContext(browser, persona);
      try {
        const before = logCount();
        for (const format of ["csv", "xlsx", "pdf"]) {
          const res = await postExport(context, { format, status: "all" });
          expect(res.status(), `${persona} ${format}`).toBe(status);
          expect(await errorCodeOf(res)).toBe("forbidden");
          expect(res.headers()["content-disposition"]).toBeUndefined();
          expect(res.headers()["cache-control"]).toMatch(/no-store/);
          const text = await res.text();
          expect(text).toBe('{"error":{"code":"forbidden"}}');
          expect(text).not.toMatch(/Bulk|Test |@nexus/);
        }
        expect(logCount()).toBe(before);
      } finally {
        await context.close();
      }
    });
  }

  test("anonymous: 401 unauthenticated (not a redirect, not a file), log unchanged", async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: ORIGIN });
    try {
      const before = logCount();
      const res = await request.post(EXPORT_PATH, { form: { format: "csv" }, headers: { origin: ORIGIN }, maxRedirects: 0 });
      // The proxy leaves POSTs alone (AUTH-30): the handler itself answers.
      expect(res.status()).toBe(401);
      expect(await errorCodeOf(res)).toBe("unauthenticated");
      expect(logCount()).toBe(before);
    } finally {
      await request.dispose();
    }
  });

  test("Ketua Umum: cross-site, missing-Origin and malformed requests are refused and write nothing", async ({ browser }) => {
    const { context } = await signedInContext(browser, "ketum");
    try {
      const before = logCount();
      const csrf: Record<string, string>[] = [{}, { origin: "https://evil.example" }, { origin: "null" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }, { origin: "http://localhost:3000" }];
      for (const headers of csrf) {
        const res = await postExport(context, { format: "csv" }, headers);
        expect(res.status(), JSON.stringify(headers)).toBe(403);
      }
      const invalid: [Record<string, string>, string][] = [
        [{}, "format"],
        [{ format: "docx" }, "format"],
        [{ format: "csv", status: "Aktif" }, "status"],
        [{ format: "csv", unit: "x'; drop table nexus.member_data_export_logs;--" }, "unitId"],
        [{ format: "csv", unit: "11111111-1111-1111-1111-11111111111" }, "unitId"],
        [{ format: "csv", q: "a".repeat(121) }, "search"],
      ];
      for (const [form, field] of invalid) {
        const res = await postExport(context, form);
        expect(res.status(), JSON.stringify(form).slice(0, 80)).toBe(400);
        expect(await res.json()).toEqual({ error: { code: "invalid_input", field } });
      }
      const json = await context.request.post(EXPORT_PATH, { data: { format: "csv" }, headers: { origin: ORIGIN }, maxRedirects: 0 });
      expect(json.status()).toBe(400);
      const big = await context.request.post(EXPORT_PATH, { form: { format: "csv", q: "x".repeat(20_000) }, headers: { origin: ORIGIN }, maxRedirects: 0 });
      expect(big.status()).toBe(400);
      expect(logCount()).toBe(before);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Direct calls to the database through the public REST gateway with each persona's token (what a person with the
// publishable key and their own login could do from the browser console). RLS and function checks are the last layer.
// ---------------------------------------------------------------------------------------------
async function db(token: string | null, path: string, init: { method?: string; body?: unknown; profile?: string } = {}) {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json", "Accept-Profile": init.profile ?? "nexus", "Content-Profile": init.profile ?? "nexus" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: body as { code?: string; hint?: string; message?: string } & unknown[] };
}
const token = async (persona: PersonaKey) => (await getSession(persona)).accessToken;

const ROW_KEYS = new Set(["row_no", "member_id", "full_name", "member_type", "is_active", "unit_name", "parent_unit_name", "position_name", "unit_type", "total_count", "page", "page_size"]);
const FORBIDDEN_KEYS = /email|phone|nim|nip|user_id|access_level|must_change|deactivated|created_|updated_/i;

test.describe("MD-03, MD-05, MD-06, MD-10: database functions called directly with each persona's own token", () => {
  const denied: PersonaKey[] = ["regular", "pembina", "admin", "inactive", "unlinked", "temppw"];
  for (const persona of denied) {
    test(`${persona}: list, unit options, count and export are refused with 42501 (no rows, no log row)`, async () => {
      const t = await token(persona);
      const before = logCount();
      for (const [fn, body] of [
        ["member_data_list", {}],
        ["member_data_unit_options", {}],
        ["member_data_active_count", {}],
        ["member_data_export", { p_format: "csv" }],
      ] as const) {
        const res = await db(t, `rpc/${fn}`, { body });
        expect(res.status, `${persona} ${fn}`).toBe(403);
        expect(res.body.code, `${persona} ${fn}`).toBe("42501");
        expect(JSON.stringify(res.body)).not.toMatch(/Bulk|Test |@nexus/);
      }
      expect(logCount()).toBe(before);
    });
  }

  test("kadep and kabiro: list, options and count work; the export function refuses them and logs nothing (MD-02)", async () => {
    for (const persona of ["kadep", "kabiro"] as const) {
      const t = await token(persona);
      const list = await db(t, "rpc/member_data_list", { body: {} });
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(20);
      expect((await db(t, "rpc/member_data_unit_options", { body: {} })).status).toBe(200);
      const count = await db(t, "rpc/member_data_active_count", { body: {} });
      expect(count.body as unknown).toBe(45);
      const before = logCount();
      const exp = await db(t, "rpc/member_data_export", { body: { p_format: "csv" } });
      expect(exp.status).toBe(403);
      expect(exp.body.code).toBe("42501");
      const log = await db(t, "rpc/member_data_export_log_list", { body: {} });
      expect(log.status).toBe(403);
      expect(logCount()).toBe(before);
    }
  });

  test("MD-10: what Ketua Umum's list returns has only whitelisted columns and no identifier values; MD-38: count = list total", async () => {
    const t = await token("ketum");
    const res = await db(t, "rpc/member_data_list", { body: { p_page_size: 50 } });
    expect(res.status).toBe(200);
    const rows = res.body as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(45);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(ROW_KEYS.has(key), `column ${key}`).toBe(true);
        expect(key).not.toMatch(FORBIDDEN_KEYS);
      }
    }
    const text = JSON.stringify(rows);
    for (const s of secretValues()) expect(text).not.toContain(s);
    expect(rows[0].total_count).toBe(45);
    expect((await db(t, "rpc/member_data_active_count", { body: {} })).body as unknown).toBe(45);
    // The page size cannot be raised above the server maximum (MD-26): refused, not clamped
    const big = await db(t, "rpc/member_data_list", { body: { p_page_size: 51 } });
    expect(big.status).toBe(400);
    expect(big.body.hint).toBe("invalid_page_size");
    const zero = await db(t, "rpc/member_data_list", { body: { p_page: 0 } });
    expect(zero.status).toBe(400);
    // Searching an identifier finds nobody (MD-12), also at the function level
    for (const q of ["ketum@nexus.test", "123450005", "123451011"]) {
      const found = await db(t, "rpc/member_data_list", { body: { p_search: q, p_status: "all" } });
      expect(found.body, q).toEqual([]);
    }
    const tooLong = await db(t, "rpc/member_data_list", { body: { p_search: "a".repeat(121) } });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.hint).toBe("search_too_long");
  });

  test("anonymous (publishable key only, no token): every function is refused", async () => {
    for (const [fn, body] of [
      ["member_data_list", {}],
      ["member_data_unit_options", {}],
      ["member_data_active_count", {}],
      ["member_data_export", { p_format: "csv" }],
      ["member_data_export_log_list", {}],
    ] as const) {
      const res = await db(null, `rpc/${fn}`, { body });
      expect([401, 403], fn).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/Bulk|Test /);
    }
  });
});

test.describe("MD-33, MD-34, MD-32: the export log: nobody can write it, and only System Admin and BPH can read it", () => {
  test("direct INSERT, UPDATE, DELETE and SELECT on the log table are refused for every persona (also admin)", async () => {
    const before = logCount();
    const snapshot = sql("select md5(string_agg(l::text, '|' order by id)) from nexus.member_data_export_logs l");
    for (const persona of ["ketum", "admin", "kadep", "regular"] as const) {
      const t = await token(persona);
      const insert = await db(t, "member_data_export_logs", { method: "POST", body: { exporter_member_id: memberId("ketum@nexus.test"), format: "csv", filter_status: "all", search_used: false, period_id: activePeriodId() } });
      expect(insert.status, `${persona} insert`).toBeGreaterThanOrEqual(400);
      const update = await db(t, "member_data_export_logs?id=gt.0", { method: "PATCH", body: { format: "pdf", exporter_member_id: memberId("admin@nexus.test") } });
      expect(update.status === 200 && Array.isArray(update.body) && update.body.length > 0, `${persona} update touched rows`).toBe(false);
      expect(update.status, `${persona} update`).toBeGreaterThanOrEqual(400);
      const del = await db(t, "member_data_export_logs?id=gt.0", { method: "DELETE" });
      expect(del.status, `${persona} delete`).toBeGreaterThanOrEqual(400);
      const select = await db(t, "member_data_export_logs?select=*", { method: "GET" });
      expect(select.status === 200 && Array.isArray(select.body) && select.body.length > 0, `${persona} select returned rows`).toBe(false);
    }
    // Also through the other schema name and with no token
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await db(null, "member_data_export_logs?id=gt.0", { method, body: method === "DELETE" ? undefined : { format: "pdf" } });
      expect(res.status, method).toBeGreaterThanOrEqual(400);
    }
    expect(logCount()).toBe(before);
    expect(sql("select md5(string_agg(l::text, '|' order by id)) from nexus.member_data_export_logs l")).toBe(snapshot);
  });

  test("System Admin and BPH read the log through the function; department heads, members and lecturers do not", async ({ browser }) => {
    // Make sure there is at least one recent row from a known exporter
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, "?q=Dosen");
      await downloadExport(page, "CSV (.csv)");
    } finally {
      await context.close();
    }
    const total = logCount();
    for (const persona of ["admin", "ketum", "bendahara"] as const) {
      const res = await db(await token(persona), "rpc/member_data_export_log_list", { body: { p_page_size: 50 } });
      expect(res.status, persona).toBe(200);
      const rows = res.body as unknown as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].total_count).toBe(total);
      expect(rows[0]).toMatchObject({ exporter_name: "Test Ketua Umum", format: "csv", filter_status: "active", search_used: true, period_label: "2026/2027" });
      // Newest first
      const ids = rows.map((r) => r.log_id as number);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      for (const row of rows) for (const key of Object.keys(row)) expect(key).not.toMatch(/email|phone|nim|nip|user_id|access_level|search_text/i);
      const text = JSON.stringify(rows);
      for (const s of secretValues()) expect(text).not.toContain(s);
      expect(text).not.toContain("Dosen"); // the search text is never stored
    }
    for (const persona of ["kadep", "kabiro", "regular", "pembina"] as const) {
      const res = await db(await token(persona), "rpc/member_data_export_log_list", { body: {} });
      expect(res.status, persona).toBe(403);
      expect(res.body.code).toBe("42501");
    }
  });

  test("MD-36 / R22: the log row of an exporter who is deactivated afterwards stays, and still names them", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      await openList(page);
      const before = lastLogId();
      await downloadExport(page, "CSV (.csv)");
      const [row] = logRowsAfter(before);
      expect(row.exporter_member_id).toBe(memberId("bendahara@nexus.test"));
      const total = logCount();
      setActive("bendahara@nexus.test", false);
      expect(logCount()).toBe(total);
      const res = await db(await token("admin"), "rpc/member_data_export_log_list", { body: { p_page_size: 50 } });
      const entry = (res.body as unknown as { log_id: number; exporter_name: string | null }[]).find((r) => r.log_id === row.id);
      expect(entry, "the row is still listed").toBeDefined();
      expect(entry!.exporter_name).toBe("Test Bendahara Umum 1");
      // ... and the deactivated person can no longer export or read anything (L1)
      const refused = await postExport(context, { format: "csv" });
      expect(refused.status()).toBe(403);
      expect(logCount()).toBe(total);
    } finally {
      setActive("bendahara@nexus.test", true);
      await context.close();
    }
  });

  test("the page size of the log is capped and a bad page is refused", async () => {
    const t = await token("admin");
    expect((await db(t, "rpc/member_data_export_log_list", { body: { p_page_size: 51 } })).status).toBe(400);
    expect((await db(t, "rpc/member_data_export_log_list", { body: { p_page: 0 } })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("F5 step 5 and F6: errors during an export are readable, never raw JSON, and nothing is logged", () => {
  const cases: [number, string, string, string][] = [
    [403, '{"error":{"code":"forbidden"}}', "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", "forbidden"],
    [400, '{"error":{"code":"invalid_input","field":"status"}}', "Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi.", "invalid_input"],
    [503, '{"error":{"code":"unavailable"}}', "Terjadi gangguan. Coba lagi sebentar lagi.", "unavailable"],
    [502, "<html><body>Bad gateway</body></html>", "Terjadi gangguan. Coba lagi sebentar lagi.", "a proxy HTML error"],
    [500, "", "Terjadi gangguan. Coba lagi sebentar lagi.", "an empty 500"],
  ];
  for (const [status, body, text, label] of cases) {
    test(`${status} (${label}) -> "${text}"; the button works again afterwards`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        await openList(page);
        await page.route(`**${EXPORT_PATH}`, (route) => route.fulfill({ status, contentType: body.startsWith("{") ? "application/json" : "text/html", body }));
        const before = logCount();
        await exportButton(page).click();
        await page.getByRole("button", { name: "CSV (.csv)" }).click();
        await expect(main(page).getByRole("alert")).toHaveText(text);
        expect(await page.locator("body").innerText()).not.toMatch(/"error"|"code"|Bad gateway|unauthenticated/);
        await expect(exportButton(page)).toBeVisible(); // usable again
        await expect(main(page).getByText(/^Unduhan dimulai/)).toHaveCount(0);
        expect(logCount()).toBe(before);
      } finally {
        await context.close();
      }
    });
  }

  test("401 (session ended) -> login with the session notice and a way back to this list", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, "?status=all");
      await page.route(`**${EXPORT_PATH}`, (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"code":"unauthenticated"}}' }));
      // The session is really still valid here, so the proxy sends a signed-in visitor straight back (AUTH-32); what we
      // check is that the screen asked for the login page with the notice and the way back.
      const asked = page.waitForRequest((r) => /\/login\?reason=session_ended&next=%2Fdata-anggota%3Fstatus%3Dall/.test(r.url()));
      await exportButton(page).click();
      await page.getByRole("button", { name: "CSV (.csv)" }).click();
      await asked;
    } finally {
      await context.close();
    }
  });

  test("network failure -> 'Tidak bisa terhubung...' and no stuck busy state", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await page.route(`**${EXPORT_PATH}`, (route) => route.abort("connectionreset"));
      await exportButton(page).click();
      await page.getByRole("button", { name: "Excel (.xlsx)" }).click();
      await expect(main(page).getByRole("alert")).toHaveText("Tidak bisa terhubung. Periksa internetmu lalu coba lagi.");
      await expect(main(page).getByText("Menyiapkan file...")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("right lost while the page is open: the export is refused with 'Aksesmu sudah berubah', no file, no log row (F5.5, MD-07)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await expect(exportButton(page)).toBeVisible();
      const before = logCount();
      setActivePeriod("2025/2026"); // Ketua Umum holds no assignment in that period
      let downloaded = false;
      page.on("download", () => {
        downloaded = true;
      });
      await exportButton(page).click();
      await page.getByRole("button", { name: "CSV (.csv)" }).click();
      await expect(main(page).getByRole("alert")).toHaveText("Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.");
      expect(downloaded).toBe(false);
      expect(logCount()).toBe(before);
    } finally {
      setActivePeriod("2026/2027");
      await context.close();
    }
  });
});
