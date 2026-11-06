// AUTH-18, AR10, EC11: when my_context() cannot be answered the person sees "Terjadi gangguan", NOT "Belum ada akses",
// and stays signed in. Needs a real outage, so it briefly stops the REST container of NEXUS's OWN local stack
// (never PI-CORE's). Opt-in: run with `E2E_STACK_FAULT=1 pnpm exec playwright test fault.spec.ts --project=mobile`.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { API_URL, PUBLISHABLE_KEY } from "../support/local-stack";
import { expectOnDashboard, signedInContext } from "./helpers";

const REST = "supabase_rest_pmk-nexus";
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

test.skip(process.env.E2E_STACK_FAULT !== "1", "opt-in: set E2E_STACK_FAULT=1 (stops the local REST container for a few seconds)");

test("REST down: error screen, session kept, no 'no access' wording; 'Coba lagi' recovers", async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await signedInContext(browser, "regular", { fresh: true });
  try {
    await page.goto("/");
    await expectOnDashboard(page);

    docker("stop", "-t", "2", REST);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Terjadi gangguan" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Belum ada akses")).toHaveCount(0);
    await expect(page.getByText("Coba lagi sebentar lagi. Kalau masih gagal, hubungi admin PMK ITERA.")).toBeVisible();
    const cookiesDuring = (await context.cookies()).filter((c) => /^sb-/.test(c.name));
    expect(cookiesDuring.length).toBeGreaterThan(0); // not signed out (AR10)

    // Retry while still down: stays on the error screen
    await page.getByRole("button", { name: "Coba lagi" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terjadi gangguan" })).toBeVisible({ timeout: 90_000 });

    docker("start", REST);
    // Ready = PostgREST answers through the gateway with the publishable key (any answer from Kong is not enough).
    await expect
      .poll(async () => (await fetch(`${API_URL}/rest/v1/`, { headers: { apikey: PUBLISHABLE_KEY, "Accept-Profile": "nexus" } }).catch(() => null))?.status ?? 0, { timeout: 90_000 })
      .toBe(200);
    // The schema cache may need a moment: press "Coba lagi" until it recovers.
    await expect
      .poll(
        async () => {
          if (await page.getByRole("heading", { level: 1, name: "Dashboard" }).isVisible()) return "ok";
          await page.getByRole("button", { name: "Coba lagi" }).click({ timeout: 2_000 }).catch(() => {});
          await page.waitForTimeout(1_500);
          return "waiting";
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBe("ok");
    await expectOnDashboard(page);
  } finally {
    try {
      docker("start", REST);
    } catch {
      /* already running */
    }
    await context.close();
  }
});
