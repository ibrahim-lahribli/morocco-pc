/**
 * apps/web/e2e/result.spec.ts — S11's proof, in a browser.
 *
 * The subject is the RESULTS PAGE, and the thing that makes it different from
 * every screen before it is that its data arrives on the SERVER. So the specs are
 * shaped around three facts:
 *
 *   1. **The mock is reached by the Next process, not by the page.** There is no
 *      `page.route` here: `playwright.config.ts` points the server at the
 *      fixture mock through `API_BASE_URL`, and the page fetches
 *      `GET /v1/recommendations/:id` in a server component. That is what makes
 *      "one spec, one fixture" work — the ID IN THE URL selects the state.
 *   2. **The HTML is the deliverable.** One test reads the raw response body and
 *      asserts the build data is in it, which a client-side implementation could
 *      not satisfy.
 *   3. **Nothing is invented.** A total past the budget is over, a missing total
 *      draws no bar, and the words "Seed" / "SEED_UNVERIFIED" / "TestCompat"
 *      never appear (V5).
 */

import { test, expect, type Page } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import {
  IDS,
  RECOMMENDATION_OVER_BUDGET,
  RECOMMENDATION_THREE_BUILDS,
} from "../mock/fixtures.mjs";

const money = (amount: number) => formatMoney(amount, "fr");

const THREE = `/fr/config/${IDS.threeBuilds}`;
const ONE = `/fr/config/${IDS.oneBuild}`;
const OVER = `/fr/config/${IDS.overBudget}`;
const ZERO = `/fr/config/${IDS.zeroBuild}`;
const MISSING = `/fr/config/${IDS.missing}`;
/** An id whose read fails with 503: the engine is down, the id may be fine. */
const UNREACHABLE = `/fr/config/${IDS.unavailable}`;

/** The page's visible text, with scripts stripped (Next inlines its payload there). */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

test("three builds are three cards, and the first is primary", async ({ page }) => {
  await page.goto(THREE);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vos configurations");
  const cards = page.locator("article");
  await expect(cards).toHaveCount(3);

  // Rank order, and the archetype each rank was nominated by.
  await expect(cards.nth(0).getByRole("heading", { level: 2 })).toHaveText("Équilibré");
  await expect(cards.nth(1).getByRole("heading", { level: 2 })).toHaveText("Meilleur prix");
  await expect(cards.nth(2).getByRole("heading", { level: 2 })).toHaveText("Performance");

  // "First card visually primary" is a rendering fact, not a class name: the
  // first card's border is the brand colour and the second's is not.
  await expect(cards.nth(0)).toHaveAttribute("data-primary", "true");
  await expect(cards.nth(1)).toHaveAttribute("data-primary", "false");
  const borders = await cards.evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).borderTopColor),
  );
  expect(borders[0]).not.toBe(borders[1]);

  // The first card carries its rank label and its total.
  await expect(cards.nth(0).getByText("N° 1")).toBeVisible();
  await expect(cards.nth(0).getByText(money(8594))).toBeVisible();
});

test("a component row shows the role, the name, the variant and the price used", async ({
  page,
}) => {
  await page.goto(THREE);
  const first = page.locator("article").first();
  const rows = first.getByRole("list", { name: "Composants" }).locator("li");

  // A full build carries all eight roles; the fixture's first build does.
  await expect(rows).toHaveCount(8);

  const cpu = rows.nth(0);
  await expect(cpu).toContainText("Processeur");
  await expect(cpu).toContainText("Ryzen 5 7600");
  await expect(cpu).toContainText(money(1899));

  // The variant is printed only where the name does not already say it.
  await expect(rows.nth(1)).toContainText("Carte graphique");
  await expect(rows.nth(1)).toContainText("RTX 4060 8GB");
  await expect(rows.nth(1)).not.toContainText("8GB · 8GB");
  await expect(rows.nth(2)).toContainText("Mémoire");
  await expect(rows.nth(2)).toContainText("2 × 8 Go");

  // Roles are words. A raw enum in the list is the V5 failure this asserts away.
  const text = await visibleText(page);
  for (const enumName of ["SSD_BOOT", "CPU_COOLER", "MOTHERBOARD"]) {
    expect(text).not.toContain(enumName);
  }
});

test("one build is one card: no empty slots, no invented builds (V13)", async ({ page }) => {
  await page.goto(ONE);
  const cards = page.locator("article");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-primary", "true");
  // The single card is a whole card: heading, bar, component list.
  await expect(cards.first().getByRole("heading", { level: 2 })).toHaveText("Équilibré");
  await expect(cards.first().getByRole("progressbar")).toBeVisible();
  await expect(cards.first().locator("li")).toHaveCount(8);
  // The board draws three; the page renders what exists and nothing else.
  await expect(page.locator("main")).not.toContainText("Configuration 2");
});

test("the bar is proportional, and its accessible text is the real sentence", async ({ page }) => {
  await page.goto(THREE);
  const bar = page.locator("article").first().getByRole("progressbar");

  const total = RECOMMENDATION_THREE_BUILDS.builds[0].total_price as number;
  const budget = RECOMMENDATION_THREE_BUILDS.budget_amount as number;

  // The DoD's aria text equivalent: the amounts, not a bare percentage.
  await expect(bar).toHaveAttribute("aria-valuetext", `${money(total)} sur ${money(budget)}`);
  await expect(bar).toHaveAttribute("aria-valuemax", String(budget));
  await expect(bar).toHaveAttribute("aria-valuenow", String(total));

  // Width proportional: measure the fill against the rail rather than trusting
  // the inline style string, so a CSS clamp that broke would fail here.
  const ratio = await bar.evaluate((node) => {
    const rail = node.getBoundingClientRect().width;
    const fill = (node.firstElementChild as HTMLElement).getBoundingClientRect().width;
    return fill / rail;
  });
  expect(ratio).toBeCloseTo(total / budget, 2);

  // What is left of the budget is stated, formatted by the helper.
  await expect(
    page.locator("article").first().getByText(`Reste ${money(budget - total)}`),
  ).toBeVisible();
});

