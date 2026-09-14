/**
 * Engine 2D - Hard compatibility filter (B2-D: pure verdict aggregation).
 *
 * Boundary: consumes the frozen Engine 2D filtering context produced by the
 * B2-B context loader ({ candidates, specs, platform_by_socket, compat }) and
 * decides, per candidate, whether it can take part in a build (stage 2 "hard
 * compatibility filtering" of docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md).
 *
 *   Engine 2D filtering context (frozen, from ./context-loader)
 *         |  wire the exact B2-C normalized fields into the existing
 *         |  Engine 1 resolvers (../compatibility) - never re-implemented
 *         |  aggregate: check -> pair -> relationship -> candidate verdict
 *         v
 *   Engine 2D filter result { results: [candidate verdict, ...] }
 *
 * B2-D SCOPE. This stage is pure: no database access, no I/O, no mutation of
 * the input context or candidate records. It orchestrates the Engine 1
 * resolvers and aggregates their results; it deliberately does NOT recreate
 * compatibility logic, and does NOT filter by budget, score, assemble
 * builds, select final components, or persist anything.
 *
 * Relationships (exactly the eight required ones - no more):
 *
 *   key                roles                  resolver checks
 *   ------------------ ---------------------- -------------------------------
 *   cpu_motherboard    CPU <-> MOTHERBOARD    socket; exact/family support
 *   cooler_socket      CPU <-> CPU_COOLER     cooler socket support
 *   motherboard_memory MOTHERBOARD <-> RAM    memory type
 *   platform_memory    CPU <-> RAM            platform-derived memory support
 *   case_form_factor   MOTHERBOARD <-> CASE   form factor
 *   case_radiator      CPU_COOLER <-> CASE    radiator compatibility
 *   gpu_case           GPU <-> CASE           length; thickness
 *   gpu_psu            GPU <-> PSU            wattage; connectors
 *
 * SSD roles participate in no relationship (the Engine 2D contract defines
 * none); with zero applicable relationships a candidate is vacuously PASS.
 *
 * Aggregation rules:
 *
 *   Pair (all resolver checks of one candidate pair) - worst-of:
 *     FAIL > UNKNOWN > PASS (aggregateCompatibilityResults).
 *
 *   Relationship (one candidate against all available partners) - best-of:
 *     any pair PASS                        -> PASS
 *     otherwise any pair UNKNOWN           -> UNKNOWN
 *     otherwise (partners exist, all FAIL) -> FAIL
 *     zero partners                        -> UNKNOWN
 *     An absent partner role is therefore never a FAIL.
 *
 *   Candidate (all applicable relationships) - worst-of:
 *     any relationship FAIL              -> REJECT
 *     no FAIL and at least one UNKNOWN   -> UNKNOWN
 *     all applicable relationships PASS  -> PASS
 *     A candidate is rejectable as soon as one relationship definitively
 *     fails.
 *
 * Status vocabulary: pair / relationship statuses reuse Engine 1's
 * FINAL_STATUSES (PASS / FAIL / UNKNOWN); the candidate verdict applies the
 * stage-2 engine action from the architecture (section 3.1): FAIL maps to
 * REJECT while PASS / UNKNOWN keep their meaning. Reasons reuse
 * REASON_CODES. No second verdict vocabulary is introduced.
 *
 * Resolver wiring preserves the B2-C data semantics exactly:
 *   - null stays null and is never converted to 0 / false / 'unknown';
 *   - the cooler radiator_size_mm stays null (the schema provides no
 *     authoritative value) and a HYBRID / null cooler radiator requirement
 *     stays tri-state UNKNOWN;
 *   - an ambiguous / unmapped socket leaves the platform unresolved, so the
 *     platform-memory check reads as UNKNOWN (never FAIL);
 *   - GPU width_slots stays a JS number and required_power_connectors stays
 *     structured JSON;
 *   - PSU connector counts keep the null-vs-0 distinction (a null count is
 *     UNKNOWN, a 0 count is a verifiable deficit).
 *
 * Result shape (deterministic, deep-frozen):
 *
 *   { results: [entry, ...] }
 *
 *   entry = {
 *     product_id, product_variant_id,      exact Engine 2C candidate identity
 *     category, component_role,
 *     status        PASS | UNKNOWN | REJECT
 *     reason        REASON_CODES value or null (decisive relationship)
 *     relationships { [relationship key]: PASS | FAIL | UNKNOWN }
 *   }
 *
 * Determinism: candidates are evaluated in canonical COMPONENT_ROLES order
 * (the B2-C role/bucket order), relationships in canonical order and
 * partners in bucket order (the Engine 2C pool order), so the same context
 * always yields the same result.
 *
 * Immutability: the input context is only read; every result record is a
 * freshly built frozen object - caller-owned data is never mutated or
 * aliased into the output.
 *
 * Errors: the existing Engine 2 CandidateSelectionError / ERROR_CODES are
 * reused; no new error hierarchy.
 */

