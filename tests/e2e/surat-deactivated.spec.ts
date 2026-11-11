// Letters: a requester or a secretary who is deactivated (R8, R9, R10, LT-32, LT-33, design G12).
// Pattern of inventaris-deactivated.spec.ts: the account is flipped for a moment and always restored in `finally`
// (global-setup.ts restores it too if a run died).
import { expect, test } from "@playwright/test";
import { setActive, signedInContext } from "./helpers";
import {
  awayFromMidnight,
  emailOf,
  fakeFile,
  issueAs,
  letterOfRequest,
  mustCreate,
  nameOf,
  PATHS,
  processAs,
  requestUrl,
  reqStatus,
  requesterWithRoom,
  rpcAs,
  sweepQa,
  tag,
  takeNumberAs,
  timeline,
  type PersonaKey,
} from "./surat-helpers";

const TAG = tag();
const restore = (who: PersonaKey) => setActive(emailOf(who), true);
test.afterAll(async () => {
  for (const who of ["regular", "pembina", "kabiro", "admin", "kadep", "kadivLogistik", "staffOps", "sekjen", "sekum1"] as PersonaKey[]) restore(who);
  await sweepQa(TAG);
});

test.describe("R8, LT-32: the requester is deactivated while the request is open", () => {
  test("they lose access at once; the secretary sees the info marker, can still process and issue; the name and the file stay on the record", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left; rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1");
    const requester = who as PersonaKey;
    const made = await mustCreate(requester, { subject: `${TAG} pemohon dinonaktifkan` });
    const member = await signedInContext(browser, requester);
    const sec = await signedInContext(browser, "sekjen");
    try {
      await member.page.goto(requestUrl(made.id));
      await expect(member.page.getByRole("heading", { level: 1, name: `${TAG} pemohon dinonaktifkan` })).toBeVisible();

      setActive(emailOf(requester), false);

      // The member is out on the next request: no module page, no function
      await member.page.goto(PATHS.mine);
      await expect(member.page.getByRole("heading", { level: 1, name: "Belum ada akses" })).toBeVisible();
      const created = await rpcAs(requester, "letter_request_create", { p_subject: `${TAG} dari akun nonaktif`, p_addressee: "x", p_purpose: "y" });
      expect(created.ok).toBe(false);
      expect((await rpcAs(requester, "letter_my_requests")).ok).toBe(false);
      expect((await rpcAs(requester, "letter_request_cancel", { p_request_id: made.id, p_version: 1, p_reason: null })).ok).toBe(false);

      // The secretary sees the request with the requester's NAME (read from PI-CORE) and the info marker (G12)
      await sec.page.goto(requestUrl(made.id));
      await expect(sec.page.getByText(await nameOf(requester)).first()).toBeVisible();
      await expect(sec.page.getByText("Pemohon sudah tidak aktif. Permohonan tetap bisa diproses.")).toBeVisible();
      await sec.page.getByRole("button", { name: "Proses permohonan" }).click();
      await sec.page.getByRole("dialog").getByRole("button", { name: "Proses permohonan" }).click();
      await expect(sec.page.getByText("Permohonan diproses.")).toBeVisible();
      expect((await takeNumberAs("sekjen", made.id)).ok).toBe(true);
      const issued = await issueAs("sekjen", made.id, [fakeFile("sekjen", "final.pdf")]);
      expect(issued.ok, JSON.stringify(issued.body)).toBe(true);
      expect(reqStatus(made.id)).toBe("issued");
      expect(timeline(made.id).map((t) => t.event)).toEqual(["submitted", "processing", "number_taken", "issued"]);
      // The issued file and the register row stay (nothing is deleted)
      expect(letterOfRequest(made.id)).toBeTruthy();
      await sec.page.goto(requestUrl(made.id));
      await expect(sec.page.getByText(await nameOf(requester)).first()).toBeVisible();
    } finally {
      restore(requester);
      await member.context.close();
      await sec.context.close();
    }
    // Reactivated: the history is back in front of them, untouched
    const back = await signedInContext(browser, requester, { fresh: true });
    try {
      await back.page.goto(requestUrl(made.id));
      await expect(back.page.getByRole("button", { name: "Unduh final.pdf" })).toBeVisible();
    } finally {
      await back.context.close();
    }
  });

  test("a rejected request of a deactivated requester voids a taken number as usual (R8)", async ({ browser }) => {
    test.setTimeout(180_000);
    await awayFromMidnight();
    const who = requesterWithRoom(1);
    test.skip(who === null, "no requester has daily room left");
    const requester = who as PersonaKey;
    const made = await mustCreate(requester, { subject: `${TAG} dinonaktifkan lalu ditolak` });
    expect((await processAs("sekjen", made.id)).ok).toBe(true);
    const taken = await takeNumberAs("sekjen", made.id);
    expect(taken.ok).toBe(true);
    setActive(emailOf(requester), false);
    try {
      const sec = await signedInContext(browser, "sekum1");
      try {
        await sec.page.goto(requestUrl(made.id));
        await sec.page.getByRole("button", { name: "Tolak permohonan" }).click();
        await sec.page.getByLabel("Alasan penolakan (wajib)").fill("Pemohon sudah tidak aktif.");
        await sec.page.getByRole("dialog").getByRole("button", { name: "Tolak permohonan" }).click();
        await expect(sec.page.getByText(/^Permohonan ditolak\. Nomor .* dibatalkan di register\.$/)).toBeVisible();
      } finally {
        await sec.context.close();
      }
    } finally {
      restore(requester);
    }
    expect(reqStatus(made.id)).toBe("rejected");
    expect(letterOfRequest(made.id).status).toBe("voided");
  });
});

