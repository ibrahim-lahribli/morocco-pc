/**
 * apps/web/e2e/guides.spec.ts — S17's proof for the editorial surface, and S20's
 * for its Arabic half.
 *
 * The DoD's four scenarios, in order, plus the locale policy the implementation
 * states:
 *
 *   1. **MDX renders**, with real prose structure (headings, a list, a link) —
 *      not just a `<p>`: the components map is what turns the body into an
 *      article, so the assertions look for the structure it produces.
 *   2. **Heading hierarchy** starts at one h1 and never skips a level. A guide
 *      body begins at `##`, and the page owns the `h1`; a body that introduced its
 *      own `#` would be caught here.
 *   3. **The long name / 360 px rule** belongs to the component page
 *      (`catalog.spec.ts`); this file covers the guide instead.
 *   4. **Internal links resolve** — the link checker the DoD asks for, run in
 *      CI as part of the suite: every internal href on the index and on every
 *      guide is requested, and must answer 200. That is what proves a guide's
 *      links to preset and component pages are real, not aspirational.
 *
 * Plus the locale policy. S17 shipped French-only guides and this file asserted
 * the `ar` policy that came with it (an Arabic note, `noindex`, and `/ar/guides/…`
 * as a 404). S20 translated both bodies, so the policy inverted: BOTH indexes are
 * real lists in their own language and both are indexable, a guide URL under `ar`
 * is 200 with Arabic prose, and the link checker runs over the Arabic tree too —
 * because an Arabic guide links to Arabic siblings, and `rtl.spec.ts` is what
 * checks the prose's direction and content.
 */
import { test, expect, type Page } from "@playwright/test";

// The MANIFEST, not the registry: the registry imports `content/guides/*.mdx`, and
// Playwright's TypeScript transform has no MDX loader. The metadata is the same
// data either way — the manifest is its single source.
import { GUIDE_MANIFEST as GUIDES, guideText } from "../lib/guides/manifest";

const LOCALES = ["fr", "ar"] as const;

const indexOf = (locale: string) => `/${locale}/guides`;
const guidePath = (locale: string, slug: string) => `/${locale}/guides/${slug}`;

/** Every internal href rendered in the main region, deduped. */
async function internalLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator("main")
    .getByRole("link")
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
  return Array.from(
    new Set(hrefs.filter((href) => href.startsWith("/") && !href.startsWith("//"))),
  );
}

for (const locale of LOCALES) {
  test(`the ${locale} index lists every guide, in that locale's copy, as a link`, async ({
    page,
  }) => {
    await page.goto(indexOf(locale));

    for (const guide of GUIDES) {
      const text = guideText(guide, locale);
      await expect(
        page.getByRole("link", { name: text.title }),
        `${locale}/${guide.slug}`,
      ).toHaveAttribute("href", guidePath(locale, guide.slug));
    }
  });

  test(`a ${locale} guide renders MDX prose, one h1, no skipped heading levels`, async ({ page }) => {
    const guide = GUIDES[0];
    const text = guideText(guide, locale);
    await page.goto(guidePath(locale, guide.slug));

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text.title);
    // The body's structure came from markdown, not from a hardcoded string.
    const levels = await page.$$eval("h1, h2, h3, h4", (elements) =>
      elements.map((element) => Number(element.tagName.slice(1))),
    );
    expect(levels.length).toBeGreaterThan(3);
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index], `heading order ${levels.join(",")}`).toBeLessThanOrEqual(
        levels[index - 1] + 1,
      );
    }

    // A list, a bold run and a link: the three shapes the first guide uses.
    await expect(page.locator("article ul li").first()).toBeVisible();
    await expect(page.locator("article strong").first()).toBeVisible();
    await expect(page.locator("article a").first()).toBeVisible();
  });
}

test("every internal link on every index and every guide answers 200", async ({ page, request }) => {
  // The link checker: no allow-list, so a broken link cannot be skipped by name.
  // Both locales, because an Arabic guide links to Arabic siblings and a copy-paste
  // of the French body's hrefs would 404 on a `/fr`-only route only here.
  const visited: string[] = [];
  const pages = LOCALES.flatMap((locale) => [
    indexOf(locale),
    ...GUIDES.map((guide) => guidePath(locale, guide.slug)),
  ]);

  for (const path of pages) {
    await page.goto(path);
    for (const href of await internalLinks(page)) {
      if (visited.includes(href)) continue;
      visited.push(href);
      const response = await request.get(href);
      expect(response.status(), `${href} (linked from ${path})`).toBe(200);
    }
  }

  // The guide bodies point at a preset and a component page, in both languages;
  // if either stopped being reachable, one of the requests above would have
  // failed. This asserts that the crawl actually covered them, so a page that
  // rendered no links cannot pass vacuously.
  expect(visited).toContain("/fr/guides/budget-pc-gamer");
  expect(visited).toContain("/ar/guides/budget-pc-gamer");
  expect(visited).toContain("/fr/config-pc-gamer-9000-dh");
  expect(visited).toContain("/ar/config-pc-gamer-9000-dh");
  expect(visited).toContain("/fr/composants/rtx-4060-8gb");
  expect(visited).toContain("/ar/composants/rtx-4060-8gb");
});

test("an unknown guide slug is a 404 in both locales", async ({ page }) => {
  for (const path of ["/fr/guides/pas-un-guide", "/ar/guides/pas-un-guide"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("both guide indexes are indexable lists in their own language", async ({ request }) => {
  const arabic = await (await request.get(indexOf("ar"))).text();
  // Arabic copy, and Arabic LINKS: the switcher's `/fr/guides` href is the only
  // French one a reader should find on an Arabic index.
  expect(arabic).toContain("الأدلة");
  expect(arabic).toContain('href="/ar/guides/budget-pc-gamer"');
  expect(arabic).not.toMatch(/<meta name="robots" content="[^"]*noindex/);

  const french = await (await request.get(indexOf("fr"))).text();
  expect(french).toContain("Guides");
  expect(french).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
});
