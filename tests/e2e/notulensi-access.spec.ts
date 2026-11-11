// Meeting Minutes: who sees and does what (spec section 2; MN-01..MN-08, MN-15, MN-18, MN-25, MN-28, MN-30), on screen AND by
// direct calls with the persona's own token. Expectations are written from the spec (N1 b, N2 c; default rules D04, D05, D17,
// D20, D23, D26, D27, D37), not computed from the code under test.
// Setup goes through the app's own database functions; every title starts with "QA<tag>" and is voided at the end.
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  ALL_MANAGERS,
  ALL_READERS,
  callAction,
  card,
  detailAs,
  drawerItems,
  editUrl,
  EXPORT,
  exportLogCount,
  expectForbiddenScreen,
  fakeFile,
  HEADS,
  listAs,
  main,
  minuteRow,
  minuteUrl,
  MINUTES_ITEM,
  minuteVersion,
  mustRecord,
  NO_KEY,
  noHorizontalScroll,
  ORIGIN,
  PATHS,
  PDF_BYTES,
  q,
  recordAs,
  ROOT_UNIT,
  rpcAs,
  sweepQa,
  tableAs,
  tag,
  UNITS,
  unitId,
  UPLOAD,
  voidAs,
  addFilesAs,
  updateAs,
  jakartaToday,
  type PersonaKey,
} from "./notulensi-helpers";

const TAG = tag();
test.afterAll(async () => {
  q("update nexus.access_rules set is_enabled = true where default_code = 'D37'");
  await sweepQa(TAG);
});

type Want = { view: "all" | "own" | "none"; manage: "all" | "own" | "none"; exportKey: "all" | "own" | "none"; own?: keyof typeof UNITS };
const MATRIX: [PersonaKey, string, Want][] = [
  ["sekjen", "BPH secretary (P-SEKJEN): reads, records, edits, voids and exports every unit", { view: "all", manage: "all", exportKey: "all" }],
  ["sekum1", "BPH secretary (Sekretaris Umum 1): same as Sekretaris Jenderal", { view: "all", manage: "all", exportKey: "all" }],
  ["ketum", "BPH (P-KETUM): reads and exports every unit, records nothing", { view: "all", manage: "none", exportKey: "all" }],
  ["bendahara", "BPH (P-BEND): reads and exports every unit, records nothing", { view: "all", manage: "none", exportKey: "all" }],
  ["sekdep", "Department secretary (P-SEKDEP, Departemen Internal): own unit only, all actions", { view: "own", manage: "own", exportKey: "own", own: "internal" }],
  ["kadep", "Kepala Departemen (D37, Departemen Operasional): reads own unit only, no write, no export", { view: "own", manage: "none", exportKey: "none", own: "ops" }],
  ["kabiro", "Kepala Biro (D37, Biro Kewirausahaan): reads own unit only, no write, no export", { view: "own", manage: "none", exportKey: "none", own: "biro" }],
  ["regular", "Plain member (P-PLAIN): nothing", { view: "none", manage: "none", exportKey: "none" }],
  ["pembina", "Lecturer (P-LECT): nothing", { view: "none", manage: "none", exportKey: "none" }],
  ["admin", "System Admin without a position (P-ADMIN, B18): nothing", { view: "none", manage: "none", exportKey: "none" }],
  ["kadivLogistik", "Kepala Divisi (B19): nothing", { view: "none", manage: "none", exportKey: "none" }],
  ["staffOps", "Staff (P-STAFF): nothing", { view: "none", manage: "none", exportKey: "none" }],
];

// One minute per unit of interest, made once (recorded by the BPH secretary, who manages all units).
let fixture: Record<keyof typeof UNITS | "root", string> | null = null;
async function setup() {
  if (fixture) return fixture;
  const make = async (u: string, title: string) => (await mustRecord("sekjen", { unit: u, title: `${TAG} ${title}`, content: `Isi ${title}`, files: [fakeFile("sekjen", `${title}.pdf`)] })).id;
  fixture = {
    root: await make(ROOT_UNIT(), "pleno"),
    bph: await make(unitId(UNITS.bph), "bph"),
    internal: await make(unitId(UNITS.internal), "internal"),
    ops: await make(unitId(UNITS.ops), "operasional"),
    biro: await make(unitId(UNITS.biro), "biro"),
    eksternal: await make(unitId(UNITS.eksternal), "eksternal"),
  };
  return fixture;
}
const unitsOf = (want: Want): (keyof typeof UNITS | "root")[] =>
  want.view === "all" ? ["root", "bph", "internal", "ops", "biro", "eksternal"] : want.view === "own" ? [want.own!] : [];

