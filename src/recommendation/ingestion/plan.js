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
 * Rejected rows come from validation, not from the plan.
 */

'use strict';

const { matchListing } = require('./matching');
const { decidePromotion } = require('./promotion');

const STORES_SQL = 'SELECT id, name FROM store WHERE is_active = TRUE ORDER BY name ASC';

const CATALOG_SQL = [
  'SELECT p.id AS product_id, p.name AS name, p.manufacturer_part_number AS mpn,',
  '       NULL::uuid AS product_variant_id, NULL::text AS sku',
  '  FROM product p',
  " WHERE p.lifecycle_status = 'ACTIVE'",
  ' UNION ALL',
  'SELECT p.id AS product_id, p.name AS name, p.manufacturer_part_number AS mpn,',
  '       pv.id AS product_variant_id, pv.sku AS sku',
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

    const match = matchListing(listing, context.catalog);
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
  planCounts,
  formatPlan,
};
