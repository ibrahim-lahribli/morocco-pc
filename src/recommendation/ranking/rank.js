'use strict';

const { EXPANSION_ORDER } = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** Engine 5a - pure build ranking (Decision 18).
 *
 * Boundary (Decision 18.1): an in-memory ranking stage that orders Engine 3's
 * already-assembled, already-pair-validated builds (each carrying a build_score
 * from Engine 4 STEP 3) and produces the persistable top-N. Pure: no database
 * access, no I/O, no clock reads, no randomness.
 *
 *   frozen Engine 3 builds (discovery order) + build_score, total_price,
 *   currency, unknown_pairwise_count per build
 *         |  validateBuilds       - fail-fast structure / field contract
 *         |  round2 + signature   - canonical comparison keys
 *         |  sort + rank 1..n     - score DESC, price ASC, signature ASC
 *         v
 *   frozen { ranked, top_n }        - ranked = ALL builds; top_n = top min(n, N)
 *
 * Field sourcing (no invention - one owner per field):
 *   build            the ORIGINAL frozen Engine 3 build object, by reference
 *                      (not cloned, not field-edited); ranking adds nothing to it
 *   build_score      Engine 4 STEP 3 computeBuildScores, rounded to 2 dp
 *   total_price      Engine 3 price sum, rounded to 2 dp
 *   currency         Engine 2A / Stage 1 currency, carried through verbatim
 *   unknown_pairwise_count  Engine 3 sum (Decision 15 producer chain)
 *   compatibility_status   G1-gated (Decision 18.5): UNKNOWN when the build
 *                      carries any UNKNOWN verdict or unknown_pairwise_count>0,
 *                      else PASS. Computed here; assemble.js emits no build-level
 *                      status. Never emits any other value.
 *   signature        content signature over EXPANSION_ORDER roles in
 *                      `ROLE:product_id:variant_or_empty` form (Decision 18.4)
 *   explanation      reserved for Engine 6: ALWAYS null in 5a (Decision 18.7 /
 *                      Decision 19.5 `explanation` NULL until Engine 6)
 *
 * Explicit NON-responsibilities (deliberately absent):
 *   - no database access, no connection, no SQL, no persistence (Engine 5b)
 *   - no Engine 3 assembly work (assembly/)
 *   - no Engine 4 scoring arithmetic (scoring/)
 *   - no orchestration (orchestrator/)
 *   - no new error vocabulary: the existing CandidateSelectionError /
 *     ERROR_CODES contract is reused; duplicate-signature is reported through a
 *     clearly-named INVALID_FIELD_VALUE failure on field `builds`
  *   - no mutation of inputs (builds are sealed by reference; new entry objects
 *     are built and frozen)
 */

const SIGNATURE_SEPARATOR = '|';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}


/**
 * Round to 2 decimals, half-up on the shortest decimal representation
 * (Decision 18.3). The string-exponent technique shifts the decimal point in
 * the value's own shortest string form, so the half-up boundary is evaluated
 * at the value's native precision instead of a binary-float artifact (e.g.
 * `Math.round(1.005 * 100)` yields 100 because 1.005 is stored as
 * 1.00499999...; the string "1.005" shifts cleanly to "100.5" -> 101). The
 * exponential fallback (`Math.round(x * 100) / 100`) covers any value whose
 * string form uses scientific notation, where shifting the decimal point is
 * not directly applicable.
 *
 * Examples (decision-addendum): 1.005 -> 1.01, 2.675 -> 2.68, 0.5 -> 0.5,
 * 87.4999 -> 87.5, 87.494 -> 87.49, integers unchanged.
 */
function round2(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'value',
      '"round2" requires a finite number'
    );
  }
  const text = String(value);
  if (text.includes('e') || text.includes('E')) {
    // Scientific notation: string-exponent technique is inapplicable, fall
    // back to the documented guard.
    return Math.round(value * 100) / 100;
  }

  // --- String-exponent: shift the decimal point two places right, round ---
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;

  let dot = unsigned.indexOf('.');
  let intPart;
  let fracPart;
  if (dot === -1) {
    intPart = unsigned;
    fracPart = '';
  } else {
    intPart = unsigned.slice(0, dot);
    fracPart = unsigned.slice(dot + 1);
  }
  if (intPart === '') intPart = '0';

  // Pad fractional part so the two shifted places always exist.
  while (fracPart.length < 2) fracPart += '0';

  // After shifting two places right: new integer digits + remaining fraction.
  const shiftedInt = intPart + fracPart.slice(0, 2);
  const remainder = fracPart.slice(2);

  let roundedInt = Number.parseInt(shiftedInt, 10);
  // Half-up on the discarded remainder (first discarded digit >= 5 rounds up).
  if (remainder.length > 0 && remainder.charCodeAt(0) >= 53 /* '5' */) {
    roundedInt += 1;
  }

  const result = roundedInt / 100;
  return negative ? -result : result;
}



