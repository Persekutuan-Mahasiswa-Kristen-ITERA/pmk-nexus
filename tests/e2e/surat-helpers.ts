// Helpers for the Letters ("Surat Menyurat") E2E specs. LOCAL NEXUS stack only.
//
// Principles (same as inventaris-helpers.ts, docs/qa/letters.md section 2):
//  - Expected NUMBERS are read from the database at test time with read-only SELECTs and compared as deltas; the DB already
//    holds letters and requests from earlier manual checks, so nothing here assumes a fixed count.
//  - Setup data is created ONLY through the app's own database functions with the persona's real token (the same
//    functions the Server Actions call). Letters and requests are append-only by design: every subject carries a unique
//    "QA<tag>" prefix and `sweepQa()` ends what is still open (requests cancelled or rejected, QA letters voided).
//  - The daily request cap (10 per member per Jakarta day, L10 b) counts every request and requests cannot be deleted:
//    `requesterWithRoom()` spreads over several members and a test SKIPS (never fails) when nobody has room.
//    QA_RELIEVE_DAILY_CAP=1 (global-setup.ts) moves today's QA requests back by one day.
//  - Storage is OFF on the local stack, so a real upload never works here. Browser flows that need a file stub only the
//    upload route (`stubLetterUpload`); the database functions skip the object check when the storage schema is missing.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { getSession, PERSONAS, type PersonaKey } from "./helpers";
import {
  activePeriodId,
  addDays,
  awayFromMidnight,
  dialog,
  drawerItems,
  expectForbiddenScreen,
  jakartaToday,
  main,
  memberId,
  noHorizontalScroll,
  ORIGIN,
  q,
  qjson,
  qn,
  row,
  rpcAs,
  tableAs,
  tokenOf,
  type Rpc,
  type Who,
} from "./inventaris-helpers";

export {
  activePeriodId,
  addDays,
  awayFromMidnight,
  dialog,
  drawerItems,
  expectForbiddenScreen,
  jakartaToday,
  main,
  memberId,
  noHorizontalScroll,
  ORIGIN,
  PERSONAS,
  q,
  qjson,
  qn,
  row,
  rpcAs,
  tableAs,
  tokenOf,
  type PersonaKey,
  type Rpc,
  type Who,
};

export const LETTERS_ITEM = "Surat Menyurat";
export const PATHS = {
  incoming: "/surat/masuk",
  outgoing: "/surat/keluar",
  mine: "/surat/saya",
  queue: "/surat/antrean",
  form: "/surat/ajukan",
  registerIncoming: "/surat/catat/masuk",
  registerOutgoing: "/surat/catat/keluar",
  numbering: "/pengaturan/penomoran-surat",
} as const;
export const EXPORT = "/api/letters/export";
export const UPLOAD = "/api/letters/files";

export const tag = () => `QA${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;
export const emailOf = (p: PersonaKey) => PERSONAS[p].email;
export const nameOf = (p: PersonaKey) => q(`select full_name from public.members where email = '${PERSONAS[p].email}'`);

// ---------------------------------------------------------------------------------------------
// Read-only oracles
// ---------------------------------------------------------------------------------------------
export const reqRow = (id: string) => qjson(`select * from nexus.letter_requests where id = '${id}'`)[0];
export const reqStatus = (id: string) => q(`select status from nexus.letter_requests where id = '${id}'`);
export const reqVersion = (id: string) => Number(q(`select version from nexus.letter_requests where id = '${id}'`));
export const letterRow = (id: string) => qjson(`select * from nexus.letters where id = '${id}'`)[0];
export const letterByNumber = (numberText: string) => qjson(`select * from nexus.letters where number_text = '${numberText.replace(/'/g, "''")}'`)[0];
export const letterVersion = (id: string) => Number(q(`select version from nexus.letters where id = '${id}'`));
export const letterOfRequest = (requestId: string) => qjson(`select * from nexus.letters where source_request_id = '${requestId}'`)[0];
export const letterCount = (type: "incoming" | "outgoing") => qn(`select count(*) from nexus.letters where letter_type = '${type}'`);
export const activeLetterCount = (type: "incoming" | "outgoing") =>
  qn(`select count(*) from nexus.letters where letter_type = '${type}' and status = 'active' and period_id = (select id from public.periods where is_active)`);
export const exportLogMaxId = () => qn("select coalesce(max(id), 0) from nexus.letter_export_logs");
export const exportLogsAfter = (id: number) => qjson(`select * from nexus.letter_export_logs where id > ${id} order by id`);
export const exportLogCount = () => qn("select count(*) from nexus.letter_export_logs");
export const timeline = (requestId: string) =>
  qjson<{ event: string; from_status: string | null; to_status: string | null; note: string | null }>(
    `select event, from_status, to_status, note from nexus.letter_request_history where request_id = '${requestId}' order by id`,
  );
