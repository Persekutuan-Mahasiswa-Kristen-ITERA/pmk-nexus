// Member Data: rules about the SOURCE CODE (MD-10, MD-13, MD-14, MD-37, R20, AUTH-41 style).
// They fail when a later file breaks a rule, so the rules cannot rot silently.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const inDir = (prefix: string) => files.filter((f) => rel(f).startsWith(prefix));

describe("AUTH-41 style: Member Data database functions are named in ONE file (src/lib/picore/member-data.ts)", () => {
  const RPC = /member_data_(list|unit_options|active_count|export|export_log_list)\b/;

  it("each RPC name appears in executable code only in src/lib/picore/member-data.ts", () => {
    for (const name of ["member_data_list", "member_data_unit_options", "member_data_active_count", "member_data_export", "member_data_export_log_list"]) {
      const hits = files.filter((f) => code(f).includes(name)).map(rel);
      expect(hits, name).toEqual(["src/lib/picore/member-data.ts"]);
    }
    expect(files.filter((f) => RPC.test(code(f))).map(rel)).toEqual(["src/lib/picore/member-data.ts"]);
  });

  it("the export-log TABLE is never named in src (only the function reads it; no direct table access)", () => {
    expect(files.filter((f) => /member_data_export_logs/.test(code(f))).map(rel)).toEqual([]);
  });

  it("only src/modules/member-data/server/* imports the PI-CORE Member Data wrappers", () => {
    const hits = files
      .filter((f) => /from ["']@\/lib\/picore\/member-data["']/.test(read(f)))
      .map(rel)
      .filter((f) => !f.startsWith("src/modules/member-data/server/"));
    expect(hits).toEqual([]);
  });

  it("nothing in src calls the private schema (MD-13)", () => {
    expect(files.filter((f) => /schema\(\s*["'`]private["'`]|["'`]private\.[a-z_]+|\bprivate\.[a-z_]+\(/.test(code(f))).map(rel)).toEqual([]);
  });

  it("the UI folder and the app pages never talk to the database client (no .rpc/.from/.schema)", () => {
    const ui = [...inDir("src/modules/member-data/ui/"), ...inDir("src/app/(app)/data-anggota/"), ...inDir("src/components/")];
    expect(ui.filter((f) => /\.(rpc|from|schema)\(/.test(code(f))).map(rel)).toEqual([]);
  });

  it("UI and shared components never import from the module's server/ folder or from lib/picore", () => {
    const hits = [...inDir("src/modules/member-data/ui/"), ...inDir("src/components/")].filter((f) =>
      /from ["'](@\/modules\/member-data\/server|\.\.\/server|@\/lib\/picore)/.test(read(f)),
    );
    expect(hits.map(rel)).toEqual([]);
  });
});

describe("MD-10 / L4: no personal field is read, named, or shown by the Member Data code", () => {
  const scope = [...inDir("src/modules/member-data/"), ...inDir("src/lib/export/"), ...inDir("src/app/(app)/data-anggota/"), ...inDir("src/app/api/member-data/"), "src/lib/picore/member-data.ts"]
    .map((f) => (f.startsWith(ROOT) ? f : join(ROOT, f)))
    .filter((f) => /\.(ts|tsx)$/.test(f));

  it("scope is not empty", () => expect(scope.length).toBeGreaterThanOrEqual(15));

  it("executable code never mentions email, phone, nim, nip, user_id, access_level, must_change_password, deactivated_at", () => {
    const hits = scope.filter((f) => /\b(email|phone|telepon|nim|nip|user_id|userId|access_level|accessLevel|must_change_password|deactivated_at)\b/i.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the wrappers' zod shapes are explicit object shapes (unknown columns are stripped, never passed through)", () => {
    const text = code(join(ROOT, "src/lib/picore/member-data.ts"));
    expect(text).not.toMatch(/\.passthrough\(|\.loose\(|z\.record\(|z\.any\(|z\.unknown\(/);
    expect(text).not.toMatch(/\.select\(/);
  });
});

describe("MD-14 / R20: Member Data is read-only", () => {
  it("no insert, update, delete or upsert call exists anywhere in src (the export log is written by the database function)", () => {
    expect(files.filter((f) => /\.(insert|update|upsert)\(/.test(code(f))).map(rel)).toEqual([]);
    expect(files.filter((f) => /supabase[\w.]*\.delete\(|\.from\([^)]*\)\.delete\(/.test(code(f))).map(rel)).toEqual([]);
  });
  it("the copy has no 'Tambah Anggota', 'Ketuk baris', edit or delete wording", () => {
    for (const f of [...inDir("src/modules/member-data/ui/"), ...inDir("src/app/(app)/data-anggota/")]) {
      expect(read(f), rel(f)).not.toMatch(/Tambah Anggota|Ketuk baris|Edit Anggota|Hapus Anggota|Nonaktifkan|Undang/i);
    }
  });
  it("table rows are not interactive: no onClick, no href, no role=link in member-table.tsx", () => {
    const text = code(join(ROOT, "src/modules/member-data/ui/member-table.tsx"));
    expect(text).not.toMatch(/onClick|href=|role=["']link|<Link|<a /);
    expect(text).not.toMatch(/"use client"/);
  });
  it("the export is a POST form; no GET link to the export route exists in src", () => {
    expect(code(join(ROOT, "src/modules/member-data/ui/member-export.tsx"))).toMatch(/<form method="post" action=\{EXPORT_URL\}/);
    const getLinks = files.filter((f) => /href=\{?["'`]\/api\/member-data\/export|router\.(push|replace)\(["'`]\/api\/member-data\/export|location[^;]*api\/member-data\/export/.test(code(f))).map(rel);
    expect(getLinks).toEqual([]);
  });
});

describe("Export route (F5): POST only, thin, session check present", () => {
  const route = code(join(ROOT, "src/app/api/member-data/export/route.ts"));
  it("exports POST and GET, where GET and the other verbs return 405 from the module helper", () => {
    expect(route).toMatch(/export async function POST/);
    expect(route).toMatch(/export function GET\(\): Response \{\s*return memberExportMethodNotAllowed\(\);/);
    for (const verb of ["PUT", "PATCH", "DELETE"]) expect(route).toMatch(new RegExp(`export const ${verb} = GET;`));
    expect(route).not.toMatch(/export (async )?function (HEAD|OPTIONS)/);
  });
  it("is dynamic and nodejs, never statically cached", () => {
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    expect(route).toMatch(/export const runtime = "nodejs"/);
  });
  it("the handler checks the same origin BEFORE reading the session", () => {
    const handler = code(join(ROOT, "src/modules/member-data/server/export.ts"));
    const origin = handler.indexOf("isSameOriginRequest(request)", handler.indexOf("export async function handleMemberDataExport"));
    const session = handler.indexOf("readAccessState()", handler.indexOf("export async function handleMemberDataExport"));
    expect(origin).toBeGreaterThan(0);
    expect(session).toBeGreaterThan(origin);
  });
  it("calls the export function exactly once (it writes a log row: no retry loops)", () => {
    const text = code(join(ROOT, "src/modules/member-data/server/export.ts"));
    expect((text.match(/exportMemberRows\(/g) ?? []).length).toBe(1);
    expect(code(join(ROOT, "src/lib/picore/member-data.ts"))).not.toMatch(/retry|for \(let attempt|while \(/i);
  });
});

describe("MD-37 / MD-13: no file is kept, nothing is cached across requests", () => {
  it("no filesystem write and no Storage call in the Member Data or export code", () => {
    const scope = [...inDir("src/modules/member-data/"), ...inDir("src/lib/export/"), ...inDir("src/app/api/member-data/")];
    expect(scope.filter((f) => /writeFile|createWriteStream|appendFile|\.storage\b|\.upload\(|createSignedUrl/.test(code(f))).map(rel)).toEqual([]);
  });
  it("no Next.js data cache, no browser storage, no module-level member data cache", () => {
    expect(files.filter((f) => /["']use cache["']|unstable_cache|export const revalidate|fetchCache|localStorage|sessionStorage|indexedDB/.test(code(f))).map(rel)).toEqual([]);
  });
  it("the Data Anggota page does not mark itself static or revalidated", () => {
    expect(code(join(ROOT, "src/app/(app)/data-anggota/page.tsx"))).not.toMatch(/revalidate|force-static|dynamic\s*=\s*["']error/);
  });
});

describe("server-only guards (a Client Component cannot import these by mistake)", () => {
  const guarded = [
    "src/lib/picore/member-data.ts",
    "src/modules/member-data/server/access.ts",
    "src/modules/member-data/server/export.ts",
    "src/modules/member-data/server/export-file.ts",
    "src/modules/member-data/server/params.ts",
    "src/modules/member-data/server/queries.ts",
    "src/modules/member-data/server/validation.ts",
    "src/lib/export/xlsx.ts",
    "src/lib/export/pdf.ts",
  ];
  for (const f of guarded) it(`${f} imports server-only`, () => expect(read(join(ROOT, f))).toMatch(/^import "server-only";/m));

  it("types.ts and the UI never import server-only modules (types.ts is shared with the browser)", () => {
    expect(read(join(ROOT, "src/modules/member-data/types.ts"))).not.toMatch(/server-only|@\/lib\/supabase|@\/lib\/picore/);
  });
});

describe("Spec 4.1 / MD-30: UI contract strings", () => {
  const ui = (name: string) => read(join(ROOT, "src/modules/member-data/ui", name));
  it("the export menu offers exactly Excel, CSV, PDF", () => {
    expect(ui("member-export.tsx")).toMatch(/const FORMATS: MemberExportFormat\[\] = \["xlsx", "csv", "pdf"\]/);
  });
  it("the status filter offers exactly Aktif, Nonaktif, Semua, in that order, default Aktif", () => {
    expect(ui("member-filters.tsx")).toMatch(/STATUS_ORDER: MemberStatusFilter\[\] = \["active", "inactive", "all"\]/);
    expect(ui("copy.ts")).toMatch(/active: "Aktif"[\s\S]*inactive: "Nonaktif"[\s\S]*all: "Semua"/);
  });
  it("the search box is name-only (no NIM wording) and capped at the schema maximum", () => {
    expect(ui("copy.ts")).toMatch(/searchPlaceholder: "Cari nama anggota\.\.\."/);
    expect(ui("member-filters.tsx")).toMatch(/maxLength=\{MEMBER_SEARCH_MAX_LENGTH\}/);
  });
  it("the table columns are No, Nama Lengkap, Unit / Jabatan, Status", () => {
    const t = ui("member-table.tsx");
    for (const col of [">\\s*No\\s*<", "Nama Lengkap", "Unit / Jabatan", "Status"]) expect(t).toMatch(new RegExp(col));
  });
});
