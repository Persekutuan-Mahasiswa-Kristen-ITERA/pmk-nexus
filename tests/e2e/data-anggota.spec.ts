// Data Anggota (Member Data) on a 390 px phone: access per persona, drawer, list, filters, content, privacy, layout, drawer a11y.
// Spec: docs/modules/member-data.md. Criteria in the titles: MD-01 .. MD-28, MD-40, D-021.
// Personas: docs/ops/local-setup.md section 3. Seed counts are NOT hard-coded: every number comes from the local database at test time
// (member-data-helpers.ts: memberCounts, expectedNames, counterLabel...), so adding seed members cannot break these tests.
// This file only READS data. Specs that change data: data-anggota-period.spec.ts. Exports: data-anggota-export.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { sql } from "../support/local-stack";
import { PERSONAS, signedInContext, type PersonaKey } from "./helpers";
import {
  LIST_PATH,
  counterLabel,
  counterText,
  countMembers,
  expectedNames,
  memberCounts,
  pagesFor,
  rowsOnPage,
  exportButton,
  main,
  namesOnPage,
  noHorizontalScroll,
  numbersOnPage,
  openList,
  resultBox,
  searchBox,
  secretValues,
  statusSelect,
  expectTotal,
  tableRows,
  unitId,
  unitOptionNames,
  unitSelect,
} from "./member-data-helpers";

const allNames = () => sql("select full_name from public.members").split("\n").filter(Boolean);

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "Buka menu" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
// The inventory module is open to every active member once a period is active (D-021, baseline key inventory.view).
const INVENTORY_ITEM = "Manajemen & Inventaris";
const drawerLinks = (page: Page) => page.getByRole("dialog").getByRole("navigation", { name: "Menu utama" }).getByRole("link");

