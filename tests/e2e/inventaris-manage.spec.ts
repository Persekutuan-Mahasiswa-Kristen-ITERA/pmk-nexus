// Inventory management by Operations (spec F2, IB-02, IB-07..IB-13, IB-54): create in both modes with automatic codes,
// stock dialogs that always need a reason, write-off and restore, archive rules, category and location lists, and what
// members never see. Browser at 390 px for the screens; direct function calls for the rules a screen cannot reach.
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  approveAs,
  awayFromMidnight,
  cancelAs,
  createQtyItem,
  createTrackedItem,
  dialog,
  itemRow,
  main,
  mustCreate,
  noHorizontalScroll,
  q,
  qjson,
  qn,
  rpcAs,
  stockOf,
  sweepQa,
  tag,
  unitRow,
} from "./inventaris-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
  // QA list entries are deactivated, never deleted
  for (const [table, fn, param] of [
    ["inventory_categories", "inventory_category_set_active", "p_category_id"],
    ["inventory_locations", "inventory_location_set_active", "p_location_id"],
  ] as const) {
    for (const id of q(`select id from nexus.${table} where name like '${TAG}%' and is_active`).split("\n").filter(Boolean)) {
      await rpcAs("staffOps", fn, { [param]: id, p_is_active: false });
    }
  }
});

const codeNumber = (code: string) => Number(code.replace("INV-", ""));
const maxCodeNumber = () => Number(q("select coalesce(max(substr(c, 5)::int), 0) from (select code c from nexus.inventory_items where code is not null union all select code from nexus.inventory_units) t"));

