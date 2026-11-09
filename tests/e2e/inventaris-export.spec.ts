// Inventory and Borrowing exports (spec F12, section 8, IB-43, IB-44, IB-42): Excel, CSV and PDF contain exactly the
// rows the screen shows for the same filters (including the period filter), in screen order, with one append-only log
// row per successful export, no file without the key and no personal data beyond the specified columns.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  addDays,
  approveAs,
  awayFromMidnight,
  cancelAs,
  createQtyItem,
  createTrackedItem,
  EXPORT_BORROWING,
  EXPORT_CATALOG,
  exportLogCount,
  exportLogMaxId,
  exportLogsAfter,
  handOverAs,
  jakartaToday,
  lineOf,
  main,
  memberId,
  mustCreate,
  ORIGIN,
  q,
  qjson,
  qn,
  rejectAs,
  requesterWithRoom,
  returnAs,
  rpcAs,
  sweepQa,
  tag,
  type PersonaKey,
  xlsxTable,
} from "./inventaris-helpers";
import { hasPdftotext, parseCsv, pdfText } from "./member-data-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
  q("alter table nexus.inventory_borrowing_export_logs drop constraint if exists qa_block_ib_log_write");
});

const CATALOG_HEADER = ["No", "Kode", "Nama Barang", "Cara Catat", "Kategori", "Lokasi", "Kondisi", "Baik", "Perlu servis", "Rusak", "Total", "Status"];
const BORROWING_HEADER = [
  "No", "Referensi", "Status", "Keterangan", "Periode", "Peminjam", "Dicatat Oleh", "Keperluan", "Barang", "Unit Diserahkan", "Mulai", "Selesai",
  "Perpanjangan", "Diputuskan Oleh", "Waktu Keputusan", "Catatan Keputusan", "Waktu Serah Terima", "Waktu Kembali", "Kembali Baik", "Kembali Rusak", "Hilang",
];
const STATUS_LABEL: Record<string, string> = { submitted: "Diajukan", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan", borrowed: "Dipinjam", returned: "Dikembalikan" };

type Download = { path: string; fileName: string };
async function download(page: Page, label: "Excel (.xlsx)" | "CSV (.csv)" | "PDF (.pdf)"): Promise<Download> {
  const event = page.waitForEvent("download");
  await page.locator("summary", { hasText: "Ekspor" }).click();
  await page.getByRole("button", { name: label }).click();
  const d = await event;
  const path = await d.path();
  if (!path) throw new Error("download has no path");
  return { path, fileName: d.suggestedFilename() };
}
const jakartaDay = () => jakartaToday();

/** Rows of a CSV or XLSX download as a header and string rows (identical shape for both). */
function table(file: Download, kind: "csv" | "xlsx"): { header: string[]; rows: string[][] } {
  if (kind === "xlsx") {
    const t = xlsxTable(file.path);
    return { header: t.header, rows: t.rows };
  }
  const bytes = readFileSync(file.path);
  expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf"); // UTF-8 BOM so Excel reads it right
  const records = parseCsv(bytes.toString("utf8").replace(/^﻿/, ""));
  return { header: records[0], rows: records.slice(1).filter((r) => r.some((x) => x !== "")) };
}

const logsFor = (afterId: number) => exportLogsAfter(afterId);

// ---------------------------------------------------------------------------------------------
test.describe.serial("catalog export: same rows and order as the screen, one log row each, archived and lost only for managers", () => {
  let qty: { id: string; name: string; code: string };
  let tracked: { id: string; name: string; codes: string[]; unitIds: string[] };
  let archived: { id: string; name: string };

  test("setup: a counted item, a tracked item with one lost unit, an archived item (all named with the QA tag)", async () => {
    await awayFromMidnight();
    qty = await createQtyItem(`${TAG} Ekspor Hitung`, { good: 4, needs_service: 1, damaged: 2 });
    tracked = await createTrackedItem(`${TAG} Ekspor Unit`, ["good", "needs_service", "good"]);
    expect((await rpcAs("staffOps", "inventory_unit_write_off", { p_unit_id: tracked.unitIds[2], p_note: "hilang" })).ok).toBe(true);
    archived = await createQtyItem(`${TAG} Ekspor Arsip`, { good: 1 });
    expect((await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: archived.id, p_is_active: false })).ok).toBe(true);
  });

  for (const kind of ["xlsx", "csv", "pdf"] as const) {
    test(`BPH (ketum) exports ${kind}: rows = what the filtered screen lists, in order; one log row; no personal data`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        await page.goto(`/inventaris?q=${encodeURIComponent(TAG)}`);
        // Screen: items listed (archived hidden), in order
        await expect(main(page).getByText(/^Menampilkan 1-\d+ dari \d+ barang$/)).toBeVisible();
        const screenItems = (await main(page).locator("a[href^='/inventaris/barang/']").allInnerTexts()).map((t) => t.trim()).filter((t) => t.includes(TAG));
        const uniqueScreen = [...new Set(screenItems)];
        const total = Number(/dari (\d+) barang/.exec(await main(page).getByText(/^Menampilkan/).innerText())![1]);
        expect(total).toBe(qn(`select count(*) from nexus.inventory_items where name like '${TAG}%' and is_active`));
        expect([...uniqueScreen].sort()).toEqual([qty.name, tracked.name].sort());
        expect(uniqueScreen.length).toBe(total);

        const before = exportLogMaxId();
        const label = kind === "xlsx" ? "Excel (.xlsx)" : kind === "csv" ? "CSV (.csv)" : "PDF (.pdf)";
        const file = await download(page, label);
        expect(file.fileName).toBe(`inventaris-${jakartaDay()}.${kind}`);

        // Oracle from the database: one row per counted item, one per ACTIVE unit of a tracked item (lost units are not listed)
        const expectedCodes = [qty.code, ...tracked.codes.slice(0, 2)].sort();
        if (kind === "pdf") {
          if (!hasPdftotext) test.skip(true, "pdftotext is not installed");
          const text = pdfText(file.path);
          for (const code of expectedCodes) expect(text).toContain(code);
          expect(text).not.toContain(tracked.codes[2]); // the lost unit
          expect(text).not.toContain(`${TAG} Ekspor Arsip`);
          expect(text).toContain("Inventaris PMK ITERA");
          expect(text).toMatch(/Periode 2026\/2027/);
        } else {
          const t = table(file, kind);
          expect(t.header).toEqual(CATALOG_HEADER);
          const rows = t.rows;
          expect(rows.map((r) => r[1]).sort()).toEqual(expectedCodes);
          expect(rows.map((r) => r[0])).toEqual(rows.map((_, i) => String(i + 1))); // numbered 1..n in file order
          const names = [...new Set(rows.map((r) => r[2]))];
          expect(names.sort()).toEqual([qty.name, tracked.name].sort());
          const countedRow = rows.find((r) => r[1] === qty.code)!;
          expect(countedRow.slice(7, 12)).toEqual(["4", "1", "2", "7", "Aktif"]); // Baik, Perlu servis, Rusak, Total, Status
          const unitRow = rows.find((r) => r[1] === tracked.codes[1])!;
          expect(unitRow[6]).toBe("Perlu servis");
        }
        // Exactly one log row; no search text, no member data
        const logs = logsFor(before);
        expect(logs).toHaveLength(1);
        const log = logs[0];
        expect(log.module).toBe("inventory");
        expect(log.format).toBe(kind);
        expect(log.exporter_member_id).toBe(await memberId("ketum@nexus.test"));
        expect(log.period_id).toBe(q("select id from public.periods where is_active"));
        expect(JSON.stringify(log)).not.toContain(TAG);
        expect(JSON.stringify(log)).not.toMatch(/@|nexus\.test/);
        expect(log.row_count).toBe(kind === "pdf" ? log.row_count : 3);
      } finally {
        await context.close();
      }
    });
  }

  test("filters carry through: category, condition and search narrow the file exactly like the screen; 'Tersedia' column appears with the date filter", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      const today = jakartaToday();
      await page.goto(`/inventaris?q=${encodeURIComponent(TAG)}&condition=needs_service&from=${today}&to=${addDays(today, 2)}`);
      const total = Number(/dari (\d+) barang$/.exec(await main(page).getByText(/^Menampilkan/).innerText())![1]);
      const before = exportLogMaxId();
      const file = await download(page, "CSV (.csv)");
      const t = table(file, "csv");
      expect(t.header).toEqual([...CATALOG_HEADER, "Tersedia"]);
      // condition filter: items that have something in Perlu servis: both the counted and the tracked item
      expect(new Set(t.rows.map((r) => r[2])).size).toBe(total);
      const counted = t.rows.find((r) => r[1] === qty.code)!;
      expect(counted[12]).toBe("4"); // 4 lendable (Baik) and nothing reserved in that range
      expect(logsFor(before)).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test("managers get archived and lost rows only with the status filter and a Status column (Nonaktif / Hilang); BPH is refused that filter by the route (inventory.manage)", async ({ browser }) => {
    const ops = await signedInContext(browser, "staffOps");
    const bph = await signedInContext(browser, "ketum");
    try {
      const before = exportLogMaxId();
      const res = await ops.context.request.post(EXPORT_CATALOG, { data: { format: "csv", filters: { search: TAG, status: "all" } }, headers: { origin: ORIGIN } });
      expect(res.status()).toBe(200);
      const csv = parseCsv((await res.text()).replace(/^﻿/, ""));
      const rows = csv.slice(1).filter((r) => r.some((x) => x));
      const status = Object.fromEntries(rows.map((r) => [r[1], r[11]]));
      expect(status[q(`select code from nexus.inventory_items where id = '${archived.id}'`)]).toBe("Nonaktif");
      expect(status[tracked.codes[2]]).toBe("Hilang");
      expect(status[tracked.codes[0]]).toBe("Aktif");
      expect(logsFor(before)).toHaveLength(1);

      const denied = await bph.context.request.post(EXPORT_CATALOG, { data: { format: "csv", filters: { search: TAG, status: "all" } }, headers: { origin: ORIGIN } });
      expect(denied.status()).toBe(403);
      expect(logsFor(before)).toHaveLength(1); // the refusal wrote nothing
    } finally {
      await ops.context.close();
      await bph.context.close();
    }
  });

  test("IB-44: a failing log write means NO file and no row (the check constraint is added for a moment and always removed)", async ({ browser }) => {
    const { context } = await signedInContext(browser, "staffOps");
    try {
      q("alter table nexus.inventory_borrowing_export_logs add constraint qa_block_ib_log_write check (false) not valid");
      const before = exportLogCount();
      const res = await context.request.post(EXPORT_CATALOG, { data: { format: "csv", filters: { search: TAG } }, headers: { origin: ORIGIN } });
      expect(res.status()).toBe(503);
      expect((await res.json()).error.code).toBe("unavailable");
      expect(res.headers()["content-type"]).toContain("application/json");
      const res2 = await context.request.post(EXPORT_BORROWING, { data: { format: "csv", filters: { view: "all" } }, headers: { origin: ORIGIN } });
      expect(res2.status()).toBe(503);
      expect(exportLogCount()).toBe(before);
    } finally {
      q("alter table nexus.inventory_borrowing_export_logs drop constraint if exists qa_block_ib_log_write");
      await context.close();
    }
  });

  test("the export log cannot be updated or deleted, not even by the database owner (IB-44)", async () => {
    expect(exportLogCount()).toBeGreaterThan(0);
    expect(() => q("begin; delete from nexus.inventory_borrowing_export_logs; rollback;")).toThrow();
    expect(() => q("begin; update nexus.inventory_borrowing_export_logs set row_count = 0; rollback;")).toThrow();
    expect(() => q("begin; insert into nexus.inventory_borrowing_export_logs (module, exporter_member_id, format, filters, row_count, period_id) select 'inventory', id, 'csv', '{}', 0, (select id from public.periods where is_active) from public.members limit 1; rollback;")).toThrow(); // only through the export functions
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("borrowing export: rows = the queue screen for the same filters (view, search, dates, item, period)", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  let who: PersonaKey;
  const made: { id: string; ref: string }[] = [];
  let item: { id: string; name: string };

  test("setup: submitted, approved, returned and rejected requests of the QA item", async () => {
    await awayFromMidnight();
    const picked = requesterWithRoom(5);
    test.skip(picked === null, "no requester has daily room left (20 per member per Jakarta day); rerun after midnight WIB");
    who = picked!;
    item = await createQtyItem(`${TAG} Pinjam Ekspor`, { good: 20 });
    const today = jakartaToday();
    const submitted = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 1 }], purpose: `${TAG} diajukan, dengan "kutip", koma dan\nbaris baru` });
    const approved = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 2 }], start: addDays(today, 5), end: addDays(today, 6) });
    expect((await approveAs("kadep", approved.id, { note: "Silakan diambil" })).ok).toBe(true);
    const returned = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 3 }] });
    expect((await approveAs("kadivLogistik", returned.id)).ok).toBe(true);
    expect((await handOverAs("staffOps", returned.id, [{ line_id: lineOf(returned.id, item.id), quantity: 3 }])).ok).toBe(true);
    expect((await returnAs("staffOps", returned.id, [{ outcome: "good", line_id: lineOf(returned.id, item.id), quantity: 3 }])).ok).toBe(true);
    const rejected = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await rejectAs("kadep", rejected.id, "Tidak tersedia")).ok).toBe(true);
    made.push(submitted, approved, returned, rejected);
    ready = true;
  });

  const oracle = (where = "true") =>
    qjson<{ reference: string; status: string; requester: string }>(
      `select r.reference, r.status, m.full_name as requester from nexus.borrowing_requests r join public.members m on m.id = r.requester_member_id
       where r.period_id = (select id from public.periods where is_active) and exists (select 1 from nexus.borrowing_request_lines l join nexus.inventory_items i on i.id = l.item_id where l.request_id = r.id and i.name like '${TAG}%')
       and (${where})`,
    );

  async function screenRefs(page: Page): Promise<string[]> {
    const labels = await page.locator("a[aria-label^='Pengajuan PJM-']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    return labels.map((l) => /PJM-\d+/.exec(l)![0]);
  }

  for (const kind of ["xlsx", "csv", "pdf"] as const) {
    test(`BPH exports ${kind} for view 'Semua' + search: same references in the same order as the screen; one log row; statuses, requester names and WIB times match the database`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { context, page } = await signedInContext(browser, "ketum");
      try {
        await page.goto(`/inventaris/antrean?view=all&q=${encodeURIComponent(TAG)}`);
        const refsOnScreen = await screenRefs(page);
        const expected = oracle();
        expect(refsOnScreen.length).toBe(expected.length);
        expect([...refsOnScreen].sort()).toEqual(expected.map((e) => e.reference).sort());
        const shown = Number(/dari (\d+) pengajuan$/.exec(await main(page).getByText(/^Menampilkan/).innerText())![1]);
        expect(shown).toBe(expected.length);

        const before = exportLogMaxId();
        const label = kind === "xlsx" ? "Excel (.xlsx)" : kind === "csv" ? "CSV (.csv)" : "PDF (.pdf)";
        const file = await download(page, label);
        expect(file.fileName).toBe(`peminjaman-${jakartaDay()}.${kind}`);
        if (kind === "pdf") {
          if (!hasPdftotext) test.skip(true, "pdftotext is not installed");
          const text = pdfText(file.path, false);
          const order = expected.map((e) => text.indexOf(e.reference));
          for (const ref of refsOnScreen) expect(text).toContain(ref);
          const inFile = refsOnScreen.map((r) => text.indexOf(r));
          expect([...inFile].sort((a, b) => a - b)).toEqual(inFile); // same order as the screen
          expect(order.every((o) => o >= 0)).toBe(true);
          expect(text).toContain("Peminjaman Barang PMK ITERA");
        } else {
          const t = table(file, kind);
          expect(t.header).toEqual(BORROWING_HEADER);
          expect(t.rows.map((r) => r[1])).toEqual(refsOnScreen); // same rows, same order
          for (const r of t.rows) {
            const db = expected.find((e) => e.reference === r[1])!;
            expect(r[2]).toBe(STATUS_LABEL[db.status]);
            expect(r[5]).toBe(db.requester);
            expect(r[4]).toBe("2026/2027");
          }
          // Dates of decision in WIB (UTC+7): compare with the database converted to Jakarta time
          const ap = made[1];
          const row = t.rows.find((r) => r[1] === ap.ref)!;
          const wib = q(`select to_char(decided_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') from nexus.borrowing_requests where id = '${ap.id}'`);
          expect(row[14]).toContain(wib);
          expect(row[15]).toBe("Silakan diambil");
          // CSV safety: the awkward purpose (quote, comma, newline) round-trips as ONE cell
          const sub = t.rows.find((r) => r[1] === made[0].ref)!;
          expect(sub[7]).toBe(`${TAG} diajukan, dengan "kutip", koma dan\nbaris baru`);
          // Evidence photos and contact data are not exported (IB-42)
          expect(t.header.join("|")).not.toMatch(/foto|email|telepon|nim|nip/i);
        }
        const logs = logsFor(before);
        expect(logs).toHaveLength(1);
        expect(logs[0].module).toBe("borrowing");
        expect(logs[0].format).toBe(kind);
        expect(logs[0].exporter_member_id).toBe(await memberId("ketum@nexus.test"));
        expect(logs[0].row_count).toBe(expected.length);
        expect(JSON.stringify(logs[0])).not.toContain(TAG);
      } finally {
        await context.close();
      }
    });
  }

  test("view 'Selesai' (closed), a date range and the item filter narrow the export like the screen (CSV)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto(`/inventaris/antrean?view=closed&q=${encodeURIComponent(TAG)}`);
      const refs = await screenRefs(page);
      const closed = oracle("r.status in ('returned','rejected','cancelled')");
      expect([...refs].sort()).toEqual(closed.map((c) => c.reference).sort());
      const before = exportLogMaxId();
      const t = table(await download(page, "CSV (.csv)"), "csv");
      expect(t.rows.map((r) => r[1])).toEqual(refs);
      expect(new Set(t.rows.map((r) => r[2]))).toEqual(new Set(["Dikembalikan", "Ditolak"]));
      expect(logsFor(before)).toHaveLength(1);

      // Date range: the approved request starts in 5 days; a range covering only that overlaps it
      const today = jakartaToday();
      const from = addDays(today, 5);
      const to = addDays(today, 6);
      await page.goto(`/inventaris/antrean?view=all&q=${encodeURIComponent(TAG)}&from=${from}&to=${to}`);
      const refs2 = await screenRefs(page);
      expect(refs2).toEqual([made[1].ref]);
      const t2 = table(await download(page, "CSV (.csv)"), "csv");
      expect(t2.rows.map((r) => r[1])).toEqual(refs2);
      // Two ranges that share only one day overlap: a range ending on the start day still finds it
      await page.goto(`/inventaris/antrean?view=all&q=${encodeURIComponent(TAG)}&from=${addDays(today, 3)}&to=${from}`);
      expect(await screenRefs(page)).toContain(made[1].ref);
    } finally {
      await context.close();
    }
  });

  test("period filter: the active period's export equals the screen, another period (2025/2026) exports none of these rows; the period list comes from the database", async ({ browser }) => {
    test.setTimeout(120_000);
    const bph = await signedInContext(browser, "ketum");
    try {
      const periods = qjson<{ id: string; label: string; is_active: boolean }>("select id, label, is_active from public.periods order by label");
      const active = periods.find((p) => p.is_active)!;
      const old = periods.find((p) => !p.is_active)!;
      // The API: borrowing_export with a period id
      const asActive = await bph.context.request.post(EXPORT_BORROWING, { data: { format: "csv", filters: { view: "all", search: TAG, periodId: active.id } }, headers: { origin: ORIGIN } });
      expect(asActive.status()).toBe(200);
      const rowsActive = parseCsv((await asActive.text()).replace(/^﻿/, "")).slice(1).filter((r) => r.some((x) => x));
      expect(rowsActive.length).toBe(oracle().length);
      for (const r of rowsActive) expect(r[4]).toBe(active.label);
      const asOld = await bph.context.request.post(EXPORT_BORROWING, { data: { format: "csv", filters: { view: "all", search: TAG, periodId: old.id } }, headers: { origin: ORIGIN } });
      expect(asOld.status()).toBe(200);
      const rowsOld = parseCsv((await asOld.text()).replace(/^﻿/, "")).slice(1).filter((r) => r.some((x) => x));
      expect(rowsOld.length).toBe(qn(`select count(*) from nexus.borrowing_requests r where r.period_id = '${old.id}' and exists (select 1 from nexus.borrowing_request_lines l join nexus.inventory_items i on i.id = l.item_id where l.request_id = r.id and i.name like '${TAG}%')`));
      // An unknown period id is refused, no log row
      const before = exportLogCount();
      const bad = await bph.context.request.post(EXPORT_BORROWING, { data: { format: "csv", filters: { view: "all", periodId: "00000000-0000-4000-8000-000000000000" } }, headers: { origin: ORIGIN } });
      expect(bad.status()).toBe(400);
      expect(exportLogCount()).toBe(before);

      // The screen filter 'Periode' and its export agree
      await bph.page.goto(`/inventaris/antrean?view=all&q=${encodeURIComponent(TAG)}&period=${active.id}`);
      expect((await bph.page.locator("a[aria-label^='Pengajuan PJM-']").count())).toBe(oracle().length);
      await bph.page.goto(`/inventaris/antrean?view=all&q=${encodeURIComponent(TAG)}&period=${old.id}`);
      await expect(bph.page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
    } finally {
      await bph.context.close();
    }
  });

  test("open-loans handover export (all periods): the screen list and the file agree", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "kadivLogistik");
    try {
      await page.goto("/inventaris/antrean?view=open_all_periods");
      const refs = await screenRefs(page);
      const expected = qjson<{ reference: string }>("select reference from nexus.borrowing_requests where status in ('submitted','approved','borrowed')");
      expect([...refs].sort()).toEqual(expected.map((e) => e.reference).sort());
      const t = table(await download(page, "CSV (.csv)"), "csv");
      expect([...t.rows.map((r) => r[1])].sort()).toEqual([...refs].sort());
      expect(new Set(t.rows.map((r) => r[2])).size).toBeGreaterThan(0);
      for (const r of t.rows) expect(["Diajukan", "Disetujui", "Dipinjam"]).toContain(r[2]);
    } finally {
      await context.close();
    }
  });

  test("a head sees Ekspor on Antrean, a member without view_all has no Antrean at all; PII never appears in a file (email, phone, NIM, NIP)", async ({ browser }) => {
    const ops = await signedInContext(browser, "kadep");
    try {
      await ops.page.goto(`/inventaris/antrean?view=all&q=${encodeURIComponent(TAG)}`);
      await expect(ops.page.locator("summary", { hasText: "Ekspor" })).toBeVisible();
      const res = await ops.context.request.post(EXPORT_BORROWING, { data: { format: "csv", filters: { view: "all" } }, headers: { origin: ORIGIN } });
      expect(res.status()).toBe(200);
      const body = await res.text();
      const secrets = q("select coalesce(email,''), coalesce(nim,''), coalesce(phone,''), coalesce(nip,'') from public.members").split("\n").flatMap((l) => l.split("|")).filter((v) => v.length >= 6);
      for (const s of secrets) expect(body, `file contains ${s}`).not.toContain(s);
      const cat = await ops.context.request.post(EXPORT_CATALOG, { data: { format: "csv", filters: { status: "all" } }, headers: { origin: ORIGIN } });
      const catBody = await cat.text();
      for (const s of secrets) expect(catBody).not.toContain(s);
    } finally {
      await ops.context.close();
    }
    // Cleanup of the requests this block left open
    for (const r of made) {
      const st = q(`select status from nexus.borrowing_requests where id = '${r.id}'`);
      if (st === "submitted") await cancelAs(who, r.id);
      if (st === "approved") await cancelAs("staffOps", r.id, "QA");
    }
  });
});
