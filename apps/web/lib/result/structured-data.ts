/**
 * lib/result/structured-data.ts — S19's gate: Product/Offer JSON-LD exists only
 * for a build whose every price is a VERIFIED offer.
 *
 * `price_status` alone is not that fact. The API derives it as "verified" when
 * every component's `offer_class` is VERIFIED — vacuously true for a build with
 * no components — and an all-SEED_UNVERIFIED pass derives the same "indicative"
 * a half-quoted pass gets. `priceProvenance()` is the three-state answer the
 * badge already shows (demo | indicative | verified), so it is the gate here too.
 *
 * "Unrepresentable" is a TYPE, not a comment. The serializer accepts
 * `VerifiedPricedBuild`, a branded type only `asVerifiedPricedBuild()` mints, and
 * that constructor throws on a demo price, an indicative one, or a build with no
 * total. Passing a raw build from `RecommendationResponse` is a compile error, so
 * a page cannot mark up a demo price by forgetting an `if`.
 *
 * Prices are NUMBERS, never formatted strings. `total_price` is the engine's sum
 * of the components' `price_used`, and schema.org's `price` takes a number — a
 * formatted one would put a locale in structured data, which is how a crawler
 * ends up reading a currency-suffixed human string as a number.
 *
 * What this module does NOT do: choose the copy. Names and descriptions are
 * localized at the call site and passed in, exactly as `model.ts` keeps
 * formatting out of its decisions.
 */
import { priceProvenance, type Build } from "./model";

/** The brand no code outside this module can mint. */
const VERIFIED = Symbol("verified-priced-build");

/**
 * A build whose price `priceProvenance()` calls verified AND whose total is a
 * real number. The `total_price` intersection narrows `number | null` to
 * `number`, so the serializer needs no assertion of its own.
 */
export type VerifiedPricedBuild = Build & {
  readonly [VERIFIED]: true;
  readonly total_price: number;
};

/** Raised when a caller asks for structured data a build cannot back. */
export class NonVerifiedPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonVerifiedPriceError";
  }
}

/**
 * The only constructor of `VerifiedPricedBuild`.
 *
 * The message names the actual state, because the two refusals are different
 * bugs: a "demo" price is a placeholder that was never a quote, while an
 * "indicative" one is a mixed pass where SOME price is real. Both must never be
 * marked up, and neither should ever be passed here in the first place.
 */
export function asVerifiedPricedBuild(build: Build): VerifiedPricedBuild {
  const provenance = priceProvenance(build);
  if (provenance !== "verified") {
    throw new NonVerifiedPriceError(`refusing structured data for a ${provenance} price`);
  }
  if (typeof build.total_price !== "number" || !Number.isFinite(build.total_price)) {
    throw new NonVerifiedPriceError("refusing structured data for a build with no total_price");
  }
  return build as VerifiedPricedBuild;
}

/** The schema.org shape this module emits, and nothing it cannot back. */
export interface ProductJsonLd {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  description?: string;
  offers: {
    "@type": "Offer";
    price: number;
    priceCurrency: string;
  };
}

/**
 * Product + Offer, from the verified build's own numbers.
 *
 * No `availability`: nobody here knows a shop's stock, and an `InStock` that no
 * offer row asserts is the same lie as a demo price. No `priceValidUntil`
 * either: the contract carries no per-offer observed date (CD-6), so a
 * shelf-life claim would be invented. What is emitted is what the API proved —
 * the total and its currency.
 */
export function productJsonLd(
  build: VerifiedPricedBuild,
  copy: { name: string; description?: string; currency: string },
): ProductJsonLd {
  if (!/^[A-Z]{3}$/.test(copy.currency)) {
    throw new NonVerifiedPriceError(
      `refusing structured data for currency ${JSON.stringify(copy.currency)}`,
    );
  }
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: copy.name,
    ...(copy.description === undefined ? {} : { description: copy.description }),
    offers: {
      "@type": "Offer",
      price: build.total_price,
      priceCurrency: copy.currency,
    },
  };
}

/**
 * The payload as text, safe inside `<script type="application/ld+json">`.
 *
 * `<` is escaped as `\u003c`, which JSON.parse reads back unchanged. That is the
 * one character that could end the element early: a product name containing
 * `</script>` would otherwise break the page it is embedded in, and this is the
 * only place that turns the object into text.
 */
export function jsonLdScript(value: ProductJsonLd): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