const { COMPONENT_ROLES } = require('../candidates/roles');
const { createCandidate } = require('../candidates/candidate');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const {
  FINAL_STATUSES,
  aggregateCompatibilityResults,
  resolveCpuMotherboardSocket,
  resolveCpuMotherboardSupport,
  resolveCoolerSocketSupport,
  resolveCaseMotherboardFormFactor,
  resolveCaseRadiator,
  resolvePlatformMemorySupport,
  resolveMotherboardRamMemoryType,
  resolveGpuCaseLength,
  resolveGpuCaseThickness,
  resolveGpuPsuWattage,
  resolveGpuPsuConnectors,
} = require('../compatibility');

/**
 * Candidate verdict vocabulary. PASS / UNKNOWN keep the Engine 1 final
 * status meaning; REJECT is the stage-2 engine action the architecture
 * assigns to a definitive FAIL (a relationship with no passing partner).
 */
const CANDIDATE_STATUSES = Object.freeze({
  PASS: FINAL_STATUSES.PASS,
  UNKNOWN: FINAL_STATUSES.UNKNOWN,
  REJECT: 'REJECT',
});

/**
 * The eight required relationships, in canonical evaluation order. Each
 * relationship is evaluated from BOTH participating roles' perspectives (an
 * owner candidate against the partner-role bucket); left_role is only the
 * canonical argument order used for resolver wiring.
 */
const RELATIONSHIPS = Object.freeze([
  Object.freeze({ key: 'cpu_motherboard', left_role: 'CPU', partner_role: 'MOTHERBOARD' }),
  Object.freeze({ key: 'cooler_socket', left_role: 'CPU', partner_role: 'CPU_COOLER' }),
  Object.freeze({ key: 'motherboard_memory', left_role: 'MOTHERBOARD', partner_role: 'RAM' }),
  Object.freeze({ key: 'platform_memory', left_role: 'CPU', partner_role: 'RAM' }),
  Object.freeze({ key: 'case_form_factor', left_role: 'MOTHERBOARD', partner_role: 'CASE' }),
  Object.freeze({ key: 'case_radiator', left_role: 'CPU_COOLER', partner_role: 'CASE' }),
  Object.freeze({ key: 'gpu_case', left_role: 'GPU', partner_role: 'CASE' }),
  Object.freeze({ key: 'gpu_psu', left_role: 'GPU', partner_role: 'PSU' }),
]);

/** Canonical relationship keys, in canonical order. */
const RELATIONSHIP_KEYS = Object.freeze(RELATIONSHIPS.map((rel) => rel.key));

/** relationship key -> canonical left role used for resolver wiring. */
const RELATIONSHIP_LEFT_ROLE = Object.freeze(
  Object.fromEntries(RELATIONSHIPS.map((rel) => [rel.key, rel.left_role]))
);

/** relationship key -> owner role -> partner role (both directions). */
const RELATIONSHIP_PARTNER_ROLE = Object.freeze(
  Object.fromEntries(
    RELATIONSHIPS.map((rel) => [
      rel.key,
      Object.freeze({
        [rel.left_role]: rel.partner_role,
        [rel.partner_role]: rel.left_role,
      }),
    ])
  )
);

