/**
 * apps/web/e2e/legal.spec.ts — S22's third scenario.
 *
 * "Footer legal links resolve in both locales; 404 page links them too" is one
 * sentence with four claims in it, and each is asserted separately because they
 * fail for different reasons:
 *
 *   - the links EXIST on every page, which is a property of the layout rather
 *     than of any page — so the check walks a sample of the shipped surfaces,
 *     including a result page and the 404, instead of only the home page;
 *   - each link NAMES the page it goes to (an accessible name, not an icon);
 *   - the Arabic footer points at the Arabic pages, not at the French ones —
 *     the failure that a copy-pasted `localePath` produces;
 *   - each page ANSWERS 200 with a real `h1`, because "the link is in the
 *     footer" is worth nothing if the route behind it 404s.
 *
 * The pages are also in the sitemap and carry their own canonical, and both of
 * those are `e2e/seo.spec.ts`'s territory: its route table lists them, so the
 * crawl surface and this file cannot disagree about which pages exist.
 */
import { expect, test } from "@playwright/test";

import { IDS } from "../mock/fixtures.mjs";

/** The three documents, with the label each locale's footer gives them. */
const LEGAL = [
  { path: "/mentions-legales", fr: "Mentions légales", ar: "المعلومات القانونية" },
  { path: "/confidentialite", fr: "Confidentialité", ar: "الخصوصية" },
  { path: "/contact", fr: "Contact", ar: "اتصل بنا" },
] as const;

const LOCALES = [
  { locale: "fr", navLabel: "Informations légales" },
  { locale: "ar", navLabel: "معلومات قانونية" },
] as const;

/** Every kind of surface the shell wraps, so "every page" is not just the home. */
const SURFACES = [
  "/",
  "/configurer",
  "/guides",
  "/composants/rtx-4060-8gb",
  `/config/${IDS.threeBuilds}`,
  // The 404, which renders INSIDE the layout — the reason it carries a footer at
  // all, and the claim in the scenario's second clause.
  "/une-page-qui-nexiste-pas",
];

for (const { locale, navLabel } of LOCALES) {
  test(`${locale}: the footer names the three legal pages and every link resolves`, async ({
    page,
  }) => {
    // The links first, read off ONE page — the footer is the layout's, so proving
    // it on the home page proves it everywhere (the next test walks the others).
    await page.goto(`/${locale}`);
    const nav = page.getByRole("navigation", { name: navLabel });
    await expect(nav).toBeVisible();

    for (const { path, fr, ar } of LEGAL) {
      const label = locale === "fr" ? fr : ar;
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "href",
        `/${locale}${path}`,
      );
    }

    // Then the routes behind them, in this locale: a 200 and the page's own
    // title, so a broken route cannot hide behind a working link.
    for (const { path, fr, ar } of LEGAL) {
      const label = locale === "fr" ? fr : ar;
      const response = await page.goto(`/${locale}${path}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
    }
  });

  test(`${locale}: the footer is on every surface, the 404 included`, async ({ page }) => {
    for (const surface of SURFACES) {
      await page.goto(`/${locale}${surface}`);
      const nav = page.getByRole("navigation", { name: navLabel });
      await expect(nav, `/${locale}${surface} has no legal footer`).toBeVisible();
      await expect(nav.getByRole("link")).toHaveCount(4); // three legal + formats
    }
  });
}
