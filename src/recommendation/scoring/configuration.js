/**
 * Scoring model - configuration contract validator (Decision 3(a)).
 *
 * Boundary: turns the parsed `scoring_model.configuration` JSONB value into the
 * frozen, validated configuration object consumed by the scoring-model loader
 * (`loadScoringModel`), and in the future by Engine 4 and any other consumer.
 *
 *   scoring_model.configuration (JSONB)
 *         |  validate the COMPLETE Decision 3(a) shape
 *         v
 *   frozen validated configuration
 *
 * Scope: the COMPLETE Decision 3(a) contract -- not merely the Engine 3 subset
 * (`candidate_caps`, `gpu_required_use_cases`) that has a consumer today. Every
 * key in `SCORING_MODEL_CONFIGURATION_KEYS` is REQUIRED; there are no silent
 * defaults, no partial acceptance, no normalization, and no acceptance of NULL.
 * `OPTIONAL_CONFIGURATION_KEYS` (Decision 37: `use_case_profiles`) are accepted
 * when DECLARED and omitted otherwise, so a model that predates the key stays
 * valid byte-for-byte.
 *
 * Decision 11 Rule 3 + Rule 4 failure semantics (existing error vocabulary, no
 * new code): configuration NULL/absent -> MISSING_REQUIRED_FIELD
 * `configuration`; top-level not a JSON object (array/scalar) -> INVALID_INPUT
 * `configuration`; required key missing -> MISSING_REQUIRED_FIELD with the
 * exact nested path; unknown key, wrong type, out-of-range value, or malformed
 * nested structure -> INVALID_FIELD_VALUE with the exact nested path.
 *
 * Ranges enforced (exactly the Decision 3(a) contract, never loosened):
 *   neutral_baseline                      finite number, 0 <= x <= 100
 *   no_evidence_penalty                   finite number, x >= 0 (subtractive)
 *   unknown_compat_penalty                finite number, x >= 0 (subtractive)
 *   confidence_multipliers.<level>        finite number, 0 <= x <= 1
 *   staleness.max_age_days                finite number, x >= 0
 *   staleness.per_day_decay               finite number, 0 <= x <= 1
 *   candidate_caps.*                      positive integer
 *   role_weights / type_weights leaves    finite number
 *
 * Deliberately NOT enforced: the canonical vocabularies of the nested keys
 * (`role_weights` / `type_weights` / `confidence_multipliers`) are structural
 * only -- keys must be non-blank strings, and no enum membership is checked at
 * runtime. Same policy as Decision 11 Rule 8 for `gpu_required_use_cases`.
 *
 * Purity: no database access, no framework, no I/O. The validator never
 * mutates or freezes a caller-owned object: it builds fresh nested copies and
 * deep-freezes those copies, so values (including whitespace and case) are
 * preserved byte-for-byte.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { validateUseCaseProfiles, USE_CASE_PROFILES_KEY } = require('./use-cases');

/** The frozen Decision 3(a) top-level vocabulary, in documented order. */
const SCORING_MODEL_CONFIGURATION_KEYS = Object.freeze([
  'version_note',
  'role_weights',
  'type_weights',
  'neutral_baseline',
  'no_evidence_penalty',
  'unknown_compat_penalty',
  'confidence_multipliers',
  'staleness',
  'candidate_caps',
  'gpu_required_use_cases',
]);

/**
 * OPTIONAL top-level keys (Decision 37). Declaring one is allowed and validated
 * strictly; omitting it keeps a model valid byte-for-byte. `use_case_profiles`
 * lives here so the retained `seed-minimal-v1` still validates unchanged while a
 * launch-v2 model can own its use-case policy and vocabulary.
 */
/** OPTIONAL top-level key (Decision 42, E5): per-resolution policy profiles. */
const RESOLUTION_PROFILES_KEY = 'resolution_profiles';

/**
 * OPTIONAL top-level key (Decision 58): OPT IN to consuming the per-use-case
 * `archetype_objectives` weights when ordering the archetype strategies.
 * Absent or false keeps the pre-Decision-58 `priority`-only order, which is
 * what lets a model VERSION isolate the behaviour change.
 */
const APPLY_ARCHETYPE_OBJECTIVES_KEY = 'apply_archetype_objectives';

const OPTIONAL_CONFIGURATION_KEYS = Object.freeze([
  USE_CASE_PROFILES_KEY,
  RESOLUTION_PROFILES_KEY,
  APPLY_ARCHETYPE_OBJECTIVES_KEY,
]);

/** `resolution_profiles.<resolution>` is a strict closed one-field contract. */
const RESOLUTION_PROFILE_FIELDS = Object.freeze(['vram_floor_gb']);

