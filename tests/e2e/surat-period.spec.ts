// Letters: Dashboard card (LT-40, LT-52), and the change of the active period (spec F9, R6, R7, R15, LT-04, LT-30, LT-31, LT-18).
// Pattern of inventaris-period.spec.ts: sessions stay open the whole time (no logout), the period is always restored in `finally`.
import { expect, test } from "@playwright/test";
import { setActivePeriod, signedInContext } from "./helpers";
import {
  awayFromMidnight,
  drawerItems,
  emailOf,
  expectForbiddenScreen,
  fakeFile,
  issueAs,
  jakartaToday,
  letterOfRequest,
  letterRow,
  letterUrl,
  LETTERS_ITEM,
  main,
  memberId,
  mustCreate,
  mustRegister,
  noHorizontalScroll,
  PATHS,
  postUploadAs,
  processAs,
  q,
  qn,
  reqRow,
  reqStatus,
  requesterWithRoom,
  requestUrl,
  rpcAs,
  sweepQa,
  takenRequest,
  takeNumberAs,
  tag,
  type PersonaKey,
} from "./surat-helpers";

const TAG = tag();
const ACTIVE = "2026/2027";
const OLD = "2025/2026";

test.afterAll(async () => {
  setActivePeriod(ACTIVE);
  q(`delete from public.assignments where id in (select a.id from public.assignments a join public.members m on m.id = a.member_id where m.email = 'member.regular@nexus.test' and a.period_id = (select id from public.periods where label = '${OLD}'))`);
  await sweepQa(TAG);
});

const card = (page: import("@playwright/test").Page) => page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Surat Menyurat" }) });

