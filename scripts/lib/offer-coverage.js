'use strict';

/**
 * scripts/lib/offer-coverage.js — per-role offer coverage: the pure half of
 * `check-offer-coverage.js` (no DB, no clock, no I/O).
 *
 * WHAT IT ANSWERS. "Can a build be assembled for this role TODAY?" is not the
 * same question as "does this product have an offer". Stage 1 only accepts an
 * offer that is VERIFIED (a real ingestion record), in stock, priced, in the
 * query's currency, and last checked inside the 30-day window — and the window
 * is NEVER waived for a VERIFIED offer (`offers/select.js`), while it IS waived
 * for seed rows when the caller passes `allow_unverified_seed_offers`. So a
 * catalog can hold 114 offers, 0 verified, and still assemble builds off seeds:
 * the shelf is warm and the evidence is not. This report separates the two.
 *
 * THE IDENTITY IS THE ENGINE'S, NOT THE PRODUCT'S. A coverage count is only
 * meaningful if it counts the things Stage 1 can select, and those are
 * CANDIDATE identities: `candidates/loader.js` gives a GPU candidate
 * `product_variant_id = pv.id` (a GPU candidate always carries a variant) and
 * every other role a NULL variant, while `offers/select.js`
 * `candidateMatchesOffer()` accepts an offer only on an exact
 * `(product_id, product_variant_id)` match. So a GPU offer with a NULL variant,
 * a GPU offer for a DIFFERENT variant, and a variant-keyed offer on a non-GPU
 * product are all unselectable, and none of them may be counted.
 *
 * `buildCoverage()` therefore keys its counts on `(role, product_id,
 * product_variant_id)` and ignores an offer whose identity is not in the ACTIVE
 * catalog for that role - the same restriction the SQL join applies, so a
 * caller that hands over unfiltered rows still gets the engine's answer.
 *
 * The three per-role counts are deliberately NOT one number:
 *   - active_products  — the catalog's breadth in that role, in candidate
 *                        identities (a GPU product with two variants is two);
 *   - covered_products — identities with >= 1 eligible VERIFIED offer (what a
 *                        build can actually reach on evidence);
 *   - covered_stores   — distinct stores behind them. One storefront with five
 *                        listings is one supply chain, not five.
 *
 * THE VERDICT VOCABULARY is the repo's, not a new one: PASS, FAIL, INCONCLUSIVE.
 * INCONCLUSIVE is reserved for "zero VERIFIED offers anywhere in the catalog" —
 * a seed-only catalog cannot fail a verification threshold, it has no verified
 * evidence to count, and saying FAIL there would read as a coverage regression
 * rather than as the provenance gap it is (R-01).
 *
 * Read-only: the caller runs SQL; this module only classifies and formats.
 */

/** The eight roles a build expands into (`candidates/roles.js` EXPANSION_ORDER). */
const COVERAGE_ROLES = Object.freeze([
  'CPU',
  'GPU',
  'MOTHERBOARD',
  'RAM',
  'SSD_BOOT',
  'PSU',
  'CASE',
  'CPU_COOLER',
]);

const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

const DEFAULTS = Object.freeze({ minProducts: 5, minStores: 2, currency: 'MAD', windowDays: 30 });

/**
 * @typedef {object} CoverageInput
 * @property {Array<{product_id: string, product_variant_id?: string|null, role: string}>} products
 *   ACTIVE candidates, one row per (product, variant, role): GPU rows carry the
 *   variant that owns `gpu_board_spec`, the other seven roles carry NULL.
 * @property {Array<{product_id: string, product_variant_id?: string|null, store_id: string, role: string}>} offers
 *   ELIGIBLE VERIFIED offers only (in stock, priced, in currency, inside the
 *   window), one row per offer, carrying the offer's own variant id.
 * @property {number} minProducts products with an eligible offer needed per role
 * @property {number} minStores distinct stores needed per role
 * @property {number} verifiedOffersAnywhere every VERIFIED offer in the catalog,
 *   regardless of stock/currency/window — this is what makes a report
 *   INCONCLUSIVE rather than FAIL
 */

