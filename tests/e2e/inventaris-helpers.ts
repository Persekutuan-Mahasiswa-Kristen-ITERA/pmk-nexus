// Helpers for the Inventory and Borrowing ("Manajemen & Inventaris") E2E specs. LOCAL NEXUS stack only.
//
// Principles (docs/qa/inventory-borrowing.md section 2):
//  - Every expected NUMBER is read from the database at test time with read-only SELECTs (sql()).
//  - Setup data is created ONLY through the app's own database functions with the persona's real token
//    (the same functions the Server Actions call), never with INSERT/UPDATE on nexus tables. Data is
//    append-only by design, so it cannot be deleted: it carries a unique "QA<tag>" name, requests are
//    ended (cancelled or returned) and items are archived by `sweepQa()`.
//  - No sign-in beyond what getSession() caches (Auth budget 30 per 5 minutes).
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { API_URL, PUBLISHABLE_KEY, sql } from "../support/local-stack";
import { sharedStrings, unzip } from "../support/zip";
import { getSession, PERSONAS, type PersonaKey } from "./helpers";

export { sql, PERSONAS, type PersonaKey };

export const ORIGIN = "http://localhost:3100";
export const INVENTORY_ITEM = "Manajemen & Inventaris";
export const CATALOG_PATH = "/inventaris";
export const QUEUE_PATH = "/inventaris/antrean";
export const MINE_PATH = "/inventaris/saya";
export const MANAGE_PATH = "/inventaris/kelola";
export const REQUEST_FORM_PATH = "/inventaris/ajukan";
export const EXPORT_CATALOG = "/api/inventory/export";
export const EXPORT_BORROWING = "/api/inventory/borrowing/export";
export const EVIDENCE = "/api/inventory/evidence";

