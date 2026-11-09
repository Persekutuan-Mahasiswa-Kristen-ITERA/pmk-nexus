// Inventory and Borrowing: business rules, caps and limits, enforced by the database even when the page is bypassed
// (spec section 5 and 11c, IB-16, IB-24, IB-28, IB-36, IB-37, IB-49..IB-51, IB-55, IB-56). Calls the functions the Server
// Actions call, with each persona's real token. Every number is read back from the database.
import { expect, test } from "@playwright/test";
import {
  addDays,
  approveAs,
  awayFromMidnight,
  cancelAs,
  createdTodayBy,
  createQtyItem,
  createRequest,
  createTrackedItem,
  extendAs,
  handOverAs,
  jakartaToday,
  lendQty,
  lineOf,
  mustCreate,
  openSubmittedBy,
  PERSONAS,
  q,
  qn,
  requesterWithRoom,
  reqRow,
  returnAs,
  rpcAs,
  stockOf,
  sweepQa,
  tag,
  type PersonaKey,
  fillDate,
} from "./inventaris-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

const emailOf = (p: PersonaKey) => PERSONAS[p].email;
const POOL: PersonaKey[] = ["regular", "pembina", "kabiro", "bendahara", "admin", "ketum"];
// P and Q are the two requesters of the state-machine tests below (chosen by daily room: the 20-per-day cap counts every
// request ever made today and requests cannot be deleted, so repeated runs spread over the pool).
let P: PersonaKey = "pembina";
let Q: PersonaKey = "bendahara";
let noRoom = false;
test.beforeAll(() => {
  const p = requesterWithRoom(14);
  noRoom = p === null;
  P = p ?? "pembina";
  Q = requesterWithRoom(6, [P]) ?? "bendahara";
});
/** A member (not P or Q) with `room` requests left today, for the cap tests. */
function memberWithRoom(room: number): PersonaKey | null {
  const ranked = POOL.filter((p) => p !== P && p !== Q).sort((a, b) => createdTodayBy(emailOf(a)) - createdTodayBy(emailOf(b)));
  return ranked.find((p) => createdTodayBy(emailOf(p)) + room <= 20) ?? null;
}
/** The member closest to the daily cap (least extra work to prove the 21st is refused). */
function memberNearestCap(): PersonaKey {
  const ranked = POOL.filter((p) => p !== P && p !== Q).sort((a, b) => createdTodayBy(emailOf(b)) - createdTodayBy(emailOf(a)));
  return ranked.find((p) => createdTodayBy(emailOf(p)) <= 20) ?? POOL[0];
}

