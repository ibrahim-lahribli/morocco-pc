'use strict';

/**
 * apps/api/src/routes/catalog.js - the read-only catalog surface (Platform P2
 * Sprint 3, contract v1.6 - three catalog reads plus the price history; the list
 * rows gained `variants` in v1.9, which is what lets a surface name a
 * variant-keyed product at all).
 *
 *   GET /v1/catalog/products?role=&limit=&cursor=
 *   GET /v1/catalog/products/:slug
 *   GET /v1/catalog/products/:slug/price-history   (contract v1.6)
 *
 * HISTORY IS A RECORD, NOT A TREND CLAIM. The history route serves what was
 * observed, oldest first, and reports thin data instead of smoothing it: ONE
 * POINT PER OBSERVATION MOMENT (a product with two offers in one sweep is one
 * point at the cheaper price), one moment is a price with a date and NO
 * change, and zero is an empty list.
 * Its statement deliberately does not apply the eligibility rule the list and
 * detail use - see repository.js - because pruning a history row by today's
 * stock status would rewrite the past.
 *
 * Boundary: HTTP concerns only. Both statements live in ../repository.js, the
 * role vocabulary behind ../engine.js, and the currency vocabulary in ../meta.js;
 * this module issues no SQL and imports no engine module.
 *
 * WHAT MAKES THIS PRODUCT-PAGE-SAFE:
 *
 *   - PAGINATION IS A KEYSET, and the cursor's order is the ORDER BY's order.
 *     `next_cursor` is the last slug SERVED, and the next page asks for
 *     `slug > cursor`. A page boundary revisited therefore returns the same
 *     rows: no OFFSET, no skipped row, no duplicate. `null` means the last page.
 *   - A PRODUCT WITH NO ELIGIBLE OFFER IS STILL LISTED, with `has_offer: false`
 *     and a null `from_price`. Silently dropping it would make a partial catalog
 *     look complete (the engine's own candidates step does exclude it - here the
 *     frontend must be able to say "no price yet").
 *   - A PRICE NEVER TRAVELS WITHOUT ITS PROVENANCE. `offer_class` and, on the
 *     detail page, the derived `price_status` are served beside every price, and
 *     the detail response always carries the French `DISCLAIMER`. A seed price
 *     labelled `indicative` is the honest reading of this catalog; nothing here
 *     special-cases it into `verified`.
 *
 * `use_case` is deliberately NOT a parameter, although PLAN_PLATFORM_P2.md's
 * sketch lists one. The active model exposes no per-use-case PRODUCT filter:
 * `role_weights` are global and only `gpu_policy` varies per use case, so a
 * `use_case` parameter here could only be inert - and this API's standing
 * convention is to REFUSE an unknown query parameter rather than accept a
 * no-op (Decision 36 item 3 documents the two inert fields the POST keeps, and
 * neither would be defensible on a public browse surface). The plan records the
 * deviation with its reason.
 *
 * Status codes:
 *   200  a page (possibly empty) / the product
 *   404  no ACTIVE catalog product has that slug - malformed slugs included,
 *        because there is no row to leak a PostgreSQL `22P02` from
 *   422  schema validation, a `limit` outside 1..100, or a `role` outside the
 *        engine's `component_role` vocabulary (the message names the accepted
 *        roles)
 *   429 / 500  the shared envelope
 */

const meta = require('../meta');
const {
  CatalogListResponseSchema,
  CatalogProductsQuerySchema,
  CatalogProductParamsSchema,
  CatalogProductDetailSchema,
  PriceHistoryResponseSchema,
  ErrorResponseSchema,
  DISCLAIMER,
} = require('../contracts');
const { toIsoOrNull, toNumberOrNull } = require('./presets');

const CATALOG_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

/** Page size when the caller says nothing; the bound a caller may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * The most observation MOMENTS one response carries, selected NEWEST first
 * before the presenter sorts and collapses them. A year of daily ingestion fits
 * in it, and a cap is what stops a
 * long-lived product from turning this read into an unbounded document. There is
 * no time-window PARAMETER on purpose: a clock-relative filter would make one
 * URL answer differently on different days for a reason the client cannot see.
 */
