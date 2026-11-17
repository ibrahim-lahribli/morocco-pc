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
 * Decision 40 (E3): when candidate_caps.max_builds_per_pair is declared, a GPU
 * branch whose (CPU, GPU) pair already holds that many builds is skipped at GPU
 * depth, and a path whose pair is full is never emitted. The quota is enforced
 * inside the walk, so the max_builds_per_query halt is not spent on one pair.
 * Declared-absent keeps the pre-E3 walk exactly.
 *
 * OG-57 (2026-10-30): the quota covers the GPU-OMITTED path too. A build with no
 * GPU is identified by its CPU alone (see omittedPairKey), the omit branch is
 * skipped once that pair is full, and such a build counts toward the pair and
 * the halt. Before this, `pair` was null whenever no GPU was picked, so an iGPU
 * pass (Decision 43) could spend the entire cap on one CPU - measured as 25
 * builds on 1 pair for golden S19, and the reason deeper retention moved
 * OFFICE backwards. Declared-absent still changes nothing: with no quota there
 * is no pair and no gate.
 *
 * A path ends as soon as its running total moves past budget_amount; an
 * exact match walks on. Traversal halts once max_builds_per_query builds
 * are held. The per-role cap from the input contract is left alone here.
 *
 * The price held on each emitted component is the exact carrier object
 * returned by lookupPrice: kept by reference, never cloned, never edited.
 *
 * Each emitted build also carries unknown_pairwise_count (Decision 23 O2):
 * build-local recomputation over the picked components via
 * countBuildLocalUnknownPairs - each co-occurring pair evaluated once
 * through Decision 16's PAIRWISE_CHECKS, an absent partner (GPU-omit path
 * picks no GPU verdict) contributing 0, and the verdict-level field never
 * read (Decision 23 point 4). This per-build count is the Decision 13
 * producer that Engine 4 consumes downstream.
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
 * tenth input field; Decision 23 supersedes the Decision 15 counting rule:
 * the re-evaluated pairs ARE counted for UNKNOWN (no early return, each
 * pair once). The FAIL gate itself is unchanged; the verdict-level field
 * is kept and validated but no longer consumed.
 *
 * Swap preview (Decision 55, CD-8): evaluateBuildReplacement is the ONE
 * public way to ask "what would this build be if ONE role held a different
 * component?" - a pure, read-only evaluation that reads the SAME
 * PAIRWISE_CHECKS table, the SAME evaluatePairCheck argument construction and
 * the same Engine 2D evaluators as the walk above, and evaluates EVERY check
 * whose pair touches the replaced role in EITHER position (the CPU keys no
 * check at all: its whole verdict lives in the MOTHERBOARD, RAM and
 * CPU_COOLER entries that name it as partner). It substitutes the candidate
 * into a COPY of the picked map - the build is never mutated, nothing is
 * persisted - and answers `{ status, pairs, unknown_pairwise_count }`, where
 * each pair keeps its aggregated status and reason code. A missing partner
 * contributes no pair, exactly as in the walk, so an omitted GPU adds none.
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
// E6 (Decision 43): staged, boundary-local copy of the Decision 37
// GPU-policy vocabulary (one owner: ../scoring/use-cases.js GPU_POLICIES);
// this stage must not import ../scoring (boundary pin).
const GPU_POLICY_VALUES = Object.freeze(['REQUIRED', 'IGPU_ALLOWED']);
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
  // E8 (Decision 45): the three previously-DEFERRED Decision 26 item B rules.
  evaluateCoolerTdpPair,
  evaluateMotherboardMemorySlotsPair,
  evaluateMotherboardMemoryCapacityPair,
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

/**
 * Decision 40 (E3): the (CPU, GPU) identity a per-pair quota counts - product
 * and variant of BOTH sides.
 *
 * This is NOT the same string as the pre-persistence selection pair key
 * (select-diverse.js and select-archetypes.js), which is
 * `${CPU product_id}|${GPU product_variant_id or ''}` and deliberately drops the
 * GPU product_id and the CPU variant. The two keys induce the SAME partition
 * only because offers/select.js enforceVariantIdentity guarantees a GPU
 * candidate carries a non-null product_variant_id and every other role carries
 * null - which is what makes the CPU variant always null here and the GPU
 * product_id always implied by the variant there. Same-fixture agreement is
 * pinned in assemble.test.js (E3/E4 pair-identity test); do not "simplify"
 * either key without re-pinning that test.
 */
