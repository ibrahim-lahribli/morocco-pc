import { expect, test } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";

test.describe("homepage shell", () => {
  test("renders the approved static sections in French with a single h1", async ({ page }) => {
    await page.goto("/fr");

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Pourquoi faire confiance à Morocco-PC ?" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bien choisir son PC au Maroc" })).toBeVisible();
    await expect(page.getByText("Configurations PC pour le Maroc").first()).toBeVisible();
  });

  test("shows the banner only from md and the primary nav only from lg", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");

    await expect(page.getByRole("note")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(page.getByRole("note")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  });

  test("issues only reads on load and never writes", async ({ page }) => {
    const calls: string[] = [];
    await page.route("**/v1/**", (route) => {
      calls.push(route.request().method());
      return route.abort();
    });

    await page.goto("/fr");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The cards hydrate after the shell, so wait for the first read to land.
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(new Set(calls)).toEqual(new Set(["GET"]));
  });

  // Document order, not pixel position: §1.1/§7/§16.1 order a reader must be able to trust
  // at every breakpoint, with or without layout.
  test("renders discovery pathways between the configurations and the trust section", async ({
    page,
  }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const order = await page.evaluate(() => {
      const elements = ["configurations", "pathways", "confiance"].map((id) =>
        document.getElementById(id),
      );

      const [configurations, pathways, trust] = elements;
      if (!configurations || !pathways || !trust) return null;

      return (
        Boolean(
          configurations.compareDocumentPosition(pathways) & Node.DOCUMENT_POSITION_FOLLOWING,
        ) && Boolean(pathways.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    });

    expect(order).toBe(true);
  });
});