const PRICE_HISTORY_LIMIT = 366;

/**
 * The currency the catalog is priced in.
 *
 * `meta.CURRENCIES` is the API's single advertised currency (MAD today), and
 * the engine matches currency by exact equality - so the catalog asks for
 * exactly that and nothing else. If `CURRENCIES` ever grows, the list/detail
 * endpoints need a `currency` parameter in the same change; a hardcoded second
 * currency here would advertise prices in a currency nothing else uses.
 */
const CATALOG_CURRENCY = meta.CURRENCIES[0].value;

/**
 * Decision 35's provenance vocabulary, derived the way the engine derives it
 * (offers/select.js): an offer with no ingestion record IS the seed data.
 *
 * Kept as a function over the RAW row because the detail statement returns
 * `ingestion_record_id`, not a label - the label is presentation, and deriving
 * it in one place keeps the price and the class beside it from disagreeing.
 *
 * @param {object} row a SELECT_CATALOG_OFFERS_SQL row
 * @returns {'SEED_UNVERIFIED'|'VERIFIED'}
 */
function offerClassFor(row) {
  return row.ingestion_record_id === null || row.ingestion_record_id === undefined
    ? 'SEED_UNVERIFIED'
    : 'VERIFIED';
}

/**
 * The provenance of the price this product page shows.
 *
 * Three outcomes, in the same direction as the recommendation contract:
 *   - null when the product has NO eligible offer - there is no price to make a
 *     claim about, and 'verified' over an empty list is the one reading this
 *     must never produce (the presets route's rule, applied one level down);
 *   - 'verified' only when it HAS offers and every one of them is VERIFIED;
 *   - 'indicative' otherwise, an unrecognized class included - fail-safe by
 *     direction, so unknown provenance is never advertised as confirmed.
 *
 * @param {Array<object>} offers raw offer rows
 * @returns {'verified'|'indicative'|null}
 */
function priceStatusFor(offers) {
  if (!Array.isArray(offers) || offers.length === 0) {
    return null;
  }
  return offers.every((row) => offerClassFor(row) === 'VERIFIED') ? 'verified' : 'indicative';
}

/**
 * Present one page of raw rows.
 *
 * Rows come back `limit + 1` long when more pages exist; the extra row is
 * DISCARDED and only used to prove there is a next page. Its slug is therefore
 * never a cursor: the cursor is the last SERVED slug, so the next page resumes
 * exactly after it.
 *
 * @param {Array<object>} rows raw rows, at most `limit + 1`
 * @param {number} limit the requested page size
 * @returns {object} the list response body
 */
function presentCatalogPage(rows, limit) {
  const all = Array.isArray(rows) ? rows : [];
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  return {
    products: page.map((row) => {
      const fromPrice = toNumberOrNull(row.from_price);
      return {
        // The identity an ID-taking route needs (contract v1.9). A row without
        // one could not be served as anything but a broken link, but the value
        // comes from the primary key, so it is passed through as it is.
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        category: row.category,
        from_price: fromPrice,
        offer_class: fromPrice === null ? null : row.offer_class,
        has_offer: fromPrice !== null,
        // Contract v1.9: the SKUs of the product, in the engine's own order.
        // `null` (a product with no variant rows, coalesced in SQL) becomes
        // `[]`, because the shape is an array and the emptiness is the data.
        variants: presentVariants(row.variants),
      };
    }),
    next_cursor: hasMore ? page[page.length - 1].slug : null,
  };
}

/**
 * The `variants` array of one list row (contract v1.9).
 *
 * Defensive by SHAPE, not by invention: a row whose aggregate is missing or is
 * not an array becomes `[]` (the truthful "no variants"), and an entry missing
 * an id is DROPPED rather than served with a placeholder - a variant the caller
 * cannot address is not a variant it can use. `sku` is `NOT NULL` in the schema
 * (migration 003), so it is passed through.
 *
 * @param {unknown} raw the row's jsonb aggregate
 * @returns {Array<{id: string, sku: string}>}
 */
function presentVariants(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id, sku: typeof entry.sku === 'string' ? entry.sku : '' }));
}

