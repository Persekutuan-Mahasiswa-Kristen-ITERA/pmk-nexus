// Finance: who may see and do what (spec section 2, FN-01..FN-07, FN-26, FN-28, FN-33, FN-35, B18).
// Every persona is checked three ways: the screens (drawer item, Dashboard card, buttons ABSENT, forbidden pages),
// the NEXUS route handlers and Server Actions called directly, and the database functions and tables called with the
// persona's own token. The expectations are written from the spec (K1 a: BPH read and export, the Treasurer also
// records and voids), not computed from the code under test.
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  awayFromMidnight,
  callAction,
  detailAs,
  drawerItems,
  entryCount,
  entryRow,
  entryUrl,
  EXPORT,
  expectForbiddenScreen,
  fakeProof,
  FINANCE_ITEM,
  jakartaToday,
  main,
  MANAGERS,
  mustRecord,
  noHorizontalScroll,
  NO_KEY,
  ORIGIN,
  PATHS,
  READERS,
  recordAs,
  rpcAs,
  summaryAs,
  sweepQa,
  tableAs,
  tag,
  UPLOAD,
  voidAs,
  type PersonaKey,
  type Who,
  card,
  exportLogCount,
  PDF_BYTES,
} from "./finance-helpers";
import { randomUUID } from "node:crypto";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

let entryId = "";
let ready = false;
async function setup() {
  if (ready) return;
  await awayFromMidnight();
  entryId = (await mustRecord("bendahara", { description: `${TAG} akses`, amount: "12500" })).id;
  ready = true;
}

type Expect = { view: boolean; manage: boolean; exportKey: boolean };
const MANAGER: Expect = { view: true, manage: true, exportKey: true };
const READER: Expect = { view: true, manage: false, exportKey: true };
const NONE: Expect = { view: false, manage: false, exportKey: false };
const PERSONAS_UI: [PersonaKey, string, Expect][] = [
  ["bendahara", "Treasurer, Bendahara Umum 1 (P-BEND): views, records, voids, exports", MANAGER],
  ["ketum", "BPH, Ketua Umum (P-KETUM): reads and exports, cannot record", READER],
  ["sekjen", "BPH, Sekretaris Jenderal (P-SEKJEN): the same", READER],
  ["sekum1", "BPH, Sekretaris Umum 1: the same", READER],
  ["regular", "regular member (P-PLAIN)", NONE],
  ["pembina", "lecturer without an assignment (P-LECT)", NONE],
  ["admin", "System Admin without a position (P-ADMIN, B18): nothing", NONE],
  ["sekdep", "department secretary (P-SEKDEP)", NONE],
  ["kabiro", "Kepala Biro (head, no Finance key)", NONE],
  ["kadep", "Operations head (no Finance key)", NONE],
  ["kadivLogistik", "Kepala Divisi Logistik (no Finance key)", NONE],
  ["staffOps", "Operations staff (no Finance key)", NONE],
];

test.describe("the roster written from the spec matches the helper lists", () => {
  test("MANAGERS, READERS and NO_KEY cover exactly the personas below", () => {
    const listed = PERSONAS_UI.map(([p]) => p).sort();
    expect([...MANAGERS, ...READERS, ...NO_KEY].sort()).toEqual(listed);
  });
});