function pairKey(cpu, gpu) {
  return JSON.stringify([cpu.product_id, cpu.product_variant_id, gpu.product_id, gpu.product_variant_id]);
}

function pairIsFull(pairCounts, cpu, gpu, maxPerPair) {
  return (pairCounts.get(pairKey(cpu, gpu)) || 0) >= maxPerPair;
}

/**
 * The GPU-OMITTED pair identity (2026-10-30, OG-57).
 *
 * `pairKey` cannot express "no GPU": it dereferences `gpu.product_id`. The
 * iGPU path (Decision 43) emits builds with no GPU component at all, and the
 * quota used to skip those builds entirely (`pair === null`), so a GPU-less
 * pass counted no pair and spent the whole `max_builds_per_query` halt on the
 * first CPU - the exact outcome Decision 40 exists to prevent, measured as 25
 * builds on 1 pair for golden S19.
 *
 * The marker literals cannot collide with `pairKey`'s four UUID-shaped slots,
 * and `OMITTED` is the same word the E4 selector uses for this case
 * (select-archetypes.js), so the two stages describe one situation with one
 * vocabulary. Do not name that module here by role: this file's source-boundary
 * test forbids the stage vocabulary it belongs to.
 *
 * Deliberately a SEPARATE function rather than an optional argument to
 * `pairKey`: the discrete key must keep dereferencing both sides, and a caller
 * that forgot to branch should fail loudly, not silently count an omitted GPU
 * as a distinct partner.
 */
function omittedPairKey(cpu) {
  return JSON.stringify([cpu.product_id, cpu.product_variant_id, 'OMITTED', 'OMITTED']);
}