/**
 * Build the canonical content signature for a build (Decision 18.4).
 *
 * One segment per role in EXPANSION_ORDER: `ROLE:product_id:variant_or_empty`.
 * A role absent from the build contributes its empty slot (`GPU::`), so an
 * omitted GPU is represented explicitly rather than elided. Segments are
 * joined with `|`.
 *
 * Comparison is by code unit (`<` / `>`, NEVER localeCompare - Decision 18.4).
 */
function buildSignature(components) {
  const byRole = Object.create(null);
  for (const component of components) {
    byRole[component.component_role] = component;
  }
  const segments = [];
  for (const role of EXPANSION_ORDER) {
    const component = byRole[role];
    if (component === undefined) {
      // Omitted role keeps its empty slot (Decision 18.4): `GPU::`.
      segments.push(`${role}::`);
    } else {
      const variant = component.product_variant_id;
      segments.push(
        `${role}:${component.product_id}:${variant === null || variant === undefined ? '' : variant}`
      );
    }
  }
    return segments.join(SIGNATURE_SEPARATOR);
}

/**
 * Derive the build-level compatibility_status (Decision 18.5, G1).
 * UNKNOWN if `unknown_pairwise_count > 0` OR any component status is UNKNOWN;
 * otherwise PASS. No other value is ever emitted.
 */
function deriveStatus(components, unknownPairwiseCount) {
  if (unknownPairwiseCount > 0) {
    return 'UNKNOWN';
  }
  for (const component of components) {
    if (component.status === 'UNKNOWN') {
      return 'UNKNOWN';
    }
  }
  return 'PASS';
}

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate one assembled build against the Engine 5a input contract (Decision 18
 * Rule 1). Roles absent from EXPANSION_ORDER are not permitted on a component;
 * the only OMITTED role allowed is GPU (the iGPU path), which is represented by
 * the component simply not being present - confirmed against assemble.js where
 * GPU is the single optional-cardinality role (`GPU_ROLE`).
 */
function validateBuild(build, buildIndex) {
  const where = `builds[${buildIndex}]`;

  if (build === null || typeof build !== 'object' || Array.isArray(build)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, where, `${where} must be a build object`);
  }

  // Absent required fields fail with MISSING_REQUIRED_FIELD; present-but-
  // invalid values fail with INVALID_FIELD_VALUE (existing vocabulary, same
  // split as scoring/build-score.js validateUnknownPairwiseCount).
  if (build.components === undefined || build.components === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'builds', `${where}.components is required`);
  }
  if (!Array.isArray(build.components) || build.components.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'builds',
      `${where}.components must be a non-empty array`
    );
  }
  if (build.build_score === undefined || build.build_score === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'builds', `${where}.build_score is required`);
  }
  if (!isFiniteNumber(build.build_score) || build.build_score < 0 || build.build_score > 100) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'builds',
      `${where}.build_score must be a finite number in [0, 100]`
    );
  }
  if (build.total_price === undefined || build.total_price === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'builds', `${where}.total_price is required`);
  }
  if (!isFiniteNumber(build.total_price) || build.total_price <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'builds',
      `${where}.total_price must be a finite number greater than 0`
    );
  }
  if (build.currency === undefined || build.currency === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'builds', `${where}.currency is required`);
  }
  if (typeof build.currency !== 'string' || !/^[A-Z]{3}$/.test(build.currency)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'builds',
      `${where}.currency must be a 3-letter uppercase ISO 4217 code`
    );
  }
  if (build.unknown_pairwise_count === undefined || build.unknown_pairwise_count === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'builds', `${where}.unknown_pairwise_count is required`);
  }
  if (!Number.isInteger(build.unknown_pairwise_count) || build.unknown_pairwise_count < 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'builds',
      `${where}.unknown_pairwise_count must be a non-negative integer`
    );
  }

  const seenRoles = new Set();
  for (let c = 0; c < build.components.length; c += 1) {
    const component = build.components[c];
    const cwhere = `${where}.components[${c}]`;

    if (component === null || typeof component !== 'object' || Array.isArray(component)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, 'builds', `${cwhere} must be a component object`);
    }
    const { component_role, product_id, product_variant_id, status } = component;

    if (typeof component_role !== 'string' || !EXPANSION_ORDER.includes(component_role)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'builds',
        `${cwhere}.component_role "${String(component_role)}" is not a participating Engine 3 role`
      );
    }
    if (seenRoles.has(component_role)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'builds',
        `${where} carries more than one "${component_role}" component (one per role)`
      );
    }
    seenRoles.add(component_role);

    if (typeof product_id !== 'string' || product_id.length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'builds',
        `${cwhere}.product_id must be a non-empty string`
      );
    }
    if (product_variant_id !== null && typeof product_variant_id !== 'string') {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'builds',
        `${cwhere}.product_variant_id must be a string or null`
      );
    }
    if (status !== 'PASS' && status !== 'UNKNOWN') {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'builds',
        `${cwhere}.status must be exactly "PASS" or "UNKNOWN"`
      );
    }
  }
}