// ---------------------------------------------------------------------------------------------
test.describe("MD-01, MD-02, MD-04: personas that may view (drawer item, list, export button)", () => {
  const cases: [PersonaKey, string, boolean][] = [
    ["ketum", "BPH, Ketua Umum", true],
    ["bendahara", "BPH, Bendahara Umum 1", true],
    ["kadep", "Kepala Departemen Operasional (rule D32)", false],
    ["kabiro", "Kepala Biro Kewirausahaan (rule D32)", false],
  ];
  for (const [persona, label, canExport] of cases) {
    test(`${persona} (${label}): drawer shows Data Anggota, list opens with every active member, Ekspor ${canExport ? "visible" : "absent"}`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        await openDrawer(page);
        await expect(drawerLinks(page)).toHaveText(["Dashboard", "Data Anggota", INVENTORY_ITEM]);
        await page.getByRole("dialog").getByRole("link", { name: "Data Anggota" }).click();
        await expect(page).toHaveURL(/\/data-anggota$/);
        await expect(page.getByRole("dialog")).toHaveCount(0); // the drawer closes after navigating
        await expect(page.getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
        await expect(page.getByText("Periode 2026/2027").first()).toBeVisible();
        const { active } = memberCounts();
        await expectTotal(page, active);
        await expect(tableRows(page)).toHaveCount(rowsOnPage(active, 1));
        if (canExport) await expect(exportButton(page)).toBeVisible();
        else {
          await expect(exportButton(page)).toHaveCount(0);
          await expect(page.getByText(/^Ekspor/)).toHaveCount(0);
          await expect(page.getByRole("button", { name: /Excel|CSV|PDF/ })).toHaveCount(0);
          await expect(page.locator("form[action='/api/member-data/export']")).toHaveCount(0); // no hidden form either
        }
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("MD-03, MD-05: personas without Member Data view: no drawer item, forbidden screen, no member names anywhere in the HTML", () => {
  const cases: [PersonaKey, string][] = [
    ["admin", "System Admin without a position (P-ADMIN)"],
    ["regular", "regular member, Staff in IT (P-STAFF)"],
    ["pembina", "lecturer (P-LECT)"],
  ];
  for (const [persona, label] of cases) {
    test(`${persona} (${label})`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        await openDrawer(page);
        await expect(drawerLinks(page)).toHaveText(["Dashboard", INVENTORY_ITEM]); // absent, not greyed out (D-021)
        await expect(page.getByRole("dialog").getByText("Data Anggota")).toHaveCount(0);
        await page.keyboard.press("Escape");

        // Direct link: the shared "no permission" screen, session kept, not the No-access screen
        const res = await page.goto(LIST_PATH);
        expect(res?.status()).toBe(200);
        await expect(page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
        await expect(page.getByText("Kamu tidak punya akses ke halaman ini. Kalau kamu memerlukannya, hubungi admin PMK ITERA.")).toBeVisible();
        await expect(page.getByRole("link", { name: "Kembali ke Dashboard" })).toBeVisible();
        await expect(page.getByText("Belum ada akses")).toHaveCount(0);
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(searchBox(page)).toHaveCount(0);
        await expect(page).toHaveTitle(/Tidak punya akses/);
        await page.getByRole("link", { name: "Kembali ke Dashboard" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

        // The raw HTML (including the streamed RSC payload) holds no other member's name, no marker, no number
        const html = await (await context.request.get(LIST_PATH)).text();
        const own = sql(`select full_name from public.members where email = '${PERSONAS[persona].email}'`);
        const leaks = allNames().filter((n) => n !== own && html.includes(n));
        expect(leaks).toEqual([]);
        expect(html).not.toMatch(/Bulk Anggota|Pembina<|member_data_list|"fullName"|"memberId"/);
        expect(html).not.toContain("@nexus.test");
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("MD-05, MD-06: gate screens win over the page (no data, no names)", () => {
  const cases: [PersonaKey, string, string][] = [
    ["inactive", "Belum ada akses", "deactivated member (is_active = false) (P-INACTIVE)"],
    ["unlinked", "Belum ada akses", "account with no member row (P-UNLINKED)"],
    ["temppw", "Ganti kata sandi dulu", "member with a temporary password"],
  ];
  for (const [persona, heading, label] of cases) {
    test(`${persona} (${label}): direct URL shows '${heading}'`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, persona, { fresh: true });
      try {
        await page.goto(LIST_PATH);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(page.getByText("Data Anggota", { exact: true })).toHaveCount(0);
        const html = await (await context.request.get(LIST_PATH)).text();
        expect(allNames().filter((n) => html.includes(n))).toEqual([]);
        expect(html).not.toMatch(/Bulk Anggota/);
      } finally {
        await context.close();
      }
    });
  }

  test("anonymous: redirected to /login with next; raw request gets a redirect with no member data", async ({ page, request }) => {
    await page.goto(LIST_PATH);
    await expect(page).toHaveURL(/\/login\?next=%2Fdata-anggota$/);
    const res = await request.get(LIST_PATH, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/login\?next=%2Fdata-anggota$/);
    const body = await res.text();
    expect(allNames().filter((n) => body.includes(n))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("List as Ketua Umum: pagination, counter, order (MD-15, MD-23, MD-26, MD-27)", () => {
  test("default view: Aktif, every active member, counter, 20 rows per full page, running numbers, Prev/Next states", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { active } = memberCounts();
      const pages = pagesFor(active);
      expect(pages, "the seed must have at least 3 pages of active members for the pager test").toBeGreaterThanOrEqual(3);
      await openList(page);
      await expectTotal(page, active);
      await expect(resultBox(page)).toHaveText(new RegExp(`Hasil\\s*${active}\\s*anggota`));
      await expect(counterText(page)).toHaveText(counterLabel(active, 1));
      await expect(statusSelect(page)).toHaveValue("active");
      await expect(unitSelect(page)).toHaveValue("");
      await expect(tableRows(page)).toHaveCount(rowsOnPage(active, 1));
      expect(await numbersOnPage(page)).toEqual(Array.from({ length: rowsOnPage(active, 1) }, (_, i) => i + 1));

      const pager = page.getByRole("navigation", { name: "Halaman daftar anggota" });
      // Page 1: Prev is disabled (not a link), Next is a link; the current page is marked
      await expect(pager.locator("[aria-disabled='true']")).toHaveCount(1);
      await expect(pager.locator("[aria-disabled='true']")).toHaveText("Prev");
      await expect(pager.getByRole("link", { name: "Halaman berikutnya" })).toBeVisible();
      await expect(pager.getByRole("link", { name: "Halaman sebelumnya" })).toHaveCount(0);
      await expect(pager.locator("[aria-current='page']:visible")).toHaveText(/1/); // the phone and the wide list of numbers both exist; one is hidden

      // Forward through every page: counter, row count and running numbers of each
      for (let n = 2; n <= pages; n++) {
        await pager.getByRole("link", { name: "Halaman berikutnya" }).click();
        await expect(page).toHaveURL(new RegExp(`\\?page=${n}$`));
        await expect(counterText(page)).toHaveText(counterLabel(active, n));
        await expect(tableRows(page)).toHaveCount(rowsOnPage(active, n));
        expect(await numbersOnPage(page)).toEqual(Array.from({ length: rowsOnPage(active, n) }, (_, i) => (n - 1) * 20 + i + 1));
        await expect(pager.getByRole("link", { name: "Halaman sebelumnya" })).toBeVisible();
        if (n < pages) await expect(pager.getByRole("link", { name: "Halaman berikutnya" })).toBeVisible();
      }
      // Last page: Next is disabled
      await expect(pager.locator("[aria-disabled='true']")).toHaveText("Next");
      await expect(pager.getByRole("link", { name: "Halaman berikutnya" })).toHaveCount(0);

      // Back to page 1
      for (let n = pages - 1; n >= 1; n--) {
        await pager.getByRole("link", { name: "Halaman sebelumnya" }).click();
        await expect(counterText(page)).toHaveText(counterLabel(active, n));
      }
    } finally {
      await context.close();
    }
  });

  test("MD-27 / MD-15: across all pages every member appears exactly once, A-Z, case-insensitive, exactly the database's order", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { active } = memberCounts();
      const seen: string[] = [];
      for (let n = 1; n <= pagesFor(active); n++) {
        await openList(page, n === 1 ? "" : `?page=${n}`);
        await expect(counterText(page)).toBeVisible();
        seen.push(...(await namesOnPage(page)));
      }
      expect(seen).toHaveLength(active);
      expect(new Set(seen).size).toBe(active);
      const sorted = [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en"));
      expect(seen).toEqual(sorted);
      // Exactly the active members of PI-CORE, in the order of the database oracle (case-insensitive A-Z, then id)
      expect(seen).toEqual(expectedNames({ status: "active" }));
    } finally {
      await context.close();
    }
  });

  test("a page beyond the last shows the last page; a bad or huge page number is page 1 or last; the page size cannot be raised (MD-26)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { active } = memberCounts();
      const last = pagesFor(active);
      await openList(page, "?page=999");
      await expect(counterText(page)).toHaveText(counterLabel(active, last));
      await openList(page, "?page=999999999999");
      await expect(counterText(page)).toHaveText(counterLabel(active, 1)); // not a plain 9-digit number: page 1
      for (const bad of ["?page=0", "?page=-3", "?page=abc", "?page=1e3", "?page=2.5", "?page="]) {
        await openList(page, bad);
        await expect(counterText(page), bad).toHaveText(counterLabel(active, 1));
      }
      for (const size of ["?pageSize=500", "?page_size=500&limit=500", "?pageSize=1"]) {
        await openList(page, size);
        await expect(tableRows(page), size).toHaveCount(rowsOnPage(active, 1));
        await expect(counterText(page), size).toHaveText(counterLabel(active, 1));
      }
    } finally {
      await context.close();
    }
  });
});

test.describe("Search, filters, reset, Back (MD-12, MD-21, MD-22, MD-23, MD-25)", () => {
  test("search by part of a name, case-insensitive, over all pages; combines with filters; resets to page 1", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { active } = memberCounts();
      const last = pagesFor(active);
      await openList(page, `?page=${last}`);
      await expect(counterText(page)).toHaveText(counterLabel(active, last));

      await searchBox(page).fill("bulk anggota 11");
      await expect(page).toHaveURL(/\?q=bulk\+anggota\+11$/); // page reset to 1, search in the address
      const bulk11 = expectedNames({ search: "bulk anggota 11" });
      expect(bulk11).toContain("Bulk Anggota 11");
      await expectTotal(page, bulk11.length);
      await expect(namesOnPage(page)).resolves.toEqual(bulk11.slice(0, 20));

      // part of a name, mixed case, extra spaces; must match names across pages: every active "anggota" (Bulk and Test)
      await searchBox(page).fill("  ANGGOTA   ");
      const anggota = expectedNames({ search: "anggota" });
      await expectTotal(page, anggota.length);
      await expect(tableRows(page)).toHaveCount(rowsOnPage(anggota.length, 1));
      await expect(counterText(page)).toHaveText(counterLabel(anggota.length, 1));

      // Combine with unit (AND): the Bulk members who belong to Operasional or one of its divisions
      await unitSelect(page).selectOption({ label: "Departemen Operasional" });
      await expect(page).toHaveURL(/unit=/);
      await searchBox(page).fill("bulk");
      const bulkOps = expectedNames({ search: "bulk", unitName: "Departemen Operasional" });
      expect(bulkOps).toEqual(expect.arrayContaining(["Bulk Anggota 11", "Bulk Anggota 23", "Bulk Anggota 39"])); // seed facts (R6)
      await expectTotal(page, bulkOps.length);
      await expect(namesOnPage(page)).resolves.toEqual(bulkOps.slice(0, 20));
    } finally {
      await context.close();
    }
  });

  test("pressing Enter searches at once; a search text that matches the middle of a name works", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await searchBox(page).fill("Ketua");
      await searchBox(page).press("Enter");
      await expectTotal(page, 1);
      await expect(namesOnPage(page)).resolves.toEqual(["Test Ketua Umum"]);
    } finally {
      await context.close();
    }
  });

  test("no-result state with Hapus pencarian / Reset; clearing brings the list back", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await searchBox(page).fill("zzzz tidak ada");
      await expectTotal(page, 0);
      await expect(main(page).getByText("Tidak ada anggota yang cocok. Ubah pencarian atau filter.")).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(exportButton(page)).toHaveCount(0); // nothing to export
      await expect(page.getByRole("navigation", { name: "Halaman daftar anggota" })).toHaveCount(0);
      await expect(counterText(page)).toHaveCount(0);
      const { active } = memberCounts();
      await page.getByRole("link", { name: "Hapus pencarian" }).click();
      await expectTotal(page, active);
      await expect(searchBox(page)).toHaveValue("");

      await searchBox(page).fill("zzzz tidak ada");
      await expectTotal(page, 0);
      await main(page).getByRole("link", { name: "Reset" }).last().click();
      await expectTotal(page, active);
      await expect(page).toHaveURL(/\/data-anggota$/);

      // Typing and deleting again empties the search without a stuck state
      await searchBox(page).fill("Bulk");
      await expectTotal(page, expectedNames({ search: "bulk" }).length);
      await searchBox(page).fill("");
      await expectTotal(page, active);
    } finally {
      await context.close();
    }
  });

  test("MD-12: searching a seeded email, NIM, phone or NIP-like value finds nobody", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const values = [...secretValues().slice(0, 6), "ketum@nexus.test", "nexus.test", "123450005", "123451", "08123456789", "+62812345678"];
      for (const value of values) {
        await openList(page, `?q=${encodeURIComponent(value)}&status=all`);
        await expectTotal(page, 0);
      }
    } finally {
      await context.close();
    }
  });

  test("special characters are plain text: % and _ are not wildcards, quotes and tags do nothing", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const dialogs: string[] = [];
      page.on("dialog", (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      const allBefore = memberCounts().all;
      for (const q of ["%", "_", "%%", "\\", "'", '"', "'; drop table members;--", "<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "名前", "😀"]) {
        await openList(page, `?q=${encodeURIComponent(q)}&status=all`);
        await expectTotal(page, 0);
        await expect(page.locator("img[src='x']")).toHaveCount(0);
      }
      expect(dialogs).toEqual([]);
      expect(countMembers("true")).toBe(allBefore); // still there
    } finally {
      await context.close();
    }
  });

  test("a search of only spaces is no search (no error, full list); spaces inside a name are collapsed", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, "?q=%20%20%20");
      await expectTotal(page, memberCounts().active);
      await expect(main(page).getByRole("alert")).toHaveCount(0);
      await openList(page, `?q=${encodeURIComponent("  bulk     anggota   11  ")}`);
      await expectTotal(page, expectedNames({ search: "bulk anggota 11" }).length);
    } finally {
      await context.close();
    }
  });

  test("MD-21 unit filter options equal the PI-CORE units; Departemen Operasional returns exactly its people (derived), including Bulk Anggota 11 (R6)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      const options = (await unitSelect(page).locator("option").allInnerTexts()).map((t) => t.trim());
      expect(options).toEqual(["Semua unit", ...unitOptionNames()]);
      expect(options).not.toContain("PMK ITERA"); // the root cannot hold assignments
      const divisions = sql("select name from public.org_units where type = 'division'").split("\n").filter(Boolean);
      expect(divisions.length).toBeGreaterThan(10);
      expect(options.filter((o) => divisions.includes(o))).toEqual([]); // divisions are not options (R5)

      await unitSelect(page).selectOption({ label: "Departemen Operasional" });
      await expect(page).toHaveURL(new RegExp(`\\?unit=${unitId("Departemen Operasional")}$`));
      // Oracle: active members with ANY active-period assignment in Operasional or one of its divisions, A-Z
      const expected = expectedNames({ unitName: "Departemen Operasional" });
      await expectTotal(page, expected.length);
      const names = await namesOnPage(page);
      expect(names).toContain("Bulk Anggota 11");
      // Seed facts that must stay in the result whatever else the seed adds (R6 and the department head)
      expect(expected).toEqual(expect.arrayContaining(["Bulk Anggota 11", "Bulk Anggota 23", "Bulk Anggota 39", "Test Kepala Departemen"]));
      expect(new Set(names).size).toBe(names.length); // one row per person, even with two assignments (MD-15)
      expect(names).toEqual(expected.slice(0, 20)); // first page, A-Z

      // Bulk 11 also holds Staff in Musik (Pelayanan Khusus): appears under that filter too (MD-22), but only once
      await unitSelect(page).selectOption({ label: "Departemen Pelayanan Khusus" });
      await expect.poll(() => namesOnPage(page)).toContain("Bulk Anggota 11");
      const pk = await namesOnPage(page);
      expect(pk.filter((n) => n === "Bulk Anggota 11")).toHaveLength(1);
      // The row text still shows the PRIMARY assignment (Musik), also under the Operasional filter
      await unitSelect(page).selectOption({ label: "Departemen Operasional" });
      await expect.poll(async () => (await tableRows(page).filter({ hasText: "Bulk Anggota 11" }).innerText()).replace(/\s+/g, " ")).toContain("Departemen Pelayanan Khusus · Musik");
    } finally {
      await context.close();
    }
  });

  test("MD-21 / MD-22: EVERY unit option returns exactly its people (derived from PI-CORE), Aktif and Semua, one page of rows in A-Z order", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const units = unitOptionNames();
      expect(units.length).toBeGreaterThan(3);
      for (const unit of units) {
        for (const status of ["active", "all"] as const) {
          const expected = expectedNames({ status, unitName: unit });
          const query = `?unit=${unitId(unit)}${status === "all" ? "&status=all" : ""}`;
          await openList(page, query);
          await expectTotal(page, expected.length);
          if (expected.length > 0) {
            await expect(counterText(page)).toHaveText(counterLabel(expected.length, 1));
            expect(await namesOnPage(page), `${unit} (${status})`).toEqual(expected.slice(0, 20));
          }
          await expect(unitSelect(page)).toHaveValue(unitId(unit));
        }
      }
    } finally {
      await context.close();
    }
  });

  test("Status filter: exactly Aktif / Nonaktif / Semua; Nonaktif and Semua equal the database counts; chips match; Reset returns to Aktif", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      expect((await statusSelect(page).locator("option").allInnerTexts()).map((t) => t.trim())).toEqual(["Aktif", "Nonaktif", "Semua"]);
      const { active, inactive, all } = memberCounts();
      expect(inactive, "the seed must hold at least one deactivated member").toBeGreaterThan(0);
      expect(inactive).toBeLessThanOrEqual(20); // the chip checks below read one page
      // Default Aktif: nobody inactive is listed
      expect(await tableRows(page).filter({ hasText: "Nonaktif" }).count()).toBe(0);

      await statusSelect(page).selectOption({ label: "Nonaktif" });
      await expect(page).toHaveURL(/\?status=inactive$/);
      await expectTotal(page, inactive);
      expect(countMembers("not is_active")).toBe(inactive);
      await expect(tableRows(page)).toHaveCount(inactive);
      await expect(tableRows(page).getByText("Nonaktif", { exact: true })).toHaveCount(inactive);
      await expect(tableRows(page).getByText("Aktif", { exact: true })).toHaveCount(0);
      // R9: a deactivated member's unit is what PI-CORE records (A-MD3); the row is never removed
      await expect(tableRows(page).filter({ hasText: "Test Anggota Nonaktif" })).toContainText("Pubdok");

      await statusSelect(page).selectOption({ label: "Semua" });
      await expect(page).toHaveURL(/\?status=all$/);
      await expectTotal(page, all);
      await expect(counterText(page)).toHaveText(counterLabel(all, 1));

      // Reset from a combined state
      await unitSelect(page).selectOption({ label: "Biro Kewirausahaan" });
      await searchBox(page).fill("Kepala");
      const kepalaBiro = expectedNames({ status: "all", search: "kepala", unitName: "Biro Kewirausahaan" });
      expect(kepalaBiro).toContain("Test Kepala Biro");
      await expectTotal(page, kepalaBiro.length);
      await main(page).getByRole("link", { name: "Reset" }).first().click();
      await expect(page).toHaveURL(/\/data-anggota$/);
      await expectTotal(page, active);
      await expect(statusSelect(page)).toHaveValue("active");
      await expect(unitSelect(page)).toHaveValue("");
      await expect(searchBox(page)).toHaveValue("");
    } finally {
      await context.close();
    }
  });

  test("changing a filter goes back to page 1", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { active, all } = memberCounts();
      await openList(page, `?page=${pagesFor(active)}`);
      await statusSelect(page).selectOption({ label: "Semua" });
      await expect(page).toHaveURL(/\?status=all$/); // no page parameter
      await expect(counterText(page)).toHaveText(counterLabel(all, 1));
    } finally {
      await context.close();
    }
  });

  test("Back and Forward restore filters and fields; a refresh keeps the view (F3 step 4)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const { active, all } = memberCounts();
      expect(all, "needs more than one page to test the page link history").toBeGreaterThan(20);
      await openList(page);
      await statusSelect(page).selectOption({ label: "Semua" });
      await expectTotal(page, all);
      await unitSelect(page).selectOption({ label: "Departemen Operasional" });
      await expectTotal(page, expectedNames({ status: "all", unitName: "Departemen Operasional" }).length);

      await page.goBack();
      await expect(page).toHaveURL(/\?status=all$/);
      await expectTotal(page, all);
      await expect(statusSelect(page)).toHaveValue("all");
      await expect(unitSelect(page)).toHaveValue("");

      await page.goBack();
      await expect(page).toHaveURL(/\/data-anggota$/);
      await expectTotal(page, active);
      await expect(statusSelect(page)).toHaveValue("active");

      await page.goForward();
      await expect(statusSelect(page)).toHaveValue("all");
      await page.reload();
      await expect(statusSelect(page)).toHaveValue("all");
      await expectTotal(page, all);

      // Page links are real history entries too
      await page.getByRole("navigation", { name: "Halaman daftar anggota" }).getByRole("link", { name: "Halaman berikutnya" }).click();
      await expect(counterText(page)).toHaveText(counterLabel(all, 2));
      await page.goBack();
      await expect(counterText(page)).toHaveText(counterLabel(all, 1));
    } finally {
      await context.close();
    }
  });

  test("the address holds only q, unit, status and page; a made-up or malformed value falls back to the defaults", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      for (const bad of ["?status=weird", "?status=ALL", "?unit=not-a-guid", "?unit=11111111-1111-1111-1111-111111111111&status=active", "?foo=bar&q="]) {
        await openList(page, bad);
        await expect(main(page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
        await expect(page.getByText("Terjadi gangguan")).toHaveCount(0);
      }
      await openList(page, "?status=weird");
      await expect(statusSelect(page)).toHaveValue("active");
      await expectTotal(page, memberCounts().active);
      await openList(page, "?unit=not-a-guid");
      await expect(unitSelect(page)).toHaveValue("");
      // A well-formed unit id that does not exist: an honest empty result, not an error
      await openList(page, "?unit=11111111-1111-1111-1111-111111111111");
      await expect(main(page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
      await expect(page.getByText("Terjadi gangguan")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("a too-long search shows the error and one way out; the box keeps its 120-character limit", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      for (const length of [121, 480, 5000]) {
        await openList(page, `?q=${"a".repeat(length)}`);
        const alert = main(page).getByRole("alert");
        await expect(alert).toHaveText("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.");
        await expect(searchBox(page)).toHaveAttribute("aria-invalid", "true");
        await expect(searchBox(page)).toHaveAttribute("aria-describedby", "member-search-error");
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(page.getByText("Terjadi gangguan")).toHaveCount(0);
        await expect(page.getByText("Tidak punya akses")).toHaveCount(0);
      }
      await page.getByRole("link", { name: "Hapus pencarian" }).click();
      await expectTotal(page, memberCounts().active);
      await expect(main(page).getByRole("alert")).toHaveCount(0); // (Next's own route announcer is outside <main>)

      // Typing: the input stops at 120 characters, and exactly 120 is accepted
      await expect(searchBox(page)).toHaveAttribute("maxlength", "120");
      await searchBox(page).fill("b".repeat(300));
      await expect(searchBox(page)).toHaveValue("b".repeat(120));
      await expect(main(page).getByRole("alert")).toHaveCount(0);
      await expectTotal(page, 0);
      // 120 characters padded with spaces is still valid (the server trims first)
      await openList(page, `?q=${encodeURIComponent(`  ${"c".repeat(120)}  `)}`);
      await expectTotal(page, 0);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Row content (MD-16, MD-18, MD-19, MD-20, MD-24)", () => {
  const rowText = async (page: Page, name: string) => (await tableRows(page).filter({ hasText: name }).first().innerText()).replace(/\s+/g, " ").trim();

  test("unit / position lines: BPH, bureau, division, tie-break and no-assignment", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, "?q=Test");
      expect(await rowText(page, "Test Ketua Umum")).toContain("BPH PMK ITERA Ketua Umum");
      expect(await rowText(page, "Test Kepala Biro")).toContain("Biro Kewirausahaan Kepala Biro");
      expect(await rowText(page, "Test Kepala Departemen")).toContain("Departemen Operasional Kepala Departemen");
      expect(await rowText(page, "Test Bendahara Umum 1")).toContain("BPH PMK ITERA Bendahara Umum 1");
      expect(await rowText(page, "Test Anggota Biasa")).toContain("Departemen CMIT · IT Staff");

      // Bulk 11: Staff in Musik AND Staff in Logistik (same rank): Musik wins the tie-break (A-MD8), the same on every request
      for (let i = 0; i < 3; i++) {
        await openList(page, "?q=Bulk+Anggota+11");
        const text = await rowText(page, "Bulk Anggota 11");
        expect(text).toContain("Departemen Pelayanan Khusus · Musik");
        expect(text).toContain("Staff");
        expect(text).not.toContain("Logistik");
      }
      const cells = tableRows(page).first().locator("td");
      await expect(cells.nth(2).locator("p").nth(0)).toHaveText("Departemen Pelayanan Khusus · Musik");
      await expect(cells.nth(2).locator("p").nth(1)).toHaveText("Staff");

      // MD-18: a Staff in a division of Operasional (a division is written after its department)
      await openList(page, "?q=Bulk+Anggota+39");
      const bulk39 = await rowText(page, "Bulk Anggota 39");
      expect(bulk39).toContain("Departemen Operasional · Logistik Staff");

      // No assignment (MD-19): shown with "-", not hidden
      await openList(page, "?q=Bulk+Anggota+01");
      await expect(tableRows(page)).toHaveCount(1);
      await expect(tableRows(page).first().locator("td").nth(2)).toHaveText("-");
    } finally {
      await context.close();
    }
  });

  test("MD-20: a member whose only assignment is in an earlier period shows '-' (no history leaks into the list)", async ({ browser }) => {
    // Seed has none with a previous-period-only assignment; the period spec creates one. Here: nobody shows a unit that is
    // not an active-period assignment.
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const withUnitInDb = Number(sql(`select count(distinct a.member_id) from public.assignments a join public.periods p on p.id=a.period_id and p.is_active join public.members m on m.id=a.member_id where m.is_active`));
      await openList(page, "?status=all");
      let withUnit = 0;
      for (let n = 1; n <= pagesFor(memberCounts().all); n++) {
        await openList(page, `?status=all&page=${n}`);
        for (const cell of await tableRows(page).locator("td:nth-child(3)").allInnerTexts()) if (cell.trim() !== "-") withUnit++;
      }
      // members (active or not) with an active-period assignment
      const expected = Number(sql(`select count(distinct a.member_id) from public.assignments a join public.periods p on p.id=a.period_id and p.is_active`));
      expect(withUnit).toBe(expected);
      expect(withUnitInDb).toBeLessThanOrEqual(expected);
    } finally {
      await context.close();
    }
  });

  test("MD-24: lecturers carry the Pembina marker and '-' (every active lecturer); students never do; no NIP", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page, "?q=Dosen+Pembina");
      const row = tableRows(page).first();
      await expect(row.getByText("Pembina", { exact: true })).toBeVisible();
      await expect(row.locator("td").nth(2)).toHaveText("-");

      let markers = 0;
      const markedNames: string[] = [];
      const { active, activeLecturers } = memberCounts();
      expect(activeLecturers, "the seed must hold at least one active lecturer").toBeGreaterThan(0);
      for (let n = 1; n <= pagesFor(active); n++) {
        await openList(page, n === 1 ? "" : `?page=${n}`);
        await expect(counterText(page)).toBeVisible();
        for (const r of await tableRows(page).all()) {
          if ((await r.getByText("Pembina", { exact: true }).count()) > 0) {
            markers++;
            markedNames.push((await r.locator("td:nth-child(2) > p").innerText()).trim());
            await expect(r.locator("td").nth(2)).toHaveText("-"); // lecturers cannot hold assignments (R10)
          }
        }
      }
      expect(markers).toBe(activeLecturers);
      expect(markedNames.sort()).toEqual(sql("select full_name from public.members where member_type = 'lecturer' and is_active").split("\n").sort());
      expect(markedNames).toContain("Test Dosen Pembina");
    } finally {
      await context.close();
    }
  });

  test("rows are not interactive (MD-14): no links, no buttons, no pointer cursor, no edit or add controls anywhere", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await expect(page.getByRole("table").getByRole("link")).toHaveCount(0);
      await expect(page.getByRole("table").getByRole("button")).toHaveCount(0);
      await expect(page.getByText(/Tambah Anggota|Ketuk baris|Edit|Hapus|Undang|Nonaktifkan/)).toHaveCount(0);
      expect(await tableRows(page).first().evaluate((el) => getComputedStyle(el).cursor)).not.toBe("pointer");
      const before = page.url();
      await tableRows(page).first().click();
      expect(page.url()).toBe(before);
      // Column headers per spec (Stitch "Departemen", NIM etc. are not used)
      await expect(page.getByRole("columnheader")).toHaveText(["No", "Nama Lengkap", "Unit / Jabatan", "Status"]);
      await expect(page.getByRole("table")).toHaveAccessibleName(`Daftar anggota, halaman 1 dari ${pagesFor(memberCounts().active)}`);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Page response hygiene", () => {
  test("the list page is never cached (no-store), has its own title and a Dutch-free Indonesian lang", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const res = await context.request.get(LIST_PATH);
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toMatch(/no-store|private/);
      expect(res.headers()["x-powered-by"]).toBeUndefined();
      await openList(page);
      await expect(page).toHaveTitle(/Data Anggota/);
      await expect(page.locator("html")).toHaveAttribute("lang", "id");
    } finally {
      await context.close();
    }
  });
});

