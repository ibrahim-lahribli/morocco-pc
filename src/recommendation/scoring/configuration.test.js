'use strict';

// ---------------------------------------------------------------------------
// Scoring model (Decision 11): focused tests for the pure Decision 3(a)
// configuration validator.
//
// Scope: the COMPLETE configuration contract -- required keys, exact nested
// structures, types, ranges, strict `candidate_caps`, and the structural-only
// `gpu_required_use_cases` policy (Decision 10 preserved exactly). Engine 3
// validation, the loader, and iGPU sourcing are NOT tested here.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
} = require('./configuration');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** Complete, valid Decision 3(a) configuration built fresh on every call. */
function makeConfiguration(overrides = {}) {
  return {
    version_note: 'shape spec; every key REQUIRED, engine fails fast otherwise',
    role_weights: {
      CPU: { PERFORMANCE: 0.4, VALUE: 0.3 },
      GPU: { PERFORMANCE: 0.5, VALUE: 0.25 },
    },
    type_weights: { PERFORMANCE: 0.5, VALUE: 0.25, QUALITY: 0.25 },
    neutral_baseline: 50,
    no_evidence_penalty: 10,
    unknown_compat_penalty: 5,
    confidence_multipliers: {
      CONFIRMED: 1,
      HIGH: 0.8,
      MEDIUM: 0.6,
      LOW: 0.3,
      UNVERIFIED: 0,
    },
    staleness: { max_age_days: 180, per_day_decay: 0.005 },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    ...overrides,
  };
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

/** Assert the exact structured failure: code + nested field path. */
function assertFailure(configuration, code, field) {
  const error = errorOf(() => validateScoringModelConfiguration(configuration));
  assert.ok(error instanceof CandidateSelectionError, `expected a CandidateSelectionError for ${field}`);
  assert.equal(error.code, code);
  assert.equal(error.field, field);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('accepts the complete Decision 3(a) configuration and preserves it exactly', () => {
  const configuration = makeConfiguration();
  const validated = validateScoringModelConfiguration(configuration);

  assert.deepEqual(validated, configuration);
  assert.deepEqual(Object.keys(validated), SCORING_MODEL_CONFIGURATION_KEYS);
});

test('the required top-level vocabulary is the frozen Decision 3(a) list', () => {
  assert.ok(Object.isFrozen(SCORING_MODEL_CONFIGURATION_KEYS));
  assert.deepEqual(SCORING_MODEL_CONFIGURATION_KEYS, [
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
});

test('validation is idempotent', () => {
  const validated = validateScoringModelConfiguration(makeConfiguration());
  assert.deepEqual(validateScoringModelConfiguration(validated), validated);
});

// ---------------------------------------------------------------------------
// Required keys / top-level shape
// ---------------------------------------------------------------------------

test('every documented top-level key is required', () => {
  for (const key of SCORING_MODEL_CONFIGURATION_KEYS) {
    const configuration = makeConfiguration();
    delete configuration[key];
    assertFailure(configuration, ERROR_CODES.MISSING_REQUIRED_FIELD, key);
  }
});

test('a NULL or absent configuration is a missing required field', () => {
  assertFailure(null, ERROR_CODES.MISSING_REQUIRED_FIELD, 'configuration');
  assertFailure(undefined, ERROR_CODES.MISSING_REQUIRED_FIELD, 'configuration');
});

test('a non-object top-level configuration is invalid input', () => {
  for (const bad of [[], ['GAMING'], 42, 'configuration', true]) {
    assertFailure(bad, ERROR_CODES.INVALID_INPUT, 'configuration');
  }
});

test('unknown top-level keys are rejected with the exact path', () => {
  assertFailure(
    makeConfiguration({ extra_key: 1 }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'extra_key'
  );
  assertFailure(
    makeConfiguration({ malformed_configuration: {} }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'malformed_configuration'
  );
});

// ---------------------------------------------------------------------------
// version_note / role_weights / type_weights
// ---------------------------------------------------------------------------

test('version_note must be a string', () => {
  for (const bad of [50, null, [], {}]) {
    const configuration = makeConfiguration();
    configuration.version_note = bad;
    assertFailure(configuration, ERROR_CODES.INVALID_FIELD_VALUE, 'version_note');
  }
});

test('role_weights is an object of objects of finite numbers', () => {
  assertFailure(
    makeConfiguration({ role_weights: [] }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights'
  );
  assertFailure(
    makeConfiguration({ role_weights: 1 }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights'
  );
  assertFailure(
    makeConfiguration({ role_weights: { CPU: 0.4 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.CPU'
  );
  assertFailure(
    makeConfiguration({ role_weights: { CPU: { PERFORMANCE: '0.4' } } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.CPU.PERFORMANCE'
  );
  assertFailure(
    makeConfiguration({ role_weights: { CPU: { PERFORMANCE: Number.NaN } } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.CPU.PERFORMANCE'
  );
});

test('type_weights is an object of finite numbers', () => {
  assertFailure(
    makeConfiguration({ type_weights: 'weights' }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'type_weights'
  );
  assertFailure(
    makeConfiguration({ type_weights: { PERFORMANCE: null } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'type_weights.PERFORMANCE'
  );
  assertFailure(
    makeConfiguration({ type_weights: { PERFORMANCE: Number.POSITIVE_INFINITY } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'type_weights.PERFORMANCE'
  );
});

// ---------------------------------------------------------------------------
// Numeric ranges
// ---------------------------------------------------------------------------

test('neutral_baseline must stay within the documented 0-100 range', () => {
  for (const bad of [-1, -0.001, 100.001, 101, '50', Number.NaN, Number.POSITIVE_INFINITY]) {
    const configuration = makeConfiguration({ neutral_baseline: bad });
    assertFailure(configuration, ERROR_CODES.INVALID_FIELD_VALUE, 'neutral_baseline');
  }
  assert.ok(validateScoringModelConfiguration(makeConfiguration({ neutral_baseline: 0 })));
  assert.ok(validateScoringModelConfiguration(makeConfiguration({ neutral_baseline: 100 })));
});

test('the subtractive penalties must be non-negative finite numbers', () => {
  for (const bad of [-1, -0.5, '10', Number.NaN, Number.POSITIVE_INFINITY, null]) {
    assertFailure(
      makeConfiguration({ no_evidence_penalty: bad }),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'no_evidence_penalty'
    );
    assertFailure(
      makeConfiguration({ unknown_compat_penalty: bad }),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'unknown_compat_penalty'
    );
  }
  assert.ok(validateScoringModelConfiguration(makeConfiguration({ no_evidence_penalty: 0 })));
  assert.ok(validateScoringModelConfiguration(makeConfiguration({ unknown_compat_penalty: 0 })));
});

test('confidence_multipliers are finite numbers bounded to 0..1', () => {
  assertFailure(
    makeConfiguration({ confidence_multipliers: 'multipliers' }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence_multipliers'
  );
  assertFailure(
    makeConfiguration({ confidence_multipliers: [] }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence_multipliers'
  );
  assertFailure(
    makeConfiguration({ confidence_multipliers: { CONFIRMED: 1.01 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence_multipliers.CONFIRMED'
  );
  assertFailure(
    makeConfiguration({ confidence_multipliers: { UNVERIFIED: -0.01 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence_multipliers.UNVERIFIED'
  );
  assertFailure(
    makeConfiguration({ confidence_multipliers: { CONFIRMED: '1' } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence_multipliers.CONFIRMED'
  );
  assert.ok(
    validateScoringModelConfiguration(makeConfiguration({ confidence_multipliers: { UNVERIFIED: 0 } }))
  );
});

test('staleness is a strict closed two-field contract with documented ranges', () => {
  assertFailure(
    makeConfiguration({ staleness: null }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness'
  );
  assertFailure(
    makeConfiguration({ staleness: [] }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness'
  );
  assertFailure(
    makeConfiguration({ staleness: { max_age_days: 1 } }),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'staleness.per_day_decay'
  );
  assertFailure(
    makeConfiguration({ staleness: { max_age_days: 1, per_day_decay: 1, extra: 1 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness.extra'
  );
  assertFailure(
    makeConfiguration({ staleness: { max_age_days: -1, per_day_decay: 1 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness.max_age_days'
  );
  assertFailure(
    makeConfiguration({ staleness: { max_age_days: 1, per_day_decay: 1.01 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness.per_day_decay'
  );
  assertFailure(
    makeConfiguration({ staleness: { max_age_days: 1, per_day_decay: -0.01 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness.per_day_decay'
  );
  assertFailure(
    makeConfiguration({ staleness: { max_age_days: '180', per_day_decay: 1 } }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'staleness.max_age_days'
  );
});

// ---------------------------------------------------------------------------
// candidate_caps (Decision 11 Rule 7 - validated and preserved, never applied)
// ---------------------------------------------------------------------------

test('candidate_caps is a strict closed two-field contract of positive integers', () => {
  // Malformed container: INVALID_FIELD_VALUE on the exact path.
  assertFailure(
    makeConfiguration({ candidate_caps: null }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidate_caps'
  );
  assertFailure(
    makeConfiguration({ candidate_caps: [] }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidate_caps'
  );
  // Missing required keys with exact nested paths.
  assertFailure(
    makeConfiguration({ candidate_caps: { max_builds_per_query: 10 } }),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'candidate_caps.top_k_per_role'
  );
  assertFailure(
    makeConfiguration({ candidate_caps: { top_k_per_role: 10 } }),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'candidate_caps.max_builds_per_query'
  );
  // Unknown (additional) keys with exact nested paths.
  assertFailure(
    makeConfiguration({
      candidate_caps: { top_k_per_role: 5, max_builds_per_query: 10, extra: 1 },
    }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidate_caps.extra'
  );
});

test('candidate_caps values must be positive integers', () => {
  for (const bad of [0, -1, 2.5, '5', Number.NaN, Number.POSITIVE_INFINITY, null]) {
    assertFailure(
      makeConfiguration({ candidate_caps: { top_k_per_role: bad, max_builds_per_query: 10 } }),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps.top_k_per_role'
    );
    assertFailure(
      makeConfiguration({ candidate_caps: { top_k_per_role: 5, max_builds_per_query: bad } }),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps.max_builds_per_query'
    );
  }
});

test('candidate_caps values are preserved unchanged', () => {
  const caps = { top_k_per_role: 7, max_builds_per_query: 33 };
  const validated = validateScoringModelConfiguration(makeConfiguration({ candidate_caps: caps }));
  assert.deepEqual(validated.candidate_caps, caps);
  assert.equal(validated.candidate_caps.top_k_per_role, 7);
  assert.equal(validated.candidate_caps.max_builds_per_query, 33);
});

// ---------------------------------------------------------------------------
// gpu_required_use_cases (Decision 11 Rule 8 - Decision 10 preserved exactly)
// ---------------------------------------------------------------------------

test('gpu_required_use_cases accepts every structurally valid shape', () => {
  for (const valid of [
    [],
    ['GAMING', 'WORKSTATION'],
    ['RACING'],
    [' gaming '],
    ['gaming'],
    ['GAMING', 'GAMING'],
  ]) {
    const validated = validateScoringModelConfiguration(
      makeConfiguration({ gpu_required_use_cases: valid })
    );
    assert.deepEqual(validated.gpu_required_use_cases, valid);
  }
});

test('gpu_required_use_cases preserves whitespace and case byte-for-byte', () => {
  const raw = [' Gaming  4K ', 'WORKSTATION', '  RACING'];
  const validated = validateScoringModelConfiguration(
    makeConfiguration({ gpu_required_use_cases: raw })
  );
  assert.deepEqual(validated.gpu_required_use_cases, raw);
  assert.equal(validated.gpu_required_use_cases[0], ' Gaming  4K ');
});

test('gpu_required_use_cases accepts out-of-vocabulary values at runtime', () => {
  const validated = validateScoringModelConfiguration(
    makeConfiguration({ gpu_required_use_cases: ['STUDIO', 'NOT_A_USE_CASE'] })
  );
  assert.deepEqual(validated.gpu_required_use_cases, ['STUDIO', 'NOT_A_USE_CASE']);
});

test('gpu_required_use_cases must be an array of non-blank strings', () => {
  for (const bad of ['GAMING', null, 42, {}]) {
    assertFailure(
      makeConfiguration({ gpu_required_use_cases: bad }),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpu_required_use_cases'
    );
  }
  for (const badEntry of [1, null, {}, [''], ['   '], ['GAMING', '']]) {
    assertFailure(
      makeConfiguration({ gpu_required_use_cases: badEntry }),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpu_required_use_cases'
    );
  }
});

// ---------------------------------------------------------------------------
// Immutability / purity
// ---------------------------------------------------------------------------

test('the returned configuration is deeply frozen', () => {
  const validated = validateScoringModelConfiguration(makeConfiguration());

  assert.ok(Object.isFrozen(validated));
  for (const key of SCORING_MODEL_CONFIGURATION_KEYS) {
    const value = validated[key];
    if (value !== null && typeof value === 'object') {
      assert.ok(Object.isFrozen(value), `"${key}" must be frozen`);
    }
  }
  assert.ok(Object.isFrozen(validated.role_weights.CPU));
  assert.ok(Object.isFrozen(validated.confidence_multipliers));
  assert.ok(Object.isFrozen(validated.staleness));
  assert.ok(Object.isFrozen(validated.candidate_caps));
  assert.ok(Object.isFrozen(validated.gpu_required_use_cases));
});

test('the caller-owned configuration is never mutated or frozen', () => {
  const configuration = makeConfiguration();
  const snapshot = JSON.parse(JSON.stringify(configuration));

  validateScoringModelConfiguration(configuration);

  assert.deepEqual(configuration, snapshot);
  assert.equal(Object.isFrozen(configuration), false);
  assert.equal(Object.isFrozen(configuration.role_weights), false);
  assert.equal(Object.isFrozen(configuration.role_weights.CPU), false);
  assert.equal(Object.isFrozen(configuration.candidate_caps), false);
  assert.equal(Object.isFrozen(configuration.gpu_required_use_cases), false);
});

test('configuration.js is a pure validator with no database dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, 'configuration.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['../candidates/errors']);

  const banned = ["require('pg')", '.query(', 'SELECT ', 'INSERT ', 'new Pool'];
  for (const token of banned) {
    assert.ok(!source.includes(token), `configuration.js must not contain ${token}`);
  }
});