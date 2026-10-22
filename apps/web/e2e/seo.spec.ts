/**
 * apps/web/e2e/seo.spec.ts — S18's proof for the crawl surface.
 *
 * The sprint's four scenarios, plus the one rule the whole surface rests on:
 *
 *   1. **The sitemap validates and lists ONLY indexable pages.** Two directions,
 *      because "lists pages" is easy and "does not list the wrong ones" is the
 *      DoD: the 20 000 API-backed preset (every build verified), the verified
 *      catalogue product, the home page and the wizard are in; the two fixture
 *      presets, the indicative preset, the offer-less product and every
 *      `/config/` URL are out. Both locales are listed since S20 — each page
 *      contributes its `fr` and its `ar` address, and nothing else — so the
 *      Arabic pair is asserted here as well as the French one. The generic
 *      direction is asserted too — every listed URL must answer 200 AND must
 *      not say `noindex` — because that is the way the page and the document
 *      actually drift apart: one is edited, the other is not.
 *   2. **Canonical is absolute and self-referencing on every shipped page**, in
 *      both locales — an Arabic page names itself, not its French sibling.
 *   3. **No hreflang points at a 404.** The annotated `fr`, `ar` and `x-default`
 *      URLs are fetched and must answer 200 — which is the precondition V9 held
 *      back for two sprints, and the reason the set could grow to `ar` only once
 *      every route (the guides included) had an Arabic body.
 *   4. **The preset card is a real 1200 × 630 PNG** inside the sharing
 *      debuggers' size guidance — asserted on the BYTES (PNG signature + IHDR),
 *      not only on the meta tags that claim it.
 *
 * And the origin rule, without a browser: unset means the local origin, a
 * malformed value FAILS rather than silently shipping localhost canonicals.
 */
import { test, expect } from "@playwright/test";

import { absoluteUrl, LOCAL_ORIGIN, siteOrigin } from "../lib/seo/site";
import { IDS } from "../mock/fixtures.mjs";

const ORIGIN = "http://localhost:3210";

/** Every `<loc>` in a sitemap document, in document order. */
function sitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

/** The `<link rel="alternate" hreflang=... href=...>` set of one HTML document. */
function alternates(html: string): { hreflang: string; href: string }[] {
  const found: { hreflang: string; href: string }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/\brel="alternate"/.test(tag)) continue;
    const hreflang = /\bhreflang="([^"]*)"/i.exec(tag)?.[1];
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (hreflang === undefined || href === undefined) continue;
    found.push({ hreflang, href });
  }
  return found;
}

/** The document's `<link rel="canonical">` href, or null. */
function canonical(html: string): string | null {
  const tag = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0];
  return tag === undefined ? null : (/\bhref="([^"]*)"/.exec(tag)?.[1] ?? null);
}

const P9000 = "/fr/config-pc-gamer-9000-dh";
const P20000 = "/fr/config-pc-gamer-20000-dh";

// ---------------------------------------------------------------------------
// The origin rule, without a browser
// ---------------------------------------------------------------------------

test("the crawl origin is configuration; a malformed value fails instead of guessing", () => {
  // Unset is the local default, so a local crawl is self-consistent.
  expect(siteOrigin({})).toBe(LOCAL_ORIGIN);
  expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "   " })).toBe(LOCAL_ORIGIN);
  // A trailing slash is normalised away, not carried into every URL.
  expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://exemple.ma/" })).toBe("https://exemple.ma");
  expect(absoluteUrl("/sitemap.xml", { NEXT_PUBLIC_SITE_URL: "https://exemple.ma" })).toBe(
    "https://exemple.ma/sitemap.xml",
  );

  // Each of these would put a lie in every canonical, so each one throws.
  expect(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "exemple.ma" })).toThrow(/absolute URL/);
  expect(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "ftp://exemple.ma" })).toThrow(/http or https/);
  expect(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://exemple.ma/fr" })).toThrow(/origin/);
  expect(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://exemple.ma?x=1" })).toThrow(/origin/);
});

// ---------------------------------------------------------------------------
// 1 + 4 (robots): sitemap and robots
// ---------------------------------------------------------------------------