test.describe("MD-10, MD-12: no personal data in any page", () => {
  test("rendered text and raw HTML of every page and filter hold no email, NIM, phone, NIP or ids of the account", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      const secrets = secretValues();
      expect(secrets.length).toBeGreaterThan(40); // the oracle really has the identifiers
      const urls = [LIST_PATH, `${LIST_PATH}?page=2`, `${LIST_PATH}?page=3`, `${LIST_PATH}?status=all`, `${LIST_PATH}?status=inactive`, `${LIST_PATH}?q=Dosen`];
      for (const url of urls) {
        await page.goto(url);
        await expect(main(page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
        const text = await page.locator("body").innerText();
        const html = await (await context.request.get(url)).text();
        for (const secret of secrets) {
          expect(text, `${url} text`).not.toContain(secret);
          expect(html, `${url} html`).not.toContain(secret);
        }
        expect(text, url).not.toMatch(/@nexus\.test|\b\d{7,}\b|\+62|\b08\d{8,}\b|\bNIM\b|\bNIP\b|telepon|e-?mail/i);
        // Field names of the forbidden columns do not appear in the page payload either
        expect(html, url).not.toMatch(/"(email|phone|nim|nip|user_id|access_level|must_change_password|deactivated_at)"/);
      }
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("MD-40: 390 px layout (no horizontal page scroll, 44 px targets, 16 px field text)", () => {
  test("list, pages, filters, empty and error states, menu and drawer fit the screen", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      expect(page.viewportSize()?.width).toBe(390);
      for (const url of [LIST_PATH, `${LIST_PATH}?page=2`, `${LIST_PATH}?page=3`, `${LIST_PATH}?status=all`, `${LIST_PATH}?q=zzz`, `${LIST_PATH}?q=${"a".repeat(200)}`, `${LIST_PATH}?unit=${unitId("Departemen Operasional")}`]) {
        await page.goto(url);
        await expect(main(page).getByRole("heading", { level: 1, name: "Data Anggota" })).toBeVisible();
        expect(await noHorizontalScroll(page), url).toBe(true);
      }
      await openList(page);
      // The table wraps text inside its box instead of scrolling sideways (seed names fit)
      const scroller = main(page).locator("table").locator("xpath=..");
      expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      // Targets: search 48 px, selects 48 px, Reset, Ekspor and pager cells at least 44 px; field text 16 px (D-017)
      for (const field of [searchBox(page), unitSelect(page), statusSelect(page)]) {
        const box = await field.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
      }
      for (const target of [exportButton(page), main(page).getByRole("link", { name: "Reset" }), page.getByRole("navigation", { name: "Halaman daftar anggota" }).getByRole("link", { name: "Halaman berikutnya" })]) {
        const box = await target.boundingBox();
        expect(box!.height, "target height").toBeGreaterThanOrEqual(43.5);
        expect(box!.width, "target width").toBeGreaterThanOrEqual(43.5);
      }

      await exportButton(page).click();
      expect(await noHorizontalScroll(page)).toBe(true);
      const menu = await page.getByRole("button", { name: "CSV (.csv)" }).boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
      expect(menu!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Escape");

      await openDrawer(page);
      expect(await noHorizontalScroll(page)).toBe(true);
      const drawer = await page.getByRole("dialog").boundingBox();
      expect(drawer!.width).toBeLessThanOrEqual(390 * 0.8 + 1);
    } finally {
      await context.close();
    }
  });

  test("forbidden screen fits 390 px too", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "regular");
    try {
      await page.goto(LIST_PATH);
      await expect(page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      const box = await page.getByRole("link", { name: "Kembali ke Dashboard" }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(43.5);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Drawer accessibility (D-021): focus trap, Escape, focus return, aria-current", () => {
  test("opens on the current item; Tab and Shift+Tab stay inside; Escape closes and focus returns to the menu button", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      const trigger = page.getByRole("button", { name: "Buka menu" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName("PMK-NEXUS");

      // Focus starts on the current page's item
      await expect(dialog.getByRole("link", { name: "Data Anggota" })).toBeFocused();
      // aria-current on the current item only
      await expect(dialog.locator("[aria-current='page']")).toHaveCount(1);
      await expect(dialog.getByRole("link", { name: "Data Anggota" })).toHaveAttribute("aria-current", "page");
      await expect(dialog.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", /.*/);

      // The page behind is not reachable: tab through more steps than there are controls, always staying inside
      const inside = () => page.evaluate(() => !!document.activeElement?.closest("[role='dialog']"));
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        expect(await inside(), `Tab ${i + 1}`).toBe(true);
      }
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Shift+Tab");
        expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
      }
      // The focusable controls inside: close, Dashboard, Data Anggota, Keluar (4); the loop wraps
      const seen = new Set<string>();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        seen.add(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? ""));
      }
      expect([...seen].sort()).toEqual(["Dashboard", "Data Anggota", INVENTORY_ITEM, "Keluar", "Tutup menu"].sort());

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } finally {
      await context.close();
    }
  });

  test("on the Dashboard the Dashboard item is current; the close button, the veil and a link tap also close the drawer", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto("/");
      await openDrawer(page);
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
      await expect(dialog.getByRole("link", { name: "Data Anggota" })).not.toHaveAttribute("aria-current", /.*/);
      await dialog.getByRole("button", { name: "Tutup menu" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Buka menu" })).toBeFocused();

      await openDrawer(page);
      await expect.poll(async () => (await page.getByRole("dialog").boundingBox())?.x).toBe(0); // wait for the slide-in to end
      await page.mouse.click(380, 400); // on the veil, outside the 288 px drawer
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await openDrawer(page);
      await page.getByRole("dialog").getByRole("link", { name: "Data Anggota" }).click();
      await expect(page).toHaveURL(/\/data-anggota$/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // The drawer footer shows who is signed in
      await openDrawer(page);
      await expect(page.getByRole("dialog").getByText("Masuk sebagai Test Ketua Umum.")).toBeVisible();
      await expect(page.getByRole("dialog").getByText("Periode 2026/2027")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("BUG-MD-02: with prefers-reduced-motion the drawer and its veil do not animate", async ({ browser }) => {
    // The project config sets reducedMotion: "reduce" (BUG-MD-02, fixed 2026-11-07).
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto("/");
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
      await openDrawer(page);
      const animation = await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).animationName);
      expect(animation).toBe("none");
    } finally {
      await context.close();
    }
  });

  test("the export menu closes with Escape and returns focus to its button", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await openList(page);
      await exportButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Excel (.xlsx)" })).toBeVisible();
      await expect(page.getByText("Unduh semua hasil filter sebagai:")).toBeVisible();
      await expect(page.locator("details")).toHaveAttribute("open", "");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Excel (.xlsx)" })).toBeHidden();
      await expect(exportButton(page)).toBeFocused();
      // The menu offers exactly the three formats (MD-30)
      await exportButton(page).click();
      await expect(page.locator("details ul button")).toHaveText(["Excel (.xlsx)", "CSV (.csv)", "PDF (.pdf)"]);
    } finally {
      await context.close();
    }
  });
});
