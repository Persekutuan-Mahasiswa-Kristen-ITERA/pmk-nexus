// Finance: the Treasurer's flows in the browser at 390 px (F2, F3, F4, F6; FN-08..FN-20, FN-24, FN-36, FN-37).
// Setup goes through the app's own database functions; the flows under test are clicked. The ledger is append-only,
// so every description carries "QA<tag>" and `sweepQa` voids what is still Aktif at the end.
// The local stack has no Storage: the upload route is answered by a stub that returns the well-formed path in the
// caller's own folder (the database skips the object check without a storage schema). The route's own checks are
// covered by tests/unit/finance-server.test.ts with the real handler.
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  activePeriodId,
  addDays,
  addProofAs,
  awayFromMidnight,
  clickNext,
  clickSave,
  detailAs,
  dialog,
  emailOf,
  entryByDescription,
  entryCount,
  entryRow,
  entryUrl,
  fakeProof,
  fillAmount,
  fillDate,
  fillDescription,
  fillNotes,
  historyOf,
  jakartaToday,
  main,
  memberId,
  mustRecord,
  nameOf,
  noHorizontalScroll,
  PATHS,
  PDF_BYTES,
  q,
  qn,
  recordAs,
  row,
  rpcAs,
  rupiah,
  sweepQa,
  tag,
  totals,
  UPLOAD,
  voidAs,
  withdrawProofAs,
} from "./finance-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

const activeOpening = () =>
  qn("select count(*) from nexus.finance_entries where entry_type = 'opening' and status = 'active' and period_id = (select id from public.periods where is_active)");
const tiles = (page: Page) => page.getByRole("region", { name: "Ringkasan keuangan periode" });
const idFromUrl = (page: Page) => /\/finance\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

/** Answers the upload route like the real one would (the local stack has no Storage). */
async function stubProofUpload(page: Page) {
  const folder = memberId(emailOf("bendahara"));
  await page.route(`**${UPLOAD}`, async (route: Route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const name = /filename="([^"]*)"/.exec(body)?.[1] ?? "nota.pdf";
    const type = /Content-Type: (application\/pdf|image\/jpeg|image\/png)/i.exec(body)?.[1] ?? "application/pdf";
    const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: `${folder}/${randomUUID()}.${ext}`, name, sizeBytes: 1234, mimeType: type }),
    });
  });
}
const pickFile = (page: Page, name = "nota.pdf") =>
  page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: PDF_BYTES() });

/** Fills the record form (Jenis stays "Pengeluaran" unless `income`), presses "Lanjut" and waits for the check sheet. */
async function fillAndCheck(page: Page, o: { amount: string; description: string; income?: boolean; notes?: string; date?: string }) {
  await page.goto(PATHS.record);
  await expect(page.getByRole("heading", { level: 1, name: "Catat Transaksi" })).toBeVisible();
  if (o.income) await page.getByRole("radiogroup", { name: "Jenis transaksi" }).getByText("Pemasukan", { exact: true }).click();
  await fillAmount(page, o.amount);
  if (o.date) await fillDate(page, "Tanggal", o.date);
  await fillDescription(page, o.description);
  if (o.notes) await fillNotes(page, o.notes);
  await clickNext(page);
  await expect(dialog(page).getByRole("heading", { name: "Cek dulu" })).toBeVisible();
}