test("the sitemap lists only indexable pages, in both locales", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");

  const body = await response.text();
  // Well-formed, namespace-qualified urlset: what the debuggers parse. The xhtml
  // namespace appears because every entry carries its `rel="alternate"` pair.
  expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(body).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  expect(body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');

  const locs = sitemapUrls(body);
  expect(locs.length).toBeGreaterThan(6);

  // Both locales, and only these two: a page is listed in the union of its
  // translations, and an address in any other shape is a bug.
  for (const loc of locs) {
    expect(
      loc.startsWith(`${ORIGIN}/fr`) || loc.startsWith(`${ORIGIN}/ar`),
      `${loc} must be a fr or ar URL`,
    ).toBe(true);
  }

  // INVITATIONS: the API-served preset whose every build is verified, and the
  // catalogue product `componentIndexable()` accepts.
  expect(locs).toContain(`${ORIGIN}${P20000}`);
  expect(locs).toContain(`${ORIGIN}/fr/composants/rtx-4060-8gb`);
  expect(locs).toContain(`${ORIGIN}/fr`);
  // The wizard overrides no `robots` either, and its four steps are query
  // strings on this one URL — so a page a searcher wants is listed exactly once.
  expect(locs).toContain(`${ORIGIN}/fr/configurer`);
  expect(locs).toContain(`${ORIGIN}/fr/guides`);
  expect(locs).toContain(`${ORIGIN}/fr/guides/budget-pc-gamer`);
  // Listed because they override no `robots` — and reached by a reader who is
  // looking for exactly these three documents.
  expect(locs).toContain(`${ORIGIN}/fr/confidentialite`);
  expect(locs).toContain(`${ORIGIN}/ar/mentions-legales`);

  // The Arabic siblings, which S20 makes legal: same pages, `ar` addresses.
  expect(locs).toContain(`${ORIGIN}/ar`);
  expect(locs).toContain(`${ORIGIN}/ar/configurer`);
  expect(locs).toContain(`${ORIGIN}/ar/guides`);
  expect(locs).toContain(`${ORIGIN}/ar/guides/budget-pc-gamer`);
  expect(locs).toContain(`${ORIGIN}/ar/composants/rtx-4060-8gb`);

  // Each listed page carries its hreflang pair in the document itself, so a
  // crawler does not need the HTML to discover the translation.
  const first = body.slice(body.indexOf(`<loc>${ORIGIN}/fr</loc>`));
  expect(first).toContain('<xhtml:link rel="alternate" hreflang="fr"');
  expect(first).toContain('<xhtml:link rel="alternate" hreflang="ar"');
  expect(first).toContain('<xhtml:link rel="alternate" hreflang="x-default"');

  // ...and NOT the pages that answer `noindex`: two fixture presets, the preset
  // whose pass carries an indicative card, and the offer-less product — in
  // NEITHER locale, since the predicate is the page's, not the URL's. Listing
  // one of these would be the site telling a crawler two different things.
  for (const locale of ["fr", "ar"]) {
    expect(locs).not.toContain(`${ORIGIN}/${locale}/config-pc-gamer-9000-dh`);
    expect(locs).not.toContain(`${ORIGIN}/${locale}/config-pc-gamer-15000-dh`);
    expect(locs).not.toContain(`${ORIGIN}/${locale}/composants/kit-ddr5-16-go`);
    expect(locs).not.toContain(`${ORIGIN}/${locale}/composants/rtx-4060-ti-gaming-oc-16-go`);
  }

  // A result is a per-visitor page with `noindex`: permanently excluded.
  expect(body).not.toContain("/config/");
});

test("every URL the sitemap advertises answers 200 and is itself indexable", async ({
  request,
}) => {
  const locs = sitemapUrls(await (await request.get("/sitemap.xml")).text());
  expect(locs.length).toBeGreaterThan(0);
  for (const loc of locs) {
    const path = loc.slice(ORIGIN.length);
    const response = await request.get(path);
    expect(response.status(), loc).toBe(200);
    // The direction that bites: a listed page whose OWN tag says `noindex` is the
    // site contradicting itself in public. Both sides now call one predicate, and
    // this is the assertion that notices when someone stops.
    const robots = /<meta name="robots" content="([^"]*)"/.exec(await response.text())?.[1];
    expect(robots ?? "", `${loc} is listed but its own tag says noindex`).not.toContain(
      "noindex",
    );
  }
});

