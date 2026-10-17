'use strict';

/**
 * apps/api/src/routes/catalog.js - the read-only catalog surface (Platform P2
 * Sprint 3, contract v1.5).
 *
 *   GET /v1/catalog/products?role=&limit=&cursor=
 *   GET /v1/catalog/products/:slug
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
  ErrorResponseSchema,
  DISCLAIMER,
} = require('../contracts');
const { toNumberOrNull } = require('./presets');

const CATALOG_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

/** Page size when the caller says nothing; the bound a caller may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
        slug: row.slug,
        display_name: row.display_name,
        category: row.category,
        from_price: fromPrice,
        offer_class: fromPrice === null ? null : row.offer_class,
        has_offer: fromPrice !== null,
      };
    }),
    next_cursor: hasMore ? page[page.length - 1].slug : null,
  };
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
}

module.exports = {
  registerCatalogRoutes,
  presentCatalogPage,
  presentCatalogProduct,
  offerClassFor,
  priceStatusFor,
  parseLimit,
  CATALOG_RATE_LIMIT,
  CATALOG_CURRENCY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
