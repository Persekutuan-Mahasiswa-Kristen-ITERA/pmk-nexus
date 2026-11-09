// Inventory and Borrowing: who may see and do what (spec section 2, IB-01..IB-06, IB-20, IB-22, IB-26, IB-41).
// Every persona is checked three ways: the screens (segments, buttons ABSENT, forbidden pages), the NEXUS route
// handlers and Server Actions called directly, and the database functions called with the persona's own token.
import { readFileSync } from "node:fs";
import { expect, test, type APIResponse, type BrowserContext } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  addDays,
  approveAs,
  awayFromMidnight,
  createQtyItem,
  CATALOG_PATH,
  EXPORT_BORROWING,
  EXPORT_CATALOG,
  EVIDENCE,
  exportLogCount,
  drawerItems,
  expectForbiddenScreen,
  INVENTORY_ITEM,
  jakartaToday,
  lineOf,
  main,
  mustCreate,
  ORIGIN,
  q,
  qn,
  requesterWithRoom,
  reqRow,
  requestUrl,
  rpcAs,
  segmentLabels,
  sweepQa,
  tableAs,
  tag,
  type PersonaKey,
  type Qty,
  type Who,
} from "./inventaris-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

// What each persona may do, written from spec section 2 (not computed from the code under test).
type Expect = { drawer: string[]; segments: string[]; manage: boolean; queue: boolean; exportCatalog: boolean; approve: boolean; handle: boolean };
const MEMBER: Expect = { drawer: ["Dashboard", INVENTORY_ITEM], segments: ["Katalog", "Peminjaman Saya"], manage: false, queue: false, exportCatalog: false, approve: false, handle: false };
const BPH: Expect = { ...MEMBER, segments: ["Katalog", "Peminjaman Saya", "Antrean"], queue: true, exportCatalog: true };
const OPS_STAFF: Expect = { ...MEMBER, segments: ["Katalog", "Peminjaman Saya", "Antrean", "Kelola Barang"], manage: true, queue: true, exportCatalog: true, handle: true };
const OPS_HEAD: Expect = { ...OPS_STAFF, approve: true };
const PERSONAS_UI: [PersonaKey, string, Expect][] = [
  ["regular", "regular member (Staff IT)", MEMBER],
  ["pembina", "lecturer (P-LECT)", MEMBER],
  ["admin", "System Admin without a position (P-ADMIN)", MEMBER],
  ["kabiro", "Kepala Biro Kewirausahaan (head, but not of Operations; sees Data Anggota by D32)", { ...MEMBER, drawer: ["Dashboard", "Data Anggota", INVENTORY_ITEM] }],
  ["ketum", "BPH, Ketua Umum (P-KETUM)", { ...BPH, drawer: ["Dashboard", "Data Anggota", INVENTORY_ITEM] }],
  ["bendahara", "BPH, Bendahara Umum 1 (Treasurer)", { ...BPH, drawer: ["Dashboard", "Data Anggota", INVENTORY_ITEM] }],
  ["staffOps", "Operations staff (Staff Akomodasi)", OPS_STAFF],
  ["kadivLogistik", "Operations head (Kepala Divisi Logistik)", OPS_HEAD],
  ["kadep", "Operations head (Kepala Departemen Operasional)", { ...OPS_HEAD, drawer: ["Dashboard", "Data Anggota", INVENTORY_ITEM] }],
];
const DENIED_PAGES = ["/inventaris/antrean", "/inventaris/kelola", "/inventaris/kelola/barang/baru", "/inventaris/kelola/daftar"];

