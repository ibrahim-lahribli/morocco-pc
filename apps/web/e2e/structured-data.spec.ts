/**
 * apps/web/e2e/structured-data.spec.ts — S19's gate, from both ends.
 *
 * The serializer half proves a demo or indicative price cannot BECOME structured
 * data: `asVerifiedPricedBuild()` is the only door into `productJsonLd()`, and
 * it refuses. The page half proves the door is wired: a verified fixture page
 * carries exactly one `application/ld+json` block whose price is the fixture's
 * own total, while the demo and the rank-1 INDICATIVE pages carry none.
 *
 * The page assertions read the RAW HTML (`request.get`), not the DOM: what a
 * crawler receives is the server's bytes, and a block that only existed after
 * hydration would be worth nothing to it.
 */
import { test, expect } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import {
  NonVerifiedPriceError,
  asVerifiedPricedBuild,
  jsonLdScript,
  productJsonLd,
  type ProductJsonLd,
} from "../lib/result/structured-data";
import {
  IDS,
  RECOMMENDATION_DEMO,
  RECOMMENDATION_THREE_BUILDS,
} from "../mock/fixtures.mjs";

const VERIFIED = `/fr/config/${IDS.threeBuilds}`;
const DEMO = `/fr/config/${IDS.demo}`;
const INDICATIVE = `/fr/config/${IDS.indicative}`;

/** The fixture's rank-1 build, all eight components VERIFIED. */
const VERIFIED_BUILD = RECOMMENDATION_THREE_BUILDS.builds[0];
/** Rank 2 of the same response: one real offer, one seed placeholder. */
const MIXED_BUILD = RECOMMENDATION_THREE_BUILDS.builds[1];
/** Its own pass: every component SEED_UNVERIFIED. */
const DEMO_BUILD = RECOMMENDATION_DEMO.builds[0];

/** Every JSON-LD block in a server-rendered document, parsed. */
function jsonLdBlocks(html: string): ProductJsonLd[] {
  const blocks: ProductJsonLd[] = [];
  const pattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(pattern)) blocks.push(JSON.parse(match[1]));
  return blocks;
}

test("a demo price cannot become structured data, and the refusal names it", () => {
  // The all-seed pass is the state this sprint exists for: its total is a
  // placeholder, so it must never reach a crawler as a price.
  expect(() => asVerifiedPricedBuild(DEMO_BUILD)).toThrow(NonVerifiedPriceError);
  expect(() => asVerifiedPricedBuild(DEMO_BUILD)).toThrow(/demo/);

  // The mixed pass is NOT demo (an indicator would call it "indicative"), and
  // it is still refused: one real offer does not vouch for the other seven.
  expect(() => asVerifiedPricedBuild(MIXED_BUILD)).toThrow(/indicative/);
});

test("a verified price with no total is refused too", () => {
  // The contract can serve a null `total_price` (NULL is "not recorded", never
  // 0). A verified provenance with no number is not a price to publish.
  const noTotal = { ...VERIFIED_BUILD, total_price: null };
  expect(() => asVerifiedPricedBuild(noTotal)).toThrow(/total_price/);
});

test("the verified build serializes to Product + Offer with its own number", () => {
  const payload = productJsonLd(asVerifiedPricedBuild(VERIFIED_BUILD), {
    name: "Configuration PC",
    description: "Description",
    currency: "MAD",
  });

  expect(payload["@context"]).toBe("https://schema.org");
  expect(payload["@type"]).toBe("Product");
  expect(payload.offers["@type"]).toBe("Offer");
  // The number is the fixture's own sum of `price_used`, unformatted: a locale
  // string here would make a crawler read a price that is not one.
  expect(payload.offers.price).toBe(VERIFIED_BUILD.total_price);
  expect(payload.offers.priceCurrency).toBe("MAD");
  expect(payload.description).toBe("Description");
});

test("a malformed currency is refused rather than published", () => {
  const verified = asVerifiedPricedBuild(VERIFIED_BUILD);
  expect(() => productJsonLd(verified, { name: "x", currency: "mad" })).toThrow(
    NonVerifiedPriceError,
  );
  expect(() => productJsonLd(verified, { name: "x", currency: "MAD " })).toThrow(
    NonVerifiedPriceError,
  );
});

test("the payload cannot close its own script element", () => {
  // A product name is DATA, and `</script>` inside it would end the element and
  // turn the rest of the payload into markup. `jsonLdScript()` escapes `<`.
  const payload = productJsonLd(asVerifiedPricedBuild(VERIFIED_BUILD), {
    name: '</script><script>alert("x")</script>',
    currency: "MAD",
  });
  const text = jsonLdScript(payload);

  expect(text).not.toContain("</script>");
  expect(text).not.toContain("<script");
  // Escaping, not mangling: JSON.parse reads the name back unchanged.
  expect(JSON.parse(text).name).toBe('</script><script>alert("x")</script>');
});

test("the verified result page carries ONE Product block, priced in MAD", async ({ request }) => {
  const response = await request.get(VERIFIED);
  expect(response.status()).toBe(200);
  const blocks = jsonLdBlocks(await response.text());

  // One block, for the primary build: three cards must not mean three products.
  expect(blocks).toHaveLength(1);
  const [payload] = blocks;
  expect(payload["@context"]).toBe("https://schema.org");
  expect(payload["@type"]).toBe("Product");
  expect(payload.offers.price).toBe(VERIFIED_BUILD.total_price);
  expect(payload.offers.priceCurrency).toBe("MAD");
  // The name is the og:title's own sentence, so the unfurled card and the
  // crawled block cannot advertise different amounts.
  expect(payload.name).toContain(formatMoney(VERIFIED_BUILD.total_price, "fr"));
  expect(payload.name).toContain("vérifié");
  // Nothing the engine never asserted: no stock, no shelf life.
  expect(payload).not.toHaveProperty("offers.availability");
  expect(payload.offers).not.toHaveProperty("priceValidUntil");
});

test("the demo and rank-1 indicative pages emit no structured data", async ({ request }) => {
  // Both pages still render their totals and badges — the gate is about the
  // CLAIM, not about hiding the number.
  for (const path of [DEMO, INDICATIVE]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(jsonLdBlocks(html), path).toHaveLength(0);
    expect(html, path).not.toContain("application/ld+json");
  }
});

test("the Arabic page carries the same block, named in its own locale", async ({ request }) => {
  const fr = jsonLdBlocks(await (await request.get(VERIFIED)).text())[0];
  const ar = jsonLdBlocks(await (await request.get(`/ar/config/${IDS.threeBuilds}`)).text())[0];

  expect(ar.offers.price).toBe(fr.offers.price);
  expect(ar.offers.priceCurrency).toBe("MAD");
  // Same product, different sentence: the name is translated, the price is not.
  expect(ar.name).not.toBe(fr.name);
  expect(ar.name).toContain(formatMoney(VERIFIED_BUILD.total_price, "ar"));
});
