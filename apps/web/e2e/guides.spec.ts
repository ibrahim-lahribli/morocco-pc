/**
 * apps/web/e2e/guides.spec.ts — S17's proof for the editorial surface.
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
 * Plus the ar policy: the index says (in Arabic) that the guides are French and
 * stays out of the index, while a guide URL under `ar` is a 404 — no Arabic frame
 * around French prose (S20 owns the translation).
 */
import { test, expect, type Page } from "@playwright/test";

// The MANIFEST, not the registry: the registry imports `content/guides/*.mdx`, and
// Playwright's TypeScript transform has no MDX loader. The metadata is the same
// data either way — the manifest is its single source.
import { GUIDE_MANIFEST as GUIDES } from "../lib/guides/manifest";

const INDEX = "/fr/guides";

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

test("the index lists every registered guide, as a link", async ({ page }) => {
  await page.goto(INDEX);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guides");

  for (const guide of GUIDES) {
    await expect(
      page.getByRole("link", { name: guide.title }),
      guide.slug,
    ).toHaveAttribute("href", `/fr/guides/${guide.slug}`);
  }
});

test("a guide renders MDX prose, with one h1 and no skipped heading levels", async ({ page }) => {
  const guide = GUIDES[0];
  await page.goto(`/fr/guides/${guide.slug}`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(guide.title);
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

test("every internal link on the index and every guide answers 200", async ({ page, request }) => {
  // The link checker: no allow-list, so a broken link cannot be skipped by name.
  const visited: string[] = [];
  const pages = [INDEX, ...GUIDES.map((guide) => `/fr/guides/${guide.slug}`)];

  for (const path of pages) {
    await page.goto(path);
    for (const href of await internalLinks(page)) {
      if (visited.includes(href)) continue;
      visited.push(href);
      const response = await request.get(href);
      expect(response.status(), `${href} (linked from ${path})`).toBe(200);
    }
  }

  // The guide bodies point at a preset and a component page; if either stopped
  // being reachable, one of the requests above would have failed. This asserts
  // that the crawl actually covered them, so a page that rendered no links
  // cannot pass vacuously.
  expect(visited).toContain("/fr/guides/budget-pc-gamer");
  expect(visited).toContain("/fr/config-pc-gamer-9000-dh");
  expect(visited).toContain("/fr/composants/rtx-4060-8gb");
});

test("an unknown guide, and a guide under ar, are the locale's 404", async ({ page }) => {
  for (const path of ["/fr/guides/pas-un-guide", `/ar/guides/${GUIDES[0].slug}`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("the ar index says the guides are French, and stays out of the index", async ({ request }) => {
  const html = await (await request.get("/ar/guides")).text();
  // Arabic copy, not a French page inside an Arabic shell.
  expect(html).toContain("الأدلة");
  expect(html).toContain('href="/fr/guides"');
  expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);

  // The French index IS indexable: the section is a real landing surface.
  const fr = await (await request.get(INDEX)).text();
  expect(fr).not.toContain('content="noindex');
});
