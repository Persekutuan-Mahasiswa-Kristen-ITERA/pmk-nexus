// Per-persona login results and the signed-in states. Personas: docs/ops/local-setup.md section 3.
//   AUTH-06, 08, 14, 15, 16, 17, 19, 20, 21, 33, 34, 35, 36(part), 37(part), 38, 39, 27, 29, 30(not testable)
// Everything these tests flip in the database (is_active, must_change_password, ban, active period) is put back
// in `finally` blocks and again by global-teardown.
import { expect, test, type Page } from "@playwright/test";
import { API_URL, PICORE_URL, PUBLISHABLE_KEY } from "../support/local-stack";
import {
  PASSWORD,
  PERSONAS,
  dashboardHeading,
  expectNoAccessScreen,
  expectOnDashboard,
  fillAndSubmit,
  getSession,
  loginViaUi,
  memberRow,
  rpc,
  setActive,
  setActivePeriod,
  setBan,
  setMustChange,
  signedInContext,
} from "./helpers";

const alert = (page: Page) => page.locator("#login-alert");
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const authCookieCount = async (page: Page) => (await page.context().cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name)).length;

test.describe("active members land on the Dashboard (AUTH-06, AUTH-36, AUTH-37)", () => {
  const cases = [
    ["regular", "Test Anggota Biasa"],
    ["ketum", "Test Ketua Umum"],
    ["bendahara", "Test Bendahara Umum 1"],
    ["admin", "Test System Admin"],
  ] as const;

  for (const [persona, fullName] of cases) {
    test(`${persona}: signs in, sees their own name and the active period, no module data`, async ({ page }) => {
      await loginViaUi(page, persona);
      await expectOnDashboard(page);
      await expect(page.getByText(`Masuk sebagai ${fullName}.`)).toBeVisible();
      await expect(page.getByText("Periode 2026/2027", { exact: true }).first()).toBeVisible(); // the chip; module cards repeat the period
      await expect(page.getByText("Belum ada periode aktif.")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
      // Not a No-access screen. Module cards follow the keys: the Finance card (money) is for finance.view (BPH) only, D-028
      await expect(page.getByText("Belum ada akses")).toHaveCount(0);
      expect(await noOverflow(page)).toBe(true);
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/@nexus\.test|nim|telepon|phone/i); // no PII
      if (persona === "regular" || persona === "admin") expect(text).not.toMatch(/saldo|rp\s?\d/i); // no money without finance.view
    });
  }
});

test.describe("no access (AUTH-14, 15, 16, 17)", () => {
  test("unlinked: correct password reaches the No-access screen; menu-less; session is dropped; reload goes to /login", async ({ page, context }) => {
    await loginViaUi(page, "unlinked");
    await expectNoAccessScreen(page);
    await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.getByText(/Dashboard|Masuk sebagai/)).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    // The browser-side drop (src/lib/auth/drop-session.ts) removes the cookie without re-rendering the route.
    await expect.poll(() => authCookieCount(page), { timeout: 10_000 }).toBe(0);
    await expectNoAccessScreen(page); // message is still on screen after the drop
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).filter((c) => /^sb-/.test(c.name))).toHaveLength(0);
  });

  test("deactivated but NOT banned (is_active=false): same screen, same text as unlinked (AUTH-15, AUTH-17)", async ({ page }) => {
    await loginViaUi(page, "inactive");
    await expectNoAccessScreen(page);
    const inactiveText = (await page.locator("main").innerText()).trim();
    await expect.poll(() => authCookieCount(page), { timeout: 10_000 }).toBe(0);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);

    await loginViaUi(page, "unlinked");
    await expectNoAccessScreen(page);
    expect((await page.locator("main").innerText()).trim()).toBe(inactiveText);
    expect(inactiveText).not.toMatch(/nonaktif|dinonaktifkan|deactivat|tidak aktif|belum terhubung|not linked/i);
  });

  test("No-access: 'Keluar' signs out and shows /login", async ({ page }) => {
    await loginViaUi(page, "unlinked");
    await expectNoAccessScreen(page);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Masuk ke PMK-NEXUS" })).toBeVisible();
  });

  test("a No-access person can open /login and sign in as someone else (design 4.3)", async ({ page }) => {
    await loginViaUi(page, "unlinked");
    await expectNoAccessScreen(page);
    await expect.poll(() => authCookieCount(page), { timeout: 10_000 }).toBe(0);
    await loginViaUi(page, "ketum");
    await expectOnDashboard(page);
  });

  test("API calls with the tokens of unlinked and deactivated users return nothing (AUTH-16)", async () => {
    for (const persona of ["unlinked", "inactive"] as const) {
      const session = await getSession(persona, true);
      expect((await rpc("my_context", session.accessToken)).body, persona).toEqual([]);
      expect((await rpc("my_permissions", session.accessToken)).body, persona).toEqual([]);
      expect((await rpc("my_password_change_pending", session.accessToken)).body, persona).toBe(false);
      expect((await rpc("is_system_admin", session.accessToken)).body, persona).toBe(false);
      expect((await rpc("current_member_id", session.accessToken)).body, persona).toBeNull();
      for (const fn of ["list_access_rules", "list_positions", "list_org_units", "list_rule_roles", "access_rule_warnings"]) {
        const res = await rpc(fn, session.accessToken);
        const empty = Array.isArray(res.body) && res.body.length === 0;
        expect(res.status >= 400 || empty, `${persona} ${fn} -> ${res.status} ${JSON.stringify(res.body).slice(0, 80)}`).toBe(true);
      }
    }
  });
});

