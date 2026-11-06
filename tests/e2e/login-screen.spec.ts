// F1, F3, F7, F9, F10 and AUTH-01, 03, 05, 07, 09-13, 26, 29, 31, 32, 43, 44 on the login screen itself.
// Mobile project = 390x844. Sign-ins are rationed by throttleSignIn() (Auth allows 30 per 5 minutes per IP).
import { expect, test, type Page } from "@playwright/test";
import { API_URL } from "../support/local-stack";
import { PASSWORD, PERSONAS, expectOnDashboard, fillAndSubmit, loginViaUi, signedInContext } from "./helpers";

const TOKEN_URL = `${API_URL}/auth/v1/token**`;
const alert = (page: Page) => page.locator("#login-alert");

test.describe("anonymous visitor (AUTH-01, AUTH-03)", () => {
  test("home page redirects to /login with no `next` (F1)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page).toHaveTitle("Masuk | PMK-NEXUS");
  });

  test("a deep link redirects to /login?next=<path> (F10, AUTH-01)", async ({ page }) => {
    await page.goto("/finance/reports?year=2026");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/finance/reports?year=2026");
    expect(url.searchParams.get("reason")).toBeNull();
  });

  test("any unknown path is protected too, not a public 404", async ({ page }) => {
    await page.goto("/no-access");
    expect(new URL(page.url()).pathname).toBe("/login");
    await page.goto("/does/not/exist");
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("a stale session cookie redirects with the 'session ended' notice (F9, AUTH-29)", async ({ page, context }) => {
    await context.addCookies([{ name: "sb-127-auth-token", value: "garbage", domain: "localhost", path: "/" }]);
    await page.goto("/finance");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/finance");
    expect(url.searchParams.get("reason")).toBe("session_ended");
    await expect(page.getByRole("status").filter({ hasText: "Sesi kamu berakhir. Masuk lagi." })).toBeVisible();
  });

  test("the notice disappears when the person submits again (design 4.3)", async ({ page }) => {
    await page.goto("/login?reason=session_ended");
    const notice = page.getByText("Sesi kamu berakhir. Masuk lagi.");
    await expect(notice).toBeVisible();
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(notice).toBeHidden();
    await expect(alert(page)).toHaveText(/Isi email dan kata sandi kamu\./);
  });
});

test.describe("login screen content (AUTH-03, design 2.8)", () => {
  test("shows the approved copy and no sign-up, social login, or create-account control", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Masuk ke PMK-NEXUS" })).toBeVisible();
    await expect(page.getByText("Pakai email dan kata sandi akun PI-CORE kamu.")).toBeVisible();
    await expect(page.getByText("Akun dibuat oleh admin PMK ITERA.")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Kata sandi", { exact: true })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/daftar|buat akun|sign ?up|register|google|segera hadir/i);
    // Only form buttons exist; the page has no links at all.
    await expect(page.getByRole("link")).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main form")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
  });

  test("field attributes: email keyboard, username autofill, no autocapitalize, 16px text (D-017 Q2)", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    await expect(email).toHaveAttribute("autocapitalize", "none");
    const password = page.getByLabel("Kata sandi", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    for (const field of [email, password]) {
      expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }
  });

  test("password reveal toggles the field type and the button's name (design 2.5a, 4.4)", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Kata sandi", { exact: true });
    await password.fill("rahasia123");
    await page.getByRole("button", { name: "Tampilkan kata sandi" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Sembunyikan kata sandi" }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Tampilkan kata sandi" })).toBeVisible();
  });

  test("eye button accessible name switches to 'Sembunyikan kata sandi' when pressed (design 2.5a, 4.4)", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Tampilkan kata sandi" }).click();
    await expect(page.getByRole("button", { name: "Sembunyikan kata sandi" })).toBeVisible();
  });

  test("'Lupa kata sandi?' opens and closes the note and sends no request (F7, AUTH-26)", async ({ page }) => {
    await page.goto("/login");
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    const toggle = page.getByRole("button", { name: /Lupa kata sandi\?/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText("Kata sandi direset oleh admin PMK ITERA. Minta kata sandi sementara kepada mereka, lalu ganti di PI-CORE."),
    ).toBeVisible();
    await expect(page.locator("#forgot-note input")).toHaveCount(0);
    await toggle.click();
    await expect(page.getByText(/Kata sandi direset oleh admin/)).toBeHidden();
    expect(requests.filter((u) => !u.includes("/_next/") && !u.endsWith("/login"))).toEqual([]);
  });
});