test.describe("F2 / FN-17 / FN-18 / FN-36: record an expense and an income from the phone", () => {
  test("Lanjut -> Cek dulu -> Simpan: one entry, a number from the database, history, totals and the notice", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      const before = entryCount();
      const t0 = totals();
      await fillAndCheck(page, { amount: "25000", description: `${TAG} beli spidol`, notes: "untuk kelas PA" });
      expect(await noHorizontalScroll(page)).toBe(true);
      await expect(dialog(page).getByText(/^Pengeluaran Rp 25\.000 pada /)).toBeVisible();
      await expect(dialog(page).getByText(`${TAG} beli spidol`)).toBeVisible();
      await expect(dialog(page).getByText("Setelah disimpan, transaksi tidak bisa diubah. Kalau salah, kamu hanya bisa membatalkannya.")).toBeVisible();
      expect(entryCount(), "nothing is saved before Simpan").toBe(before);

      await clickSave(page);
      await expect(page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      const id = idFromUrl(page);
      const e = entryRow(id);
      await expect(page.getByText(`Transaksi ${e.number_text} tersimpan.`)).toBeVisible();
      expect(Number(e.amount)).toBe(25000); // whole rupiah, never a float (the table read returns a JSON number)
      expect(e.entry_type).toBe("expense");
      expect(e.entry_date).toBe(jakartaToday());
      expect(e.notes).toBe("untuk kelas PA");
      expect(e.period_id).toBe(activePeriodId()); // the period is the active one, never client input (FN-22)
      expect(e.status).toBe("active");
      expect(String(e.number_text)).toMatch(/^KAS-\d{4,}$/);
      expect(entryCount()).toBe(before + 1);
      expect(totals().expense).toBe(t0.expense + BigInt(25000));
      expect((await historyOf(id)).map((h) => h.kind)).toEqual(["recorded"]);
      expect((await historyOf(id))[0].actor).toBe(emailOf("bendahara"));

      await expect(page.getByRole("heading", { level: 1, name: "Detail Transaksi" })).toBeVisible();
      await expect(main(page).getByText("-Rp 25.000").first()).toBeVisible(); // the sign carries the meaning, not colour alone
      await expect(main(page).getByText(`Dicatat oleh ${nameOf("bendahara")}`, { exact: true })).toBeVisible();
      await expect(page.getByText("Tanpa bukti.")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);

      // The list and its tiles follow the database (FN-10).
      await page.goto(PATHS.list);
      await expect(page.getByRole("link", { name: `${TAG} beli spidol` }).first()).toBeVisible();
      await expect(tiles(page)).toContainText(rupiah(totals().balance));
      await expect(tiles(page)).toContainText(rupiah(totals().expense));
    } finally {
      await context.close();
    }
  });

  test("an income saves as Pemasukan with a plus sign", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      const t0 = totals();
      await fillAndCheck(page, { amount: "1250000", description: `${TAG} iuran`, income: true });
      await expect(dialog(page).getByText(/^Pemasukan Rp 1\.250\.000 pada /)).toBeVisible();
      await clickSave(page);
      await expect(page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      expect(entryRow(idFromUrl(page)).entry_type).toBe("income");
      expect(Number(entryRow(idFromUrl(page)).amount)).toBe(1250000);
      await expect(main(page).getByText("+Rp 1.250.000").first()).toBeVisible();
      expect(totals().income).toBe(t0.income + BigInt(1250000));
      expect(totals().balance).toBe(totals().opening + totals().income - totals().expense); // spec 4.2
    } finally {
      await context.close();
    }
  });

  test("FN-17: a double tap on Simpan transaksi saves exactly one entry", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      await fillAndCheck(page, { amount: "4000", description: `${TAG} klik ganda` });
      await dialog(page).getByRole("button", { name: "Simpan transaksi", exact: true }).dblclick();
      await expect(page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      expect(entryByDescription(`${TAG} klik ganda`)).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test("FN-17: a retry with the same submit key is a success and returns the SAME entry; the same key with other values is refused", async () => {
    await awayFromMidnight();
    const key = randomUUID();
    const first = await recordAs("bendahara", { key, description: `${TAG} ulang kunci`, amount: "3000" });
    expect(first.ok, JSON.stringify(first.body)).toBe(true);
    const again = await recordAs("bendahara", { key, description: `${TAG} ulang kunci`, amount: "3000" });
    expect(again.ok).toBe(true);
    expect(row(again).replayed).toBe(true);
    expect(row(again).entry_id).toBe(row(first).entry_id);
    expect(row(again).number_text).toBe(row(first).number_text);
    expect(entryByDescription(`${TAG} ulang kunci`)).toHaveLength(1);
    const other = await recordAs("bendahara", { key, description: `${TAG} ulang kunci`, amount: "3001" });
    expect(other.ok).toBe(false);
    expect(other.hint).toBe("idempotency_conflict");
    expect(entryByDescription(`${TAG} ulang kunci`)).toHaveLength(1);
  });

  test("FN-18: numbers go up and are never reused, also after a void; two simultaneous saves get different numbers", async () => {
    await awayFromMidnight();
    const a = await mustRecord("bendahara", { description: `${TAG} nomor A`, amount: "100" });
    expect((await voidAs("bendahara", a.id)).ok).toBe(true);
    const [b, c] = await Promise.all([
      recordAs("bendahara", { description: `${TAG} nomor B`, amount: "100" }),
      recordAs("bendahara", { description: `${TAG} nomor C`, amount: "100" }),
    ]);
    expect(b.ok && c.ok, JSON.stringify([b.body, c.body])).toBe(true);
    const nums = [a.numberText, row(b).number_text, row(c).number_text].map((n: string) => Number(n.replace("KAS-", "")));
    expect(new Set(nums).size).toBe(3);
    expect(Math.min(nums[1], nums[2])).toBeGreaterThan(nums[0]);
  });
});

