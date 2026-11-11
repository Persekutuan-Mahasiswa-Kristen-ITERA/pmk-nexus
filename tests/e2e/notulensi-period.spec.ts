// Meeting Minutes and the change of the active period (spec F7, R2..R4, R6; MN-10, MN-12, MN-23; access control L7, L8, R3, R11).
// Pattern of finance-period.spec.ts and surat-period.spec.ts: sessions stay open (no logout), the period and the temporary
// assignment are restored in `finally` and afterAll; global-setup.ts repairs them if a run died.
//
// Minutes recorded in the 2025/2026 interlude stay there (that period is closed again and nothing is deleted); they all start
// with "QA<tag>" and every count is read from the tables at test time.
import { expect, test } from "@playwright/test";
import { setActivePeriod, signedInContext } from "./helpers";
import {
  activeCount,
  addFilesAs,
  awayFromMidnight,
  card,
  detailAs,
  drawerItems,
  emailOf,
  EXPORT,
  expectForbiddenScreen,
  fakeFile,
  jakartaToday,
  listAs,
  main,
  memberId,
  minuteCount,
  minuteRow,
  minuteUrl,
  MINUTES_ITEM,
  minuteVersion,
  mustRecord,
  noHorizontalScroll,
  ORIGIN,
  PATHS,
  q,
  recordAs,
  rpcAs,
  sweepQa,
  tag,
  tiles,
  UNITS,
  unitId,
  updateAs,
  voidAs,
  fillTitle,
  fillTopic,
  fillContent,
  saveRecord,
  idFromUrl,
} from "./notulensi-helpers";

const TAG = tag();
const ACTIVE = "2026/2027";
const OLD = "2025/2026";
const periodId = (label: string) => q(`select id from public.periods where label = '${label}'`);
const dropTemporarySecretary = () =>
  q(
    `delete from public.assignments where member_id = (select id from public.members where email = '${emailOf("regular")}')
     and position_id = (select id from public.positions where name = 'Sekretaris Departemen')`,
  );

test.afterAll(async () => {
  setActivePeriod(ACTIVE);
  dropTemporarySecretary();
  await sweepQa(TAG);
});

const OLD_NOTE = "Notulensi periode lama hanya bisa dibaca.";

