/**
 * Engine 3 - Step 4: core build assembler / deterministic depth-first walk.
 *
 * Consumes: an already-validated Engine 3 input (Step 1 shape) holding the
 * Engine 2D verdict list, the frozen Step 2 price carrier, and the Step 3
 * GPU inputs.
 * Produces: frozen `{ builds: [...] }` holding complete v1 builds only.
 *
 * Eligibility: PASS and UNKNOWN verdicts stay eligible in incoming order;
 * REJECT verdicts never enter expansion. UNKNOWN keeps equal standing:
 * no weighting, no demotion, no reordering.
 *
 * Traversal follows EXPANSION_ORDER with one verdict per role, except GPU,
 * which follows the Step 3 decision for the active CPU: REQUIRED walks
 * every eligible GPU verdict in incoming order with no omit path, while
 * OPTIONAL walks every eligible GPU verdict first and then one omit path.
 *
 * A path ends as soon as its running total moves past budget_amount; an
 * exact match walks on. Traversal halts once max_builds_per_query builds
 * are held. The per-role cap from the input contract is left alone here.
 *
 * The price held on each emitted component is the exact carrier object
 * returned by lookupPrice: kept by reference, never cloned, never edited.
 *
 * Each emitted build also carries unknown_pairwise_count (Decision 15): the
 * integer sum of the picked verdicts' unknown_pairwise_count, folded in the
 * same EXPANSION_ORDER pass as the running total. The GPU-omit path picks no
 * GPU verdict and therefore contributes 0. This per-build count is the
 * Decision 13 producer that Engine 4 consumes downstream.
 *
 * Pairwise branch validation (Decision 16): when a candidate is tentatively
 * picked for a role, Engine 2D's own pair evaluators re-check it against
 * every already-picked partner it has a relationship with - the
 * relationships whose partner role comes EARLIER in EXPANSION_ORDER. Any
 * aggregated pair FAIL abandons that branch before descent (the branch is
 * never walked further), exactly like the budget cutoff or an empty role
 * bucket. PASS and UNKNOWN pairs stay eligible: no demotion, no weighting.
 * The GPU-omit path picks no GPU, so no GPU pair exists and none is
 * evaluated. The check consumes the frozen Engine 2D context carried by the
 * tenth input field; unknown_pairwise_count keeps its Decision 15 semantics
 * untouched (the verdict-level sums; the re-evaluated pairs are never
 * counted).
 *
 * Component compatibility notes (Decision 22 item 8b): every emitted
 * component carries compatibility_notes - the picked verdict's Engine 2D
 * CONDITIONAL notes (item 8a) narrowed by identity to the partner
 * verdicts actually picked in this build (the note's
 * (partner_role, partner_product_id, partner_product_variant_id) equals
 * the picked partner's identity). Frozen [] when nothing applies; note
 * objects travel by reference, the array is never mutated, and the
 * filter re-calls no resolver and re-derives no support-table row.
 *
 * Pure: no database access, no I/O, no clock reads.
 */

'use strict';

const {
  isValidComponentRole,
  expectedCategoryForRole,
} = require('../candidates/roles');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { lookupPrice } = require('./prices');
const { resolveGpuRequirement } = require('./gpu-policy');
// Decision 16: the pairwise gate reuses Engine 2D's own pair evaluators and
// Engine 1's aggregation - never a second implementation of either.
const {
  evaluateCpuMotherboardPair,
  evaluateCoolerSocketPair,
  evaluateMotherboardMemoryPair,
  evaluatePlatformMemoryPair,
  evaluateCaseFormFactorPair,
  evaluateCaseRadiatorPair,
  evaluateGpuCasePair,
  evaluateGpuPsuPair,
  aggregateCompatibilityResults,
  FINAL_STATUSES,
} = require('../filtering/filter');

/** Authoritative traversal order. Never sorted, never derived. */
const EXPANSION_ORDER = Object.freeze([
  'CPU',
  'MOTHERBOARD',
  'RAM',
  'GPU',
  'PSU',
  'CASE',
  'CPU_COOLER',
  'SSD_BOOT',
]);

