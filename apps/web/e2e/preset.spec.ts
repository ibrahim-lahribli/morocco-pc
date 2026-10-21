/**
 * apps/web/e2e/preset.spec.ts — S16's proof, in a browser.
 *
 * Four things are being proven, one per DoD scenario:
 *
 *   1. **THE BUILD IS IN THE FIRST BYTE.** The page is a server component, so the
 *      raw HTML from `request.get()` carries the totals and a component name. That
 *      is a claim a client-side implementation cannot satisfy, which is why the
 *      assertion reads the response body rather than the DOM.
 *   2. **ZERO CLIENT FETCH.** The browser never calls `/v1/*` for the builds; the
 *      page's data was fetched (or prerendered) on the server.
 *   3. **ISR IS CONFIGURED.** A fabricated, never-prerendered budget — one the
 *      ribbon serves only through the API — renders on demand and is cached; and a
 *      prerendered page advertises `s-maxage=3600`, so it revalidates rather than
 *      freezing for the life of the deploy.
 *   4. **noindex UNTIL THE PRICES ARE REAL.** Both committed fixtures are noindex;
 *      the API-served all-verified page is not. The same rule, opposite answers,
 *      because the rule reads the data and not the layout.
 *
 * Plus the 404s the generic route segment has to survive and the reuse of S11's
 * card (the DoD's "no second implementation").
 */
import { test, expect, type Page } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import { PRESET_FIXTURES } from "../lib/presets/fixtures";
import { IDS, RECOMMENDATIONS_BY_ID } from "../mock/fixtures.mjs";

const money = (amount: number, locale: "fr" | "ar" = "fr") => formatMoney(amount, locale);

const P9000 = "/fr/config-pc-gamer-9000-dh";
const P15000 = "/fr/config-pc-gamer-15000-dh";
/** A preset only the API names: the build never prerenders it (see the model spec). */
const API_ONLY = "/fr/config-pc-gamer-20000-dh";

/** The pass behind a fixture page, so the spec asserts data rather than copies. */
function passAt(budget: number) {
  const fixture = PRESET_FIXTURES.find((entry) => entry.budget === budget);
  if (fixture === undefined) throw new Error(`no committed preset fixture at ${String(budget)}`);
  return fixture.recommendation;
}

function totalOf(recommendation: typeof RECOMMENDATIONS_BY_ID[string], index = 0): number {
  const total = recommendation.builds[index].total_price;
  if (typeof total !== "number") throw new Error("fixture build has no total");
  return total;
}

/** The page's visible text, with scripts stripped (Next inlines its payload there). */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

test("the build data is in the raw HTML: the page is generated on the server", async ({
  request,
}) => {
  const pass = passAt(15000);
  const response = await request.get(P15000);
  expect(response.status()).toBe(200);
  const html = await response.text();

  // The heading names the budget the SLUG promised, formatted by the helper.
  expect(html).toContain(`Config PC gamer à ${money(15000)}`);
  // Rank 1's total and one of its parts, from the fixture the build prerendered.
  expect(html).toContain(money(totalOf(pass, 0)));
  expect(html).toContain(pass.builds[0].components[0].name);
  // The pass's own honesty line is on the page, not invented per sprint.
  expect(html).toContain(pass.disclaimer);
});

test("no browser request reaches the API for a preset page", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/")) apiCalls.push(request.url());
  });

  await page.goto(P15000);
  await expect(page.locator("article")).toHaveCount(3);
  // A hydration-time fetch would land after the paint.
  await page.waitForTimeout(500);
  expect(apiCalls).toEqual([]);
});

test("a prerendered preset page is ISR: it advertises its revalidation window", async ({
  request,
}) => {
  const response = await request.get(P15000);
  const cacheControl = response.headers()["cache-control"] ?? "";

  // `s-maxage=3600` is the interval the page exports; if the literal and
  // `PRESET_REVALIDATE_SECONDS` ever drift, or `revalidate` is dropped, the page
  // stops refreshing and this assertion is what notices.
  expect(cacheControl).toContain("s-maxage=3600");
  expect(cacheControl).not.toContain("no-store");
});

