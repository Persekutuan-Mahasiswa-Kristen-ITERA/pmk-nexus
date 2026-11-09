// Data Anggota: tests that CHANGE local data and put it back in `finally` (global-setup/teardown also reset it):
// period switch (MD-07, MD-20, MD-39, F7), "gangguan" states (MD-28, MD-35, A-MD12), and awkward names (formula injection,
// very long, unicode, duplicates: R12, MD-10 safety). Local NEXUS stack only.
// Everything these tests add is named qa-tmp-*@nexus.test or sits in period 2025/2026; global-setup deletes leftovers.
import { expect, test, type Page } from "@playwright/test";
import { sql } from "../support/local-stack";
import { setActivePeriod, signedInContext } from "./helpers";
import {
  LIST_PATH,
  addPreviousPeriodOfficer,
  counterText,
  downloadExport,
  exportButton,
  expectTotal,
  hasPdftotext,
  lastLogId,
  logCount,
  logRowsAfter,
  main,
  memberCounts,
  namesOnPage,
  noHorizontalScroll,
  openList,
  pdfText,
  readCsv,
  removeAssignment,
  rowsOnPage,
  expectedNames,
  searchBox,
  tableRows,
  xlsxNames,
} from "./member-data-helpers";

// The inventory module is open to every active member once a period is active (D-021, baseline key inventory.view).
const INVENTORY_ITEM = "Manajemen & Inventaris";
const drawerLinks = (page: Page) => page.getByRole("dialog").getByRole("navigation", { name: "Menu utama" }).getByRole("link");
async function drawerItems(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Buka menu" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const items = await drawerLinks(page).allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return items.map((t) => t.trim());
}
const assignmentCount = (label: string) => Number(sql(`select count(*) from public.assignments where period_id = (select id from public.periods where label = '${label}')`));

