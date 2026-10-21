/**
 * apps/web/e2e/price-badge.spec.ts — S12's proof, one test per state.
 *
 * The badge is the page's honesty mechanism (V6): a price is two facts —
 * `offer_class` and `price_status` — and a screen that shows only the happy one
 * turns a seed placeholder into a quote. Three states, and each is driven by a
 * FIXTURE rather than by a clever selector:
 *
 *   - `démo`      every component is SEED_UNVERIFIED (the mock's `demo` id);
 *   - `indicatif` a mix of verified and seed prices (the three-build fixture's
 *                 rank 2, which is what the API derives `indicative` for);
 *   - `vérifié`   every component is VERIFIED (the same fixture's rank 1).
 *
 * Two copy decisions are asserted rather than left to review:
 *
 *   1. the tone mapping is the KIT's (`docs/design/TOKEN_MAP.md` §9): démo is
 *      the dashed muted pill, indicatif the warning pair, vérifié the success
 *      pair — so the sprint's "(warn token)" for démo is a recorded deviation,
 *      because warning already means "a price exists but is stale".
 *   2. the date says what it dates. `generated_at` is when the pass RAN, not
 *      when a shop surveyed its price (CD-6 has no per-offer observed date), so
 *      the badge says "calculé le", never the board's "prix constatés le".
 */

import { test, expect } from "@playwright/test";

import { formatDate } from "../lib/i18n/format";
import { DISCLAIMER, GENERATED_AT, IDS } from "../mock/fixtures.mjs";

const THREE = `/fr/config/${IDS.threeBuilds}`;
const DEMO = `/fr/config/${IDS.demo}`;

test("an all-seed build is Démo: the dashed muted pill, and no date", async ({ page }) => {
  await page.goto(DEMO);
  const badge = page.locator("article").first().locator('span[data-tone="demo"]');

  await expect(badge).toHaveText("Démo");
  // The board's shape, not just its colour: a demo price is the LEAST known
  // state, so it is dashed. Colour is never the only signal.
  await expect(badge).toHaveCSS("border-top-style", "dashed");
  // A demo price has no observed date to print; inventing one is CD-6's failure.
  await expect(badge).not.toContainText(String(new Date(GENERATED_AT).getUTCFullYear()));
});

test("a build with one seed part is Indicatif, and the pass says so per build", async ({ page }) => {
  await page.goto(THREE);
  const cards = page.locator("article");

  // Rank 2 mixes a verified CPU with a seed RAM: the API's derived state.
  await expect(cards.nth(1).locator('span[data-tone="indicative"]')).toHaveText("Indicatif");
  // Rank 1, on the SAME response, is fully verified: the badge is per build,
  // never a pass-wide label derived from the first card.
  await expect(cards.nth(0).locator('span[data-tone="verified"]')).toHaveCount(1);
});

test("an all-verified build says Vérifié and dates the CALCULATION, not a survey", async ({
  page,
}) => {
  await page.goto(THREE);
  const badge = page.locator("article").first().locator('span[data-tone="verified"]');
  const date = formatDate(GENERATED_AT, "fr");

  // The exact French phrasing, built from the same formatter the page uses, so
  // a helper change cannot make this assertion pass against different text.
  await expect(badge).toHaveText(`Vérifié · calculé le ${date}`);
  await expect(badge).not.toContainText("constat");
});

test("the API's disclaimer is displayed beside the badges", async ({ page }) => {
  await page.goto(THREE);
  await expect(page.getByText(DISCLAIMER)).toHaveCount(1);
});

test("no structured data is emitted for a demo or indicative price (S19's gate)", async ({
  request,
}) => {
  // Structured data is gated on truth: only `verified` may ever carry JSON-LD.
  // S19 owns emitting it, so this pins the other half — the raw HTML a crawler
  // reads must contain none, on the demo page and on the page whose rank 2 is
  // indicative.
  for (const path of [DEMO, THREE]) {
    const html = await (await request.get(path)).text();
    expect(html, path).not.toContain("application/ld+json");
  }
});

test("the Arabic page names the same states", async ({ page }) => {
  await page.goto(`/ar/config/${IDS.demo}`);
  await expect(page.locator("article").first().locator('span[data-tone="demo"]')).toHaveText(
    "تجريبي",
  );

  await page.goto(`/ar/config/${IDS.threeBuilds}`);
  const verified = page.locator("article").first().locator('span[data-tone="verified"]');
  await expect(verified).toContainText("موثّق");
  await expect(verified).toContainText(formatDate(GENERATED_AT, "ar"));
});
