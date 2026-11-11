// Letters: who may see and do what (spec section 2, LT-01..LT-06, LT-09, LT-34, LT-36, LT-37, LT-41, LT-46).
// Every persona is checked three ways: the screens (segments, buttons ABSENT, forbidden pages), the NEXUS route
// handlers and Server Actions called directly, and the database functions / tables called with the persona's own token.
import { expect, test } from "@playwright/test";
import { signedInContext } from "./helpers";
import {
  awayFromMidnight,
  callAction,
  warmUpActionPages,
  drawerItems,
  EXPORT,
  expectForbiddenScreen,
  letterRow,
  LETTERS_ITEM,
  main,
  mustCreate,
  mustRegister,
  memberId,
  emailOf,
  ORIGIN,
  PATHS,
  q,
  qn,
  reqRow,
  requestUrl,
  requesterWithRoom,
  rpcAs,
  sectionLabels,
  letterUrl,
  issueUrl,
  sweepQa,
  tableAs,
  tag,
  UPLOAD,
  type PersonaKey,
  type Who,
} from "./surat-helpers";

const TAG = tag();
test.afterAll(async () => {
  await sweepQa(TAG);
});

// What each persona may do, written from spec section 2 (not computed from the code under test).
type Expect = { sections: string[]; register: boolean; manage: boolean; queue: boolean; process: boolean; exportReg: boolean; numbering: "edit" | "read" | "none" };
const MEMBER: Expect = { sections: [], register: false, manage: false, queue: false, process: false, exportReg: false, numbering: "none" };
const BPH_VIEW: Expect = { sections: ["Surat Masuk", "Surat Keluar", "Permohonan Saya", "Antrean"], register: true, manage: false, queue: true, process: false, exportReg: true, numbering: "none" };
const SECRETARY: Expect = { ...BPH_VIEW, manage: true, process: true, numbering: "read" };
const PERSONAS_UI: [PersonaKey, string, Expect][] = [
  ["regular", "regular member (Staff IT)", MEMBER],
  ["pembina", "lecturer without an assignment (P-LECT)", MEMBER],
  ["admin", "System Admin without a BPH position (P-ADMIN): no register, but edits numbering", { ...MEMBER, numbering: "edit" }],
  ["sekdep", "department secretary (P-SEKDEP): NO letter keys (B17)", MEMBER],
  ["kabiro", "Kepala Biro (head, no letter key)", MEMBER],
  ["kadep", "Operations head (no letter key)", MEMBER],
  ["staffOps", "Operations staff (no letter key)", MEMBER],
  ["bendahara", "Treasurer, Bendahara Umum 1 (BPH view only)", BPH_VIEW],
  ["ketum", "BPH, Ketua Umum (view only)", BPH_VIEW],
  ["sekjen", "BPH secretary, Sekretaris Jenderal", SECRETARY],
  ["sekum1", "BPH secretary, Sekretaris Umum 1", SECRETARY],
];

// Fixtures are created lazily, once per worker: Playwright starts a fresh worker after a failed test, and module state
// does not survive that, so a plain "setup" test would leave the rest of the file without its data.
let requester: PersonaKey = "regular";
let otherRequestId = "";
let letterId = "";
let ready = false;
async function setup() {
  if (ready) return;
  await awayFromMidnight();
  const who = requesterWithRoom(2, ["sekdep"]);
  test.skip(who === null, "no requester has daily room left; rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1");
  requester = who!;
  otherRequestId = (await mustCreate(requester, { subject: `${TAG} Permintaan orang lain` })).id;
  letterId = (await mustRegister("sekjen", "incoming", { subject: `${TAG} Surat uji akses`, counterpart: "QA Pengirim" })).id;
  expect(letterRow(letterId).status).toBe("active");
  ready = true;
}