test.describe("FN-01..FN-03, FN-28, FN-33: screens per persona", () => {
  for (const [persona, label, want] of PERSONAS_UI) {
    test(`${label}`, async ({ browser }) => {
      await setup();
      const { context, page } = await signedInContext(browser, persona);
      try {
        // Drawer item: only for finance.view holders, before Surat Menyurat (D-021, Stitch order).
        await page.goto("/");
        const items = await drawerItems(page);
        if (want.view) {
          expect(items).toContain(FINANCE_ITEM);
          expect(items.indexOf(FINANCE_ITEM)).toBeLessThan(items.indexOf("Surat Menyurat"));
        } else {
          expect(items).not.toContain(FINANCE_ITEM);
        }

        // Dashboard card: the same people (FN-33).
        const finCard = card(page);
        if (want.view) {
          await expect(finCard).toBeVisible();
          await expect(finCard.getByRole("link", { name: "Buka Finance" })).toBeVisible();
        } else {
          await expect(finCard).toHaveCount(0);
        }

        // The list.
        await page.goto(PATHS.list);
        if (!want.view) {
          await expectForbiddenScreen(page);
          await page.goto(entryUrl(entryId));
          await expectForbiddenScreen(page);
        } else {
          await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
          await expect(page.getByRole("link", { name: `${TAG} akses` }).first()).toBeVisible();
          // Buttons are ABSENT, never greyed out.
          await expect(page.getByRole("link", { name: "Catat transaksi" })).toHaveCount(want.manage ? 1 : 0);
          if (!want.manage) await expect(page.getByRole("link", { name: "Catat saldo awal" })).toHaveCount(0);
          await expect(page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(want.exportKey ? 1 : 0);
          expect(await noHorizontalScroll(page)).toBe(true);

          // The detail: only a manager gets the action buttons (F4, F6).
          await page.goto(entryUrl(entryId));
          await expect(page.getByRole("heading", { level: 1, name: "Detail Transaksi" })).toBeVisible();
          await expect(main(page).getByText("Rp 12.500").first()).toBeVisible();
          for (const name of ["Batalkan transaksi", "Tambah bukti"]) {
            await expect(page.getByRole("button", { name, exact: true })).toHaveCount(want.manage ? 1 : 0);
          }
          await expect(page.getByRole("link", { name: "Buat koreksi" })).toHaveCount(0); // a current-period entry is never corrected
          expect(await noHorizontalScroll(page)).toBe(true);
        }

        // The write forms: managers only.
        for (const path of [PATHS.record, PATHS.opening]) {
          await page.goto(path);
          if (want.manage) await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          else await expectForbiddenScreen(page);
        }
        if (want.manage) await expect(page.getByRole("heading", { level: 1, name: "Catat Transaksi" })).toHaveCount(0); // sanity: the opening page was last
      } finally {
        await context.close();
      }
    });
  }

  test("anonymous: every page redirects to login, nothing is rendered", async () => {
    await setup();
    for (const path of [PATHS.list, PATHS.record, PATHS.opening, entryUrl(entryId)]) {
      const res = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
      expect([302, 303, 307, 308], path).toContain(res.status);
      expect(res.headers.get("location") ?? "", path).toContain("/login");
    }
  });
});

test.describe("FN-01, FN-02, FN-03, FN-04, FN-07: the database functions with each persona's own token", () => {
  const WHO: [Who, Expect][] = [
    ...PERSONAS_UI.map(([p, , e]) => [p, e] as [Who, Expect]),
    ["inactive", NONE],
    ["unlinked", NONE],
    ["anon", NONE],
  ];
  test("reads: view holders get data, everyone else is refused", async () => {
    await setup();
    for (const [who, want] of WHO) {
      const summary = await summaryAs(who);
      const detail = await detailAs(who, entryId);
      const list = await rpcAs(who, "finance_entry_list", {});
      const periods = await rpcAs(who, "finance_period_list", {});
      for (const [name, r] of [["finance_summary", summary], ["finance_entry_detail", detail], ["finance_entry_list", list], ["finance_period_list", periods]] as const) {
        expect(r.ok, `${who} ${name}: ${JSON.stringify(r.body).slice(0, 120)}`).toBe(want.view);
        if (!want.view) expect(r.status, `${who} ${name}`).toBeGreaterThanOrEqual(401);
      }
    }
  });

  test("writes: only the Treasurer; a reader's call is refused with permission_required and changes nothing", async () => {
    await setup();
    const before = entryCount();
    for (const [who, want] of WHO) {
      const description = `${TAG} dari ${String(who)}`;
      const rec = await recordAs(who, { description, amount: "777" });
      expect(rec.ok, `${who} record: ${JSON.stringify(rec.body).slice(0, 120)}`).toBe(want.manage);
      if (!want.manage && who !== "anon") expect(rec.hint ?? rec.code, `${who} record`).toBeDefined();
      if (want.manage && rec.ok) {
        const created = (Array.isArray(rec.body) ? rec.body[0] : rec.body).entry_id as string;
        expect((await voidAs(who, created)).ok).toBe(true);
      }
    }
    for (const [who, want] of WHO) {
      if (want.manage) continue;
      const v = await voidAs(who, entryId);
      expect(v.ok, `${who} void`).toBe(false);
      const p = await rpcAs(who, "finance_entry_add_proof", { p_entry_id: entryId, p_files: [fakeProof("bendahara")] });
      expect(p.ok, `${who} add proof`).toBe(false);
      const w = await rpcAs(who, "finance_entry_withdraw_proof", { p_file_id: 1, p_reason: "liar" });
      expect(w.ok, `${who} withdraw`).toBe(false);
    }
    expect(entryRow(entryId).status).toBe("active");
    // Only the managers' own saves (made and voided above) were added.
    expect(entryCount()).toBe(before + MANAGERS.length);
  });

  test("a reader's refusal names the missing key (hint permission_required), not a generic failure", async () => {
    await setup();
    const r = await recordAs("ketum", { description: `${TAG} tolak` });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.hint).toBe("permission_required");
    const n = await rpcAs("regular", "finance_summary");
    expect(n.hint).toBe("permission_required");
  });

  test("export function: view AND export are needed (R15); a no-key persona is refused before any log row", async () => {
    await setup();
    const logs = exportLogCount();
    for (const [who, want] of WHO) {
      if (want.exportKey) continue;
      const r = await rpcAs(who, "finance_export", { p_format: "csv" });
      expect(r.ok, `${who} export`).toBe(false);
    }
    expect(exportLogCount()).toBe(logs);
  });
});

