/**
 * Ingestion — plan building and reporting.
 *
 * Boundary: `gatherContext` is the ONLY DB reader here (SELECTs against the
 * existing catalog and offers); `buildPlan` and `formatPlan` are PURE, so the
 * classification logic is unit-testable without a database.
 *
 * The plan classifies every validated listing into exactly one bucket:
 *   newOffers    no stored offer for (store_id, listing_identifier) -> INSERT
 *   changed      stored offer and price/availability differ          -> UPDATE + history
 *   unchanged    stored offer, nothing changed                      -> NO writes
 *   review       ambiguous match                                     -> review queue
 *   unmatched    no match at all                                     -> review queue
 *   rejected     an unusable row (unknown store, or a curated identity
 *                key that cannot be resolved)                       -> reported, never written
 */

'use strict';

const { matchListing } = require('./matching');
const { decidePromotion } = require('./promotion');

const STORES_SQL = 'SELECT id, name FROM store WHERE is_active = TRUE ORDER BY name ASC';

const CATALOG_SQL = [
  'SELECT p.id AS product_id, p.name AS name, p.manufacturer_part_number AS mpn,',
  '       p.slug AS product_slug, NULL::uuid AS product_variant_id, NULL::text AS sku',
  '  FROM product p',
  " WHERE p.lifecycle_status = 'ACTIVE'",
  ' UNION ALL',
  'SELECT p.id AS product_id, p.name AS name, p.manufacturer_part_number AS mpn,',
  '       p.slug AS product_slug, pv.id AS product_variant_id, pv.sku AS sku',
  '  FROM product p',
  '  JOIN product_variant pv ON pv.product_id = p.id',
  " WHERE p.lifecycle_status = 'ACTIVE'",
].join('\n');

const EXISTING_OFFERS_SQL = [
  'SELECT id, store_id, listing_identifier, price, availability',
  '  FROM store_offer',
  ' WHERE listing_identifier = ANY($1::text[])',
].join('\n');

async function rows(db, sql, params) {
  const result = await db.query(sql, params || []);
  return result && Array.isArray(result.rows) ? result.rows : [];
}

/** Load active stores as a name -> id map plus the raw set of names. */
async function loadStores(db) {
  const byName = new Map();
  for (const row of await rows(db, STORES_SQL)) {
    byName.set(String(row.name), String(row.id));
  }
  return byName;
}

function offerKey(storeId, listingIdentifier) {
  return String(storeId) + '\u0000' + String(listingIdentifier);
}

/**
 * Resolve operator-supplied catalogue keys to exactly ONE catalogue entry.
 *
 * A slug names a PRODUCT; a variant_sku names one of its VARIANTS. Both are
 * needed for a variant-keyed part, and the reason is mechanical rather than
 * stylistic: `offers/select.js` matches a GPU candidate ONLY against an offer
 * carrying the same `product_variant_id`, so a product-keyed GPU offer can never
 * be selected by the engine. Writing one would look like a success and be a
 * silent no-op, which is why a slug whose product HAS variants is refused
 * without a `variant_sku` instead.
 *
 * Nothing here guesses: an unknown slug or sku is a REJECTION with its own
 * reason, so the operator sees the typo.
 *
 * @param {object} listing validated listing (needs product_slug, variant_sku)
 * @param {Array<object>} catalog entries from CATALOG_SQL
 * @returns {{entry:object}|{reason:string}}
 */
function resolveCatalogueKey(listing, catalog) {
  const slug = listing.product_slug;
  const entries = catalog.filter((e) => e.product_slug && e.product_slug === slug);
  if (entries.length === 0) return { reason: 'UNKNOWN_PRODUCT_SLUG' };

  const variantRows = entries.filter((e) => e.product_variant_id !== null);
  const productRow = entries.find((e) => e.product_variant_id === null) || null;

  if (listing.variant_sku) {
    const wanted = String(listing.variant_sku).trim();
    const hits = variantRows.filter((e) => e.sku && String(e.sku).trim() === wanted);
    // A sku identifies one variant; more than one row is a catalogue defect, not
    // a choice this function is allowed to make.
    if (hits.length === 0) return { reason: 'UNKNOWN_VARIANT_SKU' };
    if (hits.length > 1) return { reason: 'VARIANT_SKU_AMBIGUOUS' };
    return { entry: hits[0] };
  }

  if (variantRows.length > 0) return { reason: 'VARIANT_SKU_REQUIRED' };
  if (productRow === null) return { reason: 'UNKNOWN_PRODUCT_SLUG' };
  return { entry: productRow };
}

/**
 * Read the catalog and any offers already stored for these listings' keys.
 * @returns {Promise<{storesByName:Map, catalog:Array, existingByKey:Map}>}
 */
async function gatherContext(db, listings, storesByName) {
  const catalog = await rows(db, CATALOG_SQL);
  const identifiers = [...new Set(listings.map((l) => l.listing_identifier))];
  const existingByKey = new Map();
  if (identifiers.length > 0) {
    for (const row of await rows(db, EXISTING_OFFERS_SQL, [identifiers])) {
      existingByKey.set(offerKey(row.store_id, row.listing_identifier), {
        id: String(row.id),
        price: row.price,
        availability: row.availability,
      });
    }
  }
  return { storesByName, catalog, existingByKey };
}

