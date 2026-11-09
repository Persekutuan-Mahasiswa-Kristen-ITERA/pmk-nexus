import { createServerClient } from "@supabase/ssr";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  API_URL,
  PASSWORD,
  PERSONAS,
  PUBLISHABLE_KEY,
  readJson,
  sql,
  writeJson,
  type PersonaKey,
} from "../support/local-stack";

export { PASSWORD, PERSONAS, sql, type PersonaKey };

// ---------------------------------------------------------------------------------------------
// Sign-in budget. Supabase Auth allows 30 sign-in requests per 5 minutes per IP (local config.toml).
// Every sign-in the suite makes goes through `throttleSignIn()` so the run (and re-runs) stay below it.
// ---------------------------------------------------------------------------------------------
const WINDOW_MS = 5 * 60_000 + 5_000;
const BUDGET = 25; // below 30 on purpose: leaves room for a manual login while the suite runs

export async function throttleSignIn(count = 1) {
  for (;;) {
    const now = Date.now();
    const recent = readJson<number[]>("signins.json", []).filter((t) => now - t < WINDOW_MS);
    if (recent.length + count <= BUDGET) {
      writeJson("signins.json", [...recent, ...Array(count).fill(now)]);
      return;
    }
    const wait = Math.max(1_000, WINDOW_MS - (now - recent[0]) + 250);
    await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)));
  }
}

// ---------------------------------------------------------------------------------------------
// Sessions without the form: sign in once through the Auth API with @supabase/ssr (exact cookie
// format and chunking the app uses), then put those cookies into a browser context.
// ---------------------------------------------------------------------------------------------
type Cookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Lax" };
type CachedSession = { at: number; cookies: Cookie[]; accessToken: string };

export async function createSession(persona: PersonaKey): Promise<CachedSession> {
  await throttleSignIn();
  const jar = new Map<string, string>();
  const supabase = createServerClient(API_URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value === "" ? jar.delete(name) : jar.set(name, value))),
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: PERSONAS[persona].email, password: PASSWORD });
  if (error || !data.session) throw new Error(`API sign-in failed for ${persona}: ${error?.message}`);
  // @supabase/ssr writes cookies from an auth event; give it a moment.
  for (let i = 0; i < 40 && jar.size === 0; i++) await new Promise((r) => setTimeout(r, 50));
  if (jar.size === 0) throw new Error("No auth cookies were produced");
  const expires = Math.floor(Date.now() / 1000) + 400 * 86400;
  return {
    at: Date.now(),
    accessToken: data.session.access_token,
    cookies: [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", expires, httpOnly: false, secure: false, sameSite: "Lax" as const })),
  };
}

/** Reuses a cached session for up to 40 minutes (access token lasts 60). `fresh` forces a new, private one. */
export async function getSession(persona: PersonaKey, fresh = false): Promise<CachedSession> {
  if (!fresh) {
    const cached = readJson<Record<string, CachedSession>>("sessions.json", {})[persona];
    if (cached && Date.now() - cached.at < 40 * 60_000) return cached;
  }
  const session = await createSession(persona);
  if (!fresh) writeJson("sessions.json", { ...readJson<Record<string, CachedSession>>("sessions.json", {}), [persona]: session });
  return session;
}

export async function signedInContext(browser: Browser, persona: PersonaKey, opts: { fresh?: boolean } = {}): Promise<{ context: BrowserContext; page: Page; accessToken: string }> {
  const session = await getSession(persona, opts.fresh ?? false);
  const context = await browser.newContext();
  await context.addCookies(session.cookies);
  const page = await context.newPage();
  return { context, page, accessToken: session.accessToken };
}

// ---------------------------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------------------------
export async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await throttleSignIn();
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

export async function loginViaUi(page: Page, persona: PersonaKey, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await fillAndSubmit(page, PERSONAS[persona].email, PASSWORD);
}

/** The Dashboard h1 is the greeting "Shalom, {first name}!" (D-023); the tab title stays "Dashboard". */
export function dashboardHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: /^Shalom, .+!$/ });
}

export async function expectOnDashboard(page: Page) {
  await expect(page).toHaveURL(/^http:\/\/localhost:3100\/(\?.*)?$/);
  await expect(dashboardHeading(page)).toBeVisible();
  await expect(page).toHaveTitle(/Dashboard/);
}

export async function expectNoAccessScreen(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Belum ada akses" })).toBeVisible();
  await expect(page.getByText("Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA.")).toBeVisible();
}

// ---------------------------------------------------------------------------------------------
// Direct API calls (publishable key only, like any outsider could make)
// ---------------------------------------------------------------------------------------------
export async function rpc(fn: string, token?: string, schema = "nexus") {
  const headers: Record<string, string> = {
    apikey: PUBLISHABLE_KEY,
    "Content-Type": "application/json",
    "Content-Profile": schema,
    "Accept-Profile": schema,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: "{}" });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------------------------
// Seed data flips that must be undone
// ---------------------------------------------------------------------------------------------
export function memberRow(email: string) {
  const [is_active, must_change_password, deactivated_at] = sql(
    `select is_active, must_change_password, coalesce(deactivated_at::text,'') from public.members where email='${email}'`,
  ).split("|");
  return { is_active: is_active === "t", must_change_password: must_change_password === "t", deactivated_at };
}
export function setMustChange(email: string, value: boolean) {
  sql(`update public.members set must_change_password=${value} where email='${email}'`);
}
export function setActive(email: string, value: boolean) {
  sql(`update public.members set is_active=${value} where email='${email}'`);
}
export function setBan(email: string, banned: boolean) {
  sql(`update auth.users set banned_until=${banned ? "now() + interval '1 day'" : "null"} where email='${email}'`);
}
export function setActivePeriod(label: string | null) {
  sql("update public.periods set is_active = false where is_active");
  if (label) sql(`update public.periods set is_active = true where label = '${label}'`);
}
