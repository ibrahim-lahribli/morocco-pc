import { test, expect } from "@playwright/test";

test("/fr renders the app shell at 360 px with no horizontal scroll", async ({
  page,
}) => {
  await page.goto("/fr");

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const skipLink = page.getByRole("link", { name: "Aller au contenu principal" });
  await expect(skipLink).toHaveAttribute("href", "#main");

  // No horizontal overflow at 360 px (S1 test scenario 2).
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("/ redirects to /fr (fr is the default locale)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr$/);
});

test("skip link moves keyboard users to the main content", async ({ page }) => {
  await page.goto("/fr");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Aller au contenu principal" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeVisible();
});
