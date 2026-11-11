// Letters: rules about the SOURCE CODE (CLAUDE.md 4, 6, 11; LT-34, LT-35, LT-36, LT-48). They fail when a later file breaks a
// rule, so the rules cannot rot silently. Same method as inventory-borrowing-static-rules.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const noStrings = (f: string) => code(f).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
const inDir = (prefix: string) => files.filter((f) => rel(f).startsWith(prefix));
const moduleFiles = [...inDir("src/modules/letters/"), ...inDir("src/app/(app)/surat/"), ...inDir("src/app/(app)/pengaturan/"), ...inDir("src/app/api/letters/")];
const WRAPPER = "src/lib/picore/letters.ts";

describe("single PI-CORE access layer: every letters database function is named in ONE file (CLAUDE.md 4)", () => {
  it("RPC names (letter_*) appear in executable code only in src/lib/picore/letters.ts", () => {
    // The list of RPC names is the wrapper's own union type; the hint names (letter_voided, letter_not_found) are not RPCs.
    const union = /type LetterRpc =([\s\S]*?);/.exec(read(join(ROOT, WRAPPER)))?.[1] ?? "";
    const rpcNames = [...union.matchAll(/"(letter_[a-z_]+)"/g)].map((m) => m[1]);
    expect(rpcNames.length).toBeGreaterThanOrEqual(25);
    const hits = files
      .filter((f) => rel(f) !== WRAPPER)
      .filter((f) => rpcNames.some((n) => new RegExp(`["'\`]${n}["'\`]`).test(code(f))))
      .map(rel);
    expect(hits).toEqual([]);
  });
  it("tables and the bucket name are never named outside the wrapper and the contract", () => {
    // "letter_requests.process" (a permission key, with a dot) is not a table access
    const TABLES = /\b(letter_requests|letter_files|letter_history|letter_request_history|letter_number_counters|letter_numbering_settings|letter_numbering_changes|letter_export_logs)\b(?!\.)/;
    expect(files.filter((f) => rel(f) !== WRAPPER).filter((f) => TABLES.test(code(f))).map(rel)).toEqual([]);
    const bucketUsers = files.filter((f) => /nexus-letter-files|LETTER_FILE_BUCKET/.test(code(f))).map(rel);
    expect(bucketUsers.sort()).toEqual([WRAPPER, "src/modules/letters/types.ts"].sort());
  });
  it("UI, pages and shared components never call the database client (.rpc / .from / .schema / .storage)", () => {
    const ui = [...inDir("src/modules/letters/ui/"), ...inDir("src/app/(app)/surat/"), ...inDir("src/app/(app)/pengaturan/"), ...inDir("src/components/")];
    expect(ui.filter((f) => /\.(rpc|from|schema|storage)\(/.test(code(f))).map(rel)).toEqual([]);
  });
  it("UI never imports lib/picore or lib/supabase; from the module's server folder only Server Actions and the plain reads of the pages", () => {
    const ui = inDir("src/modules/letters/ui/");
    expect(ui.filter((f) => /from ["'](@\/lib\/picore|@\/lib\/supabase)/.test(read(f))).map(rel)).toEqual([]);
    // Client components import actions through ui/server-actions.ts (one place) and nothing else of the server folder
    const direct = ui.flatMap((f) => [...read(f).matchAll(/from ["'](?:\.\.\/server\/|@\/modules\/letters\/server\/)([a-z-]+)["']/g)].map((m) => `${rel(f)} -> ${m[1]}`));
    expect(direct).toEqual([]);
  });
  it("the pages only reach the data through the module's server folder or its actions", () => {
    for (const f of [...inDir("src/app/(app)/surat/"), ...inDir("src/app/(app)/pengaturan/")]) {
      expect(read(f), rel(f)).not.toMatch(/from ["']@\/lib\/(picore|supabase)/);
    }
  });
});

describe("secrets, destructive operations, links", () => {
  it("no service-role key anywhere in the module, its pages or its routes (CLAUDE.md 11)", () => {
    expect(moduleFiles.filter((f) => /service_role|SERVICE_ROLE|sb_secret_/.test(code(f))).map(rel)).toEqual([]);
    expect(code(join(ROOT, WRAPPER))).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_/);
  });
  it("nothing deletes or overwrites: no .delete( / .remove( / .update( / .upsert( / .insert( / .truncate( in the module or the wrapper (LT-34)", () => {
    const scope = [...inDir("src/modules/letters/server/"), ...inDir("src/app/api/letters/"), join(ROOT, WRAPPER)];
    expect(scope.filter((f) => /\.(delete|remove|update|upsert|insert|truncate|copy|move)\(/.test(code(f))).map(rel)).toEqual([]);
    const text = code(join(ROOT, WRAPPER));
    expect(text).toMatch(/upsert:\s*false/);
    expect(text).not.toMatch(/upsert:\s*true/);
  });
  it("file links are short-lived: the lifetime comes from the contract constant (300 s) and no longer value is typed anywhere", () => {
    expect(code(join(ROOT, "src/modules/letters/server/file-actions.ts"))).toMatch(/LETTER_FILE_SIGNED_URL_TTL_SECONDS/);
    for (const f of moduleFiles.concat(join(ROOT, WRAPPER))) expect(code(f), rel(f)).not.toMatch(/createSignedUrl\([^)]*,\s*(\d{4,}|60\s*\*\s*60)/);
  });
  it("a signed link is never put into an export, a log or a page address (LT-36)", () => {
    for (const f of inDir("src/modules/letters/server/").filter((x) => /export/.test(x))) expect(code(f), rel(f)).not.toMatch(/signedUrl|createSignedUrl|getLetterFileLink/);
    for (const f of inDir("src/modules/letters/ui/")) expect(code(f), rel(f)).not.toMatch(/console\.(log|info|debug)\([^)]*(url|signed)/i);
  });
  it("route handlers are POST-only and answer every other method with the shared 405 helper", () => {
    const routes = inDir("src/app/api/letters/");
    expect(routes.map(rel).sort()).toEqual(["src/app/api/letters/export/route.ts", "src/app/api/letters/files/route.ts"]);
    for (const f of routes) {
      const text = code(f);
      expect(text, rel(f)).toMatch(/export async function POST/);
      expect(text, rel(f)).toMatch(/export function GET\(\): Response \{\s*return letterMethodNotAllowed\(\);/);
      for (const m of ["PUT", "PATCH", "DELETE"]) expect(text, `${rel(f)} ${m}`).toMatch(new RegExp(`export const ${m} = GET;`));
      expect(text, rel(f)).toMatch(/export const dynamic = "force-dynamic"/);
      expect(text, rel(f)).toMatch(/getAccessState\(\)/);
    }
  });
  it("every Server Action file starts with \"use server\"", () => {
    for (const f of ["src/modules/letters/server/register-actions.ts", "src/modules/letters/server/request-actions.ts", "src/modules/letters/server/numbering-actions.ts", "src/modules/letters/server/file-actions.ts", "src/app/(app)/surat/actions.ts"]) {
      expect(read(join(ROOT, f)).trimStart().startsWith('"use server"'), f).toBe(true);
    }
  });
  it("every entry point of the module's server folder checks the session and the capability (requireLetters, directly or through its gate()) before it touches data", () => {
    for (const f of ["register.ts", "requests.ts", "numbering.ts", "register-actions.ts", "request-actions.ts", "numbering-actions.ts", "file-actions.ts"]) {
      const text = code(join(ROOT, "src/modules/letters/server", f));
      const bodies = text.split(/^export async function /m).slice(1);
      expect(bodies.length, f).toBeGreaterThan(0);
      for (const body of bodies) {
        const name = /^(\w+)/.exec(body)?.[1];
        const guard = body.search(/\b(requireLetters|gate)\(/);
        expect(guard, `${f} ${name}: no guard`).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("every server-side function never throws out: each entry runs inside safely()", () => {
    for (const f of ["register.ts", "requests.ts", "numbering.ts", "register-actions.ts", "request-actions.ts", "numbering-actions.ts", "file-actions.ts"]) {
      const text = code(join(ROOT, "src/modules/letters/server", f));
      const entries = (text.match(/^export async function /gm) ?? []).length;
      expect((text.match(/return safely\(/g) ?? []).length, f).toBe(entries);
    }
  });
});

describe("LT-35: no personal data, no notification channel, no money; LT-48: self-contained and period-scoped", () => {
  const scope = [...inDir("src/modules/letters/"), ...inDir("src/app/(app)/surat/"), ...inDir("src/app/(app)/pengaturan/")];
  it("no email / phone / NIM / NIP / auth user id in the module code (access control L4)", () => {
    expect(scope.filter((f) => /\b(email|phone|telepon|nim|nip|user_id|userId|auth_user)\b/i.test(noStrings(f))).map(rel)).toEqual([]);
    // the wrapper reads only names: it never selects those columns either
    expect(noStrings(join(ROOT, WRAPPER))).not.toMatch(/\b(email|phone|telepon|nim|nip|auth_user)\b/i);
  });
  it("no notification channel is wired in (the requester checks 'Permohonan Saya'): no mail, push or messaging library", () => {
    expect(scope.filter((f) => /\b(nodemailer|sendgrid|resend|twilio|web-push|webpush|whatsapp|sendMail|Notification\()/i.test(code(f))).map(rel)).toEqual([]);
  });
  it("no letter generation, e-signature or template code in Phase 1 (L1: register and archive only)", () => {
    expect(scope.filter((f) => /\b(pdf-lib|docx|jspdf|eSignature|signaturePad|tandaTangan)\b/i.test(noStrings(f)) && !/export-file/.test(f)).map(rel)).toEqual([]);
  });
  it("the module does not import another module (self-contained, can be extended by progja without a rewrite)", () => {
    const imports = inDir("src/modules/letters/").flatMap((f) => [...read(f).matchAll(/from ["']@\/modules\/([a-z-]+)/g)].map((m) => `${rel(f)} -> ${m[1]}`));
    expect(imports.filter((i) => !i.endsWith("-> letters"))).toEqual([]);
  });
  it("the drawer's Surat item is not behind a key (D-025) and stays after Data Anggota and before Inventaris in the Stitch order", () => {
    const nav = code(join(ROOT, "src/components/shell/nav.ts"));
    expect(nav).toMatch(/items\.push\(\{ href: "\/surat", label: "Surat Menyurat", icon: "letters" \}\)/);
    expect(nav.indexOf('"/data-anggota"')).toBeLessThan(nav.indexOf('"/surat"'));
    expect(nav.indexOf('"/surat"')).toBeLessThan(nav.indexOf('"/inventaris"'));
  });
  it("the numbering page and its screen are not linked from any shared shell component (the settings area has no design yet, G10): only the module links to it", () => {
    const linkers = files.filter((f) => /\/pengaturan\/penomoran-surat/.test(code(f)) && !rel(f).startsWith("src/modules/letters/") && !rel(f).startsWith("src/app/(app)/pengaturan/")).map(rel);
    expect(linkers).toEqual([]);
  });
});