test.describe("LT-46, LT-02, LT-03: screens per persona (drawer item for all, tabs by key, buttons absent, forbidden pages)", () => {
  for (const [persona, label, want] of PERSONAS_UI) {
    test(`${persona} (${label})`, async ({ browser }) => {
      await setup();
      test.setTimeout(180_000);
      const { context, page } = await signedInContext(browser, persona);
      try {
        await page.goto("/");
        // The drawer item shows for EVERY active member, once (D-025)
        expect((await drawerItems(page)).filter((t) => t === LETTERS_ITEM)).toHaveLength(1);

        // /surat lands on the first segment the person has: Surat Masuk for register holders, Permohonan Saya otherwise (G13)
        await page.goto("/surat");
        await expect(page).toHaveURL(want.register ? /\/surat\/masuk$/ : /\/surat\/saya$/);
        expect(await sectionLabels(page)).toEqual(want.sections);
        // Everyone active can request (L9)
        await page.goto(PATHS.mine);
        await expect(page.getByRole("link", { name: "Ajukan Surat" }).first()).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: LETTERS_ITEM })).toBeVisible();

        // Register tabs
        for (const path of [PATHS.incoming, PATHS.outgoing]) {
          const res = await page.goto(path);
          expect(res?.status()).toBe(200);
          if (want.register) {
            await expect(page.getByText("Tidak punya akses", { exact: true })).toHaveCount(0);
            await expect(page.getByRole("heading", { level: 1, name: LETTERS_ITEM })).toBeVisible();
            // "Catat ..." only with letters.manage; absent (not greyed) otherwise
            const add = page.getByRole("link", { name: /^Catat Surat (Masuk|Keluar)$/ });
            if (want.manage) await expect(add).toHaveCount(1);
            else await expect(add).toHaveCount(0);
            // "Ekspor" only with letters.export
            if (want.exportReg) await expect(page.locator("summary:visible", { hasText: "Ekspor" })).toHaveCount(1);
            else await expect(page.locator("summary", { hasText: "Ekspor" })).toHaveCount(0);
          } else {
            await expectForbiddenScreen(page);
            // Nothing of the register leaks into the shell
            await expect(page.getByText(/PMK\/NEX\/S[MK]\//)).toHaveCount(0);
            await expect(page.getByText(`${TAG} Surat uji akses`)).toHaveCount(0);
          }
        }

        // Forms and detail pages of the register
        for (const path of [PATHS.registerIncoming, PATHS.registerOutgoing, `${letterUrl(letterId)}/ubah`]) {
          await page.goto(path);
          if (want.manage) await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          else await expectForbiddenScreen(page);
        }
        await page.goto(letterUrl(letterId));
        if (want.register) {
          await expect(page.getByText(`${TAG} Surat uji akses`).first()).toBeVisible();
          // Detail actions: only managers
          const buttons = page.getByRole("button", { name: "Batalkan nomor" });
          const links = page.getByRole("link", { name: "Ubah rincian" });
          if (want.manage) {
            await expect(buttons).toHaveCount(1);
            await expect(links).toHaveCount(1);
          } else {
            await expect(buttons).toHaveCount(0);
            await expect(links).toHaveCount(0);
          }
        } else {
          await expectForbiddenScreen(page);
          await expect(page.getByText(`${TAG} Surat uji akses`)).toHaveCount(0);
        }

        // Queue and review of somebody else's request
        await page.goto(PATHS.queue);
        if (want.queue) await expect(page.getByRole("heading", { level: 1, name: LETTERS_ITEM })).toBeVisible();
        else await expectForbiddenScreen(page);
        await page.goto(issueUrl(otherRequestId));
        if (want.process) await expect(page.getByText("Tidak punya akses", { exact: true })).toHaveCount(0);
        else await expectForbiddenScreen(page);

        await page.goto(requestUrl(otherRequestId));
        if (persona === requester) {
          // The requester always reads their OWN request (L9), whatever else they may or may not do
          await expect(page.getByText(`${TAG} Permintaan orang lain`).first()).toBeVisible();
          await expect(page.getByRole("button", { name: /Proses permohonan|Ambil nomor|Tolak permohonan/ })).toHaveCount(0);
        } else if (want.queue) {
          await expect(page.getByText(`${TAG} Permintaan orang lain`).first()).toBeVisible();
          // Action buttons: only processors, and "Tolak" never for view-only BPH
          if (want.process) {
            await expect(page.getByRole("button", { name: "Proses permohonan" })).toBeVisible();
            await expect(page.getByRole("button", { name: "Tolak permohonan" })).toBeVisible();
          } else {
            await expect(page.getByRole("button", { name: /Proses permohonan|Ambil nomor|Tolak permohonan/ })).toHaveCount(0);
            await expect(page.getByRole("link", { name: "Terbitkan surat" })).toHaveCount(0);
          }
        } else {
          // Somebody else's request is "not found", exactly like a request that does not exist (AC-27): no hint it exists
          await expect(page.getByText("Permohonan ini tidak ditemukan.")).toBeVisible();
          await expect(page.getByText(`${TAG} Permintaan orang lain`)).toHaveCount(0);
        }

        // Numbering settings: admin edits, letters.manage reads, everybody else gets the no-permission page
        await page.goto(PATHS.numbering);
        if (want.numbering === "none") await expectForbiddenScreen(page);
        else {
          await expect(page.getByRole("heading", { level: 1, name: "Penomoran Surat" })).toBeVisible();
          if (want.numbering === "edit") {
            await expect(page.getByRole("button", { name: "Simpan format" })).toBeVisible();
            await expect(page.getByRole("button", { name: /Atur nomor berikutnya/ }).first()).toBeVisible();
          } else {
            await expect(page.getByRole("button", { name: "Simpan format" })).toHaveCount(0);
            await expect(page.getByRole("button", { name: /Atur nomor berikutnya/ })).toHaveCount(0);
            await expect(page.getByText("Hanya System Admin yang bisa mengubah penomoran.")).toBeVisible();
          }
        }
      } finally {
        await context.close();
      }
    });
  }

  test("a malformed or unknown id is 'not found', never a crash or a leak (every persona that may open the page)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "sekjen");
    try {
      for (const path of ["/surat/not-a-guid", "/surat/00000000-0000-0000-0000-000000000000", "/surat/permohonan/xyz", "/surat/permohonan/00000000-0000-0000-0000-000000000000", "/surat/permohonan/xyz/terbitkan"]) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBeLessThan(500);
        await expect(page.getByText(/tidak ditemukan/).first()).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
});

test.describe("LT-04: deactivated, unlinked and anonymous get nothing", () => {
  for (const persona of ["inactive", "unlinked"] as const) {
    test(`${persona}: 'Belum ada akses' on every letters URL, never a letter or a request (each URL gets a fresh context: the screen drops the session)`, async ({ browser }) => {
      await setup();
      const urls = [PATHS.mine, PATHS.incoming, PATHS.outgoing, PATHS.queue, PATHS.form, PATHS.registerIncoming, PATHS.numbering, letterUrl(letterId), requestUrl(otherRequestId)];
      for (const path of urls) {
        const { context, page } = await signedInContext(browser, persona);
        try {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1, name: "Belum ada akses" })).toBeVisible();
          await expect(page.getByText(/PMK\/NEX\/S[MK]\/|QA Pengirim/)).toHaveCount(0);
          await expect(page.getByRole("link", { name: /Ajukan Surat|Antrean|Catat Surat/ })).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    });
  }

  test("anonymous: redirected to login; routes answer 401/403/405 and write nothing", async ({ page, request }) => {
    for (const path of [PATHS.mine, PATHS.incoming, PATHS.numbering, letterUrl("00000000-0000-0000-0000-000000000000")]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    const exp = await request.post(EXPORT, { data: { format: "csv", filters: { type: "incoming" } }, headers: { origin: ORIGIN } });
    expect([401, 403]).toContain(exp.status());
    const up = await request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") } }, headers: { origin: ORIGIN } });
    expect([401, 403]).toContain(up.status());
    // The error body is a code only
    expect(JSON.stringify(await exp.json())).not.toMatch(/PMK\/NEX|stack|select |nexus\./i);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-01..LT-04, LT-09, LT-41: database functions called with each persona's own token", () => {
  const readers: PersonaKey[] = ["ketum", "bendahara", "sekjen", "sekum1"];
  const nonReaders: PersonaKey[] = ["regular", "pembina", "admin", "sekdep", "kabiro", "kadep", "staffOps", "inactive", "unlinked"];

  test("letter_list / letter_detail / letter_year_list / letter_dashboard_counts: only letters.view (BPH, secretaries)", async () => {
    await setup();
    for (const who of readers) {
      const list = await rpcAs(who, "letter_list", { p_type: "incoming" });
      expect(list.ok, `${who}: ${JSON.stringify(list.body)}`).toBe(true);
      expect((await rpcAs(who, "letter_detail", { p_letter_id: letterId })).ok, who).toBe(true);
      expect((await rpcAs(who, "letter_dashboard_counts")).ok, who).toBe(true);
    }
    for (const who of [...nonReaders, "anon"] as Who[]) {
      for (const [fn, args] of [
        ["letter_list", { p_type: "incoming" }],
        ["letter_detail", { p_letter_id: letterId }],
        ["letter_year_list", { p_type: "incoming" }],
        ["letter_dashboard_counts", {}],
      ] as const) {
        const r = await rpcAs(who, fn, args);
        expect(r.ok, `${who} ${fn} must be refused: ${JSON.stringify(r.body).slice(0, 120)}`).toBe(false);
        expect(JSON.stringify(r.body), `${who} ${fn}`).not.toContain(`${TAG} Surat uji akses`);
      }
    }
  });

  test("letter writes (register, update, void, files, numbering): only BPH secretaries; the System Admin and BPH view-only cannot (LT-02, LT-03)", async () => {
    await setup();
    const before = qn("select count(*) from nexus.letters");
    for (const who of ["ketum", "bendahara", "regular", "pembina", "admin", "sekdep", "kadep", "inactive", "unlinked", "anon"] as Who[]) {
      const reg = await rpcAs(who, "letter_register", { p_type: "outgoing", p_subject: `${TAG} liar`, p_counterpart: "x", p_letter_date: new Date().toISOString().slice(0, 10) });
      expect(reg.ok, `${who} register`).toBe(false);
      const v = Number(letterRow(letterId).version);
      expect((await rpcAs(who, "letter_update", { p_letter_id: letterId, p_version: v, p_subject: "diubah liar", p_counterpart: "x", p_received_date: new Date().toISOString().slice(0, 10) })).ok, `${who} update`).toBe(false);
      expect((await rpcAs(who, "letter_void", { p_letter_id: letterId, p_version: v, p_reason: "liar" })).ok, `${who} void`).toBe(false);
      expect((await rpcAs(who, "letter_add_files", { p_letter_id: letterId, p_version: v, p_files: [] })).ok, `${who} add files`).toBe(false);
    }
    expect(qn("select count(*) from nexus.letters")).toBe(before);
    const row = letterRow(letterId);
    expect(row.status).toBe("active");
    expect(row.subject).toBe(`${TAG} Surat uji akses`);
  });

  test("numbering settings: read by admin and secretaries, written by the System Admin only (LT-41)", async () => {
    for (const who of ["admin", "sekjen", "sekum1"] as PersonaKey[]) expect((await rpcAs(who, "letter_numbering_settings")).ok, who).toBe(true);
    for (const who of ["ketum", "bendahara", "regular", "pembina", "sekdep", "inactive", "unlinked", "anon"] as Who[]) {
      expect((await rpcAs(who, "letter_numbering_settings")).ok, `${who} read`).toBe(false);
      expect((await rpcAs(who, "letter_numbering_history")).ok, `${who} history`).toBe(false);
    }
    const settings = JSON.parse(q("select row_to_json(s) from nexus.letter_numbering_settings s limit 1"));
    const changes = qn("select count(*) from nexus.letter_numbering_changes");
    for (const who of ["sekjen", "sekum1", "ketum", "regular", "sekdep", "anon"] as Who[]) {
      const fmt = await rpcAs(who, "letter_numbering_update_format", {
        p_version: settings.version ?? 1, p_prefix: "HACK", p_incoming_code: "XX", p_outgoing_code: "YY", p_seq_digits: 3, p_separator: "/", p_include_year: true, p_reason: null,
      });
      expect(fmt.ok, `${who} update_format`).toBe(false);
      const next = await rpcAs(who, "letter_numbering_set_next", { p_type: "outgoing", p_year: 2026, p_next_seq: 9000, p_reason: "liar" });
      expect(next.ok, `${who} set_next`).toBe(false);
    }
    expect(qn("select count(*) from nexus.letter_numbering_changes")).toBe(changes);
    expect(q("select prefix from nexus.letter_numbering_settings limit 1")).not.toBe("HACK");
  });

  test("requests: the queue only for view_all; processing only for process holders, never on their own request (LT-02, LT-09, LT-11)", async () => {
    await setup();
    for (const who of ["ketum", "bendahara", "sekjen", "sekum1"] as PersonaKey[]) {
      expect((await rpcAs(who, "letter_request_queue")).ok, `${who} queue`).toBe(true);
      expect((await rpcAs(who, "letter_request_detail", { p_request_id: otherRequestId })).ok, `${who} detail`).toBe(true);
    }
    for (const who of ["regular", "pembina", "admin", "sekdep", "kadep", "inactive", "unlinked", "anon"] as Who[]) {
      if (who === requester) continue;
      expect((await rpcAs(who, "letter_request_queue")).ok, `${who} queue`).toBe(false);
      const detail = await rpcAs(who, "letter_request_detail", { p_request_id: otherRequestId });
      expect(detail.ok, `${who} must not read somebody else's request`).toBe(false);
      if (who !== "anon") expect(["request_not_found", "permission_required", "not_active_member"], `${who}: ${JSON.stringify(detail.body)}`).toContain(detail.hint);
      else expect([401, 403]).toContain(detail.status);
      expect(JSON.stringify(detail.body)).not.toContain(`${TAG} Permintaan orang lain`);
    }
    // Processing: view-only BPH and plain members are refused; the status never moves
    for (const who of ["ketum", "bendahara", "regular", "sekdep", "admin"] as PersonaKey[]) {
      if (who === requester) continue;
      const r = await rpcAs(who, "letter_request_process", { p_request_id: otherRequestId, p_version: reqRow(otherRequestId).version, p_note: null });
      expect(r.ok, `${who} process`).toBe(false);
      expect(r.hint, who).toBe("permission_required");
      expect((await rpcAs(who, "letter_request_reject", { p_request_id: otherRequestId, p_version: reqRow(otherRequestId).version, p_note: "liar" })).ok, `${who} reject`).toBe(false);
    }
    expect(reqRow(otherRequestId).status).toBe("submitted");
    // Somebody else cannot cancel it either (AC-30)
    for (const who of ["ketum", "sekjen", "regular", "admin"] as PersonaKey[]) {
      if (who === requester) continue;
      const r = await rpcAs(who, "letter_request_cancel", { p_request_id: otherRequestId, p_version: reqRow(otherRequestId).version, p_reason: null });
      expect(r.ok, `${who} cancel`).toBe(false);
    }
    expect(reqRow(otherRequestId).status).toBe("submitted");
  });

  test("a member sees only their OWN requests in 'Permohonan Saya' (AC-27); the secretary sees every request in the queue", async () => {
    await setup();
    const mine = await rpcAs("sekdep", "letter_my_requests");
    expect(mine.ok).toBe(true);
    const rows = Array.isArray(mine.body) ? mine.body : [];
    for (const r of rows) expect(r.subject ?? "").not.toContain(`${TAG} Permintaan orang lain`);
    const queue = await rpcAs("sekjen", "letter_request_queue", { p_view: "all" });
    expect(JSON.stringify(queue.body)).toContain(`${TAG} Permintaan orang lain`);
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("LT-34, LT-36, LT-43: direct table access and delete are refused for everyone, even secretaries and the admin", () => {
  const TABLES = ["letters", "letter_files", "letter_requests", "letter_history", "letter_request_history", "letter_number_counters", "letter_numbering_settings", "letter_numbering_changes", "letter_export_logs"];

  // What a SELECT may return, per table and persona (policies: letters.view, own or view_all requests, manage / admin for numbering).
  const SELECT_RULES: { table: string; allowed: (who: Who) => "none" | "own" | "any" }[] = [
    { table: "letters", allowed: (w) => (["ketum", "bendahara", "sekjen", "sekum1"].includes(w) ? "any" : "none") },
    { table: "letter_history", allowed: (w) => (["ketum", "bendahara", "sekjen", "sekum1"].includes(w) ? "any" : "none") },
    { table: "letter_requests", allowed: (w) => (["ketum", "bendahara", "sekjen", "sekum1"].includes(w) ? "any" : w === "anon" ? "none" : "own") },
    { table: "letter_request_history", allowed: (w) => (["ketum", "bendahara", "sekjen", "sekum1"].includes(w) ? "any" : w === "anon" ? "none" : "own") },
    { table: "letter_files", allowed: (w) => (["ketum", "bendahara", "sekjen", "sekum1"].includes(w) ? "any" : w === "anon" ? "none" : "own") },
    { table: "letter_numbering_settings", allowed: (w) => (["admin", "sekjen", "sekum1"].includes(w) ? "any" : "none") },
    { table: "letter_number_counters", allowed: (w) => (["admin", "sekjen", "sekum1"].includes(w) ? "any" : "none") },
    { table: "letter_numbering_changes", allowed: (w) => (["admin", "sekjen", "sekum1"].includes(w) ? "any" : "none") },
    // The export log has no read policy at all: nobody reads it through the API (the log screen comes later)
    { table: "letter_export_logs", allowed: () => "none" },
  ];

  test("SELECT through the REST API returns only what the policies allow: nothing for outsiders, own requests for members", async () => {
    await setup();
    for (const who of ["regular", "pembina", "sekdep", "admin", "ketum", "sekjen", "anon"] as Who[]) {
      const me = who === "anon" ? "" : memberId(emailOf(who));
      const ownRequestIds = who === "anon" ? [] : q(`select id from nexus.letter_requests where requester_member_id = '${me}'`).split("\n").filter(Boolean);
      for (const { table, allowed } of SELECT_RULES) {
        const r = await tableAs(who, "GET", `${table}?select=*&limit=200`);
        const rows: Record<string, unknown>[] = Array.isArray(r.body) ? r.body : [];
        const mode = allowed(who);
        const label = `${who} read ${table}: status ${r.status}, ${rows.length} rows`;
        if (mode === "none") expect(!r.ok || rows.length === 0, label).toBe(true);
        if (mode === "own" && table === "letter_requests") for (const row of rows) expect(row.requester_member_id, label).toBe(me);
        if (mode === "own" && table === "letter_request_history") for (const row of rows) expect(ownRequestIds, label).toContain(row.request_id);
        if (mode === "own" && table === "letter_files") {
          for (const row of rows) {
            expect(row.letter_id, `${label}: a member never reads register files`).toBeNull();
            expect(ownRequestIds, label).toContain(row.request_id);
          }
        }
        // No member is ever exposed through a row: no email, phone, NIM, NIP column on any table of the module
        for (const row of rows) expect(Object.keys(row).join(","), label).not.toMatch(/email|phone|nim|nip/i);
      }
    }
  });

  test("INSERT, UPDATE and DELETE through the REST API change nothing, with any token (history is written only by the functions)", async () => {
    await setup();
    const snapshot = () => TABLES.map((t) => qn(`select count(*) from nexus.${t}`)).join(",");
    const subjectBefore = letterRow(letterId).subject;
    const before = snapshot();
    for (const who of ["sekjen", "sekum1", "admin", "ketum", "regular", "anon"] as Who[]) {
      for (const t of TABLES) {
        await tableAs(who, "DELETE", `${t}?id=gt.0`);
        await tableAs(who, "DELETE", `${t}?created_at=lt.2999-01-01`);
        await tableAs(who, "PATCH", `${t}?created_at=lt.2999-01-01`, { subject: "liar", status: "voided", note: "liar" });
      }
      await tableAs(who, "POST", "letters", { letter_type: "outgoing", subject: `${TAG} liar`, counterpart: "x" });
      await tableAs(who, "POST", "letter_history", { kind: "registered" });
      await tableAs(who, "POST", "letter_export_logs", { letter_type: "incoming", format: "csv" });
    }
    expect(snapshot()).toBe(before);
    expect(letterRow(letterId).subject).toBe(subjectBefore);
    expect(qn(`select count(*) from nexus.letters where subject like '${TAG} liar%'`)).toBe(0);
  });

  test("the database itself blocks delete, update and truncate by triggers, not only by missing policies (read-only catalog check, LT-34, LT-43)", () => {
    // Read-only on purpose: no destructive statement is ever run, even inside a rolled-back block.
    const triggers = q("select string_agg(c.relname || '.' || t.tgname, ',') from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'nexus' and c.relname like 'letter%' and not t.tgisinternal").split(",");
    for (const t of ["letters", "letter_files", "letter_requests", "letter_number_counters", "letter_numbering_settings"]) {
      expect(triggers, t).toContain(`${t}.${t}_no_delete`);
      expect(triggers, t).toContain(`${t}.${t}_no_truncate`);
    }
    for (const t of ["letter_history", "letter_request_history", "letter_export_logs", "letter_numbering_changes"]) {
      expect(triggers, t).toContain(`${t}.${t}_no_change`);
      expect(triggers, t).toContain(`${t}.${t}_no_truncate`);
    }
    // RLS is on for every table of the module, and no policy lets anybody write to the append-only tables directly
    for (const t of TABLES) expect(q(`select relrowsecurity from pg_class where oid = 'nexus.${t}'::regclass`), t).toBe("t");
    expect(q("select count(*) from pg_policies where schemaname = 'nexus' and tablename like 'letter%' and cmd in ('DELETE','UPDATE','INSERT','ALL')")).toBe("0");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe("routes and Server Actions called directly obey the same keys (CLAUDE.md 6: never only hide in the UI)", () => {
  test("export route: BPH and secretaries yes; others 403; GET/PUT/DELETE 405; cross-origin refused (LT-37)", async ({ browser }) => {
    const body = { format: "csv", filters: { type: "incoming" } };
    for (const who of ["regular", "pembina", "admin", "sekdep", "kadep"] as PersonaKey[]) {
      const { context } = await signedInContext(browser, who);
      try {
        const logs = qn("select count(*) from nexus.letter_export_logs");
        const res = await context.request.post(EXPORT, { data: body, headers: { origin: ORIGIN } });
        expect(res.status(), who).toBe(403);
        expect(qn("select count(*) from nexus.letter_export_logs"), `${who}: a refused export writes no log row`).toBe(logs);
        expect(JSON.stringify(await res.json())).toBe('{"error":{"code":"forbidden"}}');
      } finally {
        await context.close();
      }
    }
    const { context } = await signedInContext(browser, "ketum");
    try {
      for (const method of ["get", "put", "delete", "patch"] as const) {
        const res = await context.request[method](EXPORT, { headers: { origin: ORIGIN } });
        expect(res.status(), method).toBe(405);
      }
      const logs = qn("select count(*) from nexus.letter_export_logs");
      const cross = await context.request.post(EXPORT, { data: body, headers: { origin: "https://evil.example" } });
      expect(cross.status()).toBe(403);
      expect(qn("select count(*) from nexus.letter_export_logs")).toBe(logs);
    } finally {
      await context.close();
    }
  });

  test("upload route: needs a session and an active period; an inactive member gets nothing", async ({ browser }) => {
    for (const who of ["inactive", "unlinked"] as PersonaKey[]) {
      const { context } = await signedInContext(browser, who);
      try {
        const res = await context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") } }, headers: { origin: ORIGIN } });
        expect(res.status(), who).toBe(403);
      } finally {
        await context.close();
      }
    }
    const { context } = await signedInContext(browser, "regular");
    try {
      for (const method of ["get", "put", "delete"] as const) expect((await context.request[method](UPLOAD, { headers: { origin: ORIGIN } })).status(), method).toBe(405);
      const cross = await context.request.post(UPLOAD, { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") } }, headers: { origin: "https://evil.example" } });
      expect(cross.status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test("registerLetter, voidLetter, processRequest, setNextNumber as plain member, BPH view-only, admin: forbidden; nothing changes", async ({ browser }) => {
    await setup();
    const regular = await signedInContext(browser, "regular");
    const bph = await signedInContext(browser, "ketum");
    const admin = await signedInContext(browser, "admin");
    const secretary = await signedInContext(browser, "sekum1");
    try {
      await warmUpActionPages(secretary.context, { letterId, requestId: otherRequestId });
      const before = qn("select count(*) from nexus.letters");
      const register = [{ type: "outgoing", subject: `${TAG} aksi liar`, counterpart: "x", letterDate: "2026-01-01", legacyNumber: null, files: [] }];
      for (const ctx of [regular.context, bph.context, admin.context]) expect(await callAction(ctx, "registerLetter", register)).toContain('"forbidden"');
      const version = Number(letterRow(letterId).version);
      for (const ctx of [regular.context, bph.context, admin.context]) {
        expect(await callAction(ctx, "voidLetter", [{ letterId, version, reason: "liar" }])).toContain('"forbidden"');
        expect(await callAction(ctx, "updateLetter", [{ type: "incoming", letterId, version, subject: "liar", counterpart: "x", receivedDate: "2026-01-01" }])).toContain('"forbidden"');
      }
      const proc = [{ requestId: otherRequestId, version: Number(reqRow(otherRequestId).version), note: null }];
      for (const ctx of [regular.context, bph.context, admin.context]) expect(await callAction(ctx, "processRequest", proc)).toContain('"forbidden"');
      const next = [{ type: "outgoing", year: 2026, nextSeq: 9000, reason: "liar" }];
      for (const ctx of [regular.context, bph.context, secretary.context]) expect(await callAction(ctx, "setNextNumber", next)).toContain('"forbidden"');
      expect(qn("select count(*) from nexus.letters")).toBe(before);
      expect(letterRow(letterId).status).toBe("active");
      expect(reqRow(otherRequestId).status).toBe("submitted");
      // Sanity: the same channel works for the secretary who holds the key
      const ok = await callAction(secretary.context, "registerLetter", [{ ...register[0], subject: `${TAG} aksi sah` }]);
      expect(ok).toContain('"ok":true');
      expect(qn(`select count(*) from nexus.letters where subject = '${TAG} aksi sah'`)).toBe(1);
    } finally {
      for (const c of [regular, bph, admin, secretary]) await c.context.close();
    }
  });

  test("processing your own request through the Server Action is refused with self_processing_blocked (LT-11), the other secretary succeeds", async ({ browser }) => {
    await setup();
    const own = await mustCreate("sekjen", { subject: `${TAG} Surat sekjen sendiri` });
    const sekjen = await signedInContext(browser, "sekjen");
    const sekum1 = await signedInContext(browser, "sekum1");
    try {
      await warmUpActionPages(sekjen.context, { letterId, requestId: own.id });
      const args = [{ requestId: own.id, version: Number(reqRow(own.id).version), note: null }];
      expect(await callAction(sekjen.context, "processRequest", args)).toContain("self_processing_blocked");
      expect(reqRow(own.id).status).toBe("submitted");
      expect(await callAction(sekum1.context, "processRequest", args)).toContain('"ok":true');
      expect(reqRow(own.id).status).toBe("processing");
    } finally {
      await sekjen.context.close();
      await sekum1.context.close();
    }
  });
});

test.describe("LT-05: switching rule D15-D23 off removes the power on the next request, with no logout", () => {
  test("disable D16 and D19 and D22 (process): the queue's action buttons vanish for sekjen; the database refuses processing; rules are restored", async ({ browser }) => {
    await setup();
    const { context, page } = await signedInContext(browser, "sekum1");
    try {
      await page.goto(requestUrl(otherRequestId));
      await expect(page.getByRole("button", { name: "Proses permohonan" })).toBeVisible();
      q("update nexus.access_rules set is_enabled = false where default_code in ('D16','D19','D22')");
      await page.reload();
      // Still a viewer (letter_requests.view_all comes from BPH D08), but no actions
      await expect(page.getByText(`${TAG} Permintaan orang lain`).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Proses permohonan" })).toHaveCount(0);
      const r = await rpcAs("sekum1", "letter_request_process", { p_request_id: otherRequestId, p_version: reqRow(otherRequestId).version, p_note: null });
      expect(r.ok).toBe(false);
      expect(r.hint).toBe("permission_required");
      // Rule D15/D18/D21 (manage) still on: registering still works
      await page.goto(PATHS.incoming);
      await expect(page.getByRole("link", { name: "Catat Surat Masuk" })).toBeVisible();
      q("update nexus.access_rules set is_enabled = false where default_code in ('D15','D18','D21')");
      await page.reload();
      await expect(page.getByRole("link", { name: "Catat Surat Masuk" })).toHaveCount(0);
      expect((await rpcAs("sekum1", "letter_register", { p_type: "outgoing", p_subject: `${TAG} tanpa aturan`, p_counterpart: "x", p_letter_date: "2026-01-01" })).ok).toBe(false);
      await expect(main(page)).toBeVisible();
    } finally {
      q("update nexus.access_rules set is_enabled = true where default_code in ('D15','D16','D18','D19','D21','D22')");
      await context.close();
    }
  });
});
