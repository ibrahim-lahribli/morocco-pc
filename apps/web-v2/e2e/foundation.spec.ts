import { expect, test } from "@playwright/test";

test.describe("foundation preview", () => {
  test("French page renders in LTR with the design-system content", async ({ page }) => {
    await page.goto("/fr");

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("design system");
    await expect(page.getByRole("group", { name: "Sélectionnez votre budget" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Afficher en العربية" })).toBeVisible();
    await expect(page.getByText("Vérifié").first()).toBeVisible();
  });

  test("Arabic page renders in RTL with Arabic copy and mirrored layout", async ({ page }) => {
    // The bottom nav is mobile-only, so the mirroring assertion needs a phone
    // viewport before the page is read.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ar");

    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("نظام تصميم");

    const direction = await page
      .locator("main")
      .evaluate((element) => getComputedStyle(element).direction);
    expect(direction).toBe("rtl");

    const arabicFace = await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(arabicFace).toContain("IBM Plex Sans Arabic");

    // The mobile nav is the clearest proof the layout mirrored: in RTL the
    // first item sits on the right, so its x is GREATER than the last item's.
    const links = page.getByRole("navigation", { name: "تنقل الجوال" }).getByRole("link");
    const first = await links.first().boundingBox();
    const last = await links.last().boundingBox();
    expect(first?.x ?? 0).toBeGreaterThan(last?.x ?? 0);
  });

  test("locale switch preserves the page and flips direction", async ({ page }) => {
    await page.goto("/fr");

    await page.getByRole("link", { name: "Afficher en العربية" }).click();
    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.getByRole("link", { name: "العرض بـFrançais" }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("budget buttons expose the selected preset", async ({ page }) => {
    await page.goto("/fr");

    const twelve = page.locator("button[aria-pressed]").filter({ hasText: "12" });
    await twelve.click();

    await expect(twelve).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Budget sélectionné : 12 000 DH")).toBeVisible();
  });

  test("search validates then echoes the query", async ({ page }) => {
    await page.goto("/fr");

    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page.getByText("Saisissez un terme à rechercher.")).toBeVisible();

    await page.getByLabel("Rechercher un composant").fill("RTX 4060");
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page.getByText("Recherche simulée : « RTX 4060 »")).toBeVisible();
  });

  test("bottom navigation is fixed on mobile and hidden on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");

    const nav = page.getByRole("navigation", { name: "Navigation mobile" });
    await expect(nav).toBeVisible();

    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.round(box.y + box.height)).toBe(844);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(nav).toBeHidden();
  });

  test("no horizontal overflow at 360 px in either locale", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    for (const locale of ["fr", "ar"]) {
      await page.goto(`/${locale}`);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      expect(overflow.scrollWidth, `${locale} overflows horizontally`).toBeLessThanOrEqual(
        overflow.width + 1,
      );
    }
  });
});
