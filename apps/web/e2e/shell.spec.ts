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

  // The header's three links wrap onto their own row below the brand and the
  // switcher at 360 px, and the shelf is duplicated in the footer, so both ways
  // in fit without a horizontal scroll.
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

test("the two navigation landmarks have different names", async ({ page }) => {
  await page.goto("/fr");
  // Two landmarks with one accessible name cannot be told apart in a screen
  // reader's landmark list, and axe will not catch it: `landmark-unique` is
  // best-practice, and the a11y suite runs WCAG tags only. So this asserts it.
  const names = await page.locator("nav").evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? "(none)"),
  );
  expect(names).toContain("Navigation principale");
  expect(names).toContain("Navigation de l’application");
  expect(new Set(names).size).toBe(names.length);
});

test("the tab bar marks the current section and never covers the last content", async ({ page }) => {
  await page.goto("/fr/guides");
  const bar = page.getByRole("navigation", { name: "Navigation de l’application" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Guides" })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("link")).toHaveCount(5);

  // The reservation lives on <body>, NOT on <main>: the footer sits after <main>,
  // so main's padding protects the last card and leaves the footer behind the bar
  // (measured 2026-11-03: footer bottom 800 px vs bar top 719 px).
  const reserved = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.body).paddingBottom),
  );
  const barHeight = (await bar.boundingBox())?.height ?? 0;
  expect(reserved).toBeGreaterThanOrEqual(barHeight);

  // And the thing the padding exists for: at the bottom of the page the footer
  // must clear the bar. This is the assertion that fails when the reservation is
  // put on the wrong element.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const overlaps = await page.evaluate(() => {
    const footer = document.querySelector("footer");
    const nav = document.querySelector('nav[aria-label="Navigation de l’application"]');
    if (footer === null || nav === null) return null;
    return footer.getBoundingClientRect().bottom > nav.getBoundingClientRect().top;
  });
  expect(overlaps).toBe(false);
});

test("from 768 px the tab bar is gone and the header nav is not", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/fr");
  await expect(page.getByRole("navigation", { name: "Navigation de l’application" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  // And the space it reserved is released: no dead 80 px at the bottom.
  const reserved = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.body).paddingBottom),
  );
  expect(reserved).toBeLessThanOrEqual(0);
});