/** Verdict states that may enter expansion. */
const ELIGIBLE_STATUS_LIST = Object.freeze(['PASS', 'UNKNOWN']);

/** Verdict state that never enters expansion. */
const REJECT_STATUS = 'REJECT';

/** The only role with optional cardinality. */
const GPU_ROLE = 'GPU';

/** Expected Engine 2D verdict identity fields. */
const VERDICT_FIELDS = Object.freeze([
  'product_id',
  'product_variant_id',
  'category',
  'component_role',
  'status',
  'reason',
  'relationships',
  'unknown_pairwise_count',
]);

const PARTICIPATING_ROLES = new Set(EXPANSION_ORDER);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Light outer-shape gate. Step 1 owns the full contract; assembly rechecks
 * only what traversal depends on: verdict list, running-total limit,
 * currency passthrough, GPU inputs, the build cap, the price carrier, and
 * the Decision 16 pairwise context.
 */
function readTraversalInputs(engine3Input) {
  if (
    engine3Input === null ||
    typeof engine3Input !== 'object' ||
    Array.isArray(engine3Input)
  ) {
    fail(ERROR_CODES.INVALID_INPUT, null, 'Engine 3 input must be an object');
  }
  const {
    results,
    budget_amount,
    currency,
    use_case,
    gpu_required_use_cases,
    integrated_gpu_present,
    candidate_caps,
    prices,
    filtering_context,
  } = engine3Input;
  if (!Array.isArray(results)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'results', '"results" must be an array');
  }
  if (
    typeof budget_amount !== 'number' ||
    !Number.isFinite(budget_amount) ||
    budget_amount <= 0
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget_amount',
      '"budget_amount" must be a finite number greater than 0'
    );
  }
  if (typeof currency !== 'string' || currency.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'currency', '"currency" must be a string');
  }
  if (typeof use_case !== 'string' || use_case.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'use_case', '"use_case" must be a string');
  }
  if (!Array.isArray(gpu_required_use_cases)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpu_required_use_cases',
      '"gpu_required_use_cases" must be an array'
    );
  }
  if (
    integrated_gpu_present === null ||
    typeof integrated_gpu_present !== 'object' ||
    Array.isArray(integrated_gpu_present)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'integrated_gpu_present',
      '"integrated_gpu_present" must be an object map'
    );
  }
  if (candidate_caps === null || typeof candidate_caps !== 'object' || Array.isArray(candidate_caps)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps',
      '"candidate_caps" must be an object'
    );
  }
  const maxBuilds = candidate_caps.max_builds_per_query;
  if (typeof maxBuilds !== 'number' || !Number.isInteger(maxBuilds) || maxBuilds <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps.max_builds_per_query',
      '"candidate_caps.max_builds_per_query" must be a positive integer'
    );
  }
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
    fail(ERROR_CODES.INVALID_INPUT, 'prices', '"prices" must be an object');
  }
  if (
    filtering_context === null ||
    typeof filtering_context !== 'object' ||
    Array.isArray(filtering_context)
  ) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filtering_context',
      '"filtering_context" must be an object'
    );
  }
  return {
    results,
    budget_amount,
    currency,
    use_case,
    gpu_required_use_cases,
    integrated_gpu_present,
    maxBuilds,
    prices,
    filteringContext: filtering_context,
  };
}

/**
 * Enforce the verdict identity assembly depends on: all eight Engine 2D
 * fields present, a known role, the canonical category for participating
 * roles, the Engine 2 variant identity rule, a known verdict state, a
 * relationships map, and a non-negative integer unknown_pairwise_count
 * (Decision 15). REJECT verdicts are validated here and left out of
 * expansion by the caller.
 */