function omittedPairIsFull(pairCounts, cpu, maxPerPair) {
  return (pairCounts.get(omittedPairKey(cpu)) || 0) >= maxPerPair;
}

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
    gpu_policy,
    candidate_caps,
    prices,
    filtering_context,
    vram_floor_gb,
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
  // Decision 40 (E3): optional per-pair quota. Absent = no quota (pre-E3).
  // A DECLARED null is a malformed quota, never an absent one, so it is validated.
  const quotaDeclared = Object.prototype.hasOwnProperty.call(candidate_caps, 'max_builds_per_pair');
  const maxPerPair = quotaDeclared ? candidate_caps.max_builds_per_pair : null;
  if (
    quotaDeclared &&
    (typeof maxPerPair !== 'number' || !Number.isInteger(maxPerPair) || maxPerPair <= 0)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps.max_builds_per_pair',
      '"candidate_caps.max_builds_per_pair" must be a positive integer'
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
  // E5 (Decision 42): optional resolution VRAM floor. Absent = no floor; a
  // DECLARED null is malformed (Decision 40 quota semantics).
  const vramFloorDeclared = Object.prototype.hasOwnProperty.call(engine3Input, 'vram_floor_gb');
  const vramFloorGb = vramFloorDeclared ? vram_floor_gb : null;
  if (
    vramFloorDeclared &&
    (typeof vramFloorGb !== 'number' || !Number.isInteger(vramFloorGb) || vramFloorGb < 1)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'vram_floor_gb',
      '"vram_floor_gb" must be an integer >= 1 when declared'
    );
  }
  // E5 (Decision 42) hardening: a DECLARED floor makes `specs` load-bearing, so
  // a malformed context fails fast here instead of silently turning the floor
  // into a no-op. Only the SHAPE is checked - an INDIVIDUAL absent spec row, or
  // a NULL `vram_capacity_gb`, stays the legitimate UNKNOWN that belowVramFloor
  // and Decision 12 Rule 2 require. With no floor declared, `specs` is not read
  // by this walk, so the pre-E5 contract is unchanged.
  if (
    vramFloorGb !== null &&
    (filtering_context.specs === null ||
      typeof filtering_context.specs !== 'object' ||
      Array.isArray(filtering_context.specs))
  ) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filtering_context.specs',
      '"filtering_context.specs" must be an object when "vram_floor_gb" is declared'
    );
  }

  // E6 (Decision 43): optional per-use-case GPU policy. Absent = the legacy
  // gpu_required_use_cases rule; a DECLARED value must be an exact Decision
  // 37 policy string (a declared null is malformed).
  const gpuPolicyDeclared = Object.prototype.hasOwnProperty.call(engine3Input, 'gpu_policy');
  const gpuPolicy = gpuPolicyDeclared ? gpu_policy : null;
  if (gpuPolicyDeclared && (typeof gpuPolicy !== 'string' || !GPU_POLICY_VALUES.includes(gpuPolicy))) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpu_policy',
      '"gpu_policy" must be one of ' + GPU_POLICY_VALUES.join(', ') + ' when declared'
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
    maxPerPair,
    vramFloorGb,
    gpuPolicy,
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
  // Decision 55: a replacement candidate is validated by THIS gate too, so
  // `index` also accepts a label (`candidate`, `picked.RAM`) to name the
  // caller's own input instead of a results-array position.
  const where = typeof index === 'string' ? index : `results.${index}`;
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
    // E8 (Decision 45): OG-11 / OG-12. The canonical left role is
    // MOTHERBOARD, already picked, so leftIsNew stays false.
    Object.freeze({
      key: 'mb_memory_slots',
      partnerRole: 'MOTHERBOARD',
      leftIsNew: false,
      evaluator: evaluateMotherboardMemorySlotsPair,
    }),
    Object.freeze({
      key: 'mb_memory_capacity',
      partnerRole: 'MOTHERBOARD',
      leftIsNew: false,
      evaluator: evaluateMotherboardMemoryCapacityPair,
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
    // E8 (Decision 45): OG-09, SOFT. The canonical left role is CPU and the
    // CPU is already picked, so leftIsNew stays false. This pair only ever
    // adds UNKNOWN (never FAIL) to the walk, because the resolver returns
    // UNKNOWN for an under-spec or unmeasured cooler.
    Object.freeze({
      key: 'cooler_tdp',
      partnerRole: 'CPU',
      leftIsNew: false,
      evaluator: evaluateCoolerTdpPair,
    }),
  ]),
});

/**
 * Decision 55: the ONE construction of a check's canonical left/right
 * arguments. `check.leftIsNew` says whether the check's KEYED role (the
 * later-picked one that owns the entry) is the canonical LEFT argument;
 * everywhere except case_radiator the canonical left role is the partner.
 * The assembly gate, the build-local UNKNOWN count and the swap preview all
 * go through here, so a hypothetical replacement can never be judged by
 * different arguments than the walk that produced the build.
 */
function evaluatePairCheck(filteringContext, check, keyedVerdict, partnerVerdict) {
  const left = check.leftIsNew ? keyedVerdict : partnerVerdict;
  const right = check.leftIsNew ? partnerVerdict : keyedVerdict;
  return aggregateCompatibilityResults(check.evaluator(filteringContext, left, right));
}

/**
 * Decision 55: the ONE traversal of PAIRWISE_CHECKS over a picked map.
 * Visits every check whose keyed role AND partner role are both picked, in
 * EXPANSION_ORDER then table order - no sorting, so the visit order is
 * deterministic. `visit` may return exactly false to stop the walk.
 */
function forEachPickedCheck(picked, visit) {
  for (const role of EXPANSION_ORDER) {
    const keyedVerdict = picked[role];
    if (keyedVerdict === undefined) {
      continue;
    }
    const checks = PAIRWISE_CHECKS[role];
    if (checks === undefined) {
      continue;
    }
    for (const check of checks) {
      const partnerVerdict = picked[check.partnerRole];
      if (partnerVerdict === undefined) {
        continue;
      }
      if (visit(role, check, keyedVerdict, partnerVerdict) === false) {
        return;
      }
    }
  }
}