function validateBuilds(builds) {
  if (!Array.isArray(builds)) {
    fail(ERROR_CODES.INVALID_INPUT, 'builds', '"builds" must be an array');
  }
    for (let i = 0; i < builds.length; i += 1) {
    validateBuild(builds[i], i);
  }
}

/** Deep-freeze an already-built structure (private, per-module; no shared
 * helper module is introduced - see Decision 12 retention/ note). */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

const COMPARE_MIN = -1;
const COMPARE_MAX = 1;

/** Compare two strings by UTF-16 code unit, never by localeCompare. */
function compareByCodeUnit(a, b) {
  const la = a.length;
  const lb = b.length;
  const minLen = la < lb ? la : lb;
  for (let i = 0; i < minLen; i += 1) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca < cb) return COMPARE_MIN;
    if (ca > cb) return COMPARE_MAX;
  }
  if (la < lb) return COMPARE_MIN;
  if (la > lb) return COMPARE_MAX;
  return 0;
}

/** Engine 5a pure ranking constant (Decision 18.4): the persistable top-N. */
const TOP_N_PERSISTED = 10;

/**
 * Rank Engine 3's assembled builds (Decision 18).
 *
 * @param {object} args { builds }
 * @param {object[]} args.builds frozen Engine 3 builds in discovery order; each
 *        carries components[], build_score, total_price, currency,
 *        unknown_pairwise_count. Zero builds is valid (returns empty result).
 * @returns {object} deeply frozen { ranked, top_n }:
 *   ranked  - ALL builds, sorted score DESC, price ASC, signature ASC; each
 *             entry { rank, build (by reference), build_score (rounded),
 *             total_price (rounded), compatibility_status, signature,
 *             explanation: null };
 *   top_n   - first min(builds.length, TOP_N_PERSISTED) entries of `ranked`.
 * @throws {CandidateSelectionError} fail-fast on any validation violation,
 *        including duplicate build signatures (rank would otherwise depend on
 *        input order).
 */
function rankBuilds({ builds }) {
  validateBuilds(builds);

  // Round before comparing (Decision 18.3); the rounded values are carried on
  // the ranked entries. Duplicate-signature detection is fail-fast so rank
  // never becomes input-order-dependent.
  const prepared = [];
  const signatureIndex = new Map();
  for (let i = 0; i < builds.length; i += 1) {
    const build = builds[i];
    const buildScore = round2(build.build_score);
    const totalPrice = round2(build.total_price);
    const signature = buildSignature(build.components);

    if (signatureIndex.has(signature)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'builds',
        `Duplicate build signature "${signature}" at builds[${i}] and builds[${signatureIndex.get(signature)}]`
      );
    }
    signatureIndex.set(signature, i);

    prepared.push({
      build,
      build_score: buildScore,
      total_price: totalPrice,
      compatibility_status: deriveStatus(build.components, build.unknown_pairwise_count),
      signature,
      comparison: { buildScore, totalPrice, signature },
    });
  }

  // Sort (Decision 18.2): score DESC, then price ASC, then signature ASC by
  // code unit. Discovery order / build ids never influence rank.
  prepared.sort((left, right) => {
    const a = left.comparison;
    const b = right.comparison;
    // DESC on score: the higher rounded build_score sorts first.
    if (a.buildScore > b.buildScore) return COMPARE_MIN;
    if (a.buildScore < b.buildScore) return COMPARE_MAX;
    // ASC on price: the cheaper rounded total_price sorts first.
    if (a.totalPrice < b.totalPrice) return COMPARE_MIN;
    if (a.totalPrice > b.totalPrice) return COMPARE_MAX;
    // ASC on signature, compared by code unit.
    return compareByCodeUnit(a.signature, b.signature);
  });

  // Contiguous ranks 1..n, no equal ranks (Decision 18.7 addendum).
  const ranked = [];
  for (let r = 0; r < prepared.length; r += 1) {
    const entry = prepared[r];
    ranked.push({
      rank: r + 1,
      build: entry.build,
      build_score: entry.build_score,
      total_price: entry.total_price,
      compatibility_status: entry.compatibility_status,
      signature: entry.signature,
      explanation: null,
    });
  }

  const limit = ranked.length < TOP_N_PERSISTED ? ranked.length : TOP_N_PERSISTED;
  const top_n = ranked.slice(0, limit);

  // deepFreeze walks the UNFROZEN arrays so every entry object is sealed too
  // (a pre-frozen array would short-circuit the recursion before its elements);
  // the original builds are already frozen by their producer and are skipped.
  return deepFreeze({ ranked, top_n });
}

module.exports = { rankBuilds, TOP_N_PERSISTED, round2, buildSignature, deriveStatus };