export const letterHistory = (letterId: string) =>
  qjson<{ kind: string; note: string | null; before_data: any; after_data: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
    `select kind, note, before_data, after_data from nexus.letter_history where letter_id = '${letterId}' order by id`,
  );
export const storageInstalled = () => q("select to_regclass('storage.objects') is not null") === "t";

/** Requests a member created today (Jakarta day); the daily cap counts every status. */
export const createdTodayBy = (email: string) =>
  qn(`select count(*) from nexus.letter_requests r where r.requester_member_id = (select id from public.members where email = '${email}') and nexus._jakarta_date(r.created_at) = nexus._lt_today()`);
export const openBy = (email: string) =>
  qn(`select count(*) from nexus.letter_requests r where r.requester_member_id = (select id from public.members where email = '${email}') and r.status in ('submitted','processing')`);

/** Members who are plain requesters: no letter key at all (so never BPH), and not sekjen / sekum1 (the processors) or sekdep (kept empty). */
export const REQUESTER_POOL: PersonaKey[] = ["regular", "pembina", "kabiro", "admin", "kadep", "kadivLogistik", "staffOps"];
export function requesterWithRoom(room: number, exclude: PersonaKey[] = []): PersonaKey | null {
  const ranked = REQUESTER_POOL.filter((p) => !exclude.includes(p)).sort((a, b) => createdTodayBy(emailOf(a)) - createdTodayBy(emailOf(b)));
  return ranked.find((p) => createdTodayBy(emailOf(p)) + room <= 10 && openBy(emailOf(p)) + room <= 5) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Fake uploaded files (the local stack has no Storage, so the object check is skipped by the database)
// ---------------------------------------------------------------------------------------------
export type FileRef = { path: string; name: string };
/** A well-formed path in the uploader's OWN folder, exactly what the upload route would answer. */
export function fakeFile(owner: PersonaKey, name = "surat.pdf", ext: "pdf" | "jpg" | "png" = "pdf"): FileRef {
  return { path: `${memberId(emailOf(owner))}/${randomUUID()}.${ext}`, name };
}

// ---------------------------------------------------------------------------------------------
// Fixtures and actions through the app's database functions
// ---------------------------------------------------------------------------------------------
export type NewRequest = { subject?: string; addressee?: string; purpose?: string; onBehalfOf?: string | null; neededBy?: string | null; files?: FileRef[] };
export async function createRequest(by: PersonaKey, r: NewRequest = {}): Promise<{ rpc: Rpc; id: string }> {
  const res = await rpcAs(by, "letter_request_create", {
    p_subject: r.subject ?? "QA perihal uji",
    p_addressee: r.addressee ?? "QA Pihak Tujuan",
    p_purpose: r.purpose ?? "QA keperluan pengujian",
    p_on_behalf_of: r.onBehalfOf ?? null,
    p_needed_by: r.neededBy ?? null,
    p_files: r.files ?? null,
  });
  return { rpc: res, id: res.ok ? row(res).request_id : "" };
}
export async function mustCreate(by: PersonaKey, r: NewRequest = {}) {
  const made = await createRequest(by, r);
  // The daily cap and the open cap are owner rules (L10 b), not test failures: say so and skip.
  if (!made.rpc.ok && ["daily_request_limit", "too_many_open_requests"].includes(made.rpc.hint ?? "")) {
    test.skip(true, `${by} hit a request cap (${made.rpc.hint}); rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1`);
  }
  expect(made.rpc.ok, JSON.stringify(made.rpc.body)).toBe(true);
  return made;
}
export const cancelAs = (who: PersonaKey, id: string, reason: string | null = null) =>
  rpcAs(who, "letter_request_cancel", { p_request_id: id, p_version: reqVersion(id), p_reason: reason });
export const processAs = (who: PersonaKey, id: string, note: string | null = null) =>
  rpcAs(who, "letter_request_process", { p_request_id: id, p_version: reqVersion(id), p_note: note });
export const takeNumberAs = (who: PersonaKey, id: string) => rpcAs(who, "letter_request_take_number", { p_request_id: id, p_version: reqVersion(id) });
export const rejectAs = (who: PersonaKey, id: string, note: string | null) =>
  rpcAs(who, "letter_request_reject", { p_request_id: id, p_version: reqVersion(id), p_note: note });
export async function issueAs(who: PersonaKey, id: string, files: FileRef[], over: { subject?: string; addressee?: string; letterDate?: string; note?: string | null } = {}) {
  const letter = letterOfRequest(id);
  return rpcAs(who, "letter_request_issue", {
    p_request_id: id,
    p_version: reqVersion(id),
    p_letter_version: letter ? Number(letter.version) : 1,
    p_subject: over.subject ?? (letter ? letter.subject : "QA"),
    p_addressee: over.addressee ?? (letter ? letter.counterpart : "QA"),
    p_letter_date: over.letterDate ?? jakartaToday(),
    p_files: files,
    p_note: over.note ?? null,
  });
}
/** submit -> Proses -> Ambil nomor. Returns the request id and the taken number. */
export async function takenRequest(requester: PersonaKey, processor: PersonaKey = "sekjen", r: NewRequest = {}) {
  const made = await mustCreate(requester, r);
  const proc = await processAs(processor, made.id);
  expect(proc.ok, JSON.stringify(proc.body)).toBe(true);
  const taken = await takeNumberAs(processor, made.id);
  expect(taken.ok, JSON.stringify(taken.body)).toBe(true);
  return { ...made, numberText: row(taken).number_text as string, letterId: row(taken).letter_id as string };
}
/** The whole way to Diterbitkan. */
export async function issuedRequest(requester: PersonaKey, processor: PersonaKey = "sekjen", r: NewRequest = {}) {
  const taken = await takenRequest(requester, processor, r);
  const file = fakeFile(processor, "surat-final.pdf");
  const issued = await issueAs(processor, taken.id, [file]);
  expect(issued.ok, JSON.stringify(issued.body)).toBe(true);
  return { ...taken, file };
}

export async function registerAs(who: PersonaKey, type: "incoming" | "outgoing", o: { subject?: string; counterpart?: string; letterDate?: string | null; receivedDate?: string | null; counterpartNumber?: string | null; notes?: string | null; files?: FileRef[]; legacy?: string | null } = {}) {
  return rpcAs(who, "letter_register", {
    p_type: type,
    p_subject: o.subject ?? "QA perihal register",
    p_counterpart: o.counterpart ?? "QA Pihak",
    p_letter_date: o.letterDate === undefined ? (type === "outgoing" ? jakartaToday() : null) : o.letterDate,
    p_received_date: o.receivedDate === undefined ? (type === "incoming" ? jakartaToday() : null) : o.receivedDate,
    p_counterpart_number: o.counterpartNumber ?? null,
    p_notes: o.notes ?? null,
    p_files: o.files ?? null,
    p_legacy_number: o.legacy ?? null,
  });
}
export async function mustRegister(who: PersonaKey, type: "incoming" | "outgoing", o: Parameters<typeof registerAs>[2] = {}) {
  const r = await registerAs(who, type, o);
  expect(r.ok, JSON.stringify(r.body)).toBe(true);
  return { id: row(r).letter_id as string, numberText: row(r).number_text as string, version: Number(row(r).version) };
}
export const voidAs = (who: PersonaKey, id: string, reason: string | null = "QA bersih-bersih") =>
  rpcAs(who, "letter_void", { p_letter_id: id, p_version: letterVersion(id), p_reason: reason });

/**
 * Best-effort cleanup: ends every open QA request (Diajukan: cancelled by the requester; Diproses: rejected by a
 * secretary who is not the requester, which also voids its letter) and voids the QA letters that are still Aktif.
 * Never throws.
 */
export async function sweepQa(prefix: string) {
  try {
    const open = qjson<{ id: string; status: string; email: string }>(
      `select r.id, r.status, m.email from nexus.letter_requests r join public.members m on m.id = r.requester_member_id
       where r.status in ('submitted','processing') and r.subject like '${prefix}%'`,
    );
    for (const r of open) {
      const persona = (Object.keys(PERSONAS) as PersonaKey[]).find((k) => PERSONAS[k].email === r.email);
      if (r.status === "submitted" && persona) await cancelAs(persona, r.id);
      else await rejectAs(persona === "sekjen" ? "sekum1" : "sekjen", r.id, "QA bersih-bersih");
    }
    const letters = qjson<{ id: string }>(`select id from nexus.letters where subject like '${prefix}%' and status = 'active' and period_id = (select id from public.periods where is_active)`);
    for (const l of letters) await voidAs("sekjen", l.id);
  } catch {
    /* cleanup is best-effort */
  }
}

// ---------------------------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------------------------
export const sections = (page: Page) => page.getByRole("navigation", { name: "Bagian surat menyurat" }).getByRole("link");
/** Segment labels without the "(n)" count. */
export async function sectionLabels(page: Page): Promise<string[]> {
  await expect(page.getByRole("heading", { level: 1, name: LETTERS_ITEM })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Bagian surat menyurat" });
  if ((await nav.count()) === 0) return [];
  return (await sections(page).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim().replace(/\s*\(\d+\)$/, ""));
}
export const requestUrl = (id: string) => `/surat/permohonan/${id}`;
export const letterUrl = (id: string) => `/surat/${id}`;
export const issueUrl = (id: string) => `/surat/permohonan/${id}/terbitkan`;

/** Fills a date input the way the browser reports it, waiting for React to hydrate that input first. */
export async function fillDate(page: Page, label: string | RegExp, iso: string) {
  const input = page.getByLabel(label);
  await input.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const ready = () => Object.keys(el).some((k) => k.startsWith("__reactProps$"));
        if (ready()) return resolve();
        const timer = setInterval(() => ready() && (clearInterval(timer), resolve()), 25);
        setTimeout(() => (clearInterval(timer), resolve()), 8_000);
      }),
  );
  await expect(async () => {
    await input.fill(iso);
    await expect(input).toHaveValue(iso, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
/** Types into a text field after hydration (a value typed earlier is wiped by React). */
export async function fillText(page: Page, label: string | RegExp, value: string) {
  const input = page.getByLabel(label);
  await input.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const ready = () => Object.keys(el).some((k) => k.startsWith("__reactProps$"));
        if (ready()) return resolve();
        const timer = setInterval(() => ready() && (clearInterval(timer), resolve()), 25);
        setTimeout(() => (clearInterval(timer), resolve()), 8_000);
      }),
  );
  await expect(async () => {
    await input.fill(value);
    await expect(input).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Answers the upload route like the real one would (the local stack has no Storage): the well-formed path in the
 * caller's own folder, the cleaned name and the declared type. The route's own checks are tested with the real route.
 */
export async function stubLetterUpload(page: Page, owner: PersonaKey) {
  const folder = memberId(emailOf(owner));
  await page.route(`**${UPLOAD}`, async (route: Route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const name = /filename="([^"]*)"/.exec(body)?.[1] ?? "berkas.pdf";
    const type = /Content-Type: (application\/pdf|image\/jpeg|image\/png)/i.exec(body)?.[1] ?? "application/pdf";
    const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: `${folder}/${randomUUID()}.${ext}`, name, sizeBytes: 1234, mimeType: type }),
    });
  });
}