test.describe("IB-01, IB-02, IB-04: screens per persona (drawer, segments, buttons absent, forbidden pages)", () => {
  for (const [persona, label, want] of PERSONAS_UI) {
    test(`${persona} (${label})`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        expect(await drawerItems(page)).toEqual(want.drawer);
        await page.goto(CATALOG_PATH);
        await expect(page.getByRole("heading", { level: 1, name: INVENTORY_ITEM })).toBeVisible();
        expect(await segmentLabels(page)).toEqual(want.segments);
        // Everyone active can request (L9)
        await expect(page.getByRole("link", { name: "Ajukan Peminjaman" })).toBeVisible();
        // The catalog is readable by every active member; the seeded items exist
        await expect(main(page).getByText(/^Menampilkan \d+-\d+ dari \d+ barang$/)).toBeVisible();
        // Export button: only with inventory.export; absent (not greyed) otherwise
        if (want.exportCatalog) await expect(page.locator("summary", { hasText: "Ekspor" })).toBeVisible();
        else {
          await expect(page.locator("summary", { hasText: "Ekspor" })).toHaveCount(0);
          await expect(page.getByRole("button", { name: /Excel|CSV|PDF/ })).toHaveCount(0);
        }

        for (const path of DENIED_PAGES) {
          const allowed = path === "/inventaris/antrean" ? want.queue : want.manage;
          const res = await page.goto(path);
          expect(res?.status()).toBe(200);
          if (allowed) {
            await expect(page.getByText("Tidak punya akses", { exact: true })).toHaveCount(0);
            await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          } else {
            await expectForbiddenScreen(page);
            // Nothing of the module's data in the shell
            await expect(page.getByRole("link", { name: /^PJM-/ })).toHaveCount(0);
          }
        }
        if (want.manage) {
          await page.goto(MANAGE_PATH_);
          await expect(page.getByRole("link", { name: "Tambah barang" }).first()).toBeVisible();
        }
      } finally {
        await context.close();
      }
    });
  }
});
const MANAGE_PATH_ = "/inventaris/kelola";