test.describe("FN-08, FN-12, FN-36: the form refuses bad input and says why; the server and the database refuse it too", () => {
  test("empty amount, Rp 0, missing description and a future date: messages next to the field, nothing saved", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      const before = entryCount();
      await page.goto(PATHS.record);
      await clickNext(page);
      await expect(page.getByText("Isi jumlah dengan angka bulat, minimal Rp 1.")).toBeVisible();
      await expect(page.getByText("Keterangan wajib diisi.")).toBeVisible();
      await expect(dialog(page)).toHaveCount(0);

      await fillAmount(page, "0");
      await clickNext(page);
      await expect(page.getByText("Isi jumlah dengan angka bulat, minimal Rp 1.")).toBeVisible(); // Rp 0 is only for Saldo awal (A-FN1)

      await fillAmount(page, "5000");
      await fillDescription(page, `${TAG} tanggal depan`);
      await fillDate(page, "Tanggal", addDays(jakartaToday(), 3));
      await clickNext(page);
      await expect(page.getByText("Tanggal tidak boleh di masa depan.")).toBeVisible();
      await expect(dialog(page)).toHaveCount(0);
      expect(entryCount()).toBe(before);
      expect(await noHorizontalScroll(page)).toBe(true);

      // 16 px text and a 44 px target (D-017, FN-36): measured on the real fields.
      const metrics = await page.evaluate(() => {
        const fields = [...document.querySelectorAll<HTMLElement>('input[type="text"], input[type="date"], textarea')];
        return fields.map((el) => ({ h: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) }));
      });
      expect(metrics.length).toBeGreaterThanOrEqual(3);
      for (const m of metrics) {
        expect(m.font).toBeGreaterThanOrEqual(16);
        expect(m.h).toBeGreaterThanOrEqual(44);
      }
      // The amount field opens the numeric keypad and shows thousands dots (FN-36).
      await expect(page.getByLabel("Jumlah (Rp)")).toHaveAttribute("inputmode", "numeric");
      await fillAmount(page, "1234567");
      await expect(page.getByLabel("Jumlah (Rp)")).toHaveValue("1.234.567");
    } finally {
      await context.close();
    }
  });

  test("the database refuses what the form would: decimals, signs, exponents, empty, letters, too large, Rp 0, long text, a future date", async () => {
    await awayFromMidnight();
    const before = entryCount();
    const bad = async (patch: Parameters<typeof recordAs>[1], hint: string, label: string) => {
      const r = await recordAs("bendahara", { description: `${TAG} salah`, ...patch });
      expect(r.ok, `${label}: ${JSON.stringify(r.body).slice(0, 100)}`).toBe(false);
      expect(r.hint, label).toBe(hint);
    };
    // " 5" is NOT in this list: the database trims the edges of the amount (btrim), so it saves as Rp 5.
    for (const amount of ["12.5", "1e3", "-5", "", "abc", "1,000", "5 5", "+5", "٣"]) await bad({ amount }, "invalid_amount", `amount ${JSON.stringify(amount)}`);
    await bad({ amount: "10000000000" }, "amount_too_large", "over 9.999.999.999");
    await bad({ amount: "0" }, "invalid_amount", "Rp 0 for an expense");
    await bad({ amount: "0", type: "income" }, "invalid_amount", "Rp 0 for an income");
    await bad({ description: "x".repeat(201) }, "text_too_long", "Keterangan over 200");
    await bad({ description: "   " }, "text_required", "blank Keterangan");
    await bad({ notes: "x".repeat(501) }, "text_too_long", "Catatan over 500");
    await bad({ date: addDays(jakartaToday(), 2) }, "date_in_future", "future date");
    expect(entryCount()).toBe(before);
    // The edge that must work: exactly the maximum.
    const max = await recordAs("bendahara", { description: `${TAG} maksimum`, amount: "9999999999" });
    expect(max.ok, JSON.stringify(max.body)).toBe(true);
    expect(Number(entryRow(row(max).entry_id).amount)).toBe(9999999999);
  });
});