/**
 * One pass of the role's pairwise checks against the already-picked
 * partners. Returns true on the first aggregated pair FAIL. PASS and UNKNOWN
 * pairs stay eligible (Decision 16); an absent partner - the GPU-omit path,
 * or a role bucket that was empty - contributes no pair at all, mirroring
 * Engine 2D's zero-partners-is-never-a-FAIL semantics.
 *
 * Deliberately ROLE-SCOPED, unlike forEachPickedCheck: the DFS calls this once
 * per tentative pick, so scanning the whole picked map here would multiply
 * the cost of assembly for an answer the caller already knows it wants. The
 * table and the left/right construction are still the shared ones.
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
    if (
      evaluatePairCheck(filteringContext, check, verdict, partner).status ===
      FINAL_STATUSES.FAIL
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Decision 23 (O2): count the UNKNOWN pairs among THIS build's picked
 * components. Same table, same canonical left/right construction
 * (evaluatePairCheck) and same traversal (forEachPickedCheck) as
 * evaluateBuildReplacement, but with no early return: every entry whose
 * partner is also picked is evaluated and aggregated, and each pair whose
 * status is UNKNOWN increments the count. Later-picked roles key every pair
 * exactly once (roles with no PAIRWISE_CHECKS entry are covered via their
 * partner's entry); an absent partner (GPU-omit path, empty bucket) contributes no
 * pair. Only UNKNOWN is counted (never "not PASS"); the verdict-level
 * unknown_pairwise_count field is never read here.
 */
function countBuildLocalUnknownPairs(filteringContext, picked) {
  let count = 0;
  // `_keyedRole` is unused on purpose: the count does not care who keys the pair.
  forEachPickedCheck(picked, (_keyedRole, check, keyedVerdict, partnerVerdict) => {
    if (
      evaluatePairCheck(filteringContext, check, keyedVerdict, partnerVerdict).status ===
      FINAL_STATUSES.UNKNOWN
    ) {
      count += 1;
    }
  });
  return count;
}

/**
 * Decision 55: the picked map a preview substitutes into - one Engine 2D
 * verdict per role, keyed by an EXPANSION_ORDER role and nothing else. The
 * entries are validated by validateVerdict, the same gate assembly applies to
 * its own input, so a malformed build cannot produce a confident preview. A
 * role that is absent is fine: it is either the role being replaced (nothing
 * to compare against) or an omitted GPU.
 */
function validatePicked(picked) {
  if (picked === null || typeof picked !== 'object' || Array.isArray(picked)) {
    fail(ERROR_CODES.INVALID_INPUT, 'picked', '"picked" must be an object keyed by role');
  }
  for (const key of Object.keys(picked)) {
    if (!EXPANSION_ORDER.includes(key)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `picked.${key}`,
        `"picked" has an unknown role key "${key}"; use one of ${EXPANSION_ORDER.join(', ')}`
      );
    }
  }
  for (const role of EXPANSION_ORDER) {
    const entry = picked[role];
    if (entry === undefined) {
      continue;
    }
    const validated = validateVerdict(entry, `picked.${role}`);
    if (validated.component_role !== role) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `picked.${role}.component_role`,
        `"picked.${role}" must carry component_role "${role}"`
      );
    }
    // A picked map is a BUILD, and a build never holds a rejected candidate
    // (groupEligible drops them before expansion). Refusing one here keeps
    // "malformed input" from silently becoming "a pair verdict" - the same
    // reason the candidate may not be REJECT either.
    if (validated.status === REJECT_STATUS) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `picked.${role}.status`,
        `"picked.${role}.status" must be an eligible verdict (PASS or UNKNOWN); a build holds no rejected candidate`
      );
    }
  }
}

/**
 * The ONE pair record every build-level evaluation answers with.
 *
 * `check` is the relationship key, `role` the entry's keyed role and
 * `partner_role` its partner - the TABLE's own orientation, so the same pair is
 * described identically wherever it is reported. Shared by
 * `evaluateBuildReplacement` (Decision 55) and `evaluateBuild` (Decision 56) so
 * the two cannot answer the same relation in two shapes.
 */