function validateVerdict(entry, index) {
  const where = `results.${index}`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(ERROR_CODES.INVALID_CANDIDATE, where, `Result entry "${where}" must be an object`);
  }
  for (const field of VERDICT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        `${where}.${field}`,
        `Result entry "${where}" requires "${field}"`
      );
    }
  }
  const {
    product_id,
    product_variant_id,
    category,
    component_role,
    status,
    relationships,
    unknown_pairwise_count,
  } = entry;
  if (typeof product_id !== 'string' || product_id.length === 0) {
    fail(
      ERROR_CODES.INVALID_CANDIDATE,
      `${where}.product_id`,
      `Result entry "${where}" has an invalid "product_id"`
    );
  }
  if (
    product_variant_id !== null &&
    (typeof product_variant_id !== 'string' || product_variant_id.length === 0)
  ) {
    fail(
      ERROR_CODES.INVALID_CANDIDATE,
      `${where}.product_variant_id`,
      `Result entry "${where}" has an invalid "product_variant_id"`
    );
  }
  if (!isValidComponentRole(component_role)) {
    fail(
      ERROR_CODES.INVALID_COMPONENT_ROLE,
      `${where}.component_role`,
      `Result entry "${where}" has an unknown "component_role"`
    );
  }
  if (PARTICIPATING_ROLES.has(component_role)) {
    const expected = expectedCategoryForRole(component_role);
    if (category !== expected) {
      fail(
        ERROR_CODES.ROLE_CATEGORY_MISMATCH,
        `${where}.category`,
        `Result entry "${where}" role "${component_role}" requires category "${expected}"`
      );
    }
  }
  if (status !== ELIGIBLE_STATUS_LIST[0] && status !== ELIGIBLE_STATUS_LIST[1] && status !== REJECT_STATUS) {
    fail(
      ERROR_CODES.INVALID_CANDIDATE,
      `${where}.status`,
      `Result entry "${where}" has an unknown "status"`
    );
  }
  if (component_role === GPU_ROLE && product_variant_id === null) {
    fail(
      ERROR_CODES.INVALID_CANDIDATE,
      `${where}.product_variant_id`,
      `Result entry "${where}" GPU verdicts must carry a non-null "product_variant_id"`
    );
  }
  if (component_role !== GPU_ROLE && product_variant_id !== null) {
    fail(
      ERROR_CODES.INVALID_CANDIDATE,
      `${where}.product_variant_id`,
      `Result entry "${where}" non-GPU verdicts must carry a null "product_variant_id"`
    );
  }
  if (relationships === null || typeof relationships !== 'object' || Array.isArray(relationships)) {
    fail(
      ERROR_CODES.INVALID_CANDIDATE,
      `${where}.relationships`,
      `Result entry "${where}" has invalid "relationships"`
    );
  }
  if (!Number.isInteger(unknown_pairwise_count) || unknown_pairwise_count < 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      `${where}.unknown_pairwise_count`,
      `Result entry "${where}" must carry a non-negative integer "unknown_pairwise_count"`
    );
  }
  return entry;
}

/**
 * Derive the eligible view: validated verdicts split into per-role buckets
 * in exact incoming order. REJECT verdicts are validated then left out.
 * SSD_SECONDARY and any other non-participating role never enter a bucket.
 * Inputs are only read; nothing is mutated, sorted, or trimmed.
 */
function groupEligible(results) {
  const buckets = {};
  for (const role of EXPANSION_ORDER) {
    buckets[role] = [];
  }
  for (let index = 0; index < results.length; index += 1) {
    const entry = validateVerdict(results[index], index);
    if (entry.status === REJECT_STATUS) {
      continue;
    }
    if (!PARTICIPATING_ROLES.has(entry.component_role)) {
      continue;
    }
    buckets[entry.component_role].push(entry);
  }
  return buckets;
}

/** Small private recursive freezer; no shared helper module is created. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const keys = Object.keys(value);
    for (const key of keys) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Decision 16: per role, the relationships whose partner role comes EARLIER
 * in EXPANSION_ORDER - the only pairs both of whose roles can already be
 * picked when the role's candidate is tentatively chosen. Roles absent here
 * have no earlier partner (CPU, GPU) or no relationships at all (SSD_BOOT);
 * their pairs, if any, are checked when the partner role is picked later.
 * Each entry names the relationship key (traceability only), the partner
 * role, Engine 2D's exact evaluator, and whether the NEWLY picked candidate
 * is the canonical left-role argument (true only for case_radiator, whose
 * canonical left role is CPU_COOLER - everywhere else the earlier-picked
 * partner is the canonical left role).
 */