test.describe("FN-14, FN-35: direct table access (REST) is closed for writes and for people without a key", () => {
  const TABLES = ["finance_entries", "finance_entry_files", "finance_entry_history", "finance_counter", "finance_export_logs"];

  test("no persona and no anonymous caller can write or delete a row in any Finance table", async () => {
    await setup();
    const before = entryCount();
    for (const who of ["bendahara", "ketum", "admin", "regular", "anon"] as Who[]) {
      for (const t of TABLES) {
        const del = await tableAs(who, "DELETE", `${t}?id=gt.0`);
        expect(del.ok && Array.isArray(del.body) && del.body.length > 0, `${who} DELETE ${t}`).toBe(false);
        const patch = await tableAs(who, "PATCH", `${t}?id=gt.0`, { description: "liar" });
        expect(patch.ok && Array.isArray(patch.body) && patch.body.length > 0, `${who} PATCH ${t}`).toBe(false);
      }
      const post = await tableAs(who, "POST", "finance_entries", { entry_type: "income", amount: 1, description: "liar" });
      expect(post.ok, `${who} POST finance_entries`).toBe(false);
    }
    expect(entryCount()).toBe(before);
    expect(entryRow(entryId).description).toBe(`${TAG} akses`);
    expect(entryRow(entryId).status).toBe("active");
  });

  test("reading the tables directly: nothing for a persona without a key; the export log is unreadable for everyone", async () => {
    await setup();
    for (const who of [...NO_KEY, "inactive", "unlinked", "anon"] as Who[]) {
      for (const t of TABLES) {
        const r = await tableAs(who, "GET", `${t}?select=*&limit=5`);
        const rows = r.ok && Array.isArray(r.body) ? r.body.length : 0;
        expect(rows, `${who} GET ${t}`).toBe(0);
      }
    }
    for (const who of ["bendahara", "ketum"] as Who[]) {
      const logs = await tableAs(who, "GET", "finance_export_logs?select=id&limit=1");
      expect(logs.ok && Array.isArray(logs.body) && logs.body.length > 0, `${who} reads the export log`).toBe(false);
    }
    // A reader sees entries but never the counter (the Treasurers only, FN-35).
    const counter = await tableAs("ketum", "GET", "finance_counter?select=*");
    expect(counter.ok && Array.isArray(counter.body) && counter.body.length > 0).toBe(false);
    const entries = await tableAs("ketum", "GET", `finance_entries?select=id&id=eq.${entryId}`);
    expect(entries.ok && Array.isArray(entries.body) && entries.body.length === 1).toBe(true);
  });
});