function pairRecord(keyedRole, check, pair) {
  return Object.freeze({
    check: check.key,
    role: keyedRole,
    partner_role: check.partnerRole,
    status: pair.status,
    reason: pair.reason,
    evidence: Object.freeze(pair.evidence),
  });
}

/**
 * Decision 55 (CD-8 engine half): evaluate ONE hypothetical replacement
 * against an already-picked build and return the verdict, WITHOUT touching
 * the build. Nothing is mutated, persisted or re-ranked, and no price is read
 * here - the price and budget facts of a preview belong to the caller, which
 * resolves them through the filtering / offer-selection path a pass uses
 * (Decision 55 item 4).
 *
 * The candidate is substituted into a COPY of `picked` at `role` - replacing
 * an existing pick and supplying an omitted one (the GPU-omit path) are the
 * same operation - and then EVERY check whose pair includes `role` in either
 * position is evaluated, in EXPANSION_ORDER then table order. The CPU is the
 * proof case: it keys no entry of its own, so its verdict comes entirely from
 * the MOTHERBOARD, RAM and CPU_COOLER entries that name it as partner.
 *
 * Answers a frozen `{ status, pairs, unknown_pairwise_count }`:
 *   - `pairs[i]` is `{ check, role, partner_role, status, reason, evidence }`,
 *     where `check` is the relationship key, `role` is the entry's keyed role
 *     and `partner_role` its partner - the table's own orientation, so the
 *     same pair is described identically whether the replaced role is the
 *     keyed one or the partner;
 *   - `status` is aggregateCompatibilityResults over `pairs` (FAIL beats
 *     UNKNOWN beats PASS), the SAME precedence the walk applies;
 *   - `unknown_pairwise_count` counts the UNKNOWN pairs, never "not PASS".
 * A role with no relationship to any picked partner (SSD_BOOT has none, and
 * a freshly supplied GPU in a GPU-less build keys none of its own) answers
 * `pairs: []` with `status: 'PASS'` - aggregateCompatibilityResults over an
 * empty set - which is the walk's own zero-partners answer; a caller that
 * needs to tell "no relationship" from "verified" reads `pairs.length`.
 *
 * A REJECT candidate is refused rather than previewed: rejection is the
 * filtering stage's own verdict (an ineligible candidate has no price and no
 * compatible build), and a preview that answered PASS/UNKNOWN for it would
 * hide exactly what the caller must report.
 */
function evaluateBuildReplacement(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail(ERROR_CODES.INVALID_INPUT, 'input', '"input" must be an object');
  }
  const { picked, filteringContext, role, candidate } = input;
  if (!EXPANSION_ORDER.includes(role)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'role',
      `"role" must be one of ${EXPANSION_ORDER.join(', ')}`
    );
  }
  if (
    filteringContext === null ||
    typeof filteringContext !== 'object' ||
    Array.isArray(filteringContext)
  ) {
    fail(ERROR_CODES.INVALID_INPUT, 'filteringContext', '"filteringContext" must be an object');
  }
  validatePicked(picked);
  const validatedCandidate = validateVerdict(candidate, 'candidate');
  if (validatedCandidate.component_role !== role) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate.component_role',
      `"candidate.component_role" must be "${role}"`
    );
  }
  if (validatedCandidate.status === REJECT_STATUS) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate.status',
      '"candidate.status" must be an eligible verdict (PASS or UNKNOWN); a rejected candidate has no replacement verdict to preview'
    );
  }

  const substituted = Object.assign({}, picked, { [role]: validatedCandidate });
  const pairs = [];
  forEachPickedCheck(substituted, (keyedRole, check, keyedVerdict, partnerVerdict) => {
    if (keyedRole !== role && check.partnerRole !== role) {
      return;
    }
    const pair = evaluatePairCheck(filteringContext, check, keyedVerdict, partnerVerdict);
    pairs.push(pairRecord(keyedRole, check, pair));
  });
  const frozenPairs = Object.freeze(pairs);
  return Object.freeze({
    status: aggregateCompatibilityResults(frozenPairs).status,
    pairs: frozenPairs,
    unknown_pairwise_count: frozenPairs.filter(
      (pair) => pair.status === FINAL_STATUSES.UNKNOWN
    ).length,
  });
}