/** role -> applicable relationship keys, in canonical order. */
const ROLE_RELATIONSHIPS = (() => {
  const map = {};
  for (const role of COMPONENT_ROLES) {
    map[role] = [];
  }
  for (const rel of RELATIONSHIPS) {
    map[rel.left_role].push(rel.key);
    map[rel.partner_role].push(rel.key);
  }
  for (const role of Object.keys(map)) {
    map[role] = Object.freeze(map[role]);
  }
  return Object.freeze(map);
})();

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate the filtering-context contract (lightweight; the B2-B loader
 * already produces a fully frozen context). Absent specs /
 * platform_by_socket / compat maps are tolerated and read as unresolved
 * data (UNKNOWN); absent role buckets read as empty (zero partners ->
 * UNKNOWN). Present-but-malformed structures are contract errors.
 *
 * Every candidate is re-validated idempotently through the existing Engine 2
 * candidate contract (the B2-B pattern), and every bucket must contain
 * candidates of its own role (the B2-B bucketing invariant).
 *
 * @param {object} context Engine 2D filtering context
 */
function validateFilteringContext(context) {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'context',
      'filterCandidates requires an Engine 2D filtering context object'
    );
  }

  const candidates = context.candidates;
  if (candidates === null || typeof candidates !== 'object' || Array.isArray(candidates)) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'candidates',
      'Filtering context requires a candidates role-bucket map'
    );
  }

  for (const key of Object.keys(candidates)) {
    if (!COMPONENT_ROLES.includes(key)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'candidates.' + key,
        'Filtering context candidates contains a non-canonical role key "' + key + '"'
      );
    }
  }

  for (const role of COMPONENT_ROLES) {
    const bucket = candidates[role];
    if (bucket === undefined || bucket === null) {
      continue; // absent role: no candidates, zero partners
    }
    if (!Array.isArray(bucket)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'candidates.' + role,
        'Filtering context candidates "' + role + '" must be an array'
      );
    }
    for (const candidate of bucket) {
      const validated = createCandidate(candidate); // idempotent re-validation
      if (validated.component_role !== role) {
        fail(
          ERROR_CODES.INVALID_CANDIDATE,
          'candidates.' + role,
          'Filtering context bucket "' + role + '" contains a candidate of role "' +
            validated.component_role + '"'
        );
      }
    }
  }

  for (const key of ['specs', 'platform_by_socket', 'compat']) {
    const value = context[key];
    if (value === undefined || value === null) {
      continue; // absent: reads as unresolved data (UNKNOWN), never FAIL
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        key,
        'Filtering context "' + key + '" must be an object'
      );
    }
  }
}
// ---------------------------------------------------------------------------
// Safe context accessors. Missing spec entries / compat buckets / platform
// mappings read as unresolved data and are aggregated as UNKNOWN by the
// resolvers - never as FAIL, and never by inventing a value.
// ---------------------------------------------------------------------------

/** The 'p:<product_id>' spec entry of a product-keyed candidate, or null. */
function productSpecOf(context, candidate) {
  const specs = context.specs;
  const spec = specs ? specs['p:' + candidate.product_id] : undefined;
  return spec === undefined ? null : spec;
}

/** The 'v:<product_variant_id>' spec entry of a variant-keyed GPU, or null. */
function variantSpecOf(context, candidate) {
  const specs = context.specs;
  const spec = specs ? specs['v:' + candidate.product_variant_id] : undefined;
  return spec === undefined ? null : spec;
}