// ---------------------------------------------------------------------------------------------
test.describe("LT-40, LT-52: the Dashboard card Surat Menyurat (counts only, for letters.view holders)", () => {
  const oracle = () => ({
    incoming: qn("select count(*) from nexus.letters where letter_type = 'incoming' and status = 'active' and period_id = (select id from public.periods where is_active)"),
    outgoing: qn("select count(*) from nexus.letters where letter_type = 'outgoing' and status = 'active' and period_id = (select id from public.periods where is_active)"),
    waiting: qn("select count(*) from nexus.letter_requests where status = 'submitted'"), // Diajukan of ALL periods (G9)
  });
  const fmt = (n: number) => n.toLocaleString("id-ID");

  test("setup: one voided letter and one open request exist, so counts differ from 'everything'", async () => {
    await awayFromMidnight();
    const l = await mustRegister("sekjen", "incoming", { subject: `${TAG} dasbor batal` });
    expect((await rpcAs("sekjen", "letter_void", { p_letter_id: l.id, p_version: l.version, p_reason: "uji dasbor" })).ok).toBe(true);
    await mustRegister("sekjen", "outgoing", { subject: `${TAG} dasbor aktif` });
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left; the card is still checked without a fresh request");
    await mustCreate(who as PersonaKey, { subject: `${TAG} dasbor menunggu` });
  });

  for (const persona of ["ketum", "bendahara", "sekjen", "sekum1"] as const) {
    test(`${persona} sees the card; the numbers equal the tables; no letter title or number on it`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        const c = card(page);
        await expect(c).toBeVisible();
        const want = oracle();
        await expect(c.getByText(`${fmt(want.incoming)} surat masuk dan ${fmt(want.outgoing)} surat keluar di periode ${ACTIVE}, ${fmt(want.waiting)} permohonan menunggu`)).toBeAttached();
        const text = await c.innerText();
        expect(text).not.toMatch(/PMK\/NEX|QA[A-Z0-9]{6,}/); // counts only: never a number, a title or a counterpart (L11)
        await expect(c.getByRole("link", { name: "Buka register" })).toBeVisible();
        if (want.waiting > 0) await expect(c.getByRole("link", { name: `${fmt(want.waiting)} permohonan menunggu` })).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
      } finally {
        await context.close();
      }
    });
  }

  for (const persona of ["regular", "pembina", "admin", "sekdep", "kadep", "kabiro", "staffOps"] as const) {
    test(`${persona} has NO Surat Menyurat card (no view right); they reach 'Permohonan Saya' from the drawer`, async ({ browser }) => {
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1, name: /^Shalom, / })).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Surat Menyurat" })).toHaveCount(0);
        expect((await drawerItems(page)).filter((t) => t === LETTERS_ITEM)).toHaveLength(1);
      } finally {
        await context.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("F9, LT-30, LT-04, R15: a new period moves the access by itself, old data stays as history", () => {
  test("2026/2027 -> 2025/2026 -> back, with sessions kept open", async ({ browser }) => {
    test.setTimeout(480_000);
    await awayFromMidnight();
    const requester = requesterWithRoom(3, ["regular"]);
    test.skip(requester === null, "no requester has daily room left; rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1");
    const who = requester as PersonaKey;

    // Data of the CURRENT period (2026/2027): a letter, an issued request, a request with a taken number, a request still Diajukan
    const oldLetter = await mustRegister("sekjen", "outgoing", { subject: `${TAG} surat periode lama` });
    const submitted = await mustCreate(who, { subject: `${TAG} masih diajukan` });
    const taken = await takenRequest(who, "sekjen", { subject: `${TAG} nomor sudah diambil` });
    const periodNew = q(`select id from public.periods where label = '${ACTIVE}'`);
    const periodOld = q(`select id from public.periods where label = '${OLD}'`);
    expect(letterRow(oldLetter.id).period_id).toBe(periodNew);

    // Open sessions: the 2026/2027 secretary, a plain member, the requester, and `regular` = secretary of 2025/2026 ONLY
    const sekjen = await signedInContext(browser, "sekjen");
    const outsider = await signedInContext(browser, "sekdep");
    const member = await signedInContext(browser, who);
    const prev = await signedInContext(browser, "regular");
    let assignmentId = "";
    try {
      // Before the switch nobody sees the register but the 2026/2027 holders
      await prev.page.goto(PATHS.incoming);
      await expectForbiddenScreen(prev.page);
      await sekjen.page.goto(PATHS.incoming);
      await expect(sekjen.page.getByRole("link", { name: "Catat Surat Masuk" })).toBeVisible();

      assignmentId = q(
        `insert into public.assignments(member_id, org_unit_id, position_id, period_id)
         select (select id from public.members where email = 'member.regular@nexus.test'),
                (select id from public.org_units where name = 'BPH PMK ITERA'),
                (select id from public.positions where name = 'Sekretaris Jenderal'),
                (select id from public.periods where label = '${OLD}')
         returning id`,
      ).split("\n")[0];

      // ---- Switch: 2025/2026 becomes active
      setActivePeriod(OLD);

      // The 2026/2027 secretary loses the register, the queue and the numbering page on the next request, no logout
      await sekjen.page.goto(PATHS.incoming);
      await expectForbiddenScreen(sekjen.page);
      await sekjen.page.goto(PATHS.queue);
      await expectForbiddenScreen(sekjen.page);
      await sekjen.page.goto(PATHS.numbering);
      await expectForbiddenScreen(sekjen.page);
      expect((await rpcAs("sekjen", "letter_list", { p_type: "incoming" })).ok).toBe(false);
      expect((await rpcAs("sekjen", "letter_register", { p_type: "outgoing", p_subject: `${TAG} tolak periode`, p_counterpart: "x", p_letter_date: jakartaToday() })).ok).toBe(false);
      // ...but still opens the module as a member: the drawer item stays, Permohonan Saya works (L9)
      await sekjen.page.goto("/surat");
      await expect(sekjen.page).toHaveURL(/\/surat\/saya$/);
      await expect(sekjen.page.getByRole("heading", { level: 1, name: LETTERS_ITEM })).toBeVisible();
      await expect(sekjen.page.getByText(`Periode ${OLD}`).first()).toBeVisible();
      // No Dashboard card for them any more
      await sekjen.page.goto("/");
      await expect(sekjen.page.getByRole("heading", { level: 2, name: "Surat Menyurat" })).toHaveCount(0);

      // The secretary of 2025/2026 gains the rights without logging in again (P-OLD inverse)
      await prev.page.goto(PATHS.incoming);
      await expect(prev.page.getByRole("link", { name: "Catat Surat Masuk" })).toBeVisible();
      await expect(prev.page.getByText(`Periode ${OLD}`).first()).toBeVisible();
      // The default view is the ACTIVE period: the 2026/2027 letter is history, behind "Semua periode"
      await prev.page.goto(`${PATHS.outgoing}?q=${TAG}`);
      await expect(prev.page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await prev.page.goto(`${PATHS.outgoing}?q=${TAG}&period=all`);
      await expect(prev.page.locator("article", { hasText: oldLetter.numberText })).toBeVisible();

      // R15: the old letter is readable but read-only, even for the new manager (access control L7)
      await prev.page.goto(letterUrl(oldLetter.id));
      await expect(prev.page.getByText(`${TAG} surat periode lama`).first()).toBeVisible();
      await expect(prev.page.getByRole("button", { name: /Batalkan nomor|Tambah berkas/ })).toHaveCount(0);
      await expect(prev.page.getByRole("link", { name: "Ubah rincian" })).toHaveCount(0);
      await prev.page.goto(`${letterUrl(oldLetter.id)}/ubah`);
      await expect(prev.page.getByText("Surat ini tidak bisa diubah.")).toBeVisible();
      const v = Number(letterRow(oldLetter.id).version);
      for (const [fn, args] of [
        ["letter_update", { p_letter_id: oldLetter.id, p_version: v, p_subject: "x", p_counterpart: "y", p_letter_date: jakartaToday() }],
        ["letter_void", { p_letter_id: oldLetter.id, p_version: v, p_reason: "coba" }],
        ["letter_add_files", { p_letter_id: oldLetter.id, p_version: v, p_files: [fakeFile("regular")] }],
      ] as const) {
        const r = await rpcAs("regular", fn, args);
        expect(r.ok, fn).toBe(false);
        expect(r.hint, fn).toBe("closed_period");
      }
      expect(letterRow(oldLetter.id).status).toBe("active");

      // LT-30: open requests of the old period stay actionable by the CURRENT holders
      await prev.page.goto(PATHS.queue);
      await expect(prev.page.getByText(`Periode ${OLD}`).first()).toBeVisible();
      await prev.page.goto(requestUrl(submitted.id));
      await expect(prev.page.getByText(`Permohonan ini dari periode ${ACTIVE}.`)).toBeVisible();
      await prev.page.getByRole("button", { name: "Proses permohonan" }).click();
      await prev.page.getByRole("dialog").getByRole("button", { name: "Proses permohonan" }).click();
      await expect(prev.page.getByText("Permohonan diproses.")).toBeVisible();
      expect(reqStatus(submitted.id)).toBe("processing");
      // Number taken AFTER the switch: the letter is created in the ACTIVE period (2025/2026), linked to the old request
      const sequenceBefore = qn(`select coalesce(max(last_value), 0) from nexus.letter_number_counters where letter_type = 'outgoing' and number_year = ${jakartaToday().slice(0, 4)}`);
      await prev.page.getByRole("button", { name: "Ambil nomor" }).click();
      await prev.page.getByRole("dialog").getByRole("button", { name: "Ambil nomor" }).click();
      await expect(prev.page.getByText("Nomor surat", { exact: true })).toBeVisible();
      const late = letterOfRequest(submitted.id);
      expect(late.period_id).toBe(periodOld);
      expect(reqRow(submitted.id).period_id).toBe(periodNew); // the request keeps its own period
      // The numbering year does not reset on a period change (LT-18): the sequence just continues
      expect(Number(/\/(\d+)$/.exec(late.number_text)![1])).toBe(sequenceBefore + 1);
      // A number taken BEFORE the switch keeps its period and still gets its final file from the new holder
      expect(letterRow(taken.letterId).period_id).toBe(periodNew);
      const issued = await issueAs("regular", taken.id, [fakeFile("regular", "final.pdf")]);
      expect(issued.ok, JSON.stringify(issued.body)).toBe(true);
      expect(reqStatus(taken.id)).toBe("issued");
      expect(letterRow(taken.letterId).period_id).toBe(periodNew);
      // ...and its history keeps the actor's period at the time
      expect(qn(`select count(*) from nexus.letter_request_history where request_id = '${taken.id}' and event = 'issued' and period_id = '${periodOld}'`)).toBe(1);

      // "Belum selesai (semua periode)" is the handover list: it shows open requests of every period
      await prev.page.goto(`${PATHS.queue}?view=open_all_periods`);
      await expect(prev.page.getByText("Daftar ini untuk serah terima pengurus.")).toBeVisible();

      // Requesters keep their own history: the issued old-period request and its file are still theirs (L9); the register is not
      await member.page.goto(requestUrl(taken.id));
      await expect(member.page.getByRole("button", { name: "Unduh final.pdf" })).toBeVisible();
      await member.page.goto(PATHS.incoming);
      await expectForbiddenScreen(member.page);
      await member.page.goto(PATHS.mine);
      await expect(member.page.locator("article", { hasText: `${TAG} nomor sudah diambil` })).toBeVisible();
      // A plain member's view of the module does not change at all
      await outsider.page.goto("/surat");
      await expect(outsider.page).toHaveURL(/\/surat\/saya$/);

      // ---- Back to 2026/2027
      setActivePeriod(ACTIVE);
      await prev.page.goto(PATHS.incoming);
      await expectForbiddenScreen(prev.page); // the previous-period secretary is only a member again
      await prev.page.goto(PATHS.mine);
      await expect(prev.page.getByRole("heading", { level: 1, name: LETTERS_ITEM })).toBeVisible();
      await sekjen.page.goto(PATHS.incoming);
      await expect(sekjen.page.getByRole("link", { name: "Catat Surat Masuk" })).toBeVisible();
      // The letter created during the 2025/2026 interlude is now history: read-only for everybody, still in the register
      await sekjen.page.goto(`${PATHS.outgoing}?q=${TAG}&period=all`);
      await expect(sekjen.page.locator("article", { hasText: late.number_text })).toBeVisible();
      await sekjen.page.goto(letterUrl(late.id));
      await expect(sekjen.page.getByRole("button", { name: /Batalkan nomor/ })).toHaveCount(0);
      expect((await rpcAs("sekjen", "letter_void", { p_letter_id: late.id, p_version: letterRow(late.id).version, p_reason: "coba" })).hint).toBe("closed_period");
      // The default list hides it again (it is not of the active period) and the header tiles count the active period only
      await sekjen.page.goto(`${PATHS.outgoing}?q=${TAG}`);
      await expect(sekjen.page.locator("article", { hasText: late.number_text })).toHaveCount(0);
      await expect(sekjen.page.locator("article", { hasText: oldLetter.numberText })).toBeVisible();
      // The request that was processed during the interlude can be finished by a CURRENT holder (its open request is not closed by the switch)
      const finish = await issueAs("sekum1", submitted.id, [fakeFile("sekum1", "akhir.pdf")]);
      expect(finish.ok, JSON.stringify(finish.body)).toBe(true);
      expect(reqStatus(submitted.id)).toBe("issued");
      expect(letterRow(late.id).period_id).toBe(periodOld); // the letter keeps the period of the moment its number was taken
    } finally {
      setActivePeriod(ACTIVE);
      if (assignmentId) q(`delete from public.assignments where id = '${assignmentId}'`);
      for (const c of [sekjen, outsider, member, prev]) await c.context.close();
    }
    // Nothing was deleted: every record is still there with its original period
    expect(letterRow(oldLetter.id).period_id).toBe(periodNew);
    expect(reqRow(submitted.id).period_id).toBe(periodNew);
    expect(memberId(emailOf("regular"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("LT-31, R7: no active period", () => {
  test("requests, registration and numbering are refused with the banner; own requests stay readable; the admin still reaches Penomoran Surat", async ({ browser }) => {
    test.setTimeout(300_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const requester = who as PersonaKey;
    const own = await mustCreate(requester, { subject: `${TAG} sebelum periode hilang` });
    const sekjen = await signedInContext(browser, "sekjen");
    const member = await signedInContext(browser, requester);
    const admin = await signedInContext(browser, "admin");
    try {
      setActivePeriod(null);
      // Secretary: rule-based rights match nothing without a period, the page says why
      await sekjen.page.goto(PATHS.incoming);
      await expectForbiddenScreen(sekjen.page);
      await expect(sekjen.page.getByText("Belum ada periode aktif.")).toBeVisible();
      await sekjen.page.goto(PATHS.registerIncoming);
      await expectForbiddenScreen(sekjen.page);
      const reg = await rpcAs("sekjen", "letter_register", { p_type: "outgoing", p_subject: `${TAG} tanpa periode`, p_counterpart: "x", p_letter_date: jakartaToday() });
      expect(reg.ok).toBe(false);
      expect(qn(`select count(*) from nexus.letters where subject = '${TAG} tanpa periode'`)).toBe(0);
      // Member: the request form is replaced by the message; creating is refused; the own request is still readable
      await member.page.goto(PATHS.form);
      await expect(member.page.getByText("Belum ada periode aktif. Permohonan belum bisa dibuat.")).toBeVisible();
      await expect(member.page.getByRole("button", { name: "Ajukan Surat" })).toHaveCount(0);
      const created = await rpcAs(requester, "letter_request_create", { p_subject: `${TAG} tanpa periode`, p_addressee: "x", p_purpose: "y" });
      expect(created.ok).toBe(false);
      expect(created.hint).toBe("no_active_period");
      await member.page.goto(PATHS.mine);
      await expect(member.page.getByText("Belum ada periode aktif. Permohonan belum bisa dibuat.").first()).toBeVisible();
      await expect(member.page.locator("article", { hasText: `${TAG} sebelum periode hilang` })).toBeVisible();
      await member.page.goto(requestUrl(own.id));
      await expect(member.page.getByRole("heading", { level: 1, name: `${TAG} sebelum periode hilang` })).toBeVisible();
      // A request can be processed by nobody (the secretaries match nothing), and the upload route refuses too
      expect((await processAs("sekjen", own.id)).ok).toBe(false);
      expect((await takeNumberAs("sekjen", own.id)).ok).toBe(false);
      expect((await postUploadAs(member.context)).status).toBe(409);
      // The numbering page works for the System Admin without a period (access control AC-43)
      await admin.page.goto(PATHS.numbering);
      await expect(admin.page.getByRole("heading", { level: 1, name: "Penomoran Surat" })).toBeVisible();
      await expect(admin.page.getByRole("button", { name: "Simpan format" })).toBeVisible();
      // No Dashboard card without a period
      await sekjen.page.goto("/");
      await expect(sekjen.page.getByRole("heading", { level: 2, name: "Surat Menyurat" })).toHaveCount(0);
      expect(await noHorizontalScroll(sekjen.page)).toBe(true);
      await expect(main(member.page)).toBeVisible();

      // Period back: the request is still there and works
      setActivePeriod(ACTIVE);
      await sekjen.page.goto(PATHS.incoming);
      await expect(sekjen.page.getByRole("link", { name: "Catat Surat Masuk" })).toBeVisible();
      expect((await processAs("sekjen", own.id)).ok).toBe(true);
    } finally {
      setActivePeriod(ACTIVE);
      for (const c of [sekjen, member, admin]) await c.context.close();
    }
    expect(q("select count(*) from public.periods where is_active")).toBe("1");
  });
});