const PAIRWISE_CHECKS = Object.freeze({
  MOTHERBOARD: Object.freeze([
    Object.freeze({
      key: 'cpu_motherboard',
      partnerRole: 'CPU',
      leftIsNew: false,
      evaluator: evaluateCpuMotherboardPair,
    }),
  ]),
  RAM: Object.freeze([
    Object.freeze({
      key: 'motherboard_memory',
      partnerRole: 'MOTHERBOARD',
      leftIsNew: false,
      evaluator: evaluateMotherboardMemoryPair,
    }),
    Object.freeze({
      key: 'platform_memory',
      partnerRole: 'CPU',
      leftIsNew: false,
      evaluator: evaluatePlatformMemoryPair,
    }),
  ]),
  PSU: Object.freeze([
    Object.freeze({
      key: 'gpu_psu',
      partnerRole: 'GPU',
      leftIsNew: false,
      evaluator: evaluateGpuPsuPair,
    }),
  ]),
  CASE: Object.freeze([
    Object.freeze({
      key: 'case_form_factor',
      partnerRole: 'MOTHERBOARD',
      leftIsNew: false,
      evaluator: evaluateCaseFormFactorPair,
    }),
    Object.freeze({
      key: 'gpu_case',
      partnerRole: 'GPU',
      leftIsNew: false,
      evaluator: evaluateGpuCasePair,
    }),
  ]),
  CPU_COOLER: Object.freeze([
    Object.freeze({
      key: 'cooler_socket',
      partnerRole: 'CPU',
      leftIsNew: false,
      evaluator: evaluateCoolerSocketPair,
    }),
    Object.freeze({
      key: 'case_radiator',
      partnerRole: 'CASE',
      leftIsNew: true,
      evaluator: evaluateCaseRadiatorPair,
    }),
  ]),
});

/**
 * One pass of the role's pairwise checks against the already-picked
 * partners. Returns true on the first aggregated pair FAIL. PASS and UNKNOWN
 * pairs stay eligible (Decision 16); an absent partner - the GPU-omit path,
 * or a role bucket that was empty - contributes no pair at all, mirroring
 * Engine 2D's zero-partners-is-never-a-FAIL semantics.
 */
function firstPairFailure(filteringContext, role, verdict, picked) {
  const checks = PAIRWISE_CHECKS[role];
  if (checks === undefined) {
    return false;
  }
  for (const check of checks) {
    const partner = picked[check.partnerRole];
    if (partner === undefined) {
      continue;
    }
    const left = check.leftIsNew ? verdict : partner;
    const right = check.leftIsNew ? partner : verdict;
    const pair = aggregateCompatibilityResults(check.evaluator(filteringContext, left, right));
    if (pair.status === FINAL_STATUSES.FAIL) {
      return true;
    }
  }
  return false;
}

/**
 * Decision 22 item 8b: narrow one picked verdict's Engine 2D
 * compatibility_notes (item 8a) to the notes about the partner verdicts
 * actually picked in THIS build - a note survives only when its
 * (partner_role, partner_product_id, partner_product_variant_id)
 * exactly equals the picked partner's identity. A pure identity filter
 * over already-computed notes: no resolver is re-called and no
 * support-table row is re-derived. Note objects travel by reference
 * (never cloned), the returned array is freshly frozen, and [] (never
 * null) applies when nothing matches - including a verdict that predates
 * item 8a.
 */
function narrowCompatibilityNotes(picked, verdict) {
  const notes = Array.isArray(verdict.compatibility_notes)
    ? verdict.compatibility_notes
    : [];
  return Object.freeze(
    notes.filter((note) => {
      if (note === null || typeof note !== 'object') {
        return false;
      }
      if (!Object.prototype.hasOwnProperty.call(picked, note.partner_role)) {
        return false;
      }
      const partner = picked[note.partner_role];
      return (
        partner.product_id === note.partner_product_id &&
        partner.product_variant_id === note.partner_product_variant_id
      );
    })
  );
}