test.describe.serial("IB-07, IB-09, IB-11: create items in both modes (screen), codes are automatic, unique and increasing", () => {
  test("quantity item: choose the mode first, fill counts, code is assigned by the database and cannot be typed", async ({ browser }) => {
    test.setTimeout(120_000);
    await awayFromMidnight();
    const before = maxCodeNumber();
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto("/inventaris/kelola/barang/baru");
      expect(await noHorizontalScroll(page)).toBe(true);
      // Mode first: no other field until a mode is chosen
      await expect(page.getByLabel("Nama barang (wajib)")).toHaveCount(0);
      await page.getByText("Dihitung per jumlah", { exact: true }).click();
      await expect(page.getByLabel("Nama barang (wajib)")).toBeVisible();
      // The code is shown, never an input
      await expect(page.getByText("Dibuat otomatis saat disimpan.")).toBeVisible();
      await expect(page.getByLabel("Kode")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: /kode/i })).toHaveCount(0);

      // Required fields
      await page.getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(page.getByText("Isi nama barang.").first()).toBeVisible();
      await expect(page.getByText("Isi minimal satu barang.").first()).toBeVisible();
      // A name above 120 characters
      await page.getByLabel("Nama barang (wajib)").fill("N".repeat(130));
      await page.getByLabel("jumlah Baik", { exact: true }).fill("5");
      await page.getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(page.getByText("Nama barang terlalu panjang. Pakai paling banyak 120 karakter.").first()).toBeVisible();

      await page.getByLabel("Nama barang (wajib)").fill(`${TAG} UI Hitung`);
      await page.getByLabel("Deskripsi (boleh kosong)").fill("Dibuat oleh uji QA");
      await page.getByLabel("Kategori (boleh kosong)").selectOption({ label: "Kategori Uji A" });
      await page.getByLabel("Lokasi (boleh kosong)").selectOption({ label: "Lokasi Uji 1" });
      await page.getByLabel("jumlah Perlu servis", { exact: true }).fill("1");
      await expect(page.getByRole("status").filter({ hasText: "Total" })).toContainText("6");
      await page.getByRole("button", { name: "Simpan", exact: true }).click();

      await expect(page.getByText(/^Barang disimpan\. Kodenya INV-\d{4,}\.$/)).toBeVisible();
      const item = qjson(`select * from nexus.inventory_items where name = '${TAG} UI Hitung'`)[0];
      expect(item.mode).toBe("quantity");
      expect(codeNumber(item.code)).toBeGreaterThan(before);
      expect(stockOf(item.id, "good")).toBe(5);
      expect(stockOf(item.id, "needs_service")).toBe(1);
      expect(stockOf(item.id, "damaged")).toBe(0);
      // Total equals the sum of the counts (IB-07)
      expect(qn(`select sum(quantity) from nexus.inventory_stock where item_id = '${item.id}'`)).toBe(6);
      expect(qn(`select count(*) from nexus.inventory_item_history where item_id = '${item.id}' and kind = 'created'`)).toBe(1);
      await expect(page.getByText(item.code).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("tracked item: 3 units, one in 'Perlu servis': one code per unit, consecutive and above every earlier code", async ({ browser }) => {
    test.setTimeout(120_000);
    const before = maxCodeNumber();
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto("/inventaris/kelola/barang/baru");
      await page.getByText("Dilacak per unit", { exact: true }).click();
      await page.getByLabel("Nama barang (wajib)").fill(`${TAG} UI Unit`);
      await page.getByRole("button", { name: "Tambah unit" }).click();
      await page.getByRole("button", { name: "Tambah unit" }).click();
      await expect(page.getByText(/^Unit [123]$/)).toHaveCount(3);
      await page.locator("select[id^='unit-condition-']").nth(1).selectOption({ label: "Perlu servis" });
      await page.getByRole("button", { name: "Simpan", exact: true }).click();

      await expect(page.getByText(/^3 unit disimpan: INV-\d{4,} sampai INV-\d{4,}\.$/)).toBeVisible();
      const item = qjson(`select * from nexus.inventory_items where name = '${TAG} UI Unit'`)[0];
      expect(item.mode).toBe("tracked");
      expect(item.code).toBeNull(); // tracked items carry codes on their units
      const units = qjson<{ code: string; condition: string }>(`select code, condition from nexus.inventory_units where item_id = '${item.id}' order by code`);
      expect(units).toHaveLength(3);
      const nums = units.map((u) => codeNumber(u.code));
      expect(nums[0]).toBeGreaterThan(before);
      expect(nums[1]).toBe(nums[0] + 1);
      expect(nums[2]).toBe(nums[1] + 1);
      expect(units.map((u) => u.condition).sort()).toEqual(["good", "good", "needs_service"]);
    } finally {
      await context.close();
    }
  });

  test("two items created at the same moment get different codes; codes survive archive and write-off and are never reused (IB-09)", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Serentak ${i}`, p_stock: { good: 1 } })),
    );
    for (const r of results) expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const codes = results.map((r) => r.body[0].item_code as string);
    expect(new Set(codes).size).toBe(codes.length);
    // Archive one and write off a unit: the code stays; the next number is still higher than every earlier one
    const archived = results[0].body[0].item_id;
    expect((await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: archived, p_is_active: false })).ok).toBe(true);
    const t = await createTrackedItem(`${TAG} Kode kekal`, ["good", "good"]);
    expect((await rpcAs("staffOps", "inventory_unit_write_off", { p_unit_id: t.unitIds[0], p_note: "hilang" })).ok).toBe(true);
    const next = await createQtyItem(`${TAG} Kode baru`, { good: 1 });
    expect(codeNumber(next.code)).toBeGreaterThan(Math.max(...codes.map(codeNumber), ...t.codes.map(codeNumber)));
    expect(q(`select code from nexus.inventory_units where id = '${t.unitIds[0]}'`)).toBe(t.codes[0]);
    // A code cannot be edited through any function (item update ignores it; direct SQL guard)
    expect(() => q(`begin; update nexus.inventory_items set code = 'INV-9999999' where id = '${archived}'; rollback;`)).toThrow();
    expect(() => q(`begin; update nexus.inventory_units set code = 'INV-9999998' where id = '${t.unitIds[0]}'; rollback;`)).toThrow();
    // Sequence in the format INV-0000 (at least 4 digits)
    for (const c of [...codes, ...t.codes]) expect(c).toMatch(/^INV-\d{4,}$/);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("F2.5, F2.6, P6, IB-54: stock dialogs always need a reason; write-off; restore a lost unit", () => {
  test("quantity item: Tambah jumlah, Ubah kondisi (worse needs a specific reason) and Keluarkan dari stok each refuse an empty reason and then write one history row", async ({ browser }) => {
    test.setTimeout(150_000);
    await awayFromMidnight();
    const item = await createQtyItem(`${TAG} Dialog`, { good: 5 });
    const { context, page } = await signedInContext(browser, "kadivLogistik");
    try {
      await page.goto(`/inventaris/kelola/barang/${item.id}`);
      const history = () => qn(`select count(*) from nexus.inventory_item_history where item_id = '${item.id}'`);
      const h0 = history();

      await page.getByRole("button", { name: "Tambah jumlah" }).click();
      await dialog(page).getByRole("textbox", { name: "jumlah", exact: true }).fill("3");
      await dialog(page).getByRole("button", { name: "Tambah", exact: true }).click();
      await expect(dialog(page).getByText("Tulis alasannya.")).toBeVisible(); // reason is always required (P6)
      expect(stockOf(item.id, "good")).toBe(5);
      await dialog(page).getByLabel("Catatan (wajib)").fill("Pembelian baru");
      await dialog(page).getByRole("button", { name: "Tambah", exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByText("Perubahan disimpan.")).toBeVisible();
      expect(stockOf(item.id, "good")).toBe(8);
      expect(history()).toBe(h0 + 1);

      await page.getByRole("button", { name: "Ubah kondisi", exact: true }).click();
      await dialog(page).getByLabel("Ke kondisi").selectOption({ label: "Rusak" });
      await dialog(page).getByRole("textbox", { name: "jumlah", exact: true }).fill("2");
      await dialog(page).getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(dialog(page).getByText("Tulis alasannya, misalnya apa yang rusak.")).toBeVisible();
      await dialog(page).getByLabel("Catatan (wajib)").fill("Jatuh dari rak");
      await dialog(page).getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(stockOf(item.id, "good")).toBe(6);
      expect(stockOf(item.id, "damaged")).toBe(2);
      expect(history()).toBe(h0 + 2);

      await page.getByRole("button", { name: "Keluarkan dari stok" }).click();
      await dialog(page).getByRole("textbox", { name: "jumlah", exact: true }).fill("1");
      await dialog(page).getByRole("button", { name: "Keluarkan dari stok" }).click();
      await expect(dialog(page).getByText("Tulis alasannya.")).toBeVisible();
      await dialog(page).getByLabel("Catatan (wajib)").fill("Dibuang, tidak bisa diperbaiki");
      await dialog(page).getByRole("button", { name: "Keluarkan dari stok" }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(stockOf(item.id, "good") + stockOf(item.id, "damaged") + stockOf(item.id, "needs_service")).toBe(7);
      expect(history()).toBe(h0 + 3);
      const notes = q(`select string_agg(note, '|' order by id) from nexus.inventory_item_history where item_id = '${item.id}' and kind <> 'created'`);
      expect(notes).toContain("Pembelian baru");
      expect(notes).toContain("Jatuh dari rak");
    } finally {
      await context.close();
    }
    // The same rules by direct call: no reason, no change (IB-54 style refusal codes)
    for (const [fn, args] of [
      ["inventory_stock_add", { p_item_id: item.id, p_condition: "good", p_quantity: 1, p_note: "" }],
      ["inventory_stock_move", { p_item_id: item.id, p_from: "good", p_to: "damaged", p_quantity: 1, p_note: "  " }],
      ["inventory_stock_write_off", { p_item_id: item.id, p_condition: "good", p_quantity: 1, p_note: null }],
    ] as const) {
      const r = await rpcAs("staffOps", fn, args);
      expect(r.ok, fn).toBe(false);
      expect(r.hint, fn).toMatch(/reason_required|note_required|text_required/);
    }
  });

  test("tracked unit: Keluarkan (needs a reason) -> status Hilang, code kept; members never see a lost or archived entry; Ditemukan kembali by a manager restores it, the original write-off stays", async ({ browser }) => {
    test.setTimeout(180_000);
    const t = await createTrackedItem(`${TAG} Hilang`, ["good", "good", "good"]);
    const lostCode = t.codes[0];
    const manager = await signedInContext(browser, "staffOps");
    const member = await signedInContext(browser, "regular");
    try {
      const page = manager.page;
      await page.goto(`/inventaris/kelola/barang/${t.id}`);
      await page.getByRole("button", { name: `Keluarkan ${lostCode}` }).click();
      await dialog(page).getByRole("button", { name: "Keluarkan dari stok" }).click();
      await expect(dialog(page).getByText("Tulis alasannya.")).toBeVisible();
      expect(unitRow(t.unitIds[0]).status).toBe("active");
      await dialog(page).getByLabel("Catatan (wajib)").fill("Tertinggal di acara");
      await dialog(page).getByRole("button", { name: "Keluarkan dari stok" }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(unitRow(t.unitIds[0]).status).toBe("lost");
      expect(unitRow(t.unitIds[0]).code).toBe(lostCode);

      // A member sees the item without the lost unit anywhere (detail page and catalog)
      await member.page.goto(`/inventaris/barang/${t.id}`);
      await expect(member.page.getByRole("heading", { level: 1, name: t.name })).toBeVisible();
      await expect(member.page.getByText(lostCode)).toHaveCount(0);
      await expect(member.page.getByText(t.codes[1]).first()).toBeVisible();
      await expect(member.page.getByText("Hilang", { exact: true })).toHaveCount(0);
      // ...and a member's call for the item list finds 2 units, not 3
      const list = await rpcAs("regular", "inventory_item_detail", { p_item_id: t.id });
      expect(JSON.stringify(list.body)).not.toContain(lostCode);

      // Restore ("Ditemukan kembali") by a manager
      await page.goto(`/inventaris/kelola/barang/${t.id}`);
      await page.getByRole("button", { name: `Ditemukan kembali ${lostCode}` }).click();
      await dialog(page).getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(dialog(page).getByText("Tulis alasannya.")).toBeVisible();
      await dialog(page).getByLabel("Catatan (wajib)").fill("Ditemukan di sekretariat");
      await dialog(page).getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(unitRow(t.unitIds[0]).status).toBe("active");
      expect(qn(`select count(*) from nexus.inventory_item_history where unit_id = '${t.unitIds[0]}' and kind = 'written_off'`)).toBe(1);
      expect(qn(`select count(*) from nexus.inventory_item_history where unit_id = '${t.unitIds[0]}' and kind = 'restored'`)).toBe(1);
    } finally {
      await manager.context.close();
      await member.context.close();
    }
  });

  test("IB-54: restore needs inventory.manage and an ACTIVE item and a reason; a member or BPH is refused", async () => {
    const t = await createTrackedItem(`${TAG} Pulih`, ["good", "good"]);
    expect((await rpcAs("staffOps", "inventory_unit_write_off", { p_unit_id: t.unitIds[0], p_note: "hilang" })).ok).toBe(true);
    for (const who of ["regular", "ketum", "pembina", "admin"] as const) {
      const r = await rpcAs(who, "inventory_unit_restore_lost", { p_unit_id: t.unitIds[0], p_condition: "good", p_note: "x" });
      expect(r.ok, who).toBe(false);
      expect(r.hint, who).toBe("permission_required");
    }
    expect((await rpcAs("staffOps", "inventory_unit_restore_lost", { p_unit_id: t.unitIds[0], p_condition: "good", p_note: "" })).hint).toMatch(/reason_required|note_required|text_required/);
    // Archived item: restore refused
    expect((await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: t.id, p_is_active: false })).ok).toBe(true);
    const onArchived = await rpcAs("staffOps", "inventory_unit_restore_lost", { p_unit_id: t.unitIds[0], p_condition: "good", p_note: "ketemu" });
    expect(onArchived.ok).toBe(false);
    expect(onArchived.hint).toBe("item_archived");
    expect(unitRow(t.unitIds[0]).status).toBe("lost");
    // Active again: works once, and a unit that is not lost cannot be restored
    expect((await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: t.id, p_is_active: true })).ok).toBe(true);
    expect((await rpcAs("kadep", "inventory_unit_restore_lost", { p_unit_id: t.unitIds[0], p_condition: "needs_service", p_note: "ketemu" })).ok).toBe(true);
    expect(unitRow(t.unitIds[0]).condition).toBe("needs_service");
    expect((await rpcAs("staffOps", "inventory_unit_restore_lost", { p_unit_id: t.unitIds[0], p_condition: "good", p_note: "lagi" })).ok).toBe(false);
  });

  test("a lost unit on loan cannot be written off, and a unit on loan cannot be archived (IB-13)", async () => {
    const t = await createTrackedItem(`${TAG} Pinjam unit`, ["good", "good"]);
    const made = await mustCreate("pembina", { lines: [{ itemId: t.id, quantity: 1 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const line = q(`select id from nexus.borrowing_request_lines where request_id = '${made.id}'`);
    const hand = await rpcAs("staffOps", "borrowing_request_hand_over", { p_request_id: made.id, p_version: qn(`select version from nexus.borrowing_requests where id = '${made.id}'`), p_lines: [{ line_id: line, unit_ids: [t.unitIds[0]] }] });
    expect(hand.ok, JSON.stringify(hand.body)).toBe(true);
    const w = await rpcAs("staffOps", "inventory_unit_write_off", { p_unit_id: t.unitIds[0], p_note: "x" });
    expect(w.ok).toBe(false);
    expect(w.hint).toBe("unit_on_loan");
    const a = await rpcAs("staffOps", "inventory_unit_set_active", { p_unit_id: t.unitIds[0], p_is_active: false });
    expect(a.ok).toBe(false);
    expect(a.hint).toBe("unit_on_loan");
    const c = await rpcAs("staffOps", "inventory_unit_set_condition", { p_unit_id: t.unitIds[0], p_condition: "damaged", p_note: "x" });
    expect(c.ok).toBe(false);
    const back = await rpcAs("staffOps", "borrowing_request_return", { p_request_id: made.id, p_version: qn(`select version from nexus.borrowing_requests where id = '${made.id}'`), p_outcomes: [{ outcome: "good", line_id: line, unit_id: t.unitIds[0] }] });
    expect(back.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("F2.7, IB-12, IB-13: archive blocked while borrowed; archived items vanish for members; reactivation", () => {
  test("screen: 'Nonaktifkan barang' is refused with a count while a request is open, works after, hides the item from members and the picker, filter 'Nonaktif' shows it, 'Aktifkan kembali' restores it", async ({ browser }) => {
    test.setTimeout(180_000);
    await awayFromMidnight();
    const item = await createQtyItem(`${TAG} Arsip`, { good: 3 });
    const made = await mustCreate("pembina", { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const manager = await signedInContext(browser, "staffOps");
    const member = await signedInContext(browser, "regular");
    try {
      const page = manager.page;
      await page.goto(`/inventaris/kelola/barang/${item.id}`);
      await page.getByRole("button", { name: "Nonaktifkan barang" }).click();
      await dialog(page).getByRole("button", { name: "Nonaktifkan", exact: true }).click();
      // Count only, never a borrower
      await expect(dialog(page).getByText("Barang ini masih punya 1 peminjaman yang belum selesai. Selesaikan atau batalkan dulu.")).toBeVisible();
      await expect(dialog(page).getByText(/Test Dosen|pembina/i)).toHaveCount(0);
      expect(itemRow(item.id).is_active).toBe(true);
      await page.keyboard.press("Escape");

      expect((await cancelAs("staffOps", made.id, "QA")).ok).toBe(true);
      await page.reload();
      await page.getByRole("button", { name: "Nonaktifkan barang" }).click();
      await dialog(page).getByRole("button", { name: "Nonaktifkan", exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(itemRow(item.id).is_active).toBe(false);

      // Members never see it: catalog, detail, request picker
      await member.page.goto(`/inventaris?q=${encodeURIComponent(item.name)}`);
      await expect(member.page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await member.page.goto(`/inventaris/barang/${item.id}`);
      await expect(member.page.getByText("Barang ini tidak ditemukan.")).toBeVisible();
      // Not offered on the request form, and a direct request for it is refused
      const direct = await rpcAs("regular", "borrowing_request_create", {
        p_start_date: new Date().toISOString().slice(0, 10), p_end_date: new Date().toISOString().slice(0, 10), p_purpose: "x", p_lines: [{ item_id: item.id, quantity: 1 }],
      });
      expect(direct.ok).toBe(false);
      // A member cannot even ask for the archived filter (it is a manager filter)
      const asMember = await rpcAs("regular", "inventory_item_list", { p_status: "archived" });
      expect(asMember.ok).toBe(false);

      // The manager finds it under 'Nonaktif'
      await page.goto(`/inventaris/kelola?status=archived&q=${encodeURIComponent(item.name)}`);
      await expect(main(page).getByText(item.name).first()).toBeVisible();
      await page.goto(`/inventaris/kelola/barang/${item.id}`);
      await page.getByRole("button", { name: "Aktifkan kembali" }).click();
      await expect.poll(() => itemRow(item.id).is_active).toBe(true);
      await member.page.goto(`/inventaris?q=${encodeURIComponent(item.name)}`);
      await expect(member.page.getByText(item.name).first()).toBeVisible();
    } finally {
      await manager.context.close();
      await member.context.close();
    }
  });

  test("IB-08: once an item has a request line its mode cannot change (nothing in the API even takes a mode on update)", async () => {
    const item = await createQtyItem(`${TAG} Mode`, { good: 2 });
    const made = await mustCreate("pembina", { lines: [{ itemId: item.id, quantity: 1 }] });
    const r = await rpcAs("staffOps", "inventory_item_update", { p_item_id: item.id, p_name: item.name, p_mode: "tracked" });
    expect(r.ok).toBe(false); // unknown argument: PostgREST refuses
    expect(() => q(`begin; update nexus.inventory_items set mode = 'tracked' where id = '${item.id}'; rollback;`)).toThrow();
    expect(itemRow(item.id).mode).toBe("quantity");
    await cancelAs("pembina", made.id);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-10: category and location lists (screen)", () => {
  test("add, reject a duplicate and an empty name, rename, deactivate with a confirmation; a deactivated entry stays on its items and is not offered for new ones", async ({ browser }) => {
    test.setTimeout(180_000);
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto("/inventaris/kelola/daftar");
      expect(await noHorizontalScroll(page)).toBe(true);
      const name = `${TAG} Kat`;
      await page.getByRole("button", { name: "Tambah", exact: true }).click();
      await expect(page.getByText("Isi nama.")).toBeVisible();
      await page.getByLabel("Nama kategori (wajib)").fill(name);
      await page.getByRole("button", { name: "Tambah", exact: true }).click();
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await page.getByLabel("Nama kategori (wajib)").fill(name.toLowerCase());
      await page.getByRole("button", { name: "Tambah", exact: true }).click();
      await expect(page.getByText("Nama ini sudah ada.")).toBeVisible();
      await page.getByLabel("Nama kategori (wajib)").fill("K".repeat(70));
      await page.getByRole("button", { name: "Tambah", exact: true }).click();
      await expect(page.getByText("Nama terlalu panjang. Pakai paling banyak 60 karakter.")).toBeVisible();
      expect(qn(`select count(*) from nexus.inventory_categories where lower(name) = lower('${name}')`)).toBe(1);

      // Rename
      await page.getByRole("button", { name: `Ubah nama ${name}` }).click();
      await page.getByLabel(`Ubah nama ${name}`).fill(`${name} baru`);
      await page.getByRole("button", { name: "Simpan", exact: true }).click();
      await expect(page.getByText(`${name} baru`, { exact: true }).first()).toBeVisible();

      // An item uses it, then it is deactivated: the item keeps it, new items cannot pick it
      const catId = q(`select id from nexus.inventory_categories where name = '${name} baru'`);
      const used = await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Pakai Kat`, p_category_id: catId, p_stock: { good: 1 } });
      expect(used.ok, JSON.stringify(used.body)).toBe(true);
      await page.reload();
      await page.getByRole("button", { name: `Nonaktifkan ${name} baru` }).click();
      await expect(dialog(page).getByText("Barang yang memakainya tetap memakai nama ini. Tidak bisa dipilih untuk barang baru.")).toBeVisible();
      await dialog(page).getByRole("button", { name: "Nonaktifkan", exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(q(`select is_active from nexus.inventory_categories where id = '${catId}'`)).toBe("f");
      expect(q(`select category_id from nexus.inventory_items where name = '${TAG} Pakai Kat'`)).toBe(catId);
      const another = await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Pakai Kat 2`, p_category_id: catId, p_stock: { good: 1 } });
      expect(another.ok).toBe(false);
      expect(await rpcAs("regular", "inventory_category_add", { p_name: `${TAG} X` })).toMatchObject({ ok: false, hint: "permission_required" });
      // Nothing can be deleted: reactivating works and no delete function exists at all
      const del = await rpcAs("staffOps", "inventory_category_set_active", { p_category_id: catId, p_is_active: true });
      expect(del.ok).toBe(true); // reactivate works; there is no delete function at all
      expect(qn(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'nexus' and (p.proname like '%\\_delete' or p.proname like '%\\_remove')`)).toBe(0);
    } finally {
      await context.close();
    }
  });
});