test.describe("R9, R10: a deactivated secretary leaves their records; the other secretary carries on", () => {
  test("Sekretaris Umum 1 deactivated: their records keep their name, the rights vanish at once, Sekretaris Jenderal still processes", async ({ browser }) => {
    test.setTimeout(240_000);
    await awayFromMidnight();
    const who = requesterWithRoom(2);
    test.skip(who === null, "no requester has daily room left");
    const requester = who as PersonaKey;
    const first = await mustCreate(requester, { subject: `${TAG} diproses sekum1` });
    const second = await mustCreate(requester, { subject: `${TAG} diproses sekjen` });
    expect((await processAs("sekum1", first.id)).ok).toBe(true);
    const sekum = await signedInContext(browser, "sekum1");
    const sekjen = await signedInContext(browser, "sekjen");
    try {
      await sekum.page.goto(PATHS.queue);
      await expect(sekum.page.getByRole("heading", { level: 1, name: "Surat Menyurat" })).toBeVisible();
      setActive(emailOf("sekum1"), false);
      await sekum.page.goto(PATHS.queue);
      await expect(sekum.page.getByRole("heading", { level: 1, name: "Belum ada akses" })).toBeVisible();
      expect((await takeNumberAs("sekum1", first.id)).ok).toBe(false);
      // The record still names them; the other secretary finishes it (a request is not tied to the person who accepted it)
      await sekjen.page.goto(requestUrl(first.id));
      await expect(sekjen.page.getByText(await nameOf("sekum1")).first()).toBeVisible();
      expect((await takeNumberAs("sekjen", first.id)).ok).toBe(true);
      expect((await processAs("sekjen", second.id)).ok).toBe(true);
      // Hint: Sekretaris Jenderal is now the ONLY processor (A-n9); the requester here is not a secretary, so no own-request hint, but the queue still opens
      await sekjen.page.goto(PATHS.queue);
      await expect(sekjen.page.getByRole("heading", { level: 1, name: "Surat Menyurat" })).toBeVisible();
    } finally {
      restore("sekum1");
      await sekum.context.close();
      await sekjen.context.close();
    }
  });
});
