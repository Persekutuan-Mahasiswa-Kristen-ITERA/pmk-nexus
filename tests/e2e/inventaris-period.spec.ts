// Inventory and Borrowing: the Dashboard card counts equal the database (IB-45), and a change of the active period moves
// access by itself while old data stays as history (spec F11, IB-38, IB-40, IB-06). Pattern of data-anggota-period.spec.ts:
// two sessions stay open the whole time (no logout), the period is always restored in `finally`.
import { expect, test } from "@playwright/test";
import { setActivePeriod, signedInContext } from "./helpers";
import {
  addDays,
  approveAs,
  awayFromMidnight,
  cancelAs,
  createQtyItem,
  CATALOG_PATH,
  drawerItems,
  expectForbiddenScreen,
  handOverAs,
  INVENTORY_ITEM,
  jakartaToday,
  lineOf,
  main,
  mustCreate,
  q,
  qn,
  requesterWithRoom,
  reqRow,
  returnAs,
  rpcAs,
  segmentLabels,
  sweepQa,
  tag,
} from "./inventaris-helpers";

const TAG = tag();
test.afterAll(async () => {
  setActivePeriod("2026/2027");
  q("delete from public.assignments where id in (select a.id from public.assignments a join public.members m on m.id = a.member_id where m.email = 'member.regular@nexus.test' and a.period_id = (select id from public.periods where label = '2025/2026'))");
  q("update nexus.access_rules set is_enabled = true where default_code = 'D36'");
  await sweepQa(TAG);
});

// ---------------------------------------------------------------------------------------------
// Dashboard card (IB-45): every number is recomputed from the tables
// ---------------------------------------------------------------------------------------------
function cardOracle() {
  const good =
    qn("select coalesce(sum(s.quantity), 0) from nexus.inventory_stock s join nexus.inventory_items i on i.id = s.item_id where i.is_active and i.mode = 'quantity' and s.condition = 'good'") +
    qn("select count(*) from nexus.inventory_units u join nexus.inventory_items i on i.id = u.item_id where i.is_active and u.status = 'active' and u.condition = 'good'");
  const needsService =
    qn("select coalesce(sum(s.quantity), 0) from nexus.inventory_stock s join nexus.inventory_items i on i.id = s.item_id where i.is_active and i.mode = 'quantity' and s.condition = 'needs_service'") +
    qn("select count(*) from nexus.inventory_units u join nexus.inventory_items i on i.id = u.item_id where i.is_active and u.status = 'active' and u.condition = 'needs_service'");
  // On loan now: handed over and not yet returned, on lines of requests that are Dipinjam
  const onLoan = qn(
    `select coalesce(sum(l.quantity_handed_over - coalesce((select sum(r.quantity) from nexus.borrowing_line_returns r where r.line_id = l.id), 0)), 0)
     from nexus.borrowing_request_lines l join nexus.borrowing_requests q on q.id = l.request_id join nexus.inventory_items i on i.id = l.item_id
     where q.status = 'borrowed' and i.is_active`,
  );
  const items = qn("select count(*) from nexus.inventory_items where is_active");
  const pending = qn("select count(*) from nexus.borrowing_requests where status = 'submitted'");
  return { good, needsService, onLoan, items, pending };
}
const fmt = (n: number) => n.toLocaleString("id-ID");

