import { defineConfig, devices } from "@playwright/test";

// ST-4 Layer 4 — Playwright E2E acceptance harness (#40 part deferred from vitest).
//
// Scoping (so the two runners never overlap):
//   • Playwright owns ./e2e/**/*.spec.ts only (testDir below, default *.spec.ts match).
//   • Vitest owns src/**/*.test.{ts,tsx} (see vitest.config.ts `include`).
// e2e specs are *.spec.ts under e2e/, never *.test.* under src/, so neither runner
// picks up the other's files. The app build (tsconfig `include: ["src", ...]`)
// also excludes e2e/, so @playwright/test never enters the shipped bundle.
//
// The webServer builds the SPA and serves the static preview; the API routes the
// app calls are intercepted in-browser via page.route (no real API/pg needed —
// the preview proxy target being down is irrelevant because requests are fulfilled
// before they reach it).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
