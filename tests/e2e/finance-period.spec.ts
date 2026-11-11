// Finance and the change of the active period (spec F5, F8, R3..R6, R11; FN-22, FN-33, FN-40; access control L7, L8, R3).
// Pattern of surat-period.spec.ts: sessions stay open the whole time (no logout), the period and the temporary assignment are
// always restored in `finally` / afterAll.
//
// The ledger is append-only: what the test records in the 2025/2026 interlude can never be voided afterwards (that period is closed
// again). It stays behind as Aktif entries of 2025/2026 whose Keterangan starts with "QA<tag>". Every expectation about totals is
// therefore read from the tables at test time, never assumed.
import { expect, test } from "@playwright/test";
import { setActivePeriod, signedInContext } from "./helpers";
import {
  activePeriodId,
  addProofAs,
  awayFromMidnight,
  card,
  clickNext,
  clickSave,
  dialog,
  drawerItems,
  emailOf,
  entryCount,
  entryRow,
  entryUrl,
  EXPORT,
  expectForbiddenScreen,
  fakeProof,
  fillAmount,
  fillDescription,
  FINANCE_ITEM,
  main,
  memberId,
  mustRecord,
  noHorizontalScroll,
  ORIGIN,
  PATHS,
  q,
  qjson,
  recordAs,
  rpcAs,
  rupiah,
  sweepQa,
  tag,
  totals,
  voidAs,
} from "./finance-helpers";

const TAG = tag();
const ACTIVE = "2026/2027";
const OLD = "2025/2026";

const periodId = (label: string) => q(`select id from public.periods where label = '${label}'`);
const dropTemporaryTreasurer = () =>
  q(
    `delete from public.assignments where member_id = (select id from public.members where email = '${emailOf("regular")}')
     and period_id = (select id from public.periods where label = '${OLD}')`,
  );

test.afterAll(async () => {
  setActivePeriod(ACTIVE);
  dropTemporaryTreasurer();
  await sweepQa(TAG);
});

const tiles = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Ringkasan keuangan periode" });
const oldBanner = (label: string) => `Periode ${label} sudah selesai. Datanya hanya bisa dibaca.`;
const OLD_NOTE = "Transaksi periode lama tidak bisa dibatalkan. Catat koreksi di periode aktif.";
const exportLogMaxId = () => Number(q("select coalesce(max(id), 0) from nexus.finance_export_logs"));