// ---------------------------------------------------------------------------------------------
// Dates. Independent of the code under test (the app has its own helpers in types.ts).
// ---------------------------------------------------------------------------------------------
export const jakartaToday = (now: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const secondsToJakartaMidnight = () => {
  const now = new Date();
  const [h, m, s] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .format(now)
    .split(":")
    .map(Number);
  return 86400 - (h * 3600 + m * 60 + s);
};
/**
 * "Today" is the Jakarta calendar day. A test that straddles midnight WIB would flip start-in-past, daily caps and
 * overdue. Call at the start of every stateful test: waits out the last `margin` seconds before midnight.
 */
export async function awayFromMidnight(margin = 150) {
  while (secondsToJakartaMidnight() < margin) await new Promise((r) => setTimeout(r, 5_000));
}

// ---------------------------------------------------------------------------------------------
// Direct database-API calls with a persona's token (what any logged-in outsider could send)
// ---------------------------------------------------------------------------------------------
export type Rpc = { status: number; ok: boolean; body: any; hint: string | undefined; code: string | undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Who = PersonaKey | "anon";

export async function tokenOf(who: PersonaKey): Promise<string> {
  return (await getSession(who)).accessToken;
}

function toRpc(res: Response, text: string): Rpc {
  let body: any = text; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, ok: res.ok, body, hint: body?.hint ?? undefined, code: body?.code ?? undefined };
}

export async function rpcAs(who: Who, fn: string, args: Record<string, unknown> = {}): Promise<Rpc> {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json", "Content-Profile": "nexus", "Accept-Profile": "nexus" };
  if (who !== "anon") headers.Authorization = `Bearer ${await tokenOf(who)}`;
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
  return toRpc(res, await res.text());
}

/** Direct table access through the REST API (must always be denied or empty for everyone). */
export async function tableAs(who: Who, method: "GET" | "DELETE" | "PATCH" | "POST", path: string, body?: unknown): Promise<Rpc> {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json", "Content-Profile": "nexus", "Accept-Profile": "nexus" };
  if (who !== "anon") headers.Authorization = `Bearer ${await tokenOf(who)}`;
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return toRpc(res, await res.text());
}

/** First row of a table-returning function (PostgREST answers an array). */
export const row = (r: Rpc) => (Array.isArray(r.body) ? r.body[0] : r.body);

// ---------------------------------------------------------------------------------------------
// Read-only oracles
// ---------------------------------------------------------------------------------------------
export const q = (statement: string) => sql(statement);
export const qn = (statement: string) => Number(sql(statement));
export const qjson = <T = any>(statement: string): T[] => JSON.parse(sql(`select coalesce(json_agg(t), '[]'::json) from (${statement}) t`)) as T[]; // eslint-disable-line @typescript-eslint/no-explicit-any
export const memberId = (email: string) => q(`select id from public.members where email = '${email}'`);
export const activePeriodId = () => q("select id from public.periods where is_active");
export const reqRow = (id: string) => qjson(`select * from nexus.borrowing_requests where id = '${id}'`)[0];
export const reqByRef = (ref: string) => qjson(`select * from nexus.borrowing_requests where reference = '${ref}'`)[0];
export const reqStatus = (id: string) => q(`select status from nexus.borrowing_requests where id = '${id}'`);
export const reqVersion = (id: string) => Number(q(`select version from nexus.borrowing_requests where id = '${id}'`));
export const refOf = (id: string) => q(`select reference from nexus.borrowing_requests where id = '${id}'`);
export const lineIds = (id: string): string[] => q(`select id from nexus.borrowing_request_lines where request_id = '${id}' order by id`).split("\n").filter(Boolean);
export const lineOf = (id: string, itemId: string) => q(`select id from nexus.borrowing_request_lines where request_id = '${id}' and item_id = '${itemId}'`);
export const stockOf = (itemId: string, condition: string) => Number(q(`select quantity from nexus.inventory_stock where item_id = '${itemId}' and condition = '${condition}'`));
export const unitRow = (unitId: string) => qjson(`select * from nexus.inventory_units where id = '${unitId}'`)[0];
export const itemRow = (itemId: string) => qjson(`select * from nexus.inventory_items where id = '${itemId}'`)[0];
export const exportLogCount = () => qn("select count(*) from nexus.inventory_borrowing_export_logs");
export const exportLogMaxId = () => qn("select coalesce(max(id), 0) from nexus.inventory_borrowing_export_logs");
export const exportLogsAfter = (id: number) => qjson(`select * from nexus.inventory_borrowing_export_logs where id > ${id} order by id`);
/** Requests a member created today (Jakarta day), read-only; the daily cap counts every status. */
export const createdTodayBy = (email: string) =>
  qn(`select count(*) from nexus.borrowing_requests r where r.requester_member_id = (select id from public.members where email = '${email}') and nexus._jakarta_date(r.created_at) = nexus._ib_today()`);
export const openSubmittedBy = (email: string) =>
  qn(`select count(*) from nexus.borrowing_requests r where r.requester_member_id = (select id from public.members where email = '${email}') and r.status = 'submitted'`);
/** Members who may borrow in tests and are NOT Operations or heads, so they are always "just a requester". */
export const REQUESTER_POOL: PersonaKey[] = ["regular", "pembina", "kabiro", "bendahara", "admin", "ketum"];
export const emailOf = (p: PersonaKey) => PERSONAS[p].email;
export const nameOf = (p: PersonaKey) => q(`select full_name from public.members where email = '${PERSONAS[p].email}'`);
/**
 * Picks the pooled requester with the most daily room left (the 20-requests-per-day cap counts every request ever made
 * today and requests cannot be deleted, so a repeated run must spread over several members). Skips the test when none
 * has `room` requests left.
 */
export function requesterWithRoom(room: number, exclude: PersonaKey[] = []): PersonaKey | null {
  const ranked = REQUESTER_POOL.filter((p) => !exclude.includes(p)).sort((a, b) => createdTodayBy(emailOf(a)) - createdTodayBy(emailOf(b)));
  return ranked.find((p) => createdTodayBy(emailOf(p)) + room <= 20 && openSubmittedBy(emailOf(p)) + 3 <= 5) ?? null;
}
export const storageInstalled = () => q("select to_regclass('storage.objects') is not null") === "t";

// ---------------------------------------------------------------------------------------------
// Fixtures through the app's database functions
// ---------------------------------------------------------------------------------------------
export const tag = () => `QA${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;

export type Qty = { id: string; code: string; name: string };
export type Tracked = { id: string; name: string; codes: string[]; unitIds: string[] };

export async function createQtyItem(name: string, stock: { good?: number; needs_service?: number; damaged?: number } = { good: 10 }, by: PersonaKey = "staffOps"): Promise<Qty> {
  const r = await rpcAs(by, "inventory_item_create", { p_mode: "quantity", p_name: name, p_stock: { good: 0, needs_service: 0, damaged: 0, ...stock } });
  expect(r.ok, JSON.stringify(r.body)).toBe(true);
  return { id: row(r).item_id, code: row(r).item_code, name };
}
export async function createTrackedItem(name: string, conditions: string[] = ["good", "good", "good"], by: PersonaKey = "staffOps"): Promise<Tracked> {
  const r = await rpcAs(by, "inventory_item_create", { p_mode: "tracked", p_name: name, p_units: conditions.map((condition) => ({ condition })) });
  expect(r.ok, JSON.stringify(r.body)).toBe(true);
  const codes: string[] = row(r).unit_codes;
  const unitIds = q(`select id from nexus.inventory_units where item_id = '${row(r).item_id}' order by code`).split("\n");
  return { id: row(r).item_id, name, codes: [...codes].sort(), unitIds };
}

export type NewRequest = { start?: string; end?: string; purpose?: string; note?: string; lines: { itemId: string; quantity: number }[]; org?: string; contact?: string };
export async function createRequest(by: PersonaKey, r: NewRequest): Promise<{ rpc: Rpc; id: string; ref: string }> {
  const start = r.start ?? jakartaToday();
  const res = await rpcAs(by, "borrowing_request_create", {
    p_start_date: start,
    p_end_date: r.end ?? addDays(start, 1),
    p_purpose: r.purpose ?? "QA pengujian",
    p_lines: r.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
    p_note: r.note ?? null,
    p_outside_org_name: r.org ?? null,
    p_outside_contact_name: r.contact ?? null,
  });
  const first = res.ok ? row(res) : null;
  return { rpc: res, id: first?.request_id ?? "", ref: first?.reference ?? "" };
}
export async function mustCreate(by: PersonaKey, r: NewRequest) {
  const made = await createRequest(by, r);
  // The daily cap (20 per member per Jakarta day) is an owner rule, not a test failure: say so and skip.
  if (!made.rpc.ok && made.rpc.hint === "daily_request_limit") test.skip(true, `${by} is at the daily request cap (20 per Jakarta day); rerun after midnight WIB or with QA_RELIEVE_DAILY_CAP=1`);
  expect(made.rpc.ok, JSON.stringify(made.rpc.body)).toBe(true);
  return made;
}
export const approveAs = (who: PersonaKey, id: string, opts: { note?: string; lines?: { line_id: string; quantity: number }[] } = {}) =>
  rpcAs(who, "borrowing_request_approve", { p_request_id: id, p_version: reqVersion(id), p_note: opts.note ?? null, p_lines: opts.lines ?? null });
export const rejectAs = (who: PersonaKey, id: string, note: string | null) =>
  rpcAs(who, "borrowing_request_reject", { p_request_id: id, p_version: reqVersion(id), p_note: note });
export const cancelAs = (who: PersonaKey, id: string, reason: string | null = null) =>
  rpcAs(who, "borrowing_request_cancel", { p_request_id: id, p_version: reqVersion(id), p_reason: reason });
export const extendAs = (who: PersonaKey, id: string, newEnd: string, note: string | null = "QA perpanjangan") =>
  rpcAs(who, "borrowing_request_extend", { p_request_id: id, p_version: reqVersion(id), p_new_end_date: newEnd, p_note: note });
export const handOverAs = (who: PersonaKey, id: string, lines: Record<string, unknown>[], note: string | null = null) =>
  rpcAs(who, "borrowing_request_hand_over", { p_request_id: id, p_version: reqVersion(id), p_lines: lines, p_note: note });
export const returnAs = (who: PersonaKey, id: string, outcomes: Record<string, unknown>[]) =>
  rpcAs(who, "borrowing_request_return", { p_request_id: id, p_version: reqVersion(id), p_outcomes: outcomes });
export const correctAs = (who: PersonaKey, id: string, reason: string | null = "QA koreksi") =>
  rpcAs(who, "borrowing_request_correct_return", { p_request_id: id, p_version: reqVersion(id), p_reason: reason });

/** submit -> approve (head) -> hand over (Operations) for a quantity item. Returns the request id and ref. */
export async function lendQty(requester: PersonaKey, item: Qty, quantity: number, opts: { head?: PersonaKey; handler?: PersonaKey; start?: string; end?: string } = {}) {
  const made = await mustCreate(requester, { lines: [{ itemId: item.id, quantity }], start: opts.start, end: opts.end });
  const approved = await approveAs(opts.head ?? (requester === "kadep" ? "kadivLogistik" : "kadep"), made.id);
  expect(approved.ok, JSON.stringify(approved.body)).toBe(true);
  const handed = await handOverAs(opts.handler ?? "staffOps", made.id, [{ line_id: lineOf(made.id, item.id), quantity }]);
  expect(handed.ok, JSON.stringify(handed.body)).toBe(true);
  return made;
}

/**
 * Best-effort cleanup of everything a spec made: cancels open QA requests that are not yet on loan, archives the QA
 * items that no longer have open lines. Never throws. Borrowed requests must be returned by the test itself.
 */
export async function sweepQa(prefix: string) {
  try {
    const open = qjson<{ id: string; status: string; requester_member_id: string; email: string }>(
      `select r.id, r.status, r.requester_member_id, m.email from nexus.borrowing_requests r join public.members m on m.id = r.requester_member_id
       where r.status in ('submitted','approved') and exists (select 1 from nexus.borrowing_request_lines l join nexus.inventory_items i on i.id = l.item_id where l.request_id = r.id and i.name like '${prefix}%')`,
    );
    for (const r of open) {
      if (r.status === "approved") await cancelAs("staffOps", r.id, "QA bersih-bersih");
      else {
        const persona = (Object.keys(PERSONAS) as PersonaKey[]).find((k) => PERSONAS[k].email === r.email);
        if (persona) await cancelAs(persona, r.id);
      }
    }
    const items = qjson<{ id: string }>(`select id from nexus.inventory_items where name like '${prefix}%' and is_active`);
    for (const i of items) await rpcAs("staffOps", "inventory_item_set_active", { p_item_id: i.id, p_is_active: false, p_note: "QA bersih-bersih" });
  } catch {
    /* cleanup is best-effort */
  }
}

// ---------------------------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------------------------
export const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
export const main = (page: Page) => page.getByRole("main");
export const drawerLinks = (page: Page) => page.getByRole("dialog").getByRole("navigation", { name: "Menu utama" }).getByRole("link");
export async function drawerItems(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: "Buka menu" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const items = await drawerLinks(page).allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return items.map((t) => t.trim());
}
export const segments = (page: Page) => page.getByRole("navigation", { name: "Bagian inventaris" }).getByRole("link");
export async function segmentLabels(page: Page): Promise<string[]> {
  await expect(segments(page).first()).toBeVisible();
  return (await segments(page).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim().replace(/\s*\(\d+\)$/, ""));
}
export const requestUrl = (ref: string) => `/inventaris/pengajuan/${ref}`;
export const dialog = (page: Page) => page.getByRole("dialog");

export async function expectForbiddenScreen(page: Page) {
  await expect(page.getByText("Tidak punya akses", { exact: true })).toBeVisible();
  await expect(page.getByText("Kamu tidak punya akses ke halaman ini. Kalau kamu memerlukannya, hubungi admin PMK ITERA.")).toBeVisible();
}

/** A real JPEG made by the browser itself (canvas), so the magic bytes and the decoder are genuine. */
export async function makeJpeg(page: Page, size = 64): Promise<Buffer> {
  const b64 = await page.evaluate((s) => {
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const ctx = c.getContext("2d")!;
    for (let y = 0; y < s; y += 8) for (let x = 0; x < s; x += 8) {
      ctx.fillStyle = `rgb(${(x * 7) % 255},${(y * 5) % 255},${(x + y) % 255})`;
      ctx.fillRect(x, y, 8, 8);
    }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, size);
  return Buffer.from(b64, "base64");
}

/**
 * Local stack has no Supabase Storage (config.toml [storage] enabled = false), so a real upload can never succeed
 * here. For BROWSER flows that need a photo path, the evidence route is answered by this stub, which returns the
 * well-formed "<request id>/<uuid>.jpg" path the real route would return (the return function skips the object check
 * when the storage schema is absent). The route's own checks are tested separately with the real route.
 */
export async function stubEvidenceRoute(page: Page) {
  await page.route(`**${EVIDENCE}`, async (route: Route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const requestId = /name="requestId"\r\n\r\n([0-9a-f-]{36})/i.exec(body)?.[1]?.toLowerCase() ?? "";
    const uuid = crypto.randomUUID();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ path: `${requestId}/${uuid}.jpg` }) });
  });
}

/** Sets a date input the way the browser reports it (YYYY-MM-DD). */
export async function fillDate(page: Page, label: string, iso: string) {
  // The form is a client component: a value typed before hydration finishes is wiped, so retry until it sticks.
  // Wait for hydration of THIS input first (React attaches its props object to the element): a value set earlier is wiped.
  await page.getByLabel(label).evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const ready = () => Object.keys(el).some((k) => k.startsWith("__reactProps$"));
        if (ready()) return resolve();
        const timer = setInterval(() => ready() && (clearInterval(timer), resolve()), 25);
        setTimeout(() => (clearInterval(timer), resolve()), 8_000);
      }),
  );
  await expect(async () => {
    await page.getByLabel(label).fill(iso);
    await expect(page.getByLabel(label)).toHaveValue(iso, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------
/** All rows of sheet 1 as strings. The header row is the one that starts with "No". */
export function xlsxTable(path: string): { header: string[]; rows: string[][]; all: string[][] } {
  const files = unzip(readFileSync(path));
  const strings = sharedStrings(files);
  const xml = files["xl/worksheets/sheet1.xml"].toString("utf8");
  const all: string[][] = [];
  for (const r of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1] ?? "A";
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const inner = c[2] ?? "";
      let value = "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (/\bt="s"/.test(c[1]) && v !== undefined) value = strings[Number(v)];
      else if (/\bt="inlineStr"/.test(c[1])) value = (/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "").replace(/&amp;/g, "&");
      else if (v !== undefined) value = v;
      cells[col] = value;
    }
    all.push(Array.from(cells, (x) => x ?? ""));
  }
  const headerAt = all.findIndex((r) => r[0] === "No");
  return { header: all[headerAt] ?? [], rows: headerAt >= 0 ? all.slice(headerAt + 1).filter((r) => r.some((x) => x !== "")) : [], all };
}
