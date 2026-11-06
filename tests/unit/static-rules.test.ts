// AUTH-03, AUTH-24/25, AUTH-40, AUTH-41, AUTH-42, AUTH-44, AR1, AR3, AR8: rules about the SOURCE CODE.
// These read files under src/ and fail when a new file breaks a rule, so the rules cannot rot silently.
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

describe("AUTH-41: PI-CORE-backed functions are called from one place", () => {
  it("'my_context' appears in executable code only in src/lib/picore/context.ts", () => {
    const hits = files.filter((f) => /my_context|my_permissions|my_password_change_pending/.test(code(f))).map(rel);
    expect(hits).toEqual(["src/lib/picore/context.ts"]);
  });

  it("only src/lib/auth/session.ts imports the readers", () => {
    const hits = files.filter((f) => /from ["']@\/lib\/picore\/context["']/.test(read(f))).map(rel);
    expect(hits).toEqual(["src/lib/auth/session.ts"]);
  });

  it("no file outside src/lib/picore calls .rpc( or .from( (no direct table or function access)", () => {
    const hits = files.filter((f) => !rel(f).startsWith("src/lib/picore/") && /\.(rpc|from)\(/.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the picore module marks itself server-only", () => {
    expect(read(join(SRC, "lib/picore/context.ts"))).toMatch(/^import "server-only";/m);
    expect(read(join(SRC, "lib/auth/session.ts"))).toMatch(/^import "server-only";/m);
  });
});

describe("AUTH-40 / AR3: no service-role key and no Auth admin API", () => {
  it("'service_role', SERVICE_ROLE, SUPABASE_SECRET and auth.admin never appear except in the guard in env.ts", () => {
    const hits = files
      .filter((f) => /service_role|SERVICE_ROLE|SUPABASE_SECRET|SECRET_KEY|auth\.admin|\.admin\./i.test(code(f)))
      .map(rel);
    expect(hits).toEqual(["src/lib/env.ts"]);
  });

  it("every process.env name read in src is on the allow-list of public variables", () => {
    const allowed = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_PICORE_URL", "NODE_ENV"]);
    const used = new Set<string>();
    for (const f of files) for (const m of code(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
    expect([...used].filter((n) => !allowed.has(n))).toEqual([]);
  });

  it(".env.example has no service-role variable and no real-looking key", () => {
    const text = readFileSync(join(ROOT, ".env.example"), "utf8");
    const assignments = text.split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    expect(assignments.some((l) => /SERVICE|SECRET/i.test(l.split("=")[0]))).toBe(false);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{10,}/);
  });
});

describe("AR1 / AUTH-03 / AUTH-25: no sign-up, reset, or password-change routes", () => {
  const routeDirs = walk(join(SRC, "app"))
    .filter((f) => /\/(page|route)\.tsx?$/.test(f))
    .map((f) => rel(f).replace(/^src\/app/, "").replace(/\/\([^)]+\)/g, "").replace(/\/(page|route)\.tsx?$/, "") || "/");

  it("the only routes are /login and / (and nothing sign-up-like)", () => {
    expect(routeDirs.sort()).toEqual(["/", "/login"]);
    for (const r of routeDirs) expect(r).not.toMatch(/sign-?up|register|invite|reset|forgot|password|change|account|admin/i);
  });

  it("the login form has no sign-up, social-login, or reset form text", () => {
    const text = read(join(SRC, "app/login/login-form.tsx"));
    expect(text).not.toMatch(/Daftar|Buat akun|Google|Sign ?up|Register/i);
    expect(text).not.toMatch(/resetPasswordForEmail|signUp\(|signInWithOAuth|signInWithOtp|updateUser/);
  });

  it("no code path calls signUp, resetPasswordForEmail, updateUser, or signInWith(OAuth|Otp|Anonymously)", () => {
    const hits = files.filter((f) => /\.(signUp|resetPasswordForEmail|updateUser|signInWithOAuth|signInWithOtp|signInAnonymously|inviteUserByEmail)\(/.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });
});

describe("AUTH-24 / L4: must_change_password is never read by NEXUS code", () => {
  it("the column name does not appear in src (only the caller-only RPC is used)", () => {
    expect(files.filter((f) => /must_change_password/.test(code(f))).map(rel)).toEqual([]);
  });
});

describe("AUTH-42 / AR8: every protected page, route handler, and Server Action checks the session", () => {
  const isServerActionFile = (f: string) => /^\s*["']use server["']/.test(read(f));

  it("every page.tsx and route.ts calls getAccessState (login included)", () => {
    const entries = files.filter((f) => /\/(page|route)\.tsx?$/.test(f));
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const missing = entries.filter((f) => !/getAccessState\(\)/.test(code(f))).map(rel);
    expect(missing).toEqual([]);
  });

  it("every exported Server Action outside the two session-only ones calls getAccessState", () => {
    const actionFiles = files.filter(isServerActionFile).map(rel);
    // src/lib/auth/actions.ts (signIn finalize + signOut) is the documented exception (spec 8.1).
    const others = actionFiles.filter((f) => f !== "src/lib/auth/actions.ts");
    for (const f of others) expect(code(join(ROOT, f)), f).toMatch(/getAccessState\(\)/);
  });

  it("the exceptions only handle the caller's own session (no picore reader, no data access)", () => {
    const text = code(join(SRC, "lib/auth/actions.ts"));
    expect(text).not.toMatch(/readMy|picore|\.rpc\(|\.from\(/);
  });

  it("the protected layout and the login page both call getAccessState", () => {
    expect(code(join(SRC, "app/(app)/layout.tsx"))).toMatch(/getAccessState\(\)/);
    expect(code(join(SRC, "app/login/page.tsx"))).toMatch(/getAccessState\(\)/);
  });
});

describe("AUTH-44 / AR12: the password and email never reach a URL, a log, or the server", () => {
  it("login-form never builds a URL or query from the password or email", () => {
    const text = code(join(SRC, "app/login/login-form.tsx"));
    expect(text).not.toMatch(/(router\.(push|replace)|window\.location|location\.href)[^;]*\b(password|email)\b/);
    expect(text).not.toMatch(/console\./);
  });

  it("no src file logs a password or an email", () => {
    const bad = files.filter((f) => /console\.\w+\([^)]*(password|email)/i.test(code(f))).map(rel);
    expect(bad).toEqual([]);
  });

  it("the finalizeSignIn Server Action takes only `next` (the password cannot reach the server)", () => {
    const text = read(join(SRC, "lib/auth/actions.ts"));
    expect(text).toMatch(/export async function finalizeSignIn\(next: string \| null\)/);
  });
});

describe("AUTH-43: no raw Supabase wording in screens", () => {
  it("UI files never render error.message or the word 'banned'", () => {
    const ui = files.filter((f) => /^src\/(app|components)\//.test(rel(f)));
    const hits = ui.filter((f) => /\{[^}]*\berror\.message\b[^}]*\}|banned/i.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });
});
