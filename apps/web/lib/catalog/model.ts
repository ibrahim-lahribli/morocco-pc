/**
 * lib/catalog/model.ts — the component page's decisions, as pure functions (S17).
 *
 * Three rules, and each one exists because the obvious shortcut is a lie:
 *
 * ## 1. A price's provenance is three states, not `price_status`
 *
 * The API derives `price_status: "verified"` when every offer is VERIFIED — and
 * `"indicative"` for both an all-SEED_UNVERIFIED product and a half-quoted one.
 * `priceProvenance()` on the results page already folds those into the badge's
 * three words (démo | indicatif | vérifié) from the components' `offer_class`;
 * this is the same fold for a product's OFFERS, so a page cannot show "démo" in
 * one room and "indicatif" in another. The demo test runs first: an all-seed
 * product's derived status IS "indicative", so a check ordered the other way
 * would never reach it.
 *
 * ## 2. Indexability is a CONJUNCTION, and the strict half is not `price_status`
 *
 * A component page may be indexed only when the page it describes can be
 * vouched for: at least one offer, `price_status === "verified"`, AND every
 * offer class VERIFIED. The last clause repeats the API's derivation on purpose
 * — a status column that disagrees with its own rows (a partial write, a
 * presenter bug) must not be able to put a seed price in an index. This is
 * S16's rule ("indexability follows the data") applied to the catalogue.
 *
 * ## 3. A missing price is `null`, never 0
 *
 * `fromPrice()` returns the cheapest offer's number, or null when there is none.
 * A product with no offer is still a real catalogue page (the API serves it with
 * `has_offer: false`); painting it as "0 DH" would be the standing NULL-is-not-0
 * error, and a sort key that treats null as 0 would rank it first.
 */
import type { CatalogProductResponse } from "../api/client";
import type { PriceProvenance } from "../result/model";
// Type-only on purpose: `load.ts` imports this module's RULES, so a value import
// back would be a cycle. `import type` is erased and never exists at runtime.
import type { CatalogOutcome } from "./load";

/** The badge's three words, shared with the results page (S12). */
export type CatalogProvenance = PriceProvenance;

/**
 * The badge’s three MESSAGE KEYS (S12/S17/S23).
 *
 * One map for every surface that prints a provenance word: the results page, the
 * component page and the compare view resolve the same key for the same state, so
 * a price cannot be "démo" in one room and "indicatif" in another.
 */
export const PROVENANCE_MESSAGE_KEY = {
  demo: "provenance.demo",
  indicative: "provenance.indicative",
  verified: "provenance.verified",
} as const satisfies Record<CatalogProvenance, string>;

/** The contract's eight categories, in the order the enum declares them. */
export const CATALOG_CATEGORIES = [
  "CPU",
  "MOTHERBOARD",
  "MEMORY",
  "GPU",
  "STORAGE",
  "PSU",
  "CASE",
  "COOLER",
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/** A category the copy has a word for, or null for a value we have never seen. */
export function catalogCategory(category: string): CatalogCategory | null {
  return (CATALOG_CATEGORIES as readonly string[]).includes(category)
    ? (category as CatalogCategory)
    : null;
}

/**
 * The three-state provenance of a product's prices.
 *
 * No offers at all means NOTHING is known, which is "indicative" rather than
 * "verified": `every()` over an empty list is vacuously true, and that vacuum is
 * exactly what the empty guard at the top refuses.
 */
export function catalogProvenance(
  product: Pick<CatalogProductResponse, "price_status" | "offers">,
): CatalogProvenance {
  const offers = product.offers;
  if (offers.length === 0) return "indicative";
  if (offers.every((offer) => offer.offer_class === "SEED_UNVERIFIED")) return "demo";
  return product.price_status === "verified" ? "verified" : "indicative";
}

/**
 * One offer's provenance, as the badge's three words.
 *
 * The contract's `offer_class` is an enum (`VERIFIED` | `SEED_UNVERIFIED`, and a
 * class this module may not know). Printing it would put an engine word in front
 * of a reader — the exact failure V5 forbids — so the mapping lives here, beside
 * the product-level fold, and an unknown class degrades to "indicative" rather
 * than to a claim of trust.
 */
export function offerProvenance(offerClass: string): CatalogProvenance {
  if (offerClass === "VERIFIED") return "verified";
  if (offerClass === "SEED_UNVERIFIED") return "demo";
  return "indicative";
}

/**
 * Whether a component page may be indexed (rule 2 in the header).
 *
 * Re-checks the offer classes rather than trusting `price_status` alone: the
 * status is a derived column, and an index entry outlives the render that made
 * it.
 */
export function componentIndexable(
  product: Pick<CatalogProductResponse, "price_status" | "offers">,
): boolean {
  if (product.offers.length === 0) return false;
  if (product.price_status !== "verified") return false;
  return product.offers.every((offer) => offer.offer_class === "VERIFIED");
}

/**
 * Whether a component PAGE may be indexed — the ONE predicate the page's
 * `robots` tag and `/sitemap.xml`'s catalogue walk both call.
 *
 * `componentIndexable()` above is the rule; this applies it to a loader OUTCOME,
 * so the page and the sitemap ask one question rather than two spellings of it.
 * The sitemap's catalogue walk used to repeat the `kind === "ok"` half itself,
 * which is the shape that rots: the page's tag and the listed set were only
 * kept in step by whoever remembered both.
 *
 * `missing` is not indexable — a 404 has nothing to index.
 *
 * A plain boolean, not a type guard: a caller that needs `outcome.product` still
 * narrows on `kind` first, because "may be indexed" does not say which product.
 */
export function componentPageIndexable(outcome: CatalogOutcome): boolean {
  return outcome.kind === "ok" && componentIndexable(outcome.product);
}

/**
 * The cheapest offer's price, or null.
 *
 * `Math.min` over an empty list is `Infinity`, so the empty case is answered
 * before the arithmetic rather than after it.
 */
export function fromPrice(
  product: Pick<CatalogProductResponse, "offers">,
): number | null {
  if (product.offers.length === 0) return null;
  return Math.min(...product.offers.map((offer) => offer.price));
}
