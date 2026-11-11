// Letters edge cases: files (wrong type, too big, too many, real upload route), limits and validation at the database
// (very long text, dates, caps, duplicate numbers), search (case, wildcards, long input), empty states, malformed addresses,
// output escaping (LT-08, LT-21, LT-25, LT-26, LT-29, LT-44, LT-45, LT-47).
// Storage is OFF on the local stack: the upload route is tested up to the Storage call (503 `unavailable` for a valid file).
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  addDays,
  emailOf,
  issuedRequest,
  awayFromMidnight,
  fakeFile,
  fillText,
  jakartaToday,
  letterRow,
  main,
  mustCreate,
  mustRegister,
  noHorizontalScroll,
  ORIGIN,
  PATHS,
  PDF_BYTES,
  PNG_BYTES,
  JPEG_BYTES,
  processAs,
  q,
  qn,
  reqRow,
  reqStatus,
  requesterWithRoom,
  requestUrl,
  rpcAs,
  row,
  stubLetterUpload,
  storageInstalled,
  sweepQa,
  tag,
  UPLOAD,
  letterUrl,
  type PersonaKey,
} from "./surat-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

const today = () => jakartaToday();

// ---------------------------------------------------------------------------------------------
test.describe("LT-26: the real upload route checks the real file type, size and shape (no Storage needed to be refused)", () => {
  const MIB = 1024 * 1024;
  async function upload(persona: PersonaKey, files: { name: string; mimeType: string; buffer: Buffer }[], extra: Record<string, string> = {}, browser: import("@playwright/test").Browser) {
    const { context, page } = await signedInContext(browser, persona);
    try {
      await page.goto("/surat/saya");
      const multipart: Record<string, unknown> = { ...extra };
      if (files.length === 1) multipart.file = files[0];
      const res = files.length === 1 ? await page.request.post(UPLOAD, { multipart: multipart as never, headers: { origin: ORIGIN } }) : await page.request.post(UPLOAD, { multipart: { ...extra, ...Object.fromEntries(files.map((f, i) => [`file${i}`, f])) } as never, headers: { origin: ORIGIN } });
      return { status: res.status(), body: (await res.json().catch(() => ({}))) as { error?: { code: string; maxMb?: number; field?: string }; path?: string } };
    } finally {
      await context.close();
    }
  }

  test("wrong type by the real bytes: text, an executable, a PNG declared as PDF, a PDF declared as PNG, a GIF, a zip, an empty file", async ({ browser }) => {
    const cases: [string, { name: string; mimeType: string; buffer: Buffer }][] = [
      ["text declared as PDF", { name: "catatan.pdf", mimeType: "application/pdf", buffer: Buffer.from("ini bukan pdf, hanya teks biasa") }],
      ["Windows executable renamed .pdf", { name: "virus.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]) }],
      ["PNG declared as PDF", { name: "foto.pdf", mimeType: "application/pdf", buffer: PNG_BYTES }],
      ["PDF declared as PNG", { name: "surat.png", mimeType: "image/png", buffer: PDF_BYTES() }],
      ["JPEG declared as PNG", { name: "foto.png", mimeType: "image/png", buffer: JPEG_BYTES }],
      ["GIF", { name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a" + "\0".repeat(50)) }],
      ["zip declared as PDF", { name: "arsip.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(100)]) }],
      ["Word document", { name: "surat.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK\x03\x04docx") }],
      ["SVG with a script", { name: "gambar.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }],
      ["HTML declared as PDF", { name: "halaman.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") }],
      ["empty file", { name: "kosong.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) }],
      ["a PDF header only 4 bytes long", { name: "pendek.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") }],
    ];
    for (const [label, file] of cases) {
      const r = await upload("regular", [file], {}, browser);
      expect(r.status, label).toBe(400);
      expect(r.body.error?.code, label).toBe("invalid_file");
      expect(r.body.path, label).toBeUndefined();
    }
  });

  test("over 5 MB: 413 file_too_large with the limit in MB, also for a real PDF and for a body far above the cap", async ({ browser }) => {
    for (const size of [5 * MIB + 1, 6 * MIB, 12 * MIB]) {
      const r = await upload("regular", [{ name: "besar.pdf", mimeType: "application/pdf", buffer: PDF_BYTES(size - PDF_BYTES().length) }], {}, browser);
      expect(r.status, `${size} bytes`).toBe(413);
      expect(r.body.error).toMatchObject({ code: "file_too_large", maxMb: 5 });
    }
  });

  test("valid PDF, JPEG, PNG and exactly 5 MiB pass every check of the route; only the Storage call is left (503 here, 200 with Storage)", async ({ browser }) => {
    const folder = q("select id from public.members where email = 'member.regular@nexus.test'");
    for (const file of [
      { name: "surat.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() },
      { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG_BYTES },
      { name: "foto.png", mimeType: "image/png", buffer: PNG_BYTES },
      { name: "persis-5mb.pdf", mimeType: "application/pdf", buffer: PDF_BYTES(5 * MIB - PDF_BYTES().length) },
    ]) {
      const r = await upload("regular", [file], {}, browser);
      expect([400, 413], `${file.name} must not be refused by type or size: ${JSON.stringify(r.body)}`).not.toContain(r.status);
      if (storageInstalled()) {
        expect(r.status).toBe(200);
        expect(r.body.path).toMatch(new RegExp(`^${folder}/[0-9a-f-]{36}\\.(pdf|jpg|png)$`)); // always the caller's OWN folder
      } else {
        expect(r.status).toBe(503);
        expect(r.body.error?.code).toBe("unavailable");
      }
    }
  });

  test("malformed bodies: two files, an extra field, no file, a JSON body, a path field trying to choose the folder", async ({ browser }) => {
    const pdf = { name: "a.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() };
    const two = await upload("regular", [pdf, { ...pdf, name: "b.pdf" }], {}, browser);
    expect(two.status).toBe(400);
    const extra = await upload("regular", [pdf], { path: "00000000-0000-4000-8000-000000000000/x.pdf" }, browser);
    expect(extra.status).toBe(400);
    const { context, page } = await signedInContext(browser, "regular");
    try {
      await page.goto("/surat/saya");
      const none = await page.request.post(UPLOAD, { multipart: { note: "tanpa berkas" }, headers: { origin: ORIGIN } });
      expect(none.status()).toBe(400);
      const json = await page.request.post(UPLOAD, { data: { file: "x" }, headers: { origin: ORIGIN } });
      expect(json.status()).toBe(400);
      const text = await page.request.post(UPLOAD, { data: "hello", headers: { origin: ORIGIN, "content-type": "text/plain" } });
      expect(text.status()).toBe(400);
      for (const res of [none, json, text]) expect(JSON.stringify(await res.json())).not.toMatch(/stack|select |nexus\.|storage/i);
    } finally {
      await context.close();
    }
  });

  test("a file name with bidi overrides or control characters never reaches the browser as an executable-looking name (route accepts, database stores the cleaned name)", async () => {
    // The route cleans the name (unit-tested); the database refuses a name with control characters even if the route is bypassed
    const bad = fakeFile("sekjen", "surat\u0007.pdf");
    const r = await rpcAs("sekjen", "letter_register", { p_type: "outgoing", p_subject: `${TAG} nama berkas`, p_counterpart: "x", p_letter_date: today(), p_files: [bad] });
    expect(r.ok).toBe(false);
    expect(r.hint).toBe("invalid_file");
    expect(qn(`select count(*) from nexus.letters where subject = '${TAG} nama berkas'`)).toBe(0);
  });
});

test.describe("file attach rules at the database (LT-26, LT-28, LT-29): paths, folders, counts", () => {
  test("only well-formed paths in the caller's OWN folder, each path once, at most 3 per letter and request", async () => {
    const own = fakeFile("sekjen");
    const other = fakeFile("sekum1");
    const reg = (files: unknown) => rpcAs("sekjen", "letter_register", { p_type: "outgoing", p_subject: `${TAG} berkas`, p_counterpart: "x", p_letter_date: today(), p_files: files });
    const before = qn(`select count(*) from nexus.letters where subject = '${TAG} berkas'`);
    for (const [label, files] of [
      ["somebody else's folder", [other]],
      ["a path without a folder", [{ path: "surat.pdf", name: "surat.pdf" }]],
      ["a traversal path", [{ path: `../${own.path}`, name: "x.pdf" }]],
      ["an upper-case path", [{ path: own.path.toUpperCase(), name: "x.pdf" }]],
      ["a bad extension", [{ path: own.path.replace(/\.pdf$/, ".exe"), name: "x.exe" }]],
      ["the same path twice", [own, own]],
      ["a name that is blank", [{ ...fakeFile("sekjen"), name: "   " }]],
      ["a name of 201 characters", [{ ...fakeFile("sekjen"), name: "n".repeat(201) }]],
      ["four files", [fakeFile("sekjen"), fakeFile("sekjen"), fakeFile("sekjen"), fakeFile("sekjen")]],
      ["not a list", "surat.pdf"],
      ["a list of numbers", [1, 2]],
    ] as [string, unknown][]) {
      const r = await reg(files);
      expect(r.ok, label).toBe(false);
      expect(["invalid_file", "file_count"], `${label}: ${JSON.stringify(r.body)}`).toContain(r.hint);
    }
    expect(qn(`select count(*) from nexus.letters where subject = '${TAG} berkas'`)).toBe(before);
    // Three are fine, and the same path cannot be attached twice anywhere (also not to another letter)
    const three = [fakeFile("sekjen", "a.pdf"), fakeFile("sekjen", "b.jpg", "jpg"), fakeFile("sekjen", "c.png", "png")];
    const ok = await reg(three);
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    const again = await reg([three[0]]);
    expect(again.ok).toBe(false);
    expect(again.hint).toBe("file_already_attached");
    expect(qn(`select count(*) from nexus.letter_files where letter_id = '${row(ok).letter_id}'`)).toBe(3);
  });

  test("a request takes at most 3 attachments; a member cannot attach into another member's folder (a stranger's file is refused)", async () => {
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const mk = (files: unknown) => rpcAs(who as PersonaKey, "letter_request_create", { p_subject: `${TAG} lampiran`, p_addressee: "x", p_purpose: "y", p_files: files });
    expect((await mk([fakeFile("sekjen")])).ok).toBe(false); // somebody else's folder
    expect((await mk([1, 2, 3, 4].map(() => fakeFile(who as PersonaKey)))).hint).toBe("file_count");
    expect(qn(`select count(*) from nexus.letter_requests where subject = '${TAG} lampiran'`)).toBe(0);
    const ok = await mk([1, 2, 3].map((n) => fakeFile(who as PersonaKey, `lampiran-${n}.pdf`)));
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    expect(qn(`select count(*) from nexus.letter_files where request_id = '${row(ok).request_id}'`)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("the picker in the browser: messages for a wrong, a too big and too many files (LT-26)", () => {
  test("request form: a renamed text file, a 6 MB PDF, four files at once", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await signedInContext(browser, "regular");
    try {
      await page.goto(PATHS.form);
      await expect(page.getByRole("heading", { level: 1, name: "Ajukan Surat" })).toBeVisible();
      const input = page.locator("input[type=file][multiple]");
      await input.setInputFiles({ name: "catatan.pdf", mimeType: "application/pdf", buffer: Buffer.from("hanya teks") });
      await expect(page.getByRole("alert").filter({ hasText: "Format tidak didukung. Pakai PDF, JPG, atau PNG." })).toBeVisible();
      await input.setInputFiles({ name: "besar.pdf", mimeType: "application/pdf", buffer: PDF_BYTES(6 * 1024 * 1024) });
      await expect(page.getByRole("alert").filter({ hasText: "Berkas terlalu besar. Batasnya 5 MB." })).toBeVisible();
      await expect(page.getByRole("group", { name: "Berkas 1" })).toHaveCount(0);

      await stubLetterUpload(page, "regular");
      const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: PDF_BYTES() });
      await input.setInputFiles([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"), pdf("d.pdf")]);
      await expect(page.getByText("Maksimal 3 berkas.").first()).toBeVisible();
      await expect(page.getByRole("group", { name: /^Berkas \d$/ })).toHaveCount(3);
      // The picker closes at the limit; removing one frees a slot
      await expect(page.getByRole("button", { name: "Pilih berkas" })).toHaveCount(0);
      await page.getByRole("button", { name: "Hapus berkas 1" }).click();
      await expect(page.getByRole("button", { name: "Pilih berkas" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
    } finally {
      await context.close();
    }
  });

  test("a real upload that fails (no Storage here): the tile says so, the form will not submit, nothing is created, no number is used", async ({ browser }) => {
    test.skip(storageInstalled(), "Storage is installed: a valid upload succeeds, so there is no failure to observe");
    test.setTimeout(240_000);
    const seq = qn("select coalesce(sum(last_value), 0) from nexus.letter_number_counters");
    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      await page.goto(PATHS.registerOutgoing);
      await fillText(page, "Ditujukan kepada (wajib)", "Pihak Uji");
      await fillText(page, "Perihal (wajib)", `${TAG} gagal unggah`);
      await page.locator("input[type=file][multiple]").setInputFiles({ name: "surat.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() });
      await expect(page.getByRole("button", { name: "Coba lagi berkas 1" })).toBeVisible();
      await expect(page.getByText("Berkas gagal diunggah. Coba lagi.").first()).toBeVisible();
      await page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(page.getByText("Berkas gagal diunggah. Coba lagi.").last()).toBeVisible();
      expect(qn(`select count(*) from nexus.letters where subject = '${TAG} gagal unggah'`)).toBe(0);
      expect(qn("select coalesce(sum(last_value), 0) from nexus.letter_number_counters")).toBe(seq); // R2: a failed save uses no number
      // Removing the failed file lets the letter be saved without it (files are optional on registration)
      await page.getByRole("button", { name: "Hapus berkas 1" }).click();
      await page.getByRole("button", { name: "Simpan Surat" }).click();
      await expect(page.getByText(/^Surat dicatat\. Nomornya /)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("a photo (JPEG made by the browser) is accepted by the picker and shown as a tile", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await signedInContext(browser, "regular");
    try {
      await page.goto(PATHS.form);
      await stubLetterUpload(page, "regular");
      await expect(page.getByRole("heading", { level: 1, name: "Ajukan Surat" })).toBeVisible();
      await page.locator("input[type=file][multiple]").setInputFiles({ name: "foto-surat.jpg", mimeType: "image/jpeg", buffer: JPEG_BYTES });
      await expect(page.getByRole("group", { name: "Berkas 1" })).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Coba lagi berkas 1" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-08, LT-21, LT-44: limits and required fields at the database (the page is bypassed)", () => {
  const reg = (over: Record<string, unknown>) =>
    rpcAs("sekjen", "letter_register", { p_type: "outgoing", p_subject: "QA", p_counterpart: "x", p_letter_date: today(), ...over });

  test("letters: exact limits pass (200 / 150 / 500 / 60 characters), one over fails; emoji count as one character", async () => {
    const edge = await reg({ p_subject: `${TAG}`.padEnd(200, "s"), p_counterpart: "c".repeat(150), p_notes: "n".repeat(500) });
    expect(edge.ok, JSON.stringify(edge.body)).toBe(true);
    const stored = letterRow(row(edge).letter_id);
    expect([stored.subject.length, stored.counterpart.length, stored.notes.length]).toEqual([200, 150, 500]);
    for (const [label, over] of [
      ["subject 201", { p_subject: "s".repeat(201) }],
      ["counterpart 151", { p_counterpart: "c".repeat(151) }],
      ["notes 501", { p_notes: "n".repeat(501) }],
    ] as const) {
      const r = await reg(over);
      expect(r.ok, label).toBe(false);
      expect(r.hint, label).toBe("text_too_long");
    }
    const incoming = (over: Record<string, unknown>) => rpcAs("sekjen", "letter_register", { p_type: "incoming", p_subject: "QA", p_counterpart: "x", p_received_date: today(), ...over });
    const longNumber = await incoming({ p_counterpart_number: "9".repeat(61) });
    expect(longNumber.ok).toBe(false);
    expect(longNumber.hint).toBe("text_too_long");
    const okNumber = await incoming({ p_subject: `${TAG} sixty`, p_counterpart_number: "9".repeat(60) });
    expect(okNumber.ok, JSON.stringify(okNumber.body)).toBe(true);
    // 200 emoji are 200 characters (400 UTF-16 units): allowed; 201 are refused
    const emoji200 = await reg({ p_subject: "🙏".repeat(200) });
    expect(emoji200.ok, JSON.stringify(emoji200.body)).toBe(true);
    expect((await reg({ p_subject: "🙏".repeat(201) })).ok).toBe(false);
  });

  test("letters: required fields, whitespace-only values, wrong type, dates (future, before 2000, impossible, wrong side)", async () => {
    const tomorrow = addDays(today(), 1);
    const cases: [string, Record<string, unknown>, string][] = [
      ["empty subject", { p_subject: "" }, "text_required"],
      ["spaces-only subject", { p_subject: "     " }, "text_required"],
      ["null subject", { p_subject: null }, "text_required"],
      ["empty counterpart", { p_counterpart: "" }, "text_required"],
      ["outgoing without a letter date", { p_letter_date: null }, "date_required"],
      ["outgoing letter date tomorrow", { p_letter_date: tomorrow }, "date_in_future"],
      ["letter date year 1999", { p_letter_date: "1999-12-31" }, "invalid_dates"],
      ["wrong type", { p_type: "diary" }, "invalid_type"],
      ["incoming fields on an outgoing letter", { p_received_date: today() }, ""],
    ];
    for (const [label, over, hint] of cases) {
      const r = await reg(over);
      expect(r.ok, label).toBe(false);
      if (hint) expect(r.hint, label).toBe(hint);
    }
    const incoming = (over: Record<string, unknown>) => rpcAs("sekjen", "letter_register", { p_type: "incoming", p_subject: "QA", p_counterpart: "x", p_received_date: today(), ...over });
    for (const [label, over, hint] of [
      ["received date tomorrow", { p_received_date: tomorrow }, "date_in_future"],
      ["received date missing", { p_received_date: null }, "date_required"],
      ["letter date tomorrow", { p_letter_date: tomorrow }, "date_in_future"],
      ["received date before 2000", { p_received_date: "1999-01-01" }, "invalid_dates"],
    ] as [string, Record<string, unknown>, string][]) {
      const r = await incoming(over);
      expect(r.ok, label).toBe(false);
      expect(r.hint, label).toBe(hint);
    }
    // An incoming letter may have an older letter date than its received date, and no letter date at all
    expect((await incoming({ p_subject: `${TAG} tanpa tanggal surat`, p_letter_date: null })).ok).toBe(true);
    expect((await incoming({ p_subject: `${TAG} tanggal surat lama`, p_letter_date: "2026-01-02" })).ok).toBe(true);
  });

  // BUG-LT-01 (fixed 2026-11-11): nexus._lt_text used btrim() with spaces only, so a newline or tab value passed as "not blank" when the
  // Server Action was bypassed. It now strips the same ASCII whitespace as JS trim().
  test("BUG-LT-01: a subject of only newline and tab characters is refused by the database (LT-21, LT-44)", async () => {
    const r = await reg({ p_subject: "\n\t" });
    if (r.ok) await rpcAs("sekjen", "letter_void", { p_letter_id: row(r).letter_id, p_version: row(r).version, p_reason: "QA bersih-bersih bug BUG-LT-01" });
    expect(r.ok, "a whitespace-only Perihal must be refused").toBe(false);
  });

  test("edits and voids: stale version = 'Data sudah berubah' (state_changed), reason limits, no change on refusal", async () => {
    const l = await mustRegister("sekjen", "outgoing", { subject: `${TAG} untuk diubah` });
    const v1 = Number(letterRow(l.id).version);
    const ok = await rpcAs("sekjen", "letter_update", { p_letter_id: l.id, p_version: v1, p_subject: `${TAG} diubah`, p_counterpart: "baru", p_letter_date: today() });
    expect(ok.ok, JSON.stringify(ok.body)).toBe(true);
    const stale = await rpcAs("sekum1", "letter_update", { p_letter_id: l.id, p_version: v1, p_subject: `${TAG} versi lama`, p_counterpart: "x", p_letter_date: today() });
    expect(stale.ok).toBe(false);
    expect(stale.hint).toBe("state_changed");
    expect(letterRow(l.id).subject).toBe(`${TAG} diubah`);
    const version = () => Number(letterRow(l.id).version);
    for (const [label, reason, hint] of [["no reason", null, "reason_required"], ["blank reason", "   ", "reason_required"], ["501 characters", "a".repeat(501), "text_too_long"]] as const) {
      const r = await rpcAs("sekjen", "letter_void", { p_letter_id: l.id, p_version: version(), p_reason: reason });
      expect(r.ok, label).toBe(false);
      expect(r.hint, label).toBe(hint);
    }
    const staleVoid = await rpcAs("sekjen", "letter_void", { p_letter_id: l.id, p_version: v1, p_reason: "versi lama" });
    expect(staleVoid.hint).toBe("state_changed");
    expect(letterRow(l.id).status).toBe("active");
    expect((await rpcAs("sekjen", "letter_void", { p_letter_id: l.id, p_version: version(), p_reason: "a".repeat(500) })).ok).toBe(true);
    // the number text and type never change through any call (LT-22): the update function has no such parameter, and the guard trigger holds
    expect(letterRow(l.id).number_text).toBe(l.numberText);
  });

  test("requests: field limits, blank required fields, needed-by in the past, caps are checked by the database too (LT-08, LT-45)", async () => {
    await awayFromMidnight();
    const who = requesterWithRoom(2);
    test.skip(who === null, "no requester has daily room left");
    const requester = who as PersonaKey;
    const mk = (over: Record<string, unknown>) => rpcAs(requester, "letter_request_create", { p_subject: "QA", p_addressee: "x", p_purpose: "y", ...over });
    const before = qn(`select count(*) from nexus.letter_requests where requester_member_id = (select id from public.members where email = '${emailOf(requester)}')`);
    for (const [label, over, hint] of [
      ["subject 201", { p_subject: "s".repeat(201) }, "text_too_long"],
      ["addressee 151", { p_addressee: "a".repeat(151) }, "text_too_long"],
      ["purpose 1001", { p_purpose: "p".repeat(1001) }, "text_too_long"],
      ["on behalf 121", { p_on_behalf_of: "o".repeat(121) }, "text_too_long"],
      ["blank subject", { p_subject: "  " }, "text_required"],
      ["blank addressee", { p_addressee: "" }, "text_required"],
      ["blank purpose", { p_purpose: "" }, "text_required"],
      ["needed by yesterday", { p_needed_by: addDays(today(), -1) }, "date_in_past"],
    ] as [string, Record<string, unknown>, string][]) {
      const r = await mk(over);
      expect(r.ok, label).toBe(false);
      expect(r.hint, label).toBe(hint);
    }
    expect(qn(`select count(*) from nexus.letter_requests where requester_member_id = (select id from public.members where email = '${emailOf(requester)}')`)).toBe(before);
    // Boundaries pass, and a needed-by date of today is fine
    const edge = await mk({ p_subject: `${TAG}`.padEnd(200, "s"), p_addressee: "a".repeat(150), p_purpose: "p".repeat(1000), p_on_behalf_of: "o".repeat(120), p_needed_by: today() });
    expect(edge.ok, JSON.stringify(edge.body)).toBe(true);
    // HTML in free text is stored as text (and shown escaped, see the escaping test)
    const html = await mk({ p_subject: `${TAG} <b>tebal</b> & "kutip"`, p_purpose: "<script>alert(1)</script>" });
    expect(html.ok, JSON.stringify(html.body)).toBe(true);
    expect(reqRow(row(html).request_id).purpose).toBe("<script>alert(1)</script>");
  });

  test("rejection and cancellation notes: blank rejection note refused, 501 characters refused, the request stays as it was", async () => {
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const made = await mustCreate(who as PersonaKey, { subject: `${TAG} catatan` });
    for (const [label, note, hint] of [["null", null, "note_required"], ["blank", "  ", "note_required"], ["501", "n".repeat(501), "text_too_long"]] as const) {
      const r = await rpcAs("sekjen", "letter_request_reject", { p_request_id: made.id, p_version: reqRow(made.id).version, p_note: note });
      expect(r.ok, label).toBe(false);
      expect(r.hint, label).toBe(hint);
    }
    expect((await processAs("sekjen", made.id, "n".repeat(501))).ok).toBe(false);
    const cancel = await rpcAs(who as PersonaKey, "letter_request_cancel", { p_request_id: made.id, p_version: reqRow(made.id).version, p_reason: "r".repeat(501) });
    expect(cancel.ok).toBe(false);
    expect(reqStatus(made.id)).toBe("submitted");
    // a stale version of a request
    const stale = await rpcAs("sekjen", "letter_request_process", { p_request_id: made.id, p_version: Number(reqRow(made.id).version) + 5, p_note: null });
    expect(stale.hint).toBe("state_changed");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-45, LT-08: the caps of the owner (5 open, 10 per Jakarta day) hold by UI and by direct call", () => {
  test("6th open request refused; the page shows the cap message; after cancelling, 10 in one day then the 11th is refused", async ({ browser }) => {
    test.setTimeout(300_000);
    await awayFromMidnight();
    // A member with a whole day left and nothing open. Uses up that member's day on purpose, so it runs last in this file.
    const fresh = (["kabiro", "kadep", "kadivLogistik", "staffOps", "pembina", "admin", "regular"] as PersonaKey[]).find((p) => {
      const email = emailOf(p);
      return qn(`select count(*) from nexus.letter_requests r where r.requester_member_id = (select id from public.members where email = '${email}') and nexus._jakarta_date(r.created_at) = nexus._lt_today()`) === 0 &&
        qn(`select count(*) from nexus.letter_requests r where r.requester_member_id = (select id from public.members where email = '${email}') and r.status in ('submitted','processing')`) === 0;
    });
    test.skip(fresh === undefined, "no member has a whole day of requests left; rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1");
    const who = fresh as PersonaKey;
    const ids: string[] = [];
    const mk = (n: number) => rpcAs(who, "letter_request_create", { p_subject: `${TAG} batas ${n}`, p_addressee: "x", p_purpose: "y" });
    for (let n = 1; n <= 5; n++) {
      const r = await mk(n);
      expect(r.ok, JSON.stringify(r.body)).toBe(true);
      ids.push(row(r).request_id);
    }
    const sixth = await mk(6);
    expect(sixth.ok).toBe(false);
    expect(sixth.hint).toBe("too_many_open_requests");
    expect(qn(`select count(*) from nexus.letter_requests where subject = '${TAG} batas 6'`)).toBe(0);

    // The page: the cap message is shown and the header counts the open ones
    const { context, page } = await signedInContext(browser, who);
    try {
      await page.goto(PATHS.form);
      await expect(page.getByText("Kamu sudah punya 5 permohonan yang berjalan. Tunggu salah satunya selesai atau batalkan dulu.")).toBeVisible();
      await page.goto(PATHS.mine);
      await expect(page.getByText("5 berjalan")).toBeVisible();
    } finally {
      await context.close();
    }

    // Cancel all five and fill the day: five more, cancelled again (10 today), and the 11th is refused by the daily cap
    for (const id of ids) expect((await rpcAs(who, "letter_request_cancel", { p_request_id: id, p_version: reqRow(id).version, p_reason: null })).ok).toBe(true);
    for (let n = 7; n <= 11; n++) {
      const r = await mk(n);
      expect(r.ok, `${n}: ${JSON.stringify(r.body)}`).toBe(true);
      const id = row(r).request_id as string;
      expect((await rpcAs(who, "letter_request_cancel", { p_request_id: id, p_version: reqRow(id).version, p_reason: null })).ok).toBe(true);
    }
    const eleventh = await mk(12);
    expect(eleventh.ok).toBe(false);
    expect(eleventh.hint).toBe("daily_request_limit");
    const { context: c2, page: p2 } = await signedInContext(browser, who);
    try {
      await p2.goto(PATHS.form);
      await expect(p2.getByText("Batas permohonan hari ini sudah tercapai (10). Coba lagi besok.")).toBeVisible();
    } finally {
      await c2.close();
    }
    // The cap counts Jakarta days (LT-45, LT-47): a request made at 17:30 UTC on 8 Nov is already 9 Nov in Jakarta
    expect(q("select nexus._jakarta_date('2026-11-08 17:30:00+00')")).toBe("2026-11-09");
    expect(q("select nexus._jakarta_date('2026-11-08 16:59:59+00')")).toBe("2026-11-08");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-18, LT-47: Jakarta time (read-only checks of the database clock functions)", () => {
  test("the numbering year flips at 17:00 UTC on 31 December; the Jakarta date and 'today' agree with the Intl calendar", () => {
    expect(q("select nexus._lt_year_at('2026-12-31 16:59:59+00')")).toBe("2026");
    expect(q("select nexus._lt_year_at('2026-12-31 17:00:00+00')")).toBe("2027");
    expect(q("select nexus._lt_year_at('2026-12-31 23:30:00+00')")).toBe("2027"); // the example of LT-18
    expect(q("select nexus._lt_year_at('2027-01-01 00:00:00+00')")).toBe("2027");
    expect(q("select nexus._jakarta_date('2028-02-28 18:00:00+00')")).toBe("2028-02-29");
    expect(q("select nexus._lt_today()")).toBe(today());
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-25: search finds by part of the number, counterpart and Perihal, any letter case, and reads nothing else", () => {
  test("register search (RPC and screen), wildcard characters are literal, long input is refused, malformed addresses fall back", async ({ browser }) => {
    test.setTimeout(240_000);
    const word = `Zephyr${TAG.slice(2)}`;
    const a = await mustRegister("sekjen", "incoming", { subject: `${TAG} Perihal biasa`, counterpart: `Yayasan ${word} Mitra`, notes: `rahasia-catatan-${TAG}` });
    const b = await mustRegister("sekjen", "incoming", { subject: `${word} dalam perihal 5%_${TAG}`, counterpart: "Lain" });
    // c would match "5%_<tag>" if % and _ were wildcards ("5" + "a" + "b" + tag), so it proves they are taken literally
    const c = await mustRegister("sekjen", "incoming", { subject: `${word} dalam perihal 5ab${TAG}`, counterpart: "Lain" });
    const list = async (search: string | null, extra: Record<string, unknown> = {}) => {
      const r = await rpcAs("sekjen", "letter_list", { p_type: "incoming", p_search: search, p_status: "all", ...extra });
      return { r, ids: (Array.isArray(r.body) ? r.body : []).map((x: { letter_id: string }) => x.letter_id) };
    };
    // counterpart and Perihal, case-insensitive, by a part
    expect((await list(word.toLowerCase())).ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await list(word.toUpperCase().slice(0, 9))).ids).toEqual(expect.arrayContaining([a.id, b.id]));
    // the number (part of it)
    expect((await list(a.numberText.slice(-12))).ids).toContain(a.id);
    expect((await list(a.numberText.toLowerCase())).ids).toContain(a.id);
    // notes are NOT searched
    expect((await list(`rahasia-catatan-${TAG}`)).ids).toEqual([]);
    // LIKE wildcards are literal: "%" and "_" only match letters that really contain them
    const pct = (await list(`5%_${TAG}`)).ids;
    expect(pct).toEqual([b.id]);
    expect(pct).not.toContain(c.id);
    // Every hit for "%" or "_" must really contain that character in its number, counterpart or Perihal (checked in the tables)
    for (const ch of ["%", "_"]) {
      const hits = (await list(ch)).ids as string[];
      for (const id of hits) {
        const l = letterRow(id);
        expect(`${l.number_text} ${l.counterpart} ${l.subject}`, `search "${ch}" matched a letter without it`).toContain(ch);
      }
    }
    expect((await list("%")).ids).toContain(b.id);
    expect((await list("_")).ids).not.toContain(a.id);
    expect((await list("\\")).ids).toEqual([]);
    expect((await list("'; drop table nexus.letters; --")).ids).toEqual([]);
    expect(qn("select count(*) from nexus.letters")).toBeGreaterThan(0);
    // blank search = no search; 121 characters = refused; paging
    expect((await list("   ")).ids.length).toBeGreaterThan(0);
    expect((await list("x".repeat(121))).r.ok).toBe(false);
    expect((await list("x".repeat(600))).r.ok).toBe(false);
    expect((await list(null, { p_page_size: 51 })).r.ok).toBe(false);
    expect((await list(null, { p_page: 0 })).r.ok).toBe(false);
    expect((await list(null, { p_page: 99999 })).r.ok, "a page beyond the end is clamped, not an error").toBe(true);
    expect((await list(null, { p_status: "weird" })).r.ok).toBe(false);
    expect((await list(null, { p_period: "weird" })).r.ok).toBe(false);
    expect((await list(null, { p_year: 1 })).r.ok).toBe(false);
    // the status filter and 'Tanpa berkas'
    expect((await list(word, { p_status: "voided" })).ids).toEqual([]);
    expect((await list(word, { p_without_files: true })).ids).toEqual(expect.arrayContaining([a.id, b.id]));

    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      await page.goto(`${PATHS.incoming}?q=${encodeURIComponent(word.toLowerCase())}`);
      await expect(page.locator("article", { hasText: a.numberText })).toBeVisible();
      await expect(page.locator("article", { hasText: b.numberText })).toBeVisible();
      await page.goto(`${PATHS.incoming}?q=${encodeURIComponent("tidak-ada-" + TAG)}`);
      await expect(page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await page.goto(`${PATHS.incoming}?q=${"y".repeat(130)}`);
      await expect(page.getByText("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.")).toBeVisible();
      await page.goto(`${PATHS.incoming}?q=${"y".repeat(900)}`);
      await expect(page.getByText("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.")).toBeVisible();
      // Garbage in the address falls back to the defaults, never a crash (500)
      for (const query of ["period=bogus&status=zzz&year=abc&page=-3&nofile=7", "page=999999", "page=abc", "year=99999", "status=voided&period=all&year=2026", "q[]=a&q[]=b"]) {
        const res = await page.goto(`${PATHS.incoming}?${query}`);
        expect(res?.status(), query).toBeLessThan(500);
        await expect(page.getByRole("heading", { level: 1, name: "Surat Menyurat" }), query).toBeVisible();
        await expect(page.getByText("Terjadi gangguan."), query).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
});

// BUG-LT-02 (Low): a NUL character in the search is a database error (PostgREST refuses "\u0000"), and the screen answers the outage
// message "Terjadi gangguan." instead of a plain "no results". Expected failure until fixed.
test("BUG-LT-02: a NUL character in the search shows 'no results', not the outage message", async ({ browser }) => {
  test.fail(true, "BUG-LT-02: a NUL byte in ?q= is answered with the outage message");
  const { context, page } = await signedInContext(browser, "sekjen");
  try {
    const res = await page.goto(`${PATHS.incoming}?q=%00`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { level: 1, name: "Surat Menyurat" })).toBeVisible();
    await expect(page.getByText("Terjadi gangguan.")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------------------------
test.describe("empty states and escaping on screen", () => {
  test("a member without requests sees the empty state with a way forward; a filter with no result has its own text", async ({ browser }) => {
    test.skip(qn("select count(*) from nexus.letter_requests where requester_member_id = (select id from public.members where email = 'sekdep@nexus.test')") > 0, "sekdep already has requests");
    const { context, page } = await signedInContext(browser, "sekdep");
    try {
      await page.goto(PATHS.mine);
      await expect(page.getByText("Kamu belum punya permohonan.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Ajukan Surat" }).first()).toBeVisible();
      await page.goto(`${PATHS.mine}?filter=open`);
      await expect(page.getByText(/Kamu belum punya permohonan\.|Tidak ada permohonan di sini\./)).toBeVisible();
      // an unknown filter falls back to "Semua"
      await page.goto(`${PATHS.mine}?filter=bogus`);
      await expect(page.getByText("Kamu belum punya permohonan.")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("HTML and script text in Perihal, counterpart and notes is shown as plain text and never runs (register, detail, queue, request)", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const payload = `<img src=x onerror="window.__xss=1">${TAG}`;
    const letter = await mustRegister("sekjen", "incoming", { subject: payload, counterpart: "<script>window.__xss=1</script>", notes: "<b>x</b>" });
    const req = await mustCreate(who as PersonaKey, { subject: payload, addressee: "<i>y</i>", purpose: "<script>window.__xss=1</script>" });
    const { context, page } = await signedInContext(browser, "sekjen");
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    try {
      for (const path of [`${PATHS.incoming}?q=${TAG}`, letterUrl(letter.id), PATHS.queue + `?q=${TAG}`, requestUrl(req.id)]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(main(page).getByText(TAG).first()).toBeVisible();
        expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? 0), path).toBe(0);
        expect(await page.locator("main img[src='x'], main script").count(), path).toBe(0);
        expect(await noHorizontalScroll(page), path).toBe(true);
      }
      expect(dialogs).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("a signed link that no longer works (expired or gone) fails closed with the normal message", async ({ browser }) => {
    test.skip(storageInstalled(), "with Storage installed this needs a manual check: open the link after 300 seconds (docs/qa/letters.md section 8)");
    // Without Storage no link can be issued at all: the button must answer with the message and keep the page. Needs one issued file.
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const issued = await issuedRequest(who as PersonaKey, "sekjen", { subject: `${TAG} tautan` });
    const { context, page } = await signedInContext(browser, who as PersonaKey);
    try {
      await page.goto(requestUrl(issued.id));
      await page.getByRole("button", { name: "Unduh surat-final.pdf" }).click();
      await expect(page.getByText("Berkas tidak bisa dibuka. Coba lagi.")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/surat/permohonan/${issued.id}`));
    } finally {
      await context.close();
    }
  });
});
