// Desktop project (1280x800): layout rules from design 4.6 and one full round trip.
import { expect, test } from "@playwright/test";
import { expectOnDashboard, fillAndSubmit, PASSWORD, PERSONAS } from "./helpers";

test("login card is centred at 448 px max, app bar spans the full width (design 4.6)", async ({ page }) => {
  await page.goto("/login");
  const card = await page.locator("main section").first().boundingBox();
  const bar = await page.locator("header").first().boundingBox();
  expect(Math.round(card!.width)).toBeLessThanOrEqual(448);
  expect(Math.round(card!.width)).toBeGreaterThan(400);
  expect(Math.abs(card!.x + card!.width / 2 - 640)).toBeLessThan(2);
  expect(Math.round(bar!.width)).toBe(1280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("desktop: keyboard-only sign-in works (Tab through, Enter submits) and lands on the Dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await page.keyboard.type(PERSONAS.ketum.email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  const { throttleSignIn } = await import("./helpers");
  await throttleSignIn();
  await page.keyboard.press("Enter");
  await expectOnDashboard(page);
  await expect(page.getByText("Masuk sebagai Test Ketua Umum.")).toBeVisible();
});

test("desktop: wrong password shows the message and keeps the email (round trip)", async ({ page }) => {
  await page.goto("/login");
  await fillAndSubmit(page, PERSONAS.regular.email, "SalahBanget1");
  await expect(page.locator("#login-alert")).toHaveText(/Email atau kata sandi salah\./);
  await expect(page.getByLabel("Email")).toHaveValue(PERSONAS.regular.email);
});

test("desktop: focus is visible on every control (no outline: none)", async ({ page }) => {
  await page.goto("/login");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      const parent = el.closest("div") ? getComputedStyle(el.closest("div") as HTMLElement) : s;
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const border = parseFloat(s.borderTopWidth) >= 2 || parseFloat(parent.borderTopWidth) >= 2;
      const ring = s.boxShadow !== "none";
      return outline || border || ring;
    });
    expect(visible, `tab stop ${i + 1}`).toBe(true);
  }
});