/** `candidate_caps` is a strict closed two-key contract (Decision 11 Rule 7). */
const CANDIDATE_CAPS_FIELDS = Object.freeze([
  'top_k_per_role',
  'max_builds_per_query',
]);

/** OPTIONAL `candidate_caps` key (Decision 40, E3): absent = no per-pair quota. */
const CANDIDATE_CAPS_OPTIONAL_FIELDS = Object.freeze(['max_builds_per_pair']);

/** `staleness` is a strict closed two-key contract (Decision 3(a)). */
const STALENESS_FIELDS = Object.freeze([
  'max_age_days',
  'per_day_decay',
]);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Small private recursive freezer; no shared helper module is created. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * A required numeric field: finite number, optionally bounded. Callers pass
 * the exact documented nested path so failures stay machine-actionable.
 */
function requireNumber(value, path, { min = null, max = null } = {}) {
  if (!isFiniteNumber(value)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, `"${path}" must be a finite number`);
  }
  if (min !== null && value < min) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, `"${path}" must be >= ${min}`);
  }
  if (max !== null && value > max) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, `"${path}" must be <= ${max}`);
  }
}

/** A required non-blank string key of a nested map. */
function requireKeyName(key, path, message) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, message);
  }
}

/** `role_weights`: { <component_role>: { <assessment_type>: weight } }. */
function validateRoleWeights(role_weights) {
  if (!isJsonObject(role_weights)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'role_weights',
      '"role_weights" must be an object keyed by component role'
    );
  }
  const copy = {};
  for (const role of Object.keys(role_weights)) {
    requireKeyName(
      role,
      'role_weights',
      '"role_weights" keys must be non-blank component-role strings'
    );
    const byType = role_weights[role];
    const rolePath = `role_weights.${role}`;
    if (!isJsonObject(byType)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        rolePath,
        `"${rolePath}" must be an object keyed by assessment type`
      );
    }
    const innerCopy = {};
    for (const assessmentType of Object.keys(byType)) {
      requireKeyName(
        assessmentType,
        rolePath,
        `"${rolePath}" keys must be non-blank assessment-type strings`
      );
      requireNumber(byType[assessmentType], `${rolePath}.${assessmentType}`);
      innerCopy[assessmentType] = byType[assessmentType];
    }
    copy[role] = innerCopy;
  }
  return copy;
}

/** `type_weights`: { <assessment_type>: weight } (build level). */
function validateTypeWeights(type_weights) {
  if (!isJsonObject(type_weights)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'type_weights',
      '"type_weights" must be an object keyed by assessment type'
    );
  }
  const copy = {};
  for (const assessmentType of Object.keys(type_weights)) {
    requireKeyName(
      assessmentType,
      'type_weights',
      '"type_weights" keys must be non-blank assessment-type strings'
    );
    requireNumber(type_weights[assessmentType], `type_weights.${assessmentType}`);
    copy[assessmentType] = type_weights[assessmentType];
  }
  return copy;
}

/** `confidence_multipliers`: { <confidence_level>: multiplier }. */
function validateConfidenceMultipliers(confidence_multipliers) {
  if (!isJsonObject(confidence_multipliers)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'confidence_multipliers',
      '"confidence_multipliers" must be an object keyed by confidence level'
    );
  }
  const copy = {};
  for (const level of Object.keys(confidence_multipliers)) {
    requireKeyName(
      level,
      'confidence_multipliers',
      '"confidence_multipliers" keys must be non-blank confidence-level strings'
    );
    requireNumber(confidence_multipliers[level], `confidence_multipliers.${level}`, {
      min: 0,
      max: 1,
    });
    copy[level] = confidence_multipliers[level];
  }
  return copy;
}

/** `staleness`: strict closed { max_age_days, per_day_decay }. */
function validateStaleness(staleness) {
  if (!isJsonObject(staleness)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'staleness',
      '"staleness" must be an object with exactly "max_age_days" and "per_day_decay"'
    );
  }
  for (const key of Object.keys(staleness)) {
    if (!STALENESS_FIELDS.includes(key)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `staleness.${key}`,
        `Unknown "staleness" field "${key}"`
      );
    }
  }
  for (const key of STALENESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(staleness, key)) {
      fail(ERROR_CODES.MISSING_REQUIRED_FIELD, `staleness.${key}`, `"staleness" requires "${key}"`);
    }
  }
  requireNumber(staleness.max_age_days, 'staleness.max_age_days', { min: 0 });
  requireNumber(staleness.per_day_decay, 'staleness.per_day_decay', { min: 0, max: 1 });
  return {
    max_age_days: staleness.max_age_days,
    per_day_decay: staleness.per_day_decay,
  };
}

