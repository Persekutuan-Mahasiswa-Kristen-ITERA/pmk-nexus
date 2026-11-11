// Helpers for the Meeting Minutes (Notulensi Rapat) E2E specs. LOCAL NEXUS stack only (docs/qa/minutes.md).
//
// Principles (same as finance-helpers.ts and surat-helpers.ts):
//  - Expected NUMBERS come from read-only SELECTs at test time, compared as deltas. Nothing assumes an empty table.
//  - Setup data is made only through the app's own database functions with the persona's real token.
//  - Minutes are never deleted (L5). Every title carries a unique "QA<tag>" prefix and `sweepQa()` voids what is still
//    Aktif in the active period. Minutes recorded during a period switch stay behind in that period.
//  - Storage is OFF on the local stack, so a real upload never works here. Database functions skip the object check
//    when the storage schema is missing, so file paths are made up in the uploader's own folder (`fakeFile`).
//
// Personas and their minutes rights (default rules D04, D05, D17, D20, D23, D26, D27, D37), checked by a probe run:
//   sekjen, sekum1  BPH secretaries: view, manage and export ALL units
//   ketum, bendahara BPH: view and export all units, no manage
//   sekdep          Sekretaris Departemen, Departemen Internal: view, manage, export of that unit only
//   kadep, kabiro   Kepala Departemen / Biro (D37): view of their own unit only, no manage, no export
//   everybody else  nothing (regular, pembina, admin, kadivLogistik, staffOps, inactive, unlinked)
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { expect, type BrowserContext, type Page } from "@playwright/test";
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
  xlsxTable,
  type Rpc,
  type Who,
} from "./inventaris-helpers";
import { PERSONAS, type PersonaKey } from "./helpers";
import { fillDate } from "./surat-helpers";

export {
  activePeriodId,
  addDays,
  awayFromMidnight,
  dialog,
  drawerItems,
  expectForbiddenScreen,
  fillDate,
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
  xlsxTable,
  type PersonaKey,
  type Rpc,
  type Who,
};

export const PATHS = { list: "/notulensi", record: "/notulensi/catat" } as const;
export const EXPORT = "/api/minutes/export";
export const UPLOAD = "/api/minutes/files";
export const MINUTES_ITEM = "Notulensi Rapat";
export const minuteUrl = (id: string) => `/notulensi/${id}`;
export const editUrl = (id: string) => `/notulensi/${id}/ubah`;