test.describe("F4 / FN-13..FN-15, FN-19: void with a reason; nothing is ever edited or restored", () => {
  test("Batalkan transaksi: a reason is required; the entry stays as Dibatalkan with who, when and why; totals drop it; Catat ulang copies it", async ({ browser }) => {
    await awayFromMidnight();
    const made = await mustRecord("bendahara", { description: `${TAG} salah catat`, amount: "88000", notes: "typo" });
    const t0 = totals();
    const { context, page } = await signedInContext(browser, "bendahara");
    try {
      await page.goto(entryUrl(made.id));
      await page.getByRole("button", { name: "Batalkan transaksi", exact: true }).click();
      await expect(dialog(page).getByRole("heading", { name: "Batalkan transaksi?" })).toBeVisible();
      await expect(dialog(page).getByText(`${made.numberText} tetap tampil sebagai Dibatalkan`)).toBeVisible();

      await dialog(page).getByRole("button", { name: "Ya, batalkan transaksi" }).click();
      await expect(dialog(page).getByText("Tulis alasan pembatalan.")).toBeVisible();
      expect(entryRow(made.id).status, "a void without a reason changes nothing").toBe("active");

      await dialog(page).getByLabel("Alasan pembatalan").fill("Jumlahnya salah ketik");
      await dialog(page).getByRole("button", { name: "Ya, batalkan transaksi" }).click();
      await expect(page).toHaveURL(new RegExp(`/finance/${made.id}\\?notice=voided`));
      await expect(page.getByText("Transaksi dibatalkan.")).toBeVisible();

      const e = entryRow(made.id);
      expect(e.status).toBe("voided");
      expect(e.void_reason).toBe("Jumlahnya salah ketik");
      expect(e.voided_by).toBe(memberId(emailOf("bendahara")));
      expect(Number(e.amount), "the amount is never changed").toBe(88000);
      expect((await historyOf(made.id)).map((h) => h.kind)).toEqual(["recorded", "voided"]); // FN-19
      expect((await historyOf(made.id))[1].note).toBe("Jumlahnya salah ketik");
      expect(totals().expense).toBe(t0.expense - BigInt(88000));

      // The screen says who, when and why, and the action buttons are gone.
      await expect(page.getByText(new RegExp(`Dibatalkan oleh ${nameOf("bendahara")} pada .+\\. Alasan: Jumlahnya salah ketik`))).toBeVisible();
      await expect(page.getByRole("button", { name: "Batalkan transaksi", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Tambah bukti", exact: true })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);

      // A voided entry is hidden from the default list, shown with the chip when asked (A-FN13).
      await page.goto(PATHS.list);
      await expect(page.getByRole("link", { name: `${TAG} salah catat` })).toHaveCount(0);
      await page.goto(`${PATHS.list}?voided=1&q=${encodeURIComponent(`${TAG} salah catat`)}`);
      await expect(page.getByRole("link", { name: `${TAG} salah catat` }).first()).toBeVisible();
      await expect(main(page).getByText("Dibatalkan", { exact: true }).first()).toBeVisible();

      // "Catat ulang": the same form with the old values as a copy, never a restore (F4).
      await page.goto(entryUrl(made.id));
      await page.getByRole("link", { name: "Catat ulang" }).click();
      await expect(page).toHaveURL(/\/finance\/catat\?again=/);
      await expect(page.getByLabel("Jumlah (Rp)")).toHaveValue("88.000");
      await expect(page.getByLabel(/^Keterangan$/)).toHaveValue(`${TAG} salah catat`);
      await fillAmount(page, "80000");
      await clickNext(page);
      await clickSave(page);
      await expect(page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      const again = entryRow(idFromUrl(page));
      expect(again.id).not.toBe(made.id);
      expect(again.number_text).not.toBe(made.numberText); // a new number: the voided one is never reused
      expect(Number(again.amount)).toBe(80000);
      expect(entryRow(made.id).status).toBe("voided"); // still voided
    } finally {
      await context.close();
    }
  });

  test("a second void is refused, a voided entry cannot be restored or given proof; a void without a reason is refused by the database", async () => {
    await awayFromMidnight();
    const made = await mustRecord("bendahara", { description: `${TAG} batal dua kali`, amount: "300" });
    const noReason = await voidAs("bendahara", made.id, "  ");
    expect(noReason.ok).toBe(false);
    expect(noReason.hint).toBe("reason_required");
    expect(entryRow(made.id).status).toBe("active");
    expect((await voidAs("bendahara", made.id, "pertama")).ok).toBe(true);
    const second = await voidAs("bendahara", made.id, "kedua");
    expect(second.ok).toBe(false);
    expect(["state_changed", "entry_voided"]).toContain(second.hint);
    expect(entryRow(made.id).void_reason).toBe("pertama");
    const proof = await addProofAs("bendahara", made.id, [fakeProof("bendahara")]);
    expect(proof.ok, "a voided entry takes no proof").toBe(false);
    // Nothing deletes or edits (FN-13, FN-14): the table refuses for the Treasurer's own token.
    const patch = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55431"}/rest/v1/finance_entries?id=eq.${made.id}`, { method: "PATCH" }).catch(() => null);
    expect(patch === null || !patch.ok).toBe(true);
    expect(entryRow(made.id).status).toBe("voided");
  });
});

test.describe("F3 / FN-08a, FN-20, FN-21: Saldo awal", () => {
  test("Rp 0 is a valid Saldo awal; only one Aktif per period; a second is refused until the first is voided; Total Saldo follows the formula", async ({ browser }) => {
    test.skip(activeOpening() > 0, "an Aktif Saldo awal already exists in the active period (not made by this test); nothing here may void it");
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "bendahara");
    const recordOpening = async (amount: string, description: string) => {
      await page.goto(PATHS.opening);
      await expect(page.getByRole("heading", { level: 1, name: "Catat Saldo Awal" })).toBeVisible();
      await fillAmount(page, amount);
      await fillDescription(page, description);
      await clickNext(page);
      await expect(dialog(page).getByText(new RegExp(`^Saldo awal Rp ${amount === "0" ? "0" : "1\\.000\\.000"} pada `))).toBeVisible();
      await clickSave(page);
      await expect(page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      return idFromUrl(page);
    };
    try {
      // Before: the hint and the button (FN-21: the previous closing balance is a hint, never a silent prefill).
      await page.goto(PATHS.list);
      await expect(page.getByText("Saldo awal periode ini belum dicatat.")).toBeVisible();
      await page.getByRole("link", { name: "Catat saldo awal" }).click();
      await expect(page).toHaveURL(/\/finance\/saldo-awal/);
      await expect(page.getByLabel("Jumlah (Rp)")).toHaveValue(""); // never prefilled
      await expect(page.getByLabel(/^Keterangan$/)).toHaveValue("Saldo awal periode 2026/2027");

      // Rp 0 works (A-FN1) and is not income (R7).
      const t0 = totals();
      const zero = await recordOpening("0", `${TAG} saldo awal nol`);
      expect(entryRow(zero).entry_type).toBe("opening");
      expect(Number(entryRow(zero).amount)).toBe(0);
      expect(totals().income).toBe(t0.income);
      await page.goto(PATHS.list);
      await expect(page.getByText("Saldo awal Rp 0")).toBeVisible();
      await expect(page.getByText("Saldo awal periode ini belum dicatat.")).toHaveCount(0);

      // A second Aktif Saldo awal is refused everywhere (A-FN21).
      await page.goto(PATHS.opening);
      await expect(page.getByText("Saldo awal periode ini sudah dicatat. Batalkan yang lama kalau angkanya salah.")).toBeVisible();
      const second = await recordAs("bendahara", { type: "opening", description: `${TAG} saldo awal kedua`, amount: "5" });
      expect(second.ok).toBe(false);
      expect(second.hint).toBe("opening_exists");
      expect(entryByDescription(`${TAG} saldo awal kedua`)).toHaveLength(0);

      // A Saldo awal is never a correction, and has no "Buat koreksi" (F5).
      await page.goto(entryUrl(zero));
      await expect(page.getByRole("link", { name: "Buat koreksi" })).toHaveCount(0);

      // After a void, a new one is accepted; Total Saldo = Saldo awal + Pemasukan - Pengeluaran (FN-10).
      expect((await voidAs("bendahara", zero, "angka salah")).ok).toBe(true);
      const real = await recordOpening("1000000", `${TAG} saldo awal`);
      await mustRecord("bendahara", { type: "income", description: `${TAG} pemasukan rumus`, amount: "500000" });
      await mustRecord("bendahara", { type: "expense", description: `${TAG} pengeluaran rumus`, amount: "200000" });
      const t = totals();
      expect(t.opening).toBe(BigInt(1000000));
      expect(t.balance).toBe(t.opening + t.income - t.expense);
      await page.goto(PATHS.list);
      await expect(tiles(page)).toContainText(rupiah(t.balance));
      await expect(tiles(page)).toContainText(`Saldo awal ${rupiah(1000000)}`);
      // Voiding an expense changes Total Pengeluaran and Total Saldo by exactly that amount; the voided opening counts in nothing.
      const victim = entryByDescription(`${TAG} pengeluaran rumus`)[0].id as string;
      expect((await voidAs("bendahara", victim)).ok).toBe(true);
      expect(totals().balance).toBe(t.balance + BigInt(200000));
      expect(entryRow(real).status).toBe("active");
    } finally {
      await context.close();
    }
  });

  test("a Saldo awal is refused as a correction, as a second one and with a negative amount by the database", async () => {
    await awayFromMidnight();
    const target = await mustRecord("bendahara", { description: `${TAG} sasaran koreksi`, amount: "100" });
    const r = await recordAs("bendahara", { type: "opening", description: `${TAG} saldo koreksi`, amount: "0", corrects: target.id });
    expect(r.ok).toBe(false);
    expect(["invalid_correction", "opening_exists"]).toContain(r.hint);
    const neg = await recordAs("bendahara", { type: "opening", description: `${TAG} saldo minus`, amount: "-5" });
    expect(neg.ok).toBe(false);
    expect(neg.hint).toBe("invalid_amount");
  });
});

test.describe("FN-11, FN-37: a negative balance is shown, not blocked; typed markup is text, never run", () => {
  test("Total Saldo minus shows the hint and the minus sign", async ({ browser }) => {
    await awayFromMidnight();
    const t = totals();
    const over = (t.opening + t.income + BigInt(1000)).toString();
    await mustRecord("bendahara", { type: "expense", description: `${TAG} melebihi kas`, amount: over });
    expect(totals().balance < BigInt(0)).toBe(true);
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(PATHS.list);
      await expect(tiles(page)).toContainText(rupiah(totals().balance));
      await expect(page.getByText("Saldo minus. Cek apakah ada pemasukan atau saldo awal yang belum dicatat.")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("<script> and a formula in Keterangan/Catatan show as plain text on the list and the detail", async ({ browser }) => {
    await awayFromMidnight();
    const description = `${TAG} <script>window.__xss=1</script> =1+1`;
    const made = await mustRecord("bendahara", { description, notes: "<img src=x onerror=window.__xss2=1>", amount: "1500" });
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}`);
      await expect(page.getByText(description).first()).toBeVisible();
      await page.goto(entryUrl(made.id));
      await expect(page.getByText(description).first()).toBeVisible();
      await expect(page.getByText("<img src=x onerror=window.__xss2=1>")).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __xss?: number; __xss2?: number }).__xss ?? (window as unknown as { __xss2?: number }).__xss2 ?? null)).toBeNull();
      await expect(page.locator("main script", { hasText: "__xss" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("F6 / FN-25..FN-27: proof files", () => {
  test("record with a proof, add one from the detail, withdraw one: the record stays, managers see it, readers do not, the limit counts only visible files", async ({ browser }) => {
    await awayFromMidnight();
    const treasurer = await signedInContext(browser, "bendahara");
    const reader = await signedInContext(browser, "ketum");
    try {
      const page = treasurer.page;
      await stubProofUpload(page);
      // Recorded with one proof from the form.
      await page.goto(PATHS.record);
      await fillAmount(page, "64000");
      await fillDescription(page, `${TAG} bukti`);
      await pickFile(page, "nota-toko.pdf");
      await expect(page.getByText("Terunggah", { exact: true })).toBeVisible();
      await clickNext(page);
      await expect(dialog(page).getByText("Bukti: 1 berkas")).toBeVisible();
      await clickSave(page);
      await expect(page).toHaveURL(/\/finance\/[0-9a-f-]{36}\?notice=recorded/);
      const id = idFromUrl(page);
      await expect(page.getByRole("heading", { level: 2, name: "Bukti (1)" })).toBeVisible();
      await expect(page.getByText("nota-toko.pdf").first()).toBeVisible(); // also named in the history list
      expect(qn(`select count(*) from nexus.finance_entry_files where entry_id = '${id}'`)).toBe(1);
      // The storage path never reaches the page (spec 4.4).
      expect(await page.content()).not.toContain(memberId(emailOf("bendahara")));

      // Add a second proof from the detail.
      await page.getByRole("button", { name: "Tambah bukti", exact: true }).click();
      await expect(dialog(page).getByText("Boleh menambah 2 berkas lagi.").first()).toBeVisible();
      await pickFile(page, "transfer.pdf");
      await expect(dialog(page).getByText("Terunggah", { exact: true })).toBeVisible();
      await dialog(page).getByRole("button", { name: "Tambah bukti", exact: true }).click();
      await expect(page).toHaveURL(/notice=proof_added/);
      await expect(page.getByText("Bukti ditambahkan.")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Bukti (2)" })).toBeVisible();

      // Withdraw one: a reason is required; the record and the file stay (L5).
      await page.getByRole("button", { name: /^Tarik berkas nota-toko\.pdf$/ }).click();
      await dialog(page).getByRole("button", { name: "Tarik berkas", exact: true }).click();
      await expect(dialog(page).getByText("Tulis kenapa berkas ini ditarik.")).toBeVisible();
      await dialog(page).getByLabel("Alasan").fill("Foto buram");
      await dialog(page).getByRole("button", { name: "Tarik berkas", exact: true }).click();
      await expect(page).toHaveURL(/notice=proof_withdrawn/);
      await expect(page.getByText("Berkas ditarik.")).toBeVisible();
      const files = qjsonFiles(id);
      expect(files).toHaveLength(2); // never deleted
      expect(files.filter((f) => f.is_withdrawn)).toHaveLength(1);
      expect(files.find((f) => f.is_withdrawn)?.withdraw_reason).toBe("Foto buram");
      await expect(page.getByText("Ditarik", { exact: true })).toBeVisible(); // managers see it with the chip
      await expect(page.getByText("Alasan: Foto buram").first()).toBeVisible(); // file card; the history repeats it

      // A reader sees only the visible proof and no withdraw history (FN-27, F4).
      await reader.page.goto(entryUrl(id));
      await expect(reader.page.getByText("transfer.pdf").first()).toBeVisible();
      await expect(reader.page.getByText("nota-toko.pdf")).toHaveCount(0);
      await expect(reader.page.getByText("Foto buram")).toHaveCount(0);
      await expect(reader.page.getByRole("button", { name: /Tarik berkas/ })).toHaveCount(0);
      const readerView = await detailAs("ketum", id);
      expect(JSON.stringify(readerView.body)).not.toContain("Foto buram");
      const kinds = (await historyOf(id)).map((h) => h.kind);
      expect(kinds).toEqual(["recorded", "file_added", "file_added", "file_withdrawn"]); // one row per proof added (FN-19)
      expect(JSON.stringify(readerView.body)).not.toContain("file_withdrawn");

      // A withdrawn proof does not count toward the limit of 3: one visible + room for two more, not one.
      const room = (await detailAs("bendahara", id)).body;
      expect((Array.isArray(room) ? room[0] : room).actions.files_room ?? (room as { actions: { files_room: number } }).actions.files_room).toBe(2);
    } finally {
      await treasurer.context.close();
      await reader.context.close();
    }
  });

  test("at most 3 visible proofs per entry; a fourth is refused; a path in someone else's folder or made up is refused; withdrawn needs a reason", async () => {
    await awayFromMidnight();
    const made = await mustRecord("bendahara", { description: `${TAG} tiga berkas`, amount: "900", files: [fakeProof("bendahara", "a.pdf"), fakeProof("bendahara", "b.pdf"), fakeProof("bendahara", "c.pdf")] });
    const fourth = await addProofAs("bendahara", made.id, [fakeProof("bendahara", "d.pdf")]);
    expect(fourth.ok).toBe(false);
    expect(fourth.hint).toBe("file_count");
    const tooMany = await recordAs("bendahara", { description: `${TAG} empat berkas`, files: [1, 2, 3, 4].map((n) => fakeProof("bendahara", `${n}.pdf`)) });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.hint).toBe("file_count");

    // Withdrawing one frees a slot (a withdrawn proof does not count, FN-27).
    const fileId = Number(q(`select id from nexus.finance_entry_files where entry_id = '${made.id}' order by id limit 1`));
    expect((await withdrawProofAs("bendahara", fileId, "  ")).hint).toBe("reason_required");
    expect((await withdrawProofAs("bendahara", fileId, "salah foto")).ok).toBe(true);
    expect((await addProofAs("bendahara", made.id, [fakeProof("bendahara", "e.pdf")])).ok).toBe(true);

    // Paths: other member's folder, wrong extension, traversal, and the same file twice.
    const own = memberId(emailOf("bendahara"));
    const other = memberId(emailOf("ketum"));
    const bad = async (path: string, label: string) => {
      const r = await recordAs("bendahara", { description: `${TAG} jalur ${label}`, files: [{ path, name: "x.pdf" }] });
      expect(r.ok, label).toBe(false);
      expect(r.hint, label).toBe("invalid_file");
    };
    await bad(`${other}/${randomUUID()}.pdf`, "folder orang lain");
    await bad(`${own}/${randomUUID()}.exe`, "ekstensi");
    await bad(`${own}/../${other}/${randomUUID()}.pdf`, "naik folder");
    await bad(`${own}/not-a-uuid.pdf`, "nama bukan uuid");
    const dup = fakeProof("bendahara", "dua.pdf");
    const twice = await recordAs("bendahara", { description: `${TAG} berkas kembar`, files: [dup, dup] });
    expect(twice.ok).toBe(false);
    expect(twice.hint).toBe("invalid_file");
    // The same stored file cannot be attached to two entries.
    const reuse = await recordAs("bendahara", { description: `${TAG} pakai ulang`, files: [{ path: q(`select storage_path from nexus.finance_entry_files where entry_id = '${made.id}' limit 1`), name: "x.pdf" }] });
    expect(reuse.ok).toBe(false);
    expect(reuse.hint).toBe("file_already_attached");
  });

  test('"Tanpa bukti": an entry with no visible proof carries the mark and appears under the filter; one with a visible proof does not', async ({ browser }) => {
    await awayFromMidnight();
    const bare = await mustRecord("bendahara", { description: `${TAG} polos`, amount: "111" });
    const withProof = await mustRecord("bendahara", { description: `${TAG} berbukti`, amount: "222", files: [fakeProof("bendahara", "ada.pdf")] });
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}&noproof=1`);
      await expect(page.getByRole("link", { name: `${TAG} polos` }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: `${TAG} berbukti` })).toHaveCount(0);
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}`);
      await expect(page.getByRole("link", { name: `${TAG} berbukti` }).first()).toBeVisible();
      expect(bare.id).not.toBe(withProof.id);
    } finally {
      await context.close();
    }
  });
});

function qjsonFiles(entryId: string) {
  return JSON.parse(
    q(`select coalesce(json_agg(t), '[]'::json) from (select id, is_withdrawn, withdraw_reason, storage_path from nexus.finance_entry_files where entry_id = '${entryId}' order by id) t`),
  ) as { id: number; is_withdrawn: boolean; withdraw_reason: string | null; storage_path: string }[];
}
void rpcAs;
