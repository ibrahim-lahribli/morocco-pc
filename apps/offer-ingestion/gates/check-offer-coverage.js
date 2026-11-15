'use strict';

const { COVERAGE_ROLES, VERDICTS, exitCodeFor, formatReport, reasonOf } = require('../scripts/lib/offer-coverage');

/**
 * SQL: read only — eligibility = verified (ingestion_record_id not null),
 * in stock, within 30-day window, correct currency.
 */
const OFFER_SQL =
  'SELECT ' +
  '  s.id AS offer_id,' +
  '  s.ingestion_record_id,' +
  '  s.price,' +
  '  s.currency,' +
  '  s.availability,' +
  '  s.last_checked_at,' +
  '  p.id AS product_id,' +
  '  p.slug,' +
  '  p.name,' +
  '  p.manufacturer_part_number AS mpn,' +
  '  s.product_url,' +
  '  s.seller_name,' +
  '  st.id AS store_id,' +
  '  st.name AS store_name' +
  ' FROM store_offer s' +
  ' JOIN product p ON p.id = s.product_id' +
  ' JOIN store st ON st.id = s.store_id' +
  " WHERE s.last_checked_at IS NOT NULL AND s.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'";

function classifyRoleOffer(o, pid, pidata) {
  const currencyOk = String(o.currency).trim().toUpperCase() === 'MAD';
  if (!currencyOk) return null;

  const oos = String(o.availability).trim().toUpperCase() === 'OUT_OF_STOCK';
  if (oos) return null;

  const lca = o.last_checked_at == null ? null : new Date(o.last_checked_at);
  const boundary = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fresh = lca && lca.getTime() >= boundary.getTime();
  if (!fresh) return null;

  // product-keyed role (default for now)
  return 'CPU';
}

/**
 * Check per-role coverage of imported offers against catalogue identities.
 * @param {object} client - pg Client
 * @returns {Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[] }>}
 */
async function checkOfferCoverage(client) {
  const products = (await client.query(
    'SELECT id, slug, name, manufacturer_part_number AS mpn, ean_gtin, lifecycle_status FROM product WHERE lifecycle_status = $1',
    ['ACTIVE']
  )).rows;

  const productsMap = new Map();
  for (const p of products) {
    productsMap.set(String(p.id), {
      id: String(p.id),
      slug: String(p.slug),
      name: String(p.name),
      mpn: p.mpn || null,
      sku: p.sku || null,
    });
  }

  const offers = (await client.query(OFFER_SQL)).rows;

  // Count eligible VERIFIED offers per role
  const roleCounts = new Map();
  for (const r of COVERAGE_ROLES) {
    roleCounts.set(r, { active: 0, covered: 0, stores: new Set() });
  }

  let verifiedAnywhere = 0;

  for (const o of offers) {
    if (o.ingestion_record_id == null) continue;
    verifiedAnywhere += 1;

    const pidata = productsMap.get(String(o.product_id));
    if (!pidata) continue;

    const role = classifyRoleOffer(o, String(o.product_id), pidata);
    if (!role) continue;

    const rc = roleCounts.get(role);
    rc.active += 1;
    rc.covered += 1;
    rc.stores.add(String(o.store_id));
  }

  // Build verdicts per role
  const roleVerdicts = [];
  for (const r of COVERAGE_ROLES) {
    const { active, covered, stores } = roleCounts.get(r);
    const missing = Math.max(0, 5 - covered);
    const missingStores = Math.max(0, 2 - stores.size);
    let v = 'PASS';
    if (covered < 5 || stores.size < 2) v = 'FAIL';
    roleVerdicts.push({ role: r, active, covered, stores: stores.size || 0, verdict: v, missing, missingStores });
  }

  const failing = roleVerdicts.filter((rv) => rv.verdict === 'FAIL').map((rv) => rv.role);
  const verdict = verifiedAnywhere === 0 ? 'INCONCLUSIVE' : failing.length > 0 ? 'FAIL' : 'PASS';

  const details = [];
  details.push(`Roles: ${COVERAGE_ROLES.join(', ')}`);
  details.push(`Verified offers anywhere: ${verifiedAnywhere}`);
  for (const rv of roleVerdicts) {
    details.push(`  ${rv.role}: active=${rv.active} covered=${rv.covered} stores=${rv.stores} verdict=${rv.verdict} missing=${rv.missing} stores-missing=${rv.missingStores}`);
  }
  if (verdict === 'FAIL' && failing.length > 0) {
    details.push(`Roles below threshold: ${failing.join(', ')}`);
  }

  return { verdict, details };
}

module.exports = {
  checkOfferCoverage,
};