test.describe.serial("IB-49, IB-50: request caps (5 open Diajukan, 20 per Jakarta day)", () => {
  test("DB date logic: a request saved at 23:30 UTC belongs to the NEXT Jakarta day (R19, IB-50, IB-35)", async () => {
    expect(q("select nexus._jakarta_date('2026-11-08 23:30:00+00'::timestamptz)")).toBe("2026-11-09");
    expect(q("select nexus._jakarta_date('2026-11-08 16:59:59+00'::timestamptz)")).toBe("2026-11-08");
    expect(q("select nexus._jakarta_date('2026-11-08 17:00:00+00'::timestamptz)")).toBe("2026-11-09");
  });

  test("6th open request is refused with the owner's text; approved/borrowed ones do not count; after a decision or cancel they can again", async ({ browser }) => {
    test.setTimeout(180_000);
    await awayFromMidnight(300);
    const who = memberWithRoom(8);
    test.skip(who === null, "every pooled member is close to the 20-per-day cap from earlier runs today; run again tomorrow");
    const item = await createQtyItem(`${TAG} Batas`, { good: 50 });
    const baseOpen = openSubmittedBy(emailOf(who!));
    const made: { id: string }[] = [];
    for (let i = baseOpen; i < 5; i++) made.push(await mustCreate(who!, { lines: [{ itemId: item.id, quantity: 1 }] }));
    expect(openSubmittedBy(emailOf(who!))).toBe(5);
    const sixth = await createRequest(who!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect(sixth.rpc.ok).toBe(false);
    expect(sixth.rpc.hint).toBe("too_many_open_requests");
    expect(openSubmittedBy(emailOf(who!))).toBe(5);

    // The refusal on screen carries the owner-approved text
    const { signedInContext } = await import("./helpers");
    const ctx = await signedInContext(browser, who!);
    try {
      await ctx.page.goto("/inventaris/ajukan");
      await fillDate(ctx.page, "Mulai (wajib)", jakartaToday());
      await fillDate(ctx.page, "Sampai (wajib)", addDays(jakartaToday(), 1));
      await ctx.page.getByRole("button", { name: "Tambah barang" }).click();
      await ctx.page.getByRole("dialog").getByLabel("Cari barang").fill(item.name);
      await ctx.page.getByRole("dialog").getByRole("button", { name: new RegExp(item.name) }).click();
      await ctx.page.getByLabel("Keperluan atau kegiatan (wajib)").fill("Percobaan ke-6");
      await ctx.page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(ctx.page.getByText("Kamu sudah punya 5 pengajuan yang menunggu persetujuan. Tunggu keputusannya atau batalkan salah satu.")).toBeVisible();
    } finally {
      await ctx.context.close();
    }

    // Approved requests no longer count (A-IB49): approve one, a sixth is accepted
    const toApprove = q(`select id from nexus.borrowing_requests where requester_member_id = (select id from public.members where email = '${emailOf(who!)}') and status = 'submitted' limit 1`);
    const approved = await approveAs("kadep", toApprove);
    expect(approved.ok, JSON.stringify(approved.body)).toBe(true);
    const now = await createRequest(who!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect(now.rpc.ok, JSON.stringify(now.rpc.body)).toBe(true);
    // Cancelled ones free a slot too
    const refused = await createRequest(who!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect(refused.rpc.hint).toBe("too_many_open_requests");
    expect((await cancelAs(who!, now.id)).ok).toBe(true);
    const again = await createRequest(who!, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect(again.rpc.ok, JSON.stringify(again.rpc.body)).toBe(true);
    await cancelAs(who!, again.id);
    await cancelAs("staffOps", toApprove, "QA");
    for (const m of made) {
      if (reqRow(m.id).status === "submitted") await cancelAs(who!, m.id);
    }
    expect(openSubmittedBy(emailOf(who!))).toBe(baseOpen);
  });

  test("21st request on one Jakarta day is refused, cancelled requests still count, outside-party requests count toward the recorder", async ({ browser }) => {
    test.setTimeout(300_000);
    await awayFromMidnight(300);
    const who = memberNearestCap();
    const item = await createQtyItem(`${TAG} Harian`, { good: 50 });
    // Fill the day with create+cancel pairs (keeps the open cap out of the way)
    while (createdTodayBy(emailOf(who)) < 20) {
      const r = await createRequest(who, { lines: [{ itemId: item.id, quantity: 1 }] });
      expect(r.rpc.ok, JSON.stringify(r.rpc.body)).toBe(true);
      expect((await cancelAs(who, r.id)).ok).toBe(true);
    }
    expect(createdTodayBy(emailOf(who))).toBe(20);
    const next = await createRequest(who, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect(next.rpc.ok).toBe(false);
    expect(next.rpc.hint).toBe("daily_request_limit"); // 20 already exist although every one is cancelled
    expect(createdTodayBy(emailOf(who))).toBe(20);

    const { signedInContext } = await import("./helpers");
    const ctx = await signedInContext(browser, who);
    try {
      await ctx.page.goto("/inventaris/ajukan");
      await fillDate(ctx.page, "Mulai (wajib)", jakartaToday());
      await fillDate(ctx.page, "Sampai (wajib)", addDays(jakartaToday(), 1));
      await ctx.page.getByRole("button", { name: "Tambah barang" }).click();
      await ctx.page.getByRole("dialog").getByLabel("Cari barang").fill(item.name);
      await ctx.page.getByRole("dialog").getByRole("button", { name: new RegExp(item.name) }).click();
      await ctx.page.getByLabel("Keperluan atau kegiatan (wajib)").fill("Percobaan ke-21");
      await ctx.page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(ctx.page.getByText("Kamu sudah membuat 20 pengajuan hari ini. Coba lagi besok.")).toBeVisible();
    } finally {
      await ctx.context.close();
    }

    // IB-50: an outside-party request counts for the RECORDER (staff.ops), not for anyone else
    const recorderBefore = createdTodayBy(emailOf("staffOps"));
    const whoBefore = createdTodayBy(emailOf(who));
    test.skip(recorderBefore >= 20, "staff.ops is at the daily cap already");
    const outside = await mustCreate("staffOps", { lines: [{ itemId: item.id, quantity: 1 }], org: "Gereja QA", contact: "Pak QA" });
    expect(createdTodayBy(emailOf("staffOps"))).toBe(recorderBefore + 1);
    expect(createdTodayBy(emailOf(who))).toBe(whoBefore);
    expect((await cancelAs("staffOps", outside.id)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-16, IB-51, IB-55: request validation by direct call", () => {
  // A skipped setup must skip the rest of the block too, instead of crashing on the missing item.
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no pooled member has 6 free requests today)");
  });
  let good: { id: string };
  let who: PersonaKey;
  const created: string[] = [];

  test("setup", async () => {
    await awayFromMidnight(300);
    const picked = memberWithRoom(6);
    test.skip(picked === null, "no pooled member has 6 free requests today; run again after midnight WIB");
    who = picked!;
    good = await createQtyItem(`${TAG} Aturan`, { good: 5, needs_service: 2 });
    ready = true;
  });

  const lines = (n = 1) => [{ item_id: good.id, quantity: n }];
  const create = (over: Record<string, unknown>) =>
    rpcAs(who, "borrowing_request_create", { p_start_date: jakartaToday(), p_end_date: addDays(jakartaToday(), 1), p_purpose: "QA", p_lines: lines(), ...over });
  // Every accepted request is cancelled at once, so the 5-open cap never interferes with the next check
  const keep = async (promise: Promise<{ ok: boolean; body: any }>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await promise;
    if (r.ok) {
      created.push(r.body[0].request_id);
      await cancelAs(who, r.body[0].request_id);
    }
    return r;
  };

  test("accepted: start tomorrow, 90 days, exactly start+365; refused: start+366 (message names a new request), start yesterday, end before start", async () => {
    const today = jakartaToday();
    expect((await keep(create({ p_start_date: addDays(today, 1), p_end_date: addDays(today, 2) }))).ok).toBe(true);
    expect((await keep(create({ p_end_date: addDays(today, 89) }))).ok).toBe(true); // 90 days inclusive, no practical maximum (IB5)
    expect((await keep(create({ p_end_date: addDays(today, 365) }))).ok).toBe(true); // IB-51: start + 365 accepted
    const tooLong = await create({ p_end_date: addDays(today, 366) });
    expect(tooLong.hint).toBe("date_range_too_long");
    const past = await create({ p_start_date: addDays(today, -1), p_end_date: today });
    expect(past.hint).toBe("start_in_past");
    const backwards = await create({ p_start_date: addDays(today, 3), p_end_date: addDays(today, 2) });
    expect(backwards.hint).toBe("invalid_dates");
    const bad = await create({ p_start_date: "2026-02-30" });
    expect(bad.ok).toBe(false);
  });

  test("quantity, items and text: 0, fraction, above free, same item twice, blank purpose, unlendable item", async () => {
    expect((await create({ p_lines: lines(0) })).hint).toBe("quantity_invalid");
    expect((await create({ p_lines: lines(-1) })).hint).toBe("quantity_invalid");
    expect((await create({ p_lines: [{ item_id: good.id, quantity: 1.5 }] })).ok).toBe(false);
    const tooMany = await create({ p_lines: lines(6) }); // 5 good, 2 in service are not lendable (R3, IB10)
    expect(tooMany.hint).toBe("insufficient_stock");
    expect((await create({ p_lines: [...lines(1), ...lines(1)] })).hint).toBe("duplicate_item");
    expect((await create({ p_purpose: "   " })).hint).toBe("text_required");
    expect((await create({ p_lines: [] })).ok).toBe(false);
    const onlyService = await createQtyItem(`${TAG} Servis`, { needs_service: 3 });
    const r = await create({ p_lines: [{ item_id: onlyService.id, quantity: 1 }] });
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/item_not_lendable|insufficient_stock/);
    await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: onlyService.id, p_is_active: false });
    const archived = await create({ p_lines: [{ item_id: onlyService.id, quantity: 1 }] });
    expect(archived.ok).toBe(false);
    expect(archived.hint).toMatch(/item_not_lendable|item_archived/);
    const phantom = await create({ p_lines: [{ item_id: "00000000-0000-4000-8000-000000000000", quantity: 1 }] });
    expect(phantom.ok).toBe(false);
  });

  test("IB-55: text limits count characters (purpose and notes 500, an emoji is one character); 51 lines refused", async () => {
    expect((await keep(create({ p_purpose: "a".repeat(500) }))).ok).toBe(true);
    expect((await create({ p_purpose: "a".repeat(501) })).hint).toBe("text_too_long");
    expect((await keep(create({ p_purpose: "😀".repeat(500) }))).ok).toBe(true); // 500 characters although 1000 UTF-16 units
    expect((await create({ p_purpose: "😀".repeat(501) })).hint).toBe("text_too_long");
    expect((await create({ p_note: "n".repeat(501) })).hint).toBe("text_too_long");
    const fiftyOne = Array.from({ length: 51 }, (_, i) => ({ item_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
    expect((await create({ p_lines: fiftyOne })).hint).toBe("too_many_lines");
  });

  test("cleanup", async () => {
    expect(created.length).toBeGreaterThan(0);
    for (const id of created) expect(reqRow(id).status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-55: item, list and stock limits by direct call (Operations)", () => {
  test("name 120/121, description 1000/1001, category 60/61, location 80/81, stock 0-9999, units 200/201, outside-party names 120/121", async () => {
    await awayFromMidnight(300);
    const name120 = (TAG + "N".repeat(120)).slice(0, 120);
    const ok = await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: name120, p_stock: { good: 1 } });
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    expect((await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: name120 + "x", p_stock: { good: 1 } })).hint).toBe("text_too_long");
    expect((await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: "   ", p_stock: { good: 1 } })).hint).toBe("text_required");
    const desc1000 = await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Desk`, p_description: "d".repeat(1000), p_stock: { good: 1 } });
    expect(desc1000.ok, JSON.stringify(desc1000.body)).toBe(true);
    expect((await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Desk2`, p_description: "d".repeat(1001), p_stock: { good: 1 } })).hint).toBe("text_too_long");
    // Stock 0..9999 per condition
    const max = await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Maks`, p_stock: { good: 9999 } });
    expect(max.ok, JSON.stringify(max.body)).toBe(true);
    for (const stock of [{ good: 10000 }, { good: -1 }, { good: 0, needs_service: 0, damaged: 0 }, { good: 1.5 }]) {
      const r = await rpcAs("staffOps", "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Stok`, p_stock: stock });
      expect(r.ok, JSON.stringify(stock)).toBe(false);
      expect(r.hint, JSON.stringify(stock)).toMatch(/quantity_invalid|invalid_input/);
    }
    const itemId = max.body[0].item_id;
    expect((await rpcAs("staffOps", "inventory_stock_add", { p_item_id: itemId, p_condition: "good", p_quantity: 1, p_note: "x" })).ok).toBe(false); // would exceed 9999
    // Units: 200 accepted, 201 refused
    const units = (n: number) => Array.from({ length: n }, () => ({ condition: "good" }));
    const u200 = await rpcAs("staffOps", "inventory_item_create", { p_mode: "tracked", p_name: `${TAG} Dua ratus`, p_units: units(200) });
    expect(u200.ok, JSON.stringify(u200.body).slice(0, 200)).toBe(true);
    expect(u200.body[0].unit_codes).toHaveLength(200);
    const u201 = await rpcAs("staffOps", "inventory_item_create", { p_mode: "tracked", p_name: `${TAG} Dua ratus satu`, p_units: units(201) });
    expect(u201.ok).toBe(false);
    expect(u201.hint).toBe("quantity_invalid");
    expect(qn(`select count(*) from nexus.inventory_items where name = '${TAG} Dua ratus satu'`)).toBe(0);
    // Lists
    const cat = `${TAG}-${"k".repeat(60)}`.slice(0, 60);
    expect((await rpcAs("staffOps", "inventory_category_add", { p_name: cat })).ok).toBe(true);
    expect((await rpcAs("staffOps", "inventory_category_add", { p_name: cat + "x" })).hint).toBe("text_too_long");
    const loc = `${TAG}-${"l".repeat(80)}`.slice(0, 80);
    expect((await rpcAs("staffOps", "inventory_location_add", { p_name: loc })).ok).toBe(true);
    expect((await rpcAs("staffOps", "inventory_location_add", { p_name: loc + "x" })).hint).toBe("text_too_long");
    // Outside-party names 120 / 121
    const item = await createQtyItem(`${TAG} Pihak`, { good: 3 });
    const org = (n: number) => "o".repeat(n);
    const fine = await createRequest("staffOps", { lines: [{ itemId: item.id, quantity: 1 }], org: org(120), contact: org(120) });
    expect(fine.rpc.ok, JSON.stringify(fine.rpc.body)).toBe(true);
    await cancelAs("staffOps", fine.id);
    expect((await createRequest("staffOps", { lines: [{ itemId: item.id, quantity: 1 }], org: org(121), contact: "c" })).rpc.hint).toBe("text_too_long");
    expect((await createRequest("staffOps", { lines: [{ itemId: item.id, quantity: 1 }], org: "o", contact: org(121) })).rpc.hint).toBe("text_too_long");
    expect((await createRequest("staffOps", { lines: [{ itemId: item.id, quantity: 1 }], org: "o" })).rpc.ok).toBe(false); // contact missing
    // Duplicate names in the lists (case-insensitive)
    const dup = await rpcAs("staffOps", "inventory_category_add", { p_name: cat.toLowerCase() });
    expect(dup.ok).toBe(false);
    expect(dup.hint).toBe("duplicate_name");
    // Deactivate the QA list entries again (nothing is ever deleted)
    for (const [table, fn] of [["inventory_categories", "inventory_category_set_active"], ["inventory_locations", "inventory_location_set_active"]] as const) {
      const id = q(`select id from nexus.${table} where name like '${TAG}%'`).split("\n")[0];
      const param = table === "inventory_categories" ? "p_category_id" : "p_location_id";
      expect((await rpcAs("staffOps", fn, { [param]: id, p_is_active: false })).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-24, IB-28, IB-36, IB-37, IB-52: stock rules, double booking, partial return, overlap", () => {
  test.beforeEach(() => test.skip(noRoom, "no requester has daily room left (20 per member per Jakarta day); rerun after midnight WIB"));
  test("two approvals that together exceed the stock cannot both succeed, even sent at the same moment (R5)", async () => {
    await awayFromMidnight(300);
    const item = await createQtyItem(`${TAG} Balapan`, { good: 3 });
    const a = await mustCreate(P, { lines: [{ itemId: item.id, quantity: 2 }] });
    const b = await mustCreate(Q, { lines: [{ itemId: item.id, quantity: 2 }] });
    const [ra, rb] = await Promise.all([approveAs("kadep", a.id), approveAs("kadivLogistik", b.id)]);
    const winners = [ra, rb].filter((r) => r.ok);
    const losers = [ra, rb].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].hint).toBe("insufficient_stock");
    const statuses = [reqRow(a.id).status, reqRow(b.id).status].sort();
    expect(statuses).toEqual(["approved", "submitted"]); // the loser stays Diajukan
    // Cleanup
    const approvedId = reqRow(a.id).status === "approved" ? a.id : b.id;
    const pendingId = approvedId === a.id ? b.id : a.id;
    await cancelAs("staffOps", approvedId, "QA");
    await cancelAs(approvedId === a.id ? Q : P, pendingId);
  });

  test("the same request cannot be decided or returned twice: the second action says state_changed and the history has one row (IB-48)", async () => {
    const item = await createQtyItem(`${TAG} Dua kali`, { good: 5 });
    const made = await mustCreate(P, { lines: [{ itemId: item.id, quantity: 1 }] });
    const version = reqRow(made.id).version;
    const first = await rpcAs("kadep", "borrowing_request_approve", { p_request_id: made.id, p_version: version });
    expect(first.ok).toBe(true);
    const second = await rpcAs("kadivLogistik", "borrowing_request_approve", { p_request_id: made.id, p_version: version });
    expect(second.ok).toBe(false);
    expect(second.hint).toBe("state_changed");
    const reject = await rpcAs("kadivLogistik", "borrowing_request_reject", { p_request_id: made.id, p_version: version, p_note: "x" });
    expect(reject.hint).toBe("state_changed");
    expect(qn(`select count(*) from nexus.borrowing_status_history where request_id = '${made.id}' and to_status = 'approved'`)).toBe(1);
    // Return twice with the same version
    const h = await handOverAs("staffOps", made.id, [{ line_id: lineOf(made.id, item.id), quantity: 1 }]);
    expect(h.ok).toBe(true);
    const v = reqRow(made.id).version;
    const out = [{ outcome: "good", line_id: lineOf(made.id, item.id), quantity: 1 }];
    const [r1, r2] = await Promise.all([
      rpcAs("staffOps", "borrowing_request_return", { p_request_id: made.id, p_version: v, p_outcomes: out }),
      rpcAs("kadep", "borrowing_request_return", { p_request_id: made.id, p_version: v, p_outcomes: out }),
    ]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)!.hint).toBe("state_changed");
    expect(qn(`select count(*) from nexus.borrowing_line_returns where line_id = '${lineOf(made.id, item.id)}'`)).toBe(1);
  });

  test("handover above the approved quantity is refused; less than approved needs a note (IB-27); partial return keeps Dipinjam, Dikembalikan only when all lines are closed (IB-28); over-returning is refused", async () => {
    const item = await createQtyItem(`${TAG} Sebagian`, { good: 6 });
    const made = await mustCreate(P, { lines: [{ itemId: item.id, quantity: 4 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const line = lineOf(made.id, item.id);
    expect((await handOverAs("staffOps", made.id, [{ line_id: line, quantity: 5 }])).ok).toBe(false);
    const noNote = await handOverAs("staffOps", made.id, [{ line_id: line, quantity: 3 }]);
    expect(noNote.hint).toBe("note_required");
    expect((await handOverAs("staffOps", made.id, [{ line_id: line, quantity: 0 }])).hint).toBe("nothing_to_hand_over");
    expect((await handOverAs("staffOps", made.id, [{ line_id: line, quantity: 3, note: "Satu unit servis" }])).ok).toBe(true);
    expect(Number(q(`select quantity_handed_over from nexus.borrowing_request_lines where id = '${line}'`))).toBe(3);
    // Partial return
    expect((await returnAs("staffOps", made.id, [{ outcome: "good", line_id: line, quantity: 1 }])).ok).toBe(true);
    expect(reqRow(made.id).status).toBe("borrowed");
    // Over-return (2 still out)
    const over = await returnAs("staffOps", made.id, [{ outcome: "good", line_id: line, quantity: 3 }]);
    expect(over.ok).toBe(false);
    expect(over.hint).toBe("quantity_invalid");
    expect((await returnAs("staffOps", made.id, [{ outcome: "good", line_id: line, quantity: 2 }])).ok).toBe(true);
    expect(reqRow(made.id).status).toBe("returned");
    expect(reqRow(made.id).has_issue).toBe(false);
  });

  test("IB-37, IB-36: ranges that share one day overlap; a loan keeps blocking new requests until it is returned; the day after the end is free; IB-52 return frees at once", async () => {
    const item = await createQtyItem(`${TAG} Tumpang`, { good: 2 });
    const today = jakartaToday();
    // Both asked while everything was free (pending requests hold nothing, IB6)
    const a = await mustCreate(P, { lines: [{ itemId: item.id, quantity: 2 }], start: today, end: addDays(today, 1) });
    const overlapDay = await mustCreate(Q, { lines: [{ itemId: item.id, quantity: 1 }], start: addDays(today, 1), end: addDays(today, 3) });
    const clear = await mustCreate(Q, { lines: [{ itemId: item.id, quantity: 1 }], start: addDays(today, 2), end: addDays(today, 3) });
    expect((await approveAs("kadep", a.id)).ok).toBe(true);
    expect((await handOverAs("staffOps", a.id, [{ line_id: lineOf(a.id, item.id), quantity: 2 }])).ok).toBe(true);
    // While A is out, a NEW request over its days is refused at once (counts only: "Only 0 available")
    const during = await createRequest(Q, { lines: [{ itemId: item.id, quantity: 1 }], start: addDays(today, 1), end: addDays(today, 1) });
    expect(during.rpc.ok).toBe(false);
    expect(during.rpc.hint).toBe("insufficient_stock");
    // The pending one that shares only ONE day (today+1) with A cannot be approved
    const blocked = await approveAs("kadep", overlapDay.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.hint).toBe("insufficient_stock");
    expect(reqRow(overlapDay.id).status).toBe("submitted");
    // The day after A's end date is free
    expect((await approveAs("kadep", clear.id)).ok).toBe(true);
    // Return of A frees the stock at once, also inside A's own range (IB-52)
    expect((await returnAs("staffOps", a.id, [{ outcome: "good", line_id: lineOf(a.id, item.id), quantity: 2 }])).ok).toBe(true);
    const free = await rpcAs("ketum", "inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: addDays(today, 1) });
    expect(free.body[0].free_qty).toBe(2);
    expect((await approveAs("kadep", overlapDay.id)).ok).toBe(true);
    for (const r of [overlapDay, clear]) await cancelAs("staffOps", r.id, "QA");
  });

  test("IB-13: lowering stock under the reserved quantity and archiving with an open request are refused; the message carries counts, never a name", async () => {
    const item = await createQtyItem(`${TAG} Dipesan`, { good: 4 });
    const made = await mustCreate(P, { lines: [{ itemId: item.id, quantity: 3 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const move = await rpcAs("staffOps", "inventory_stock_move", { p_item_id: item.id, p_from: "good", p_to: "needs_service", p_quantity: 2, p_note: "rusak" });
    expect(move.ok).toBe(false);
    expect(move.hint).toBe("reserved_stock");
    expect(stockOf(item.id, "good")).toBe(4);
    const writeOff = await rpcAs("staffOps", "inventory_stock_write_off", { p_item_id: item.id, p_condition: "good", p_quantity: 2, p_note: "hilang" });
    expect(writeOff.hint).toBe("reserved_stock");
    const archive = await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: item.id, p_is_active: false });
    expect(archive.ok).toBe(false);
    expect(archive.hint).toBe("open_requests_exist");
    for (const r of [move, writeOff, archive]) {
      const text = JSON.stringify(r.body).toLowerCase();
      for (const name of ["test anggota", "test dosen", P, "member.regular"]) expect(text).not.toContain(name);
    }
    // Moving only what is NOT reserved works
    expect((await rpcAs("staffOps", "inventory_stock_move", { p_item_id: item.id, p_from: "good", p_to: "needs_service", p_quantity: 1, p_note: "servis" })).ok).toBe(true);
    await cancelAs("staffOps", made.id, "QA");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-29, IB-30, IB-56: return outcomes and photo rules at the database", () => {
  test.beforeEach(() => test.skip(noRoom, "no requester has daily room left (20 per member per Jakarta day); rerun after midnight WIB"));
  test("damaged or lost without a note, without a photo, with 4 photos, with a foreign or duplicate path, or without a condition are refused; 1-3 valid photos are stored and nothing changed on refusal", async () => {
    await awayFromMidnight(300);
    const t = await createTrackedItem(`${TAG} Foto`, ["good", "good", "good", "good"]);
    const made = await mustCreate(P, { lines: [{ itemId: t.id, quantity: 4 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const line = lineOf(made.id, t.id);
    expect((await handOverAs("staffOps", made.id, [{ line_id: line, unit_ids: t.unitIds }])).ok).toBe(true);
    const path = (requestId = made.id) => `${requestId}/${crypto.randomUUID()}.jpg`;
    const dmg = (extra: Record<string, unknown>, unit = t.unitIds[0]) => ({ outcome: "damaged", line_id: line, unit_id: unit, resulting_condition: "needs_service", note: "patah", photos: [path()], ...extra });
    const call = (o: Record<string, unknown>) => returnAs("staffOps", made.id, [o]);
    expect((await call(dmg({ note: "" }))).hint).toBe("note_required");
    expect((await call(dmg({ photos: [] }))).hint).toBe("photo_count");
    expect((await call(dmg({ photos: [path(), path(), path(), path()] }))).hint).toBe("photo_count");
    expect((await call(dmg({ photos: [path("11111111-2222-3333-4444-555555555555")] }))).hint).toBe("invalid_photo");
    const same = path();
    expect((await call(dmg({ photos: [same, same] }))).ok).toBe(false);
    expect((await call(dmg({ resulting_condition: null }))).hint).toBe("invalid_condition");
    expect((await call(dmg({ photos: ["../etc/passwd.jpg"] }))).hint).toBe("invalid_photo");
    expect((await call(dmg({ photos: [`${made.id}/${crypto.randomUUID()}.gif`] }))).hint).toBe("invalid_photo");
    expect(qn(`select count(*) from nexus.borrowing_line_returns where line_id = '${line}'`)).toBe(0);
    expect(reqRow(made.id).status).toBe("borrowed");
    // Lost needs note and photo as well
    expect((await call({ outcome: "lost", line_id: line, unit_id: t.unitIds[1], note: "", photos: [path()] })).hint).toBe("note_required");
    expect((await call({ outcome: "lost", line_id: line, unit_id: t.unitIds[1], note: "hilang", photos: [] })).hint).toBe("photo_count");
    // Good needs neither
    expect((await call({ outcome: "good", line_id: line, unit_id: t.unitIds[2] })).ok).toBe(true);
    // A foreign unit (not on this loan) is refused
    const other = await createTrackedItem(`${TAG} Asing`, ["good"]);
    expect((await call({ outcome: "good", line_id: line, unit_id: other.unitIds[0] })).ok).toBe(false);
    // 3 photos accepted
    const three = await call(dmg({ photos: [path(), path(), path()] }, t.unitIds[0]));
    expect(three.ok, JSON.stringify(three.body)).toBe(true);
    expect(qn(`select count(*) from nexus.borrowing_evidence_photos p join nexus.borrowing_line_returns r on r.id = p.line_return_id where r.line_id = '${line}'`)).toBe(3);
    const lostOk = await call({ outcome: "lost", line_id: line, unit_id: t.unitIds[1], note: "hilang di lokasi", photos: [path()] });
    expect(lostOk.ok, JSON.stringify(lostOk.body)).toBe(true);
    expect(q(`select status from nexus.inventory_units where id = '${t.unitIds[1]}'`)).toBe("lost");
    // The photo records cannot be deleted or replaced (IB-32): by owner-level SQL too
    expect(() => q(`begin; delete from nexus.borrowing_evidence_photos; rollback;`)).toThrow();
    expect(() => q(`begin; update nexus.borrowing_evidence_photos set storage_path = 'x'; rollback;`)).toThrow();
  });

  test("correction is refused when the stock of the item changed since the return (IB-53), and corrected state is logged", async () => {
    const t = await createTrackedItem(`${TAG} Koreksi`, ["good", "good"]);
    const made = await mustCreate(P, { lines: [{ itemId: t.id, quantity: 2 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const line = lineOf(made.id, t.id);
    expect((await handOverAs("staffOps", made.id, [{ line_id: line, unit_ids: t.unitIds }])).ok).toBe(true);
    const photo = `${made.id}/${crypto.randomUUID()}.jpg`;
    expect((await returnAs("staffOps", made.id, [
      { outcome: "damaged", line_id: line, unit_id: t.unitIds[0], resulting_condition: "damaged", note: "pecah", photos: [photo] },
      { outcome: "good", line_id: line, unit_id: t.unitIds[1] },
    ])).ok).toBe(true);
    // A manager edits that unit afterwards: the correction must be refused
    expect((await rpcAs("staffOps", "inventory_unit_set_condition", { p_unit_id: t.unitIds[0], p_condition: "needs_service", p_note: "dicek ulang" })).ok).toBe(true);
    const c = await rpcAs("staffOps", "borrowing_request_correct_return", { p_request_id: made.id, p_version: reqRow(made.id).version, p_reason: "salah catat" });
    expect(c.ok).toBe(false);
    expect(c.hint).toBe("correction_conflict");
    expect(reqRow(made.id).status).toBe("returned");
    // Only a handler may correct, with a reason
    expect((await rpcAs("staffOps", "borrowing_request_correct_return", { p_request_id: made.id, p_version: reqRow(made.id).version, p_reason: "  " })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-51: extension cap counts from the ORIGINAL start date", () => {
  test.beforeEach(() => test.skip(noRoom, "no requester has daily room left (20 per member per Jakarta day); rerun after midnight WIB"));
  test("start+365 accepted, start+366 refused, also after earlier extensions", async () => {
    await awayFromMidnight(300);
    const item = await createQtyItem(`${TAG} Panjang`, { good: 1 });
    const today = jakartaToday();
    const made = await lendQty(P, item, 1, { start: today, end: addDays(today, 1) });
    const early = await extendAs("kadep", made.id, addDays(today, 100));
    expect(early.ok, JSON.stringify(early.body)).toBe(true);
    const tooFar = await extendAs("kadep", made.id, addDays(today, 366));
    expect(tooFar.ok).toBe(false);
    expect(tooFar.hint).toBe("date_range_too_long");
    const exact = await extendAs("kadep", made.id, addDays(today, 365));
    expect(exact.ok, JSON.stringify(exact.body)).toBe(true);
    // An earlier date than the current end is not an extension
    expect((await extendAs("kadep", made.id, addDays(today, 10))).hint).toBe("invalid_dates");
    expect((await extendAs("kadep", made.id, addDays(today, 366), "   ")).ok).toBe(false);
    expect(qn(`select count(*) from nexus.borrowing_extensions where request_id = '${made.id}'`)).toBe(2);
    expect((await returnAs("staffOps", made.id, [{ outcome: "good", line_id: lineOf(made.id, item.id), quantity: 1 }])).ok).toBe(true);
  });
});
