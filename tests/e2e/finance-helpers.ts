// Helpers for the Finance E2E specs. LOCAL NEXUS stack only (docs/qa/finance.md).
//
// Principles (same as surat-helpers.ts):
//  - Expected NUMBERS come from read-only SELECTs at test time, compared as deltas. Nothing assumes an empty ledger.
//  - Setup data is made only through the app's own database functions with the persona's real token.
//  - The ledger is append-only by design (no delete, FN-14). Every description carries a unique "QA<tag>" prefix and
//    `sweepQa()` voids what is still Aktif in the active period. A period switch test leaves its old-period
//    entries behind: they can no longer be voided once that period is closed.
//  - Storage is OFF on the local stack, so a real upload never works here. Database functions skip the object check
//    when the storage schema is missing, so proof paths are made up in the uploader's own folder (`fakeProof`).
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
  tokenOf,
  type Rpc,
  type Who,
  xlsxTable,
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
  tokenOf,
  xlsxTable,
  type PersonaKey,
  type Rpc,
  type Who,
};

export const PATHS = { list: "/finance", record: "/finance/catat", opening: "/finance/saldo-awal" } as const;
export const EXPORT = "/api/finance/export";
export const UPLOAD = "/api/finance/proofs";
export const FINANCE_ITEM = "Finance";
export const entryUrl = (id: string) => `/finance/${id}`;

export const tag = () => `QA${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase()}`;
export const emailOf = (p: PersonaKey) => PERSONAS[p].email;
export const nameOf = (p: PersonaKey) => q(`select full_name from public.members where email = '${PERSONAS[p].email}'`);

/** Who holds which Finance key in 2026/2027 (written from the spec, section 2 and K1 a; not read from the code). */
export const MANAGERS: PersonaKey[] = ["bendahara"];
export const READERS: PersonaKey[] = ["ketum", "sekjen", "sekum1"]; // BPH: view + export, no manage
export const NO_KEY: PersonaKey[] = ["regular", "pembina", "admin", "sekdep", "kabiro", "kadep", "kadivLogistik", "staffOps"];

// ---------------------------------------------------------------------------------------------
// Read-only oracles
// ---------------------------------------------------------------------------------------------
export const entryRow = (id: string) => qjson(`select * from nexus.finance_entries where id = '${id}'`)[0];
export const entryByDescription = (description: string) =>
  qjson(`select * from nexus.finance_entries where description = '${description.replace(/'/g, "''")}' order by entry_no`);
export const entryCountLike = (prefix: string) => qn(`select count(*) from nexus.finance_entries where description like '${prefix}%'`);
export const entryCount = () => qn("select count(*) from nexus.finance_entries");
export const historyOf = (id: string) =>
  qjson<{ kind: string; note: string | null; actor: string }>(
    `select h.kind, h.note, m.email as actor from nexus.finance_entry_history h left join public.members m on m.id = h.actor_member_id where h.entry_id = '${id}' order by h.id`,
  );
export const exportLogMaxId = () => qn("select coalesce(max(id), 0) from nexus.finance_export_logs");
export const exportLogsAfter = (id: number) => qjson(`select * from nexus.finance_export_logs where id > ${id} order by id`);
export const exportLogCount = () => qn("select count(*) from nexus.finance_export_logs");
export const storageInstalled = () => q("select to_regclass('storage.objects') is not null") === "t";

