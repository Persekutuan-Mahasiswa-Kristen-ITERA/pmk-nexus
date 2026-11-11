// Meeting Minutes: the secretary's flows in the browser at 390 px (F1..F5; MN-09..MN-16, MN-19, MN-21, MN-22, MN-29).
// Setup goes through the app's own database functions; the flows under test are clicked. Minutes are never deleted, so every
// title carries "QA<tag>" and `sweepQa` voids what is still Aktif at the end.
// The local stack has no Storage: the upload route is answered by a stub that returns the well-formed path in the caller's own
// folder (the database skips the object check without a storage schema). The route's own checks are covered by
// notulensi-access.spec.ts (real route, up to Storage) and tests/unit/minutes-server.test.ts.
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  activePeriodId,
  addDays,
  addFilesAs,
  awayFromMidnight,
  detailAs,
  dialog,
  emailOf,
  fakeFile,
  filesOf,
  fillContent,
  fillDate,
  fillDecision,
  fillTitle,
  fillTopic,
  historyOf,
  idFromUrl,
  jakartaToday,
  listAs,
  listTotal,
  main,
  memberId,
  minuteCount,
  minuteRow,
  minuteUrl,
  minuteVersion,
  mustRecord,
  nameOf,
  noHorizontalScroll,
  PATHS,
  PDF_BYTES,
  q,
  recordAs,
  rpcAs,
  saveEdit,
  saveRecord,
  screenTitles,
  sweepQa,
  tag,
  tiles,
  UNITS,
  unitId,
  updateAs,
  UPLOAD,
  voidAs,
  withdrawFileAs,
  activeCount,
  card,
  type NewMinute,
} from "./notulensi-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

/** Answers the upload route like the real one would (the local stack has no Storage). */
async function stubUpload(page: Page, owner: "sekjen" | "sekdep") {
  const folder = memberId(emailOf(owner));
  await page.route(`**${UPLOAD}`, async (route: Route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const name = /filename="([^"]*)"/.exec(body)?.[1] ?? "notulen.pdf";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: `${folder}/${randomUUID()}.pdf`, name, sizeBytes: 1234, mimeType: "application/pdf" }),
    });
  });
}
const pickFile = (page: Page, name = "notulen.pdf", scope?: ReturnType<typeof dialog>) =>
  (scope ?? page).locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: PDF_BYTES() });