test("a total past the budget is drawn as over, and the sentence carries the excess", async ({
  page,
}) => {
  await page.goto(OVER);
  const card = page.locator("article").first();
  const total = RECOMMENDATION_OVER_BUDGET.builds[0].total_price as number;
  const budget = RECOMMENDATION_OVER_BUDGET.budget_amount as number;
  const excess = total - budget;

  await expect(card).toHaveAttribute("data-tone", "over");
  const bar = card.getByRole("progressbar");
  // aria-valuenow is CLAMPED (ARIA forbids out of range) - the truth is the text.
  await expect(bar).toHaveAttribute("aria-valuenow", String(budget));
  await expect(bar).toHaveAttribute("aria-valuetext", `${money(total)} sur ${money(budget)}`);
  await expect(bar).toHaveAttribute("aria-valuemax", String(budget));

  // The warning is a sentence with a number, not a colour.
  await expect(
    card.getByText(`Cette configuration dépasse votre budget de ${money(excess)}.`),
  ).toBeVisible();
  await expect(card.getByText(`Dépassement de ${money(excess)}`)).toBeVisible();
});

test("an unknown id is a real 404 with a way back", async ({ page }) => {
  const response = await page.goto(MISSING);
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  // Not a blank page, not a stack trace: a link that goes somewhere useful.
  const cta = page.getByRole("link", { name: "Configurer mon PC" });
  await expect(cta).toHaveAttribute("href", "/fr/configurer");
  await cta.click();
  await expect(page).toHaveURL(/\/fr\/configurer/);
});

test("an unknown path inside a locale is the same styled 404", async ({ page }) => {
  const response = await page.goto("/fr/une-adresse-qui-nexiste-pas");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
});

test("the page is rendered on the SERVER: the builds are in the HTML", async ({ request }) => {
  // Read the response the server sends, with no browser to run anything.
  const response = await request.get(THREE);
  expect(response.status()).toBe(200);
  const html = await response.text();

  expect(html).toContain("Meilleur prix");
  expect(html).toContain("Ryzen 5 7600");
  // The money is formatted with the narrow no-break space, in the first byte.
  expect(html).toContain(money(8594));
});

test("no browser fetch is made for the build list", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/recommendations")) apiCalls.push(request.url());
  });

  await page.goto(THREE);
  await expect(page.locator("article")).toHaveCount(3);
  // Wait a beat: a hydration-time fetch would land after the paint.
  await page.waitForTimeout(500);
  expect(apiCalls).toEqual([]);
});

test("the seed vocabulary never reaches a user (V5)", async ({ page }) => {
  for (const path of [THREE, ONE, OVER, ZERO]) {
    await page.goto(path);
    const text = await visibleText(page);
    expect(text).not.toMatch(/seed/i);
    expect(text).not.toContain("SEED_UNVERIFIED");
    expect(text).not.toContain("TestCompat");
  }
});

test("a zero-build pass is a state, not an empty page (V2)", async ({ page }) => {
  await page.goto(ZERO);

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    "Aucune configuration pour ce budget",
  );
  await expect(page.locator("article")).toHaveCount(0);

  // The way back carries the answers this pass was made with, and lands on the
  // step that can fix it. S14 owns the floor advice; no number is invented here.
  const back = page.getByRole("link", { name: "Modifier mon budget" });
  const href = await back.getAttribute("href");
  expect(href).toContain("/fr/configurer?");
  expect(href).toContain("etape=budget");
  expect(href).toContain("budget_amount=6000");
  expect(href).toContain("use_case=GAMING");

  // The floor is a LOWER BOUND, not a quoted price: nothing on this screen
  // presents it as an achievable build.
  await expect(page.getByText(/budget minimum conseillé/i)).toHaveCount(0);
});

test("the Arabic page is RTL and its labels are translated", async ({ page }) => {
  await page.goto(`/ar/config/${IDS.threeBuilds}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("تجميعاتك");
  await expect(page.locator("article").first().getByRole("heading", { level: 2 })).toHaveText(
    "متوازن",
  );
  // Translated role labels, not enums, in the other direction too.
  await expect(page.locator("article").first()).toContainText("المعالج");
});

test("an unreachable engine is 'unavailable' with a retry, not a 404", async ({ page }) => {
  // An id the mock does not serve is a 404; a service that cannot be reached is a
  // DIFFERENT event. Telling a user their link is dead because the engine is down
  // would also remove their reason to retry.
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });

  const response = await page.goto(UNREACHABLE);
  // The page renders (200); only its data failed. A 404 status here would be the
  // lie this test exists to prevent.
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configuration indisponible");
  await expect(page.getByText(/Le service n'a pas pu être joint/)).toBeVisible();
  // Scoped by text on purpose: Next's route announcer is ALSO a role="alert",
  // so a bare role lookup matches two elements on a page where one thing failed.
  await expect(
    page.getByRole("alert").filter({ hasText: "Le service n'a pas pu être joint" }),
  ).toBeVisible();

  // A retry must re-run the SERVER render. A router push to the URL already in
  // the address bar is a no-op that leaves the error on screen, so the retry is
  // a document navigation - proven by the second document request.
  expect(documents).toHaveLength(1);
  await page.getByRole("link", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configuration indisponible");
  expect(documents).toHaveLength(2);
});