test.describe("FN-26, FN-28: the route handlers and Server Actions, called directly", () => {
  test("export route: no key, cross-site and anonymous are refused; nothing is logged", async ({ browser }) => {
    await setup();
    const logs = exportLogCount();
    const body = { format: "csv", filters: {} };
    for (const persona of NO_KEY) {
      const c = await signedInContext(browser, persona);
      try {
        const res = await c.context.request.post(EXPORT, { data: body, headers: { origin: ORIGIN } });
        expect(res.status(), `${persona} export`).toBe(403);
        expect((await res.json()).error.code).toBe("forbidden");
      } finally {
        await c.context.close();
      }
    }
    const treasurer = await signedInContext(browser, "bendahara");
    try {
      const evil = await treasurer.context.request.post(EXPORT, { data: body, headers: { origin: "https://evil.example" } });
      expect(evil.status(), "cross-site").toBe(403);
      const noOrigin = await treasurer.context.request.post(EXPORT, { data: body });
      expect(noOrigin.status(), "no origin").toBe(403);
      const get = await treasurer.context.request.get(EXPORT);
      expect(get.status(), "GET is not allowed: an export writes a log row").toBe(405);
    } finally {
      await treasurer.context.close();
    }
    const anon = await fetch(`${ORIGIN}${EXPORT}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
    expect([401, 403]).toContain(anon.status);
    expect(exportLogCount()).toBe(logs);
  });

  test("upload route: a reader or a person without a key is refused; other methods are 405", async ({ browser }) => {
    await setup();
    for (const persona of [...READERS, "regular", "admin"] as PersonaKey[]) {
      const c = await signedInContext(browser, persona);
      try {
        const res = await c.context.request.post(UPLOAD, {
          multipart: { file: { name: "nota.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() } },
          headers: { origin: ORIGIN },
        });
        expect(res.status(), `${persona} upload`).toBe(403);
      } finally {
        await c.context.close();
      }
    }
    const treasurer = await signedInContext(browser, "bendahara");
    try {
      expect((await treasurer.context.request.get(UPLOAD)).status()).toBe(405);
      const evil = await treasurer.context.request.post(UPLOAD, {
        multipart: { file: { name: "nota.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() } },
        headers: { origin: "https://evil.example" },
      });
      expect(evil.status(), "cross-site upload").toBe(403);
    } finally {
      await treasurer.context.close();
    }
  });

  test("Server Actions: a reader, a no-key member and an admin are refused with forbidden and nothing changes; the Treasurer succeeds", async ({ browser }) => {
    await setup();
    const readerCtx = await signedInContext(browser, "ketum");
    const memberCtx = await signedInContext(browser, "regular");
    const adminCtx = await signedInContext(browser, "admin");
    const treasurer = await signedInContext(browser, "bendahara");
    try {
      const before = entryCount();
      const record = [{ entryType: "expense", entryDate: jakartaToday(), amount: "999", description: `${TAG} aksi liar`, notes: "", files: [], correctsEntryId: null, submitKey: randomUUID() }];
      for (const ctx of [readerCtx.context, memberCtx.context, adminCtx.context]) {
        expect(await callAction(ctx, "recordFinanceEntry", record)).toContain('"forbidden"');
        expect(await callAction(ctx, "voidFinanceEntry", [{ entryId, reason: "liar" }])).toContain('"forbidden"');
        expect(await callAction(ctx, "addFinanceProof", [{ entryId, files: [fakeProof("bendahara")] }])).toContain('"forbidden"');
        expect(await callAction(ctx, "withdrawFinanceProof", [{ fileId: 1, reason: "liar" }])).toContain('"forbidden"');
      }
      // "Lihat" is finance.view: a reader is allowed to ask (and gets not_found for a missing file), a no-key member is not.
      for (const ctx of [memberCtx.context, adminCtx.context]) {
        expect(await callAction(ctx, "getFinanceProofLink", [{ entryId, fileId: 1 }])).toContain('"forbidden"');
      }
      expect(await callAction(readerCtx.context, "getFinanceProofLink", [{ entryId, fileId: 2147483647 }])).not.toContain('"forbidden"');
      expect(entryCount()).toBe(before);
      expect(entryRow(entryId).status).toBe("active");

      // Sanity: the same channel works for the holder of the key.
      const ok = await callAction(treasurer.context, "recordFinanceEntry", [{ ...record[0], description: `${TAG} aksi sah`, submitKey: randomUUID() }]);
      expect(ok).toContain('"ok":true');
      expect(entryCount()).toBe(before + 1);
    } finally {
      for (const c of [readerCtx, memberCtx, adminCtx, treasurer]) await c.context.close();
    }
  });
});
