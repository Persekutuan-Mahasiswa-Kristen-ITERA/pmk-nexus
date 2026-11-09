// IB-39, R13, AC-44, AC-45: a requester who is deactivated in the middle of a loan. Their requests stay, Operations can
// still take the return and the name still shows, nothing is deleted or auto-cancelled, and they get nothing from the
// module any more. The member is switched back in `finally` (global-setup also repairs the seed accounts).
import { expect, test } from "@playwright/test";
import { setActive, signedInContext } from "./helpers";
import {
  approveAs,
  awayFromMidnight,
  cancelAs,
  createQtyItem,
  emailOf,
  handOverAs,
  jakartaToday,
  lineOf,
  main,
  mustCreate,
  nameOf,
  requesterWithRoom,
  reqRow,
  requestUrl,
  returnAs,
  rejectAs,
  rpcAs,
  sweepQa,
  tag,
  type PersonaKey,
} from "./inventaris-helpers";

const TAG = tag();
let victim: PersonaKey | null = null;
test.afterAll(async () => {
  if (victim) setActive(emailOf(victim), true);
  await sweepQa(TAG);
});

test("a deactivated requester keeps their requests and name; Operations return the loan, cancel the approved one, a head rejects the waiting one; the member gets nothing (L1)", async ({ browser }) => {
  test.setTimeout(180_000);
  await awayFromMidnight();
  // Seed accounts that global-setup re-activates: regular, ketum, bendahara, admin
  victim = requesterWithRoom(4, ["pembina", "kabiro"]);
  test.skip(victim === null, "no requester with daily room left; rerun after midnight WIB");
  const who = victim!;
  const item = await createQtyItem(`${TAG} Nonaktif`, { good: 10 });
  const waiting = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 1 }] });
  const approved = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 1 }] });
  expect((await approveAs("kadep", approved.id)).ok).toBe(true);
  const loan = await mustCreate(who, { lines: [{ itemId: item.id, quantity: 2 }] });
  expect((await approveAs("kadep", loan.id)).ok).toBe(true);
  expect((await handOverAs("staffOps", loan.id, [{ line_id: lineOf(loan.id, item.id), quantity: 2 }])).ok).toBe(true);
  const name = nameOf(who);
  const ops = await signedInContext(browser, "staffOps");
  try {
    setActive(emailOf(who), false);

    // Nothing was deleted or auto-cancelled
    expect(reqRow(waiting.id).status).toBe("submitted");
    expect(reqRow(approved.id).status).toBe("approved");
    expect(reqRow(loan.id).status).toBe("borrowed");

    // The deactivated member's still-valid token gets nothing from the module
    for (const [fn, args] of [
      ["borrowing_my_requests", {}],
      ["borrowing_request_detail", { p_request_id: loan.id }],
      ["inventory_item_list", {}],
      ["borrowing_request_cancel", { p_request_id: waiting.id, p_version: reqRow(waiting.id).version }],
    ] as const) {
      const r = await rpcAs(who, fn, args);
      expect(r.ok, fn).toBe(false);
      expect(r.hint, fn).toMatch(/not_active_member|permission_required/);
    }

    // Operations still see the name and take the return (R13): the loan stays Dipinjam until a handler records it
    await ops.page.goto(requestUrl(loan.ref));
    await expect(main(ops.page).getByText(name, { exact: true })).toBeVisible();
    await expect(ops.page.getByRole("link", { name: "Terima pengembalian" })).toBeVisible();
    const back = await returnAs("staffOps", loan.id, [{ outcome: "good", line_id: lineOf(loan.id, item.id), quantity: 2 }]);
    expect(back.ok, JSON.stringify(back.body)).toBe(true);
    expect(reqRow(loan.id).status).toBe("returned");

    // Approved, not picked up: a handler cancels with a reason (A-IB34)
    expect((await cancelAs("staffOps", approved.id, null)).hint).toBe("reason_required");
    expect((await cancelAs("staffOps", approved.id, "Peminjam sudah tidak aktif")).ok).toBe(true);
    // Diajukan: a head rejects with a note
    expect((await rejectAs("kadep", waiting.id, "Peminjam sudah tidak aktif")).ok).toBe(true);
    expect(reqRow(waiting.id).status).toBe("rejected");
    await ops.page.goto(requestUrl(waiting.ref));
    await expect(main(ops.page).getByText(name, { exact: true })).toBeVisible(); // the name stays on history
  } finally {
    setActive(emailOf(who), true);
    await ops.context.close();
  }
});