test.describe("layout, keyboard, touch targets (design 4.4, 4.5)", () => {
  test("no horizontal scroll at 390 px, in idle, error and forgot-note states", async ({ page }) => {
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.goto("/login");
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(alert(page)).toBeVisible();
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: /Lupa kata sandi/ }).click();
    expect(await fits()).toBe(true);
  });

  test("a very long email does not break the layout", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("a".repeat(400) + "@student.itera.ac.id");
    await page.getByLabel("Kata sandi", { exact: true }).fill("x".repeat(300));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("tab order is Email, Kata sandi, eye, Lupa kata sandi?, Masuk", async ({ page }) => {
    await page.goto("/login");
    const active = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? `${el.tagName.toLowerCase()}:${el.id || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20)}` : "none";
      });
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      seen.push(await active());
    }
    expect(seen).toEqual(["input:email", "input:password", "button:Tampilkan kata sandi", "button:Lupa kata sandi?", "button:Masuk"]);
    // Nothing is auto-focused on load (the phone keyboard would cover the title).
    await page.goto("/login");
    expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe("body");
  });

  test("Enter in a field submits", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").press("Enter");
    await expect(alert(page)).toHaveText(/Isi email dan kata sandi kamu\./);
  });

  test("touch targets are at least 44 px", async ({ page }) => {
    await page.goto("/login");
    const size = async (locator: ReturnType<Page["locator"]>) => {
      const box = await locator.boundingBox();
      return { w: Math.round(box!.width), h: Math.round(box!.height) };
    };
    const eye = await size(page.getByRole("button", { name: "Tampilkan kata sandi" }));
    expect(eye.w).toBeGreaterThanOrEqual(44);
    expect(eye.h).toBeGreaterThanOrEqual(44);
    const forgot = await size(page.getByRole("button", { name: /Lupa kata sandi/ }));
    expect(forgot.h).toBeGreaterThanOrEqual(44);
    expect(forgot.w).toBeGreaterThanOrEqual(44);
    expect((await size(page.getByRole("button", { name: "Masuk", exact: true }))).h).toBeGreaterThanOrEqual(44);
    expect((await size(page.getByLabel("Email"))).h).toBeGreaterThanOrEqual(44);
  });
});