/**
 * `candidate_caps`: strict closed { top_k_per_role, max_builds_per_query } plus
 * the OPTIONAL max_builds_per_pair (Decision 40), which is absent by default.
 * Validated and preserved only -- never applied here (Decision 11 Rule 7).
 */
function validateCandidateCaps(candidate_caps) {
  if (!isJsonObject(candidate_caps)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps',
      '"candidate_caps" must be an object with exactly "top_k_per_role" and "max_builds_per_query"'
    );
  }
  for (const key of Object.keys(candidate_caps)) {
    if (!CANDIDATE_CAPS_FIELDS.includes(key) && !CANDIDATE_CAPS_OPTIONAL_FIELDS.includes(key)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `candidate_caps.${key}`,
        `Unknown "candidate_caps" field "${key}"`
      );
    }
  }
  for (const key of [...CANDIDATE_CAPS_FIELDS, ...CANDIDATE_CAPS_OPTIONAL_FIELDS]) {
    if (!Object.prototype.hasOwnProperty.call(candidate_caps, key)) {
      if (CANDIDATE_CAPS_FIELDS.includes(key)) {
        fail(ERROR_CODES.MISSING_REQUIRED_FIELD, `candidate_caps.${key}`, `"candidate_caps" requires "${key}"`);
      }
      continue;
    }
    const value = candidate_caps[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `candidate_caps.${key}`,
        `"candidate_caps.${key}" must be a positive integer`
      );
    }
  }
  const caps = {
    top_k_per_role: candidate_caps.top_k_per_role,
    max_builds_per_query: candidate_caps.max_builds_per_query,
  };
  if (Object.prototype.hasOwnProperty.call(candidate_caps, 'max_builds_per_pair')) {
    caps.max_builds_per_pair = candidate_caps.max_builds_per_pair;
  }
  return caps;
}

/**
 * `gpu_required_use_cases`: Decision 10 preserved exactly (Decision 11 Rule 8).
 * Structural validation only -- an empty array is valid, duplicates are valid,
 * entries are preserved byte-for-byte (no trimming, no case folding) and
 * out-of-vocabulary values are accepted; the canonical vocabulary is never
 * enforced at runtime.
 */
/**
 * OPTIONAL `resolution_profiles` (Decision 42, E5): a map of resolution string
 * -> closed one-field profile { vram_floor_gb: integer >= 1 }. The resolution
 * keys are the MODEL's vocabulary (the Decision 37 family: the model owns its
 * use-case and resolution vocabularies); the engine routes declared keys and
 * treats everything else as "no floor". Absent = no VRAM floor anywhere.
 */
function validateResolutionProfiles(resolution_profiles) {
  if (!isJsonObject(resolution_profiles)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'resolution_profiles',
      '"resolution_profiles" must be a JSON object keyed by resolution'
    );
  }
  const validated = {};
  for (const resolution of Object.keys(resolution_profiles)) {
    if (typeof resolution !== 'string' || resolution.trim().length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'resolution_profiles',
        '"resolution_profiles" keys must be non-blank resolution strings'
      );
    }
    const basePath = `resolution_profiles.${resolution}`;
    const profile = resolution_profiles[resolution];
    if (!isJsonObject(profile)) {
      fail(ERROR_CODES.INVALID_INPUT, basePath, `"${basePath}" must be a JSON object`);
    }
    for (const key of Object.keys(profile)) {
      if (!RESOLUTION_PROFILE_FIELDS.includes(key)) {
        fail(
          ERROR_CODES.INVALID_FIELD_VALUE,
          `${basePath}.${key}`,
          `Unknown resolution profile field "${key}"`
        );
      }
    }
    if (!Object.prototype.hasOwnProperty.call(profile, 'vram_floor_gb')) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        `${basePath}.vram_floor_gb`,
        `"${basePath}" requires "vram_floor_gb"`
      );
    }
    const floor = profile.vram_floor_gb;
    if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 1) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `${basePath}.vram_floor_gb`,
        `"${basePath}.vram_floor_gb" must be an integer >= 1`
      );
    }
    validated[resolution] = { vram_floor_gb: floor };
  }
  return validated;
}

function validateGpuRequiredUseCases(gpu_required_use_cases) {
  if (!Array.isArray(gpu_required_use_cases)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpu_required_use_cases',
      '"gpu_required_use_cases" must be an array'
    );
  }
  for (const entry of gpu_required_use_cases) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'gpu_required_use_cases',
        '"gpu_required_use_cases" entries must be non-blank strings'
      );
    }
  }
  return [...gpu_required_use_cases];
}

/**
 * Validate and freeze a complete Decision 3(a) scoring-model configuration.
 *
 * Fail-fast: the first detected contract violation throws immediately.
 * Idempotent: an already-validated (frozen) configuration passes validation
 * again and yields an equal frozen configuration. Values are never normalized
 * (no trim, no case folding, no coercion, no defaulting) and caller-owned
 * objects are never mutated or frozen.
 *
 * @param {object} configuration parsed `scoring_model.configuration`
 * @returns {object} deep-frozen validated configuration
 */