test.describe("IB-03: deactivated, unlinked and anonymous get nothing", () => {
  for (const persona of ["inactive", "unlinked"] as const) {
    test(`${persona}: 'Belum ada akses' on every inventory URL, never the catalog (the screen drops the session, so every URL gets a fresh context)`, async ({ browser }) => {
      for (const path of [CATALOG_PATH, "/inventaris/saya", "/inventaris/antrean", "/inventaris/kelola", "/inventaris/ajukan", "/inventaris/kelola/barang/baru"]) {
        const { context, page } = await signedInContext(browser, persona);
        try {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1, name: "Belum ada akses" })).toBeVisible();
          await expect(page.getByText(/Barang Uji/)).toHaveCount(0);
          await expect(page.getByRole("link", { name: /Ajukan Peminjaman|Antrean|Kelola/ })).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    });
  }
  test("anonymous: redirected to login, and API/route calls are refused", async ({ page, request }) => {
    await page.goto(CATALOG_PATH);
    await expect(page).toHaveURL(/\/login/);
    const exp = await request.post(EXPORT_CATALOG, { data: { format: "csv", filters: {} }, headers: { origin: ORIGIN } });
    expect([401, 403]).toContain(exp.status());
    const ev = await request.post(EVIDENCE, { multipart: { requestId: "11111111-2222-3333-4444-555555555555" }, headers: { origin: ORIGIN } });
    expect([401, 403]).toContain(ev.status());
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("IB-57, IB-48: permission catalog and row-level security of the module (read-only SELECTs)", () => {
  test("22 keys, 35 enabled default rules plus 1 retired (D30), D30 stays disabled and listed as retired", () => {
    expect(qn("select count(*) from nexus.permissions")).toBe(22);
    expect(qn("select count(*) from nexus.access_rules where default_code is not null and is_enabled")).toBe(35);
    expect(qn("select count(*) from nexus.access_rules where default_code is not null")).toBe(36);
    expect(q("select is_enabled from nexus.access_rules where default_code = 'D30'")).toBe("f");
    expect(q("select count(*) from nexus.retired_default_rules where default_code = 'D30'")).toBe("1");
    for (const key of ["inventory.view", "inventory.manage", "inventory.export", "borrowing.view_all", "borrowing.approve", "borrowing.handle", "borrowing.export"]) {
      expect(qn(`select count(*) from nexus.permissions where key = '${key}'`), key).toBe(1);
    }
    // borrowing.handle: not sensitive, never baseline (A-IB36); approve and handle are power keys (written reason)
    expect(q("select is_sensitive from nexus.permissions where key = 'borrowing.handle'")).toBe("f");
  });
  test("RLS is enabled on every nexus table; the module's tables have no INSERT/UPDATE/DELETE policy for API roles (only the functions write)", () => {
    expect(qn("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'nexus' and c.relkind = 'r' and not c.relrowsecurity")).toBe(0);
    expect(
      qn(`select count(*) from pg_policies where schemaname = 'nexus' and (tablename like 'borrowing\\_%' or tablename like 'inventory\\_%') and cmd <> 'SELECT'`),
    ).toBe(0);
    // The patterns above must really match the module's tables (a zero count would otherwise prove nothing)
    expect(qn(`select count(*) from pg_policies where schemaname = 'nexus' and (tablename like 'borrowing\\_%' or tablename like 'inventory\\_%') and cmd = 'SELECT'`)).toBeGreaterThanOrEqual(15);
    expect(qn(`select count(*) from information_schema.role_table_grants where table_schema = 'nexus' and table_name like 'borrowing\\_%' and grantee = 'authenticated' and privilege_type = 'SELECT'`)).toBeGreaterThanOrEqual(8);
    // Table privileges: the API roles hold SELECT at most on these tables
    expect(
      qn(`select count(*) from information_schema.role_table_grants where table_schema = 'nexus' and (table_name like 'borrowing\\_%' or table_name like 'inventory\\_%') and grantee in ('anon','authenticated','service_role') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`),
    ).toBe(0);
    expect(qn(`select count(*) from information_schema.role_table_grants where table_schema = 'nexus' and table_name like 'borrowing\\_%' and grantee = 'anon'`)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("request detail: buttons per persona and L9 privacy (IB-05, IB-15, IB-20, IB-22, IB-26)", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  let item: Qty;
  let sub: { id: string; ref: string };
  let apr: { id: string; ref: string };
  let ownSub: { id: string; ref: string };
  let REQ: PersonaKey;

  test("setup: one Diajukan and one Disetujui (start today) request of member.regular, one Diajukan request of a head", async () => {
    await awayFromMidnight();
    const picked = requesterWithRoom(3, ["pembina", "admin", "kabiro", "ketum"]);
    test.skip(picked === null, "no requester has daily room left (20 per member per Jakarta day); rerun after midnight WIB");
    REQ = picked!;
    item = await createQtyItem(`${TAG} Akses`, { good: 20 });
    sub = await mustCreate(REQ, { lines: [{ itemId: item.id, quantity: 1 }] });
    apr = await mustCreate(REQ, { lines: [{ itemId: item.id, quantity: 1 }] });
    expect((await approveAs("kadep", apr.id)).ok).toBe(true);
    ownSub = await mustCreate("kadivLogistik", { lines: [{ itemId: item.id, quantity: 1 }] });
    ready = true;
  });

  type Buttons = { approve: boolean; handover: boolean; extend: boolean; cancel: boolean; visible: boolean };
  const none: Buttons = { approve: false, handover: false, extend: false, cancel: false, visible: false };
  const cases: [PersonaKey | "REQUESTER", string, { sub: Buttons; apr: Buttons }][] = [
    ["kadep", "head (not the requester)", { sub: { ...none, visible: true, approve: true }, apr: { ...none, visible: true, handover: true, extend: true, cancel: true } }],
    ["kadivLogistik", "other head", { sub: { ...none, visible: true, approve: true }, apr: { ...none, visible: true, handover: true, extend: true, cancel: true } }],
    ["staffOps", "Operations staff (not a head)", { sub: { ...none, visible: true }, apr: { ...none, visible: true, handover: true, cancel: true } }], // a handle holder may cancel an approved request not yet picked up (A-IB34)
    ["ketum", "BPH: view only", { sub: { ...none, visible: true }, apr: { ...none, visible: true } }],
    ["REQUESTER", "the requester", { sub: { ...none, visible: true, cancel: true }, apr: { ...none, visible: true, cancel: true } }],
    ["pembina", "another member: not found", { sub: none, apr: none }],
    ["admin", "System Admin without Ops/BPH: not found (B18)", { sub: none, apr: none }],
    ["kabiro", "head of another unit: not found", { sub: none, apr: none }],
  ];
  for (const [who, label, want] of cases) {
    test(`${who} (${label})`, async ({ browser }) => {
      test.setTimeout(90_000);
      const persona: PersonaKey = who === "REQUESTER" ? REQ : who;
      const { context, page } = await signedInContext(browser, persona);
      try {
        for (const [key, req] of [["sub", sub], ["apr", apr]] as const) {
          const w = want[key];
          await page.goto(requestUrl(req.ref));
          if (!w.visible) {
            await expect(page.getByText("Pengajuan ini tidak ditemukan.")).toBeVisible();
            await expect(page.getByRole("heading", { level: 1, name: `Pengajuan ${req.ref}` })).toHaveCount(0);
            await expect(page.getByText(`${TAG} Akses`)).toHaveCount(0);
            continue;
          }
          await expect(page.getByRole("heading", { level: 1, name: `Pengajuan ${req.ref}` })).toBeVisible();
          const present = async (loc: ReturnType<typeof page.getByRole>) => (await loc.count()) > 0;
          expect(await present(page.getByRole("button", { name: "Setujui", exact: true })), `${key} Setujui`).toBe(w.approve);
          expect(await present(page.getByRole("button", { name: "Tolak", exact: true })), `${key} Tolak`).toBe(w.approve);
          expect(await present(page.getByRole("link", { name: "Serahkan barang" })), `${key} Serahkan`).toBe(w.handover);
          expect(await present(page.getByRole("button", { name: "Ubah tanggal kembali" })), `${key} Ubah tanggal`).toBe(w.extend);
          expect(await present(page.getByRole("button", { name: "Batalkan pengajuan" })), `${key} Batalkan`).toBe(w.cancel);
        }
      } finally {
        await context.close();
      }
    });
  }

  test("L6 on screen: the head's own Diajukan request has no Setujui/Tolak and says why; the other head sees them", async ({ browser }) => {
    const own = await signedInContext(browser, "kadivLogistik");
    const other = await signedInContext(browser, "kadep");
    try {
      await own.page.goto(requestUrl(ownSub.ref));
      await expect(own.page.getByText(/Tidak bisa memproses pengajuanmu sendiri/)).toBeVisible();
      await expect(own.page.getByRole("button", { name: /^Setujui$|^Tolak$/ })).toHaveCount(0);
      await other.page.goto(requestUrl(ownSub.ref));
      await expect(other.page.getByRole("button", { name: "Setujui", exact: true })).toBeVisible();
    } finally {
      await own.context.close();
      await other.context.close();
    }
  });

  // ------- direct calls with each persona's token -------
  const NO_ONE_BUT_OPS_HEADS = (): Who[] => ["staffOps", "ketum", "bendahara", "regular", "pembina", "admin", "kabiro"];
  test("IB-20: approve, reject and extend by direct call: only the two Operations heads (and never on their own request)", async () => {
    for (const who of NO_ONE_BUT_OPS_HEADS()) {
      const a = await rpcAs(who, "borrowing_request_approve", { p_request_id: sub.id, p_version: reqRow(sub.id).version });
      expect(a.ok, `approve as ${who}`).toBe(false);
      expect(a.hint, `approve as ${who}`).toBe("permission_required");
      const r = await rpcAs(who, "borrowing_request_reject", { p_request_id: sub.id, p_version: reqRow(sub.id).version, p_note: "x" });
      expect(r.hint, `reject as ${who}`).toBe("permission_required");
      const e = await rpcAs(who, "borrowing_request_extend", { p_request_id: apr.id, p_version: reqRow(apr.id).version, p_new_end_date: addDays(jakartaToday(), 5), p_note: "x" });
      expect(e.hint, `extend as ${who}`).toBe("permission_required");
    }
    expect(reqRow(sub.id).status).toBe("submitted");
    expect(reqRow(apr.id).end_date.slice(0, 10)).toBe(addDays(jakartaToday(), 1));
    // Own request (L6) refused for the head, allowed for the other head
    const own = await approveAs("kadivLogistik", ownSub.id);
    expect(own.hint).toBe("self_approval_blocked");
    expect((await approveAs("kadep", ownSub.id)).ok).toBe(true);
  });

  test("IB-26 / IB-04: handover and return by direct call: Operations only; BPH, admin and members are refused", async () => {
    for (const who of ["ketum", "bendahara", "regular", "pembina", "admin", "kabiro"] as Who[]) {
      const h = await rpcAs(who, "borrowing_request_hand_over", { p_request_id: apr.id, p_version: reqRow(apr.id).version, p_lines: [{ line_id: lineOf(apr.id, item.id), quantity: 1 }] });
      expect(h.ok, `hand over as ${who}`).toBe(false);
      expect(h.hint, `hand over as ${who}`).toBe("permission_required");
      const r = await rpcAs(who, "borrowing_request_return", { p_request_id: apr.id, p_version: reqRow(apr.id).version, p_outcomes: [{ outcome: "good", line_id: lineOf(apr.id, item.id), quantity: 1 }] });
      expect(r.hint, `return as ${who}`).toBe("permission_required");
      const c = await rpcAs(who, "borrowing_request_correct_return", { p_request_id: apr.id, p_version: reqRow(apr.id).version, p_reason: "x" });
      expect(c.ok, `correct as ${who}`).toBe(false);
    }
    expect(reqRow(apr.id).status).toBe("approved");
    // A non-handler member cannot cancel someone else's approved request either (AC-30)
    const cancel = await rpcAs("pembina", "borrowing_request_cancel", { p_request_id: apr.id, p_version: reqRow(apr.id).version, p_reason: "iseng" });
    expect(cancel.ok).toBe(false);
    expect(reqRow(apr.id).status).toBe("approved");
  });

  test("IB-01, IB-02: creating and editing items by direct call: Operations only", async () => {
    for (const who of ["regular", "pembina", "admin", "ketum", "bendahara", "kabiro"] as Who[]) {
      const c = await rpcAs(who, "inventory_item_create", { p_mode: "quantity", p_name: `${TAG} Terlarang ${who}`, p_stock: { good: 1 } });
      expect(c.ok, `create as ${who}`).toBe(false);
      expect(c.hint, `create as ${who}`).toBe("permission_required");
      for (const [fn, args] of [
        ["inventory_item_update", { p_item_id: item.id, p_name: "Diretas" }],
        ["inventory_stock_add", { p_item_id: item.id, p_condition: "good", p_quantity: 5, p_note: "x" }],
        ["inventory_item_set_active", { p_item_id: item.id, p_is_active: false }],
        ["inventory_category_add", { p_name: `Terlarang ${who}` }],
        ["inventory_location_add", { p_name: `Terlarang ${who}` }],
      ] as const) {
        const r = await rpcAs(who, fn, args);
        expect(r.ok, `${fn} as ${who}`).toBe(false);
        expect(r.hint, `${fn} as ${who}`).toBe("permission_required");
      }
    }
    expect(q(`select name from nexus.inventory_items where id = '${item.id}'`)).toBe(`${TAG} Akses`);
    expect(qn(`select count(*) from nexus.inventory_items where name like '${TAG} Terlarang%'`)).toBe(0);
  });

  test("IB-05, IB-15, IB-04: reads by direct call: members see only their own requests; the queue is for view_all holders; BPH can read everything", async () => {
    // The queue and counts (everyone except the requester, who is allowed to read only their own request)
    const strangers = (["regular", "pembina", "admin", "kabiro"] as PersonaKey[]).filter((p) => p !== REQ); // BPH (ketum, bendahara) holds view_all and is tested below
    for (const who of strangers) {
      for (const fn of ["borrowing_queue", "borrowing_queue_counts", "borrowing_open_loans", "borrowing_period_list"]) {
        const r = await rpcAs(who, fn, {});
        expect(r.ok, `${fn} as ${who}`).toBe(false);
        expect(r.hint, `${fn} as ${who}`).toBe("permission_required");
      }
      const detail = await rpcAs(who, "borrowing_request_detail", { p_request_id: sub.id });
      expect(detail.ok, `detail as ${who}`).toBe(false);
      expect(detail.hint, `detail as ${who}`).toBe("request_not_found"); // not "forbidden": no probing (R8)
      const byRef = await rpcAs(who, "borrowing_request_detail_by_ref", { p_reference: sub.ref });
      expect(byRef.hint, `by ref as ${who}`).toBe("request_not_found");
    }
    // A member's own list holds only their own rows
    const mine = await rpcAs("pembina", "borrowing_my_requests", { p_filter: "all", p_page: 1, p_page_size: 50 });
    expect(mine.ok).toBe(true);
    const text = JSON.stringify(mine.body);
    expect(text).not.toContain(sub.ref);
    // BPH: sees everything, read only
    for (const who of ["ketum", "bendahara"] as Who[]) {
      expect((await rpcAs(who, "borrowing_queue", { p_view: "all" })).ok, `queue as ${who}`).toBe(true);
      const d = await rpcAs(who, "borrowing_request_detail", { p_request_id: sub.id });
      expect(d.ok, `detail as ${who}`).toBe(true);
    }
    // No email, phone, NIM or NIP anywhere in a detail (IB-42)
    const detail = JSON.stringify((await rpcAs("ketum", "borrowing_request_detail", { p_request_id: sub.id })).body);
    for (const field of ["email", "phone", "nim", "nip", "user_id", "access_level"]) expect(detail.toLowerCase()).not.toContain(`"${field}"`);
    for (const secret of q("select coalesce(email,''), coalesce(nim,''), coalesce(phone,'') from public.members").split("\n").flatMap((l) => l.split("|")).filter((v) => v.length >= 6)) {
      expect(detail).not.toContain(secret);
    }
  });

  test("IB-03: a deactivated member and an unlinked account get nothing from any function, even with a still-valid token (L1)", async () => {
    for (const who of ["inactive", "unlinked"] as Who[]) {
      for (const [fn, args] of [
        ["inventory_item_list", {}],
        ["inventory_status_counts", {}],
        ["borrowing_my_requests", {}],
        ["borrowing_request_detail", { p_request_id: sub.id }],
        ["borrowing_request_create", { p_start_date: jakartaToday(), p_end_date: jakartaToday(), p_purpose: "x", p_lines: [{ item_id: item.id, quantity: 1 }] }],
      ] as const) {
        const r = await rpcAs(who, fn, args);
        expect(r.ok, `${fn} as ${who}`).toBe(false);
        expect(r.hint, `${fn} as ${who}`).toMatch(/not_active_member|permission_required/);
      }
    }
    // Anonymous (apikey only)
    const anon = await rpcAs("anon", "inventory_item_list", {});
    expect(anon.ok).toBe(false);
  });

  test("IB-41, IB-48: direct table access follows RLS: reads only by key or as the owner of the row, the export log is unreadable, and nobody can change or delete anything (BPH, Operations, admin, anonymous)", async () => {
    const tables = ["borrowing_requests", "borrowing_request_lines", "borrowing_status_history", "borrowing_evidence_photos", "inventory_items", "inventory_units", "inventory_stock", "inventory_item_history", "inventory_borrowing_export_logs", "borrowing_line_returns", "borrowing_extensions"];
    const counts = () => tables.map((t) => qn(`select count(*) from nexus.${t}`));
    const before = counts();
    const returnedBefore = qn("select count(*) from nexus.borrowing_requests where status = 'returned'");
    const adminId = q("select id from public.members where email = 'admin@nexus.test'");
    for (const who of ["ketum", "admin", "regular", "staffOps", "kadep", "anon"] as Who[]) {
      for (const table of tables) {
        const read = await tableAs(who, "GET", `${table}?select=*&limit=1000`);
        const rows: any[] = Array.isArray(read.body) ? read.body : []; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (who === "anon") expect(rows.length, `read ${table} as anon`).toBe(0);
        if (table === "inventory_borrowing_export_logs") expect(rows.length, `read export log as ${who}`).toBe(0); // no read policy at all
        // Without borrowing.view_all (admin has no Ops/BPH position) only one's OWN requests are readable
        if (who === "admin" && table === "borrowing_requests") for (const r of rows) expect(r.requester_member_id).toBe(adminId);
        if (who === "admin" && table === "inventory_item_history") expect(rows.length, "item history needs manage or view_all").toBe(0);
        // Delete and update must be refused outright or do nothing (RLS), never succeed
        await tableAs(who, "DELETE", `${table}?id=not.is.null`);
        await tableAs(who, "PATCH", `${table}?id=not.is.null`, { status: "returned" });
        const insert = await tableAs(who, "POST", table, { id: "00000000-0000-4000-8000-000000000001" });
        expect(insert.ok, `insert ${table} as ${who}`).toBe(false);
      }
    }
    expect(counts()).toEqual(before);
    expect(qn("select count(*) from nexus.borrowing_requests where status = 'returned'")).toBe(returnedBefore);
    expect(qn(`select count(*) from nexus.borrowing_requests where id = '${sub.id}'`)).toBe(1);
    expect(reqRow(sub.id).status).toBe("submitted");
  });

  test("IB-08, IB-41: even the database owner cannot change the mode of an item with requests or delete a request (guards), checked inside a rolled-back transaction", async () => {
    expect(() => q(`begin; update nexus.inventory_items set mode = 'tracked' where id = '${item.id}'; rollback;`)).toThrow();
    expect(() => q(`begin; delete from nexus.borrowing_status_history where request_id = '${sub.id}'; rollback;`)).toThrow();
    expect(() => q(`begin; update nexus.borrowing_status_history set note = 'x' where request_id = '${sub.id}'; rollback;`)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("route handlers called directly (export, evidence): session, key, same-origin and no log row on refusal (IB-43, IB-44)", () => {
  const post = (context: BrowserContext, url: string, data: unknown, headers: Record<string, string> = { origin: ORIGIN }): Promise<APIResponse> =>
    context.request.post(url, { data, headers, maxRedirects: 0 });

  const REFUSED: PersonaKey[] = ["regular", "pembina", "admin", "kabiro"];
  for (const persona of REFUSED) {
    test(`${persona}: catalog export 403, borrowing export 403, evidence upload 403; no log row`, async ({ browser }) => {
      const { context } = await signedInContext(browser, persona);
      try {
        const before = exportLogCount();
        const a = await post(context, EXPORT_CATALOG, { format: "csv", filters: {} });
        expect(a.status()).toBe(403);
        expect((await a.json()).error.code).toBe("forbidden");
        const b = await post(context, EXPORT_BORROWING, { format: "csv", filters: { view: "all" } });
        expect(b.status()).toBe(403);
        const c = await context.request.post(EVIDENCE, { multipart: { requestId: "11111111-2222-3333-4444-555555555555" }, headers: { origin: ORIGIN } });
        expect(c.status()).toBe(403);
        expect(exportLogCount()).toBe(before);
      } finally {
        await context.close();
      }
    });
  }

  test("BPH may export but cannot upload evidence (needs borrowing.handle); staff can export but a wrong origin, GET and a missing Origin are refused", async ({ browser }) => {
    const bph = await signedInContext(browser, "ketum");
    const ops = await signedInContext(browser, "staffOps");
    try {
      const ev = await bph.context.request.post(EVIDENCE, { multipart: { requestId: "11111111-2222-3333-4444-555555555555" }, headers: { origin: ORIGIN } });
      expect(ev.status()).toBe(403);
      const before = exportLogCount();
      for (const url of [EXPORT_CATALOG, EXPORT_BORROWING, EVIDENCE]) {
        const get = await ops.context.request.get(url);
        expect(get.status(), `GET ${url}`).toBe(405);
        const noOrigin = await ops.context.request.post(url, { data: { format: "csv", filters: {} }, headers: {} });
        expect(noOrigin.status(), `no origin ${url}`).toBe(403);
        const evil = await ops.context.request.post(url, { data: { format: "csv", filters: {} }, headers: { origin: "https://evil.example" } });
        expect(evil.status(), `evil origin ${url}`).toBe(403);
      }
      // Bad body: invalid format / invalid filters are refused with a code, no file
      const bad = await post(ops.context, EXPORT_CATALOG, { format: "docx", filters: {} });
      expect(bad.status()).toBe(400);
      const badFilter = await post(ops.context, EXPORT_BORROWING, { format: "csv", filters: { view: "everything" } });
      expect(badFilter.status()).toBe(400);
      const badDates = await post(ops.context, EXPORT_BORROWING, { format: "csv", filters: { view: "all", from: "2026-12-31", to: "2026-01-01" } });
      expect(badDates.status()).toBe(400);
      expect(exportLogCount()).toBe(before);
    } finally {
      await bph.context.close();
      await ops.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("Server Actions called directly (Next-Action header) obey the same keys (CLAUDE.md 6: never only hide in the UI)", () => {
  type Manifest = Record<string, { exportedName?: string }>;
  const actionId = (name: string): string => {
    const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Manifest };
    const hit = Object.entries(manifest.node).find(([, v]) => v.exportedName === name);
    if (!hit) throw new Error(`server action ${name} not found in the build manifest`);
    return hit[0];
  };
  async function callAction(context: BrowserContext, name: string, args: unknown[]): Promise<string> {
    const res = await context.request.post(CATALOG_PATH, {
      headers: { "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", origin: ORIGIN, accept: "text/x-component" },
      data: JSON.stringify(args),
    });
    return await res.text();
  }

  test("createItem, approveRequest and handOverRequest as a plain member, BPH and Operations staff", async ({ browser }) => {
    await awayFromMidnight();
    const item = await createQtyItem(`${TAG} Aksi`, { good: 5 });
    const made = await mustCreate("pembina", { lines: [{ itemId: item.id, quantity: 1 }] });
    const regular = await signedInContext(browser, "regular");
    const bph = await signedInContext(browser, "ketum");
    const staff = await signedInContext(browser, "staffOps");
    try {
      const create = [{ mode: "quantity", name: `${TAG} Aksi liar`, stock: { good: 1 } }];
      for (const ctx of [regular.context, bph.context]) {
        const out = await callAction(ctx, "createItem", create);
        expect(out).toContain('"forbidden"');
      }
      const approve = [{ requestId: made.id, version: reqRow(made.id).version }];
      for (const ctx of [regular.context, bph.context, staff.context]) {
        const out = await callAction(ctx, "approveRequest", approve);
        expect(out).toContain('"forbidden"');
      }
      const hand = [{ requestId: made.id, version: reqRow(made.id).version, lines: [] }];
      for (const ctx of [regular.context, bph.context]) {
        expect(await callAction(ctx, "handOverRequest", hand)).toContain('"forbidden"');
      }
      expect(reqRow(made.id).status).toBe("submitted");
      expect(qn(`select count(*) from nexus.inventory_items where name = '${TAG} Aksi liar'`)).toBe(0);
      // Sanity: the same channel does work for someone who holds the key (Operations staff creates an item)
      const ok = await callAction(staff.context, "createItem", [{ mode: "quantity", name: `${TAG} Aksi sah`, stock: { good: 1 } }]);
      expect(ok).toContain('"ok":true');
      expect(qn(`select count(*) from nexus.inventory_items where name = '${TAG} Aksi sah'`)).toBe(1);
    } finally {
      for (const c of [regular, bph, staff]) await c.context.close();
    }
  });
});