/**
 * Decision 56 (committed swap, engine half): the verdict of an ALREADY-BUILT
 * picked map - every pair of the whole build, over the SAME `PAIRWISE_CHECKS`
 * table `assembleBuilds` walks, answered in `{ status, pairs,
 * unknown_pairwise_count }`.
 *
 * WHY THIS IS NOT `evaluateBuildReplacement` WITH A SELF-SUBSTITUTION. That
 * call evaluates only the checks naming the replaced role - a proper SUBSET -
 * and its aggregate is the aggregate of that subset, which for a build status
 * is exactly the wrong number: a commit has to persist ONE status for the WHOLE
 * build, and a status computed from a fraction of its relations would report
 * PASS over an unreported FAIL elsewhere. This function is the whole build's
 * answer, and the commit uses it for `build_candidate.compatibility_status` and
 * for the UNKNOWN count Engine 4 reads (Decision 13 STEP 3).
 *
 * The traversal (`forEachPickedCheck`) and the per-pair construction
 * (`evaluatePairCheck`) are the walk's own internals, so "what assembly would
 * have said about this build" has ONE implementation. Nothing is mutated,
 * persisted, priced or re-ranked, and a REJECT inside `picked` is refused by
 * `validatePicked` because a build never holds one.
 *
 * @param {object} input { picked, filteringContext }
 * @returns {object} frozen { status, pairs, unknown_pairwise_count }
 */
function evaluateBuild(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail(ERROR_CODES.INVALID_INPUT, 'input', '"input" must be an object');
  }
  const { picked, filteringContext } = input;
  if (
    filteringContext === null ||
    typeof filteringContext !== 'object' ||
    Array.isArray(filteringContext)
  ) {
    fail(ERROR_CODES.INVALID_INPUT, 'filteringContext', '"filteringContext" must be an object');
  }
  validatePicked(picked);

  const pairs = [];
  forEachPickedCheck(picked, (keyedRole, check, keyedVerdict, partnerVerdict) => {
    const pair = evaluatePairCheck(filteringContext, check, keyedVerdict, partnerVerdict);
    pairs.push(pairRecord(keyedRole, check, pair));
  });
  const frozenPairs = Object.freeze(pairs);
  return Object.freeze({
    status: aggregateCompatibilityResults(frozenPairs).status,
    pairs: frozenPairs,
    unknown_pairwise_count: frozenPairs.filter(
      (pair) => pair.status === FINAL_STATUSES.UNKNOWN
    ).length,
  });
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
 * E5 (Decision 42): true only when this GPU's VRAM is KNOWN and below the
 * floor. A missing spec entry or a NULL `vram_capacity_gb` is UNKNOWN, and
 * UNKNOWN is never FAIL - such a candidate stays eligible (the Decision 12
 * Rule 2 semantics: PASS/UNKNOWN eligible, only a verified deficit excludes).
 * The floor itself is a RECOMMENDATION policy, not a compatibility verdict.
 *
 * `filteringContext.specs` is guaranteed to be an object by the time this runs:
 * readTraversalInputs rejects a malformed `specs` whenever a floor is declared
 * (and this function is only called when one is).
 */
