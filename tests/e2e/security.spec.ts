// AUTH-02, 03, 04, 25, 40, 43 against the running app and the local API. No UI sign-ins needed
// except where a session is required (cached, see helpers.getSession).
import { expect, test } from "@playwright/test";
import { API_URL, PUBLISHABLE_KEY, sql } from "../support/local-stack";
import { getSession, rpc, signedInContext } from "./helpers";

test.describe("AUTH-04: the publishable key without a user token gets nothing from nexus", () => {
  const nexusFunctions = sql(
    "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='nexus' and p.pronargs = 0 and p.proname not like '\\_%' order by 1",
  )
    .split("\n")
    .filter(Boolean);

  test("the list of no-argument nexus functions is not empty (guard against a silent no-op)", () => {
    expect(nexusFunctions).toEqual(expect.arrayContaining(["my_context", "my_permissions", "my_password_change_pending"]));
  });

  for (const fn of nexusFunctions) {
    test(`anon -> nexus.${fn}() is denied or empty`, async () => {
      const res = await rpc(fn);
      const empty = Array.isArray(res.body) && res.body.length === 0;
      // 401/403 permission denied, 404 not exposed to anon: all fine. 200 with data is the failure.
      expect(res.status >= 400 || empty, `${fn} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`).toBe(true);
    });
  }

  test("anon cannot read nexus tables or PI-CORE members through REST", async () => {
    for (const [schema, table] of [
      ["nexus", "permissions"],
      ["nexus", "access_rules"],
      ["nexus", "access_rule_log"],
      ["public", "members"],
      ["public", "assignments"],
    ]) {
      const res = await fetch(`${API_URL}/rest/v1/${table}?select=*`, { headers: { apikey: PUBLISHABLE_KEY, "Accept-Profile": schema } });
      const body = await res.json().catch(() => null);
      const empty = Array.isArray(body) && body.length === 0;
      expect(res.status >= 400 || empty, `${schema}.${table} -> ${res.status}`).toBe(true);
    }
  });

  test("anon cannot write nexus tables", async () => {
    const res = await fetch(`${API_URL}/rest/v1/access_rules`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json", "Content-Profile": "nexus" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("anon cannot sign up (sign-up is disabled on the Auth server, B12, AR1)", async () => {
    const res = await fetch(`${API_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `qa-${Date.now()}@nexus.test`, password: "NexusLocal2026x" }),
    });
    expect(res.status, await res.text()).toBeGreaterThanOrEqual(400);
    expect(sql("select count(*) from auth.users where email like 'qa-%@nexus.test'")).toBe("0");
  });

  test("a regular member's token cannot read other members or administer rules", async () => {
    const regular = await getSession("regular");
    const res = await fetch(`${API_URL}/rest/v1/members?select=email,full_name`, {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${regular.accessToken}` },
    });
    const rows = (await res.json()) as { email: string }[];
    expect(rows.map((r) => r.email)).toEqual(["member.regular@nexus.test"]);
    const rules = await rpc("list_access_rules", regular.accessToken);
    expect(rules.status >= 400 || (Array.isArray(rules.body) && rules.body.length === 0)).toBe(true);
  });
});

test.describe("AUTH-02: no Server Action or route handler answers an anonymous caller with data", () => {
  test("POST to the home page with a made-up action id is rejected without data", async ({ request }) => {
    const res = await request.post("/", {
      headers: { "Next-Action": "00".repeat(20), "Content-Type": "text/plain;charset=UTF-8" },
      data: "[]",
      maxRedirects: 0,
    });
    const text = await res.text();
    expect(text).not.toMatch(/Test (Anggota|Ketua|Bendahara|System)|member_id|full_name/);
    expect(res.status()).toBeLessThan(600);
    expect(text).not.toMatch(/at .*\.(ts|js):\d+|node_modules|stack/i);
  });

  test("no API route exists for auth, signup, reset, or members", async ({ request }) => {
    for (const path of ["/api", "/api/auth", "/api/signup", "/api/members", "/auth/callback", "/signup", "/register", "/reset-password", "/forgot-password", "/change-password", "/invite"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      // Anonymous page requests are redirected to /login; /api/* gets a bare 401 from the proxy
      // (app-layer review LOW 5). None returns content of its own.
      expect([307, 308, 401, 404], `${path} -> ${res.status()}`).toContain(res.status());
      if (res.status() === 307) expect(res.headers().location).toMatch(/\/login(\?|$)/);
      if (res.status() === 401) {
        expect(path.startsWith("/api")).toBe(true);
        expect(await res.json()).toEqual({ error: { code: "unauthenticated" } });
      }
    }
  });

  test("signed in, the sign-up / reset / change-password / admin-style paths do not exist (AUTH-03, AUTH-25)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "admin");
    for (const path of ["/signup", "/register", "/reset-password", "/forgot-password", "/change-password", "/invite", "/api/auth", "/auth/callback"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    await context.close();
  });
});

test.describe("AUTH-40, AUTH-43: nothing secret in the browser bundle, no raw errors on screen", () => {
  test("no JS chunk contains a secret key or a service_role JWT", async ({ page, request }) => {
    const scripts = new Set<string>();
    page.on("response", (r) => {
      if (/\/_next\/static\/.*\.js/.test(r.url())) scripts.add(r.url());
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.c"); // forces hydration
    expect(scripts.size).toBeGreaterThan(0);
    const html = await (await request.get("/login")).text();
    const all = [html];
    for (const url of scripts) all.push(await (await request.get(url)).text());
    const joined = all.join("\n");

    expect(joined).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16,}/);
    for (const m of joined.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      expect(payload.role, "a JWT in the bundle must not be service_role").not.toBe("service_role");
    }
    // The publishable key (public by design) may appear; the DB password and JWT secret must not.
    expect(joined).not.toMatch(/postgres:\/\/|SERVICE_ROLE|JWT_SECRET/);
  });

  test("server-side render of /login and the 404 page leak no stack trace or env values", async ({ request }) => {
    for (const path of ["/login", "/login?next=%00", "/login?next=" + "a".repeat(5000)]) {
      const res = await request.get(path);
      const text = await res.text();
      expect(res.status(), path.slice(0, 40)).toBeLessThan(500);
      expect(text).not.toMatch(/node_modules|\.next\/server|ECONNREFUSED|PGRST|jwt expired|supabase_secret/i);
    }
  });

  test("security headers and no-store on the login page and on a redirect", async ({ request }) => {
    const login = await request.get("/login");
    expect(login.headers()["cache-control"]).toMatch(/no-store/);
    const redirect = await request.get("/", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["cache-control"]).toMatch(/no-store/);
  });
});