// ---------------------------------------------------------------------------------------------
test.describe("MD-07, MD-20, F7: period switch changes access by itself; old assignments stay as history", () => {
  test("ketum loses the page and a previous-period-only officer (regular) gains it, on the next request and without logging out", async ({ browser }) => {
    test.setTimeout(240_000);
    const ketum = await signedInContext(browser, "ketum");
    const regular = await signedInContext(browser, "regular");
    let assignmentId: string | null = null;
    try {
      const { active } = memberCounts();
      // Before the switch
      await openList(ketum.page);
      await expectTotal(ketum.page, active);
      await expect(ketum.page.getByText("Periode 2026/2027").first()).toBeVisible();
      expect(await drawerItems(ketum.page)).toEqual(["Dashboard", "Data Anggota", INVENTORY_ITEM]);
      await regular.page.goto(LIST_PATH);
      await expect(regular.page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
      expect(await drawerItems(regular.page)).toEqual(["Dashboard", INVENTORY_ITEM]);

      // Previous period: member.regular was Kepala Departemen Operasional in 2025/2026 only (a seeded "officer of a previous period" would be
      // the same situation mirrored; ketum is the P-OLD of the NEW period here)
      const history2627 = assignmentCount("2026/2027");
      const history2526 = assignmentCount("2025/2026");
      assignmentId = addPreviousPeriodOfficer("member.regular@nexus.test");
      expect(assignmentCount("2025/2026")).toBe(history2526 + 1);

      setActivePeriod("2025/2026");

      // ketum: first request after the switch: no page, no drawer item, but still signed in (no logout, no deploy)
      await ketum.page.reload();
      await expect(ketum.page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
      await expect(ketum.page.getByRole("table")).toHaveCount(0);
      expect(await drawerItems(ketum.page)).toEqual(["Dashboard", INVENTORY_ITEM]);
      await ketum.page.getByRole("button", { name: "Buka menu" }).click();
      await expect(ketum.page.getByRole("dialog").getByText("Masuk sebagai Test Ketua Umum.")).toBeVisible();
      await expect(ketum.page.getByRole("dialog").getByText("Periode 2025/2026")).toBeVisible();
      await ketum.page.keyboard.press("Escape");
      // the export endpoint refuses ketum too, and nothing is logged
      const before = logCount();
      const refused = await ketum.context.request.post("/api/member-data/export", { form: { format: "csv" }, headers: { origin: "http://localhost:3100" } });
      expect(refused.status()).toBe(403);
      expect(logCount()).toBe(before);

      // regular: first request after the switch: the list opens (view only: Kepala Departemen, rule D32), no Ekspor
      await regular.page.goto(LIST_PATH);
      await expect(main(regular.page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
      await expect(regular.page.getByText("Periode 2025/2026").first()).toBeVisible();
      expect(await drawerItems(regular.page)).toEqual(["Dashboard", "Data Anggota", INVENTORY_ITEM]);
      await expect(exportButton(regular.page)).toHaveCount(0);
      await expectTotal(regular.page, active); // the member list itself does not depend on the period
      // MD-20: history never leaks. Only the previous-period officer shows a unit; everybody else (including ketum, Bulk 11) shows "-"
      await regular.page.goto(`${LIST_PATH}?q=Test+Ketua`);
      await expect(tableRows(regular.page).first().locator("td").nth(2)).toHaveText("-");
      await regular.page.goto(`${LIST_PATH}?q=Bulk+Anggota+11`);
      await expect(tableRows(regular.page).first().locator("td").nth(2)).toHaveText("-");
      await regular.page.goto(`${LIST_PATH}?q=Sandi+Sementara`);
      await expect(tableRows(regular.page).first().locator("td").nth(2)).toHaveText("-"); // Staff Desain in 2026/2027 only
      await regular.page.goto(`${LIST_PATH}?unit=${sql("select id from public.org_units where name='Departemen Operasional'")}`);
      // Operasional in the NEW active period (2025/2026) holds exactly what the database says: the previous-period officer
      // and anybody the seed assigned to 2025/2026 (derived, so seeding the current period never changes it)
      const opsThen = expectedNames({ unitName: "Departemen Operasional", periodLabel: "2025/2026" });
      expect(opsThen).toContain("Test Anggota Biasa"); // member.regular itself
      await expectTotal(regular.page, opsThen.length);
      const shown = await namesOnPage(regular.page);
      expect(shown).toEqual(opsThen.slice(0, 20));
      // MD-20: nobody who is in Operasional only in 2026/2027 shows up through the filter
      for (const name of expectedNames({ unitName: "Departemen Operasional", periodLabel: "2026/2027" })) {
        if (!opsThen.includes(name)) expect(shown, name).not.toContain(name);
      }
      const regularRow = tableRows(regular.page).filter({ hasText: "Test Anggota Biasa" });
      await expect(regularRow.locator("td").nth(2)).toContainText("Departemen Operasional");
      await expect(regularRow.locator("td").nth(2)).toContainText("Kepala Departemen");

      // Old data stays as history: the 2026/2027 assignments are untouched
      expect(assignmentCount("2026/2027")).toBe(history2627);

      // Switch back: ketum has it again on the next request, regular loses it, still no logout
      setActivePeriod("2026/2027");
      await ketum.page.reload();
      await expect(main(ketum.page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
      await expect(tableRows(ketum.page)).toHaveCount(rowsOnPage(active, 1));
      await expect(exportButton(ketum.page)).toBeVisible();
      expect(await drawerItems(ketum.page)).toEqual(["Dashboard", "Data Anggota", INVENTORY_ITEM]);
      await regular.page.goto(LIST_PATH);
      await expect(regular.page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
      await ketum.page.goto(`${LIST_PATH}?q=Test+Ketua`);
      await expect(tableRows(ketum.page).first().locator("td").nth(2)).toContainText("BPH PMK ITERA");
    } finally {
      setActivePeriod("2026/2027");
      if (assignmentId) removeAssignment(assignmentId);
      await ketum.context.close();
      await regular.context.close();
    }
  });

  test("MD-39 / R13: with NO active period nobody holds the page; the screen says 'Belum ada periode aktif.'", async ({ browser }) => {
    const ketum = await signedInContext(browser, "ketum");
    const admin = await signedInContext(browser, "admin");
    try {
      const { active } = memberCounts();
      await openList(ketum.page);
      await expectTotal(ketum.page, active);
      setActivePeriod(null);
      for (const { page } of [ketum, admin]) {
        await page.goto(LIST_PATH);
        await expect(page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
        await expect(page.getByText("Belum ada periode aktif.").first()).toBeVisible();
        await expect(page.getByRole("table")).toHaveCount(0);
        expect(await drawerItems(page)).toEqual(["Dashboard", INVENTORY_ITEM]);
      }
      const res = await ketum.context.request.post("/api/member-data/export", { form: { format: "csv" }, headers: { origin: "http://localhost:3100" } });
      expect(res.status()).toBe(403);
      setActivePeriod("2026/2027");
      await ketum.page.goto(LIST_PATH);
      await expectTotal(ketum.page, active);
    } finally {
      setActivePeriod("2026/2027");
      await ketum.context.close();
      await admin.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("MD-28, MD-35, A-MD12: when the database part fails the screen says 'gangguan', stays signed in, and exports fail closed", () => {
  const LIST_FN = "nexus.member_data_list(text, uuid, text, integer, integer)";
  const OPTIONS_FN = "nexus.member_data_unit_options()";
  const EXPORT_FN = "nexus.member_data_export(text, text, uuid, text)";
  const revoke = (fn: string) => sql(`revoke execute on function ${fn} from authenticated`);
  const grant = (fn: string) => sql(`grant execute on function ${fn} to authenticated`);

  for (const [label, fn] of [["member_data_list", LIST_FN], ["member_data_unit_options", OPTIONS_FN]] as const) {
    test(`${label} not answering: 'Terjadi gangguan', not 'no access', no sign-out; 'Coba lagi' recovers`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        const { active } = memberCounts();
        await openList(page);
        await expectTotal(page, active);
        revoke(fn);
        await page.reload();
        await expect(main(page).getByRole("alert")).toHaveText("Terjadi gangguan. Coba lagi sebentar lagi.");
        await expect(page.getByText("Tidak punya akses")).toHaveCount(0);
        await expect(page.getByText("Belum ada akses")).toHaveCount(0);
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(main(page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
        expect((await context.cookies()).filter((c) => /^sb-/.test(c.name)).length).toBeGreaterThan(0); // still signed in (AR10)
        expect(await noHorizontalScroll(page)).toBe(true);
        // The error screen leaks nothing technical
        const text = await page.locator("body").innerText();
        expect(text).not.toMatch(/42501|permission denied|PGRST|nexus\.|function|rpc/i);
        // The drawer still works and the Dashboard is reachable
        await expect(page.getByRole("button", { name: "Buka menu" })).toBeVisible();

        // Retry while still broken: same state
        await main(page).getByRole("button", { name: "Coba lagi" }).click();
        await expect(main(page).getByRole("alert")).toHaveText("Terjadi gangguan. Coba lagi sebentar lagi.");

        grant(fn);
        await main(page).getByRole("button", { name: "Coba lagi" }).click();
        await expectTotal(page, active);
        await expect(main(page).getByRole("alert")).toHaveCount(0);
      } finally {
        grant(fn);
        await context.close();
      }
    });
  }

  test("the export function failing: 'gangguan' message, no file, no log row; then it works again", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      let downloaded = false;
      page.on("download", () => (downloaded = true));
      const before = logCount();
      revoke(EXPORT_FN);
      await exportButton(page).click();
      await page.getByRole("button", { name: "PDF (.pdf)" }).click();
      await expect(main(page).getByRole("alert")).toHaveText("Terjadi gangguan. Coba lagi sebentar lagi.");
      expect(downloaded).toBe(false);
      expect(logCount()).toBe(before);
      grant(EXPORT_FN);
      const csv = await downloadExport(page, "CSV (.csv)");
      expect(readCsv(csv.path).rows).toHaveLength(memberCounts().active);
      expect(logCount()).toBe(before + 1);
    } finally {
      grant(EXPORT_FN);
      await context.close();
    }
  });

  test("MD-35: if the LOG ROW cannot be written, no file is returned and nothing is logged (fail closed)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      const before = logCount();
      // A CHECK that no new row can satisfy: the INSERT inside member_data_export() then fails and the whole call rolls back.
      sql("alter table nexus.member_data_export_logs add constraint qa_block_log_write check (false) not valid");
      let downloaded = false;
      page.on("download", () => (downloaded = true));
      for (const format of ["CSV (.csv)", "Excel (.xlsx)", "PDF (.pdf)"] as const) {
        await exportButton(page).click();
        await page.getByRole("button", { name: format }).click();
        await expect(main(page).getByRole("alert")).toHaveText("Terjadi gangguan. Coba lagi sebentar lagi.");
        await expect(main(page).getByText("Menyiapkan file...")).toHaveCount(0);
      }
      expect(downloaded).toBe(false);
      expect(logCount()).toBe(before);

      // Direct POST: 503 and codes only, no database text
      const res = await context.request.post("/api/member-data/export", { form: { format: "csv" }, headers: { origin: "http://localhost:3100" } });
      expect(res.status()).toBe(503);
      expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
      expect(res.headers()["content-disposition"]).toBeUndefined();
    } finally {
      sql("alter table nexus.member_data_export_logs drop constraint if exists qa_block_log_write");
      await context.close();
    }
    // And it works again afterwards
    const again = await signedInContext(browser, "ketum");
    try {
      await openList(again.page);
      const before = logCount();
      await downloadExport(again.page, "CSV (.csv)");
      expect(logCount()).toBe(before + 1);
    } finally {
      await again.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("R12, MD-10 safety, very long and unusual names (temporary members qa-tmp-*@nexus.test)", () => {
  const LONG_WORD = "Wxyz".repeat(30); // 120 characters, no space: the PI-CORE maximum, cannot wrap at a space
  const names = [
    '=HYPERLINK("http://evil.example/x","Klik")', // formula + quotes + comma
    "+62 Plus Awal",
    "-Minus Awal",
    "@Mention Awal",
    LONG_WORD,
    "Ñandú Ünïcode 日本語 😀",
    "Qa Kembar Nama", // duplicate names (R12)
    "Qa Kembar Nama",
    "Qa Koma, Tanda \"Kutip\" Nama",
  ];
  const insert = () => {
    names.forEach((name, i) => sql(`insert into public.members(full_name, email) values ($q$${name}$q$, 'qa-tmp-${i + 1}@nexus.test')`));
  };
  const cleanup = () => sql("delete from public.members where email like 'qa-tmp-%@nexus.test'");

  test("list: all shown (duplicates twice), nothing runs, 390 px never scrolls sideways; search finds them", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "ketum");
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    try {
      const { active } = memberCounts(); // before the temporary members exist
      insert();
      await openList(page);
      await expectTotal(page, active + names.length);
      // Duplicates: two rows with the same name (R12)
      await searchBox(page).fill("Qa Kembar Nama");
      await expectTotal(page, 2);
      expect(await namesOnPage(page)).toEqual(["Qa Kembar Nama", "Qa Kembar Nama"]);
      // Names that look like formulas are plain text on screen
      await openList(page, `?q=${encodeURIComponent("=HYPERLINK")}`);
      await expectTotal(page, 1);
      await expect(tableRows(page).first()).toContainText('=HYPERLINK("http://evil.example/x","Klik")');
      await expect(page.locator("a[href*='evil.example']")).toHaveCount(0);
      // Unicode and the 120-character word. Case-insensitive also beyond ASCII (an accented capital typed in lower case).
      await openList(page, `?q=${encodeURIComponent("日本語")}`);
      await expectTotal(page, 1);
      await openList(page, `?q=${encodeURIComponent("ñandú ünï")}`);
      await expectTotal(page, 1);
      await expect(tableRows(page).first()).toContainText("Ñandú Ünïcode");
      await openList(page, `?q=${LONG_WORD}`);
      await expectTotal(page, 1);
      for (const url of [`?q=${LONG_WORD}`, `?status=all&q=Wxyz`, ""]) {
        await openList(page, url);
        await expect(counterText(page)).toBeVisible();
        expect(await noHorizontalScroll(page), `no sideways scroll at ${url || "default"}`).toBe(true);
      }
      // The long word wraps inside its cell: the cell does not stick out of the table box
      await openList(page, `?q=${LONG_WORD}`);
      const cell = tableRows(page).first().locator("td").nth(1);
      const table = main(page).locator("table");
      const [c, t] = await Promise.all([cell.boundingBox(), table.boundingBox()]);
      expect(c!.x + c!.width).toBeLessThanOrEqual(t!.x + t!.width + 1);
      expect(c!.height).toBeGreaterThan(40); // it wrapped onto several lines
      const wrapperScrolls = await table.locator("xpath=..").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(wrapperScrolls, "the table box scrolls sideways for a long unbroken name").toBe(false);
      expect(dialogs).toEqual([]);
    } finally {
      cleanup();
      await context.close();
    }
  });

  test("export: CSV neutralizes formulas and quotes correctly; Excel keeps them as text; PDF renders; all hold every temporary member", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { all } = memberCounts(); // before the temporary members exist
      insert();
      // All the temporary members share no word; use status all + a search that hits each: the e-mail is not searchable, so
      // export the whole list and pick the rows out.
      await openList(page, "?status=all");
      await expectTotal(page, all + names.length);
      const before = lastLogId();

      const csv = await downloadExport(page, "CSV (.csv)");
      const file = readCsv(csv.path);
      expect(file.rows).toHaveLength(all + names.length);
      const cells = file.rows.map((r) => r[1]);
      // Formula-looking names get an apostrophe prefix in CSV; others are written as they are
      expect(cells).toContain(`'=HYPERLINK("http://evil.example/x","Klik")`);
      expect(cells).toContain("'+62 Plus Awal");
      expect(cells).toContain("'-Minus Awal");
      expect(cells).toContain("'@Mention Awal");
      expect(cells).toContain(LONG_WORD);
      expect(cells).toContain("Ñandú Ünïcode 日本語 😀");
      expect(cells.filter((c) => c === "Qa Kembar Nama")).toHaveLength(2);
      expect(cells).toContain('Qa Koma, Tanda "Kutip" Nama');
      // No cell of the whole file starts with a formula character (the "-" placeholder excepted)
      for (const row of file.rows) for (const cell of row) expect(cell, JSON.stringify(row)).not.toMatch(/^[=+\-@\t\r]./);
      // Raw text: the comma and quote name is quoted, the formula is quoted because it has quotes and a comma
      expect(file.raw).toContain(`"Qa Koma, Tanda ""Kutip"" Nama"`);
      expect(file.raw).toContain(`"'=HYPERLINK(""http://evil.example/x"",""Klik"")"`);

      const xlsx = await downloadExport(page, "Excel (.xlsx)");
      const book = xlsxNames(xlsx.path);
      expect(book.names).toHaveLength(all + names.length);
      for (const name of names) expect(book.names).toContain(name); // exact text, stored as text
      expect(book.xml).not.toMatch(/<f[ >\/]/);

      const pdf = await downloadExport(page, "PDF (.pdf)");
      if (hasPdftotext) {
        const text = pdfText(pdf.path);
        expect(text).toContain("Ñandú Ünïcode");
        expect(text).toContain("+62 Plus Awal");
        expect(text).toMatch(/Halaman \d+ dari \d+/);
        // The 120-character word is cut across lines but never lost: removing whitespace restores it
        expect(pdfText(pdf.path, false).replace(/\s+/g, "")).toContain(LONG_WORD);
      }
      expect(logRowsAfter(before)).toHaveLength(3);
    } finally {
      cleanup();
      await context.close();
    }
  });
});
