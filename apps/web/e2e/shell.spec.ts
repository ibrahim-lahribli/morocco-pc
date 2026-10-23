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

test("the shelf is one click from every page, even with nothing saved", async ({ page }) => {
  // A reader who cleared storage has no saved card to click, and the card's own
  // "Voir mes enregistrements" link only exists once something is saved — so the
  // way in cannot be that link.
  await page.goto("/fr");
  const nav = page.getByRole("navigation", { name: "Vos configurations" });
  await expect(nav).toBeVisible();
  const link = nav.getByRole("link", { name: "Mes enregistrements", exact: true });
  await expect(link).toHaveAttribute("href", "/fr/enregistrements");

  await link.click();
  await expect(page).toHaveURL(/\/fr\/enregistrements$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mes enregistrements");
  // Nothing saved here: the empty state, which is a true statement, not an error.
  await expect(page.getByRole("heading", { name: "Aucun enregistrement" })).toBeVisible();

  // The footer rather than the header is why this still fits at 360 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the Arabic footer points at the Arabic shelf", async ({ page }) => {
  await page.goto("/ar");
  await expect(
    page
      .getByRole("navigation", { name: "تكويناتك" })
      .getByRole("link", { name: "التكوينات المحفوظة" }),
  ).toHaveAttribute("href", "/ar/enregistrements");
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