/**
 * Present a product detail.
 *
 * `specs` is passed through as the statement returned it (one jsonb object,
 * identity columns already stripped). An absent spec row becomes `{}` rather
 * than null: the response shape promises an object, and the LIST cannot serve a
 * product without a spec row - so an empty object here is a shape guarantee, not
 * a data claim (the category itself is the data claim, and it is served).
 *
 * @param {object} snapshot { product, offers, specs } from readCatalogProduct
 * @returns {object} the detail response body
 */
function presentCatalogProduct(snapshot) {
  const offers = Array.isArray(snapshot.offers) ? snapshot.offers : [];
  return {
    slug: snapshot.product.slug,
    display_name: snapshot.product.display_name,
    category: snapshot.product.category,
    specs: snapshot.specs === null || snapshot.specs === undefined ? {} : snapshot.specs,
    offers: offers.map((row) => ({
      price: toNumberOrNull(row.price),
      currency: row.currency,
      offer_class: offerClassFor(row),
    })),
    price_status: priceStatusFor(offers),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Present one product's observations as a chart-ready series.
 *
 * ONE POINT PER OBSERVATION MOMENT, carrying that moment's CHEAPEST price. A
 * product can hold several offers (rtx-4060-8gb holds two, from two stores and
 * two variants), and both can be observed in the same sweep: serving them as two
 * consecutive points would draw a +50 % rise that never happened. Collapsing to
 * the cheapest price at each instant is the product-level reading the page
 * wants, and it is an aggregation of OBSERVED rows, not an interpolation - no
 * point is invented and no gap is filled.
 *
 * ASCENDING by `observed_at`: the statement returns newest-first so its LIMIT
 * cuts the OLDEST rows, and sorting here is what makes the series plottable and
 * makes "first -> last" mean before -> after.
 *
 * Thin data is REPORTED, never smoothed: `change_amount` / `change_pct` need
 * TWO observation MOMENTS, and with one the price, min and max are still served
 * - a single point is a fact, not a trend, and null is how this contract says
 * "no trend". A row whose NUMERIC price will not parse is dropped rather than
 * rendered as 0, which is the one number the catalog must never invent.
 *
 * @param {object} snapshot { product, points } from readPriceHistory
 * @param {string} currency the query's currency, echoed so a client can format
 * @returns {object} the response body
 */
function presentPriceHistory(snapshot, currency) {
  const rows = Array.isArray(snapshot.points) ? snapshot.points : [];
  const observed = rows
    .map((row) => ({
      observed_at: toIsoOrNull(row.observed_at),
      price: toNumberOrNull(row.price),
      offer_class: offerClassFor(row),
    }))
    .filter((point) => point.observed_at !== null && point.price !== null)
    // ISO-8601 strings sort lexicographically; the sort is stable, so equal
    // timestamps keep the repository's total order (observed_at DESC, id DESC,
    // reversed) and the cheapest-of-equals pick below stays deterministic.
    .sort((a, b) => (a.observed_at < b.observed_at ? -1 : a.observed_at > b.observed_at ? 1 : 0));

  const points = [];
  for (const point of observed) {
    const previous = points[points.length - 1];
    if (previous && previous.observed_at === point.observed_at) {
      // Same moment, two offers: the product's price then was its cheapest.
      if (point.price < previous.price) points[points.length - 1] = point;
    } else {
      points.push(point);
    }
  }

  const prices = points.map((point) => point.price);
  const first = points.length > 0 ? points[0].price : null;
  const last = points.length > 0 ? points[points.length - 1].price : null;
  const hasTrend = points.length >= 2;

  return {
    slug: snapshot.product.slug,
    currency,
    points,
    observation_count: points.length,
    latest_price: last,
    min_price: prices.length > 0 ? Math.min(...prices) : null,
    max_price: prices.length > 0 ? Math.max(...prices) : null,
    // Two decimals through the decimal STRING: subtracting money in binary
    // floating point is how a delta of 0.1 becomes 0.09999999999999998.
    change_amount: hasTrend ? Number((last - first).toFixed(2)) : null,
    change_pct: hasTrend && first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : null,
    disclaimer: DISCLAIMER,
  };
}

/** 422 body for a value the schema cannot range or enumerate. */
function fieldError(field, message) {
  return {
    error: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    details: [{ field, message }],
  };
}

/**
 * Parse `limit` from the raw querystring value.
 *
 * The querystring is a STRING because app.js runs with `coerceTypes: false`, so
 * the schema's pattern rejects non-digits and this function owns the RANGE. 0
 * and 1000 are both 422s, as the sprint's scenarios require, and both come with
 * the accepted range in the message so a client can correct itself.
 *
 * @param {string|undefined} raw the querystring value
 * @returns {{ok: true, limit: number} | {ok: false, body: object}}
 */
function parseLimit(raw) {
  if (raw === undefined) {
    return { ok: true, limit: DEFAULT_LIMIT };
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return {
      ok: false,
      body: fieldError('limit', 'limit must be an integer between 1 and ' + MAX_LIMIT),
    };
  }
  return { ok: true, limit: value };
}

function registerCatalogRoutes(app) {
  app.get('/v1/catalog/products', {
    config: { rateLimit: CATALOG_RATE_LIMIT },
    schema: {
      tags: ['catalog'],
      summary: 'Paginated ACTIVE product catalogue, keyset-ordered by slug',
      querystring: CatalogProductsQuerySchema,
      response: {
        200: CatalogListResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { role, cursor } = request.query;
    const parsedLimit = parseLimit(request.query.limit);
    if (!parsedLimit.ok) {
      return reply.code(422).send(parsedLimit.body);
    }

    // The role vocabulary is the ENGINE's (component_role), so it is checked
    // through the boundary rather than restated here. An unknown role is a 422
    // naming the accepted values: serving the whole catalogue instead would
    // silently answer a different question than the one asked.
    let category = null;
    if (role !== undefined) {
      category = app.engine.categoryForRole(role);
      if (category === null || category === undefined) {
        return reply.code(422).send(fieldError(
          'role',
          'role must be one of: ' + app.engine.catalogRoles().join(', ')
        ));
      }
    }

    const rows = await app.repo.selectCatalogProducts(app.pool, {
      category,
      cursor: cursor === undefined ? null : cursor,
      // One extra row: the only way to know a next page exists without a COUNT.
      limit: parsedLimit.limit + 1,
      currency: CATALOG_CURRENCY,
    });

    return reply.code(200).send(presentCatalogPage(rows, parsedLimit.limit));
  });

  app.get('/v1/catalog/products/:slug', {
    config: { rateLimit: CATALOG_RATE_LIMIT },
    schema: {
      tags: ['catalog'],
      summary: 'One ACTIVE catalogue product by slug: specs, priced offers, provenance',
      params: CatalogProductParamsSchema,
      response: {
        200: CatalogProductDetailSchema,
        404: ErrorResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const snapshot = await app.repo.readCatalogProduct(app.pool, {
      slug: request.params.slug,
      currency: CATALOG_CURRENCY,
    });
    if (!snapshot || !snapshot.found) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No product with that slug' });
    }
    return reply.code(200).send(presentCatalogProduct(snapshot));
  });

  app.get('/v1/catalog/products/:slug/price-history', {
    config: { rateLimit: CATALOG_RATE_LIMIT },
    schema: {
      tags: ['catalog'],
      summary: 'The observations behind one product price, oldest first (contract v1.6)',
      params: CatalogProductParamsSchema,
      response: {
        200: PriceHistoryResponseSchema,
        404: ErrorResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const snapshot = await app.repo.readPriceHistory(app.pool, {
      slug: request.params.slug,
      currency: CATALOG_CURRENCY,
      limit: PRICE_HISTORY_LIMIT,
    });
    if (!snapshot || !snapshot.found) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No product with that slug' });
    }
    return reply.code(200).send(presentPriceHistory(snapshot, CATALOG_CURRENCY));
  });
}

module.exports = {
  registerCatalogRoutes,
  presentCatalogPage,
  presentVariants,
  presentCatalogProduct,
  presentPriceHistory,
  offerClassFor,
  priceStatusFor,
  parseLimit,
  CATALOG_RATE_LIMIT,
  CATALOG_CURRENCY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PRICE_HISTORY_LIMIT,
};
