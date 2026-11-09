// Inventory and Borrowing: the whole borrowing state machine in the browser at 390 px (spec F3-F10, IB-14..IB-34).
// Data is created per test run with a unique QA tag and ended/archived afterwards (nexus data is append-only).
import { expect, test, type Page } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  addDays,
  approveAs,
  awayFromMidnight,
  createQtyItem,
  createTrackedItem,
  dialog,
  fillDate,
  handOverAs,
  itemRow,
  jakartaToday,
  lendQty,
  lineIds,
  lineOf,
  main,
  makeJpeg,
  emailOf,
  memberId,
  mustCreate,
  noHorizontalScroll,
  q,
  qjson,
  nameOf,
  qn,
  refOf,
  reqRow,
  requestUrl,
  returnAs,
  rpcAs,
  stockOf,
  stubEvidenceRoute,
  sweepQa,
  tag,
  unitRow,
  requesterWithRoom,
  type PersonaKey,
  type Qty,
  type Tracked,
} from "./inventaris-helpers";

const TAG = tag();

test.afterAll(async () => {
  await sweepQa(TAG);
});

const chip = (page: Page, text: string | RegExp) => main(page).getByText(text).first();

// ---------------------------------------------------------------------------------------------
test.describe.serial("F3-F6, IB-14, IB-19, IB-21, IB-26..IB-30, IB-52, IB-53: submit -> approve (lower quantity) -> hand over -> return (good, damaged, lost) -> correction once", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  let qty: Qty;
  let tracked: Tracked;
  let A: PersonaKey;
  let B: PersonaKey;
  let id = "";
  let ref = "";

  test("setup: one counted item (10 good) and one tracked item (3 good units), created through the Operations functions", async () => {
    await awayFromMidnight();
    const a = requesterWithRoom(3);
    test.skip(a === null, "no requester has daily room left (20 per member per Jakarta day); rerun after midnight WIB");
    A = a!;
    B = requesterWithRoom(2, [A]) ?? A;
    qty = await createQtyItem(`${TAG} Hitung`, { good: 10 });
    tracked = await createTrackedItem(`${TAG} Unit`, ["good", "good", "good"]);
    expect(qty.code).toMatch(/^INV-\d{4,}$/);
    expect(tracked.codes).toHaveLength(3);
    for (const c of tracked.codes) expect(c).toMatch(/^INV-\d{4,}$/);
    ready = true;
  });

  test("member submits at 390 px (start today): lands on the detail with 'Cek statusnya', status Diajukan, requester = the session member, holds no stock", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, A);
    try {
      const today = jakartaToday();
      await page.goto("/inventaris/ajukan");
      await expect(page.getByRole("heading", { level: 1, name: "Ajukan Peminjaman" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      // Mobile-first fields: at least 44 px high and 16 px text (IB-47)
      const purposeBox = await page.getByLabel("Keperluan atau kegiatan (wajib)").boundingBox();
      expect(purposeBox!.height).toBeGreaterThanOrEqual(44);
      expect(await page.getByLabel("Mulai (wajib)").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

      await fillDate(page, "Mulai (wajib)", today);
      await fillDate(page, "Sampai (wajib)", addDays(today, 1));
      for (const name of [qty.name, tracked.name]) {
        await page.getByRole("button", { name: "Tambah barang" }).click();
        await expect(dialog(page)).toBeVisible();
        await dialog(page).getByLabel("Cari barang").fill(name);
        await dialog(page).getByRole("button", { name: new RegExp(name) }).click();
        await expect(dialog(page)).toHaveCount(0);
      }
      await page.getByLabel(`Jumlah ${qty.name}`, { exact: true }).fill("3");
      await page.getByLabel(`Jumlah ${tracked.name}`, { exact: true }).fill("2");
      // Live availability, counts only
      await expect(page.getByText(/Tersedia 10 dari 10 pada/)).toBeVisible();
      await expect(page.getByText(/Tersedia 3 dari 3 pada/)).toBeVisible();
      await page.getByLabel("Keperluan atau kegiatan (wajib)").fill(`${TAG} kegiatan`);
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();

      await expect(page).toHaveURL(/\/inventaris\/pengajuan\/PJM-\d{4,}\?notice=sent/);
      ref = /PJM-\d+/.exec(page.url())![0];
      await expect(page.getByText("Pengajuan terkirim. Cek statusnya di Peminjaman Saya.")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: `Pengajuan ${ref}` })).toBeVisible();
      await expect(chip(page, "Diajukan")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);

      const r = qjson(`select * from nexus.borrowing_requests where reference = '${ref}'`)[0];
      id = r.id;
      expect(r.requester_member_id).toBe(await memberId(emailOf(A))); // session member, never client input (IB-14)
      expect(r.status).toBe("submitted");
      expect(r.period_id).toBe(q("select id from public.periods where is_active"));
      expect(r.purpose).toBe(`${TAG} kegiatan`);
      expect(qn(`select count(*) from nexus.borrowing_request_lines where request_id = '${id}'`)).toBe(2);
      // IB-19: a Diajukan request holds nothing
      const free = await rpcAs(B, "inventory_item_availability", { p_item_id: qty.id, p_from: today, p_to: addDays(today, 1) });
      expect(free.body[0].free_qty).toBe(10);

      // It shows up in Peminjaman Saya
      await page.goto("/inventaris/saya");
      await expect(page.getByRole("link", { name: new RegExp(ref) }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("head (Kepala Departemen) lowers a quantity: the note becomes required, then approves; approver, time, note and one history row are stored; the quantity is now held", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "kadep");
    try {
      await page.goto(requestUrl(ref));
      await expect(page.getByRole("heading", { level: 2, name: "Barang dan ketersediaan" })).toBeVisible();
      await expect(page.getByText(/Tersedia sekarang 10 dari 10/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Setujui", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Tolak", exact: true })).toBeVisible();
      // Requester name from PI-CORE, no contact data
      await expect(main(page).getByText(nameOf(A), { exact: true })).toBeVisible();

      await page.getByRole("button", { name: `Kurangi jumlah disetujui ${qty.name}` }).click();
      await page.getByRole("button", { name: "Setujui", exact: true }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByLabel("Catatan (wajib)")).toBeVisible(); // lowered -> note required
      await dialog(page).getByRole("button", { name: "Setujui pengajuan" }).click();
      await expect(dialog(page).getByText("Tulis kenapa jumlahnya dikurangi.")).toBeVisible();
      await dialog(page).getByLabel("Catatan (wajib)").fill("Stok dipakai kegiatan lain");
      await dialog(page).getByRole("button", { name: "Setujui pengajuan" }).click();

      await expect(page).toHaveURL(/notice=approved/);
      await expect(page.getByText("Pengajuan disetujui.")).toBeVisible();
      await expect(chip(page, "Disetujui")).toBeVisible();
      await expect(page.getByRole("button", { name: "Setujui", exact: true })).toHaveCount(0);

      const r = reqRow(id);
      expect(r.status).toBe("approved");
      expect(r.decided_by).toBe(await memberId("kadep@nexus.test"));
      expect(r.decided_at).toBeTruthy();
      expect(r.decision_note).toBe("Stok dipakai kegiatan lain");
      expect(Number(q(`select quantity_approved from nexus.borrowing_request_lines where id = '${lineOf(id, qty.id)}'`))).toBe(2);
      expect(Number(q(`select quantity_approved from nexus.borrowing_request_lines where id = '${lineOf(id, tracked.id)}'`))).toBe(2);
      expect(qn(`select count(*) from nexus.borrowing_status_history where request_id = '${id}' and to_status = 'approved'`)).toBe(1);
      // IB-19: approval holds the approved quantity (2 of 10, not the requested 3)
      const today = jakartaToday();
      const free = await rpcAs(B, "inventory_item_availability", { p_item_id: qty.id, p_from: today, p_to: addDays(today, 1) });
      expect(free.body[0].free_qty).toBe(8);
    } finally {
      await context.close();
    }
  });

  test("Operations staff hands over (start date = today): tracked units picked by code, status Dipinjam, recorder named in the history", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto(requestUrl(ref));
      await expect(page.getByRole("button", { name: "Setujui", exact: true })).toHaveCount(0); // staff is not a head
      await page.getByRole("link", { name: "Serahkan barang" }).click();
      await expect(page).toHaveURL(/serah-terima$/);
      expect(await noHorizontalScroll(page)).toBe(true);
      // Only the approved quantity can be handed over (stepper max)
      await expect(page.getByLabel(`jumlah diserahkan ${qty.name}`, { exact: true })).toHaveValue("2");
      // Try to hand over nothing for the tracked line: the form asks for at least one thing overall only when everything is zero
      await page.getByLabel(`jumlah diserahkan ${qty.name}`, { exact: true }).fill("0");
      await page.getByRole("button", { name: "Catat serah terima" }).click();
      await expect(page.getByText(/Pilih minimal satu barang yang diserahkan/)).toBeVisible();
      await page.getByLabel(`jumlah diserahkan ${qty.name}`, { exact: true }).fill("2");
      // Pick two of the three units (the third stays free)
      for (const code of tracked.codes.slice(0, 2)) await page.locator("label", { hasText: code }).locator("input[type=checkbox]").check();
      await page.getByRole("button", { name: "Catat serah terima" }).click();

      await expect(page).toHaveURL(/notice=handed_over/);
      await expect(page.getByText("Serah terima tercatat. Status: Dipinjam.")).toBeVisible();
      await expect(chip(page, "Dipinjam")).toBeVisible();
      await expect(main(page).getByText(new RegExp(`Unit: ${tracked.codes[0]}, ${tracked.codes[1]}`))).toBeVisible();
      const r = reqRow(id);
      expect(r.status).toBe("borrowed");
      expect(r.handed_over_by).toBe(await memberId("staff.ops@nexus.test"));
      expect(qn(`select count(*) from nexus.borrowing_line_units where line_id = '${lineOf(id, tracked.id)}'`)).toBe(2);
      await expect(page.getByText(/Dicatat? Test Staff Operasional|dicatat Test Staff Operasional/).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("one unit cannot sit on two open loans: a second request cannot be handed the same units (IB-27)", async () => {
    const other = await mustCreate(B, { lines: [{ itemId: tracked.id, quantity: 1 }] });
    const approved = await approveAs("kadep", other.id);
    expect(approved.ok, JSON.stringify(approved.body)).toBe(true);
    // The first request holds 2 of 3 units; the third unit can go out, the two on loan cannot
    const taken = await handOverAs("staffOps", other.id, [{ line_id: lineOf(other.id, tracked.id), unit_ids: [tracked.unitIds[0]] }]);
    expect(taken.ok).toBe(false);
    expect(taken.hint).toBe("unit_not_available");
    const freeUnit = q(`select u.id from nexus.inventory_units u where u.item_id = '${tracked.id}' and u.id not in (select unit_id from nexus.borrowing_line_units where return_id is null) limit 1`);
    const ok = await handOverAs("staffOps", other.id, [{ line_id: lineOf(other.id, tracked.id), unit_ids: [freeUnit] }]);
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    const back = await returnAs("staffOps", other.id, [{ outcome: "good", line_id: lineOf(other.id, tracked.id), unit_id: freeUnit }]);
    expect(back.ok, JSON.stringify(back.body)).toBe(true);
  });

  test("return in the browser: Qty good, one unit damaged (note + condition + real JPEG), one unit lost (note + JPEG); refused without a photo or a note; 'Ada masalah' chip", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await stubEvidenceRoute(page);
      await page.goto(requestUrl(ref));
      await page.getByRole("link", { name: "Terima pengembalian" }).click();
      await expect(page).toHaveURL(/terima-kembali$/);
      expect(await noHorizontalScroll(page)).toBe(true);

      const [damagedCode, lostCode] = tracked.codes.slice(0, 2);
      const block = (code: string) => page.locator("li", { has: page.getByRole("group", { name: code, exact: true }) });
      await page.getByRole("group", { name: damagedCode, exact: true }).getByText("Rusak", { exact: true }).click();
      await page.getByRole("group", { name: lostCode, exact: true }).getByText("Hilang", { exact: true }).click();

      // Nothing filled in: every missing piece is named (IB-29)
      await page.getByRole("button", { name: "Catat pengembalian" }).click();
      await expect(page.getByText(/Ada \d+ isian yang perlu diperbaiki/)).toBeVisible();
      await expect(main(page).getByText("Pilih kondisi barang sekarang.").first()).toBeVisible();
      await expect(main(page).getByText("Tambahkan minimal satu foto.").first()).toBeVisible();
      expect(qn(`select count(*) from nexus.borrowing_line_returns where line_id = '${lineOf(id, tracked.id)}'`)).toBe(0);

      const jpeg = await makeJpeg(page);
      // Damaged: condition Perlu servis, note, photo
      await block(damagedCode).getByText("Perlu servis", { exact: true }).click();
      await block(damagedCode).getByLabel("Catatan (wajib)").fill("Kabel putus di ujung");
      await block(damagedCode).locator("input[type=file][multiple]").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await expect(block(damagedCode).getByText("Terunggah", { exact: true })).toBeVisible();
      // Lost: note, photo
      await block(lostCode).getByLabel("Catatan (wajib)").fill("Tertinggal di lokasi kegiatan");
      await block(lostCode).locator("input[type=file][multiple]").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await expect(block(lostCode).getByText("Terunggah", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Catat pengembalian" }).click();
      await expect(dialog(page).getByText("Simpan pengembalian?")).toBeVisible();
      await expect(dialog(page).getByText(/Kembali baik 2, rusak 1, hilang 1\. Masih di peminjam: 0\./)).toBeVisible();
      await dialog(page).getByRole("button", { name: "Simpan pengembalian" }).click();

      await expect(page).toHaveURL(/notice=returned_issue/);
      await expect(page.getByText("Pengembalian tercatat. Ada barang rusak atau hilang.")).toBeVisible();
      await expect(chip(page, "Dikembalikan")).toBeVisible();
      await expect(chip(page, "Ada masalah")).toBeVisible();

      expect(reqRow(id).status).toBe("returned");
      expect(reqRow(id).has_issue).toBe(true);
      // Damaged unit moved to the stated condition; lost unit written off with its code kept (IB-30)
      const dmg = unitRow(tracked.unitIds[tracked.codes.indexOf(damagedCode)]);
      expect(dmg.condition).toBe("needs_service");
      const lost = unitRow(tracked.unitIds[tracked.codes.indexOf(lostCode)]);
      expect(lost.status).toBe("lost");
      expect(lost.code).toBe(lostCode);
      expect(stockOf(qty.id, "good")).toBe(10); // good return frees the stock at once
      expect(qn(`select count(*) from nexus.borrowing_evidence_photos p join nexus.borrowing_line_returns r on r.id = p.line_return_id where r.line_id = '${lineOf(id, tracked.id)}'`)).toBe(2);
      // History rows linked to the request (IB-30)
      expect(qn(`select count(*) from nexus.inventory_item_history where request_id = '${id}' and kind in ('condition_changed','written_off')`)).toBeGreaterThanOrEqual(2);
      // IB-52: the good return is lendable at once, even inside the old range
      const today = jakartaToday();
      const free = await rpcAs(B, "inventory_item_availability", { p_item_id: qty.id, p_from: today, p_to: addDays(today, 1) });
      expect(free.body[0].free_qty).toBe(10);
    } finally {
      await context.close();
    }
  });

  test("correction: 'Koreksi pengembalian' needs a reason, works once, the button is gone afterwards and a second call is refused (IB-53)", async ({ browser }) => {
    test.setTimeout(180_000);
    const handler = await signedInContext(browser, "staffOps");
    const viewer = await signedInContext(browser, "ketum");
    try {
      // BPH (view only) never gets the button
      await viewer.page.goto(requestUrl(ref));
      await expect(viewer.page.getByRole("heading", { level: 1, name: `Pengajuan ${ref}` })).toBeVisible();
      await expect(viewer.page.getByRole("button", { name: "Koreksi pengembalian" })).toHaveCount(0);
      await expect(viewer.page.getByRole("link", { name: /Serahkan barang|Terima pengembalian/ })).toHaveCount(0);

      const page = handler.page;
      await page.goto(requestUrl(ref));
      await page.getByRole("button", { name: "Koreksi pengembalian" }).click();
      await expect(dialog(page).getByText("Kembalikan status ke Dipinjam?")).toBeVisible();
      await dialog(page).getByRole("button", { name: "Koreksi pengembalian" }).click();
      await expect(dialog(page).getByText("Tulis alasan koreksi.")).toBeVisible();
      await dialog(page).getByLabel("Alasan (wajib)").fill("Salah catat, unit tertukar");
      await dialog(page).getByRole("button", { name: "Koreksi pengembalian" }).click();
      await expect(page).toHaveURL(/notice=corrected/);
      await expect(page.getByText("Pengembalian dikoreksi. Status kembali Dipinjam.")).toBeVisible();
      expect(reqRow(id).status).toBe("borrowed");
      // Effects undone: the lost unit is active again, the damaged unit is good again
      expect(unitRow(tracked.unitIds[0]).condition).toBe("good");
      expect(unitRow(tracked.unitIds[1]).status).toBe("active");

      // Return again, all good
      const again = await returnAs("staffOps", id, [
        { outcome: "good", line_id: lineOf(id, qty.id), quantity: 2 },
        { outcome: "good", line_id: lineOf(id, tracked.id), unit_id: tracked.unitIds[0] },
        { outcome: "good", line_id: lineOf(id, tracked.id), unit_id: tracked.unitIds[1] },
      ]);
      expect(again.ok, JSON.stringify(again.body)).toBe(true);
      await page.goto(requestUrl(ref));
      await expect(chip(page, "Dikembalikan")).toBeVisible();
      await expect(page.getByRole("button", { name: "Koreksi pengembalian" })).toHaveCount(0); // once only: the button is gone
      const second = await rpcAs("staffOps", "borrowing_request_correct_return", { p_request_id: id, p_version: reqRow(id).version, p_reason: "lagi" });
      expect(second.ok).toBe(false);
      expect(second.hint).toBe("already_corrected");
      expect(reqRow(id).status).toBe("returned");
    } finally {
      await handler.context.close();
      await viewer.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("F4, F7, F8, IB-17, IB-21, IB-25: reject, cancel, extend, too-early handover", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  let item: Qty;
  let A: PersonaKey;
  let B: PersonaKey;

  test("setup", async () => {
    await awayFromMidnight();
    const a = requesterWithRoom(7);
    test.skip(a === null, "no requester has daily room left; rerun after midnight WIB");
    A = a!;
    B = requesterWithRoom(3, [A]) ?? A;
    item = await createQtyItem(`${TAG} Tolak`, { good: 4 });
    ready = true;
  });

  test("reject: without a note the dialog refuses; with a note the requester reads it, can ask again, and the request is terminal", async ({ browser }) => {
    test.setTimeout(120_000);
    const made = await mustCreate(A, { lines: [{ itemId: item.id, quantity: 1 }] });
    const head = await signedInContext(browser, "kadivLogistik");
    const member = await signedInContext(browser, A);
    try {
      await head.page.goto(requestUrl(made.ref));
      await head.page.getByRole("button", { name: "Tolak", exact: true }).click();
      await dialog(head.page).getByRole("button", { name: "Tolak pengajuan" }).click();
      await expect(dialog(head.page).getByText("Tulis alasan penolakan, supaya pemohon tahu.")).toBeVisible();
      expect(reqRow(made.id).status).toBe("submitted");
      await dialog(head.page).getByLabel("Alasan penolakan (wajib)").fill("Barang dipakai kegiatan inti");
      await dialog(head.page).getByRole("button", { name: "Tolak pengajuan" }).click();
      await expect(head.page.getByText("Pengajuan ditolak.")).toBeVisible();

      await member.page.goto(requestUrl(made.ref));
      await expect(chip(member.page, "Ditolak")).toBeVisible();
      await expect(member.page.getByText("Barang dipakai kegiatan inti").first()).toBeVisible();
      await expect(member.page.getByRole("link", { name: "Ajukan lagi" })).toBeVisible();
      await expect(member.page.getByRole("button", { name: "Batalkan pengajuan" })).toHaveCount(0);
      // Terminal: nothing moves it
      const again = await approveAs("kadep", made.id);
      expect(again.ok).toBe(false);
      expect(reqRow(made.id).status).toBe("rejected");
      expect(qn(`select count(*) from nexus.borrowing_status_history where request_id = '${made.id}'`)).toBe(2); // submitted, rejected
    } finally {
      await head.context.close();
      await member.context.close();
    }
  });

  test("cancel by the requester: Diajukan needs no reason; Disetujui needs one; stock is freed; another member cannot cancel it (IB-17, AC-30)", async ({ browser }) => {
    test.setTimeout(150_000);
    const first = await mustCreate(A, { lines: [{ itemId: item.id, quantity: 1 }] });
    const second = await mustCreate(A, { lines: [{ itemId: item.id, quantity: 3 }] });
    expect((await approveAs("kadep", second.id)).ok).toBe(true);
    const today = jakartaToday();
    const held = await rpcAs(B, "inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: addDays(today, 1) });
    expect(held.body[0].free_qty).toBe(1);

    const member = await signedInContext(browser, A);
    try {
      await member.page.goto(requestUrl(first.ref));
      await member.page.getByRole("button", { name: "Batalkan pengajuan" }).click();
      await expect(dialog(member.page).getByLabel("Alasan (boleh kosong)")).toBeVisible();
      await dialog(member.page).getByRole("button", { name: "Batalkan pengajuan" }).click();
      await expect(member.page.getByText("Pengajuan dibatalkan.")).toBeVisible();
      expect(reqRow(first.id).status).toBe("cancelled");

      // Approved: reason required
      await member.page.goto(requestUrl(second.ref));
      // another member cannot cancel it
      const stranger = await cancelByOther(second.id, B);
      expect(stranger.ok).toBe(false);
      await member.page.getByRole("button", { name: "Batalkan pengajuan" }).click();
      await expect(dialog(member.page).getByLabel("Alasan (wajib)")).toBeVisible();
      await dialog(member.page).getByRole("button", { name: "Batalkan pengajuan" }).click();
      await expect(dialog(member.page).getByText("Tulis alasan pembatalan.")).toBeVisible();
      expect(reqRow(second.id).status).toBe("approved");
      await dialog(member.page).getByLabel("Alasan (wajib)").fill("Kegiatan dibatalkan");
      await dialog(member.page).getByRole("button", { name: "Batalkan pengajuan" }).click();
      await expect(member.page.getByText("Pengajuan dibatalkan.")).toBeVisible();
      expect(reqRow(second.id).status).toBe("cancelled");
      const freed = await rpcAs(B, "inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: addDays(today, 1) });
      expect(freed.body[0].free_qty).toBe(4);
      // Cancelled is terminal: cannot be reopened or cancelled again
      expect((await approveAs("kadep", second.id)).ok).toBe(false);
    } finally {
      await member.context.close();
    }
  });

  test("no cancel after pick-up: a borrowed request has no cancel button and the function refuses (IB-17)", async ({ browser }) => {
    const made = await lendQty(A, item, 1);
    const { context, page } = await signedInContext(browser, A);
    try {
      await page.goto(requestUrl(made.ref));
      await expect(chip(page, "Dipinjam")).toBeVisible();
      await expect(page.getByRole("button", { name: "Batalkan pengajuan" })).toHaveCount(0);
      const r = await rpcAs(A, "borrowing_request_cancel", { p_request_id: made.id, p_version: reqRow(made.id).version, p_reason: "x" });
      expect(r.ok).toBe(false);
      const back = await returnAs("staffOps", made.id, [{ outcome: "good", line_id: lineOf(made.id, item.id), quantity: 1 }]);
      expect(back.ok).toBe(true);
    } finally {
      await context.close();
    }
  });

  test("extend: note required, a later date only, status unchanged, one extension row; a conflict says 'Bentrok dengan pengajuan lain'", async ({ browser }) => {
    test.setTimeout(180_000);
    const today = jakartaToday();
    const loaned = await mustCreate(A, { lines: [{ itemId: item.id, quantity: 4 }], start: today, end: addDays(today, 1) });
    expect((await approveAs("kadep", loaned.id)).ok).toBe(true);
    // A later request wants all 4 from today+3 to today+4 (pending requests hold nothing; this one is approved)
    const later = await mustCreate(B, { lines: [{ itemId: item.id, quantity: 4 }], start: addDays(today, 3), end: addDays(today, 4) });
    expect((await approveAs("kadep", later.id)).ok).toBe(true);

    const head = await signedInContext(browser, "kadep");
    try {
      const page = head.page;
      await page.goto(requestUrl(loaned.ref));
      await page.getByRole("button", { name: "Ubah tanggal kembali" }).click();
      await dialog(page).getByRole("button", { name: "Simpan tanggal baru" }).click();
      await expect(dialog(page).getByText(/^Pilih tanggal setelah /)).toBeVisible();
      await expect(dialog(page).getByText("Tulis alasan perpanjangan.")).toBeVisible();

      // Into the next request's days: conflict, nothing changes
      await dialog(page).getByLabel("Tanggal kembali baru (wajib)").fill(addDays(today, 3));
      await dialog(page).getByLabel("Catatan (wajib)").fill("Kegiatan diperpanjang");
      await dialog(page).getByRole("button", { name: "Simpan tanggal baru" }).click();
      await expect(dialog(page).getByText(/Bentrok dengan pengajuan lain/)).toBeVisible();
      expect(reqRow(loaned.id).end_date.slice(0, 10)).toBe(addDays(today, 1));

      // A free extension works
      await dialog(page).getByLabel("Tanggal kembali baru (wajib)").fill(addDays(today, 2));
      await dialog(page).getByRole("button", { name: "Simpan tanggal baru" }).click();
      await expect(page.getByText("Tanggal kembali diubah.")).toBeVisible();
      expect(reqRow(loaned.id).end_date.slice(0, 10)).toBe(addDays(today, 2));
      expect(reqRow(loaned.id).status).toBe("approved"); // status does not change (IB-25)
      expect(qn(`select count(*) from nexus.borrowing_extensions where request_id = '${loaned.id}'`)).toBe(1);
      await expect(main(page).getByText("Catatan: Kegiatan diperpanjang")).toBeVisible();

      // A non-head cannot extend, by function call either (IB-20)
      const denied = await rpcAs("staffOps", "borrowing_request_extend", { p_request_id: loaned.id, p_version: reqRow(loaned.id).version, p_new_end_date: addDays(today, 2), p_note: "x" });
      expect(denied.ok).toBe(false);
      expect(denied.hint).toBe("permission_required");
    } finally {
      await head.context.close();
      for (const r of [loaned, later]) await rpcAs("staffOps", "borrowing_request_cancel", { p_request_id: r.id, p_version: reqRow(r.id).version, p_reason: "QA" });
    }
  });

  test("too early: an approved request starting tomorrow shows the date, has no handover button, and the function answers too_early (A-IB8)", async ({ browser }) => {
    const tomorrow = addDays(jakartaToday(), 1);
    const made = await mustCreate(A, { lines: [{ itemId: item.id, quantity: 1 }], start: tomorrow, end: addDays(tomorrow, 1) });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto(requestUrl(made.ref));
      await expect(main(page).getByText(/^Belum bisa diserahkan\. Tanggal mulai peminjaman: /)).toBeVisible();
      await expect(page.getByRole("link", { name: "Serahkan barang" })).toHaveCount(0);
      const r = await handOverAs("staffOps", made.id, [{ line_id: lineOf(made.id, item.id), quantity: 1 }]);
      expect(r.ok).toBe(false);
      expect(r.hint).toBe("too_early");
      // A handler may cancel an approved request not picked up, with a reason (A-IB34)
      const noReason = await rpcAs("staffOps", "borrowing_request_cancel", { p_request_id: made.id, p_version: reqRow(made.id).version, p_reason: null });
      expect(noReason.ok).toBe(false);
      expect(noReason.hint).toBe("reason_required");
      const cancelled = await rpcAs("staffOps", "borrowing_request_cancel", { p_request_id: made.id, p_version: reqRow(made.id).version, p_reason: "Barang ditarik" });
      expect(cancelled.ok, JSON.stringify(cancelled.body)).toBe(true);
    } finally {
      await context.close();
    }
  });
});

async function cancelByOther(requestId: string, stranger: PersonaKey) {
  return rpcAs(stranger, "borrowing_request_cancel", { p_request_id: requestId, p_version: reqRow(requestId).version, p_reason: "iseng" });
}

// ---------------------------------------------------------------------------------------------
test.describe.serial("F10, IB-26, IB-33, IB-34, L6: outside party, own requests", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  let item: Qty;

  test("setup", async () => {
    await awayFromMidnight();
    item = await createQtyItem(`${TAG} Luar`, { good: 6 });
    ready = true;
  });

  test("an Operations member records a request for an outside party (no phone or email field); a plain member does not see the option", async ({ browser }) => {
    test.setTimeout(150_000);
    const ops = await signedInContext(browser, "staffOps");
    const plain = await signedInContext(browser, "regular");
    try {
      await plain.page.goto("/inventaris/ajukan");
      await expect(plain.page.getByRole("heading", { level: 1, name: "Ajukan Peminjaman" })).toBeVisible();
      await expect(plain.page.getByText("Untuk pihak luar")).toHaveCount(0);

      const page = ops.page;
      await page.goto("/inventaris/ajukan");
      await page.getByText("Untuk pihak luar", { exact: true }).click();
      await fillDate(page, "Mulai (wajib)", jakartaToday());
      await fillDate(page, "Sampai (wajib)", addDays(jakartaToday(), 1));
      // Required names only
      await expect(page.locator("input[type=tel], input[type=email]")).toHaveCount(0);
      await page.getByRole("button", { name: "Tambah barang" }).click();
      await dialog(page).getByLabel("Cari barang").fill(item.name);
      await dialog(page).getByRole("button", { name: new RegExp(item.name) }).click();
      await page.getByLabel("Keperluan atau kegiatan (wajib)").fill(`${TAG} acara gereja`);
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(page.getByText("Isi nama organisasi.").first()).toBeVisible();
      await expect(page.getByText("Isi nama penanggung jawab.").first()).toBeVisible();
      await page.getByLabel("Nama organisasi (wajib)").fill("Gereja Contoh");
      await page.getByLabel("Nama penanggung jawab (wajib)").fill("Pak Contoh");
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();

      await expect(page).toHaveURL(/notice=sent_outside/);
      await expect(page.getByText("Pengajuan untuk Gereja Contoh tersimpan. Menunggu persetujuan.")).toBeVisible();
      const ref = /PJM-\d+/.exec(page.url())![0];
      const r = qjson(`select * from nexus.borrowing_requests where reference = '${ref}'`)[0];
      expect(r.is_outside_party).toBe(true);
      expect(r.requester_member_id).toBe(await memberId("staff.ops@nexus.test")); // recorder = requester of record
      expect(r.outside_org_name).toBe("Gereja Contoh");
      expect(r.outside_contact_name).toBe("Pak Contoh");

      // The recorder appears in their own list, a head approves, any Operations member (even the recorder) hands over and returns
      expect((await approveAs("kadep", r.id)).ok).toBe(true);
      const h = await handOverAs("staffOps", r.id, [{ line_id: lineIds(r.id)[0], quantity: 1 }]);
      expect(h.ok, JSON.stringify(h.body)).toBe(true);
      const back = await returnAs("staffOps", r.id, [{ outcome: "good", line_id: lineIds(r.id)[0], quantity: 1 }]);
      expect(back.ok, JSON.stringify(back.body)).toBe(true);
      expect(reqRow(r.id).status).toBe("returned");

      // A plain member cannot record one by direct call (IB-33)
      const denied = await rpcAs("regular", "borrowing_request_create", {
        p_start_date: jakartaToday(), p_end_date: jakartaToday(), p_purpose: "x", p_lines: [{ item_id: item.id, quantity: 1 }],
        p_outside_org_name: "Palsu", p_outside_contact_name: "Palsu",
      });
      expect(denied.ok).toBe(false);
    } finally {
      await ops.context.close();
      await plain.context.close();
    }
  });

  test("L6: a head cannot approve, reject or extend their own request, another head can; handover and return of an own request are allowed (IB-22, IB-26)", async ({ browser }) => {
    test.setTimeout(150_000);
    const own = await mustCreate("kadivLogistik", { lines: [{ itemId: item.id, quantity: 1 }] });
    const ui = await signedInContext(browser, "kadivLogistik");
    try {
      await ui.page.goto(requestUrl(own.ref));
      await expect(ui.page.getByRole("button", { name: "Setujui", exact: true })).toHaveCount(0);
      await expect(ui.page.getByRole("button", { name: "Tolak", exact: true })).toHaveCount(0);
      await expect(ui.page.getByText(/Tidak bisa memproses pengajuanmu sendiri/)).toBeVisible();
    } finally {
      await ui.context.close();
    }
    const a = await approveAs("kadivLogistik", own.id);
    expect(a.ok).toBe(false);
    expect(a.hint).toBe("self_approval_blocked");
    const r = await rejectAs2("kadivLogistik", own.id);
    expect(r.hint).toBe("self_approval_blocked");
    expect((await approveAs("kadep", own.id)).ok).toBe(true); // another head can
    // Handover and return by the owner of the request (handle is not limited by L6)
    const h = await handOverAs("kadivLogistik", own.id, [{ line_id: lineIds(own.id)[0], quantity: 1 }]);
    expect(h.ok, JSON.stringify(h.body)).toBe(true);
    const ext = await rpcAs("kadivLogistik", "borrowing_request_extend", { p_request_id: own.id, p_version: reqRow(own.id).version, p_new_end_date: addDays(jakartaToday(), 3), p_note: "x" });
    expect(ext.hint).toBe("self_approval_blocked");
    const ok = await rpcAs("kadep", "borrowing_request_extend", { p_request_id: own.id, p_version: reqRow(own.id).version, p_new_end_date: addDays(jakartaToday(), 3), p_note: "diperpanjang kepala lain" });
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    const back = await returnAs("kadivLogistik", own.id, [{ outcome: "good", line_id: lineIds(own.id)[0], quantity: 1 }]);
    expect(back.ok, JSON.stringify(back.body)).toBe(true);
    // The history names the recorder (the same person here)
    expect(qn(`select count(*) from nexus.borrowing_status_history where request_id = '${own.id}' and actor_member_id = '${await memberId("kadiv.logistik@nexus.test")}'`)).toBeGreaterThanOrEqual(3);
  });
});

async function rejectAs2(who: "kadivLogistik", id: string) {
  return rpcAs(who, "borrowing_request_reject", { p_request_id: id, p_version: reqRow(id).version, p_note: "tolak sendiri" });
}

// ---------------------------------------------------------------------------------------------
test.describe("IB-52 (database), IB-35: overdue is derived and keeps blocking its quantity (IB-36)", () => {
  test("a loan whose end date is before today (Jakarta) shows 'Terlambat' to the requester, the queue and BPH, and still holds its quantity", async ({ browser }) => {
    test.setTimeout(150_000);
    await awayFromMidnight();
    const A = requesterWithRoom(2);
    test.skip(A === null, "no requester has daily room left; rerun after midnight WIB");
    const item = await createQtyItem(`${TAG} Telat`, { good: 2 });
    const made = await lendQty(A!, item, 2, { start: jakartaToday(), end: jakartaToday() });
    // The app can never create a past date, so age this one request's dates in the database (test data, scoped by id).
    // If the database guards forbid even this, the test records that instead of failing the module.
    let aged = true;
    try {
      // Triggers are skipped for this one transaction only (session_replication_role), no schema change.
      q(`begin; set local session_replication_role = replica; update nexus.borrowing_requests set start_date = start_date - 3, end_date = end_date - 2 where id = '${made.id}'; commit;`);
    } catch {
      aged = false;
    }
    test.skip(!aged, "database refused to age the dates (guard); overdue covered by the unit test of isRequestOverdue");
    const requester = await signedInContext(browser, A!);
    const bph = await signedInContext(browser, "ketum");
    try {
      await requester.page.goto(requestUrl(made.ref));
      await expect(requester.page.getByText(/Terlambat 2 hari/).first()).toBeVisible();
      await bph.page.goto("/inventaris/antrean?view=overdue");
      await expect(bph.page.getByText(made.ref).first()).toBeVisible();
      // It keeps blocking: nothing is free today although the old range ended
      const today = jakartaToday();
      const free = await rpcAs("ketum", "inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: addDays(today, 1) });
      expect(free.body[0].free_qty).toBe(0);
      // Return frees it at once
      const back = await returnAs("staffOps", made.id, [{ outcome: "good", line_id: lineOf(made.id, item.id), quantity: 2 }]);
      expect(back.ok, JSON.stringify(back.body)).toBe(true);
      const after = await rpcAs("pembina", "inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: addDays(today, 1) });
      expect(after.body[0].free_qty).toBe(2);
      expect(String(itemRow(item.id).is_active)).toBe("true");
    } finally {
      await requester.context.close();
      await bph.context.close();
    }
  });
});
// refOf is used by other specs through the helpers; keep the import used here.
void refOf;