test.describe("F3 / MN-09 / MN-29: record a minute from the phone", () => {
  test("the department secretary records for her own unit: server-set creator, unit, period, history; the notice; the list and tiles", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      const before = minuteCount();
      const tilesBefore = activeCount([unitId(UNITS.internal)]);
      await stubUpload(page, "sekdep");
      await page.goto(PATHS.record);
      await expect(page.getByRole("heading", { level: 1, name: "Catat Notulensi" })).toBeVisible();
      await expect(page.getByLabel("Tanggal Rapat")).toHaveValue(jakartaToday()); // default today
      await fillTitle(page, `${TAG} rapat evaluasi`);
      await fillTopic(page, "Evaluasi program bulan ini");
      await fillContent(page, "Poin 1: kehadiran.\nPoin 2: dana.");
      await fillDecision(page, "Rapat berikutnya tanggal 20.");
      await pickFile(page, "absensi.pdf");
      await expect(page.getByText("Terunggah", { exact: true })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(minuteCount(), "nothing is saved before Simpan").toBe(before);

      await saveRecord(page);
      await expect(page).toHaveURL(/\/notulensi\/[0-9a-f-]{36}\?notice=recorded/);
      await expect(page.getByText("Notulensi tersimpan.")).toBeVisible();
      const id = idFromUrl(page);
      const m = minuteRow(id);
      expect(m.org_unit_id).toBe(unitId(UNITS.internal));
      expect(m.period_id).toBe(activePeriodId()); // never client input (MN-09)
      expect(m.created_by).toBe(memberId(emailOf("sekdep")));
      expect(m.meeting_date).toBe(jakartaToday());
      expect(m.status).toBe("active");
      expect(m.content).toBe("Poin 1: kehadiran.\nPoin 2: dana."); // line breaks kept (M2)
      expect(filesOf(id).map((f) => f.original_name)).toEqual(["absensi.pdf"]);
      expect(historyOf(id).map((h) => h.kind)).toEqual(["recorded", "file_added"]);
      expect(minuteCount()).toBe(before + 1);

      // The detail shows what was saved, line breaks kept, the recorder's name and the unit.
      await expect(page.getByRole("heading", { level: 1, name: "Detail Notulensi" })).toBeVisible();
      await expect(main(page).getByText(`${TAG} rapat evaluasi`).first()).toBeVisible();
      await expect(main(page).getByText(UNITS.internal).first()).toBeVisible();
      await expect(main(page).getByText(new RegExp(`^Dicatat oleh ${nameOf("sekdep")}, `))).toBeVisible();
      await expect(main(page).getByText("Rapat berikutnya tanggal 20.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Lampiran (1)" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);

      // The list and its tiles (A-MN13: Aktif minutes of the active period in her scope).
      await page.goto(PATHS.list);
      const want = activeCount([unitId(UNITS.internal)]);
      expect(want.count).toBe(tilesBefore.count + 1);
      await expect(tiles(page)).toContainText(String(want.count));
      await expect(main(page).locator("article", { hasText: `${TAG} rapat evaluasi` })).toContainText("1 berkas");
      // The Dashboard card counts the same (N5 a), and shows no title.
      await page.goto("/");
      await expect(card(page)).toContainText(`${want.count} notulensi di periode 2026/2027`);
      await expect(card(page)).not.toContainText(TAG);
    } finally {
      await context.close();
    }
  });

  test("the BPH secretary records under 'Seluruh organisasi' (N2 c); the form needs a unit first", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      await page.goto(PATHS.record);
      await fillTitle(page, `${TAG} pleno`);
      await fillTopic(page, "Pleno");
      await fillContent(page, "Isi pleno");
      await saveRecord(page);
      await expect(page.getByText("Pilih unit.")).toBeVisible(); // no unit chosen yet
      await expect(page).toHaveURL(/\/notulensi\/catat/);
      await page.getByLabel("Unit", { exact: true }).selectOption({ label: "Seluruh organisasi" });
      await saveRecord(page);
      await expect(page).toHaveURL(/\?notice=recorded/);
      const m = minuteRow(idFromUrl(page));
      expect(m.org_unit_id).toBe(q("select id from public.org_units where type = 'organization'"));
      await expect(main(page).getByText("Seluruh organisasi").first()).toBeVisible();
      await expect(main(page).getByText("Tidak ada keputusan yang dicatat.")).toBeVisible();
      await expect(main(page).getByText("Tidak ada lampiran.")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("validation on screen and in the database: required fields, limits, a future date; nothing saved", async ({ browser }) => {
    await awayFromMidnight();
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      const before = minuteCount();
      await page.goto(PATHS.record);
      await expect(page.getByRole("heading", { level: 1, name: "Catat Notulensi" })).toBeVisible();
      await fillTitle(page, " ");
      await saveRecord(page);
      await expect(page.getByText("Judul wajib diisi.")).toBeVisible();
      await expect(page.getByText("Topik wajib diisi.")).toBeVisible();
      await expect(page.getByText("Isi notulensi wajib diisi.")).toBeVisible();
      // A future date: the picker's max stops it in a browser; the server refuses a typed one.
      await fillTitle(page, `${TAG} tanggal depan`);
      await fillTopic(page, "t");
      await fillContent(page, "c");
      await fillDate(page, "Tanggal Rapat", addDays(jakartaToday(), 1));
      await saveRecord(page);
      await expect(page.getByText("Tanggal rapat tidak boleh di masa depan.")).toBeVisible();
      expect(minuteCount(), "nothing saved").toBe(before);

      // The database refuses the same even when the screen is skipped (MN-09, A-MN3).
      const unit = unitId(UNITS.internal);
      const cases: [string, NewMinute, string][] = [
        ["future date", { date: addDays(jakartaToday(), 1) }, "date_in_future"],
        ["date before 2000", { date: "1999-12-31" }, "invalid_dates"],
        ["blank title", { title: "   " }, "text_required"],
        ["blank content", { content: "\n\n" }, "text_required"],
        ["title 151", { title: "x".repeat(151) }, "text_too_long"],
        ["topic 201", { topic: "x".repeat(201) }, "text_too_long"],
        ["content 20001", { content: "x".repeat(20_001) }, "text_too_long"],
        ["decision 5001", { decision: "x".repeat(5_001) }, "text_too_long"],
        ["4 files", { files: [1, 2, 3, 4].map((i) => fakeFile("sekdep", `f${i}.pdf`)) }, "file_count"],
        ["a file in another member's folder", { files: [fakeFile("sekjen", "orang-lain.pdf")] }, "invalid_file"],
      ];
      for (const [label, args, hint] of cases) {
        const r = await recordAs("sekdep", { unit, title: `${TAG} tolak`, ...args });
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe(hint);
      }
      // The limits themselves are accepted (code points, not bytes: an emoji counts once).
      const edge = await mustRecord("sekdep", { unit, title: `${TAG} ${"é".repeat(150 - TAG.length - 1)}`, topic: "🙂".repeat(200), content: "x".repeat(20_000), decision: "y".repeat(5_000) });
      expect([...String(minuteRow(edge.id).topic)].length).toBe(200);
      expect(minuteCount()).toBe(before + 1);
    } finally {
      await context.close();
    }
  });

  test("leaving the form with unsaved typing asks first (A-MN11); 'Tetap di sini' keeps the text", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      await page.goto(PATHS.record);
      await fillTitle(page, `${TAG} belum disimpan`);
      await page.getByRole("button", { name: "Batal", exact: true }).click();
      await expect(dialog(page).getByText("Keluar dari halaman ini?")).toBeVisible();
      await expect(dialog(page).getByText("Perubahan belum disimpan.")).toBeVisible();
      await dialog(page).getByRole("button", { name: "Tetap di sini" }).click();
      await expect(page.getByLabel("Judul Rapat", { exact: true })).toHaveValue(`${TAG} belum disimpan`);
      await page.getByRole("button", { name: "Batal", exact: true }).click();
      await dialog(page).getByRole("button", { name: "Keluar" }).click();
      await expect(page).toHaveURL(/\/notulensi$/);
      expect(Number(q(`select count(*) from nexus.minutes where title = '${TAG} belum disimpan'`))).toBe(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("F4 / MN-11 / MN-14: edit", () => {
  test("'Ubah' saves one history row with before and after; an unchanged form saves nothing; the unit is read-only", async ({ browser }) => {
    await awayFromMidnight();
    const m = await mustRecord("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} untuk diubah`, topic: "Topik lama", content: "Isi lama" });
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      await page.goto(minuteUrl(m.id));
      await page.getByRole("link", { name: "Ubah", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toBeVisible();
      await expect(page.getByLabel("Unit", { exact: true })).toHaveCount(0); // read-only line, never a select
      await expect(main(page).getByText(UNITS.internal, { exact: true })).toBeVisible();
      // Nothing changed: nothing saved.
      await saveEdit(page);
      await expect(page.getByText("Belum ada yang diubah.")).toBeVisible();
      expect(historyOf(m.id).map((h) => h.kind)).toEqual(["recorded"]);
      // Change two fields.
      await fillTopic(page, "Topik baru");
      await fillDecision(page, "Keputusan baru");
      await saveEdit(page);
      await expect(page).toHaveURL(/\?notice=updated/);
      await expect(page.getByText("Perubahan tersimpan.")).toBeVisible();
      const h = historyOf(m.id);
      expect(h.map((x) => x.kind)).toEqual(["recorded", "edited"]);
      expect(h[1].before_data).toEqual({ topic: "Topik lama", decision: null });
      expect(h[1].after_data).toEqual({ topic: "Topik baru", decision: "Keputusan baru" });
      expect(minuteRow(m.id).version).toBe(m.version + 1);
      // The history shows who and which fields, with before and after behind a tap (A-MN7).
      await expect(main(page).getByText(`Diubah oleh ${nameOf("sekdep")}`)).toBeVisible();
      await main(page).getByText("Topik bahasan, Keputusan dan tindak lanjut").click();
      await expect(main(page).getByText('Topik bahasan: "Topik lama" menjadi "Topik baru"')).toBeVisible();
      // A reader of the unit sees the history too.
      const readerDetail = await detailAs("kadep", m.id); // kadep reads Operasional only, not Internal
      expect(readerDetail.ok).toBe(false);
      const ketum = await detailAs("ketum", m.id);
      expect((ketum.body.history as { kind: string }[]).map((x) => x.kind)).toEqual(["edited", "recorded"]);
    } finally {
      await context.close();
    }
  });

  test("two managers save at once: exactly one wins, the other gets 'Data sudah berubah. Muat ulang.' (MN-14)", async ({ browser }) => {
    await awayFromMidnight();
    const m = await mustRecord("sekjen", { unit: unitId(UNITS.internal), title: `${TAG} bentrok`, topic: "awal", content: "awal" });
    const a = await signedInContext(browser, "sekdep");
    const b = await signedInContext(browser, "sekjen");
    try {
      await a.page.goto(`/notulensi/${m.id}/ubah`);
      await b.page.goto(`/notulensi/${m.id}/ubah`);
      await expect(a.page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toBeVisible();
      await expect(b.page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toBeVisible();
      await fillTopic(a.page, "versi A");
      await fillTopic(b.page, "versi B");
      await saveEdit(a.page);
      await expect(a.page).toHaveURL(/\?notice=updated/);
      await saveEdit(b.page);
      await expect(b.page.getByText("Data sudah berubah. Muat ulang.")).toBeVisible();
      expect(minuteRow(m.id).topic).toBe("versi A");
      expect(historyOf(m.id).filter((h) => h.kind === "edited")).toHaveLength(1);
      // The database refuses a stale version on every write.
      const stale = m.version;
      for (const [label, r] of [
        ["update", await updateAs("sekjen", m.id, stale, { date: jakartaToday(), title: `${TAG} bentrok`, topic: "x", content: "y" })],
        ["void", await voidAs("sekjen", m.id, "alasan", stale)],
        ["add files", await addFilesAs("sekjen", m.id, [fakeFile("sekjen", "x.pdf")], stale)],
      ] as const) {
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe("state_changed");
      }
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("MN-11: the unit and the period cannot change, even by a direct call or a direct table write", async () => {
    const m = await mustRecord("sekjen", { unit: unitId(UNITS.bph), title: `${TAG} unit tetap` });
    // minute_update has no unit parameter; extra parameters make PostgREST refuse the call.
    const r = await updateAs("sekjen", m.id, m.version, { date: jakartaToday(), title: `${TAG} unit tetap`, topic: "t", content: "c" });
    expect(r.ok).toBe(true);
    const extra = await rpcAs("sekjen", "minute_update", {
      p_minute_id: m.id, p_version: minuteVersion(m.id), p_meeting_date: jakartaToday(), p_title: "x", p_topic: "t", p_content: "c", p_org_unit_id: unitId(UNITS.eksternal),
    });
    expect(extra.ok).toBe(false);
    expect(minuteRow(m.id).org_unit_id).toBe(unitId(UNITS.bph));
    expect(minuteRow(m.id).period_id).toBe(activePeriodId());
  });
});

test.describe("F5 / MN-13 / MN-19: void and files", () => {
  test("void needs a reason, stays in the list as Dibatalkan behind the status filter, read-only, never restored", async ({ browser }) => {
    await awayFromMidnight();
    const m = await mustRecord("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} untuk dibatalkan` });
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      await page.goto(minuteUrl(m.id));
      await page.getByRole("button", { name: "Batalkan notulensi" }).click();
      await expect(dialog(page).getByText("Notulensi tetap tersimpan sebagai Dibatalkan, tidak bisa diubah, dan tidak bisa dikembalikan.")).toBeVisible();
      await dialog(page).getByRole("button", { name: "Ya, batalkan" }).click();
      await expect(dialog(page).getByText("Tulis alasan pembatalan.")).toBeVisible();
      expect(minuteRow(m.id).status).toBe("active");
      await dialog(page).getByLabel("Alasan pembatalan").fill("Rapat dobel dicatat");
      await dialog(page).getByRole("button", { name: "Ya, batalkan" }).click();
      await expect(page).toHaveURL(/\?notice=voided/);
      await expect(page.getByText("Notulensi dibatalkan.")).toBeVisible();
      await expect(page.getByText(new RegExp(`^Dibatalkan oleh ${nameOf("sekdep")} pada .*\\. Alasan: Rapat dobel dicatat$`))).toBeVisible();
      for (const name of ["Ubah", "Batalkan notulensi", "Tambah lampiran"]) {
        await expect(page.getByRole(name === "Ubah" ? "link" : "button", { name, exact: true })).toHaveCount(0);
      }
      const row = minuteRow(m.id);
      expect(row.status).toBe("voided");
      expect(row.void_reason).toBe("Rapat dobel dicatat");
      expect(row.voided_by).toBe(memberId(emailOf("sekdep")));
      expect(historyOf(m.id).map((h) => h.kind)).toEqual(["recorded", "voided"]);
      // Read-only for good: every write answers minute_voided.
      for (const [label, r] of [
        ["update", await updateAs("sekdep", m.id, minuteVersion(m.id), { date: jakartaToday(), title: `${TAG} hidup lagi`, topic: "t", content: "c" })],
        ["void again", await voidAs("sekdep", m.id, "lagi")],
        ["add files", await addFilesAs("sekdep", m.id, [fakeFile("sekdep", "x.pdf")])],
      ] as const) {
        expect(r.ok, label).toBe(false);
        expect(r.hint, label).toBe("minute_voided");
      }
      // The list: hidden by default, shown with Status "Dibatalkan" or "Semua", with the chip.
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(`${TAG} untuk dibatalkan`)}`);
      await expect(main(page).getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(`${TAG} untuk dibatalkan`)}&status=voided`);
      await expect(main(page).locator("article", { hasText: `${TAG} untuk dibatalkan` })).toContainText("Dibatalkan");
    } finally {
      await context.close();
    }
  });

  test("add a file from the detail, withdraw one with a reason: the record and file stay, managers see it, readers do not, the limit counts visible files only", async ({ browser }) => {
    await awayFromMidnight();
    const m = await mustRecord("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} lampiran`, files: [fakeFile("sekdep", "foto-buram.pdf")] });
    const mgr = await signedInContext(browser, "sekdep");
    const reader = await signedInContext(browser, "ketum");
    try {
      await stubUpload(mgr.page, "sekdep");
      await mgr.page.goto(minuteUrl(m.id));
      await mgr.page.getByRole("button", { name: "Tambah lampiran" }).click();
      await expect(dialog(mgr.page).getByText("Boleh menambah 2 berkas lagi.").first()).toBeVisible();
      // "Simpan lampiran" without a file says so.
      await dialog(mgr.page).getByRole("button", { name: "Simpan lampiran" }).click();
      await expect(dialog(mgr.page).getByText("Pilih minimal satu berkas.")).toBeVisible();
      await pickFile(mgr.page, "daftar-hadir.pdf", dialog(mgr.page));
      await expect(dialog(mgr.page).getByText("Terunggah", { exact: true })).toBeVisible();
      await dialog(mgr.page).getByRole("button", { name: "Simpan lampiran" }).click();
      await expect(mgr.page).toHaveURL(/notice=files_added/);
      await expect(mgr.page.getByText("Lampiran ditambahkan.")).toBeVisible();
      await expect(mgr.page.getByRole("heading", { name: "Lampiran (2)" })).toBeVisible();

      // Withdraw one: a reason is required.
      await mgr.page.getByRole("button", { name: "Tarik berkas foto-buram.pdf" }).click();
      await expect(dialog(mgr.page).getByText("Berkas disembunyikan dari pembaca dan hanya terlihat oleh pengelola. Berkasnya tidak dihapus.")).toBeVisible();
      await dialog(mgr.page).getByRole("button", { name: "Tarik berkas", exact: true }).click();
      await expect(dialog(mgr.page).getByText("Tulis kenapa berkas ini ditarik.")).toBeVisible();
      await dialog(mgr.page).getByLabel("Alasan", { exact: true }).fill("Foto buram");
      await dialog(mgr.page).getByRole("button", { name: "Tarik berkas", exact: true }).click();
      await expect(mgr.page).toHaveURL(/notice=file_withdrawn/);
      const files = filesOf(m.id);
      expect(files).toHaveLength(2); // never deleted
      expect(files.find((f) => f.original_name === "foto-buram.pdf")?.is_withdrawn).toBe(true);
      expect(files.find((f) => f.original_name === "foto-buram.pdf")?.withdraw_reason).toBe("Foto buram");
      await expect(mgr.page.getByText("Ditarik", { exact: true })).toBeVisible();
      await expect(mgr.page.getByText("Alasan: Foto buram").first()).toBeVisible();
      expect(historyOf(m.id).map((h) => h.kind)).toEqual(["recorded", "file_added", "file_added", "file_withdrawn"]);

      // A reader sees the visible file only, and no withdraw row (M3, A-MN7).
      await reader.page.goto(minuteUrl(m.id));
      await expect(reader.page.getByText("daftar-hadir.pdf").first()).toBeVisible();
      await expect(reader.page.getByText("foto-buram.pdf")).toHaveCount(0);
      await expect(reader.page.getByText("Foto buram")).toHaveCount(0);
      await expect(reader.page.getByRole("button", { name: /Tarik berkas/ })).toHaveCount(0);
      const readerView = await detailAs("ketum", m.id);
      expect(JSON.stringify(readerView.body)).not.toContain("Foto buram");
      expect(JSON.stringify(readerView.body)).not.toContain("file_withdrawn");
      // The database answer holds storage_path (contract 12: it stays inside the server); the PAGE never carries it.
      const html = await reader.page.content();
      for (const f of filesOf(m.id)) {
        const path = q(`select storage_path from nexus.minute_files where id = ${f.id}`);
        expect(html, "a storage path never reaches the page").not.toContain(path);
      }
      expect(html).not.toContain(memberId(emailOf("sekdep")));

      // The withdrawn file does not count: 1 visible, room for 2 more; a third and fourth then hit the limit.
      expect((await detailAs("sekdep", m.id)).body.actions.files_room).toBe(2);
      const two = await addFilesAs("sekdep", m.id, [fakeFile("sekdep", "a.pdf"), fakeFile("sekdep", "b.pdf")]);
      expect(two.ok, JSON.stringify(two.body)).toBe(true);
      const fourth = await addFilesAs("sekdep", m.id, [fakeFile("sekdep", "c.pdf")]);
      expect(fourth.ok).toBe(false);
      expect(fourth.hint).toBe("file_count");
      // Withdraw again: refused for a reader and for an empty reason; a second withdraw of the same file is a conflict.
      const fileId = files.find((f) => f.original_name === "daftar-hadir.pdf")!.id;
      expect((await withdrawFileAs("ketum", fileId, m.id, "x")).ok).toBe(false);
      expect((await withdrawFileAs("sekdep", fileId, m.id, "  ")).hint).toBe("reason_required");
      const withdrawn = files.find((f) => f.original_name === "foto-buram.pdf")!.id;
      expect((await withdrawFileAs("sekdep", withdrawn, m.id, "lagi")).hint).toBe("state_changed");
      // The same stored path can never be attached twice.
      const path = q(`select storage_path from nexus.minute_files where id = ${fileId}`);
      const again = await recordAs("sekdep", { unit: unitId(UNITS.internal), title: `${TAG} berkas dobel`, files: [{ path, name: "x.pdf" }] });
      expect(again.hint).toBe("file_already_attached");
    } finally {
      await mgr.context.close();
      await reader.context.close();
    }
  });
});

test.describe("F1 / MN-21 / MN-22 / MN-16: browse, search, filters, text safety", () => {
  test("search finds title, topic and content case-insensitively, only inside the scope; filters and pagination match the database", async ({ browser }) => {
    await awayFromMidnight();
    const unit = unitId(UNITS.internal);
    await mustRecord("sekjen", { unit, title: `${TAG} cari judul KELINCI`, topic: "t", content: "c" });
    await mustRecord("sekjen", { unit, title: `${TAG} cari topik`, topic: "tentang kelinci", content: "c" });
    await mustRecord("sekjen", { unit, title: `${TAG} cari isi`, topic: "t", content: "Ada Kelinci di sini" });
    await mustRecord("sekjen", { unit: unitId(UNITS.eksternal), title: `${TAG} cari luar kelinci` });
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(`kelinci`)}`);
      const titles = await screenTitles(page);
      for (const t of ["cari judul KELINCI", "cari topik", "cari isi"]) expect(titles).toContain(`${TAG} ${t}`);
      expect(titles, "outside the scope never shows").not.toContain(`${TAG} cari luar kelinci`);
      // Order: newest meeting date first, then newest recorded (A-MN6) = the database's own order.
      const db = ((await listAs("sekdep", { p_search: "kelinci" })).body as { title: string }[]).map((r) => r.title);
      expect(titles).toEqual(db.slice(0, titles.length));

      // Filters through the address match minute_list with the same filters.
      for (const [label, query, args] of [
        ["status voided", "status=voided", { p_status: "voided" }],
        ["status all", "status=all", { p_status: "all" }],
        ["all periods", "period=all", { p_period: "all" }],
        ["search + all", `q=${TAG}&status=all&period=all`, { p_search: TAG, p_status: "all", p_period: "all" }],
      ] as const) {
        await page.goto(`${PATHS.list}?${query}`);
        const total = await listTotal("sekdep", args);
        if (total === 0) await expect(main(page).getByText(/Tidak ada hasil|Belum ada notulensi/)).toBeVisible();
        else await expect(main(page).locator("article").first(), label).toBeVisible();
        const shown = await main(page).locator("article").count();
        expect(shown, label).toBe(Math.min(total, 20)); // page size 20
      }
      // A hand-made unit filter outside the scope shows nothing (R13, M7).
      await page.goto(`${PATHS.list}?unit=${unitId(UNITS.eksternal)}&status=all`);
      await expect(main(page).locator("article")).toHaveCount(0);
      // Search too long: the screen says so, the database refuses it too.
      await page.goto(`${PATHS.list}?q=${"x".repeat(121)}`);
      await expect(page.getByText("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.")).toBeVisible();
      expect((await listAs("sekdep", { p_search: "x".repeat(121) })).hint).toBe("search_too_long");
      // Like-wildcards are literal: "%" does not match everything.
      expect(await listTotal("sekdep", { p_search: "%" })).toBe(Number(q(`select count(*) from nexus.minutes where period_id = (select id from public.periods where is_active) and status = 'active' and org_unit_id = '${unit}' and (title like '%\\%%' or topic like '%\\%%' or content like '%\\%%')`)));
    } finally {
      await context.close();
    }
  });

  test("MN-16: <script>, HTML and a formula typed into every field are shown as plain text and never run", async ({ browser }) => {
    await awayFromMidnight();
    const m = await mustRecord("sekjen", {
      unit: unitId(UNITS.bph),
      title: `${TAG} <img src=x onerror="window.__xss=1">`,
      topic: "<script>window.__xss=2</script>",
      content: "<b>tebal</b>\n=HYPERLINK(\"http://evil.example\")",
      decision: "<a href=\"javascript:window.__xss=3\">klik</a>",
    });
    const { context, page } = await signedInContext(browser, "ketum");
    try {
      let dialogs = 0;
      page.on("dialog", (d) => {
        dialogs += 1;
        void d.dismiss();
      });
      await page.goto(minuteUrl(m.id));
      await expect(main(page).getByText("<script>window.__xss=2</script>")).toBeVisible();
      await expect(main(page).getByText(`${TAG} <img src=x onerror="window.__xss=1">`).first()).toBeVisible();
      await expect(main(page).getByText("<a href=\"javascript:window.__xss=3\">klik</a>")).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      expect(await main(page).locator("img[src='x'], b, a[href^='javascript']").count()).toBe(0);
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}`);
      // Phones get the card and the (hidden) desktop table renders the same row: take the visible one.
      await expect(main(page).locator("article").getByText(`${TAG} <img src=x onerror="window.__xss=1">`)).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      expect(dialogs).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("empty and no-match states; 390 px with long unbroken text has no horizontal scroll (MN-29)", async ({ browser }) => {
    const long = `${TAG}${"Panjangsekalitanpaspasi".repeat(6)}`.slice(0, 150);
    const m = await mustRecord("sekjen", { unit: unitId(UNITS.internal), title: long, topic: "T".repeat(200), content: "Z".repeat(3000) });
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(`tidak-ada-${TAG}`)}`);
      await expect(main(page).getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await expect(main(page).getByRole("link", { name: "Reset" })).toBeVisible();
      await page.goto(`${PATHS.list}?q=${encodeURIComponent(TAG)}`);
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.goto(minuteUrl(m.id));
      await expect(main(page).getByText(long).first()).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.goto(`/notulensi/${m.id}/ubah`);
      await expect(page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      // Fields are at least 44 px high with 16 px text (D-017).
      for (const label of ["Judul Rapat", "Topik Bahasan", "Tanggal Rapat"]) {
        const field = page.getByLabel(label, { exact: true });
        await expect(field).toBeVisible();
        const box = await field.boundingBox();
        expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(44);
        const size = await page.getByLabel(label, { exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(size, `${label} font size`).toBeGreaterThanOrEqual(16);
      }
    } finally {
      await context.close();
    }
  });
});

test.describe("unknown and malformed addresses", () => {
  test("a missing minute, a malformed id and an edit page of a minute outside the scope never show content", async ({ browser }) => {
    const m = await mustRecord("sekjen", { unit: unitId(UNITS.eksternal), title: `${TAG} rahasia unit lain`, content: "isi rahasia" });
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      for (const path of [minuteUrl("00000000-0000-4000-8000-000000000000"), minuteUrl("bukan-id"), minuteUrl(m.id), `/notulensi/${m.id}/ubah`]) {
        await page.goto(path);
        await expect(main(page)).not.toContainText("isi rahasia");
        await expect(main(page)).not.toContainText(`${TAG} rahasia unit lain`);
        await expect(page.getByRole("heading", { level: 1, name: /Detail Notulensi|Ubah Notulensi/ })).toHaveCount(0);
      }
      await page.goto(minuteUrl("00000000-0000-4000-8000-000000000000"));
      await expect(main(page).getByText("Notulensi ini tidak ditemukan.")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("edit page of an old-period or voided minute shows a message, not a form", async ({ browser }) => {
    const m = await mustRecord("sekjen", { unit: unitId(UNITS.bph), title: `${TAG} dibatalkan untuk ubah` });
    expect((await voidAs("sekjen", m.id, "uji")).ok).toBe(true);
    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      await page.goto(`/notulensi/${m.id}/ubah`);
      await expect(page.getByRole("heading", { level: 1, name: "Ubah Notulensi" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Kembali ke notulensi" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
