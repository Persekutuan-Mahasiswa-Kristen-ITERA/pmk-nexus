// Letters: the flows in the browser at 390 px (spec F2-F7, LT-07, LT-10..LT-15b, LT-17, LT-19, LT-22, LT-23, LT-24).
// Request: member submits -> secretary Proses -> Ambil nomor -> Terbitkan with a file -> member opens the issued letter.
// Register: create, edit, void of incoming and outgoing letters; numbers increment and are never reused.
// The local stack has no Storage, so the upload route is stubbed for browser flows that need a file (stubLetterUpload).
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  awayFromMidnight,
  cancelAs,
  dialog,
  fakeFile,
  fillDate,
  fillText,
  issueAs,
  issueUrl,
  jakartaToday,
  letterByNumber,
  letterHistory,
  letterOfRequest,
  letterRow,
  letterUrl,
  main,
  memberId,
  emailOf,
  mustCreate,
  mustRegister,
  noHorizontalScroll,
  PATHS,
  PDF_BYTES,
  processAs,
  q,
  qn,
  reqRow,
  reqStatus,
  requesterWithRoom,
  requestUrl,
  rejectAs,
  rpcAs,
  row,
  sectionLabels,
  stubLetterUpload,
  sweepQa,
  tag,
  takeNumberAs,
  takenRequest,
  timeline,
  voidAs,
  type PersonaKey,
} from "./surat-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

/** The year and the sequence out of a number such as PMK/NEX/SK/2026/012. */
const parts = (numberText: string) => {
  const m = /^PMK\/NEX\/(SM|SK)\/(\d{4})\/(\d{3,})$/.exec(numberText);
  return m ? { code: m[1], year: Number(m[2]), seq: Number(m[3]) } : null;
};
/** The last used sequence of this type in the current Jakarta year (the counter row), 0 when none. */
const maxSeq = (type: "incoming" | "outgoing") =>
  qn(`select coalesce(max(last_value), 0) from nexus.letter_number_counters where letter_type = '${type}' and number_year = ${jakartaToday().slice(0, 4)}`);