test.describe("F7, MN-12, MN-23: a new period moves the access by itself; old minutes stay readable and read-only", () => {
  test("2026/2027 -> 2025/2026 -> back, with sessions kept open", async ({ browser }) => {
    test.setTimeout(480_000);
    await awayFromMidnight();
    const periodNew = periodId(ACTIVE);
    const periodOld = periodId(OLD);
    const internal = unitId(UNITS.internal);

    // Minutes of the CURRENT period (2026/2027), before the switch.
    const cur = await mustRecord("sekdep", { unit: internal, title: `${TAG} internal periode sekarang` });
    const curBph = await mustRecord("sekjen", { unit: unitId(UNITS.bph), title: `${TAG} bph periode sekarang` });
    expect(minuteRow(cur.id).period_id).toBe(periodNew);

    const sekdep = await signedInContext(browser, "sekdep"); // Sekretaris Departemen Internal, 2026/2027 only (P-OLD after the switch)
    const sekjen = await signedInContext(browser, "sekjen"); // Sekretaris Jenderal, 2026/2027 only
    const prev = await signedInContext(browser, "regular"); // = Sekretaris Departemen Internal of 2025/2026 ONLY (temporary)
    let interlude = "";
    try {
      await prev.page.goto(PATHS.list);
      await expectForbiddenScreen(prev.page);

      q(
        `insert into public.assignments(member_id, org_unit_id, position_id, period_id)
         values ((select id from public.members where email = '${emailOf("regular")}'), '${internal}',
                 (select id from public.positions where name = 'Sekretaris Departemen'), '${periodOld}')`,
      );

      // ---- Switch: 2025/2026 becomes the active period
      setActivePeriod(OLD);

      // The 2026/2027 officers have no assignment in the active period: no access on the next request (AC-40), no logout.
      for (const [who, c] of [["sekdep", sekdep], ["sekjen", sekjen]] as const) {
        await c.page.goto(PATHS.list);
        await expectForbiddenScreen(c.page);
        await c.page.goto(minuteUrl(cur.id));
        await expectForbiddenScreen(c.page);
        await c.page.goto("/");
        await expect(c.page.getByRole("heading", { level: 1, name: /^Shalom, / })).toBeVisible();
        expect(await drawerItems(c.page), `${who} drawer`).not.toContain(MINUTES_ITEM);
        await expect(card(c.page), `${who} card`).toHaveCount(0);
        expect((await listAs(who)).ok, `${who} list`).toBe(false);
        expect((await detailAs(who, cur.id)).ok, `${who} detail`).toBe(false);
        const exp = await c.context.request.post(EXPORT, { data: { kind: "list", format: "csv", filters: {} }, headers: { origin: ORIGIN } });
        expect(exp.status(), `${who} export`).toBe(403);
      }

      // MN-23: the NEW Sekretaris Departemen of the same unit reads that unit's earlier minutes (scope = unit, not period).
      await prev.page.goto(PATHS.list);
      await expect(prev.page.getByRole("heading", { level: 1, name: MINUTES_ITEM })).toBeVisible();
      await expect(prev.page.getByText(`Periode ${OLD}`).first()).toBeVisible();
      // Default view: the active period only; the earlier minute is behind "Semua periode" (F7.3).
      await prev.page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}`);
      await expect(main(prev.page).locator("article", { hasText: `${TAG} internal periode sekarang` })).toHaveCount(0);
      await prev.page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}&period=all`);
      await expect(main(prev.page).locator("article", { hasText: `${TAG} internal periode sekarang` })).toBeVisible();
      await expect(main(prev.page).locator("article", { hasText: `${TAG} bph periode sekarang` }), "another unit stays hidden").toHaveCount(0);
      expect(await noHorizontalScroll(prev.page)).toBe(true);

      // MN-12, L7: the earlier minute is read-only for everyone, the new manager included.
      await prev.page.goto(minuteUrl(cur.id));
      await expect(prev.page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      await expect(prev.page.getByText(OLD_NOTE)).toBeVisible();
      for (const name of ["Batalkan notulensi", "Tambah lampiran"]) await expect(prev.page.getByRole("button", { name })).toHaveCount(0);
      await expect(prev.page.getByRole("link", { name: "Ubah", exact: true })).toHaveCount(0);
      await prev.page.goto(`/notulensi/${cur.id}/ubah`);
      await expect(prev.page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toHaveCount(0);
      for (const [label, r] of [
        ["update", await updateAs("regular", cur.id, minuteVersion(cur.id), { date: jakartaToday(), title: `${TAG} diubah`, topic: "t", content: "c" })],
        ["void", await voidAs("regular", cur.id, "coba")],
        ["add files", await addFilesAs("regular", cur.id, [fakeFile("regular", "x.pdf")])],
      ] as const) {
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe("closed_period");
      }
      expect(minuteRow(cur.id).status).toBe("active");
      expect(minuteRow(cur.id).title).toBe(`${TAG} internal periode sekarang`);

      // R2: a minute recorded now belongs to the ACTIVE period (2025/2026), whatever its meeting date.
      await prev.page.goto(PATHS.record);
      await expect(prev.page.getByRole("heading", { level: 1, name: "Catat Notulensi" })).toBeVisible();
      await expect(prev.page.getByText("Sesuai jabatanmu.")).toBeVisible();
      // R9: today is outside the dates of 2025/2026: a soft warning, never a block.
      await expect(prev.page.getByText(`Tanggal ini di luar masa periode ${OLD}. Notulensi tetap bisa disimpan.`)).toBeVisible();
      await fillTitle(prev.page, `${TAG} rapat masa peralihan`);
      await fillTopic(prev.page, "Serah terima");
      await fillContent(prev.page, "Isi rapat peralihan");
      await saveRecord(prev.page);
      await expect(prev.page).toHaveURL(/\?notice=recorded/);
      interlude = idFromUrl(prev.page);
      expect(minuteRow(interlude).period_id).toBe(periodOld);
      expect(minuteRow(interlude).created_by).toBe(memberId(emailOf("regular")));

      // Tiles and the Dashboard card count the active period inside the scope (A-MN13).
      const want = activeCount([internal]);
      await prev.page.goto(PATHS.list);
      await expect(tiles(prev.page)).toContainText(String(want.count));
      await prev.page.goto("/");
      await expect(card(prev.page)).toContainText(`${want.count} notulensi di periode ${OLD}`);

      // Export of "Semua periode" holds both periods, each row with its own period.
      const all = await prev.context.request.post(EXPORT, { data: { kind: "list", format: "csv", filters: { search: TAG, period: "all" } }, headers: { origin: ORIGIN } });
      expect(all.status()).toBe(200);
      const csv = await all.text();
      expect(csv).toContain(`${TAG} internal periode sekarang`);
      expect(csv).toContain(`${TAG} rapat masa peralihan`);
      expect(csv).toContain(`,${ACTIVE},`);
      expect(csv).toContain(`,${OLD},`);
      expect(csv).not.toContain(`${TAG} bph periode sekarang`);

      // ---- Back to 2026/2027
      setActivePeriod(ACTIVE);

      // The 2025/2026 secretary has no access any more; the 2026/2027 officers are back, without logging in.
      await prev.page.goto(PATHS.list);
      await expectForbiddenScreen(prev.page);
      expect((await listAs("regular")).ok).toBe(false);
      await sekdep.page.goto(PATHS.list);
      await expect(sekdep.page.getByRole("link", { name: "Catat notulensi" })).toBeVisible();
      // The interlude minute is history: readable by the unit's current secretary and BPH, read-only.
      await sekdep.page.goto(minuteUrl(interlude));
      await expect(sekdep.page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      await expect(sekdep.page.getByText(OLD_NOTE)).toBeVisible();
      await expect(sekdep.page.getByRole("link", { name: "Ubah", exact: true })).toHaveCount(0);
      expect((await voidAs("sekdep", interlude, "coba")).hint).toBe("closed_period");
      expect((await voidAs("sekjen", interlude, "coba")).hint, "even the BPH secretary").toBe("closed_period");
      await sekjen.page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}&period=all`);
      await expect(main(sekjen.page).locator("article", { hasText: `${TAG} rapat masa peralihan` })).toBeVisible();
      // The 2026/2027 minute is writable again for its unit's secretary.
      expect((await updateAs("sekdep", cur.id, minuteVersion(cur.id), { date: jakartaToday(), title: `${TAG} internal periode sekarang`, topic: "t", content: "kembali bisa diubah" })).ok).toBe(true);
      expect(minuteRow(curBph.id).status).toBe("active");
    } finally {
      setActivePeriod(ACTIVE);
      dropTemporarySecretary();
      for (const c of [sekdep, sekjen, prev]) await c.context.close();
    }
    // Nothing was deleted; every minute keeps its period.
    expect(minuteRow(cur.id).period_id).toBe(periodNew);
    expect(minuteRow(interlude).period_id).toBe(periodOld);
    expect(q("select count(*) from public.periods where is_active")).toBe("1");
  });
});

test.describe("MN-10, R4, R11: no active period", () => {
  test("recording is refused, officers read nothing, the minutes are untouched; the period back, the same sessions work", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const own = await mustRecord("sekjen", { unit: unitId(UNITS.bph), title: `${TAG} sebelum periode hilang` });
    const sekjen = await signedInContext(browser, "sekjen");
    const ketum = await signedInContext(browser, "ketum");
    try {
      const before = minuteCount();
      setActivePeriod(null);
      for (const [who, c] of [["sekjen", sekjen], ["ketum", ketum]] as const) {
        await c.page.goto(PATHS.list);
        await expectForbiddenScreen(c.page);
        await expect(c.page.getByText("Belum ada periode aktif.")).toBeVisible();
        await c.page.goto(minuteUrl(own.id));
        await expectForbiddenScreen(c.page);
        await c.page.goto("/");
        await expect(card(c.page), `${who}: no card`).toHaveCount(0);
        expect((await listAs(who)).ok, `${who} list`).toBe(false);
        expect((await rpcAs(who, "minute_dashboard_counts")).ok, `${who} counts`).toBe(false);
        expect((await rpcAs(who, "minute_export", { p_format: "csv" })).ok, `${who} export`).toBe(false);
      }
      await sekjen.page.goto(PATHS.record);
      await expectForbiddenScreen(sekjen.page);
      expect((await recordAs("sekjen", { unit: unitId(UNITS.bph), title: `${TAG} tanpa periode` })).ok).toBe(false);
      expect((await voidAs("sekjen", own.id)).ok).toBe(false);
      expect(minuteCount(), "nothing written").toBe(before);
      expect(minuteRow(own.id).status).toBe("active");

      setActivePeriod(ACTIVE);
      await sekjen.page.goto(PATHS.list);
      await expect(sekjen.page.getByRole("link", { name: "Catat notulensi" })).toBeVisible();
      await ketum.page.goto(minuteUrl(own.id));
      await expect(ketum.page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      expect((await voidAs("sekjen", own.id, "QA selesai")).ok).toBe(true);
    } finally {
      setActivePeriod(ACTIVE);
      for (const c of [sekjen, ketum]) await c.context.close();
    }
    expect(q("select count(*) from public.periods where is_active")).toBe("1");
  });
});