/**
 * Pure classification.
 * @param {Array<object>} listings validated listings
 * @param {{storesByName:Map, catalog:Array, existingByKey:Map}} context
 * @returns {{ newOffers:Array, changed:Array, unchanged:Array, review:Array, unmatched:Array, rejected:Array }}
 */
function buildPlan(listings, context) {
  const plan = { newOffers: [], changed: [], unchanged: [], review: [], unmatched: [], rejected: [] };

  for (const listing of listings) {
    const storeId = context.storesByName.get(listing.store_name);
    if (!storeId) {
      plan.rejected.push({ listing, reason: 'UNKNOWN_STORE' });
      continue;
    }

    // A variant sku names a VARIANT OF a product, so it means nothing on its own.
    // Ignoring it would let a row whose operator explicitly said which variant they
    // meant fall back to name/SKU inference, which is exactly the guess this tier
    // exists to replace. Refuse the half-specified key instead.
    if (!listing.product_slug && listing.variant_sku) {
      plan.rejected.push({ listing, reason: 'VARIANT_SKU_WITHOUT_SLUG' });
      continue;
    }

    let match;
    if (listing.product_slug) {
      const resolved = resolveCatalogueKey(listing, context.catalog);
      if (resolved.reason) {
        plan.rejected.push({ listing, reason: resolved.reason });
        continue;
      }
      match = matchListing(listing, context.catalog, resolved.entry);
    } else {
      match = matchListing(listing, context.catalog);
    }
    if (match.status === 'REVIEW') {
      plan.review.push({ listing, store_id: storeId, match });
      continue;
    }
    if (match.status === 'UNMATCHED') {
      plan.unmatched.push({ listing, store_id: storeId, match });
      continue;
    }

    const existing = context.existingByKey.get(offerKey(storeId, listing.listing_identifier)) || null;
    const promotion = decidePromotion(listing, existing);
    const item = { listing, store_id: storeId, match, promotion, existing };
    if (promotion.action === 'INSERT') plan.newOffers.push(item);
    else if (promotion.action === 'UPDATE') plan.changed.push(item);
    else plan.unchanged.push(item);
  }

  return plan;
}

function planCounts(plan, invalid) {
  return {
    new: plan.newOffers.length,
    changed: plan.changed.length,
    unchanged: plan.unchanged.length,
    unmatched: plan.unmatched.length,
    ambiguous: plan.review.length,
    rejected: (invalid ? invalid.length : 0) + plan.rejected.length,
  };
}

function row(line, tag, listing, extra) {
  const id = listing ? listing.listing_identifier : '?';
  const price = listing ? listing.price : '?';
  return '  [' + tag + '] line ' + line + ' ' + id + ' ' + price + ' MAD' + (extra ? ' ' + extra : '');
}

/**
 * Human-readable diff. Counts first, then one line per classified row.
 * @param {object} plan
 * @param {Array<{line:number, errors:Array}>} [invalid]
 */
function formatPlan(plan, invalid) {
  const counts = planCounts(plan, invalid);
  const lines = [];
  lines.push('Ingestion plan (' + (plan.mode || 'dry-run') + ')');
  lines.push('  new:       ' + counts.new);
  lines.push('  changed:   ' + counts.changed);
  lines.push('  unchanged: ' + counts.unchanged);
  lines.push('  unmatched: ' + counts.unmatched);
  lines.push('  ambiguous: ' + counts.ambiguous);
  lines.push('  rejected:  ' + counts.rejected);
  lines.push('Per-row detail:');

  for (const item of plan.newOffers) {
    lines.push(row(item.listing.line, 'NEW', item.listing, '-> ' + item.match.reason));
  }
  for (const item of plan.changed) {
    lines.push(row(item.listing.line, 'CHANGED', item.listing, '(' + item.promotion.changedFields.join(',') + ')'));
  }
  for (const item of plan.unchanged) {
    lines.push(row(item.listing.line, 'UNCHANGED', item.listing, ''));
  }
  for (const item of plan.unmatched) {
    lines.push(row(item.listing.line, 'UNMATCHED', item.listing, '-> review'));
  }
  for (const item of plan.review) {
    lines.push(row(item.listing.line, 'AMBIGUOUS', item.listing, '-> review (' + item.match.reason + ')'));
  }
  for (const item of plan.rejected) {
    lines.push(row(item.listing.raw_price !== undefined ? item.listing.line : '?', 'REJECTED', item.listing, item.reason));
  }
  for (const bad of (invalid || [])) {
    lines.push('  [REJECTED] line ' + bad.line + ' ' + bad.errors.map((e) => e.field + ':' + e.reason).join(','));
  }
  return lines.join('\n');
}

module.exports = {
  STORES_SQL,
  CATALOG_SQL,
  EXISTING_OFFERS_SQL,
  loadStores,
  gatherContext,
  buildPlan,
  resolveCatalogueKey,
  planCounts,
  formatPlan,
};
