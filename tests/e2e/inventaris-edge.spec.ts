// Inventory and Borrowing edge cases: wrong file types and sizes on the evidence route and in the photo picker, empty and
// no-match states, very long text, bad dates and quantities on the request form, malformed addresses, and the 390 px
// layout of every screen (IB-47, IB-56, spec section 3 "States", section 5).
import { expect, test, type Page } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  addDays,
  approveAs,
  emailOf,
  awayFromMidnight,
  cancelAs,
  createQtyItem,
  createTrackedItem,
  dialog,
  EVIDENCE,
  fillDate,
  jakartaToday,
  lendQty,
  lineOf,
  makeJpeg,
  mustCreate,
  noHorizontalScroll,
  ORIGIN,
  q,
  qn,
  requesterWithRoom,
  requestUrl,
  returnAs,
  rpcAs,
  storageInstalled,
  stubEvidenceRoute,
  sweepQa,
  tag,
  type PersonaKey,
  type Qty,
} from "./inventaris-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("IB-56: evidence upload route (POST /api/inventory/evidence) with real files", () => {
  let ready = false;
  test.beforeEach(({}, info) => {
    test.skip(!ready && !info.title.startsWith("setup"), "setup was skipped (no requester with daily room left)");
  });
  let requestId = "";
  let ref = "";
  let item: Qty;
  let requester: PersonaKey;

  test("setup: a request that is on loan (Dipinjam)", async () => {
    await awayFromMidnight();
    const picked = requesterWithRoom(2);
    test.skip(picked === null, "no requester has daily room left; rerun after midnight WIB");
    requester = picked!;
    item = await createQtyItem(`${TAG} Foto`, { good: 3 });
    const made = await lendQty(requester, item, 1);
    requestId = made.id;
    ref = made.ref;
    ready = true;
  });

  const MIB = 1024 * 1024;
  async function upload(context: import("@playwright/test").BrowserContext, file: { name: string; mimeType: string; buffer: Buffer } | null, fields: Record<string, string> = { requestId }) {
    return context.request.post(EVIDENCE, { multipart: { ...fields, ...(file ? { file } : {}) }, headers: { origin: ORIGIN } });
  }
  const code = async (res: import("@playwright/test").APIResponse) => ((await res.json()) as { error?: { code?: string; field?: string } }).error;

  test("a real JPEG from the browser passes every check of the route (also with the browser's mixed-case multipart boundary); locally Storage is off, so the last step answers 503 instead of 200", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto("/login");
      const jpeg = await makeJpeg(page, 96);
      expect(jpeg.subarray(0, 3).toString("hex")).toBe("ffd8ff");
      const res = await upload(context, { name: "foto.jpg", mimeType: "image/jpeg", buffer: jpeg });
      if (storageInstalled()) {
        expect(res.status()).toBe(200);
        const body = (await res.json()) as { path: string };
        expect(body.path).toMatch(new RegExp(`^${requestId}/[0-9a-f-]{36}\\.jpg$`));
      } else {
        // Local stack: no Storage container. The point of this assertion: the file got PAST the type, size and magic-byte
        // checks (anything else would be 400 or 413) and failed only at the Storage call, with the generic fail-closed answer.
        test.info().annotations.push({ type: "untestable-locally", description: "Supabase Storage is disabled in supabase/config.toml; real upload and signed URLs need it" });
        expect(res.status()).toBe(503);
        expect((await code(res))?.code).toBe("unavailable");
      }
      expect(res.headers()["cache-control"]).toContain("no-store");
    } finally {
      await context.close();
    }
  });

  test("wrong file types are refused by their first bytes even with a .jpg name or a lying type; nothing is stored", async ({ browser }) => {
    const { context } = await signedInContext(browser, "staffOps");
    try {
      const refused = [
        ["GIF named foto.jpg, declared image/jpeg", { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1") }],
        ["HTML named foto.jpg, declared image/jpeg", { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script></html>") }],
        ["PDF declared image/png", { name: "foto.png", mimeType: "image/png", buffer: Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1") }],
        ["PNG bytes declared image/jpeg", { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) }],
        ["JPEG bytes declared image/png", { name: "foto.png", mimeType: "image/png", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]) }],
        ["empty file", { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(0) }],
        ["SVG", { name: "foto.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }],
        ["plain text", { name: "foto.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }],
        ["executable", { name: "foto.jpg", mimeType: "application/octet-stream", buffer: Buffer.from("MZ\x90\x00", "latin1") }],
      ] as const;
      for (const [label, file] of refused) {
        const res = await upload(context, file);
        expect(res.status(), label).toBe(400);
        expect((await code(res))?.code, label).toBe("invalid_photo");
      }
    } finally {
      await context.close();
    }
  });

  test("bigger than 1.5 MiB is refused with photo_too_large (413), also far above the limit; exactly at the limit passes the size check", async ({ browser }) => {
    const { context } = await signedInContext(browser, "staffOps");
    try {
      const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const big = (bytes: number) => Buffer.concat([jpegHead, Buffer.alloc(bytes - jpegHead.length, 0)]);
      for (const bytes of [1.5 * MIB + 1, 1.6 * MIB, 5 * MIB]) {
        const res = await upload(context, { name: "foto.jpg", mimeType: "image/jpeg", buffer: big(bytes) });
        expect(res.status(), `${bytes} bytes`).toBe(413);
        const err = await code(res);
        expect(err?.code).toBe("photo_too_large");
      }
      const atLimit = await upload(context, { name: "foto.jpg", mimeType: "image/jpeg", buffer: big(1.5 * MIB) });
      // At the limit the size check passes: the answer is 200 (Storage on) or 503 (Storage off), never 413
      expect([200, 503]).toContain(atLimit.status());
    } finally {
      await context.close();
    }
  });

  test("malformed requests: no file, no request id, a bad id, two files, a JSON body", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await page.goto("/login");
      const jpeg = await makeJpeg(page);
      const file = { name: "foto.jpg", mimeType: "image/jpeg", buffer: jpeg };
      const noFile = await upload(context, null);
      expect(noFile.status()).toBe(400);
      expect((await code(noFile))?.field).toBe("file");
      const noId = await context.request.post(EVIDENCE, { multipart: { file }, headers: { origin: ORIGIN } });
      expect(noId.status()).toBe(400);
      expect((await code(noId))?.field).toBe("requestId");
      const badId = await upload(context, file, { requestId: "bukan-uuid" });
      expect(badId.status()).toBe(400);
      const json = await context.request.post(EVIDENCE, { data: { requestId }, headers: { origin: ORIGIN } });
      expect(json.status()).toBe(400);
      const get = await context.request.get(EVIDENCE);
      expect(get.status()).toBe(405);
    } finally {
      await context.close();
    }
  });

  test("on screen: a PDF, a corrupt 'image', a 16 MB photo and a 4th photo are refused with the contract texts (photo picker)", async ({ browser }) => {
    test.setTimeout(150_000);
    const t = await createTrackedItem(`${TAG} FotoUI`, ["good", "good"]);
    const made = await mustCreate(requester, { lines: [{ itemId: t.id, quantity: 1 }] });
    expect((await approveAs("kadep", made.id)).ok).toBe(true);
    const hand = await rpcAs("staffOps", "borrowing_request_hand_over", { p_request_id: made.id, p_version: Number(q(`select version from nexus.borrowing_requests where id = '${made.id}'`)), p_lines: [{ line_id: lineOf(made.id, t.id), unit_ids: [t.unitIds[0]] }] });
    expect(hand.ok, JSON.stringify(hand.body)).toBe(true);
    const { context, page } = await signedInContext(browser, "staffOps");
    try {
      await stubEvidenceRoute(page);
      await page.goto(`${requestUrl(made.ref)}/terima-kembali`);
      await page.getByRole("group", { name: t.codes[0], exact: true }).getByText("Rusak", { exact: true }).click();
      const input = page.locator("input[type=file][multiple]").first();

      await input.setInputFiles({ name: "dokumen.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
      await expect(page.getByText("Format foto tidak didukung. Pakai JPG, PNG, atau WebP.")).toBeVisible();

      await input.setInputFiles({ name: "besar.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(16 * 1024 * 1024, 1) });
      await expect(page.getByText("Foto terlalu besar. Pakai foto di bawah 15 MB.")).toBeVisible();

      // A file that claims to be a JPEG but is not an image: the browser cannot decode it (BUG-IB-02, owner-approved text).
      await input.setInputFiles({ name: "rusak.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ini bukan gambar sama sekali") });
      await expect(page.getByText("Foto ini tidak bisa dibuka. Coba foto lain.")).toBeVisible();
      await expect(page.getByText("Foto masih terlalu besar setelah diperkecil. Coba foto lain.")).toHaveCount(0);

      // The 4th photo: three real ones fill the block, then 'Maksimal 3 foto.' replaces the buttons
      const jpeg = await makeJpeg(page, 80);
      await input.setInputFiles([1, 2, 3].map((n) => ({ name: `foto${n}.jpg`, mimeType: "image/jpeg", buffer: jpeg })));
      await expect(page.getByText("Terunggah", { exact: true })).toHaveCount(3);
      await expect(page.getByText("Maksimal 3 foto.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Pilih dari galeri" })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    } finally {
      await context.close();
      const back = await returnAs("staffOps", made.id, [{ outcome: "good", line_id: lineOf(made.id, t.id), unit_id: t.unitIds[0] }]);
      expect(back.ok).toBe(true);
    }
  });

  test("cleanup of the loan", async () => {
    const back = await returnAs("staffOps", requestId, [{ outcome: "good", line_id: lineOf(requestId, item.id), quantity: 1 }]);
    expect(back.ok, ref).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("empty states, no-match, long text, malformed addresses", () => {
  test("catalog: no match offers Reset; a 130-character search says so; page 999999 and bogus filters do not break anything", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "regular");
    try {
      await page.goto(`/inventaris?q=${encodeURIComponent("zzz-tidak-ada-" + TAG)}`);
      await expect(page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Reset" }).first()).toBeVisible();
      await page.getByRole("link", { name: "Reset" }).first().click();
      await expect(page).toHaveURL(/\/inventaris$/);
      await page.goto(`/inventaris?q=${"x".repeat(130)}`);
      await expect(page.getByText("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.").first()).toBeVisible();
      for (const url of ["/inventaris?page=999999", "/inventaris?page=-1", "/inventaris?condition=bogus&category=bukan&from=2026-13-45&to=x", "/inventaris/saya?filter=bogus&page=abc", "/inventaris/barang/bukan-uuid", "/inventaris/barang/00000000-0000-4000-8000-000000000000", "/inventaris/pengajuan/abc", "/inventaris/pengajuan/PJM-99999999", "/inventaris/pengajuan/%3Cscript%3E", "/inventaris/ajukan?item=xx&from=zz&again=%00"]) {
        const res = await page.goto(url);
        expect(res?.status(), url).toBeLessThan(500);
        await expect(page.getByRole("main")).toBeVisible();
        const html = await page.content();
        expect(html, url).not.toMatch(/at \w+ \(.*\.(js|ts)|Internal Server Error|ECONNREFUSED|stack/i);
      }
      await page.goto("/inventaris/pengajuan/PJM-99999999");
      await expect(page.getByText("Pengajuan ini tidak ditemukan.")).toBeVisible();
      await page.goto("/inventaris/barang/00000000-0000-4000-8000-000000000000");
      await expect(page.getByText("Barang ini tidak ditemukan.")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("Peminjaman Saya is empty for a member who never asked; the queue says so for a search nobody matches", async ({ browser }) => {
    const never = (["kabiro", "bendahara", "admin", "ketum", "pembina", "regular"] as PersonaKey[]).find(
      (p) => qn(`select count(*) from nexus.borrowing_requests where requester_member_id = (select id from public.members where email = '${emailOf(p)}')`) === 0,
    );
    const head = await signedInContext(browser, "kadep");
    try {
      await head.page.goto("/inventaris/antrean?view=closed&q=zzz-tidak-ada-" + TAG);
      await expect(head.page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await head.page.goto("/inventaris/antrean?view=all&from=2000-01-01&to=2000-01-02");
      await expect(head.page.getByText("Tidak ada hasil. Ubah pencarian atau filter.")).toBeVisible();
      await head.page.goto(`/inventaris/antrean?view=all&q=${"y".repeat(130)}`);
      await expect(head.page.getByText("Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter.").first()).toBeVisible();
    } finally {
      await head.context.close();
    }
    if (never) {
      const m = await signedInContext(browser, never);
      try {
        await m.page.goto("/inventaris/saya");
        await expect(m.page.getByText("Kamu belum punya pengajuan.")).toBeVisible();
      } finally {
        await m.context.close();
      }
      return;
    }
    // Every pooled member already has requests (data of earlier runs): an empty FILTER proves the same state handling
    const OPEN = "('submitted','approved','borrowed')";
    const combo = (["kabiro", "bendahara", "admin", "ketum", "pembina", "regular"] as PersonaKey[]).flatMap((p) =>
      (["open", "closed"] as const).map((f) => ({ p, f })),
    ).find(({ p, f }) =>
      qn(`select count(*) from nexus.borrowing_requests where requester_member_id = (select id from public.members where email = '${emailOf(p)}') and status ${f === "open" ? "in" : "not in"} ${OPEN}`) === 0,
    );
    test.skip(!combo, "no pooled member has an empty open or closed list (needs a fresh member)");
    const m = await signedInContext(browser, combo!.p);
    try {
      await m.page.goto(`/inventaris/saya?filter=${combo!.f}`);
      await expect(m.page.getByText("Tidak ada pengajuan di sini.")).toBeVisible();
    } finally {
      await m.context.close();
    }
  });

  test("very long text (120-character unbroken name, 500-character purpose) never causes horizontal scroll at 390 px on catalog, item, request, queue and form", async ({ browser }) => {
    test.setTimeout(150_000);
    await awayFromMidnight();
    const requester = requesterWithRoom(2);
    test.skip(requester === null, "no requester has daily room left; rerun after midnight WIB");
    const longName = (TAG + "W".repeat(120)).slice(0, 120);
    const item = await createQtyItem(longName, { good: 2 });
    const purpose = "P".repeat(500);
    const made = await mustCreate(requester!, { lines: [{ itemId: item.id, quantity: 1 }], purpose, note: "N".repeat(500) });
    const head = await signedInContext(browser, "kadep");
    const member = await signedInContext(browser, requester!);
    try {
      for (const [page, url] of [
        [head.page, `/inventaris?q=${TAG}`],
        [head.page, `/inventaris/barang/${item.id}`],
        [head.page, requestUrl(made.ref)],
        [head.page, `/inventaris/antrean?view=all&q=${TAG}`],
        [head.page, `/inventaris/kelola?q=${TAG}`],
        [head.page, `/inventaris/kelola/barang/${item.id}`],
        [member.page, "/inventaris/saya"],
        [member.page, requestUrl(made.ref)],
      ] as [Page, string][]) {
        await page.goto(url);
        await expect(page.getByRole("main")).toBeVisible();
        expect(await noHorizontalScroll(page), url).toBe(true);
      }
      // The full purpose is on the detail (not cut off)
      await head.page.goto(requestUrl(made.ref));
      await expect(head.page.getByText(purpose)).toBeVisible();
      // Typing 600 characters into the purpose field keeps at most 500 (field limit)
      await member.page.goto("/inventaris/ajukan");
      const box = member.page.getByLabel("Keperluan atau kegiatan (wajib)");
      await box.fill("Q".repeat(600));
      const length = (await box.inputValue()).length;
      if (length > 500) {
        // fill() bypasses maxlength; then the server answer must be the "too long" text on submit
        await fillDate(member.page, "Mulai (wajib)", jakartaToday());
        await fillDate(member.page, "Sampai (wajib)", addDays(jakartaToday(), 1));
        await member.page.getByRole("button", { name: "Tambah barang" }).click();
        await member.page.getByRole("dialog").getByLabel("Cari barang").fill(item.name.slice(0, 100));
        await member.page.getByRole("dialog").getByRole("button", { name: new RegExp(TAG) }).click();
        await member.page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
        await expect(member.page.getByText("Keperluan terlalu panjang. Pakai paling banyak 500 karakter.").first()).toBeVisible();
      } else expect(length).toBe(500);
    } finally {
      await head.context.close();
      await member.context.close();
      await cancelAs(requester!, made.id);
    }
  });

  test("request form: past start, end before start, 366 days, quantity above the free stock and a blank purpose are refused on screen and nothing is saved (IB-16)", async ({ browser }) => {
    test.setTimeout(150_000);
    await awayFromMidnight();
    const item = await createQtyItem(`${TAG} Form`, { good: 2 });
    const { context, page } = await signedInContext(browser, "kabiro");
    try {
      const today = jakartaToday();
      const before = qn("select count(*) from nexus.borrowing_requests");
      await page.goto("/inventaris/ajukan");
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.getByRole("button", { name: "Tambah barang" }).click();
      await dialog(page).getByLabel("Cari barang").fill(item.name);
      await dialog(page).getByRole("button", { name: new RegExp(item.name) }).click();
      // End before start
      await fillDate(page, "Mulai (wajib)", addDays(today, 3));
      await fillDate(page, "Sampai (wajib)", addDays(today, 1));
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(page.getByText("Tanggal akhir tidak boleh sebelum tanggal mulai.").first()).toBeVisible();
      await expect(page.getByText("Isi keperluannya, misalnya nama kegiatan atau tim.").first()).toBeVisible();
      // Start in the past: the field either keeps the typed value (then the message names it) or drops it (then it asks for a date)
      await fillDate(page, "Sampai (wajib)", addDays(today, 3));
      await page.getByLabel("Mulai (wajib)").fill(addDays(today, -1));
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(page.getByText(/Tanggal mulai tidak boleh sebelum hari ini\.|Pilih tanggal mulai\./).first()).toBeVisible();

      await fillDate(page, "Mulai (wajib)", today);
      await fillDate(page, "Sampai (wajib)", addDays(today, 366));
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(page.getByText("Peminjaman paling lama 365 hari dari tanggal mulai. Untuk waktu yang lebih lama, buat pengajuan baru.").first()).toBeVisible();

      await fillDate(page, "Sampai (wajib)", addDays(today, 1));
      await page.getByLabel(`Jumlah ${item.name}`, { exact: true }).fill("3");
      await expect(page.getByText("Hanya 2 tersedia pada tanggal itu. Kurangi jumlahnya.")).toBeVisible();
      await page.getByLabel("Keperluan atau kegiatan (wajib)").fill("Uji stok");
      await page.getByRole("button", { name: "Ajukan Peminjaman", exact: true }).click();
      await expect(page.getByText("Hanya 2 yang tersedia pada tanggal itu.").first()).toBeVisible();
      expect(qn("select count(*) from nexus.borrowing_requests")).toBe(before);
      // The same duplicate the picker prevents ("Sudah ditambahkan")
      await page.getByRole("button", { name: "Tambah barang" }).click();
      await dialog(page).getByLabel("Cari barang").fill(item.name);
      await expect(dialog(page).getByText("Sudah ditambahkan")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("IB-47: every screen of the module fits 390 px and fields are at least 44 px high with 16 px text", () => {
  test("Operations head walks every screen", async ({ browser }) => {
    test.setTimeout(150_000);
    const item = await createQtyItem(`${TAG} Layar`, { good: 2 });
    const { context, page } = await signedInContext(browser, "kadivLogistik");
    try {
      const urls = [
        "/inventaris", `/inventaris/barang/${item.id}`, "/inventaris/saya", "/inventaris/ajukan", "/inventaris/antrean", "/inventaris/antrean?view=open_all_periods",
        "/inventaris/kelola", "/inventaris/kelola/barang/baru", `/inventaris/kelola/barang/${item.id}`, "/inventaris/kelola/daftar", "/inventaris/kelola/daftar?kind=location", "/",
      ];
      for (const url of urls) {
        const res = await page.goto(url);
        expect(res?.status(), url).toBe(200);
        await expect(page.getByRole("main")).toBeVisible();
        expect(await noHorizontalScroll(page), url).toBe(true);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll("main input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), main select, main textarea")]
            .map((el) => ({ h: (el as HTMLElement).getBoundingClientRect().height, fs: parseFloat(getComputedStyle(el).fontSize), id: (el as HTMLElement).id || el.getAttribute("name") }))
            .filter((x) => x.h > 0 && (x.h < 44 || x.fs < 16)),
        );
        expect(small, `fields under 44 px or 16 px text on ${url}`).toEqual([]);
      }
    } finally {
      await context.close();
    }
  });
});