test("a budget the build never saw is generated on demand from the ribbon", async ({ page }) => {
  // 20 000 is absent from `PRESET_FIXTURES` (pinned by preset-model.spec.ts) and
  // present in the mock's ribbon, so this page can only exist by reading
  // `GET /v1/presets` at request time — the ISR path the fixture build cannot show.
  const response = await page.goto(API_ONLY);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Config PC gamer à ${money(20000)}`,
  );
  const apiPass = RECOMMENDATIONS_BY_ID[IDS.presetApiOnly];
  await expect(page.locator("article")).toHaveCount(apiPass.builds.length);
  await expect(page.getByText(money(totalOf(apiPass, 0))).first()).toBeVisible();
  // Its prices are all verified, so the card says so rather than "démo".
  await expect(page.locator("article").first()).toContainText("Vérifié");
});

test("fixture pages are noindex; an API page with verified prices is not", async ({ request }) => {
  for (const path of [P9000, P15000]) {
    const html = await (await request.get(path)).text();
    expect(html, `${path} must stay out of the index`).toMatch(
      /<meta name="robots" content="[^"]*noindex/,
    );
  }

  // The same component tree, the same design — only the source and the prices
  // differ, and that is exactly what the rule reads.
  const apiHtml = await (await request.get(API_ONLY)).text();
  expect(apiHtml).not.toContain('content="noindex');
});

test("a malformed or unknown slug is a styled 404, not a crash", async ({ page }) => {
  for (const path of [
    "/fr/config-pc-gamer-abc-dh",
    "/fr/config-pc-gamer-0-dh",
    "/fr/config-pc-gamer-99999-dh",
    "/fr/pas-un-preset",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  }
});

test("the preset page reuses the results card, not a second implementation", async ({ page }) => {
  await page.goto(P15000);
  const cards = page.locator("article");
  await expect(cards).toHaveCount(3);

  const primary = cards.first();
  await expect(primary).toHaveAttribute("data-primary", "true");
  // The card's own furniture: rank, archetype, price badge, budget bar, parts.
  await expect(primary.getByText("N° 1")).toBeVisible();
  await expect(primary.getByRole("heading", { level: 2 })).toHaveText("Équilibré");
  await expect(primary.getByRole("progressbar")).toBeVisible();
  await expect(primary.getByRole("list", { name: "Composants" }).locator("li")).toHaveCount(8);
  // All eight roles are VERIFIED on this fixture, so the badge is the dated one.
  await expect(primary).toContainText("Vérifié");
  await expect(primary).not.toContainText("Seed");
});

test("the ways forward are the pass itself and a pre-filled wizard", async ({ page }) => {
  await page.goto(P15000);

  const complete = page.getByRole("link", { name: "Voir la configuration complète" });
  await expect(complete).toHaveAttribute("href", `/fr/config/${IDS.threeBuilds}`);

  const cta = page.getByRole("link", { name: "Configurer mon PC" });
  const href = await cta.getAttribute("href");
  expect(href).toContain("/fr/configurer?");
  expect(href).toContain("etape=budget");
  expect(href).toContain("budget_amount=15000");
  expect(href).toContain("use_case=GAMING");
});

test("the page is usable at 360 px and never prints the seed vocabulary", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(P15000);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);

  const text = await visibleText(page);
  expect(text).not.toMatch(/seed/i);
  expect(text).not.toContain("SEED_UNVERIFIED");
  expect(text).not.toContain("TestCompat");
  // No raw contract enum on an SEO page.
  for (const enumName of ["SSD_BOOT", "CPU_COOLER", "GAMING"]) {
    expect(text).not.toContain(enumName);
  }
});

test("the Arabic preset page is RTL with translated copy", async ({ page }) => {
  await page.goto("/ar/config-pc-gamer-9000-dh");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `تجميعة حاسوب للألعاب بـ ${money(9000, "ar")}`,
  );
  await expect(page.locator("article").first()).toContainText("المعالج");
});
