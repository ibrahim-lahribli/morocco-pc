'use strict';

/**
 * Scoring model - `use_case_profiles` contract (Decision 37).
 *
 * Purpose: make the scoring model the owner of per-use-case policy AND of the
 * use-case VOCABULARY. Before Decision 37 the API derived its accepted use cases
 * from `gpu_required_use_cases` - the same list that makes the GPU mandatory -
 * so OFFICE could never be offered (OG-38). `listUseCases(configuration)` is the
 * replacement source of truth: it reads the declared use cases from
 * `use_case_profiles`, NOT from `gpu_required_use_cases`.
 *
 *   scoring_model.configuration.use_case_profiles
 *         |  validate the complete shape (strict, fail-fast)
 *         v
 *   frozen validated profiles  +  listUseCases(configuration)
 *
 * Shape (per use case; `gpu_policy` and `spend_targets` are REQUIRED):
 *   use_case_profiles: {
 *     "<USE_CASE>": {
 *       "gpu_policy":           "REQUIRED" | "IGPU_ALLOWED",
 *       "spend_targets":        { "<component_role>": <share of budget, 0..1> },
 *       "role_weights":         { "<role>": { "<assessment_type>": <number> } },   // optional
 *       "archetype_objectives": { "<ARCHETYPE>": <number> }                        // optional
 *     }
 *   }
 *
 * Validation semantics match `configuration.js` exactly: every declared field is
 * validated, unknown fields and out-of-range values fail fast with the exact
 * nested path, and values are never normalized (no trim, no case folding, no
 * coercion, no defaulting).
 *
 * `use_case_profiles` is an OPTIONAL top-level configuration key: models that do
 * not declare it (e.g. the retained `seed-minimal-v1`) stay valid byte-for-byte,
 * which is what "v1 stays for reproducibility" requires.
 *
 * Purity: no database access, no I/O, no framework; the validator builds fresh
 * nested copies and deep-freezes those copies, never the caller's object.
 */

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The optional top-level configuration key this module owns. */
const USE_CASE_PROFILES_KEY = 'use_case_profiles';

/** The frozen GPU-policy vocabulary (Decision 37). */
const GPU_POLICIES = Object.freeze(['REQUIRED', 'IGPU_ALLOWED']);

/** Fields a profile MAY declare. */
const PROFILE_FIELDS = Object.freeze([
  'gpu_policy',
  'spend_targets',
  'role_weights',
  'archetype_objectives',
]);

/** Fields a profile MUST declare. */
const REQUIRED_PROFILE_FIELDS = Object.freeze(['gpu_policy', 'spend_targets']);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Small private recursive freezer; mirrors configuration.js (no shared helper). */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** A required non-blank string key of a nested map. */
function requireKeyName(key, path, message) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, message);
  }
}

/** A budget share: finite number in [0, 1]. */
function requireShare(value, path) {
  if (!isFiniteNumber(value)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, `"${path}" must be a finite number`);
  }
  if (value < 0 || value > 1) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, path, `"${path}" must be a share of budget in [0, 1]`);
  }
}

/** `spend_targets`: { <component_role>: share of budget }. */
function validateSpendTargets(spend_targets, basePath) {
  if (!isJsonObject(spend_targets)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      basePath,
      `"${basePath}" must be an object keyed by component role`
    );
  }
  const copy = {};
  for (const role of Object.keys(spend_targets)) {
    requireKeyName(role, basePath, `"${basePath}" keys must be non-blank component-role strings`);
    requireShare(spend_targets[role], `${basePath}.${role}`);
    copy[role] = spend_targets[role];
  }
  return copy;
}

/** A per-use-case `role_weights` override: { <role>: { <assessment_type>: number } }. */
function validateProfileRoleWeights(role_weights, basePath) {
  if (!isJsonObject(role_weights)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, basePath, `"${basePath}" must be an object keyed by component role`);
  }
  const copy = {};
  for (const role of Object.keys(role_weights)) {
    requireKeyName(role, basePath, `"${basePath}" keys must be non-blank component-role strings`);
    const byType = role_weights[role];
    const rolePath = `${basePath}.${role}`;
    if (!isJsonObject(byType)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, rolePath, `"${rolePath}" must be an object keyed by assessment type`);
    }
    const innerCopy = {};
    for (const assessmentType of Object.keys(byType)) {
      requireKeyName(assessmentType, rolePath, `"${rolePath}" keys must be non-blank assessment-type strings`);
      if (!isFiniteNumber(byType[assessmentType])) {
        fail(ERROR_CODES.INVALID_FIELD_VALUE, `${rolePath}.${assessmentType}`, `"${rolePath}.${assessmentType}" must be a finite number`);
      }
      innerCopy[assessmentType] = byType[assessmentType];
    }
    copy[role] = innerCopy;
  }
  return copy;
}