test.describe("MN-01..MN-06, MN-25, MN-28: the persona matrix on screen", () => {
  for (const [persona, label, want] of MATRIX) {
    test(`${persona}: ${label}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const ids = await setup();
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        const items = await drawerItems(page);
        // Drawer and Dashboard card: minutes.view holders only (D-021, N5 a).
        if (want.view === "none") {
          expect(items).not.toContain(MINUTES_ITEM);
          await expect(card(page)).toHaveCount(0);
        } else {
          expect(items).toContain(MINUTES_ITEM);
          await expect(card(page)).toBeVisible();
          await expect(card(page).getByRole("link", { name: "Buka notulensi" })).toBeVisible();
          await expect(card(page), "counts only: never a title (N5 a)").not.toContainText(TAG);
        }

        await page.goto(PATHS.list);
        if (want.view === "none") {
          await expectForbiddenScreen(page);
          await page.goto(minuteUrl(ids.bph));
          await expectForbiddenScreen(page);
          await page.goto(PATHS.record);
          await expectForbiddenScreen(page);
          return;
        }
        await expect(page.getByRole("heading", { level: 1, name: MINUTES_ITEM })).toBeVisible();
        await page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}`);
        const visible = unitsOf(want);
        const expected = { root: "pleno", bph: "bph", internal: "internal", ops: "operasional", biro: "biro", eksternal: "eksternal" };
        // Wait for the list itself (it streams in after the header), then compare: allInnerTexts() does not wait.
        await expect(main(page).locator("article").first()).toBeVisible();
        await expect(main(page).locator("article")).toHaveCount(visible.length);
        const titles = await main(page).locator("article h3 a").allInnerTexts();
        for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
          const shown = titles.includes(`${TAG} ${expected[key]}`);
          expect(shown, `${persona} sees the ${key} minute`).toBe(visible.includes(key));
        }
        // Buttons are ABSENT, never greyed out.
        await expect(page.getByRole("link", { name: "Catat notulensi" })).toHaveCount(want.manage === "none" ? 0 : 1);
        await expect(page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(want.exportKey === "none" ? 0 : 1);
        // The Unit filter is offered only to someone who reads more than one unit (MN-22).
        await page.getByRole("button", { name: "Filter" }).click();
        await expect(page.getByLabel("Unit", { exact: true })).toHaveCount(want.view === "all" ? 1 : 0);
        await page.keyboard.press("Escape");
        expect(await noHorizontalScroll(page)).toBe(true);

        // A detail inside the scope: buttons follow manage; outside the scope: "not found", never the content.
        const inside = want.view === "all" ? ids.bph : ids[want.own!];
        await page.goto(minuteUrl(inside));
        await expect(page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Ubah" })).toHaveCount(want.manage === "none" ? 0 : 1);
        await expect(page.getByRole("button", { name: "Batalkan notulensi" })).toHaveCount(want.manage === "none" ? 0 : 1);
        await expect(page.getByRole("button", { name: "Tambah lampiran" })).toHaveCount(want.manage === "none" ? 0 : 1);
        await expect(page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(want.exportKey === "none" ? 0 : 1);
        expect(await noHorizontalScroll(page)).toBe(true);
        if (want.view === "own") {
          await page.goto(minuteUrl(ids.eksternal));
          await expect(page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toHaveCount(0);
          await expect(main(page)).not.toContainText(`${TAG} eksternal`);
          await expect(main(page)).not.toContainText("Isi eksternal");
        }
        // The record and edit pages: managers only.
        await page.goto(PATHS.record);
        if (want.manage === "none") await expectForbiddenScreen(page);
        else await expect(page.getByRole("heading", { level: 1, name: "Catat Notulensi" })).toBeVisible();
        await page.goto(editUrl(inside));
        if (want.manage === "none") await expect(page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toHaveCount(0);
        else await expect(page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }

  test("MN-02: the department secretary's unit is a read-only line 'Sesuai jabatanmu.'; the BPH secretary picks among the allowed units, divisions are not offered (N2 c)", async ({ browser }) => {
    const sekdep = await signedInContext(browser, "sekdep");
    const sekjen = await signedInContext(browser, "sekjen");
    try {
      await sekdep.page.goto(PATHS.record);
      await expect(sekdep.page.getByText("Sesuai jabatanmu.")).toBeVisible();
      await expect(main(sekdep.page).getByText(UNITS.internal, { exact: true })).toBeVisible();
      await expect(sekdep.page.locator("select")).toHaveCount(0);
      await sekjen.page.goto(PATHS.record);
      const options = (await sekjen.page.getByLabel("Unit", { exact: true }).locator("option").allInnerTexts()).filter((o) => o !== "Pilih unit");
      const want = ["Seluruh organisasi", ...q("select name from public.org_units where is_active and type in ('bph','department','bureau') order by name").split("\n")];
      expect([...options].sort()).toEqual([...want].sort());
      expect(options).not.toContain("PMK ITERA"); // the root is shown as "Seluruh organisasi"
      const divisions = q("select name from public.org_units where type = 'division'").split("\n");
      for (const d of divisions) expect(options, `division ${d} is not offered`).not.toContain(d);
    } finally {
      await sekdep.context.close();
      await sekjen.context.close();
    }
  });
});

test.describe("MN-01..MN-07, MN-12: the database functions, called directly with each persona's own token", () => {
  test("reads: list, detail and the Dashboard counts stay inside the scope; outsiders get nothing", async () => {
    const ids = await setup();
    for (const [persona, , want] of MATRIX) {
      const list = await listAs(persona, { p_search: TAG });
      if (want.view === "none") {
        expect(list.ok, `${persona} list`).toBe(false);
        expect((await detailAs(persona, ids.bph)).ok, `${persona} detail`).toBe(false);
        expect((await rpcAs(persona, "minute_dashboard_counts")).ok, `${persona} counts`).toBe(false);
        continue;
      }
      expect(list.ok, `${persona} list`).toBe(true);
      const got = (list.body as { minute_id: string }[]).map((r) => r.minute_id).sort();
      expect(got, `${persona}: exactly the minutes of the scope`).toEqual(unitsOf(want).map((k) => ids[k]).sort());
      // A unit filter outside the scope returns nothing, never an error (M7, R13).
      if (want.view === "own") {
        const outside = await listAs(persona, { p_unit_id: unitId(UNITS.eksternal) });
        expect(outside.ok).toBe(true);
        expect(outside.body).toEqual([]);
        const denied = await detailAs(persona, ids.eksternal);
        expect(denied.ok).toBe(false);
        expect(denied.hint).toBe("minute_not_found"); // "not found", not "forbidden": nothing leaks
      }
      const detail = await detailAs(persona, unitsOf(want).includes("bph") ? ids.bph : ids[want.own!]);
      expect(detail.ok, `${persona} detail`).toBe(true);
      expect(detail.body.actions.can_edit, `${persona} can_edit`).toBe(want.manage !== "none");
      expect(detail.body.actions.can_export, `${persona} can_export`).toBe(want.exportKey !== "none");
      expect(JSON.stringify(detail.body), "no email in a detail").not.toMatch(/@nexus\.test/);
    }
    for (const who of ["inactive", "unlinked", "anon"] as const) {
      expect((await listAs(who)).ok, who).toBe(false);
      expect((await detailAs(who, ids.bph)).ok, who).toBe(false);
    }
  });

  test("writes: record only in the manage scope; outsiders, readers and heads are refused with nothing written", async () => {
    await setup();
    const before = Number(q("select count(*) from nexus.minutes"));
    // Readers, heads and no-key members cannot record anywhere.
    for (const who of [...ALL_READERS, ...HEADS, ...NO_KEY, "inactive", "unlinked", "anon"] as const) {
      const r = await recordAs(who, { unit: unitId(UNITS.bph), title: `${TAG} ditolak ${who}` });
      expect(r.ok, who).toBe(false);
    }
    // MN-02: the department secretary records for her unit only; another unit's id is refused by the database.
    const other = await recordAs("sekdep", { unit: unitId(UNITS.eksternal), title: `${TAG} ditolak unit lain` });
    expect(other.ok).toBe(false);
    expect(other.hint).toBe("unit_not_allowed");
    const root = await recordAs("sekdep", { unit: ROOT_UNIT(), title: `${TAG} ditolak root` });
    expect(root.hint).toBe("unit_not_allowed");
    // N2 c: a division is never a minute's unit, even for the BPH secretary.
    const division = await recordAs("sekjen", { unit: q("select id from public.org_units where type = 'division' and is_active limit 1"), title: `${TAG} ditolak divisi` });
    expect(division.ok).toBe(false);
    expect(division.hint).toBe("invalid_unit");
    expect(Number(q("select count(*) from nexus.minutes")), "nothing was written").toBe(before);
    // Allowed: sekdep in her unit, both BPH secretaries in any recordable unit.
    const own = await mustRecord("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} sekdep sendiri` });
    expect(minuteRow(own.id).org_unit_id).toBe(unitId(UNITS.internal));
    expect(minuteRow(own.id).created_by).toBe(q("select id from public.members where email = 'sekdep@nexus.test'"));
    for (const who of ALL_MANAGERS) await mustRecord(who, { unit: unitId(UNITS.eksternal), title: `${TAG} ${who} eksternal` });
  });

  test("edit, void and files: only the manager of that unit; a reader of the unit is refused; the unit and the creator never change", async () => {
    const ids = await setup();
    const today = jakartaToday();
    const body = { date: today, title: `${TAG} internal diubah`, topic: "Topik baru", content: "Isi baru" };
    // A reader (BPH, head) or another unit's secretary cannot change it.
    for (const who of ["ketum", "bendahara", "kadep", "regular"] as const) {
      const r = await updateAs(who, ids.internal, minuteVersion(ids.internal), body);
      expect(r.ok, `${who} update`).toBe(false);
      expect((await voidAs(who, ids.internal)).ok, `${who} void`).toBe(false);
      expect((await addFilesAs(who, ids.internal, [fakeFile("sekjen", "x.pdf")])).ok, `${who} add files`).toBe(false);
    }
    const sekdepOther = await updateAs("sekdep", ids.eksternal, minuteVersion(ids.eksternal), { ...body, title: `${TAG} eksternal diubah` });
    expect(sekdepOther.ok).toBe(false);
    expect(minuteRow(ids.eksternal).title).toBe(`${TAG} eksternal`);
    expect(minuteRow(ids.internal).title).toBe(`${TAG} internal`);
    // The secretary of the unit can, and the unit and creator stay (MN-11).
    const ok = await updateAs("sekdep", ids.internal, minuteVersion(ids.internal), body);
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    const after = minuteRow(ids.internal);
    expect(after.title).toBe(`${TAG} internal diubah`);
    expect(after.org_unit_id).toBe(unitId(UNITS.internal));
    expect(after.created_by).toBe(q("select id from public.members where email = 'sekjen@nexus.test'"));
    expect(after.updated_by).toBe(q("select id from public.members where email = 'sekdep@nexus.test'"));
    // A file added by the unit's secretary must be in her OWN folder: a path in someone else's folder is refused.
    const foreign = await addFilesAs("sekdep", ids.internal, [fakeFile("sekjen", "bukan-miliknya.pdf")]);
    expect(foreign.ok).toBe(false);
    expect(foreign.hint).toBe("invalid_file");
  });

  test("MN-05: with rule D37 switched off, a Kepala Departemen reads nothing, at once and without logging out", async ({ browser }) => {
    const ids = await setup();
    const { context, page } = await signedInContext(browser, "kadep");
    try {
      await page.goto(minuteUrl(ids.ops));
      await expect(page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      q("update nexus.access_rules set is_enabled = false where default_code = 'D37'");
      try {
        await page.goto(PATHS.list);
        await expectForbiddenScreen(page);
        await page.goto(minuteUrl(ids.ops));
        await expectForbiddenScreen(page);
        expect((await listAs("kadep")).ok).toBe(false);
        expect((await detailAs("kadep", ids.ops)).ok).toBe(false);
        // The secretaries are not affected.
        expect((await detailAs("sekjen", ids.ops)).ok).toBe(true);
      } finally {
        q("update nexus.access_rules set is_enabled = true where default_code = 'D37'");
      }
      await page.goto(minuteUrl(ids.ops));
      await expect(page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("MN-07: two Sekretaris Departemen assignments give both units and no other (AC-21); MN-08: moved away = the old unit is gone on the next request", async () => {
    const ids = await setup();
    const sekdep = q("select id from public.members where email = 'sekdep@nexus.test'");
    const position = q("select id from public.positions where name = 'Sekretaris Departemen'");
    const period = q("select id from public.periods where is_active");
    const extra = q(
      `insert into public.assignments(member_id, org_unit_id, position_id, period_id)
       values ('${sekdep}', '${unitId(UNITS.eksternal)}', '${position}', '${period}') returning id`,
    ).split("\n")[0];
    try {
      const both = (await listAs("sekdep", { p_search: TAG })).body as { minute_id: string }[];
      expect(both.map((r) => r.minute_id)).toEqual(expect.arrayContaining([ids.internal, ids.eksternal]));
      expect(both.map((r) => r.minute_id)).not.toContain(ids.ops);
      const second = await recordAs("sekdep", { unit: unitId(UNITS.eksternal), title: `${TAG} sekdep unit kedua` });
      expect(second.ok, JSON.stringify(second.body)).toBe(true);
      expect((await recordAs("sekdep", { unit: unitId(UNITS.ops), title: `${TAG} ditolak unit ketiga` })).hint).toBe("unit_not_allowed");
      const options = (await rpcAs("sekdep", "minute_unit_options")).body as { unit_id: string; can_record: boolean }[];
      expect(options.filter((o) => o.can_record).map((o) => o.unit_id).sort()).toEqual([unitId(UNITS.internal), unitId(UNITS.eksternal)].sort());
    } finally {
      q(`delete from public.assignments where id = '${extra}'`);
    }
    // MN-08: the extra assignment is gone: the next request no longer returns that unit.
    const after = (await listAs("sekdep", { p_search: TAG })).body as { minute_id: string }[];
    expect(after.map((r) => r.minute_id)).not.toContain(ids.eksternal);
    expect((await detailAs("sekdep", ids.eksternal)).hint).toBe("minute_not_found");
  });
});

test.describe("MN-15, MN-30: the tables themselves (REST): reads follow RLS, writes change nothing, nothing can be deleted", () => {
  const TABLES = ["minutes", "minute_files", "minute_history", "minute_export_logs"];

  test("no direct insert, update or delete for anyone, including the managers and the System Admin", async () => {
    const ids = await setup();
    const before = minuteRow(ids.bph);
    for (const who of ["sekjen", "sekdep", "admin", "ketum"] as const) {
      const patch = await tableAs(who, "PATCH", `minutes?id=eq.${ids.bph}`, { title: "diubah lewat REST" });
      expect(patch.ok && Array.isArray(patch.body) && patch.body.length > 0, `${who} PATCH`).toBe(false);
      const del = await tableAs(who, "DELETE", `minutes?id=eq.${ids.bph}`);
      expect(del.ok && Array.isArray(del.body) && del.body.length > 0, `${who} DELETE`).toBe(false);
      const post = await tableAs(who, "POST", "minutes", { org_unit_id: unitId(UNITS.bph), title: "x" });
      expect(post.ok, `${who} POST`).toBe(false);
      for (const t of ["minute_files", "minute_history", "minute_export_logs"]) {
        const d = await tableAs(who, "DELETE", `${t}?minute_id=eq.${ids.bph}`);
        expect(d.ok && Array.isArray(d.body) && d.body.length > 0, `${who} DELETE ${t}`).toBe(false);
      }
    }
    expect(minuteRow(ids.bph)).toEqual(before);
    // The catalog: RLS on every table, a no-delete trigger, and no write grant to the client roles.
    for (const t of TABLES) {
      expect(q(`select relrowsecurity from pg_class where oid = 'nexus.${t}'::regclass`), `${t} RLS`).toBe("t");
      const grants = q(
        `select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
         where table_schema = 'nexus' and table_name = '${t}' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      );
      expect(grants, `${t}: no write grant`).toBe("");
    }
    expect(Number(q("select count(*) from pg_trigger where tgrelid = 'nexus.minutes'::regclass and not tgisinternal")), "guard triggers").toBeGreaterThan(0);
  });

  test("reading the tables directly: a member without the key sees no row; a department secretary sees her unit only; nobody reads the export log", async () => {
    const ids = await setup();
    for (const who of ["regular", "admin", "pembina", "anon"] as const) {
      for (const t of ["minutes", "minute_files", "minute_history"]) {
        const r = await tableAs(who, "GET", `${t}?select=*&limit=5`);
        expect(r.ok && Array.isArray(r.body) && r.body.length > 0, `${who} reads ${t}`).toBe(false);
      }
    }
    const sekdep = await tableAs("sekdep", "GET", `minutes?select=id,org_unit_id&title=like.${TAG}*`);
    if (sekdep.ok) {
      for (const r of sekdep.body as { org_unit_id: string }[]) expect(r.org_unit_id).toBe(unitId(UNITS.internal));
      expect((sekdep.body as { id: string }[]).map((r) => r.id)).not.toContain(ids.eksternal);
    }
    for (const who of ["sekjen", "ketum", "sekdep", "admin"] as const) {
      const logs = await tableAs(who, "GET", "minute_export_logs?select=id&limit=1");
      expect(logs.ok && Array.isArray(logs.body) && logs.body.length > 0, `${who} reads the export log`).toBe(false);
    }
  });
});

test.describe("MN-17, MN-18, MN-25: the route handlers and Server Actions, called directly", () => {
  test("upload route: no key = 403, cross-site = 403, GET = 405, anonymous refused; a manager passes the checks up to Storage", async ({ browser }) => {
    for (const persona of ["ketum", "kadep", "regular"] as const) {
      const c = await signedInContext(browser, persona);
      try {
        const res = await c.context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() } }, headers: { origin: ORIGIN } });
        expect(res.status(), `${persona} upload`).toBe(403);
      } finally {
        await c.context.close();
      }
    }
    const sekdep = await signedInContext(browser, "sekdep");
    try {
      const evil = await sekdep.context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() } }, headers: { origin: "https://evil.example" } });
      expect(evil.status(), "cross-site").toBe(403);
      expect((await sekdep.context.request.get(UPLOAD)).status(), "GET").toBe(405);
      // A file that lies about its type is refused before Storage (magic bytes, MN-17).
      const fake = await sekdep.context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") } }, headers: { origin: ORIGIN } });
      expect(fake.status()).toBe(400);
      expect((await fake.json()).error.code).toBe("invalid_file");
      const exe = await sekdep.context.request.post(UPLOAD, { multipart: { file: { name: "a.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") } }, headers: { origin: ORIGIN } });
      expect(exe.status()).toBe(400);
      const big = await sekdep.context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_BYTES(5 * 1024 * 1024 + 10) } }, headers: { origin: ORIGIN } });
      expect(big.status(), "over 5 MB").toBe(413);
      // A real PDF reaches Storage, which is off locally (503) or stores it in her own folder (200).
      const good = await sekdep.context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() } }, headers: { origin: ORIGIN } });
      if (good.status() === 200) expect((await good.json()).path.split("/")[0]).toBe(q("select id from public.members where email = 'sekdep@nexus.test'"));
      else expect(good.status()).toBe(503);
    } finally {
      await sekdep.context.close();
    }
    const anon = await fetch(`${ORIGIN}${UPLOAD}`, { method: "POST", headers: { origin: ORIGIN } });
    expect([401, 403]).toContain(anon.status);
  });

  test("export route: no key, a head, cross-site, no origin and GET are refused and write no log row", async ({ browser }) => {
    const logs = exportLogCount();
    const body = { kind: "list", format: "csv", filters: {} };
    for (const persona of ["regular", "admin", "kadep", "kabiro"] as const) {
      const c = await signedInContext(browser, persona);
      try {
        const res = await c.context.request.post(EXPORT, { data: body, headers: { origin: ORIGIN } });
        expect(res.status(), `${persona} export`).toBe(403);
      } finally {
        await c.context.close();
      }
    }
    const sekjen = await signedInContext(browser, "sekjen");
    try {
      expect((await sekjen.context.request.post(EXPORT, { data: body, headers: { origin: "https://evil.example" } })).status(), "cross-site").toBe(403);
      expect((await sekjen.context.request.post(EXPORT, { data: body })).status(), "no origin").toBe(403);
      expect((await sekjen.context.request.get(EXPORT)).status(), "GET").toBe(405);
    } finally {
      await sekjen.context.close();
    }
    const anon = await fetch(`${ORIGIN}${EXPORT}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
    expect([401, 403]).toContain(anon.status);
    expect(exportLogCount()).toBe(logs);
  });

  test("Server Actions: a reader, a head, a member without the key and another unit's secretary are refused; nothing changes", async ({ browser }) => {
    const ids = await setup();
    const before = minuteRow(ids.bph);
    const count = Number(q("select count(*) from nexus.minutes"));
    for (const persona of ["ketum", "kadep", "regular", "admin", "sekdep"] as const) {
      const c = await signedInContext(browser, persona);
      try {
        const rec = await callAction(c.context, "recordMinute", [{ unitId: unitId(UNITS.bph), meetingDate: jakartaToday(), title: `${TAG} aksi ${persona}`, topic: "t", content: "c", decision: "", files: [] }]);
        expect(rec, `${persona} recordMinute`).not.toMatch(/"ok":true/);
        const upd = await callAction(c.context, "updateMinute", [{ minuteId: ids.bph, version: minuteVersion(ids.bph), meetingDate: jakartaToday(), title: "dibajak", topic: "t", content: "c", decision: "" }]);
        expect(upd, `${persona} updateMinute`).not.toMatch(/"ok":true/);
        const vd = await callAction(c.context, "voidMinute", [{ minuteId: ids.bph, version: minuteVersion(ids.bph), reason: "dibajak" }]);
        expect(vd, `${persona} voidMinute`).not.toMatch(/"ok":true/);
      } finally {
        await c.context.close();
      }
    }
    expect(minuteRow(ids.bph)).toEqual(before);
    expect(Number(q("select count(*) from nexus.minutes"))).toBe(count);
    expect(Number(q(`select count(*) from nexus.minutes where title like '${TAG} aksi%'`))).toBe(0);
  });

  test("a direct export call: no-key personas and heads are refused by the database before any log row", async () => {
    await setup();
    const logs = exportLogCount();
    for (const who of ["regular", "pembina", "admin", "kadep", "kabiro", "kadivLogistik", "inactive", "unlinked", "anon"] as const) {
      const r = await rpcAs(who, "minute_export", { p_format: "csv" });
      expect(r.ok, who).toBe(false);
    }
    expect(exportLogCount()).toBe(logs);
  });
});

test.describe("MN-24: the author is deactivated", () => {
  test("their minutes stay, their name still shows, another manager of the unit can edit and void them", async ({ browser }) => {
    await setup();
    const own = await mustRecord("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} penulis nonaktif` });
    const name = q("select full_name from public.members where email = 'sekdep@nexus.test'");
    q("update public.members set is_active = false where email = 'sekdep@nexus.test'");
    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      await page.goto(minuteUrl(own.id));
      await expect(page.getByText(new RegExp(`^Dicatat oleh ${name}, `))).toBeVisible();
      // The deactivated author can do nothing now (L1).
      expect((await listAs("sekdep")).ok).toBe(false);
      // The BPH secretary edits and voids it.
      const v = minuteVersion(own.id);
      const up = await updateAs("sekjen", own.id, v, { date: jakartaToday(), title: `${TAG} penulis nonaktif`, topic: "Topik uji", content: "Isi diperbaiki" });
      expect(up.ok, JSON.stringify(up.body)).toBe(true);
      expect((await voidAs("sekjen", own.id, "Penulis sudah tidak aktif")).ok).toBe(true);
      expect(minuteRow(own.id).created_by).toBe(q("select id from public.members where email = 'sekdep@nexus.test'"));
    } finally {
      q("update public.members set is_active = true where email = 'sekdep@nexus.test'");
      await context.close();
    }
    expect((await listAs("sekdep")).ok, "back on the next request").toBe(true);
  });
});