test.describe("F8, R3, R6, L7, L8: a new period moves the access by itself, old entries stay as read-only history", () => {
  test("2026/2027 -> 2025/2026 -> back, with sessions kept open; a correction goes into the active period and links to the old entry", async ({ browser }) => {
    test.setTimeout(480_000);
    await awayFromMidnight();
    const periodNew = periodId(ACTIVE);
    const periodOld = periodId(OLD);
    expect(activePeriodId()).toBe(periodNew);

    // Data of the CURRENT period (2026/2027), before the switch.
    const cur = await mustRecord("bendahara", { description: `${TAG} periode sekarang`, amount: "41000" });
    expect(entryRow(cur.id).period_id).toBe(periodNew);

    const bend = await signedInContext(browser, "bendahara"); // Treasurer of 2026/2027
    const reader = await signedInContext(browser, "ketum"); // BPH, 2026/2027
    const prev = await signedInContext(browser, "regular"); // = Bendahara Umum 1 of 2025/2026 ONLY (temporary assignment)
    const outsider = await signedInContext(browser, "sekdep"); // no Finance key in either period
    let oldIncomeId = "";
    let oldIncomeNo = "";
    let oldExpenseId = "";
    let oldVoidedId = "";
    let oldVoidedNo = "";
    try {
      // Before the switch nobody sees Finance but the 2026/2027 holders.
      await prev.page.goto(PATHS.list);
      await expectForbiddenScreen(prev.page);
      await bend.page.goto(PATHS.list);
      await expect(bend.page.getByRole("link", { name: "Catat transaksi" })).toBeVisible();

      const assignmentId = q(
        `insert into public.assignments(member_id, org_unit_id, position_id, period_id)
         select (select id from public.members where email = '${emailOf("regular")}'),
                (select id from public.org_units where name = 'BPH PMK ITERA'),
                (select id from public.positions where name = 'Bendahara Umum 1'),
                (select id from public.periods where label = '${OLD}')
         returning id`,
      ).split("\n")[0];
      expect(assignmentId).toBeTruthy();

      // ---- Switch: 2025/2026 becomes the active period
      setActivePeriod(OLD);

      // The 2026/2027 holders lose Finance on the next request, no logout: pages, Dashboard card, drawer item, functions, export route.
      for (const [who, c] of [["bendahara", bend], ["ketum", reader]] as const) {
        await c.page.goto(PATHS.list);
        await expectForbiddenScreen(c.page);
        await c.page.goto(PATHS.record);
        await expectForbiddenScreen(c.page);
        await c.page.goto("/");
        await expect(c.page.getByRole("heading", { level: 1, name: /^Shalom, / })).toBeVisible();
        expect(await drawerItems(c.page), `${who}: the drawer item follows the period`).not.toContain(FINANCE_ITEM);
        await expect(card(c.page), `${who}: no Dashboard card`).toHaveCount(0);
        const list = await rpcAs(who, "finance_entry_list", {});
        expect(list.ok, `${who} list`).toBe(false);
        const exp = await c.context.request.post(EXPORT, { data: { format: "csv", filters: {} }, headers: { origin: ORIGIN } });
        expect(exp.status(), `${who} export`).toBe(403);
      }
      const refused = await recordAs("bendahara", { description: `${TAG} ditolak periode lama`, amount: "1000" });
      expect(refused.ok).toBe(false);
      expect(qjson(`select id from nexus.finance_entries where description = '${TAG} ditolak periode lama'`)).toHaveLength(0);
      expect((await voidAs("bendahara", cur.id)).ok, "the old Treasurer cannot void either").toBe(false);
      expect(entryRow(cur.id).status).toBe("active");

      // The Treasurer of 2025/2026 gains the rights without logging in again (P-OLD, inverse).
      await prev.page.goto(PATHS.list);
      await expect(prev.page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
      await expect(prev.page.getByText(`Periode ${OLD}`).first()).toBeVisible();
      await expect(prev.page.getByRole("link", { name: "Catat transaksi" })).toBeVisible();
      expect(await drawerItems((await prev.page.goto("/"), prev.page))).toContain(FINANCE_ITEM);

      // R5: today is outside the dates of 2025/2026: a soft warning in the check sheet, never a block. R3: the period is the active one.
      await prev.page.goto(PATHS.record);
      await expect(prev.page.getByRole("heading", { level: 1, name: "Catat Transaksi" })).toBeVisible();
      await prev.page.getByRole("radiogroup", { name: "Jenis transaksi" }).getByText("Pemasukan", { exact: true }).click();
      await fillAmount(prev.page, "300000");
      await fillDescription(prev.page, `${TAG} iuran periode lama`);
      await clickNext(prev.page);
      await expect(dialog(prev.page).getByRole("heading", { name: "Cek dulu" })).toBeVisible();
      await expect(dialog(prev.page).getByText(`Tanggal ini di luar masa periode ${OLD}. Tetap simpan?`)).toBeVisible();
      await clickSave(prev.page);
      await expect(prev.page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      oldIncomeId = /\/finance\/([0-9a-f-]{36})/.exec(prev.page.url())![1];
      oldIncomeNo = String(entryRow(oldIncomeId).number_text);
      expect(entryRow(oldIncomeId).period_id, "the period of a new entry is the ACTIVE one, never client input (FN-22)").toBe(periodOld);
      expect(entryRow(oldIncomeId).entry_type).toBe("income");

      const expense = await mustRecord("regular", { description: `${TAG} belanja periode lama`, amount: "120000" });
      oldExpenseId = expense.id;
      const voided = await mustRecord("regular", { description: `${TAG} salah periode lama`, amount: "7000" });
      oldVoidedId = voided.id;
      oldVoidedNo = voided.numberText;
      expect((await voidAs("regular", oldVoidedId, "Salah catat di periode lama")).ok).toBe(true);
      expect(entryRow(oldExpenseId).period_id).toBe(periodOld);

      // The Dashboard card and the header tiles are the ACTIVE period (2025/2026) and equal the tables.
      const wholeOld = totals(periodOld);
      await prev.page.goto("/");
      await expect(card(prev.page)).toContainText(`Periode ${OLD}`);
      await expect(card(prev.page)).toContainText(rupiah(wholeOld.balance));
      await prev.page.goto(PATHS.list);
      await expect(tiles(prev.page)).toContainText(rupiah(wholeOld.balance));
      await expect(tiles(prev.page)).toContainText(rupiah(wholeOld.income));
      await expect(tiles(prev.page)).toContainText(rupiah(wholeOld.expense));

      // L8: a current holder reads ALL periods. The 2026/2027 entry is history now: banner, no write buttons, a correction is offered (F5).
      await prev.page.goto(entryUrl(cur.id));
      await expect(prev.page.getByRole("heading", { level: 1, name: "Detail Transaksi" })).toBeVisible();
      await expect(prev.page.getByText(oldBanner(ACTIVE))).toBeVisible();
      await expect(prev.page.getByText(OLD_NOTE)).toBeVisible();
      await expect(prev.page.getByRole("button", { name: "Batalkan transaksi" })).toHaveCount(0);
      await expect(prev.page.getByRole("button", { name: "Tambah bukti" })).toHaveCount(0);
      await expect(prev.page.getByRole("link", { name: "Buat koreksi" })).toBeVisible();
      for (const [label, r] of [
        ["void", await voidAs("regular", cur.id, "coba")],
        ["add proof", await addProofAs("regular", cur.id, [fakeProof("regular", "x.pdf")])],
      ] as const) {
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe("closed_period");
      }
      expect(entryRow(cur.id).status).toBe("active");

      // The list of the old period: banner, no "Catat transaksi", the period select names both periods with the active one first.
      await prev.page.goto(`${PATHS.list}?period=${periodNew}`);
      await expect(prev.page.getByText(oldBanner(ACTIVE))).toBeVisible();
      await expect(prev.page.getByRole("link", { name: "Catat transaksi" })).toHaveCount(0);
      await expect(prev.page.getByRole("link", { name: `${TAG} periode sekarang` })).toBeVisible();
      await prev.page.goto(PATHS.list);
      const select = prev.page.locator("#finance-period");
      await expect(select.locator("option")).toHaveText([`${OLD} (aktif)`, ACTIVE]);
      await select.selectOption({ label: ACTIVE });
      await expect(prev.page).toHaveURL(new RegExp(`period=${periodNew}`));
      await expect(prev.page.getByText(oldBanner(ACTIVE))).toBeVisible();
      expect(await noHorizontalScroll(prev.page)).toBe(true);

      // Export of another period than the active one: the rows and summary of THAT period; the log names both periods.
      const before = exportLogMaxId();
      const other = await prev.context.request.post(EXPORT, { data: { format: "csv", filters: { periodId: periodNew, search: TAG } }, headers: { origin: ORIGIN } });
      expect(other.status()).toBe(200);
      expect(await other.text()).toContain(cur.numberText);
      const mine = await prev.context.request.post(EXPORT, { data: { format: "csv", filters: { search: TAG } }, headers: { origin: ORIGIN } });
      expect(mine.status()).toBe(200);
      const mineText = await mine.text();
      expect(mineText).toContain(oldIncomeNo);
      expect(mineText).not.toContain(cur.numberText);
      const logs = qjson<{ exported_period_id: string; period_id: string }>(`select exported_period_id, period_id from nexus.finance_export_logs where id > ${before} order by id`);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toEqual({ exported_period_id: periodNew, period_id: periodOld });
      expect(logs[1]).toEqual({ exported_period_id: periodOld, period_id: periodOld });

      // A plain member and a person with no key see nothing of it, in either period.
      await outsider.page.goto(PATHS.list);
      await expectForbiddenScreen(outsider.page);

      // ---- Back to 2026/2027
      setActivePeriod(ACTIVE);

      // The previous-period Treasurer is only a member again; the 2026/2027 holders are back, without logging in.
      await prev.page.goto(PATHS.list);
      await expectForbiddenScreen(prev.page);
      await prev.page.goto("/");
      await expect(prev.page.getByRole("heading", { level: 1, name: /^Shalom, / })).toBeVisible();
      expect(await drawerItems(prev.page)).not.toContain(FINANCE_ITEM);
      expect((await rpcAs("regular", "finance_entry_list", {})).ok).toBe(false);
      await bend.page.goto(PATHS.list);
      await expect(bend.page.getByRole("link", { name: "Catat transaksi" })).toBeVisible();
      await reader.page.goto(PATHS.list);
      await expect(reader.page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();

      // The Dashboard card is the active period only.
      await bend.page.goto("/");
      await expect(card(bend.page)).toContainText(`Periode ${ACTIVE}`);
      await expect(card(bend.page)).toContainText(rupiah(totals().balance));
      await expect(card(bend.page)).not.toContainText(OLD);

      // The period select now exists (an older period has data); choosing it shows the old period read-only for the Treasurer too.
      await bend.page.goto(PATHS.list);
      const bendSelect = bend.page.locator("#finance-period");
      await expect(bendSelect.locator("option")).toHaveText([`${ACTIVE} (aktif)`, OLD]);
      await bendSelect.selectOption({ label: OLD });
      await expect(bend.page).toHaveURL(new RegExp(`period=${periodOld}`));
      await expect(bend.page.getByText(oldBanner(OLD))).toBeVisible();
      await expect(bend.page.getByRole("link", { name: "Catat transaksi" })).toHaveCount(0);
      await expect(bend.page.getByRole("link", { name: `${TAG} iuran periode lama` })).toBeVisible();
      const oldWhole = totals(periodOld);
      await expect(tiles(bend.page)).toContainText(rupiah(oldWhole.balance));
      expect(await noHorizontalScroll(bend.page)).toBe(true);
      // BPH reads it too (L8) and still exports it; no write buttons.
      await reader.page.goto(`${PATHS.list}?period=${periodOld}`);
      await expect(reader.page.getByText(oldBanner(OLD))).toBeVisible();
      await expect(reader.page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(1);
      await expect(reader.page.getByRole("link", { name: "Catat transaksi" })).toHaveCount(0);

      // R6: an old Aktif entry cannot be voided or have proof added; the screen offers a correction instead.
      await bend.page.goto(entryUrl(oldIncomeId));
      await expect(bend.page.getByRole("heading", { level: 1, name: "Detail Transaksi" })).toBeVisible();
      await expect(bend.page.getByText(oldBanner(OLD))).toBeVisible();
      await expect(bend.page.getByText(OLD_NOTE)).toBeVisible();
      await expect(bend.page.getByRole("button", { name: "Batalkan transaksi" })).toHaveCount(0);
      await expect(bend.page.getByRole("button", { name: "Tambah bukti" })).toHaveCount(0);
      await expect(bend.page.getByRole("button", { name: /Tarik berkas/ })).toHaveCount(0);
      for (const [label, r] of [
        ["void", await voidAs("bendahara", oldIncomeId, "coba")],
        ["add proof", await addProofAs("bendahara", oldIncomeId, [fakeProof("bendahara", "x.pdf")])],
      ] as const) {
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe("closed_period");
      }
      expect(entryRow(oldIncomeId).status).toBe("active");
      // A voided old entry: shown as voided, nothing to correct (it is not Aktif).
      await bend.page.goto(entryUrl(oldVoidedId));
      await expect(bend.page.getByText(/^Dibatalkan oleh .* Alasan: Salah catat di periode lama$/)).toBeVisible();
      await expect(bend.page.getByRole("link", { name: "Buat koreksi" })).toHaveCount(0);
      await expect(bend.page.getByRole("button", { name: "Batalkan transaksi" })).toHaveCount(0);

      // F5: "Buat koreksi" opens the record form in the ACTIVE period: opposite type, same amount, linked, then an ordinary entry.
      const oldBefore = totals(periodOld);
      const activeBefore = totals();
      await bend.page.goto(entryUrl(oldIncomeId));
      await bend.page.getByRole("link", { name: "Buat koreksi" }).click();
      await expect(bend.page).toHaveURL(new RegExp(`/finance/catat\\?correct=${oldIncomeId}`));
      await expect(bend.page.getByRole("heading", { level: 1, name: "Catat Transaksi" })).toBeVisible();
      await expect(bend.page.getByText("Pengeluaran", { exact: true }).first()).toBeVisible(); // the opposite type, fixed
      await expect(bend.page.getByText(`Koreksi atas ${oldIncomeNo}`).first()).toBeVisible();
      await expect(bend.page.getByLabel("Jumlah (Rp)")).toHaveValue("300.000");
      await expect(bend.page.getByLabel(/^Keterangan$/)).toHaveValue(`Koreksi ${oldIncomeNo}: `);
      await fillAmount(bend.page, "250000");
      await fillDescription(bend.page, `${TAG} Koreksi ${oldIncomeNo}: salah hitung`);
      await clickNext(bend.page);
      await expect(dialog(bend.page).getByText(/^Pengeluaran Rp 250\.000 pada /)).toBeVisible();
      await expect(dialog(bend.page).getByText(`Koreksi atas ${oldIncomeNo}`)).toBeVisible();
      await clickSave(bend.page);
      await expect(bend.page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      const fixId = /\/finance\/([0-9a-f-]{36})/.exec(bend.page.url())![1];
      const fix = entryRow(fixId);
      expect(fix.period_id, "the correction lives in the ACTIVE period").toBe(periodNew);
      expect(fix.corrects_entry_id).toBe(oldIncomeId);
      expect(fix.entry_type).toBe("expense");
      expect(Number(fix.amount)).toBe(250000);
      expect(fix.status).toBe("active");
      expect(fix.created_by).toBe(memberId(emailOf("bendahara")));
      await expect(bend.page.getByRole("link", { name: `Koreksi atas ${oldIncomeNo}` })).toBeVisible();
      // The old entry is untouched, links forward, and its period's totals did not move (R6).
      expect(entryRow(oldIncomeId).status).toBe("active");
      expect(totals(periodOld)).toEqual(oldBefore);
      expect(totals().expense).toBe(activeBefore.expense + BigInt(250000));
      await bend.page.goto(entryUrl(oldIncomeId));
      await expect(bend.page.getByRole("link", { name: `Dikoreksi lewat ${fix.number_text}` })).toBeVisible();
      await bend.page.getByRole("link", { name: `Dikoreksi lewat ${fix.number_text}` }).click();
      await expect(bend.page).toHaveURL(new RegExp(`/finance/${fixId}`));

      // The database refuses a link to a voided entry, to a missing one, and a Saldo awal with a link (spec F2, F5).
      for (const [label, corrects, type] of [
        ["a voided entry", oldVoidedId, "expense"],
        ["an entry that does not exist", "00000000-0000-4000-8000-000000000000", "expense"],
        ["an opening balance", oldIncomeId, "opening"],
      ] as const) {
        const r = await recordAs("bendahara", { type, description: `${TAG} koreksi ditolak`, amount: "1000", corrects });
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe("invalid_correction");
      }
      expect(qjson(`select id from nexus.finance_entries where description = '${TAG} koreksi ditolak'`)).toHaveLength(0);

      // F8.2: the previous period's closing balance is a HINT on the opening form, never a silent prefill (FN-21).
      const activeOpening = Number(q(`select count(*) from nexus.finance_entries where entry_type = 'opening' and status = 'active' and period_id = '${periodNew}'`));
      if (activeOpening === 0) {
        const closing = totals(periodOld).balance;
        await bend.page.goto(PATHS.opening);
        await expect(bend.page.getByRole("heading", { level: 1, name: "Catat Saldo Awal" })).toBeVisible();
        await expect(bend.page.getByText(`Saldo akhir periode ${OLD}: ${rupiah(closing)}.`)).toBeVisible();
        await expect(bend.page.getByLabel("Jumlah (Rp)")).toHaveValue("");
        if (closing > BigInt(0)) {
          await bend.page.getByRole("button", { name: "Pakai angka ini" }).click();
          await expect(bend.page.getByLabel("Jumlah (Rp)")).toHaveValue(closing.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."));
        }
      }
    } finally {
      setActivePeriod(ACTIVE);
      dropTemporaryTreasurer();
      for (const c of [bend, reader, prev, outsider]) await c.context.close();
    }

    // Nothing was deleted: every record is still there with its original period.
    expect(entryRow(cur.id).period_id).toBe(periodNew);
    expect(entryRow(oldIncomeId).period_id).toBe(periodOld);
    expect(entryRow(oldExpenseId).period_id).toBe(periodOld);
    expect(entryRow(oldVoidedId).status).toBe("voided");
    expect(oldVoidedNo).toMatch(/^KAS-\d{4,}$/);
    expect(q("select count(*) from public.periods where is_active")).toBe("1");
  });
});

test.describe("R4, E4: no active period", () => {
  test("Treasurer and BPH read and write nothing; every door says why; the entries are untouched; the period back, it all works again", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const own = await mustRecord("bendahara", { description: `${TAG} sebelum periode hilang`, amount: "13000" });
    const bend = await signedInContext(browser, "bendahara");
    const reader = await signedInContext(browser, "ketum");
    try {
      const rows = entryCount();
      setActivePeriod(null);

      for (const [who, c] of [["bendahara", bend], ["ketum", reader]] as const) {
        await c.page.goto(PATHS.list);
        await expectForbiddenScreen(c.page);
        await expect(c.page.getByText("Belum ada periode aktif.")).toBeVisible();
        await c.page.goto(entryUrl(own.id));
        await expectForbiddenScreen(c.page);
        await c.page.goto("/");
        await expect(c.page.getByRole("heading", { level: 1, name: /^Shalom, / })).toBeVisible();
        await expect(card(c.page), `${who}: no Dashboard card`).toHaveCount(0);
        expect(await drawerItems(c.page)).not.toContain(FINANCE_ITEM);
        expect((await rpcAs(who, "finance_summary", {})).ok, `${who} summary`).toBe(false);
        expect((await rpcAs(who, "finance_entry_list", {})).ok, `${who} list`).toBe(false);
        expect((await rpcAs(who, "finance_export", { p_format: "csv" })).ok, `${who} export`).toBe(false);
        const route = await c.context.request.post(EXPORT, { data: { format: "csv", filters: {} }, headers: { origin: ORIGIN } });
        expect(route.status(), `${who} export route`).toBe(403);
      }
      await bend.page.goto(PATHS.record);
      await expectForbiddenScreen(bend.page);
      await bend.page.goto(PATHS.opening);
      await expectForbiddenScreen(bend.page);
      expect((await recordAs("bendahara", { description: `${TAG} tanpa periode`, amount: "1000" })).ok).toBe(false);
      expect((await voidAs("bendahara", own.id)).ok).toBe(false);
      expect(entryCount(), "nothing was written").toBe(rows);
      expect(entryRow(own.id).status).toBe("active");

      // Period back: the same sessions work again and the entry is exactly as it was.
      setActivePeriod(ACTIVE);
      await bend.page.goto(PATHS.list);
      await expect(bend.page.getByRole("link", { name: "Catat transaksi" })).toBeVisible();
      await expect(bend.page.getByRole("link", { name: `${TAG} sebelum periode hilang` })).toBeVisible();
      await reader.page.goto(PATHS.list);
      await expect(reader.page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
      expect(main(bend.page)).toBeTruthy();
      expect((await voidAs("bendahara", own.id, "QA selesai")).ok).toBe(true);
    } finally {
      setActivePeriod(ACTIVE);
      for (const c of [bend, reader]) await c.context.close();
    }
    expect(q("select count(*) from public.periods where is_active")).toBe("1");
  });
});