test.describe.serial("IB-45: Dashboard card 'Inventaris Status' shows counts from the database, no percentage, for every active member", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  test("setup: a loan out, a unit lost, an archived item and a request waiting, so every count differs from the seed", async () => {
    await awayFromMidnight();
    const requester = requesterWithRoom(2);
    test.skip(requester === null, "no requester has daily room left; rerun after midnight WIB");
    const item = await createQtyItem(`${TAG} Kartu`, { good: 6, needs_service: 2, damaged: 1 });
    await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] }); // stays Diajukan
    const out = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 2 }] });
    expect((await approveAs("kadep", out.id)).ok).toBe(true);
    expect((await handOverAs("staffOps", out.id, [{ line_id: lineOf(out.id, item.id), quantity: 2 }])).ok).toBe(true);
    const archived = await createQtyItem(`${TAG} Kartu Arsip`, { good: 50, needs_service: 50 });
    expect((await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: archived.id, p_is_active: false })).ok).toBe(true);
    ready = true;
  });

  for (const persona of ["regular", "pembina", "admin", "ketum", "staffOps", "kadep"] as const) {
    test(`${persona}: the card matches the tables (archived and lost excluded, loans counted inside 'baik')`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        const card = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Inventaris Status" }) });
        await expect(card).toBeVisible();
        const want = cardOracle();
        // The accessible summary holds all three numbers
        await expect(card.getByText(`${fmt(want.good)} unit baik, ${fmt(want.onLoan)} sedang dipinjam, ${fmt(want.needsService)} perlu servis`)).toBeAttached();
        await expect(card.getByText(`${fmt(want.onLoan)} di antaranya sedang dipinjam`)).toBeVisible();
        await expect(card.getByText("unit perlu servis")).toBeVisible();
        // No percentage anywhere on the card (IB12)
        expect(await card.innerText()).not.toMatch(/%/);
        // Heads see the waiting approvals line, everyone else does not
        const pendingLine = card.getByRole("link", { name: /pengajuan menunggu persetujuan/ });
        if (persona === "kadep") await expect(pendingLine).toHaveText(`${fmt(want.pending)} pengajuan menunggu persetujuan`);
        else await expect(pendingLine).toHaveCount(0);
        await expect(card.getByRole("link", { name: "Lihat katalog" })).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Period change
// ---------------------------------------------------------------------------------------------
function addOldPeriodHead(email: string): string {
  return q(
    `insert into public.assignments(member_id, org_unit_id, position_id, period_id)
     select (select id from public.members where email = '${email}'),
            (select id from public.org_units where name = 'Logistik'),
            (select id from public.positions where name = 'Kepala Divisi'),
            (select id from public.periods where label = '2025/2026')
     returning id`,
  ).split("\n")[0];
}

test.describe.serial("F11, IB-38, IB-40, AC-42: the period switch changes access by itself; old requests stay as history and open ones stay actionable", () => {
  test("2026/2027 -> 2025/2026 -> none -> 2026/2027 with sessions kept open", async ({ browser }) => {
    test.setTimeout(300_000);
    await awayFromMidnight();
    const requester = requesterWithRoom(5, ["regular"]);
    test.skip(requester === null, "no requester has daily room left; rerun after midnight WIB");
    const item = await createQtyItem(`${TAG} Periode`, { good: 10 });
    const today = jakartaToday();
    // Four requests made in 2026/2027: waiting, approved (not picked up), on loan, closed
    const waiting = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] });
    const approved = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await approveAs("kadep", approved.id)).ok).toBe(true);
    const loan = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await approveAs("kadep", loan.id)).ok).toBe(true);
    expect((await handOverAs("staffOps", loan.id, [{ line_id: lineOf(loan.id, item.id), quantity: 1 }])).ok).toBe(true);
    const closed = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await approveAs("kadep", closed.id)).ok).toBe(true);
    expect((await handOverAs("staffOps", closed.id, [{ line_id: lineOf(closed.id, item.id), quantity: 1 }])).ok).toBe(true);
    expect((await returnAs("staffOps", closed.id, [{ outcome: "good", line_id: lineOf(closed.id, item.id), quantity: 1 }])).ok).toBe(true);
    const oldPeriod = q("select id from public.periods where label = '2026/2027'");
    for (const r of [waiting, approved, loan, closed]) expect(reqRow(r.id).period_id).toBe(oldPeriod);

    const ops = await signedInContext(browser, "staffOps");
    const bph = await signedInContext(browser, "ketum");
    const oldHead = await signedInContext(browser, "regular"); // an officer of the PREVIOUS period only (P-OLD of 2026/2027 -> head of 2025/2026)
    const member = await signedInContext(browser, requester!);
    let assignmentId: string | null = null;
    try {
      // ---- Before: 2026/2027 is active
      await ops.page.goto(CATALOG_PATH);
      expect(await segmentLabels(ops.page)).toEqual(["Katalog", "Peminjaman Saya", "Antrean", "Kelola Barang"]);
      await bph.page.goto(CATALOG_PATH);
      expect(await segmentLabels(bph.page)).toEqual(["Katalog", "Peminjaman Saya", "Antrean"]);
      await oldHead.page.goto(CATALOG_PATH);
      expect(await segmentLabels(oldHead.page)).toEqual(["Katalog", "Peminjaman Saya"]);
      await oldHead.page.goto("/inventaris/antrean");
      await expectForbiddenScreen(oldHead.page);
      const assignments2026 = qn("select count(*) from public.assignments where period_id = (select id from public.periods where label = '2026/2027')");
      assignmentId = addOldPeriodHead("member.regular@nexus.test"); // 2025/2026 only

      // ---- Switch: 2025/2026 becomes active
      setActivePeriod("2025/2026");
      // The former Operations staff loses Operations rights on the NEXT request, still signed in
      await ops.page.goto(CATALOG_PATH);
      await expect(ops.page.getByText("Periode 2025/2026").first()).toBeVisible();
      expect(await segmentLabels(ops.page)).toEqual(["Katalog", "Peminjaman Saya"]);
      for (const path of ["/inventaris/antrean", "/inventaris/kelola", "/inventaris/kelola/barang/baru"]) {
        await ops.page.goto(path);
        await expectForbiddenScreen(ops.page);
      }
      expect(await drawerItems(ops.page)).toEqual(["Dashboard", "Surat Menyurat", INVENTORY_ITEM]); // baseline view stays
      const denied = await rpcAs("staffOps", "borrowing_request_hand_over", { p_request_id: approved.id, p_version: reqRow(approved.id).version, p_lines: [{ line_id: lineOf(approved.id, item.id), quantity: 1 }] });
      expect(denied.ok).toBe(false);
      expect(denied.hint).toBe("permission_required");
      expect((await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Terlarang`, p_stock: { good: 1 } })).hint).toBe("permission_required");
      // BPH of 2026/2027 has no assignment now: no queue
      await bph.page.goto("/inventaris/antrean");
      await expectForbiddenScreen(bph.page);
      expect((await rpcAs("ketum", "borrowing_queue", { p_view: "all" })).hint).toBe("permission_required");

      // The officer of 2025/2026 gains the rights without logging in again, and the old period's data is intact (IB-38)
      await oldHead.page.goto(CATALOG_PATH);
      expect(await segmentLabels(oldHead.page)).toEqual(["Katalog", "Peminjaman Saya", "Antrean", "Kelola Barang"]);
      await oldHead.page.goto("/inventaris/antrean?view=open_all_periods");
      for (const r of [waiting, approved, loan]) await expect(main(oldHead.page).getByRole("link", { name: new RegExp(r.ref) })).toBeVisible();
      await oldHead.page.goto(`/inventaris/pengajuan/${closed.ref}`);
      await expect(oldHead.page.getByRole("heading", { level: 1, name: `Pengajuan ${closed.ref}` })).toBeVisible(); // closed old request, read-only, readable by a current view_all holder
      await expect(oldHead.page.getByRole("button", { name: "Koreksi pengembalian" })).toHaveCount(0);
      expect(qn("select count(*) from public.assignments where period_id = (select id from public.periods where label = '2026/2027')")).toBe(assignments2026);
      for (const r of [waiting, approved, loan, closed]) expect(reqRow(r.id).period_id).toBe(oldPeriod); // nothing was rewritten

      // Open requests of the old period stay actionable by the current holders (L7): approve the waiting one, return the loan
      const approve = await approveAs("regular", waiting.id);
      expect(approve.ok, JSON.stringify(approve.body)).toBe(true);
      const back = await returnAs("regular", loan.id, [{ outcome: "good", line_id: lineOf(loan.id, item.id), quantity: 1 }]);
      expect(back.ok, JSON.stringify(back.body)).toBe(true);
      // ...but a closed request of an old period cannot be corrected or moved (read-only)
      const correct = await rpcAs("regular", "borrowing_request_correct_return", { p_request_id: closed.id, p_version: reqRow(closed.id).version, p_reason: "salah" });
      expect(correct.ok).toBe(false);
      expect(correct.hint).toBe("closed_period");
      // The requester still reads their own old requests (L9) and can ask again in the new period
      await member.page.goto("/inventaris/saya?filter=all");
      await expect(member.page.getByRole("link", { name: new RegExp(closed.ref) }).first()).toBeVisible();
      await member.page.goto(`/inventaris/pengajuan/${closed.ref}`);
      await expect(member.page.getByRole("heading", { level: 1, name: `Pengajuan ${closed.ref}` })).toBeVisible();
      // New requests belong to the NEW period
      const fresh = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] });
      expect(reqRow(fresh.id).period_id).toBe(q("select id from public.periods where label = '2025/2026'"));
      expect((await cancelAs(requester!, fresh.id)).ok).toBe(true);

      // ---- No active period at all (IB-40, R11)
      setActivePeriod(null);
      await member.page.goto(CATALOG_PATH);
      await expect(main(member.page).getByText(/Menampilkan \d+-\d+ dari \d+ barang/)).toBeVisible(); // catalog stays readable
      await expect(member.page.getByText("Belum ada periode aktif. Pengajuan belum bisa dibuat.")).toBeVisible();
      await expect(member.page.getByRole("link", { name: "Ajukan Peminjaman" })).toHaveCount(0);
      const noPeriod = await rpcAs(requester!, "borrowing_request_create", { p_start_date: today, p_end_date: addDays(today, 1), p_purpose: "x", p_lines: [{ item_id: item.id, quantity: 1 }] });
      expect(noPeriod.ok).toBe(false);
      expect(noPeriod.hint).toBe("no_active_period");
      // Operations rights match nothing: nobody can approve, hand over or manage
      await oldHead.page.goto("/inventaris/antrean");
      await expectForbiddenScreen(oldHead.page);
      expect((await rpcAs("regular", "borrowing_request_approve", { p_request_id: approved.id, p_version: reqRow(approved.id).version })).ok).toBe(false);
      expect((await rpcAs("kadep", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Tanpa periode`, p_stock: { good: 1 } })).ok).toBe(false);

      // ---- Back to 2026/2027: access returns by itself, no logout, history unchanged
      setActivePeriod("2026/2027");
      await ops.page.goto(CATALOG_PATH);
      expect(await segmentLabels(ops.page)).toEqual(["Katalog", "Peminjaman Saya", "Antrean", "Kelola Barang"]);
      await bph.page.goto("/inventaris/antrean");
      await expect(bph.page.getByRole("heading", { level: 1, name: INVENTORY_ITEM })).toBeVisible();
      await oldHead.page.goto(CATALOG_PATH);
      expect(await segmentLabels(oldHead.page)).toEqual(["Katalog", "Peminjaman Saya"]);
      await oldHead.page.goto("/inventaris/antrean");
      await expectForbiddenScreen(oldHead.page);
      expect(reqRow(waiting.id).status).toBe("approved"); // decided during the old period, record intact
      expect(qn(`select count(*) from nexus.borrowing_status_history where request_id = '${waiting.id}'`)).toBeGreaterThanOrEqual(2);
      // The staff can finish what is left
      for (const r of [waiting, approved]) expect((await cancelAs("staffOps", r.id, "QA")).ok).toBe(true);
    } finally {
      setActivePeriod("2026/2027");
      if (assignmentId) q(`delete from public.assignments where id = '${assignmentId}'`);
      for (const c of [ops, bph, oldHead, member]) await c.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-06: disabling a default rule removes the power on the next request, with no logout", () => {
  test("rule D36 (every Operations holder handles) off: staff loses handover and Kelola still works for heads; back on: staff regains it", async ({ browser }) => {
    test.setTimeout(180_000);
    await awayFromMidnight();
    const requester = requesterWithRoom(1, ["regular"]);
    test.skip(requester === null, "no requester has daily room left; rerun after midnight WIB");
    const item = await createQtyItem(`${TAG} Aturan`, { good: 2 });
    const made = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const staff = await signedInContext(browser, "staffOps");
    try {
      await staff.page.goto(`/inventaris/pengajuan/${made.ref}`);
      await expect(staff.page.getByRole("link", { name: "Serahkan barang" })).toBeVisible();
      let flipped = true;
      try {
        q("update nexus.access_rules set is_enabled = false where default_code = 'D36'");
      } catch {
        flipped = false;
      }
      test.skip(!flipped, "the rule table refused a direct update (guard)");
      await staff.page.reload();
      await expect(staff.page.getByRole("link", { name: "Serahkan barang" })).toHaveCount(0); // gone on the next request
      const refused = await rpcAs("staffOps", "borrowing_request_hand_over", { p_request_id: made.id, p_version: reqRow(made.id).version, p_lines: [{ line_id: lineOf(made.id, item.id), quantity: 1 }] });
      expect(refused.ok).toBe(false);
      expect(refused.hint).toBe("permission_required");
      // The heads' approve rules are separate (D34/D35): the head can still manage but also no longer hand over (also D36)
      q("update nexus.access_rules set is_enabled = true where default_code = 'D36'");
      await staff.page.reload();
      await expect(staff.page.getByRole("link", { name: "Serahkan barang" })).toBeVisible();
      expect((await cancelAs("staffOps", made.id, "QA")).ok).toBe(true);
    } finally {
      q("update nexus.access_rules set is_enabled = true where default_code = 'D36'");
      await staff.context.close();
    }
  });
});
