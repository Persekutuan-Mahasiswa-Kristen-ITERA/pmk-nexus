import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a production build (`next start`, port 3100) and NEXUS's OWN local Supabase stack
 * (`scripts/dev-db.sh start`, API http://127.0.0.1:55431). Needs `pnpm build` first.
 * If a server already answers on 3100 it is reused (and never stopped by the tests).
 * Projects: "mobile" = 390x844 phone viewport (all specs), "desktop" = 1280x800 (desktop.spec.ts only).
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Long on purpose: a test may wait for the sign-in budget (tests/e2e/helpers.ts throttleSignIn). Real hangs still
  // fail fast through the 10 s expect timeout.
  timeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
    locale: "id-ID",
  },
  projects: [
    {
      name: "mobile",
      testIgnore: /desktop\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      testMatch: /desktop\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