test.describe("F5-F7, LT-07, LT-13, LT-14: the whole request flow, member and two secretaries", () => {
  test("submit -> Proses -> Ambil nomor -> Terbitkan with a file -> the member opens it in Permohonan Saya", async ({ browser }) => {
    test.setTimeout(300_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left; rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1");
    const requester = who as PersonaKey;
    const subject = `${TAG} Surat izin kegiatan`;
    const outgoingBefore = qn("select count(*) from nexus.letters where letter_type = 'outgoing'");
    const seqBefore = maxSeq("outgoing");

    // 1. The member submits (with one attachment)
    const member = await signedInContext(browser, requester);
    await stubLetterUpload(member.page, requester);
    try {
      await member.page.goto(PATHS.mine);
      await member.page.getByRole("link", { name: "Ajukan Surat" }).first().click();
      await expect(member.page.getByRole("heading", { level: 1, name: "Ajukan Surat" })).toBeVisible();
      await fillText(member.page, "Perihal (wajib)", subject);
      await fillText(member.page, "Ditujukan kepada (wajib)", "Rektor Institut Teknologi Sumatera");
      await fillText(member.page, "Keperluan (wajib)", "Izin penggunaan aula untuk kebaktian akhir tahun.");
      await fillText(member.page, "Atas nama (boleh kosong)", "Panitia Natal");
      await member.page.locator("input[type=file][multiple]").setInputFiles({ name: "proposal.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() });
      await expect(member.page.getByRole("group", { name: "Berkas 1" })).toBeVisible();
      await expect(member.page.getByRole("progressbar")).toHaveCount(0);
      await member.page.getByRole("button", { name: "Ajukan Surat" }).click();
      await expect(member.page.getByText("Permohonan terkirim. Cek statusnya di Permohonan Saya.")).toBeVisible();
      await expect(member.page).toHaveURL(/\/surat\/permohonan\/[0-9a-f-]{36}/);
    } finally {
      await member.context.close();
    }
    const requestId = q(`select id from nexus.letter_requests where subject = '${subject}'`);
    // The saved requester is the session member and the period is the active one, never client input (LT-07)
    const saved = reqRow(requestId);
    expect(saved.requester_member_id).toBe(memberId(emailOf(requester)));
    expect(saved.period_id).toBe(q("select id from public.periods where is_active"));
    expect(saved.status).toBe("submitted");
    expect(saved.on_behalf_of).toBe("Panitia Natal");
    expect(qn(`select count(*) from nexus.letter_files where request_id = '${requestId}'`)).toBe(1);
    expect(timeline(requestId).map((t) => t.event)).toEqual(["submitted"]);

    // 2. The queue lists it; Sekretaris Jenderal accepts it, takes the number, issues it
    const sec = await signedInContext(browser, "sekjen");
    await stubLetterUpload(sec.page, "sekjen");
    try {
      await sec.page.goto(`${PATHS.queue}?q=${encodeURIComponent(TAG)}`);
      await sec.page.getByRole("link", { name: subject }).click();
      await expect(sec.page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
      await expect(sec.page.getByText("Lampiran (1)")).toBeVisible();

      await sec.page.getByRole("button", { name: "Proses permohonan" }).click();
      await dialog(sec.page).getByRole("button", { name: "Proses permohonan" }).click();
      await expect(sec.page.getByText("Permohonan diproses.")).toBeVisible();
      expect(reqStatus(requestId)).toBe("processing");
      // Terbitkan is NOT offered before the number exists (A-LT23)
      await expect(sec.page.getByRole("link", { name: "Terbitkan surat" })).toHaveCount(0);
      await sec.page.goto(issueUrl(requestId));
      await expect(sec.page.getByText("Ambil nomor dulu sebelum menerbitkan surat.")).toBeVisible();
      await sec.page.goto(requestUrl(requestId));

      await sec.page.getByRole("button", { name: "Ambil nomor" }).click();
      await dialog(sec.page).getByRole("button", { name: "Ambil nomor" }).click();
      await expect(sec.page.getByText("Nomor surat", { exact: true })).toBeVisible();
      const linked = letterOfRequest(requestId);
      expect(linked, "the linked register row exists as soon as the number is taken").toBeTruthy();
      const p = parts(linked.number_text);
      expect(p?.code).toBe("SK");
      expect(p?.year).toBe(Number(jakartaToday().slice(0, 4)));
      expect(p!.seq).toBe(seqBefore + 1);
      expect(qn("select count(*) from nexus.letters where letter_type = 'outgoing'")).toBe(outgoingBefore + 1);
      expect(linked.status).toBe("active");
      expect(linked.period_id).toBe(saved.period_id);
      expect(qn(`select count(*) from nexus.letter_files where letter_id = '${linked.id}'`)).toBe(0); // no file yet (R20)
      expect(reqStatus(requestId)).toBe("processing"); // status stays Diproses
      await expect(sec.page.getByText(linked.number_text).first()).toBeVisible();
      // The Ambil nomor button is gone: once per request
      await expect(sec.page.getByRole("button", { name: "Ambil nomor" })).toHaveCount(0);

      // 3. The member already sees the number but no file, and can no longer cancel (LT-14, LT-15b)
      const mid = await signedInContext(browser, requester);
      try {
        await mid.page.goto(requestUrl(requestId));
        await expect(mid.page.getByText(linked.number_text).first()).toBeVisible();
        await expect(mid.page.getByRole("button", { name: /Unduh|Batalkan permohonan/ })).toHaveCount(0);
        await expect(mid.page.getByText("Menunggu file").first()).toBeVisible();
      } finally {
        await mid.context.close();
      }

      // 4. Terbitkan: a file is required, then the request is Diterbitkan
      await sec.page.getByRole("link", { name: "Terbitkan surat" }).click();
      await expect(sec.page.getByRole("heading", { level: 1, name: "Terbitkan surat" })).toBeVisible();
      await expect(sec.page.getByText(linked.number_text).first()).toBeVisible();
      await sec.page.getByRole("button", { name: "Terbitkan Surat" }).click();
      await expect(sec.page.getByText("Tambahkan minimal satu berkas surat.").first()).toBeVisible();
      expect(reqStatus(requestId)).toBe("processing");
      await sec.page.locator("input[type=file][multiple]").setInputFiles({ name: "surat-final.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() });
      await expect(sec.page.getByRole("group", { name: "Berkas 1" })).toBeVisible();
      await sec.page.getByRole("button", { name: "Terbitkan Surat" }).click();
      await dialog(sec.page).getByRole("button", { name: "Terbitkan surat" }).click();
      await expect(sec.page.getByText(`Surat terbit. Berkas dipasang pada nomor ${linked.number_text}.`)).toBeVisible();
    } finally {
      await sec.context.close();
    }
    expect(reqStatus(requestId)).toBe("issued");
    expect(qn(`select count(*) from nexus.letter_files where letter_id = '${letterOfRequest(requestId).id}' and not is_withdrawn`)).toBe(1);
    expect(timeline(requestId).map((t) => t.event)).toEqual(["submitted", "processing", "number_taken", "issued"]);
    expect(timeline(requestId).every((t) => t !== undefined)).toBe(true);

    // 5. The member sees Diterbitkan and the file in Permohonan Saya; still no register access
    const done = await signedInContext(browser, requester);
    try {
      await done.page.goto(PATHS.mine);
      const card = done.page.locator("article", { hasText: subject });
      await expect(card.getByText("Diterbitkan")).toBeVisible();
      await expect(card.getByText("Berkas siap diunduh.")).toBeVisible();
      await card.getByRole("link", { name: subject }).click();
      await expect(done.page.getByRole("button", { name: "Unduh surat-final.pdf" })).toBeVisible();
      // The signed link: with Storage on it opens in a new tab; the local stack has none, so it must fail closed with the
      // normal message (never a raw error, never a sign-out).
      const storage = q("select to_regclass('storage.objects') is not null") === "t";
      if (!storage) {
        await done.page.getByRole("button", { name: "Unduh surat-final.pdf" }).click();
        await expect(done.page.getByText("Berkas tidak bisa dibuka. Coba lagi.")).toBeVisible();
        await expect(done.page).toHaveURL(/\/surat\/permohonan\//);
      }
      await done.page.goto(PATHS.incoming);
      await expect(done.page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
      await done.page.goto(letterUrl(letterOfRequest(requestId).id));
      await expect(done.page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
    } finally {
      await done.context.close();
    }
  });
});

test.describe("LT-11, LT-12, LT-15a: own request blocked, rejection voids the taken number, cancel only while Diajukan", () => {
  test("L6 in the browser: Sekretaris Jenderal sees no action buttons on their own request; Sekretaris Umum 1 can process it", async ({ browser }) => {
    test.setTimeout(240_000);
    const own = await mustCreate("sekjen", { subject: `${TAG} Permohonan sekjen` });
    const sekjen = await signedInContext(browser, "sekjen");
    const sekum = await signedInContext(browser, "sekum1");
    try {
      await sekjen.page.goto(requestUrl(own.id));
      await expect(sekjen.page.getByText("Tidak bisa memproses permohonanmu sendiri.")).toBeVisible();
      await expect(sekjen.page.getByText("Kamu bisa mencatat suratmu langsung di Surat Keluar.")).toBeVisible();
      await expect(sekjen.page.getByRole("button", { name: /Proses permohonan|Ambil nomor|Tolak permohonan/ })).toHaveCount(0);
      await sekjen.page.goto(issueUrl(own.id));
      await expect(sekjen.page.getByText("Tidak bisa memproses permohonanmu sendiri.")).toBeVisible();
      // ...but they can still register their own letter directly (not a request)
      await sekjen.page.goto(PATHS.registerOutgoing);
      await expect(sekjen.page.getByRole("heading", { level: 1, name: "Catat Surat Keluar" })).toBeVisible();
      // The database says the same
      const r = await rpcAs("sekjen", "letter_request_process", { p_request_id: own.id, p_version: reqRow(own.id).version, p_note: null });
      expect(r.hint).toBe("self_processing_blocked");
      expect(reqStatus(own.id)).toBe("submitted");

      await sekum.page.goto(requestUrl(own.id));
      await sekum.page.getByRole("button", { name: "Proses permohonan" }).click();
      await dialog(sekum.page).getByRole("button", { name: "Proses permohonan" }).click();
      await expect(sekum.page.getByText("Permohonan diproses.")).toBeVisible();
      expect(reqStatus(own.id)).toBe("processing");
      // Sekum1 may take a number and issue; Sekjen still may not, at any step
      expect((await takeNumberAs("sekjen", own.id)).hint).toBe("self_processing_blocked");
      expect((await rejectAs("sekjen", own.id, "mau tolak sendiri")).hint).toBe("self_processing_blocked");
      const taken = await takeNumberAs("sekum1", own.id);
      expect(taken.ok, JSON.stringify(taken.body)).toBe(true);
      expect((await issueAs("sekjen", own.id, [fakeFile("sekjen")])).hint).toBe("self_processing_blocked");
    } finally {
      await sekjen.context.close();
      await sekum.context.close();
    }
  });

  test("Tolak needs a reason; after Ambil nomor it voids the register row with that reason; the number is never reissued; the member sees the reason but not the register row", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const taken = await takenRequest(who as PersonaKey, "sekjen", { subject: `${TAG} Akan ditolak` });
    const seqBefore = maxSeq("outgoing");
    const sec = await signedInContext(browser, "sekum1");
    try {
      await sec.page.goto(requestUrl(taken.id));
      await expect(sec.page.getByText(taken.numberText).first()).toBeVisible();
      await sec.page.getByRole("button", { name: "Tolak permohonan" }).click();
      // no reason: refused, nothing changes
      await dialog(sec.page).getByRole("button", { name: "Tolak permohonan" }).click();
      await expect(dialog(sec.page).getByText("Tulis alasan penolakan, supaya pemohon tahu.")).toBeVisible();
      expect(reqStatus(taken.id)).toBe("processing");
      await fillText(sec.page, "Alasan penolakan (wajib)", "Kegiatan dibatalkan oleh panitia.");
      await dialog(sec.page).getByRole("button", { name: "Tolak permohonan" }).click();
      await expect(sec.page.getByText(`Permohonan ditolak. Nomor ${taken.numberText} dibatalkan di register.`)).toBeVisible();
    } finally {
      await sec.context.close();
    }
    expect(reqStatus(taken.id)).toBe("rejected");
    const letter = letterRow(taken.letterId);
    expect(letter.status).toBe("voided");
    expect(letter.void_reason).toBe("Kegiatan dibatalkan oleh panitia.");
    expect(letter.number_text).toBe(taken.numberText);
    expect(timeline(taken.id).map((t) => t.event)).toEqual(["submitted", "processing", "number_taken", "rejected"]);
    // The number stays used: the next letter gets a higher number, never this one again (LT-19)
    const next = await mustRegister("sekjen", "outgoing", { subject: `${TAG} sesudah ditolak` });
    expect(parts(next.numberText)!.seq).toBe(seqBefore + 1);
    expect(next.numberText).not.toBe(taken.numberText);
    // The member reads the reason but the register row, its file and void reason stay internal (G5)
    const member = await signedInContext(browser, who as PersonaKey);
    try {
      await member.page.goto(requestUrl(taken.id));
      await expect(member.page.getByText("Kegiatan dibatalkan oleh panitia.").first()).toBeVisible();
      await expect(member.page.getByText(/Ditolak/).first()).toBeVisible();
      await expect(member.page.getByRole("link", { name: "Ajukan lagi" })).toBeVisible();
      await expect(member.page.getByText(/Alasan pembatalan|Dibatalkan di register/)).toHaveCount(0);
      await member.page.goto(letterUrl(taken.letterId));
      await expect(member.page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
    } finally {
      await member.context.close();
    }
    // The terminal state cannot move any more
    expect((await processAs("sekum1", taken.id)).ok).toBe(false);
    expect((await takeNumberAs("sekum1", taken.id)).ok).toBe(false);
  });

  test("the member cancels while Diajukan (reason optional); after Proses cancel is gone in the UI and refused by the database (LT-10)", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const who = requesterWithRoom(2);
    test.skip(who === null, "no requester has daily room left");
    const requester = who as PersonaKey;
    const a = await mustCreate(requester, { subject: `${TAG} Dibatalkan sendiri` });
    const b = await mustCreate(requester, { subject: `${TAG} Sudah diproses` });
    const member = await signedInContext(browser, requester);
    try {
      await member.page.goto(requestUrl(a.id));
      await member.page.getByRole("button", { name: "Batalkan permohonan" }).click();
      await dialog(member.page).getByRole("button", { name: "Batalkan permohonan" }).click();
      await expect(member.page.getByText("Permohonan dibatalkan.").first()).toBeVisible();
      expect(reqStatus(a.id)).toBe("cancelled");
      await expect(member.page.getByRole("link", { name: "Ajukan lagi" })).toBeVisible();

      expect((await processAs("sekjen", b.id)).ok).toBe(true);
      await member.page.goto(requestUrl(b.id));
      await expect(member.page.getByRole("button", { name: "Batalkan permohonan" })).toHaveCount(0);
      const r = await rpcAs(requester, "letter_request_cancel", { p_request_id: b.id, p_version: reqRow(b.id).version, p_reason: null });
      expect(r.ok).toBe(false);
      expect(reqStatus(b.id)).toBe("processing");
      // A cancelled request cannot be processed any more
      expect((await processAs("sekum1", a.id)).ok).toBe(false);
      // "Ajukan lagi" prefills the form and copies no attachment (P14, G15); somebody else's id gives an empty form
      await member.page.goto(`${PATHS.form}?again=${a.id}`);
      await expect(member.page.getByLabel("Perihal (wajib)")).toHaveValue(`${TAG} Dibatalkan sendiri`);
      await expect(member.page.getByText("Diisi dari permohonan sebelumnya. Periksa lagi sebelum mengirim.")).toBeVisible();
      await member.page.goto(`${PATHS.form}?again=${b.id}`.replace(/$/, "")); // own, but still Diproses: prefilled too (own request)
      await expect(member.page.getByRole("heading", { level: 1, name: "Ajukan Surat" })).toBeVisible();
    } finally {
      await member.context.close();
      await cancelAs(requester, b.id).catch(() => null);
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("F2-F4, LT-17, LT-19, LT-22, LT-23: register, edit and void in the browser", () => {
  test("incoming: required fields, number assigned by the system (never typed), edit with history, void with a reason", async ({ browser }) => {
    test.setTimeout(300_000);
    const seqBefore = maxSeq("incoming");
    const sec = await signedInContext(browser, "sekjen");
    try {
      await sec.page.goto(PATHS.incoming);
      await sec.page.getByRole("link", { name: "Catat Surat Masuk" }).click();
      await expect(sec.page.getByRole("heading", { level: 1, name: "Catat Surat Masuk" })).toBeVisible();
      // The number is not an input: it is generated at save and cannot be edited
      await expect(sec.page.getByText("Dibuat otomatis saat disimpan dan tidak bisa diubah.")).toBeVisible();
      await expect(sec.page.getByRole("textbox", { name: "Nomor surat", exact: true })).toHaveCount(0);
      // Required fields
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText("Ada 2 isian yang perlu diperbaiki.")).toBeVisible();
      await expect(sec.page.getByText("Isi pengirim.").first()).toBeVisible();
      await expect(sec.page.getByText("Isi perihal.").first()).toBeVisible();
      // Nothing saved
      expect(qn(`select count(*) from nexus.letters where subject like '${TAG} Undangan rapat%'`)).toBe(0);

      await fillText(sec.page, "Pengirim (wajib)", "Biro Kemahasiswaan ITERA");
      await fillText(sec.page, "Perihal (wajib)", `${TAG} Undangan rapat`);
      await fillText(sec.page, "Nomor surat dari pengirim (boleh kosong)", "123/KM/XI/2026");
      await fillText(sec.page, "Catatan (boleh kosong)", "Dibawa langsung oleh staf.");
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText(/^Surat dicatat\. Nomornya /)).toBeVisible();
      const numberText = (await sec.page.getByText(/PMK\/NEX\/SM\/\d{4}\/\d{3,}/).first().innerText()).trim();
      const p = parts(numberText);
      expect(p).toMatchObject({ code: "SM", year: Number(jakartaToday().slice(0, 4)) });
      expect(p!.seq).toBe(seqBefore + 1);
      const saved = letterByNumber(numberText);
      expect(saved).toMatchObject({ letter_type: "incoming", status: "active", counterpart: "Biro Kemahasiswaan ITERA", counterpart_number: "123/KM/XI/2026", received_date: jakartaToday() });
      expect(saved.period_id).toBe(q("select id from public.periods where is_active"));
      expect(letterHistory(saved.id).map((h) => h.kind)).toEqual(["registered"]);
      expect(saved.created_by).toBe(memberId(emailOf("sekjen")));

      // Edit: an unchanged form writes nothing; a change writes a history row with before and after
      await sec.page.getByRole("link", { name: "Ubah rincian" }).click();
      await expect(sec.page.getByText("Nomor tidak bisa diubah.")).toBeVisible();
      await sec.page.getByRole("button", { name: "Simpan Perubahan" }).click();
      await expect(sec.page.getByText("Belum ada yang diubah.")).toBeVisible();
      expect(letterHistory(saved.id)).toHaveLength(1);
      await fillText(sec.page, "Perihal (wajib)", `${TAG} Undangan rapat (diubah)`);
      await sec.page.getByRole("button", { name: "Simpan Perubahan" }).click();
      await expect(sec.page.getByText("Perubahan disimpan.")).toBeVisible();
      const hist = letterHistory(saved.id);
      expect(hist.map((h) => h.kind)).toEqual(["registered", "edited"]);
      expect(JSON.stringify(hist[1].before_data)).toContain(`${TAG} Undangan rapat`);
      expect(JSON.stringify(hist[1].after_data)).toContain("(diubah)");
      const after = letterRow(saved.id);
      expect(after.number_text).toBe(numberText); // never editable
      expect(Number(after.version)).toBeGreaterThan(Number(saved.version));
      await expect(sec.page.getByText(`${TAG} Undangan rapat (diubah)`).first()).toBeVisible();

      // Void: reason required; the row stays, the number stays used
      await sec.page.getByRole("button", { name: "Batalkan nomor" }).click();
      await dialog(sec.page).getByRole("button", { name: "Batalkan nomor" }).click();
      await expect(dialog(sec.page).getByText("Tulis alasan pembatalan.")).toBeVisible();
      expect(letterRow(saved.id).status).toBe("active");
      await fillText(sec.page, "Alasan (wajib)", "Salah catat, surat ini milik unit lain.");
      await dialog(sec.page).getByRole("button", { name: "Batalkan nomor" }).click();
      await expect(sec.page.getByText("Nomor dibatalkan.").first()).toBeVisible();
      const voided = letterRow(saved.id);
      expect(voided).toMatchObject({ status: "voided", void_reason: "Salah catat, surat ini milik unit lain.", number_text: numberText });
      // A voided letter is read-only: no edit, no second void, the edit page says so
      await expect(sec.page.getByRole("link", { name: "Ubah rincian" })).toHaveCount(0);
      await expect(sec.page.getByRole("button", { name: "Batalkan nomor" })).toHaveCount(0);
      await sec.page.goto(`${letterUrl(saved.id)}/ubah`);
      await expect(sec.page.getByText("Surat ini tidak bisa diubah.")).toBeVisible();
      expect((await voidAs("sekjen", saved.id, "lagi")).ok).toBe(false);
      expect((await rpcAs("sekjen", "letter_update", { p_letter_id: saved.id, p_version: voided.version, p_subject: "x", p_counterpart: "y", p_received_date: jakartaToday() })).ok).toBe(false);
      // It stays in the register with its chip, and the next number is higher (never reissued, LT-19)
      await sec.page.goto(`${PATHS.incoming}?q=${encodeURIComponent(numberText.slice(-9))}`);
      const card = sec.page.locator("article", { hasText: numberText });
      await expect(card.getByText("Dibatalkan")).toBeVisible();
      const next = await mustRegister("sekjen", "incoming", { subject: `${TAG} sesudah batal` });
      expect(parts(next.numberText)!.seq).toBe(p!.seq + 1);
    } finally {
      await sec.context.close();
    }
  });

  test("outgoing: letter date required, number SK, direct registration has no linked request; chips only for Dibatalkan and Nomor lama (LT-49)", async ({ browser }) => {
    test.setTimeout(240_000);
    const seqBefore = maxSeq("outgoing");
    const sec = await signedInContext(browser, "sekum1");
    try {
      await sec.page.goto(PATHS.registerOutgoing);
      await expect(sec.page.getByText(/Catat dulu untuk mendapat nomor/)).toBeVisible();
      await fillText(sec.page, "Tanggal surat (wajib)", "");
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText("Pilih tanggal surat.").first()).toBeVisible();
      await fillDate(sec.page, "Tanggal surat (wajib)", jakartaToday());
      await fillText(sec.page, "Ditujukan kepada (wajib)", "Gereja Mitra");
      await fillText(sec.page, "Perihal (wajib)", `${TAG} Undangan ibadah`);
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText(/^Surat dicatat\. Nomornya /)).toBeVisible();
      const numberText = (await sec.page.getByText(/PMK\/NEX\/SK\/\d{4}\/\d{3,}/).first().innerText()).trim();
      expect(parts(numberText)!.seq).toBe(seqBefore + 1);
      const saved = letterByNumber(numberText);
      expect(saved.source_request_id).toBeNull();
      expect(saved.letter_type).toBe("outgoing");
      // No bracket count on the tabs (P2); an Aktif letter carries no chip (P3)
      await sec.page.goto(`${PATHS.outgoing}?q=${encodeURIComponent(TAG)}`);
      const labels = await sectionLabels(sec.page);
      expect(labels.slice(0, 2), JSON.stringify(labels)).toEqual(["Surat Masuk", "Surat Keluar"]);
      const card = sec.page.locator("article", { hasText: numberText });
      await expect(card).toBeVisible();
      await expect(card.getByText(/Aktif|Dibatalkan|Nomor lama/)).toHaveCount(0);
    } finally {
      await sec.context.close();
    }
  });

  test("'Nomor lama': the typed number is checked in a sheet, saved as typed, marked with a chip, does not move the counter, and a duplicate is refused (L7, G7)", async ({ browser }) => {
    test.setTimeout(240_000);
    const legacy = `${TAG}/LAMA/IX/2025`;
    const counter = () => qn("select coalesce(sum(last_value), 0) from nexus.letter_number_counters");
    const before = counter();
    const sec = await signedInContext(browser, "sekjen");
    try {
      await sec.page.goto(PATHS.registerOutgoing);
      await sec.page.getByRole("checkbox", { name: /Surat lama/ }).check();
      await expect(sec.page.getByText("Ditulis sendiri di bawah.")).toBeVisible();
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText("Isi nomor lama.").first()).toBeVisible();
      await fillText(sec.page, "Nomor lama (wajib)", legacy);
      await fillText(sec.page, "Ditujukan kepada (wajib)", "Arsip");
      await fillText(sec.page, "Perihal (wajib)", `${TAG} Surat lama`);
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(dialog(sec.page).getByText(legacy)).toBeVisible(); // the check sheet shows what was typed
      expect(qn(`select count(*) from nexus.letters where number_text = '${legacy}'`)).toBe(0);
      await dialog(sec.page).getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText(/^Surat dicatat\. Nomornya /)).toBeVisible();
      const saved = letterByNumber(legacy);
      expect(saved).toMatchObject({ is_legacy_number: true, status: "active", letter_type: "outgoing" });
      expect(counter()).toBe(before);
      // Listed with its chip
      await sec.page.goto(`${PATHS.outgoing}?q=${encodeURIComponent(TAG + "/LAMA")}`);
      await expect(sec.page.locator("article", { hasText: legacy }).getByText("Nomor lama")).toBeVisible();
      // A duplicate (any letter case, extra spaces) is refused and shown in the form
      const dup = await rpcAs("sekjen", "letter_register", { p_type: "outgoing", p_subject: `${TAG} ganda`, p_counterpart: "x", p_letter_date: jakartaToday(), p_legacy_number: `  ${legacy.toLowerCase()} ` });
      expect(dup.hint).toBe("duplicate_number");
      expect(qn(`select count(*) from nexus.letters where subject = '${TAG} ganda'`)).toBe(0);
      await sec.page.goto(PATHS.registerOutgoing);
      await sec.page.getByRole("checkbox", { name: /Surat lama/ }).check();
      await fillText(sec.page, "Nomor lama (wajib)", legacy);
      await fillText(sec.page, "Ditujukan kepada (wajib)", "Arsip");
      await fillText(sec.page, "Perihal (wajib)", `${TAG} Surat lama ganda`);
      await sec.page.getByRole("button", { name: "Simpan Surat" }).click();
      await dialog(sec.page).getByRole("button", { name: "Simpan Surat" }).click();
      await expect(sec.page.getByText("Nomor ini sudah ada di register.").first()).toBeVisible();
      expect(qn(`select count(*) from nexus.letters where subject = '${TAG} Surat lama ganda'`)).toBe(0);
      expect(counter()).toBe(before);
    } finally {
      await sec.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-17..LT-19: numbering format, increments and concurrency (database functions with real tokens)", () => {
  test("numbers follow PMK/NEX/SM|SK/YYYY/NNN, one sequence per type, consecutive across direct registration and Ambil nomor", async () => {
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const sk0 = maxSeq("outgoing");
    const sm0 = maxSeq("incoming");
    const a = await mustRegister("sekjen", "outgoing", { subject: `${TAG} urut 1` });
    const viaRequest = await takenRequest(who as PersonaKey, "sekum1", { subject: `${TAG} urut 2` });
    const c = await mustRegister("sekum1", "outgoing", { subject: `${TAG} urut 3` });
    const m = await mustRegister("sekjen", "incoming", { subject: `${TAG} urut masuk` });
    expect([a.numberText, viaRequest.numberText, c.numberText].map((n) => parts(n)?.seq)).toEqual([sk0 + 1, sk0 + 2, sk0 + 3]);
    for (const n of [a.numberText, viaRequest.numberText, c.numberText]) expect(n).toMatch(/^PMK\/NEX\/SK\/\d{4}\/\d{3,}$/);
    expect(parts(m.numberText)).toMatchObject({ code: "SM", seq: sm0 + 1 });
    // The year is the Jakarta calendar year at the moment of numbering, not the letter date (A-LT1): an older letter date keeps its year
    const old = await mustRegister("sekjen", "outgoing", { subject: `${TAG} tanggal lama`, letterDate: "2025-12-30" });
    expect(parts(old.numberText)!.year).toBe(Number(jakartaToday().slice(0, 4)));
    expect(letterRow(old.id).letter_date).toBe("2025-12-30");
    // Padding: three digits, a longer sequence simply grows (read-only check of the formatter in the database)
    expect(q("select nexus._lt_format_number((select prefix from nexus.letter_numbering_settings), (select outgoing_code from nexus.letter_numbering_settings), (select number_separator from nexus.letter_numbering_settings), true, (select seq_digits from nexus.letter_numbering_settings), 2026, 7)")).toBe("PMK/NEX/SK/2026/007");
    expect(q("select nexus._lt_format_number((select prefix from nexus.letter_numbering_settings), (select outgoing_code from nexus.letter_numbering_settings), (select number_separator from nexus.letter_numbering_settings), true, (select seq_digits from nexus.letter_numbering_settings), 2026, 1234)")).toBe("PMK/NEX/SK/2026/1234");
  });

  test("two secretaries taking a number for the SAME request: exactly one wins, one number is used (LT-15); two registrations at once get different numbers (LT-19)", async () => {
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const made = await mustCreate(who as PersonaKey, { subject: `${TAG} balapan` });
    expect((await processAs("sekjen", made.id)).ok).toBe(true);
    const version = reqRow(made.id).version;
    const seqBefore = maxSeq("outgoing");
    const [x, y] = await Promise.all([
      rpcAs("sekjen", "letter_request_take_number", { p_request_id: made.id, p_version: version }),
      rpcAs("sekum1", "letter_request_take_number", { p_request_id: made.id, p_version: version }),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const loser = x.ok ? y : x;
    expect(loser.hint).toBe("state_changed");
    expect(qn(`select count(*) from nexus.letters where source_request_id = '${made.id}'`)).toBe(1);
    expect(maxSeq("outgoing")).toBe(seqBefore + 1);

    // Two Terbitkan at once on the same request: one wins
    const file1 = fakeFile("sekjen", "a.pdf");
    const file2 = fakeFile("sekum1", "b.pdf");
    const letter = letterOfRequest(made.id);
    const body = (file: ReturnType<typeof fakeFile>) => ({ p_request_id: made.id, p_version: reqRow(made.id).version, p_letter_version: letter.version, p_subject: letter.subject, p_addressee: letter.counterpart, p_letter_date: jakartaToday(), p_files: [file], p_note: null });
    const [i, j] = await Promise.all([rpcAs("sekjen", "letter_request_issue", body(file1)), rpcAs("sekum1", "letter_request_issue", body(file2))]);
    expect([i.ok, j.ok].filter(Boolean)).toHaveLength(1);
    expect(reqStatus(made.id)).toBe("issued");
    expect(qn(`select count(*) from nexus.letter_files where letter_id = '${letter.id}'`)).toBe(1);

    const before = maxSeq("incoming");
    const regs = await Promise.all([1, 2, 3, 4].map((n) => rpcAs(n % 2 ? "sekjen" : "sekum1", "letter_register", { p_type: "incoming", p_subject: `${TAG} serentak ${n}`, p_counterpart: "x", p_received_date: jakartaToday() })));
    expect(regs.every((r) => r.ok), JSON.stringify(regs.map((r) => r.body))).toBe(true);
    const numbers = regs.map((r) => row(r).number_text as string);
    expect(new Set(numbers).size).toBe(4);
    expect(numbers.map((n) => parts(n)!.seq).sort((a, b) => a - b)).toEqual([before + 1, before + 2, before + 3, before + 4]);
  });

  test("a failed registration uses no number (R2): a refused call leaves the counter alone", async () => {
    const before = maxSeq("outgoing");
    const count = qn("select count(*) from nexus.letters");
    for (const bad of [
      { p_subject: "", p_counterpart: "x", p_letter_date: jakartaToday() },
      { p_subject: `${TAG} x`, p_counterpart: "", p_letter_date: jakartaToday() },
      { p_subject: `${TAG} x`, p_counterpart: "x", p_letter_date: null },
      { p_subject: `${TAG} x`, p_counterpart: "x", p_letter_date: "2999-01-01" },
      { p_subject: "a".repeat(201), p_counterpart: "x", p_letter_date: jakartaToday() },
    ]) {
      const r = await rpcAs("sekjen", "letter_register", { p_type: "outgoing", ...bad });
      expect(r.ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    expect(maxSeq("outgoing")).toBe(before);
    expect(qn("select count(*) from nexus.letters")).toBe(count);
  });

  test("LT-20, LT-51: a format change applies only to later letters; the next sequence can only go up (System Admin); everything is restored", async () => {
    test.setTimeout(120_000);
    const current = () => JSON.parse(q("select row_to_json(s) from nexus.letter_numbering_settings s")) as { version: number; prefix: string; incoming_code: string; outgoing_code: string; seq_digits: number; number_separator: string };
    const original = current();
    const old = await mustRegister("sekjen", "outgoing", { subject: `${TAG} sebelum format` });
    const oldNumber = old.numberText;
    const changesBefore = qn("select count(*) from nexus.letter_numbering_changes");
    try {
      const upd = await rpcAs("admin", "letter_numbering_update_format", {
        p_version: original.version, p_prefix: "PMK", p_incoming_code: "SM", p_outgoing_code: "SK", p_seq_digits: 4, p_separator: "-", p_include_year: true, p_reason: null,
      });
      expect(upd.ok, JSON.stringify(upd.body)).toBe(true);
      const neu = await mustRegister("sekum1", "outgoing", { subject: `${TAG} sesudah format` });
      expect(neu.numberText).toMatch(/^PMK-SK-\d{4}-\d{4}$/);
      expect(parts(oldNumber)).not.toBeNull();
      expect(letterRow(old.id).number_text).toBe(oldNumber); // stored, never recomputed
      expect(qn("select count(*) from nexus.letter_numbering_changes")).toBe(changesBefore + 1);
      // Same codes for both types, characters outside the allowed set, 7 digits, a wrong separator: refused
      const base = { p_version: current().version, p_prefix: "PMK", p_seq_digits: 3, p_separator: "/", p_include_year: true, p_reason: null };
      for (const bad of [
        { ...base, p_incoming_code: "SK", p_outgoing_code: "sk" },
        { ...base, p_incoming_code: "S M", p_outgoing_code: "SK" },
        { ...base, p_incoming_code: "SM", p_outgoing_code: "SK", p_seq_digits: 7 },
        { ...base, p_incoming_code: "SM", p_outgoing_code: "SK", p_separator: "|" },
        { ...base, p_prefix: "", p_incoming_code: "SM", p_outgoing_code: "SK" },
        { ...base, p_incoming_code: "SM", p_outgoing_code: "SK", p_version: 1 }, // stale version
      ]) {
        expect((await rpcAs("admin", "letter_numbering_update_format", bad)).ok, JSON.stringify(bad)).toBe(false);
      }
    } finally {
      const v = current();
      await rpcAs("admin", "letter_numbering_update_format", {
        p_version: v.version, p_prefix: original.prefix, p_incoming_code: original.incoming_code, p_outgoing_code: original.outgoing_code, p_seq_digits: original.seq_digits, p_separator: original.number_separator, p_include_year: true, p_reason: null,
      });
    }
    const restored = current();
    expect(restored).toMatchObject({ prefix: original.prefix, incoming_code: original.incoming_code, outgoing_code: original.outgoing_code, seq_digits: original.seq_digits, number_separator: original.number_separator });
    // The next sequence only goes up, needs a reason, and only for the current year (the test never moves it up for real)
    const year = Number(jakartaToday().slice(0, 4));
    const last = maxSeq("outgoing");
    for (const [next, reason, ok] of [[last, "uji", false], [Math.max(1, last - 1), "uji", false], [last + 1, "", false], [last + 1, "   ", false]] as const) {
      const r = await rpcAs("admin", "letter_numbering_set_next", { p_type: "outgoing", p_year: year, p_next_seq: next, p_reason: reason });
      expect(r.ok, `${next} ${JSON.stringify(reason)}`).toBe(ok);
    }
    const stale = await rpcAs("admin", "letter_numbering_set_next", { p_type: "outgoing", p_year: year - 1, p_next_seq: last + 1, p_reason: "uji" });
    expect(stale.ok).toBe(false);
    expect(maxSeq("outgoing")).toBe(last);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-24, LT-15b, LT-50: rules between a register letter and its request", () => {
  test("while the request is Diproses the letter cannot be voided or get files; after Terbitkan voiding keeps the request Diterbitkan and shows 'Nomor dibatalkan'", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const taken = await takenRequest(who as PersonaKey, "sekjen", { subject: `${TAG} terkait` });
    const version = () => Number(letterRow(taken.letterId).version);
    // open request: no void, no files (A-LT24)
    const v = await rpcAs("sekum1", "letter_void", { p_letter_id: taken.letterId, p_version: version(), p_reason: "coba" });
    expect(v.ok).toBe(false);
    expect(v.hint).toBe("request_open");
    const f = await rpcAs("sekum1", "letter_add_files", { p_letter_id: taken.letterId, p_version: version(), p_files: [fakeFile("sekum1")] });
    expect(f.ok).toBe(false);
    expect(f.hint).toBe("request_open");
    const sec = await signedInContext(browser, "sekum1");
    try {
      await sec.page.goto(letterUrl(taken.letterId));
      await expect(sec.page.getByRole("button", { name: "Batalkan nomor" })).toHaveCount(0);
      await expect(sec.page.getByRole("button", { name: "Tambah berkas" })).toHaveCount(0);
      await expect(sec.page.getByText("Berkas finalnya diunggah lewat Terbitkan surat.")).toBeVisible();
      // issue, then the last visible file cannot be withdrawn until a replacement exists (G4)
      const file = fakeFile("sekjen", "final.pdf");
      expect((await issueAs("sekjen", taken.id, [file])).ok).toBe(true);
      const fileId = Number(q(`select id from nexus.letter_files where letter_id = '${taken.letterId}'`));
      const w = await rpcAs("sekum1", "letter_withdraw_file", { p_file_id: fileId, p_version: version(), p_reason: "salah" });
      expect(w.ok).toBe(false);
      expect(w.hint).toBe("last_issued_file");
      const add = await rpcAs("sekum1", "letter_add_files", { p_letter_id: taken.letterId, p_version: version(), p_files: [fakeFile("sekum1", "pengganti.pdf")] });
      expect(add.ok, JSON.stringify(add.body)).toBe(true);
      const w2 = await rpcAs("sekum1", "letter_withdraw_file", { p_file_id: fileId, p_version: version(), p_reason: "salah" });
      expect(w2.ok, JSON.stringify(w2.body)).toBe(true);
      // a withdrawn file stays stored and recorded, never deleted (LT-28), and does not count toward the limit of 3
      expect(qn(`select count(*) from nexus.letter_files where id = ${fileId} and is_withdrawn`)).toBe(1);
      const more = await rpcAs("sekum1", "letter_add_files", { p_letter_id: taken.letterId, p_version: version(), p_files: [fakeFile("sekum1", "c.pdf"), fakeFile("sekum1", "d.pdf")] });
      expect(more.ok, JSON.stringify(more.body)).toBe(true); // 1 visible + 2 = 3; the withdrawn one is not counted
      const fourth = await rpcAs("sekum1", "letter_add_files", { p_letter_id: taken.letterId, p_version: version(), p_files: [fakeFile("sekum1", "e.pdf")] });
      expect(fourth.ok).toBe(false);
      expect(fourth.hint).toBe("file_count");

      // void the issued letter: the request stays Diterbitkan and the member sees the flag
      expect((await voidAs("sekum1", taken.letterId, "Nomor salah cetak")).ok).toBe(true);
      expect(reqStatus(taken.id)).toBe("issued");
      const member = await signedInContext(browser, who as PersonaKey);
      try {
        await member.page.goto(requestUrl(taken.id));
        await expect(member.page.getByText("Nomor dibatalkan").first()).toBeVisible();
        await expect(member.page.getByText("Nomor salah cetak")).toHaveCount(0); // the void reason is internal (G5)
        await expect(member.page.getByRole("button", { name: /^Unduh / })).toHaveCount(0);
      } finally {
        await member.context.close();
      }
    } finally {
      await sec.context.close();
    }
  });
});

test.describe("every screen of the flows at 390 px: no horizontal scroll", () => {
  test("register, forms, detail, queue, Permohonan Saya, numbering with long unbroken text", async ({ browser }) => {
    test.setTimeout(240_000);
    const longWord = "Sangat".repeat(33).slice(0, 195); // 195 characters without a space: the worst case for overflow
    const l = await mustRegister("sekjen", "incoming", { subject: `${TAG}${longWord}`.slice(0, 200), counterpart: "P".repeat(150), counterpartNumber: "N".repeat(60), notes: "C".repeat(500) });
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    const req = who ? await mustCreate(who as PersonaKey, { subject: `${TAG}${longWord}`.slice(0, 200), addressee: "T".repeat(150), purpose: "K".repeat(1000), onBehalfOf: "O".repeat(120) }) : null;
    const sec = await signedInContext(browser, "sekjen");
    try {
      const pages = [PATHS.incoming, PATHS.outgoing, PATHS.queue, PATHS.mine, PATHS.form, PATHS.registerIncoming, PATHS.registerOutgoing, PATHS.numbering, letterUrl(l.id), `${letterUrl(l.id)}/ubah`, `${PATHS.incoming}?q=${TAG}`];
      if (req) pages.push(requestUrl(req.id));
      for (const path of pages) {
        await sec.page.goto(path);
        await expect(main(sec.page)).toBeVisible();
        await sec.page.waitForLoadState("networkidle");
        expect(await noHorizontalScroll(sec.page), `${path} overflows horizontally at 390 px`).toBe(true);
      }
      // 44 px touch targets and 16 px text on the form fields (D-017, LT-42)
      await sec.page.goto(PATHS.registerIncoming);
      for (const label of ["Pengirim (wajib)", "Perihal (wajib)"]) {
        await expect(sec.page.getByLabel(label)).toBeVisible();
        const box = await sec.page.getByLabel(label).boundingBox();
        expect(box!.height, label).toBeGreaterThanOrEqual(44);
        expect(await sec.page.getByLabel(label).evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), label).toBeGreaterThanOrEqual(16);
      }
      await sec.page.goto(PATHS.form);
      for (const label of ["Perihal (wajib)", "Ditujukan kepada (wajib)", "Keperluan (wajib)"]) {
        expect(await sec.page.getByLabel(label).evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), label).toBeGreaterThanOrEqual(16);
      }
    } finally {
      await sec.context.close();
    }
  });
});