test("B29, IB-23: with only ONE head in office, that head's own request waits, the screens say so, and there is no override; the second head decides once back", async ({ browser }) => {
  test.setTimeout(120_000);
  await awayFromMidnight();
  const item = await createQtyItem(`${TAG} Satu kepala`, { good: 3 });
  const made = await mustCreate("kadivLogistik", { lines: [{ itemId: item.id, quantity: 1 }] });
  const head = await signedInContext(browser, "kadivLogistik");
  try {
    setActive("kadep@nexus.test", false); // the other head (Kepala Departemen Operasional) leaves office
    await head.page.goto(requestUrl(made.ref));
    await expect(head.page.getByText(/Saat ini hanya ada satu pemberi persetujuan, jadi pengajuan ini menunggu kepala lain\./)).toBeVisible();
    await expect(head.page.getByRole("button", { name: /^Setujui$|^Tolak$/ })).toHaveCount(0);
    await head.page.goto("/inventaris/antrean?view=pending");
    await expect(head.page.getByText("Hanya kamu yang bisa menyetujui saat ini. Pengajuanmu sendiri menunggu kepala lain.")).toBeVisible();
    // No override anywhere: the function refuses, the status stays Diajukan
    const own = await approveAs("kadivLogistik", made.id);
    expect(own.hint).toBe("self_approval_blocked");
    expect((await rpcAs("kadivLogistik", "borrowing_request_reject", { p_request_id: made.id, p_version: reqRow(made.id).version, p_note: "x" })).hint).toBe("self_approval_blocked");
    expect(reqRow(made.id).status).toBe("submitted");
    // The other head cannot act while deactivated (L1), and can once back
    expect((await approveAs("kadep", made.id)).ok).toBe(false);
    setActive("kadep@nexus.test", true);
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    expect((await cancelAs("staffOps", made.id, "QA")).ok).toBe(true);
  } finally {
    setActive("kadep@nexus.test", true);
    await head.context.close();
  }
});

test("IB-18, R8: members see counts and dates for an item, never who holds it (functions and pages)", async ({ browser }) => {
  test.setTimeout(120_000);
  await awayFromMidnight();
  const holder = requesterWithRoom(2, ["pembina", "regular"]);
  test.skip(holder === null, "no requester with daily room left; rerun after midnight WIB");
  const item = await createQtyItem(`${TAG} Privasi`, { good: 4 });
  const made = await mustCreate(holder!, { lines: [{ itemId: item.id, quantity: 3 }] });
  expect((await approveAs("kadep", made.id)).ok).toBe(true);
  const name = nameOf(holder!);
  const viewer = await signedInContext(browser, "pembina");
  try {
    const today = jakartaToday();
    for (const [fn, args] of [
      ["inventory_item_detail", { p_item_id: item.id }],
      ["inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: today }],
      ["inventory_availability_bulk", { p_item_ids: [item.id], p_from: today, p_to: today }],
      ["inventory_item_list", { p_search: item.name }],
    ] as const) {
      const r = await rpcAs("pembina", fn, args);
      expect(r.ok, fn).toBe(true);
      const text = JSON.stringify(r.body);
      expect(text, fn).not.toContain(name);
      expect(text, fn).not.toContain(made.ref);
      expect(text, fn).not.toContain(made.id);
    }
    await viewer.page.goto(`/inventaris/barang/${item.id}`);
    await expect(viewer.page.getByRole("heading", { level: 1, name: item.name })).toBeVisible();
    const html = await viewer.page.content();
    expect(html).not.toContain(name);
    expect(html).not.toContain(made.ref);
    // The held quantity shows as a count in the availability answer (4 total, 3 held -> 1 free)
    const free = await rpcAs("pembina", "inventory_item_availability", { p_item_id: item.id, p_from: today, p_to: today });
    expect(free.body[0].free_qty).toBe(1);
    expect(free.body[0].held_qty).toBe(3);
  } finally {
    await viewer.context.close();
    await cancelAs("staffOps", made.id, "QA");
  }
});