function validateScoringModelConfiguration(configuration) {
  // --- NULL / absent -------------------------------------------------------
  if (configuration === undefined || configuration === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'configuration',
      'Scoring model configuration requires "configuration"'
    );
  }

  // --- top-level shape -----------------------------------------------------
  if (!isJsonObject(configuration)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'configuration',
      'Scoring model configuration must be a JSON object'
    );
  }

  // --- unknown top-level keys (required OR optional vocabulary) -----------
  for (const key of Object.keys(configuration)) {
    if (
      !SCORING_MODEL_CONFIGURATION_KEYS.includes(key) &&
      !OPTIONAL_CONFIGURATION_KEYS.includes(key)
    ) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        key,
        `Unknown scoring model configuration key "${key}"`
      );
    }
  }

  // --- presence of every required top-level key (own property) ------------
  for (const key of SCORING_MODEL_CONFIGURATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(configuration, key)) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        key,
        `Scoring model configuration requires "${key}"`
      );
    }
  }

  // --- version_note --------------------------------------------------------
  if (typeof configuration.version_note !== 'string') {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'version_note', '"version_note" must be a string');
  }

  // --- role_weights / type_weights ----------------------------------------
  const role_weights = validateRoleWeights(configuration.role_weights);
  const type_weights = validateTypeWeights(configuration.type_weights);

  // --- numerically bounded scalar fields ----------------------------------
  requireNumber(configuration.neutral_baseline, 'neutral_baseline', { min: 0, max: 100 });
  requireNumber(configuration.no_evidence_penalty, 'no_evidence_penalty', { min: 0 });
  requireNumber(configuration.unknown_compat_penalty, 'unknown_compat_penalty', { min: 0 });

  // --- confidence_multipliers / staleness ---------------------------------
  const confidence_multipliers = validateConfidenceMultipliers(
    configuration.confidence_multipliers
  );
  const staleness = validateStaleness(configuration.staleness);

  // --- candidate_caps / gpu_required_use_cases ----------------------------
  const candidate_caps = validateCandidateCaps(configuration.candidate_caps);
  const gpu_required_use_cases = validateGpuRequiredUseCases(
    configuration.gpu_required_use_cases
  );

  // Fresh nested copies are frozen; the caller's JSONB object is untouched.
  const validated = {
    version_note: configuration.version_note,
    role_weights,
    type_weights,
    neutral_baseline: configuration.neutral_baseline,
    no_evidence_penalty: configuration.no_evidence_penalty,
    unknown_compat_penalty: configuration.unknown_compat_penalty,
    confidence_multipliers,
    staleness,
    candidate_caps,
    gpu_required_use_cases,
  };
  // Optional (Decision 37): present iff declared, so a legacy model's validated
  // object keeps exactly its old shape and remains byte-identical.
  if (Object.prototype.hasOwnProperty.call(configuration, USE_CASE_PROFILES_KEY)) {
    validated[USE_CASE_PROFILES_KEY] = validateUseCaseProfiles(
      configuration[USE_CASE_PROFILES_KEY]
    );
  }
  // Optional (Decision 42, E5): present iff declared - same pattern as above,
  // so a model without `resolution_profiles` validates byte-identically.
  if (Object.prototype.hasOwnProperty.call(configuration, RESOLUTION_PROFILES_KEY)) {
    validated[RESOLUTION_PROFILES_KEY] = validateResolutionProfiles(
      configuration[RESOLUTION_PROFILES_KEY]
    );
  }
  // Optional (Decision 58): a BOOLEAN opt-in, preserved iff declared. A
  // non-boolean is refused rather than truthy-coerced, because the flag's whole
  // job is to keep an older pinned version's behaviour fixed.
  if (Object.prototype.hasOwnProperty.call(configuration, APPLY_ARCHETYPE_OBJECTIVES_KEY)) {
    const flag = configuration[APPLY_ARCHETYPE_OBJECTIVES_KEY];
    if (typeof flag !== 'boolean') {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        APPLY_ARCHETYPE_OBJECTIVES_KEY,
        `"${APPLY_ARCHETYPE_OBJECTIVES_KEY}" must be a boolean`
      );
    }
    validated[APPLY_ARCHETYPE_OBJECTIVES_KEY] = flag;
  }

  return deepFreeze(validated);
}

module.exports = {
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
  OPTIONAL_CONFIGURATION_KEYS,
  RESOLUTION_PROFILES_KEY,
  APPLY_ARCHETYPE_OBJECTIVES_KEY,
  validateResolutionProfiles,
};