/** `archetype_objectives`: { <ARCHETYPE>: <number> } (consumed by E4). */
function validateArchetypeObjectives(objectives, basePath) {
  if (!isJsonObject(objectives)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, basePath, `"${basePath}" must be an object keyed by archetype`);
  }
  const copy = {};
  for (const archetype of Object.keys(objectives)) {
    requireKeyName(archetype, basePath, `"${basePath}" keys must be non-blank archetype strings`);
    if (!isFiniteNumber(objectives[archetype])) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, `${basePath}.${archetype}`, `"${basePath}.${archetype}" must be a finite number`);
    }
    copy[archetype] = objectives[archetype];
  }
  return copy;
}

/**
 * Validate `configuration.use_case_profiles` in isolation.
 *
 * @param {object} use_case_profiles the JSONB value
 * @returns {object} deep-frozen validated copy
 */
function validateUseCaseProfiles(use_case_profiles) {
  if (!isJsonObject(use_case_profiles)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      USE_CASE_PROFILES_KEY,
      `"${USE_CASE_PROFILES_KEY}" must be an object keyed by use case`
    );
  }
  const names = Object.keys(use_case_profiles);
  if (names.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      USE_CASE_PROFILES_KEY,
      `"${USE_CASE_PROFILES_KEY}" must declare at least one use case`
    );
  }
  const copy = {};
  for (const name of names) {
    requireKeyName(name, USE_CASE_PROFILES_KEY, `"${USE_CASE_PROFILES_KEY}" keys must be non-blank use-case strings`);
    const profile = use_case_profiles[name];
    const path = `${USE_CASE_PROFILES_KEY}.${name}`;
    if (!isJsonObject(profile)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, path, `"${path}" must be an object`);
    }
    for (const key of Object.keys(profile)) {
      if (!PROFILE_FIELDS.includes(key)) {
        fail(ERROR_CODES.INVALID_FIELD_VALUE, `${path}.${key}`, `Unknown "${path}" field "${key}"`);
      }
    }
    for (const key of REQUIRED_PROFILE_FIELDS) {
      if (!hasOwn(profile, key)) {
        fail(ERROR_CODES.MISSING_REQUIRED_FIELD, `${path}.${key}`, `"${path}" requires "${key}"`);
      }
    }
    if (!GPU_POLICIES.includes(profile.gpu_policy)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `${path}.gpu_policy`,
        `"${path}.gpu_policy" must be one of ${GPU_POLICIES.join(', ')}`
      );
    }
    const built = {
      gpu_policy: profile.gpu_policy,
      spend_targets: validateSpendTargets(profile.spend_targets, `${path}.spend_targets`),
    };
    if (hasOwn(profile, 'role_weights')) {
      built.role_weights = validateProfileRoleWeights(profile.role_weights, `${path}.role_weights`);
    }
    if (hasOwn(profile, 'archetype_objectives')) {
      built.archetype_objectives = validateArchetypeObjectives(
        profile.archetype_objectives,
        `${path}.archetype_objectives`
      );
    }
    copy[name] = built;
  }
  return deepFreeze(copy);
}

/**
 * The use-case vocabulary of a scoring model (Decision 37).
 *
 * Reads `use_case_profiles` when declared - this is the launch-v2 path and the
 * one the API meta vocabulary must use, so the accepted use cases are NO LONGER
 * derived from `gpu_required_use_cases`. Falls back to `gpu_required_use_cases`
 * only for a legacy model that declares no profiles (the retained
 * `seed-minimal-v1`), where the old behaviour is preserved byte-for-byte.
 *
 * @param {object} configuration a scoring-model configuration (validated or raw)
 * @returns {string[]} frozen use-case names in declared order
 */
function listUseCases(configuration) {
  if (!isJsonObject(configuration)) {
    fail(ERROR_CODES.INVALID_INPUT, 'configuration', 'listUseCases requires a scoring-model configuration object');
  }
  const profiles = configuration[USE_CASE_PROFILES_KEY];
  if (isJsonObject(profiles) && Object.keys(profiles).length > 0) {
    return Object.freeze(Object.keys(profiles));
  }
  const legacy = configuration.gpu_required_use_cases;
  if (Array.isArray(legacy)) {
    return Object.freeze([...legacy]);
  }
  fail(
    ERROR_CODES.INVALID_INPUT,
    'configuration',
    `listUseCases found neither "${USE_CASE_PROFILES_KEY}" nor "gpu_required_use_cases"`
  );
}

module.exports = {
  USE_CASE_PROFILES_KEY,
  GPU_POLICIES,
  PROFILE_FIELDS,
  REQUIRED_PROFILE_FIELDS,
  validateUseCaseProfiles,
  listUseCases,
};