/** Loaded compat rows of one owner id, or an empty array (absence-safe). */
function compatRowsOf(context, compatKey, ownerId) {
  const compat = context.compat;
  const rows = compat && compat[compatKey] ? compat[compatKey][ownerId] : undefined;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Resolve the platform of a CPU from its socket via platform_by_socket.
 * Only unambiguous socket mappings resolve (the B2-B guarantee); a missing /
 * null / ambiguous mapping stays unresolved (null), which the platform
 * memory resolver reads as UNKNOWN.
 */
function platformIdFor(context, socketId) {
  if (socketId === null || socketId === undefined) {
    return null;
  }
  const mapping = context.platform_by_socket;
  if (!mapping || !Object.prototype.hasOwnProperty.call(mapping, socketId)) {
    return null;
  }
  return mapping[socketId];
}

// ---------------------------------------------------------------------------
// Pair evaluators. Each wires the exact B2-C normalized fields of ONE
// candidate pair into the existing Engine 1 resolvers and returns their
// results. Canonical argument order is (left-role candidate, partner).
// ---------------------------------------------------------------------------

/**
 * CPU <-> MOTHERBOARD: socket + exact/family support (rules 1-2).
 *
 * The support records are the loader-grouped cpu_motherboard_support rows of
 * the motherboard: the exact record must name this CPU's product id and the
 * family record this CPU's product_family_id (a null CPU family never
 * matches, so it cannot silently satisfy a family rule).
 */
function evaluateCpuMotherboardPair(context, cpu, motherboard) {
  const cpuSpec = productSpecOf(context, cpu);
  const motherboardSpec = productSpecOf(context, motherboard);

  const socketResult = resolveCpuMotherboardSocket({
    cpu_socket_id: cpuSpec ? cpuSpec.socket_id : null,
    motherboard_socket_id: motherboardSpec ? motherboardSpec.socket_id : null,
  });

  const cpuFamilyId = cpuSpec ? cpuSpec.product_family_id : null;
  const exactRows = compatRowsOf(context, 'cpu_motherboard_exact', motherboard.product_id);
  const familyRows = compatRowsOf(context, 'cpu_motherboard_family', motherboard.product_id);
  const exactRecord = exactRows.find(
    (row) => row != null && row.cpu_product_id === cpu.product_id
  ) ?? null;
  const familyRecord = cpuFamilyId === null ? null : (
    familyRows.find(
      (row) => row != null && row.cpu_product_family_id === cpuFamilyId
    ) ?? null
  );

  const supportResult = resolveCpuMotherboardSupport({
    exact_record: exactRecord,
    family_record: familyRecord,
  });

  return [socketResult, supportResult];
}

/**
 * CPU <-> CPU_COOLER: cooler socket support (rule 3).
 */
function evaluateCoolerSocketPair(context, cpu, cooler) {
  const cpuSpec = productSpecOf(context, cpu);
  return [
    resolveCoolerSocketSupport({
      cooler_product_id: cooler.product_id,
      cpu_socket_id: cpuSpec ? cpuSpec.socket_id : null,
      support_records: compatRowsOf(context, 'cooler_socket', cooler.product_id),
    }),
  ];
}

/**
 * MOTHERBOARD <-> RAM: memory type (rule 7, strict equality).
 */
function evaluateMotherboardMemoryPair(context, motherboard, ram) {
  const motherboardSpec = productSpecOf(context, motherboard);
  const ramSpec = productSpecOf(context, ram);
  return [
    resolveMotherboardRamMemoryType({
      motherboard_memory_type_id: motherboardSpec ? motherboardSpec.memory_type_id : null,
      ram_memory_type_id: ramSpec ? ramSpec.memory_type_id : null,
    }),
  ];
}

/**
 * CPU <-> RAM: platform-derived memory support (rule 6). The platform is
 * resolved from the CPU socket only; an unresolved platform carries no
 * memory records and reads as UNKNOWN (never FAIL).
 */
function evaluatePlatformMemoryPair(context, cpu, ram) {
  const cpuSpec = productSpecOf(context, cpu);
  const ramSpec = productSpecOf(context, ram);
  const platformId = platformIdFor(context, cpuSpec ? cpuSpec.socket_id : null);
  return [
    resolvePlatformMemorySupport({
      platform_id: platformId,
      memory_type_id: ramSpec ? ramSpec.memory_type_id : null,
      platform_memory_records: platformId === null
        ? []
        : compatRowsOf(context, 'platform_memory', platformId),
    }),
  ];
}

/**
 * MOTHERBOARD <-> CASE: form factor (rule 4, presence-only rows).
 */
function evaluateCaseFormFactorPair(context, motherboard, caseCandidate) {
  const motherboardSpec = productSpecOf(context, motherboard);
  return [
    resolveCaseMotherboardFormFactor({
      case_product_id: caseCandidate.product_id,
      motherboard_form_factor: motherboardSpec ? motherboardSpec.form_factor : null,
      form_factor_records: compatRowsOf(context, 'case_form_factor', caseCandidate.product_id),
    }),
  ];
}

/**
 * CPU_COOLER <-> CASE: radiator compatibility (rule 5). The cooler spec
 * fields are passed through exactly as loaded - radiator_size_mm stays
 * null and cooler_requires_radiator stays tri-state.
 */
function evaluateCaseRadiatorPair(context, cooler, caseCandidate) {
  const coolerSpec = productSpecOf(context, cooler);
  return [
    resolveCaseRadiator({
      case_product_id: caseCandidate.product_id,
      cooler_requires_radiator: coolerSpec ? coolerSpec.cooler_requires_radiator : null,
      radiator_size_mm: coolerSpec ? coolerSpec.radiator_size_mm : null,
      radiator_position: coolerSpec ? coolerSpec.radiator_position : null,
      radiator_records: compatRowsOf(context, 'case_radiator', caseCandidate.product_id),
    }),
  ];
}

/**
 * GPU <-> CASE: length and thickness (rules 8-9, derived numerics).
 */
function evaluateGpuCasePair(context, gpu, caseCandidate) {
  const gpuSpec = variantSpecOf(context, gpu);
  const caseSpec = productSpecOf(context, caseCandidate);
  return [
    resolveGpuCaseLength({
      gpu_product_variant_id: gpu.product_variant_id,
      case_product_id: caseCandidate.product_id,
      gpu_length_mm: gpuSpec ? gpuSpec.length_mm : null,
      case_max_gpu_length_mm: caseSpec ? caseSpec.max_gpu_length_mm : null,
    }),
    resolveGpuCaseThickness({
      gpu_product_variant_id: gpu.product_variant_id,
      case_product_id: caseCandidate.product_id,
      gpu_width_slots: gpuSpec ? gpuSpec.width_slots : null,
      case_max_gpu_thickness_slots: caseSpec ? caseSpec.max_gpu_thickness_slots : null,
    }),
  ];
}

/**
 * GPU <-> PSU: wattage and connectors (rules 10-11). The GPU connector
 * requirements stay structured JSON and the PSU connector counts keep
 * their null-vs-0 distinction.
 */
function evaluateGpuPsuPair(context, gpu, psu) {
  const gpuSpec = variantSpecOf(context, gpu);
  const psuSpec = productSpecOf(context, psu);
  return [
    resolveGpuPsuWattage({
      gpu_product_variant_id: gpu.product_variant_id,
      psu_product_id: psu.product_id,
      gpu_recommended_psu_watts: gpuSpec ? gpuSpec.recommended_psu_watts : null,
      psu_rated_wattage: psuSpec ? psuSpec.rated_wattage : null,
    }),
    resolveGpuPsuConnectors({
      gpu_product_variant_id: gpu.product_variant_id,
      psu_product_id: psu.product_id,
      gpu_required_power_connectors: gpuSpec ? gpuSpec.required_power_connectors : null,
      psu_power_connectors: psuSpec ? psuSpec.power_connectors : null,
    }),
  ];
}

/** relationship key -> pair evaluator with canonical (left, partner) args. */
const PAIR_EVALUATORS = Object.freeze({
  cpu_motherboard: evaluateCpuMotherboardPair,
  cooler_socket: evaluateCoolerSocketPair,
  motherboard_memory: evaluateMotherboardMemoryPair,
  platform_memory: evaluatePlatformMemoryPair,
  case_form_factor: evaluateCaseFormFactorPair,
  case_radiator: evaluateCaseRadiatorPair,
  gpu_case: evaluateGpuCasePair,
  gpu_psu: evaluateGpuPsuPair,
});

/**
 * Evaluate all resolver checks of one (owner, partner) pair. The canonical
 * left-side candidate is passed first regardless of which role owns the
 * evaluation (the check set - and therefore the pair verdict - is
 * symmetric).
 */
function evaluatePairChecks(context, relationshipKey, ownerRole, owner, partner) {
  const evaluator = PAIR_EVALUATORS[relationshipKey];
  if (ownerRole === RELATIONSHIP_LEFT_ROLE[relationshipKey]) {
    return evaluator(context, owner, partner);
  }
  return evaluator(context, partner, owner);
}
// ---------------------------------------------------------------------------
// Aggregation: pair -> relationship -> candidate.
// ---------------------------------------------------------------------------

/**
 * Best-of aggregation of one relationship's pair statuses:
 * any PASS -> PASS; otherwise any UNKNOWN -> UNKNOWN; otherwise (partners
 * exist and all FAIL) -> FAIL; zero partners -> UNKNOWN.
 */
function bestPartnerStatus(pairStatuses) {
  if (pairStatuses.length === 0) {
    return FINAL_STATUSES.UNKNOWN;
  }
  if (pairStatuses.includes(FINAL_STATUSES.PASS)) {
    return FINAL_STATUSES.PASS;
  }
  if (pairStatuses.includes(FINAL_STATUSES.UNKNOWN)) {
    return FINAL_STATUSES.UNKNOWN;
  }
  return FINAL_STATUSES.FAIL;
}

/** Reason of the first pair carrying the relationship status, or null. */
function firstReasonWithStatus(pairs, status) {
  const decisive = pairs.find((pair) => pair.status === status);
  return decisive ? (decisive.reason ?? null) : null;
}

/**
 * Evaluate one candidate: every applicable relationship against the
 * partner-role bucket, then the candidate verdict (FAIL -> REJECT, else any
 * UNKNOWN -> UNKNOWN, else all-PASS -> PASS).
 */
function evaluateCandidate(context, role, candidate) {
  const evaluatedRelationships = [];

  for (const relationshipKey of ROLE_RELATIONSHIPS[role]) {
    const partnerRole = RELATIONSHIP_PARTNER_ROLE[relationshipKey][role];
    const partners = context.candidates[partnerRole] ?? [];

    const pairs = [];
    for (const partner of partners) {
      const checks = evaluatePairChecks(context, relationshipKey, role, candidate, partner);
      pairs.push(aggregateCompatibilityResults(checks));
    }

    const status = bestPartnerStatus(pairs.map((pair) => pair.status));
    evaluatedRelationships.push({
      key: relationshipKey,
      status,
      reason: firstReasonWithStatus(pairs, status),
    });
  }

  const relationships = {};
  for (const relationship of evaluatedRelationships) {
    relationships[relationship.key] = relationship.status;
  }

  const firstFailed = evaluatedRelationships.find((r) => r.status === FINAL_STATUSES.FAIL);
  const firstUnknown = evaluatedRelationships.find((r) => r.status === FINAL_STATUSES.UNKNOWN);

  let status;
  let reason;
  if (firstFailed) {
    status = CANDIDATE_STATUSES.REJECT;
    reason = firstFailed.reason;
  } else if (firstUnknown) {
    status = CANDIDATE_STATUSES.UNKNOWN;
    reason = firstUnknown.reason;
  } else {
    status = CANDIDATE_STATUSES.PASS;
    reason = null;
  }

  return Object.freeze({
    product_id: candidate.product_id,
    product_variant_id: candidate.product_variant_id,
    category: candidate.category,
    component_role: candidate.component_role,
    status,
    reason,
    relationships: Object.freeze(relationships),
  });
}

/**
 * Run the Engine 2D hard compatibility filter over a filtering context.
 *
 * Pure and deterministic: consumes the frozen B2-C context only (no
 * database access), orchestrates the Engine 1 resolvers per candidate pair,
 * aggregates check -> pair -> relationship -> candidate, and returns a
 * frozen result. The output follows the B2-C role/bucket ordering: results
 * are concatenated in canonical COMPONENT_ROLES order, preserving the
 * bucket (Engine 2C pool) order within every role.
 *
 * @param {object} context frozen { candidates, specs, platform_by_socket, compat }
 * @returns {object} frozen { results: frozen candidate-verdict array }
 */
function filterCandidates(context) {
  validateFilteringContext(context);

  const results = [];
  for (const role of COMPONENT_ROLES) {
    const bucket = context.candidates[role];
    if (bucket === undefined || bucket === null) {
      continue;
    }
    for (const candidate of bucket) {
      results.push(evaluateCandidate(context, role, candidate));
    }
  }

  return Object.freeze({ results: Object.freeze(results) });
}

module.exports = { filterCandidates, CANDIDATE_STATUSES };