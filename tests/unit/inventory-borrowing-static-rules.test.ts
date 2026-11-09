// Inventory and Borrowing: rules about the SOURCE CODE (CLAUDE.md 4, 6, 11; IB-31, IB-32, IB-41, IB-42, IB-46).
// They fail when a later file breaks a rule, so the rules cannot rot silently.
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
const moduleFiles = [...inDir("src/modules/inventory-borrowing/"), ...inDir("src/app/(app)/inventaris/"), ...inDir("src/app/api/inventory/")];
const WRAPPER = "src/lib/picore/inventory-borrowing.ts";

describe("single PI-CORE access layer: every inventory/borrowing database function is named in ONE file", () => {
  const RPC = /\b(inventory|borrowing)_[a-z_]+\b/g;
  it("RPC names (inventory_* / borrowing_*) appear in executable code only in src/lib/picore/inventory-borrowing.ts", () => {
    const hits = files
      .filter((f) => rel(f) !== WRAPPER)
      .filter((f) => [...code(f).matchAll(RPC)].some((m) => !/^(inventory|borrowing)_(view|manage|export|handle|approve|view_all)$/.test(m[0])))
      .map(rel);
    // Allowed: permission KEYS written with a dot are not matched here (they use '.'); identifiers like inventory_borrowing in file names are not code
    expect(hits.filter((h) => !h.startsWith("src/lib/picore/"))).toEqual([]);
  });
  it("tables are never named outside the wrapper (no direct table access)", () => {
    const TABLES = /\b(borrowing_requests|borrowing_request_lines|borrowing_line_returns|borrowing_evidence_photos|borrowing_status_history|inventory_items|inventory_units|inventory_stock|inventory_item_history|inventory_borrowing_export_logs)\b/;
    expect(files.filter((f) => TABLES.test(code(f))).map(rel)).toEqual([]);
  });
  it("UI, pages and shared components never call the database client (.rpc / .from / .schema / .storage)", () => {
    const ui = [...inDir("src/modules/inventory-borrowing/ui/"), ...inDir("src/app/(app)/inventaris/"), ...inDir("src/components/")];
    expect(ui.filter((f) => /\.(rpc|from|schema|storage)\(/.test(code(f))).map(rel)).toEqual([]);
  });
  it("UI never imports the module's server folder except Server Actions (borrowing-actions, manage-actions) and never lib/picore", () => {
    const hits = inDir("src/modules/inventory-borrowing/ui/").filter((f) => /from ["'](@\/lib\/picore|@\/lib\/supabase)/.test(read(f)));
    expect(hits.map(rel)).toEqual([]);
    const serverImports = inDir("src/modules/inventory-borrowing/ui/").flatMap((f) =>
      [...read(f).matchAll(/from ["']\.\.\/server\/([a-z-]+)["']/g)].map((m) => `${rel(f)} -> ${m[1]}`),
    );
    for (const entry of serverImports) expect(entry, entry).toMatch(/-> (borrowing-actions|manage-actions)$/);
  });
});

describe("secrets and destructive operations", () => {
  it("no service-role key anywhere in the module, its pages or its routes (CLAUDE.md 11)", () => {
    expect(moduleFiles.filter((f) => /service_role|SERVICE_ROLE|sb_secret_/.test(code(f))).map(rel)).toEqual([]);
    expect(code(join(ROOT, WRAPPER))).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_/);
  });
  it("nothing deletes: no .delete( / .remove( / .update( / .upsert( / .insert( on the database client in the module or the wrapper (IB-41, IB-32)", () => {
    const scope = [...inDir("src/modules/inventory-borrowing/server/"), ...inDir("src/app/api/inventory/"), join(ROOT, WRAPPER)];
    expect(scope.filter((f) => /\.(delete|remove|update|upsert|insert|truncate)\(/.test(code(f))).map(rel)).toEqual([]);
    // Storage: upload with upsert: false only, never an overwrite
    const text = code(join(ROOT, WRAPPER));
    expect(text).toMatch(/upsert:\s*false/);
    expect(text).not.toMatch(/upsert:\s*true/);
    expect(text).not.toMatch(/\.createSignedUrl\([^)]*\b(3600|86400)\b/); // links stay short-lived
  });
  it("signed photo links are short-lived (A-IB51: 300 s) and only built from the contract constant", () => {
    expect(code(join(ROOT, "src/modules/inventory-borrowing/server/borrowing.ts"))).toMatch(/EVIDENCE_SIGNED_URL_TTL_SECONDS/);
  });
  it("route handlers are POST-only and export no GET (an export writes a log row)", () => {
    for (const f of inDir("src/app/api/inventory/")) {
      const text = code(f);
      expect(text, rel(f)).toMatch(/export (async function|const) POST/);
      // Any other method is answered by the shared 405 helper
      expect(text, rel(f)).toMatch(/export function GET\(\): Response \{\s*return inventoryMethodNotAllowed\(\);/);
      for (const method of ["PUT", "PATCH", "DELETE"]) expect(text, `${rel(f)} ${method}`).toMatch(new RegExp(`export const ${method} = GET;`));
      expect(text, rel(f)).not.toMatch(/export (async )?function (PUT|PATCH|DELETE)\b/);
    }
  });
  it("every Server Action file starts with \"use server\"", () => {
    for (const f of ["src/modules/inventory-borrowing/server/borrowing-actions.ts", "src/modules/inventory-borrowing/server/manage-actions.ts", "src/app/(app)/inventaris/actions.ts"]) {
      expect(read(join(ROOT, f)).trimStart().startsWith('"use server"'), f).toBe(true);
    }
  });
});

describe("IB-31, IB-42, IB-46: no money, no contact data, no notification channel", () => {
  const scope = [...inDir("src/modules/inventory-borrowing/"), ...inDir("src/app/(app)/inventaris/")];
  it("no deposit, fine or payment words in executable code", () => {
    expect(scope.filter((f) => /\b(deposit|denda|payment|pembayaran|saldo)\b/i.test(noStrings(f))).map(rel)).toEqual([]);
  });
  it("no email / phone / NIM / NIP / auth user id field in the module code", () => {
    expect(scope.filter((f) => /\b(email|phone|telepon|nim|nip|user_id|userId|access_level|accessLevel)\b/i.test(noStrings(f))).map(rel)).toEqual([]);
  });
  it("no notification channel is wired in (IB-46): no mail, push or messaging library", () => {
    expect(scope.filter((f) => /\b(nodemailer|sendgrid|resend|twilio|web-push|webpush|whatsapp|sendMail|Notification\()/i.test(code(f))).map(rel)).toEqual([]);
  });
  it("catalog photos do not exist: the item form has no file input (IB9)", () => {
    for (const f of ["item-form.tsx", "item-edit-form.tsx"]) {
      expect(code(join(ROOT, "src/modules/inventory-borrowing/ui", f)), f).not.toMatch(/type=["']file["']/);
    }
  });
});
