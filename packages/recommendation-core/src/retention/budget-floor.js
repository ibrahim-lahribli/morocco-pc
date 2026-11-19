/**
 * Decision 27 - Budget floor diagnostic: why a pass assembled no builds.
 *
 * Boundary: pure composition over already-loaded, already-validated data. It
 * owns no policy, no SQL, no clock and no I/O (the retention/ convention). The
 * orchestrator calls it once per pass, ALWAYS - a diagnostic that appears only
 * on failure is a diagnostic nobody reads.
 *
 *   retention output { results: [retained verdict, ...] }
 *   Engine 2 Stage 1 price carrier { priceKey: { selected_price, ... } }
 *   query budget_amount + currency
 *         |  computeBudgetFloor(...)
 *         |    - cheapest retained selected_price per component_role
 *         |    - cheapest_total over BUDGET_FLOOR_ROLES
 *         |    - missing_roles: a required role with nothing retained
 *         |    - within_budget: cheapest_total <= budget_amount
 *         v
 *   frozen { cheapest_total, currency, budget_amount, within_budget,
 *            cheapest_by_role, missing_roles }
 *
 * Why this exists: Decision 17.2 makes "zero builds is a valid outcome" part of
 * the contract, which is right - but it left THREE materially different causes
 * indistinguishable in `builds: []`: nothing retained fits the budget, pairwise
 * incompatibility inside assembly, and a required role with no surviving
 * candidate. This module answers the budget question for one pass, from data
 * the pass already has. It does NOT answer the incompatibility question; that is
 * OG-04 (rejection-reason persistence), which stays open, and nothing here
 * should be cited as closing it.
 *
 * Two semantics are load-bearing:
 *
 *   - BUDGET_FLOOR_ROLES excludes GPU. The Step 3 GPU policy makes the GPU
 *     omissible under OPTIONAL, so including its price would overstate the floor
 *     and report "unaffordable" for a build that is in fact serviceable without
 *     a discrete GPU. cheapest_by_role still REPORTS the GPU price when one is
 *     retained, so a caller that needs the with-GPU total can add it back.
 *
 *   - A missing required role yields cheapest_total = null and within_budget =
 *     null, NEVER 0. This is the project's standing NULL != 0 rule applied to a
 *     new field: a 0 total would read as "everything is free", and
 *     `0 <= budget_amount` would read as "comfortably affordable". An unknown
 *     floor is an unknown floor.
 *
 * The floor is a FLOOR, not a promise of a build. It is the cheapest total the
 * retained pool could form if every role's cheapest pick were pairwise
 * compatible - which Engine 3's Decision 16 gate may still abandon. So
 * `within_budget === true` alongside zero builds is a legitimate, expected
 * state, and is pinned by budget-floor.test.js.
 *
 * Explicit NON-responsibilities:
 *   - no database access, no connection, no SQL, no I/O
 *   - no compatibility evaluation and no verdict aggregation (Engine 2D)
 *   - no scoring and no score arithmetic (Engine 4)
 *   - no assembly, no traversal, no budget pruning (Engine 3)
 *   - no build ranking (Engine 5) and no explanation text (Engine 6): this
 *     returns data, it does not render it
 *   - no persistence, and no new error code - the Engine 2
 *     CandidateSelectionError / ERROR_CODES vocabulary is reused unchanged
 *   - it does not re-validate the carrier: Stage 1 already did, and the
 *     per-entry check here is the same one retention applies, deliberately
 *     duplicated rather than shared, because a shared helper would pull
 *     retention/ into a second export surface
 *
 * Determinism: no clock reads, no randomness, no I/O; cheapest_by_role is
 * emitted in canonical COMPONENT_ROLES order and missing_roles in
 * BUDGET_FLOOR_ROLES order, so identical inputs yield deeply equal output.
 *
 * Pure: no database access, no framework.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { COMPONENT_ROLES } = require('../candidates/roles');
// Decision 27 item 3, the same single permitted Engine 3 import retention/ uses:
// a pure key constructor, so the carrier key format keeps exactly one owner.
const { priceKey } = require('../assembly/prices');

/**
 * The roles a floor is computed over: EXPANSION_ORDER minus GPU.
 *
 * Pinned against the real EXPANSION_ORDER by a test, so a future change to the
 * assembly order cannot silently make this list wrong.
 */
const BUDGET_FLOOR_ROLES = Object.freeze([
  'CPU',
  'MOTHERBOARD',
  'RAM',
  'PSU',
  'CASE',
  'CPU_COOLER',
  'SSD_BOOT',
]);

/** 3-letter uppercase code, no trim, no folding (mirrors prices.js). */
const CURRENCY_RE = /^[A-Z]{3}$/;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Small private recursive freezer; no shared utility module is created. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  Object.freeze(value);
  return value;
}

/**
 * The Stage 1 selected_price for one retained verdict, or a fail-fast.
 *
 * Identical in contract to retention/priceOf: a missing entry and a non-finite
 * selected_price are the same defect (the price is UNKNOWN) and are reported the
 * same way, on the existing field, in the existing vocabulary. Neither is ever
 * coerced to 0.
 */
