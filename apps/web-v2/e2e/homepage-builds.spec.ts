import { expect, test } from "@playwright/test";

import { CARD_TITLES, stubHomepageApi } from "./support/homepage-api";

test.describe("recommended configurations", () => {
  test("renders one peer card per use case at the 12 000 ceiling", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const section = page.locator("#configurations");

    await expect(section.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    await expect(section.getByRole("heading", { name: CARD_TITLES.WORKSTATION })).toBeVisible();

    await expect(section.getByText(/Budget visé · 12\s000\sDH/)).toHaveCount(3);

    // The 15 000 row exists in the stub ladder and must never be the selected tier.
    await expect(section.getByText(/15\s000/)).toHaveCount(0);
  });

  test("takes each badge from the served build, never from the preset", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const section = page.locator("#configurations");
    const gaming = section.locator("article", {
      has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
    });
    const office = section.locator("article", {
      has: page.getByRole("heading", { name: CARD_TITLES.OFFICE }),
    });
    const workstation = section.locator("article", {
      has: page.getByRole("heading", { name: CARD_TITLES.WORKSTATION }),
    });

    await expect(gaming.getByText("Prix vérifié")).toBeVisible();
    await expect(office.getByText("Prix indicatif")).toBeVisible();
    await expect(workstation.getByText(/Prix (vérifié|indicatif)/)).toHaveCount(0);
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
    await expect(section.getByText(/Budget visé · 8\s000\sDH/)).toHaveCount(1);

    await page.getByRole("button", { name: "Trouver mon PC" }).click();
    await expect(page).toHaveURL(/\/fr$/);

    expect(posts).toEqual([]);
  });

  test("collapses the peer cards to dense rows on a phone", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");

    const office = page.locator("#configurations article", {
      has: page.getByRole("heading", { name: CARD_TITLES.OFFICE }),
    });

    await expect(office.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    // The compact row keeps name, badge, budget, score and price; the spec pills
    // are a desktop affordance, so they must not survive at 390 px.
    await expect(office.locator("ul")).toHaveCount(1);
    await expect(office.locator("ul")).toBeHidden();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(office.locator("ul")).toBeVisible();
  });

  test("never writes on load", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    await expect(page.getByRole("heading", { name: CARD_TITLES.GAMING })).toBeVisible();

    expect(posts).toEqual([]);
  });
});