test.describe("form errors", () => {
  test("empty fields: message, only empty fields flagged, focus moves, NO request sent (AUTH-09)", async ({ page }) => {
    await page.goto("/login");
    const authCalls: string[] = [];
    page.on("request", (r) => r.url().startsWith(API_URL) && authCalls.push(r.url()));

    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(alert(page)).toHaveText(/Isi email dan kata sandi kamu\./);
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Kata sandi", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toBeFocused();

    await page.getByLabel("Email").fill("a@b.c");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Kata sandi", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Kata sandi", { exact: true })).toBeFocused();

    await page.getByLabel("Email").fill("   ");
    await page.getByLabel("Kata sandi", { exact: true }).fill("x");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(alert(page)).toHaveText(/Isi email dan kata sandi kamu\./);
    expect(authCalls).toEqual([]);
  });

  test("wrong password and unknown email show the same message (AUTH-07); email kept, password cleared, focus on password", async ({ page }) => {
    await page.goto("/login");
    const messages: string[] = [];
    for (const [email, password] of [
      [PERSONAS.regular.email, "SalahBanget1"],
      ["tidak.ada@nexus.test", "SalahBanget1"],
    ]) {
      await fillAndSubmit(page, email, password);
      await expect(alert(page)).toBeVisible();
      messages.push((await alert(page).innerText()).trim());
      await expect(page.getByLabel("Email")).toHaveValue(email);
      await expect(page.getByLabel("Kata sandi", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Kata sandi", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByLabel("Email")).toHaveAttribute("aria-describedby", "login-alert");
    }
    expect(messages).toEqual(["Email atau kata sandi salah.", "Email atau kata sandi salah."]);
    // AUTH-44 / AR12: nothing sensitive in the URL
    expect(page.url()).not.toMatch(/SalahBanget1|@nexus\.test|password/i);
    expect(new URL(page.url()).search).toBe("");
  });

  test("HTTP 429 from Auth: rate-limit message, fields stay filled, button usable (AUTH-10)", async ({ page }) => {
    await page.route(TOKEN_URL, (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }) }),
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.c");
    await page.getByLabel("Kata sandi", { exact: true }).fill("pw-keep");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(alert(page)).toHaveText(/Terlalu banyak percobaan\. Tunggu beberapa menit lalu coba lagi\./);
    await expect(page.getByLabel("Email")).toHaveValue("a@b.c");
    await expect(page.getByLabel("Kata sandi", { exact: true })).toHaveValue("pw-keep");
    await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Masuk", exact: true })).toBeEnabled();
    expect(await alert(page).innerText()).not.toMatch(/rate limit|over_request/i);
  });

  test("Auth unreachable (request aborted): connection message, never wrong credentials, email kept (AUTH-11)", async ({ page }) => {
    await page.route(TOKEN_URL, (route) => route.abort("connectionrefused"));
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.c");
    await page.getByLabel("Kata sandi", { exact: true }).fill("pw-keep");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(alert(page)).toHaveText(/Tidak bisa terhubung\. Periksa internetmu lalu coba lagi\./);
    await expect(alert(page)).not.toContainText("salah");
    await expect(page.getByLabel("Email")).toHaveValue("a@b.c");
    await expect(page.getByLabel("Kata sandi", { exact: true })).toHaveValue("pw-keep");
  });

  test("Auth answers 500 or 503: 'gangguan' message, never wrong credentials (AUTH-11)", async ({ page }) => {
    for (const status of [500, 503]) {
      await page.route(TOKEN_URL, (route) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status, msg: "internal detail: pg stack trace" }) }),
      );
      await page.goto("/login");
      await page.getByLabel("Email").fill("a@b.c");
      await page.getByLabel("Kata sandi", { exact: true }).fill("pw");
      await page.getByRole("button", { name: "Masuk", exact: true }).click();
      await expect(alert(page), `status ${status}`).toHaveText(/Terjadi gangguan\. Coba lagi sebentar lagi\./);
      expect(await alert(page).innerText()).not.toMatch(/internal|stack|salah/i);
      await page.unroute(TOKEN_URL);
    }
  });

  test("browser offline: connection message and no request (AUTH-11)", async ({ page, context }) => {
    await page.goto("/login");
    await context.setOffline(true);
    const calls: string[] = [];
    page.on("request", (r) => r.url().startsWith(API_URL) && calls.push(r.url()));
    await page.getByLabel("Email").fill("a@b.c");
    await page.getByLabel("Kata sandi", { exact: true }).fill("pw");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(alert(page)).toHaveText(/Tidak bisa terhubung/);
    expect(calls).toEqual([]);
    await context.setOffline(false);
  });

  test("Auth never answers: after about 15 s the form ends the attempt as 'no network' and can be used again (design 4.3)", async ({ page }) => {
    await page.route(TOKEN_URL, () => new Promise(() => {})); // never fulfils
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.c");
    await page.getByLabel("Kata sandi", { exact: true }).fill("pw");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(page.getByRole("button", { name: /Memeriksa/ })).toBeVisible();
    await expect(alert(page)).toHaveText(/Tidak bisa terhubung|Terjadi gangguan/, { timeout: 25_000 });
    await expect(page.getByRole("button", { name: "Masuk", exact: true })).toBeEnabled();
  });

  test("submitting state: 'Memeriksa...', fields read-only, a second press sends no second request", async ({ page }) => {
    let tokenCalls = 0;
    await page.route(TOKEN_URL, async (route) => {
      tokenCalls++;
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) });
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.c");
    await page.getByLabel("Kata sandi", { exact: true }).fill("pw");
    const submit = page.getByRole("button", { name: /Masuk|Memeriksa/ }).last();
    await submit.click();
    await expect(page.getByRole("button", { name: /Memeriksa\.\.\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Memeriksa\.\.\./ })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Email")).toHaveJSProperty("readOnly", true);
    await page.getByRole("button", { name: /Memeriksa\.\.\./ }).click({ force: true });
    await expect(alert(page)).toHaveText(/Email atau kata sandi salah\./);
    expect(tokenCalls).toBe(1);
  });
});

test.describe("small things (EC13, headers)", () => {
  test("email is case-insensitive and trimmed: ' MEMBER.REGULAR@NEXUS.TEST ' signs in", async ({ page }) => {
    await page.goto("/login");
    await fillAndSubmit(page, `  ${PERSONAS.regular.email.toUpperCase()}  `, PASSWORD);
    await expectOnDashboard(page);
  });

  test("the password field is never prefilled and not stored in the page after a reload (EC13)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Kata sandi", { exact: true }).fill("TopSecret99");
    await page.reload();
    await expect(page.getByLabel("Kata sandi", { exact: true })).toHaveValue("");
    expect(await page.content()).not.toContain("TopSecret99");
  });

  test("security headers are present on the login page and on redirects (spec 8.7)", async ({ request }) => {
    for (const path of ["/login", "/"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      const h = res.headers();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["x-powered-by"], path).toBeUndefined();
    }
  });
});