/**
 * Build the report. Deterministic: roles in COVERAGE_ROLES order, no clock read.
 *
 * @param {CoverageInput} input
 * @returns {{roles: Array<{role: string, active_products: number,
 *   covered_products: number, covered_stores: number, verdict: string,
 *   missing_products: number, missing_stores: number}>,
 *   verdict: string, minProducts: number, minStores: number,
 *   verified_offers_anywhere: number, eligible_offers: number,
 *   active_products: number, covered_products: number,
 *   unbalanced_roles: string[]}}
 */
function buildCoverage(input) {
  const products = Array.isArray(input && input.products) ? input.products : [];
  const offers = Array.isArray(input && input.offers) ? input.offers : [];
  const minProducts = positiveInt(input && input.minProducts, DEFAULTS.minProducts, 'minProducts');
  const minStores = positiveInt(input && input.minStores, DEFAULTS.minStores, 'minStores');
  const verifiedAnywhere = nonNegativeInt(input && input.verifiedOffersAnywhere, 0);

  const activeByRole = new Map();
  const activeIdentitiesByRole = new Map();
  for (const row of products) {
    if (!row || !COVERAGE_ROLES.includes(row.role)) continue;
    activeByRole.set(row.role, (activeByRole.get(row.role) || 0) + 1);
    const identities = activeIdentitiesByRole.get(row.role) || new Set();
    identities.add(candidateIdentity(row.product_id, row.product_variant_id));
    activeIdentitiesByRole.set(row.role, identities);
  }

  // One pass: which candidate identities have an eligible offer, and which
  // stores stand behind the role. A repeated offer row must not count twice, and
  // an offer the engine could never match (wrong or missing variant) is not
  // counted at all - same rule as the SQL join in check-offer-coverage.js.
  const coveredByRole = new Map();
  const storesByRole = new Map();
  for (const offer of offers) {
    if (!offer || offer.product_id === undefined || offer.product_id === null) continue;
    const role = offer.role;
    if (!COVERAGE_ROLES.includes(role)) continue;
    const identity = candidateIdentity(offer.product_id, offer.product_variant_id);
    const selectable = (activeIdentitiesByRole.get(role) || new Set()).has(identity);
    if (!selectable) continue;
    const identitiesInRole = coveredByRole.get(role) || new Set();
    identitiesInRole.add(identity);
    coveredByRole.set(role, identitiesInRole);
    const stores = storesByRole.get(role) || new Set();
    if (offer.store_id !== undefined && offer.store_id !== null) stores.add(String(offer.store_id));
    storesByRole.set(role, stores);
  }

  const roles = COVERAGE_ROLES.map((role) => {
    const active = activeByRole.get(role) || 0;
    const covered = (coveredByRole.get(role) || new Set()).size;
    const stores = (storesByRole.get(role) || new Set()).size;
    const missingProducts = Math.max(0, minProducts - covered);
    const missingStores = Math.max(0, minStores - stores);
    // A role with no ACTIVE product at all is a catalog gap, not a threshold
    // miss: it fails on either reading, and the reason list says which.
    const verdict = missingProducts === 0 && missingStores === 0 ? VERDICTS.PASS : VERDICTS.FAIL;
    return {
      role,
      active_products: active,
      covered_products: covered,
      covered_stores: stores,
      verdict,
      missing_products: missingProducts,
      missing_stores: missingStores,
    };
  });

  const totals = {
    active_products: roles.reduce((sum, row) => sum + row.active_products, 0),
    covered_products: roles.reduce((sum, row) => sum + row.covered_products, 0),
    eligible_offers: offers.length,
  };

  let verdict;
  if (verifiedAnywhere === 0) {
    // Not a threshold failure: there is nothing verified to count.
    verdict = VERDICTS.INCONCLUSIVE;
  } else {
    verdict = roles.every((row) => row.verdict === VERDICTS.PASS) ? VERDICTS.PASS : VERDICTS.FAIL;
  }

  return {
    roles,
    verdict,
    minProducts,
    minStores,
    verified_offers_anywhere: verifiedAnywhere,
    eligible_offers: totals.eligible_offers,
    active_products: totals.active_products,
    covered_products: totals.covered_products,
    unbalanced_roles: roles.filter((row) => row.active_products > 0 && row.covered_products === 0).map((row) => row.role),
  };
}

/**
 * The engine's applicability key: a NULL variant is its own identity (a
 * product-keyed candidate), never a wildcard.
 */