export const tag = () => `QA${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;
export const emailOf = (p: PersonaKey) => PERSONAS[p].email;
export const nameOf = (p: PersonaKey) => q(`select full_name from public.members where email = '${PERSONAS[p].email}'`);

// Personas by right (spec section 2 and the probe above).
export const ALL_MANAGERS: PersonaKey[] = ["sekjen", "sekum1"];
export const ALL_READERS: PersonaKey[] = ["ketum", "bendahara"];
export const HEADS: PersonaKey[] = ["kadep", "kabiro"]; // D37: own unit, read only
export const NO_KEY: PersonaKey[] = ["regular", "pembina", "admin", "kadivLogistik", "staffOps"];

// Units (PI-CORE ids are read live; names are the seed's).
export const unitId = (name: string) => q(`select id from public.org_units where name = '${name}'`);
export const ROOT_UNIT = () => q("select id from public.org_units where type = 'organization'");
export const UNITS = {
  bph: "BPH PMK ITERA",
  internal: "Departemen Internal", // sekdep's unit
  ops: "Departemen Operasional", // kadep's unit
  biro: "Biro Kewirausahaan", // kabiro's unit
  eksternal: "Departemen Eksternal", // nobody's own unit among the personas
} as const;
export const divisionId = () => q("select id from public.org_units where type = 'division' and is_active order by name limit 1");

// ---------------------------------------------------------------------------------------------
// Read-only oracles
// ---------------------------------------------------------------------------------------------
export const minuteRow = (id: string) => qjson(`select * from nexus.minutes where id = '${id}'`)[0];
export const minuteVersion = (id: string) => qn(`select version from nexus.minutes where id = '${id}'`);
export const minuteCount = () => qn("select count(*) from nexus.minutes");
export const historyOf = (id: string) =>
  qjson<{ kind: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; note: string | null; actor_member_id: string }>(
    `select kind, before_data, after_data, note, actor_member_id from nexus.minute_history where minute_id = '${id}' order by id`,
  );
export const filesOf = (id: string) =>
  qjson<{ id: number; original_name: string; is_withdrawn: boolean; withdraw_reason: string | null }>(
    `select id, original_name, is_withdrawn, withdraw_reason from nexus.minute_files where minute_id = '${id}' order by id`,
  );
export const exportLogCount = () => qn("select count(*) from nexus.minute_export_logs");
export const exportLogMaxId = () => qn("select coalesce(max(id), 0) from nexus.minute_export_logs");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const exportLogsAfter = (id: number) => qjson<Record<string, any>>(`select * from nexus.minute_export_logs where id > ${id} order by id`);

/** Aktif minutes of the active period in a unit set (null = all units): the oracle for tiles and the Dashboard card. */
export function activeCount(units: string[] | null): { count: number; latest: string | null } {
  const where = units === null ? "" : `and org_unit_id in (${units.map((u) => `'${u}'`).join(",")})`;
  const r = qjson<{ n: number; latest: string | null }>(
    `select count(*)::int as n, max(meeting_date)::text as latest from nexus.minutes
     where status = 'active' and period_id = (select id from public.periods where is_active) ${where}`,
  )[0];
  return { count: r.n, latest: r.latest };
}

// ---------------------------------------------------------------------------------------------
// Fixtures and actions through the app's database functions
// ---------------------------------------------------------------------------------------------
export type FileRef = { path: string; name: string };
export function fakeFile(owner: PersonaKey, name = "notulen.pdf", ext: "pdf" | "jpg" | "png" = "pdf"): FileRef {
  return { path: `${memberId(emailOf(owner))}/${randomUUID()}.${ext}`, name };
}

export type NewMinute = {
  unit?: string; // unit id
  date?: string;
  title?: string;
  topic?: string;
  content?: string;
  decision?: string | null;
  files?: FileRef[] | null;
};
export const recordAs = (who: Who, m: NewMinute = {}) =>
  rpcAs(who, "minute_record", {
    p_org_unit_id: m.unit ?? unitId(UNITS.bph),
    p_meeting_date: m.date ?? jakartaToday(),
    p_title: m.title ?? "QA uji",
    p_topic: m.topic ?? "Topik uji",
    p_content: m.content ?? "Isi uji",
    p_decision: m.decision ?? null,
    p_files: m.files ?? null,
  });
export async function mustRecord(who: PersonaKey, m: NewMinute = {}) {
  const r = await recordAs(who, m);
  expect(r.ok, JSON.stringify(r.body)).toBe(true);
  return { id: row(r).minute_id as string, version: Number(row(r).version) };
}
export const updateAs = (who: Who, id: string, version: number, m: Required<Pick<NewMinute, "date" | "title" | "topic" | "content">> & { decision?: string | null }) =>
  rpcAs(who, "minute_update", {
    p_minute_id: id,
    p_version: version,
    p_meeting_date: m.date,
    p_title: m.title,
    p_topic: m.topic,
    p_content: m.content,
    p_decision: m.decision ?? null,
  });
export const voidAs = (who: Who, id: string, reason: string | null = "QA bersih-bersih", version?: number) =>
  rpcAs(who, "minute_void", { p_minute_id: id, p_version: version ?? minuteVersion(id), p_reason: reason });
export const addFilesAs = (who: Who, id: string, files: FileRef[], version?: number) =>
  rpcAs(who, "minute_add_files", { p_minute_id: id, p_version: version ?? minuteVersion(id), p_files: files });
export const withdrawFileAs = (who: Who, fileId: number, minuteId: string, reason: string | null) =>
  rpcAs(who, "minute_withdraw_file", { p_file_id: fileId, p_version: minuteVersion(minuteId), p_reason: reason });
export const detailAs = (who: Who, id: string) => rpcAs(who, "minute_detail", { p_minute_id: id });
export const listAs = (who: Who, args: Record<string, unknown> = {}) => rpcAs(who, "minute_list", { p_page_size: 50, ...args });
/** total_count of minute_list for these arguments (0 when nothing matches or the call is refused). */
export async function listTotal(who: Who, args: Record<string, unknown> = {}): Promise<number> {
  const r = await listAs(who, args);
  return r.ok && Array.isArray(r.body) && r.body.length > 0 ? Number(r.body[0].total_count) : 0;
}

/** Best-effort cleanup: voids every Aktif QA minute of the ACTIVE period (sekjen manages all units). Never throws. */
export async function sweepQa(prefix: string) {
  try {
    const open = qjson<{ id: string }>(
      `select id from nexus.minutes where title like '${prefix}%' and status = 'active'
       and period_id = (select id from public.periods where is_active)`,
    );
    for (const m of open) await voidAs("sekjen", m.id);
  } catch {
    /* cleanup is best-effort */
  }
}

// ---------------------------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------------------------
/** Types into a field after hydration (a value typed before React attaches is wiped). */
export async function fillField(page: Page, label: string | RegExp, value: string) {
  const input = page.getByLabel(label, { exact: typeof label === "string" });
  await expect(async () => {
    await input.fill(value);
    await expect(input).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
export const fillTitle = (page: Page, v: string) => fillField(page, "Judul Rapat", v);
export const fillTopic = (page: Page, v: string) => fillField(page, "Topik Bahasan", v);
export const fillContent = (page: Page, v: string) => fillField(page, "Isi Notulensi", v);
export const fillDecision = (page: Page, v: string) => fillField(page, "Keputusan & Tindak Lanjut (boleh kosong)", v);
export const saveRecord = (page: Page) => page.getByRole("button", { name: "Simpan Notulensi", exact: true }).click();
export const saveEdit = (page: Page) => page.getByRole("button", { name: "Simpan Perubahan", exact: true }).click();
export const idFromUrl = (page: Page) => /\/notulensi\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

export const card = (page: Page) => page.locator("section", { has: page.getByRole("heading", { level: 2, name: MINUTES_ITEM }) });
export const tiles = (page: Page) => page.locator('dl[aria-label="Ringkasan notulensi"]');

/** The titles listed on the screen, top to bottom (one card per minute). */
export async function screenTitles(page: Page): Promise<string[]> {
  const cards = main(page).locator("article");
  await expect(cards.first()).toBeVisible();
  return cards.locator("h3 a").allInnerTexts();
}

// ---------------------------------------------------------------------------------------------
// Server Actions called directly (the Next-Action header), exactly what any logged-in outsider could send
// ---------------------------------------------------------------------------------------------
type Manifest = { node: Record<string, { exportedName?: string; filename?: string; workers?: Record<string, unknown> }> };
function manifestFile(): string {
  const candidates = [".next/dev/server/server-reference-manifest.json", ".next/server/server-reference-manifest.json"].filter(existsSync);
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
export function serverActionTarget(name: string): { id: string; path: string } {
  const manifest = JSON.parse(readFileSync(manifestFile(), "utf8")) as Manifest;
  const hit = Object.entries(manifest.node).find(([, v]) => v.exportedName === name && /\/notulensi\//.test(v.filename ?? ""));
  if (!hit) throw new Error(`minutes server action ${name} not found in the build manifest`);
  const page = Object.keys(hit[1].workers ?? {}).find((w) => w.includes("/notulensi"));
  if (!page) throw new Error(`no page uses ${name}`);
  const path = page.replace(/^app/, "").replace(/\/\([^)]+\)/g, "").replace(/\/page$/, "").replace(/\[id\]/g, "00000000-0000-4000-8000-000000000000");
  return { id: hit[0], path };
}
export async function callAction(context: BrowserContext, name: string, args: unknown[]): Promise<string> {
  const { id, path } = serverActionTarget(name);
  const res = await context.request.post(path, {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", origin: ORIGIN, accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  return await res.text();
}

/** A small valid PDF (magic bytes), for the upload route. */
export const PDF_BYTES = (extra = 0) => Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"), Buffer.alloc(extra, 0x20)]);