test.describe("sign-in mechanics (AUTH-12, AUTH-13, AUTH-44)", () => {
  test("sign-in is sent from the browser to Auth, the password never goes to the NEXUS server, cookies come from a server response", async ({ page, context }) => {
    const toNexus: { url: string; body: string }[] = [];
    let authPost = false;
    const setCookieFromServer: string[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith("http://localhost:3100")) toNexus.push({ url: r.url(), body: r.postData() ?? "" });
      if (r.url().startsWith(`${API_URL}/auth/v1/token`) && r.method() === "POST") authPost = true;
    });
    page.on("response", async (res) => {
      if (res.url().startsWith("http://localhost:3100") && res.request().method() === "POST") {
        const headers = await res.headersArray();
        headers.filter((h) => h.name.toLowerCase() === "set-cookie" && /^sb-/.test(h.value)).forEach((h) => setCookieFromServer.push(h.value));
      }
    });
    await loginViaUi(page, "ketum");
    await expectOnDashboard(page);

    expect(authPost).toBe(true);
    expect(JSON.stringify(toNexus)).not.toContain(PASSWORD);
    for (const r of toNexus) expect(r.url).not.toMatch(new RegExp(`${PASSWORD}|ketum@nexus`));

    // AUTH-13: the cookies were (re)issued by a server response
    expect(setCookieFromServer.length).toBeGreaterThan(0);
    for (const c of setCookieFromServer) {
      expect(c).toMatch(/SameSite=Lax/i);
      expect(c).toMatch(/Secure/i); // production build
      expect(c).toMatch(/Path=\//i);
    }
    const cookies = (await context.cookies()).filter((c) => /^sb-.+-auth-token/.test(c.name));
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) expect(c.sameSite).toBe("Lax");
    expect(page.url()).not.toContain(PASSWORD);
  });
});

test.describe("`next` return address (F10, AUTH-31, AUTH-32)", () => {
  test("a valid deep link with query ends on that exact path (AUTH-31)", async ({ page }) => {
    await page.goto("/finance?tab=summary");
    await expect(page).toHaveURL(/\/login\?next=%2Ffinance%3Ftab%3Dsummary$/);
    await fillAndSubmit(page, PERSONAS.bendahara.email, PASSWORD);
    await expect(page).toHaveURL("http://localhost:3100/finance?tab=summary");
  });

  const unsafe: [string, string][] = [
    ["//evil.example", "//evil.example"],
    ["/\\evil.example", "/\\evil.example"],
    ["https://evil.example", "https://evil.example"],
    ["/login", "/login"],
  ];
  for (const [label, value] of unsafe) {
    test(`sign-in with next=${label} ends on the home page, never off-site (AUTH-32)`, async ({ page }) => {
      const offsite: string[] = [];
      await page.route((url) => url.hostname === "evil.example", (route) => {
        offsite.push(route.request().url());
        return route.abort();
      });
      await page.goto(`/login?next=${encodeURIComponent(value)}`);
      await fillAndSubmit(page, PERSONAS.ketum.email, PASSWORD);
      await expectOnDashboard(page);
      expect(new URL(page.url()).origin).toBe("http://localhost:3100");
      expect(offsite).toEqual([]);
    });
  }

  test("a signed-in member opening /login is redirected; unsafe `next` values go home, safe ones are honoured (AUTH-05, AUTH-32)", async ({ browser }) => {
    const { context, page } = await signedInContext(browser, "regular");
    const offsite: string[] = [];
    await page.route((url) => url.hostname === "evil.example", (route) => {
      offsite.push(route.request().url());
      return route.abort();
    });
    await page.goto("/login");
    await expectOnDashboard(page);

    const rawQueries = [
      "next=%2F%2Fevil.example",
      "next=%2F%5Cevil.example",
      "next=https%3A%2F%2Fevil.example",
      "next=%2Flogin",
      `next=%2F${"a".repeat(600)}`,
      "next=%2Ffin%09ance",
      "next=%2F%0D%0Aevil",
      "next=%2F.%2F%2Fevil.example",
      "next=javascript%3Aalert(1)",
      "next=a&next=%2Ffinance", // first value wins; "a" is not a path
      "next=",
    ];
    for (const q of rawQueries) {
      await page.goto(`/login?${q}`);
      await expect(page, q.slice(0, 40)).toHaveURL("http://localhost:3100/");
    }
    await page.goto("/login?next=%2Ffinance%3Fx%3D1");
    await expect(page).toHaveURL("http://localhost:3100/finance?x=1");
    expect(offsite).toEqual([]);
    await context.close();
  });

  test("EC15: unrelated query values on /login are ignored", async ({ page }) => {
    await page.goto("/login?utm_source=chat&fbclid=abc&reason=weird&next=%2Fletters");
    await expect(page.getByText("Sesi kamu berakhir")).toHaveCount(0);
    await expect(alert(page)).toHaveCount(0);
  });
});