function candidateIdentity(productId, variantId) {
  const product = String(productId);
  const variant = variantId === null || variantId === undefined ? '' : String(variantId);
  return product + '|' + variant;
}

function positiveInt(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(name + ' must be a non-negative integer');
  }
  return value === 0 ? 0 : value;
}

function nonNegativeInt(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

/**
 * The exit code the CLI should use. `--strict` escalates FAIL only: a PASS is 0
 * and INCONCLUSIVE stays 0, because "nothing verified to count" is not a
 * regression (R-01 owns it) and a gate that exits 1 there cannot be wired in
 * without turning a seed catalog into a permanent red build.
 *
 * @param {ReturnType<typeof buildCoverage>} report
 * @param {{strict?: boolean}} [options]
 * @returns {0|1}
 */
function exitCodeFor(report, options) {
  const strict = Boolean(options && options.strict);
  return strict && report.verdict === VERDICTS.FAIL ? 1 : 0;
}

/** Per-role reason, so a FAIL row is actionable rather than just red. */
function reasonOf(row) {
  const reasons = [];
  if (row.active_products === 0) reasons.push('no ACTIVE product in the catalog');
  if (row.missing_products > 0) reasons.push('needs ' + row.missing_products + ' more candidate(s) with an eligible VERIFIED offer');
  if (row.missing_stores > 0) reasons.push('needs ' + row.missing_stores + ' more distinct store(s)');
  return reasons.join('; ');
}

/**
 * Render the report as lines (no I/O, so a test can pin the wording).
 *
 * @param {ReturnType<typeof buildCoverage>} report
 * @param {{asOf: Date, windowDays: number, currency: string, label: string}} context
 * @returns {string[]}
 */
function formatReport(report, context) {
  const windowDays = context && context.windowDays ? context.windowDays : DEFAULTS.windowDays;
  const currency = context && context.currency ? context.currency : DEFAULTS.currency;
  const boundary = new Date(context.asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const lines = [];

  lines.push('Per-role offer coverage (read-only; eligible VERIFIED, ' + currency + ', in stock, ' + windowDays + '-day window)');
  lines.push('Counted identity: (product, variant) for GPU; product only (NULL variant) for the other roles');
  lines.push('Target: ' + context.label);
  lines.push('As of: ' + context.asOf.toISOString() + ' | window starts ' + boundary.toISOString());
  lines.push('Thresholds: >= ' + report.minProducts + ' candidate(s) and >= ' + report.minStores + ' distinct store(s) per role');
  lines.push('');
  lines.push('  role          active  covered  stores  verdict');
  for (const row of report.roles) {
    lines.push(
      '  ' + row.role.padEnd(12)
      + String(row.active_products).padStart(6)
      + String(row.covered_products).padStart(9)
      + String(row.covered_stores).padStart(8)
      + '  ' + row.verdict
      + (row.verdict === VERDICTS.PASS ? '' : '  (' + reasonOf(row) + ')')
    );
  }
  lines.push('');
  lines.push(
    'VERIFIED offers anywhere in the catalog: ' + report.verified_offers_anywhere
    + ' | eligible right now: ' + report.eligible_offers
    + ' | ACTIVE products in scope: ' + report.active_products
  );
  lines.push('RESULT: ' + report.verdict);

  if (report.verdict === VERDICTS.INCONCLUSIVE) {
    lines.push(
      'NOT a coverage verdict: the catalog holds ZERO VERIFIED offers, so no role can be'
      + ' counted on evidence. Builds may still assemble from seed offers (the API passes'
      + ' allow_unverified_seed_offers), which is a provenance gap (R-01), not coverage.'
    );
  } else if (report.verdict === VERDICTS.FAIL) {
    const failing = report.roles.filter((row) => row.verdict === VERDICTS.FAIL).map((row) => row.role);
    lines.push('Roles below threshold: ' + failing.join(', '));
    if (report.unbalanced_roles.length > 0) {
      lines.push(
        'Roles with ACTIVE products but NO eligible VERIFIED offer: ' + report.unbalanced_roles.join(', ')
        + ' (a build for them can only come from a seed offer)'
      );
    }
  }
  return lines;
}

module.exports = {
  COVERAGE_ROLES,
  DEFAULTS,
  VERDICTS,
  buildCoverage,
  exitCodeFor,
  formatReport,
  reasonOf,
};