/** Smallest valid files by real type (magic bytes), sized to taste. */
export const PDF_BYTES = (extra = 0) => Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"), Buffer.alloc(extra, 0x20)]);
export const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const JPEG_BYTES = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

/** POSTs a small valid PDF to the real upload route with a signed-in context (same origin, like the browser). */
export async function postUploadAs(context: BrowserContext, file = { name: "surat.pdf", mimeType: "application/pdf", buffer: PDF_BYTES() }) {
  const res = await context.request.post(UPLOAD, { multipart: { file }, headers: { origin: ORIGIN } });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as { error?: { code: string }; path?: string } };
}
export { getSession };

// ---------------------------------------------------------------------------------------------
// Server Actions called directly (the Next-Action header), exactly what any logged-in outsider could send
// ---------------------------------------------------------------------------------------------
type Manifest = { node: Record<string, { exportedName?: string; filename?: string; workers?: Record<string, unknown> }> };
function manifestFile(): string {
  // `next dev` writes its own manifest under .next/dev; `next start` reads .next/server. Use the newest one.
  const candidates = [".next/dev/server/server-reference-manifest.json", ".next/server/server-reference-manifest.json"].filter(existsSync);
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
/** The action id and a URL of a page that uses it (a Server Action is looked up per page). */
export function serverActionTarget(name: string): { id: string; path: string } {
  const manifest = JSON.parse(readFileSync(manifestFile(), "utf8")) as Manifest;
  // inventory and letters both export submitRequest / cancelRequest / ...: pick the one in the letters actions file
  const hit = Object.entries(manifest.node).find(([, v]) => v.exportedName === name && /surat|letters/.test(v.filename ?? ""));
  if (!hit) throw new Error(`letters server action ${name} not found in the build manifest (open its page once first)`);
  const page = Object.keys(hit[1].workers ?? {}).find((w) => w.includes("/surat") || w.includes("/pengaturan"));
  if (!page) throw new Error(`no page uses ${name}`);
  const path = page.replace(/^app/, "").replace(/\/\([^)]+\)/g, "").replace(/\/page$/, "").replace(/\[id\]/g, "00000000-0000-4000-8000-000000000000");
  return { id: hit[0], path };
}
/** Opens every page that hosts a letters action once, so `next dev` has compiled it and listed it in the manifest. */
export async function warmUpActionPages(context: BrowserContext, ids: { letterId: string; requestId: string }) {
  for (const path of [PATHS.form, PATHS.registerIncoming, PATHS.registerOutgoing, PATHS.numbering, letterUrl(ids.letterId), requestUrl(ids.requestId), issueUrl(ids.requestId), `${letterUrl(ids.letterId)}/ubah`]) {
    await context.request.get(path).catch(() => null);
  }
}
export async function callAction(context: BrowserContext, name: string, args: unknown[]): Promise<string> {
  const { id, path } = serverActionTarget(name);
  const res = await context.request.post(path, {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", origin: ORIGIN, accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  return await res.text();
}
