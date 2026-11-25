import { expect, test } from "@playwright/test";

import { CARD_TITLES, stubHomepageApi } from "./support/homepage-api";
import { waitForSettledCards } from "./support/homepage-ready";

/** The usage radio's accessible name; the finder spec keeps its own copy. */
const USAGE_GAMING = /Jeux vidéo & Gaming/;

test.describe("recommended configurations", () => {
  test("renders one peer card per use case at the 12 000 ceiling", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const section = page.locator("#configurations");

    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.WORKSTATION })).toBeVisible();

    // No budget line and no score anymore: the served tier shows up as the
    // build's own price (budget − 500 in the stub), never as a relabelled budget.
    await expect(section.getByText(/11\s?500\s?DH/)).toHaveCount(3);
    await expect(section.getByText(/Budget visé/)).toHaveCount(0);

    // The 15 000 row exists in the stub ladder and must never be the selected tier.
    await expect(section.getByText(/15\s000/)).toHaveCount(0);
  });

  test("renders no price badge, only the indicative price label on the featured card", async ({
    page,
  }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const section = page.locator("#configurations");
    const gaming = section.locator("article", {
      has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
    });
    const office = section.locator("article", {
      has: page.getByRole("heading", { name: CARD_TITLES.OFFICE }),
    });

    // Badges are gone from every card, even where the served build reports a
    // status; the featured card keeps the plain text label instead.
    await expect(section.getByText(/^Prix vérifié$/)).toHaveCount(0);
    await expect(section.getByText(/^Prix indicatif$/)).toHaveCount(0);
    await expect(gaming.getByText("Prix indicatif boutiques")).toBeVisible();
    await expect(office.getByText(/11\s?500\s?DH/)).toBeVisible();
  });

  test("keeps the other slots when one use case has no preset", async ({ page }) => {
    await stubHomepageApi(page, { emptyPresetsFor: ["OFFICE"] });
    await page.goto("/fr");

    const section = page.locator("#configurations");

    await expect(section.getByText("Aucune configuration disponible pour cet usage")).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.WORKSTATION })).toBeVisible();
  });

  test("shows one error per slot and keeps the rest of the page usable", async ({ page }) => {
    await stubHomepageApi(page, {
      failPresetsFor: ["GAMING", "OFFICE", "WORKSTATION"],
    });
    await page.goto("/fr");

    await expect(page.getByText("Les configurations n'ont pas pu être chargées")).toHaveCount(3);
    await expect(
      page.getByRole("heading", { name: "Pourquoi faire confiance à Morocco-PC ?" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bien choisir son PC au Maroc" })).toBeVisible();
  });

  test("narrows to the finder's use case and budget without posting", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    // The radios are visually hidden inside their label cards, so the click has
    // to be forced; the assertions below still read the rendered result.
    const budget = page.getByRole("radio", { name: /Budget de 8\s?000\s?DH/ });
    const usage = page.getByRole("radio", { name: /Études et bureautique/ });
    await budget.check({ force: true });
    await usage.check({ force: true });
    await expect(budget).toBeChecked();
    await expect(usage).toBeChecked();

    const section = page.locator("#configurations");

    await expect(section.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toHaveCount(0);
    // The narrowed slot carries its own 8 000 tier into the price (7 500 in the
    // stub) — the budget string the card used to print no longer exists.
    await expect(section.getByText(/7\s?500\s?DH/)).toHaveCount(1);
    await expect(section.getByText(/Budget visé/)).toHaveCount(0);

    // The CTA leaves for the configurator, carrying the same two answers the
    // cards just narrowed to.
    await page.getByRole("button", { name: "Trouver mon PC", exact: true }).click();
    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=OFFICE&budget=8000$/);

    expect(posts).toEqual([]);
  });

  test("renders compact rows without pill lists and without overflow on a phone", async ({
    page,
  }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");

    const office = page.locator("#configurations article", {
      has: page.getByRole("heading", { name: CARD_TITLES.OFFICE }),
    });

    await expect(office.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    // The compact row renders component summaries as plain text, never as a
    // pill list, at any width.
    await expect(office.locator("ul")).toHaveCount(0);

    // A hidden pill row does not prove the card has its data: measure once the
    // detail read has filled the cards in, not while they are still skeletons.
    await waitForSettledCards(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("shows the honest empty slot when the budget is below the cheapest tier", async ({
    page,
  }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    // The cards settle only after the island has hydrated and fetched, so this
    // is the boundary that makes the first radio click land on live handlers
    // instead of on a label whose change React would then undo.
    await waitForSettledCards(page);

    await page.getByRole("radio", { name: USAGE_GAMING }).check({ force: true });
    await page.getByRole("button", { name: "Autre budget personnalisé" }).click();
    await page.getByRole("spinbutton", { name: "Budget exact en dirhams" }).fill("3500");

    const section = page.locator("#configurations");

    // Below the cheapest served tier (5 000) the slot keeps its category and shows
    // no configuration: a substituted, more expensive card would be a lie.
    await expect(section.getByText("Aucune configuration disponible pour cet usage")).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();
    await expect(section.getByText(/Budget visé/)).toHaveCount(0);
    expect(posts).toEqual([]);
  });

  test("caps a budget above the top tier and names the tier it served", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    // Same hydration boundary as the below-cheapest test above.
    await waitForSettledCards(page);

    await page.getByRole("radio", { name: USAGE_GAMING }).check({ force: true });
    await page.getByRole("button", { name: "Autre budget personnalisé" }).click();
    await page.getByRole("spinbutton", { name: "Budget exact en dirhams" }).fill("20000");

    const section = page.locator("#configurations");

    // 20 000 is above the stub ladder's top row (15 000): the card serves that row
    // and says so, rather than relabelling the budget as a price it can meet.
    await expect(
      section.getByText(/Configuration pré-générée la plus élevée disponible : 15\s?000\s?DH/),
    ).toBeVisible();
    await expect(section.getByText(/14\s?500\s?DH/)).toBeVisible();
    expect(posts).toEqual([]);
  });

  test("clears the previous use case's card the moment the answer changes", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    // Hydration boundary: the usage click must land on the island's live
    // handler, not on a label whose change React would then undo.
    await waitForSettledCards(page);

    const section = page.locator("#configurations");
    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();

    await page.getByRole("radio", { name: /Études et bureautique/ }).check({ force: true });

    // The previous category must be gone, not merely dimmed…
    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toHaveCount(0);
    await expect(section.locator("article")).toHaveCount(1);

    // …and the card that remains must be the office answer. Its heading id
    // derives from the recommendation it renders, so a stale gaming build
    // under an office heading would still carry the gaming id.
    await expect(section.locator("article").first()).toHaveAttribute(
      "aria-labelledby",
      "build-rec-OFFICE-12000",
    );
    await expect(section.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    expect(posts).toEqual([]);
  });

  test("shows one skeleton per slot until its ladder answers", async ({ page }) => {
    await stubHomepageApi(page, { presetsDelayMs: 2_000 });
    await page.goto("/fr");

    const section = page.locator("#configurations");
    const loading = section.getByText("Chargement des configurations…");

    // First paint is the pending state a visitor can actually see here: every
    // slot asks the stub, which holds each answer open, so all three are busy.
    await expect(loading).toHaveCount(3);
    await expect(section.locator("article[aria-busy='true']")).toHaveCount(3);

    await expect(loading).toHaveCount(0);
    await expect(section.locator("article[aria-busy='true']")).toHaveCount(0);
    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();
  });

  test("puts the price and its action on one row, with no score line", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");
    await waitForSettledCards(page);

    const gaming = page.locator('[data-slot="build-card"]', {
      has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
    });

    // One value only: the score dt/dd pair is gone, so the card has exactly one
    // price and no score text.
    await expect(gaming.locator("dl dd")).toHaveCount(1);
    await expect(gaming.getByText(/Score de configuration/)).toHaveCount(0);

    const price = gaming.locator("dl dd");
    const cta = gaming.getByRole("link", { name: "Voir la config" });

    const [priceBox, ctaBox] = await Promise.all([price.boundingBox(), cta.boundingBox()]);
    expect(priceBox, "the price is rendered").not.toBeNull();
    expect(ctaBox, "the action is rendered").not.toBeNull();

    // Price left, action right, on the same row: their boxes overlap vertically.
    expect(priceBox!.x).toBeLessThan(ctaBox!.x);
    expect(priceBox!.y).toBeLessThan(ctaBox!.y + ctaBox!.height);
    expect(ctaBox!.y).toBeLessThan(priceBox!.y + priceBox!.height);
  });

  test("keeps an erroring slot visible and usable alongside filled cards", async ({ page }) => {
    await stubHomepageApi(page, { failPresetsFor: ["GAMING"] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");

    // Wait for the filled compact rows to settle — the GAMING slot errors on
    // presets, so it has no <dd>; waitForSettledCards would wait in vain.
    await expect(page.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();

    // The erroring GAMING slot and the filled OFFICE/WORKSTATION slots are
    // all visible articles — an error in one slot never hides the others.
    const articles = page.locator("#configurations article");
    await expect(articles).toHaveCount(3);

    const heights = await articles.evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().height)),
    );

    // Every card has a non-zero height — no collapsed error slot.
    expect(heights).toHaveLength(3);
    for (const height of heights) {
      expect(height).toBeGreaterThan(0);
    }
  });

  test("renders three articles at lg and stacks them below lg", async ({ page }) => {
    await stubHomepageApi(page);

    const articleTops = async () => {
      await waitForSettledCards(page);
      return page
        .locator("#configurations article")
        .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
    };

    // At lg the featured card and the first compact row share the same row;
    // the second compact row sits below in the third column.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/fr");
    const lgTops = await articleTops();
    expect(lgTops).toHaveLength(3);

    // One pixel under lg all three articles stack vertically.
    await page.setViewportSize({ width: 1023, height: 900 });
    await expect
      .poll(async () => {
        const tops = await articleTops();
        return new Set(tops).size;
      })
      .toBeGreaterThan(1);
  });

  test("never writes on load", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    await expect(page.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();

    expect(posts).toEqual([]);
  });
  test("opens the configurator from a card with the tier it serves", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");
    await waitForSettledCards(page);

    const gaming = page.locator("#configurations article", {
      has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
    });
    const cta = gaming.getByRole("link", { name: "Voir la config" });

    await expect(cta).toHaveAttribute(
      "href",
      "/fr/configurateur?step=2&use_case=GAMING&budget=12000",
    );
    await cta.click();

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=GAMING&budget=12000$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Étape 2 — Affinons votre configuration" }),
    ).toBeVisible();
    expect(posts).toEqual([]);
  });

  test("links the capped tier, never the budget the visitor typed", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");
    await waitForSettledCards(page);

    await page.getByRole("radio", { name: USAGE_GAMING }).check({ force: true });
    await page.getByRole("button", { name: "Autre budget personnalisé" }).click();
    await page.getByRole("spinbutton", { name: "Budget exact en dirhams" }).fill("20000");

    const gaming = page.locator("#configurations article", {
      has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
    });

    // The card serves the 15 000 tier and says so; the link must carry that tier,
    // never the 20 000 the visitor typed.
    await expect(gaming.getByText(/Configuration pré-générée la plus élevée/)).toBeVisible();
    await expect(gaming.getByRole("link", { name: "Voir la config" })).toHaveAttribute(
      "href",
      "/fr/configurateur?step=2&use_case=GAMING&budget=15000",
    );
  });

  test("keeps the card CTA a 44 px link on a phone", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");
    await waitForSettledCards(page);

    const box = await page
      .locator("#configurations article a[href*='/configurateur']")
      .first()
      .boundingBox();

    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  });
});