test("robots.txt allows the site and points at the absolute sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toMatch(/^User-Agent: \*$/m);
  expect(body).toMatch(/^Allow: \/$/m);
  expect(body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  // No crawl-budget rule hides a `noindex` tag from the crawler.
  expect(body).not.toMatch(/^Disallow: \/$/m);
});

// ---------------------------------------------------------------------------
// 2 + 3: canonical, and no hreflang to a 404
// ---------------------------------------------------------------------------

/** The shipped routes, in both locales where they exist. */
const PAGES = [
  "/fr",
  "/ar",
  "/fr/configurer",
  "/ar/configurer",
  "/fr/guides",
  "/ar/guides",
  "/fr/guides/budget-pc-gamer",
  "/ar/guides/budget-pc-gamer",
  // S22's legal pages: indexed, self-canonical, and bilingual like the rest.
  "/fr/mentions-legales",
  "/ar/mentions-legales",
  "/fr/confidentialite",
  "/ar/confidentialite",
  "/fr/contact",
  "/ar/contact",
  "/fr/composants/rtx-4060-8gb",
  "/ar/composants/rtx-4060-8gb",
  P9000,
  "/ar/config-pc-gamer-9000-dh",
  `/fr/config/${IDS.threeBuilds}`,
  `/ar/config/${IDS.threeBuilds}`,
];

test("canonical is absolute and self-referencing on every shipped page", async ({ request }) => {
  for (const path of PAGES) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const href = canonical(await response.text());
    expect(href, `${path} must name itself`).toBe(`${ORIGIN}${path}`);
  }
});

test("hreflang names fr + ar + x-default, and every annotated URL answers 200", async ({
  request,
}) => {
  for (const path of ["/fr", "/ar", P9000, "/fr/guides/choisir-un-gpu", "/ar/guides/choisir-un-gpu"]) {
    const html = await (await request.get(path)).text();
    const links = alternates(html);
    const languages = Object.fromEntries(links.map((link) => [link.hreflang, link.href]));
    const bare = path.replace(/^\/(fr|ar)/, "");

    // Each locale names ITS OWN page — that is what S20 buys, and what V9 held
    // back until every advertised URL existed in both languages.
    expect(languages.fr, `${path} fr alternate`).toBe(`${ORIGIN}/fr${bare}`);
    expect(languages.ar, `${path} ar alternate`).toBe(`${ORIGIN}/ar${bare}`);
    expect(languages["x-default"], `${path} x-default`).toBe(languages.fr);
    expect(Object.keys(languages).sort()).toEqual(["ar", "fr", "x-default"]);

    // The claim is only legal because the URL exists. This is the assertion that
    // would go red if a French-only page shipped an `ar` alternate.
    for (const link of links) {
      const response = await request.get(link.href.slice(ORIGIN.length));
      expect(response.status(), `${path} hreflang ${link.hreflang} -> ${link.href}`).toBe(200);
    }
  }
});

// ---------------------------------------------------------------------------
// 3: the preset OG image
// ---------------------------------------------------------------------------

test("the preset card is a real 1200 x 630 PNG inside the debuggers' guidance", async ({
  request,
}) => {
  const html = await (await request.get(P9000)).text();

  const imageUrl = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  expect(imageUrl, "a preset page must advertise an image").toBeDefined();
  // Absolute, and the preset's OWN route — not a sibling page's card.
  expect(imageUrl).toMatch(new RegExp(`^${ORIGIN}${P9000}/opengraph-image`));

  // The declared dimensions, so a preview box never has to guess.
  expect(html).toContain('<meta property="og:image:width" content="1200"/>');
  expect(html).toContain('<meta property="og:image:height" content="630"/>');
  expect(html).toMatch(/<meta property="og:image:alt" content="[^"]+"/);
  expect(html).toMatch(/<meta name="twitter:image" content="[^"]+"/);

  const response = await request.get(imageUrl!.slice(ORIGIN.length));
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");

  const bytes = await response.body();
  // The debuggers' guidance: at most 8 MB, at least 200 x 200.
  expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
  // PNG signature + IHDR: 8-byte signature, then length/type, then width/height.
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBe(1200);
  expect(height).toBe(630);
  expect(width).toBeGreaterThanOrEqual(200);
  expect(height).toBeGreaterThanOrEqual(200);
});
