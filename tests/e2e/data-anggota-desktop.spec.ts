// Data Anggota on a 1280 px desktop (project "desktop", matched by the file name): layout, keyboard-only use, focus visibility.
// MD-40 is about 390 px; this keeps the wide layout and the keyboard path honest. Read-only except one export.
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  LIST_PATH,
  counterText,
  exportButton,
  expectedNames,
  expectTotal,
  logCount,
  main,
  memberCounts,
  noHorizontalScroll,
  openList,
  pagesFor,
  readCsv,
  rowsOnPage,
  searchBox,
  statusSelect,
  tableRows,
  unitSelect,
} from "./member-data-helpers";

test.describe("desktop 1280 px", () => {
  test("wide layout: centred column, whole table visible, numbered pager, no sideways scroll", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      expect(page.viewportSize()?.width).toBe(1280);
      const { active } = memberCounts();
      expect(pagesFor(active), "the numbered pager needs at least 3 pages").toBeGreaterThanOrEqual(3);
      await openList(page);
      await expectTotal(page, active);
      expect(await noHorizontalScroll(page)).toBe(true);
      const box = await main(page).locator("table").boundingBox();
      expect(box!.width).toBeLessThanOrEqual(768 + 2); // md:max-w-3xl
      expect(box!.x).toBeGreaterThan(100); // centred, not stuck to the left edge
      const scroller = main(page).locator("table").locator("xpath=..");
      expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      // The wide pager shows neighbours as numbered links (and the phone one is hidden)
      const pager = page.getByRole("navigation", { name: "Halaman daftar anggota" });
      await expect(pager.getByRole("link", { name: "Halaman 2" }).locator("visible=true")).toHaveCount(1);
      await expect(pager.getByRole("link", { name: "Halaman 3" }).locator("visible=true")).toHaveCount(1);
      await expect(page.getByRole("columnheader")).toHaveText(["No", "Nama Lengkap", "Unit / Jabatan", "Status"]);
      await expect(tableRows(page)).toHaveCount(rowsOnPage(active, 1));
      // The drawer is the same light drawer on desktop
      await page.getByRole("button", { name: "Buka menu" }).click();
      await expect(page.getByRole("dialog").getByRole("link", { name: "Data Anggota" })).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } finally {
      await context.close();
    }
  });

  test("keyboard only: search with Enter, filters with the keyboard, export with Enter, visible focus everywhere", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await searchBox(page).focus();
      await page.keyboard.type("Bulk Anggota 1");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/q=Bulk\+Anggota\+1$/);
      const bulk1 = expectedNames({ search: "Bulk Anggota 1" }); // Bulk 10..19 today, all active
      expect(bulk1.length, "this search must fit one page so no pager sits between the controls").toBeLessThanOrEqual(20);
      await expectTotal(page, bulk1.length);

      // Tab through the controls: every stop shows a focus ring (outline or box-shadow), none is lost
      await searchBox(page).focus();
      const stops: string[] = [];
      for (let i = 0; i < 4; i++) { // Reset, Unit, Status, Ekspor (10 results = one page, so no pager)
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== "");
          const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 25) ?? el.tagName;
          return { ring, label: `${el.tagName}:${label}` };
        });
        expect(info, `Tab ${i + 1}`).not.toBeNull();
        expect(info!.ring, `focus ring on ${info!.label}`).toBe(true);
        stops.push(info!.label);
      }
      expect(stops.map((s) => s.split(":")[0])).toEqual(["A", "SELECT", "SELECT", "SUMMARY"]);
      expect(stops[0]).toContain("Reset");
      expect(stops[3]).toContain("Ekspor");

      // Selects by keyboard
      await openList(page);
      await statusSelect(page).focus();
      await page.keyboard.press("ArrowDown"); // Aktif -> Nonaktif
      await expect(page).toHaveURL(/status=inactive/);
      await expectTotal(page, memberCounts().inactive);
      await unitSelect(page).focus();
      await page.keyboard.press("ArrowDown");
      await expect(page).toHaveURL(/unit=/);

      // Export by keyboard: Enter opens the menu, Tab to a format, Enter downloads
      await openList(page);
      const before = logCount();
      await exportButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "CSV (.csv)" })).toBeVisible();
      await page.keyboard.press("Tab"); // Excel
      await page.keyboard.press("Tab"); // CSV
      await expect(page.getByRole("button", { name: "CSV (.csv)" })).toBeFocused();
      const download = page.waitForEvent("download");
      await page.keyboard.press("Enter");
      const d = await download;
      expect(d.suggestedFilename()).toMatch(/^data-anggota-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(readCsv((await d.path())!).rows).toHaveLength(memberCounts().active);
      expect(logCount()).toBe(before + 1);
    } finally {
      await context.close();
    }
  });

  test("kadep on desktop: list yes, no Ekspor", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "kadep");
    try {
      await page.goto(LIST_PATH);
      await expect(counterText(page)).toBeVisible();
      await expect(exportButton(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