/** Totals of a period straight from the table (spec 4.2): Saldo awal + Pemasukan - Pengeluaran, Aktif entries only. */
export function totals(periodId: string = activePeriodId()) {
  const t = qjson<{ opening: string; income: string; expense: string }>(
    `select coalesce(sum(amount) filter (where entry_type = 'opening'), 0) as opening,
            coalesce(sum(amount) filter (where entry_type = 'income'), 0) as income,
            coalesce(sum(amount) filter (where entry_type = 'expense'), 0) as expense
     from nexus.finance_entries where period_id = '${periodId}' and status = 'active'`,
  )[0];
  const opening = BigInt(t.opening);
  const income = BigInt(t.income);
  const expense = BigInt(t.expense);
  return { opening, income, expense, balance: opening + income - expense };
}
/** "Rp 1.250.000", "-Rp 250.000" (contract formatRupiah, written out here as the oracle). */
export const rupiah = (n: bigint | number) => {
  const v = BigInt(n);
  const digits = (v < BigInt(0) ? -v : v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < BigInt(0) ? "-" : ""}Rp ${digits}`;
};

// ---------------------------------------------------------------------------------------------
// Fake proof files (the local stack has no Storage, so the object check is skipped by the database)
// ---------------------------------------------------------------------------------------------
export type FileRef = { path: string; name: string };
export function fakeProof(owner: PersonaKey, name = "nota.pdf", ext: "pdf" | "jpg" | "png" = "pdf"): FileRef {
  return { path: `${memberId(emailOf(owner))}/${randomUUID()}.${ext}`, name };
}

// ---------------------------------------------------------------------------------------------
// Fixtures and actions through the app's database functions
// ---------------------------------------------------------------------------------------------
export type NewEntry = {
  type?: "income" | "expense" | "opening";
  date?: string;
  amount?: string;
  description?: string;
  notes?: string | null;
  corrects?: string | null;
  files?: FileRef[] | null;
  key?: string;
};
export const recordAs = (who: Who, e: NewEntry = {}) =>
  rpcAs(who, "finance_entry_record", {
    p_idempotency_key: e.key ?? randomUUID(),
    p_entry_type: e.type ?? "expense",
    p_entry_date: e.date ?? jakartaToday(),
    p_amount: e.amount ?? "1000",
    p_description: e.description ?? "QA uji",
    p_notes: e.notes ?? null,
    p_corrects_entry_id: e.corrects ?? null,
    p_files: e.files ?? null,
  });
export async function mustRecord(who: PersonaKey, e: NewEntry = {}) {
  const r = await recordAs(who, e);
  expect(r.ok, JSON.stringify(r.body)).toBe(true);
  return { id: row(r).entry_id as string, numberText: row(r).number_text as string, replayed: Boolean(row(r).replayed) };
}
export const voidAs = (who: Who, id: string, reason: string | null = "QA bersih-bersih") =>
  rpcAs(who, "finance_entry_void", { p_entry_id: id, p_reason: reason });
export const addProofAs = (who: Who, id: string, files: FileRef[]) => rpcAs(who, "finance_entry_add_proof", { p_entry_id: id, p_files: files });
export const withdrawProofAs = (who: Who, fileId: number, reason: string | null) =>
  rpcAs(who, "finance_entry_withdraw_proof", { p_file_id: fileId, p_reason: reason });
export const summaryAs = (who: Who, periodId: string | null = null) => rpcAs(who, "finance_summary", { p_period_id: periodId });
export const detailAs = (who: Who, id: string) => rpcAs(who, "finance_entry_detail", { p_entry_id: id });

/** Best-effort cleanup: voids every Aktif QA entry of the ACTIVE period. Never throws. */
export async function sweepQa(prefix: string) {
  try {
    const open = qjson<{ id: string }>(
      `select id from nexus.finance_entries where description like '${prefix}%' and status = 'active'
       and period_id = (select id from public.periods where is_active) and entry_type <> 'opening'`,
    );
    for (const e of open) await voidAs("bendahara", e.id);
    const opening = qjson<{ id: string }>(
      `select id from nexus.finance_entries where description like '${prefix}%' and status = 'active'
       and period_id = (select id from public.periods where is_active) and entry_type = 'opening'`,
    );
    for (const e of opening) await voidAs("bendahara", e.id);
  } catch {
    /* cleanup is best-effort */
  }
}

// ---------------------------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------------------------
/** Types an amount the way a person does and waits for the field to show it with thousands dots. */
export async function fillAmount(page: Page, digits: string) {
  const input = page.getByLabel("Jumlah (Rp)");
  const shown = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  await expect(async () => {
    await input.fill(digits);
    await expect(input).toHaveValue(shown, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
export async function fillDescription(page: Page, text: string) {
  const input = page.getByLabel(/^Keterangan$/);
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
export async function fillNotes(page: Page, text: string) {
  const input = page.getByLabel("Catatan (boleh kosong)");
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
export const clickNext = (page: Page) => page.getByRole("button", { name: "Lanjut", exact: true }).click();
export const clickSave = (page: Page) => dialog(page).getByRole("button", { name: "Simpan transaksi", exact: true }).click();

export const card = (page: Page) => page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Finance" }) });

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
  const hit = Object.entries(manifest.node).find(([, v]) => v.exportedName === name && /\/finance\//.test(v.filename ?? ""));
  if (!hit) throw new Error(`finance server action ${name} not found in the build manifest`);
  const page = Object.keys(hit[1].workers ?? {}).find((w) => w.includes("/finance"));
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
