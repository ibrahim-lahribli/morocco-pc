'use strict';

/**
 * apps/api/src/contracts/catalog.js - the read-only catalog contracts
 * (Platform P2 Sprint 3, contract v1.5; the price history arrived in v1.6).
 *
 * `GET /v1/catalog/products` and `GET /v1/catalog/products/:slug` expose the
 * product catalogue migration 020 made addressable (`slug`, `display_name`) and
 * the Layer 3 offers that price it; `GET /v1/catalog/products/:slug/price-history`
 * serves the observations behind that price. Three properties are load-bearing,
 * and the history route obeys all three: one point per observation moment.
 * That last rule is a fourth property, stated on `PriceHistoryResponseSchema`.
 *
 *   1. NULL MEANS UNKNOWN, AND AN UNPRICED PRODUCT IS NOT HIDDEN. A product
 *      with no eligible offer keeps its page slot, reports `has_offer: false`
 *      and a `null` `from_price` / `offer_class`; dropping it would make the
 *      catalog look complete when it is not, and a `0` price would say a real
 *      thing the database never said. The DETAIL route then reports
 *      `price_status: null`: there is no price to make a provenance claim
 *      about, and `'verified'` over an empty offer list is the one reading this
 *      field must never produce.
 *
 *   2. A PRICE ALWAYS CARRIES ITS CLASS. `offer_class` is the Decision 35
 *      vocabulary (`SEED_UNVERIFIED` | `VERIFIED`), derived from the offer's
 *      `ingestion_record_id` exactly as the engine derives it. Today every
 *      offer is seed data, so a catalog page reads `SEED_UNVERIFIED` and
 *      `price_status: "indicative"` - correct, and never special-cased.
 *
 *   3. PAGINATION IS A KEYSET, SO `next_cursor` IS THE LAST SLUG AND NOT AN
 *      OFFSET. `null` means "this is the last page". A cursor is echoed as
 *      given; the query validates its own `limit` because Fastify runs with
 *      `coerceTypes: false`, so a querystring value is always a STRING here and
 *      an `integer` schema type would reject every request.
 *
 * `specs` is an OPEN object: its keys are the spec table's columns, which this
 * contract deliberately does not enumerate. Enumerating them would make every
 * spec-table migration a breaking API change, and the columns are already the
 * schema's documented truth (`docs/SCHEMA_REFERENCE.md`). The stable part is the
 * SHAPE - one flat object per product, identity columns stripped.
 */

const { Type } = require('@sinclair/typebox');

const CatalogProductSchema = Type.Object({
  /** The stable URL identifier (migration 020's `uq_product_slug`). */
  slug: Type.String(),
  /** `COALESCE(product.display_name, product.name)` - never the `Seed ` prefix. */
  display_name: Type.String(),
  /** Derived from spec-table presence: a `product_category` enum value. */
  category: Type.String(),
  /** Cheapest ELIGIBLE offer, as a NUMBER; null when there is none. */
  from_price: Type.Union([Type.Number(), Type.Null()]),
  /** Decision 35 provenance of THAT price; null when there is no price. */
  offer_class: Type.Union([Type.String(), Type.Null()]),
  has_offer: Type.Boolean(),
}, { additionalProperties: false, $id: 'CatalogProduct' });

const CatalogListResponseSchema = Type.Object({
  products: Type.Array(CatalogProductSchema),
  /** The last slug of this page when more rows exist; null on the last page. */
  next_cursor: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false, $id: 'CatalogListResponse' });

/**
 * Query parameters are STRINGS because `coerceTypes: false` (app.js) keeps them
 * strings: `limit=20` must be validated by the handler, not by an `integer`
 * schema. The pattern bounds the obvious garbage before the handler ranges it.
 */
const CatalogProductsQuerySchema = Type.Object({
  /** A `component_role`; the handler maps it to its product category. */
  role: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,4}$' })),
  /** The previous page's `next_cursor` (a slug). */
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false, $id: 'CatalogProductsQuery' });

const CatalogProductParamsSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false, $id: 'CatalogProductParams' });

/** One priced offer of the product, cheapest first in the served list. */
const CatalogOfferSchema = Type.Object({
  price: Type.Number(),
  currency: Type.String(),
  offer_class: Type.String(),
}, { additionalProperties: false, $id: 'CatalogOffer' });

const CatalogProductDetailSchema = Type.Object({
  slug: Type.String(),
  display_name: Type.String(),
  category: Type.String(),
  /** The spec row as a flat object; `{}` when the row has no columns left. */
  specs: Type.Object({}, { additionalProperties: true }),
  offers: Type.Array(CatalogOfferSchema),
  /**
   * 'verified' only when the product HAS offers and every one is VERIFIED;
   * 'indicative' when any is not (an unknown class included - fail-safe by
   * direction); null when there is no offer at all.
   */
  price_status: Type.Union([Type.Literal('indicative'), Type.Literal('verified'), Type.Null()]),
  disclaimer: Type.String(),
}, { additionalProperties: false, $id: 'CatalogProductDetail' });

/**
 * One observation of a product's price (contract v1.6).
 *
 * A point is ONE OBSERVATION MOMENT at the product's CHEAPEST price then, not
 * one `price_history` row: a product can hold several offers (two stores, two
 * variants) recorded in the same sweep, and two consecutive points would draw a
 * rise that never happened. The grouping is documented at
 * `presentPriceHistory`.
 *
 * `observed_at` is an ISO-8601 STRING and never a Date: JSON has no date type,
 * and the web layer formats it through its own locale helpers. `price` is a
 * NUMBER (pg hands NUMERIC back as a string; the presenter converts), and
 * `offer_class` is the same Decision 35 vocabulary every catalog price carries.
 */
const PriceHistoryPointSchema = Type.Object({
  observed_at: Type.String(),
  price: Type.Number(),
  offer_class: Type.String(),
}, { additionalProperties: false, $id: 'PriceHistoryPoint' });

/**
 * `GET /v1/catalog/products/:slug/price-history` - the observations behind one
 * product's price, OLDEST first.
 *
 * The summary fields are nullable because thin data is the normal case here, and
 * a 0 would be a number the catalog never observed (`NULL IS NOT 0`):
 * `latest_price` / `min_price` / `max_price` need at least ONE point, while
 * `change_amount` / `change_pct` need TWO DISTINCT moments - a single
 * observation is a fact, not a trend. `observation_count` is the number of
 * moments and is never nullable; "none" is countable. No history is a 200 with
 * `points: []`; an UNKNOWN product is a 404, so the two cannot be confused.
 */
const PriceHistoryResponseSchema = Type.Object({
  slug: Type.String(),
  currency: Type.String(),
  points: Type.Array(PriceHistoryPointSchema),
  observation_count: Type.Integer(),
  latest_price: Type.Union([Type.Number(), Type.Null()]),
  min_price: Type.Union([Type.Number(), Type.Null()]),
  max_price: Type.Union([Type.Number(), Type.Null()]),
  change_amount: Type.Union([Type.Number(), Type.Null()]),
  change_pct: Type.Union([Type.Number(), Type.Null()]),
  disclaimer: Type.String(),
}, { additionalProperties: false, $id: 'PriceHistoryResponse' });

module.exports = {
  CatalogProductSchema,
  CatalogListResponseSchema,
  CatalogProductsQuerySchema,
  CatalogProductParamsSchema,
  CatalogOfferSchema,
  CatalogProductDetailSchema,
  PriceHistoryPointSchema,
  PriceHistoryResponseSchema,
};