/**
 * Walk EXPANSION_ORDER depth-first and return complete builds in discovery
 * order. Every choice adds its selected_price at once and stops that path
 * past the limit. The build cap halts the walk itself; later paths stay
 * unexplored. Each tentative pick is pair-gated against the already-picked
 * partners first (Decision 16): a FAIL pair abandons the branch before
 * descent. Exactly one build-assembly routine exists in this file.
 */
function assembleBuilds(engine3Input) {
  const traversal = readTraversalInputs(engine3Input);
  const buckets = groupEligible(traversal.results);
  const builds = [];
  let halted = false;

  function finishPath(picked, runningTotal) {
    const components = [];
    let total = 0;
    let unknownPairwiseCount = 0;
    for (const role of EXPANSION_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(picked, role)) {
        continue;
      }
      const verdict = picked[role];
      const price = lookupPrice(traversal.prices, verdict);
      total += price.selected_price;
      unknownPairwiseCount += verdict.unknown_pairwise_count;
      components.push(
        Object.freeze({
          component_role: verdict.component_role,
          product_id: verdict.product_id,
          product_variant_id: verdict.product_variant_id,
          category: verdict.category,
          status: verdict.status,
          price,
          // Decision 22 item 8b: narrowed to this build's picked partners.
          compatibility_notes: narrowCompatibilityNotes(picked, verdict),
        })
      );
    }
    void runningTotal;
    const build = {
      components: Object.freeze(components),
      total_price: total,
      currency: traversal.currency,
      unknown_pairwise_count: unknownPairwiseCount,
    };
    deepFreeze(build);
    builds.push(build);
    if (builds.length >= traversal.maxBuilds) {
      halted = true;
    }
  }

  function descend(depth, picked, runningTotal) {
    if (halted) {
      return;
    }
    if (depth >= EXPANSION_ORDER.length) {
      finishPath(picked, runningTotal);
      return;
    }
    const role = EXPANSION_ORDER[depth];
    if (role === GPU_ROLE) {
      const cpuChoice = picked[EXPANSION_ORDER[0]];
      const decision = resolveGpuRequirement({
        use_case: traversal.use_case,
        gpu_required_use_cases: traversal.gpu_required_use_cases,
        integrated_gpu_present: traversal.integrated_gpu_present,
        selectedCpuProductId: cpuChoice.product_id,
      });
      const options = buckets[GPU_ROLE];
      for (const verdict of options) {
        const price = lookupPrice(traversal.prices, verdict);
        const nextTotal = runningTotal + price.selected_price;
        if (nextTotal > traversal.budget_amount) {
          continue;
        }
        picked[GPU_ROLE] = verdict;
        // GPU has no partner role earlier in EXPANSION_ORDER; its pair
        // checks run when PSU / CASE are picked (see PAIRWISE_CHECKS).
        descend(depth + 1, picked, nextTotal);
        delete picked[GPU_ROLE];
        if (halted) {
          return;
        }
      }
      if (decision !== 'REQUIRED') {
        descend(depth + 1, picked, runningTotal);
      }
      return;
    }
    const options = buckets[role];
    if (options.length === 0) {
      return;
    }
    for (const verdict of options) {
      const price = lookupPrice(traversal.prices, verdict);
      const nextTotal = runningTotal + price.selected_price;
      if (nextTotal > traversal.budget_amount) {
        continue;
      }
      picked[role] = verdict;
      // Decision 16: a pairwise FAIL with an already-picked partner abandons
      // this branch before descent (same shape as the budget cutoff).
      if (firstPairFailure(traversal.filteringContext, role, verdict, picked)) {
        delete picked[role];
        continue;
      }
      descend(depth + 1, picked, nextTotal);
      delete picked[role];
      if (halted) {
        return;
      }
    }
  }

  descend(0, {}, 0);

  return deepFreeze({ builds: Object.freeze(builds) });
}

module.exports = { assembleBuilds, EXPANSION_ORDER };

