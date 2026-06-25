import { test, expect, type Page } from "@playwright/test";
import { togetherResponse, seatmapResponse } from "./fixtures/together.fixture";

// ST-4 Layer 4 — the acceptance test. Asserts L4.1–L4.5 against the route-mocked
// fixture (see e2e/fixtures/together.fixture.ts — THE FIXTURE IS THE DoD).

interface Counter {
  together: number;
  seatmap: number;
}

/** Intercept the app's API at the browser. Returns a live call counter so tests
 *  can assert which interactions hit the network vs recompute client-side. */
async function installRoutes(page: Page, opts: { blockGone?: boolean } = {}): Promise<Counter> {
  const counter: Counter = { together: 0, seatmap: 0 };

  await page.route("**/together*", async (route) => {
    counter.together += 1;
    const url = new URL(route.request().url());
    const minScore = Number(url.searchParams.get("minScore") ?? "0");
    await route.fulfill({ json: togetherResponse(minScore) });
  });

  await page.route("**/seatmap*", async (route) => {
    counter.seatmap += 1;
    await route.fulfill({ json: seatmapResponse({ blockGone: opts.blockGone }) });
  });

  return counter;
}

/** Open the app, switch to Seats-together, enter the movie, run an initial Scan,
 *  and wait for the matrix to render. */
async function scan(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: "Seats together" }).click();
  await page.getByPlaceholder("e.g. 19796").fill("19796");
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(page.locator("table.matrix")).toBeVisible();
}

const A27 = 'td[data-cinema="A"][data-date="2026-06-27"]';
const A28 = 'td[data-cinema="A"][data-date="2026-06-28"]';
const A29 = 'td[data-cinema="A"][data-date="2026-06-29"]';
const B27 = 'td[data-cinema="B"][data-date="2026-06-27"]';
const B28 = 'td[data-cinema="B"][data-date="2026-06-28"]';

/** Set the controlled range input and fire React's onChange (input event). */
async function setMinScore(page: Page, value: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.querySelector('input[aria-label="Min score"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.describe("ST-4 L4 — Seats Together E2E acceptance", () => {
  test("L4.1 matrix renders both fixture cinemas across the seeded date range", async ({ page }) => {
    await installRoutes(page);
    await scan(page);

    // Both cinemas appear as row headers.
    await expect(page.getByRole("rowheader", { name: "IMAX Sydney" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Event George St" })).toBeVisible();

    // Contiguous 3-day axis: 27, 28, 29 Jun (28 has no cinema-A session but is in range).
    await expect(page.locator("th.matrix-date[data-date]")).toHaveCount(3);
    await expect(page.locator('th.matrix-date[data-date="2026-06-28"]')).toBeVisible();

    // Sticky first column present (mobile horizontal scroll).
    await expect(page.locator("th.matrix-sticky-col").first()).toBeAttached();
  });

  test("L4.2 the three cell states are visually distinct (score / sold / —)", async ({ page }) => {
    await installRoutes(page);
    await scan(page);

    // score: great block at A/27 shows the number 96
    const score = page.locator(`${A27} .matrix-cell--score`);
    await expect(score).toBeVisible();
    await expect(score).toHaveText("96");

    // sold: B/27 (sessions exist, all blockless)
    const sold = page.locator(`${B27} .matrix-cell--sold`);
    await expect(sold).toBeVisible();
    await expect(sold).toHaveText("sold");

    // empty: A/28 (no session in window) renders the em dash
    const empty = page.locator(`${A28} .matrix-cell--empty`);
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText("—");

    // states are genuinely different elements/classes
    await expect(page.locator(`${A27} .matrix-cell--sold`)).toHaveCount(0);
    await expect(page.locator(`${B27} .matrix-cell--score`)).toHaveCount(0);
  });

  test("L4.3 changing minScore fires a NEW /together request and the grid updates", async ({ page }) => {
    const counter = await installRoutes(page);
    await scan(page);

    expect(counter.together).toBe(1);
    // Before: B/28 is a score cell (avg 88).
    await expect(page.locator(`${B28} .matrix-cell--score`)).toHaveText("88");

    // Raise minScore to 90 → a new server query (#39 drops blocks < 90).
    await setMinScore(page, 90);

    await expect.poll(() => counter.together).toBe(2);
    // After: B/28's block (88 < 90) is gone → the cell now reads "sold".
    await expect(page.locator(`${B28} .matrix-cell--sold`)).toBeVisible();
    // The great block (96 ≥ 90) survives.
    await expect(page.locator(`${A27} .matrix-cell--score`)).toHaveText("96");
  });

  test("L4.4 format + Evenings filters recompute client-side with NO new network call", async ({ page }) => {
    const counter = await installRoutes(page);
    await scan(page);

    expect(counter.together).toBe(1);
    await expect(page.locator("th.matrix-date[data-date]")).toHaveCount(3);

    // Filter to IMAX only — drops the Standard sessions (A/29, B/27).
    await page.getByRole("button", { name: "IMAX", exact: true }).click();
    // Evenings only — keeps A/27 (19:30) and B/28 (19:00); A/29 (14:00) already gone.
    await page.locator("select").nth(1).selectOption({ label: "Evenings" });

    // Recompute is client-side: NO extra /together call.
    expect(counter.together).toBe(1);

    // Grid recomputed: surviving dates are only 27 + 28 (29 had no IMAX evening).
    await expect(page.locator("th.matrix-date[data-date]")).toHaveCount(2);
    await expect(page.locator('th.matrix-date[data-date="2026-06-29"]')).toHaveCount(0);
    // The two evening-IMAX score cells remain.
    await expect(page.locator(`${A27} .matrix-cell--score`)).toHaveText("96");
    await expect(page.locator(`${B28} .matrix-cell--score`)).toHaveText("88");
    // A/29 column is gone entirely.
    await expect(page.locator(A29)).toHaveCount(0);
  });

  test("L4.5 click the great-block cell → drill-in → confirm → block highlighted on the seat map", async ({ page }) => {
    const counter = await installRoutes(page);
    await scan(page);

    // Click the great-block score cell (A/27).
    await page.locator(`${A27} button.matrix-cell--score`).click();

    // Drill-in dialog lists the qualifying session(s).
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const row = page.locator("[data-session-row]");
    await expect(row).toHaveCount(1);

    // Confirm the session → a live /seatmap call.
    await row.first().click();
    await expect.poll(() => counter.seatmap).toBe(1);

    // The block's two seats are highlighted on the rendered map.
    await expect(page.locator(".seat--hi")).toHaveCount(2);
    const ids = await page.locator(".seat--hi").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-seat-id")).sort(),
    );
    expect(ids).toEqual(["L7", "L8"]);
  });
});