function belowVramFloor(filteringContext, verdict, floorGb) {
  const spec = filteringContext.specs['v:' + verdict.product_variant_id];
  const vram = spec !== undefined && spec !== null ? spec.vram_capacity_gb : null;
  return typeof vram === 'number' && Number.isFinite(vram) && vram < floorGb;
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
  const pairCounts = new Map();
  let halted = false;

  function finishPath(picked, runningTotal) {
    // Decision 40 (E3): a path whose pair is already full is not emitted; only
    // emitted builds count toward the pair quota and the max_builds_per_query halt.
    // OG-57 (2026-10-30): the GPU-OMITTED path carries a pair too, so a GPU-less
    // pass spreads its builds across CPUs instead of spending the halt on one.
    let pair = null;
    if (traversal.maxPerPair !== null) {
      const cpuChoice = picked[EXPANSION_ORDER[0]];
      pair = picked[GPU_ROLE] === undefined
        ? omittedPairKey(cpuChoice)
        : pairKey(cpuChoice, picked[GPU_ROLE]);
    }
    if (pair !== null && (pairCounts.get(pair) || 0) >= traversal.maxPerPair) {
      return;
    }
    const components = [];
    let total = 0;
    for (const role of EXPANSION_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(picked, role)) {
        continue;
      }
      const verdict = picked[role];
      const price = lookupPrice(traversal.prices, verdict);
      total += price.selected_price;
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
    // Decision 23 (O2): build-local re-evaluation over THIS path's picked
    // components replaces the Decision 15 verdict-sum - the loop above no
    // longer reads verdict.unknown_pairwise_count.
    const unknownPairwiseCount = countBuildLocalUnknownPairs(
      traversal.filteringContext,
      picked
    );
    const build = {
      components: Object.freeze(components),
      total_price: total,
      currency: traversal.currency,
      unknown_pairwise_count: unknownPairwiseCount,
    };
    deepFreeze(build);
    builds.push(build);
    if (pair !== null) {
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }
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
        // E6 (Decision 43): the DECLARED per-use-case policy must reach Rule 0,
        // or a declared REQUIRED could still be dropped and a declared
        // IGPU_ALLOWED could not authorize the omit path. null when absent.
        gpuPolicy: traversal.gpuPolicy,
      });
      const options = buckets[GPU_ROLE];
      // E6 (Decision 43): a DECLARED IGPU_ALLOWED policy makes the iGPU the
      // GPU for this use case, so on an iGPU CPU the discrete-GPU branches
      // are skipped ENTIRELY and the omit path below is the only path. There
      // is deliberately no "fall back to the discrete walk if the omit path
      // builds nothing": omitting the GPU can only RELAX the walk - every
      // picked role has a strictly positive selected_price (prices.js), so
      // the budget gate stays open; an absent partner contributes no pair
      // FAIL (firstPairFailure); and finishPath has no required-role gate -
      // so any GPU-picking path implies its GPU-less variant, and a
      // fallback could never fire. Pinned by the budget-sweep test in
      // assemble.test.js.
      // The LEGACY rule-2 OPTIONAL (no declared policy) keeps walking every
      // eligible GPU verdict (pre-E6 behaviour, byte-identical).
      const skipDiscreteGpu = traversal.gpuPolicy === 'IGPU_ALLOWED' &&
        traversal.integrated_gpu_present[cpuChoice.product_id] === true;
      if (!skipDiscreteGpu) {
        for (const verdict of options) {
          const price = lookupPrice(traversal.prices, verdict);
          const nextTotal = runningTotal + price.selected_price;
          if (nextTotal > traversal.budget_amount) {
            continue;
          }
          // E5 (Decision 42): skip a GPU branch below the resolution VRAM floor.
          // UNKNOWN VRAM (NULL / missing spec) is never below-floor.
          if (traversal.vramFloorGb !== null && belowVramFloor(traversal.filteringContext, verdict, traversal.vramFloorGb)) {
            continue;
          }
          // Decision 40 (E3): skip a GPU branch whose pair is already full.
          if (traversal.maxPerPair !== null && pairIsFull(pairCounts, cpuChoice, verdict, traversal.maxPerPair)) {
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
      }
      if (decision !== 'REQUIRED') {
        // OG-57: the omit branch is quota-gated like any other, or a GPU-less
        // pass fills the whole cap with one CPU's builds and never reaches the
        // next CPU - which is what made deeper retention REGRESS OFFICE.
        if (traversal.maxPerPair === null
            || !omittedPairIsFull(pairCounts, cpuChoice, traversal.maxPerPair)) {
          descend(depth + 1, picked, runningTotal);
        }
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

module.exports = { assembleBuilds, EXPANSION_ORDER, evaluateBuild, evaluateBuildReplacement };