test.describe("banned and reactivated accounts (AUTH-08, AUTH-35)", () => {
  test("deactivated AND banned: same message as a wrong password; reactivation lets them in again", async ({ page }) => {
    const email = PERSONAS.inactive.email;
    const before = memberRow(email);
    try {
      setBan(email, true);
      await page.goto("/login");
      await fillAndSubmit(page, email, PASSWORD);
      await expect(alert(page)).toHaveText(/^\s*Email atau kata sandi salah\.\s*$/);
      expect(await alert(page).innerText()).not.toMatch(/ban|nonaktif|deactivat|blokir/i);

      // PI-CORE reactivates: member active again and ban lifted. NEXUS needs no cleanup (AUTH-35, EC4).
      setBan(email, false);
      setActive(email, true);
      await fillAndSubmit(page, email, PASSWORD);
      await expectOnDashboard(page);
      await expect(page.getByText("Masuk sebagai Test Anggota Nonaktif.")).toBeVisible();
    } finally {
      setBan(email, false);
      setActive(email, before.is_active);
    }
  });
});

test.describe("temporary password (AUTH-19, 20, 21, 22, 25)", () => {
  test("pending screen, PI-CORE link, 'still pending' message, then the flag clears and the Dashboard opens without a new login", async ({ page }) => {
    const email = PERSONAS.temppw.email;
    try {
      setMustChange(email, true);
      await loginViaUi(page, "temppw");
      await expect(page.getByRole("heading", { level: 1, name: "Ganti kata sandi dulu" })).toBeVisible();
      await expect(
        page.getByText("Kamu masih memakai kata sandi sementara. Ganti kata sandi di PI-CORE, lalu kembali ke sini."),
      ).toBeVisible();
      await expect(page.getByText(/Masuk sebagai|Dashboard/)).toHaveCount(0);
      expect(await noOverflow(page)).toBe(true);

      const open = page.getByRole("link", { name: /Buka PI-CORE/ });
      await expect(open).toHaveAttribute("target", "_blank");
      expect(await open.getAttribute("rel")).toMatch(/noopener/);
      await expect(open).toHaveAttribute("href", `${PICORE_URL}/change-password`);
      await expect(page.getByRole("button", { name: "Sudah ganti? Muat ulang" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible();

      // Still pending: the screen says so (new string in design 2.8)
      await page.getByRole("button", { name: "Sudah ganti? Muat ulang" }).click();
      await expect(page.getByText("Kata sandimu belum berubah. Ganti di PI-CORE dulu, lalu coba lagi.")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Ganti kata sandi dulu" })).toBeVisible();

      // Every NEXUS page keeps showing the gate while the flag is true (AUTH-20)
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Ganti kata sandi dulu" })).toBeVisible();
      await page.goto("/?tab=anything");
      await expect(page.getByRole("heading", { level: 1, name: "Ganti kata sandi dulu" })).toBeVisible();

      // The person changes the password in PI-CORE (simulated: flag false), then presses the button (AUTH-21)
      setMustChange(email, false);
      await page.getByRole("button", { name: "Sudah ganti? Muat ulang" }).click();
      await expectOnDashboard(page);
      await expect(page.getByText("Masuk sebagai Test Anggota Sandi Sementara.")).toBeVisible();
    } finally {
      setMustChange(email, true);
    }
  });

  test("EC7: the flag flips to true while the person is signed in: the next request shows the gate", async ({ browser }) => {
    const email = PERSONAS.temppw.email;
    try {
      setMustChange(email, false);
      const { context, page } = await signedInContext(browser, "temppw", { fresh: true });
      await page.goto("/");
      await expectOnDashboard(page);
      setMustChange(email, true);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Ganti kata sandi dulu" })).toBeVisible();
      await context.close();
    } finally {
      setMustChange(email, true);
    }
  });

  test("the pending flag function answers only for the caller and returns one boolean (AUTH-22)", async () => {
    const temp = await getSession("temppw", true);
    const regular = await getSession("regular");
    expect((await rpc("my_password_change_pending", temp.accessToken)).body).toBe(true);
    expect((await rpc("my_password_change_pending", regular.accessToken)).body).toBe(false);
    // The function takes no arguments, so it cannot be pointed at another member
    const res = await fetch(`${API_URL}/rest/v1/rpc/my_password_change_pending`, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${regular.accessToken}`,
        "Content-Type": "application/json",
        "Content-Profile": "nexus",
      },
      body: JSON.stringify({ p_member_id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("AUTH-23 (E1 b): the database does NOT block a direct API call with the temp-password token (documented limit)", async () => {
    const temp = await getSession("temppw", true);
    const res = await rpc("my_context", temp.accessToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) && res.body.length === 1).toBe(true);
  });
});

test.describe("deactivation during a session (AUTH-33, AUTH-34, EC3)", () => {
  test("PI-CORE deactivates a signed-in member: the next request shows No access, API returns nothing, token still unexpired", async ({ browser }) => {
    const email = PERSONAS.regular.email;
    const { context, page, accessToken } = await signedInContext(browser, "regular", { fresh: true });
    try {
      await page.goto("/");
      await expectOnDashboard(page);
      expect(((await rpc("my_context", accessToken)).body as unknown[]).length).toBe(1);

      setActive(email, false);
      await page.goto("/");
      await expectNoAccessScreen(page);
      await expect(page.getByText("Masuk sebagai")).toHaveCount(0);
      // AUTH-34: same token, no data
      expect((await rpc("my_context", accessToken)).body).toEqual([]);
      expect((await rpc("my_permissions", accessToken)).body).toEqual([]);

      await page.reload();
      await expect(page).toHaveURL(/\/login$/); // the screen dropped the session
    } finally {
      setActive(email, true);
      await context.close();
    }
    // The token works again after reactivation: nothing stale is kept (AUTH-35, EC4)
    expect(((await rpc("my_context", accessToken)).body as unknown[]).length).toBe(1);
  });

  test("a Server-Action-driven recheck from the pending screen also notices a deactivation", async ({ browser }) => {
    const email = PERSONAS.temppw.email;
    let ctx;
    try {
      setMustChange(email, true);
      const s = await signedInContext(browser, "temppw", { fresh: true });
      ctx = s.context;
      await s.page.goto("/");
      await expect(s.page.getByRole("heading", { level: 1, name: "Ganti kata sandi dulu" })).toBeVisible();
      setActive(email, false);
      await s.page.getByRole("button", { name: "Sudah ganti? Muat ulang" }).click();
      await expectNoAccessScreen(s.page);
    } finally {
      setActive(email, true);
      setMustChange(email, true);
      await ctx?.close();
    }
  });

  test("a banned member whose access token has expired is sent to /login with the notice (AUTH-29, AUTH-33)", async ({ browser }) => {
    const email = PERSONAS.ketum.email;
    const { context, page } = await signedInContext(browser, "ketum", { fresh: true });
    try {
      await page.goto("/");
      await expectOnDashboard(page);
      setBan(email, true);
      // Make the access token look expired so the server must refresh (and the refresh is refused by the ban).
      await expireAccessToken(context);
      await page.goto("/");
      const url = new URL(page.url());
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("reason")).toBe("session_ended");
      await expect(page.getByText("Sesi kamu berakhir. Masuk lagi.")).toBeVisible();
    } finally {
      setBan(email, false);
      await context.close();
    }
  });

  test("an expired access token with a valid refresh token is refreshed silently, and the rotated cookie keeps working (F9 step 1)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "admin", { fresh: true });
    const cookieValue = async () =>
      (await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name)).map((c) => c.value).join("|");
    const before = await cookieValue();
    await expireAccessToken(context);
    const expired = await cookieValue();
    await page.goto("/");
    await expectOnDashboard(page);
    const after = await cookieValue();
    expect(after).not.toBe(expired); // the proxy wrote a refreshed session
    expect(after).not.toBe(before);
    await page.goto("/?again=1");
    await expectOnDashboard(page); // the rotated refresh token is the one stored
    await context.close();
  });

  test("an expired token with a refresh token the server no longer knows -> /login?next=...&reason=session_ended (F9, AUTH-29)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "bendahara", { fresh: true });
    await expireAccessToken(context, "revoked-or-unknown-refresh-token");
    await page.goto("/finance?x=1");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/finance?x=1");
    expect(url.searchParams.get("reason")).toBe("session_ended");
    await expect(page.getByText("Sesi kamu berakhir. Masuk lagi.")).toBeVisible();
    await context.close();
  });
});

test.describe("logout (AUTH-27)", () => {
  test("'Keluar' returns to /login, removes the cookie, and protected pages redirect afterwards; Back shows no data", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "regular", { fresh: true });
    await page.goto("/");
    await expectOnDashboard(page);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await authCookieCount(page)).toBe(0);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/finance");
    await expect(page).toHaveURL(/\/login\?next=%2Ffinance$/);

    await page.goBack();
    await page.goBack().catch(() => {});
    await expect(page.getByText("Masuk sebagai")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
    await expect(dashboardHeading(page)).toHaveCount(0);
    await context.close();
  });

  test("logging out one device does not end the other device's session (EC9)", async ({ browser }) => {
    const a = await signedInContext(browser, "admin", { fresh: true });
    const b = await signedInContext(browser, "admin", { fresh: true });
    await a.page.goto("/");
    await b.page.goto("/");
    await a.page.getByRole("button", { name: "Keluar" }).click();
    await expect(a.page).toHaveURL(/\/login$/);
    await b.page.goto("/");
    await expectOnDashboard(b.page);
    await a.context.close();
    await b.context.close();
  });
});

test.describe("period change and no period (AUTH-38, AUTH-39, EC1, EC2)", () => {
  test("switching the active period does not log anyone out; the label changes on the next request", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "regular");
    try {
      await page.goto("/");
      await expect(page.getByText("Periode 2026/2027")).toBeVisible();
      setActivePeriod("2025/2026");
      await page.reload();
      await expectOnDashboard(page);
      await expect(page.getByText("Periode 2025/2026")).toBeVisible();
      await expect(page.getByText("Periode 2026/2027")).toHaveCount(0);
    } finally {
      setActivePeriod("2026/2027");
      await context.close();
    }
  });

  test("with no active period, members and admins still sign in and see the banner", async ({ browser }) => {
    try {
      setActivePeriod(null);
      for (const persona of ["regular", "admin"] as const) {
        const { context, page } = await signedInContext(browser, persona);
        await page.goto("/");
        await expectOnDashboard(page);
        await expect(page.getByText("Belum ada periode aktif.")).toBeVisible();
        await expect(page.getByText(/^Periode /)).toHaveCount(0);
        await context.close();
      }
    } finally {
      setActivePeriod("2026/2027");
    }
  });
});

/** Rewrites the cached session cookie so the access token counts as expired (optionally with another refresh token). */
async function expireAccessToken(context: import("@playwright/test").BrowserContext, refreshToken?: string) {
  const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  const sorted = cookies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const joined = sorted.map((c) => c.value).join("");
  const raw = joined.startsWith("base64-") ? Buffer.from(joined.slice(7), "base64url").toString("utf8") : joined;
  const session = JSON.parse(raw);
  session.expires_at = Math.floor(Date.now() / 1000) - 3600;
  session.expires_in = 0;
  if (refreshToken) session.refresh_token = refreshToken;
  const encoded = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const base = sorted[0].name.replace(/\.\d+$/, "");
  await context.clearCookies();
  const chunkSize = 3180;
  const chunks = encoded.length <= chunkSize ? [encoded] : encoded.match(new RegExp(`.{1,${chunkSize}}`, "g"))!;
  await context.addCookies(
    chunks.map((value, i) => ({
      name: chunks.length === 1 ? base : `${base}.${i}`,
      value,
      domain: "localhost",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 86400,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}