function priceOf(prices, verdict) {
  const key = priceKey(verdict.product_id, verdict.product_variant_id, verdict.component_role);
  const entry = Object.prototype.hasOwnProperty.call(prices, key) ? prices[key] : undefined;
  if (entry === undefined || typeof entry !== 'object'
      || typeof entry.selected_price !== 'number'
      || !Number.isFinite(entry.selected_price)) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'prices',
      `"prices" has no usable selected_price for the retained candidate ${key} - the budget floor cannot be computed, and a missing price is never read as 0`
    );
  }
  return entry.selected_price;
}

/**
 * Compute the budget floor for one pass: the cheapest total the retained pool
 * could form, and whether the query budget can afford it.
 *
 * @param {object} sources single argument object carrying:
 *        - retained: the retention output's results array
 *          (retainTopKPerRole's { results })
 *        - prices: the Engine 2 Stage 1 price carrier, the same frozen
 *          null-prototype object retention and Engine 3 receive
 *        - budgetAmount: the query's budget_amount, a finite number > 0
 *        - currency: the query's currency, a 3-letter uppercase code
 * @returns {object} frozen {
 *          cheapest_total, currency, budget_amount, within_budget,
 *          cheapest_by_role, missing_roles
 *        } - all six fields always present. cheapest_total and within_budget
 *        are null (never 0 / never true) when missing_roles is non-empty.
 * @throws {CandidateSelectionError} the Engine 2 vocabulary, on a
 *        missing/malformed source or a retained candidate the carrier cannot
 *        price
 */
function computeBudgetFloor(sources) {
  if (sources === undefined || sources === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      null,
      'The budget floor requires a sources object'
    );
  }
  if (!isPlainObject(sources)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'The budget floor requires an object carrying retained, prices, budgetAmount and currency'
    );
  }

  const { retained, prices, budgetAmount, currency } = sources;

  // --- light gates (fail fast, before any work; existing vocabulary) ---------
  if (!Array.isArray(retained)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'retained',
      '"retained" must be the retention output results array'
    );
  }
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'prices',
      '"prices" must be the Engine 2 Stage 1 price carrier (a null-prototype object keyed by priceKey)'
    );
  }
  if (
    typeof budgetAmount !== 'number'
    || !Number.isFinite(budgetAmount)
    || budgetAmount <= 0
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budgetAmount',
      '"budgetAmount" must be a finite number greater than 0 (recommendation_query.budget_amount)'
    );
  }
  if (typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'currency',
      '"currency" must be a 3-letter uppercase code (recommendation_query.currency)'
    );
  }

  // --- cheapest retained price per role ------------------------------------
  // Null-prototype, like the Stage 1 carrier it mirrors, so a role named
  // "constructor" or "__proto__" cannot collide with an inherited property.
  const cheapestByRole = Object.create(null);
  for (const verdict of retained) {
    if (verdict === null || typeof verdict !== 'object' || Array.isArray(verdict)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'retained',
        '"retained" entries must be Engine 2D candidate verdicts'
      );
    }
    if (typeof verdict.component_role !== 'string') {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'retained',
        '"retained" entries must carry a string component_role'
      );
    }
    const price = priceOf(prices, verdict);
    const current = cheapestByRole[verdict.component_role];
    if (current === undefined || price < current) {
      cheapestByRole[verdict.component_role] = price;
    }
  }

  // --- the required-role verdict --------------------------------------------
  const missingRoles = [];
  for (const role of BUDGET_FLOOR_ROLES) {
    if (cheapestByRole[role] === undefined) {
      missingRoles.push(role);
    }
  }

  // An unknown floor is an unknown floor: null, never 0.
  const complete = missingRoles.length === 0;
  let cheapestTotal = null;
  if (complete) {
    let total = 0;
    for (const role of BUDGET_FLOOR_ROLES) {
      total += cheapestByRole[role];
    }
    cheapestTotal = total;
  }

  return deepFreeze({
    cheapest_total: cheapestTotal,
    currency,
    budget_amount: budgetAmount,
    within_budget: cheapestTotal === null ? null : cheapestTotal <= budgetAmount,
    // Canonical COMPONENT_ROLES order first, then any foreign role in first-
    // encounter order, so the emitted object is stable across input orderings.
    cheapest_by_role: emitInRoleOrder(cheapestByRole),
    missing_roles: Object.freeze(missingRoles),
  });
}

/**
 * Rebuild the null-prototype cheapest map in canonical order, freezing each
 * entry's value by reference. Exported shape is a plain data object; the
 * ordering is what makes two equal floors compare equal.
 */
function emitInRoleOrder(cheapestByRole) {
  const out = Object.create(null);
  const emitted = new Set();
  for (const role of COMPONENT_ROLES) {
    if (Object.prototype.hasOwnProperty.call(cheapestByRole, role)) {
      out[role] = cheapestByRole[role];
      emitted.add(role);
    }
  }
  for (const role of Object.keys(cheapestByRole)) {
    if (!emitted.has(role)) {
      out[role] = cheapestByRole[role];
    }
  }
  return out;
}

module.exports = { BUDGET_FLOOR_ROLES, computeBudgetFloor };
